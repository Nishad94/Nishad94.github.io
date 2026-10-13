import http.client
import importlib.util
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[1] / "inference/gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Upstream:
    def __init__(self, events):
        self.events = events

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def __iter__(self):
        for event in self.events:
            if isinstance(event, Exception):
                raise event
            yield event if isinstance(event, bytes) else json.dumps(event).encode()


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = gateway.ThreadingHTTPServer(("127.0.0.1", 0), gateway.H)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        gateway.counts.clear()

    def request(self, events, mode=None):
        body = {"messages": [{"role": "user", "content": "Synthetic diagnostic only."}]}
        if mode:
            body["mode"] = mode
        with patch.object(gateway.urllib.request, "urlopen", return_value=Upstream(events)) as upstream:
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
            try:
                connection.request("POST", "/", json.dumps(body), {"Origin": "https://nishad.ai", "Content-Type": "application/json"})
                response = connection.getresponse()
                status, headers, raw = response.status, dict(response.getheaders()), response.read().decode()
            finally:
                connection.close()
            payload = json.loads(upstream.call_args.args[0].data) if upstream.called else None
        parsed = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith("data:")]
        return status, headers, parsed, payload

    def test_report_and_chat_options_and_genuine_completion(self):
        for mode in [None, "chat"]:
            status, _, events, payload = self.request([
                {"message": {"content": "synthetic"}, "done": False},
                {"done": True, "done_reason": "stop", "prompt_eval_count": 5, "eval_count": 2}
            ], mode)
            self.assertEqual(status, 200)
            self.assertEqual(events[-1], {"done": True, "finish_reason": "stop"})
            self.assertEqual(payload["stream"], True)
            self.assertEqual(payload["think"], False)
            self.assertEqual(payload["keep_alive"], -1)
            self.assertEqual(payload["model"], gateway.MODEL)
            self.assertEqual(payload["options"]["num_ctx"], 4096)
            if mode == "chat":
                self.assertNotIn("format", payload)
                self.assertEqual(payload["options"]["num_predict"], 256)
            else:
                self.assertEqual(payload["format"], "json")
                self.assertGreaterEqual(payload["options"]["num_predict"], 1200)

    def test_missing_terminal_reason_is_not_fabricated(self):
        _, _, events, _ = self.request([{"message": {"content": "{}"}}, {"done": True}])
        self.assertEqual(events[-1], {"error": "upstream_incomplete"})
        self.assertFalse(any(event.get("finish_reason") == "stop" for event in events))

    def test_eof_malformed_and_model_errors_are_explicit(self):
        for source, code in [
            ([{"message": {"content": "{}"}}], "upstream_incomplete"),
            ([b"{broken", {"done": True, "done_reason": "stop"}], "upstream_invalid_response"),
            ([{"error": "private Ollama failure"}], "upstream_failed"),
            ([TimeoutError("private timeout detail")], "upstream_timeout")
        ]:
            with self.subTest(code=code):
                _, _, events, _ = self.request(source)
                self.assertEqual(events[-1], {"error": code})

    def test_length_is_not_changed_to_stop(self):
        _, _, events, _ = self.request([{"message": {"content": "{}"}}, {"done": True, "done_reason": "length"}])
        self.assertEqual(events[-1]["finish_reason"], "length")

    def test_busy_has_retry_guidance_and_does_not_call_ollama(self):
        gateway.SEM.acquire()
        try:
            status, headers, _, payload = self.request([])
            self.assertEqual(status, 503)
            self.assertEqual(headers["Retry-After"], "15")
            self.assertIsNone(payload)
        finally:
            gateway.SEM.release()

    def test_error_releases_capacity_for_next_request(self):
        self.request([{"error": "synthetic failure"}])
        status, _, events, _ = self.request([{"message": {"content": "{}"}}, {"done": True, "done_reason": "stop"}])
        self.assertEqual(status, 200)
        self.assertEqual(events[-1]["finish_reason"], "stop")

class WarmModelTests(unittest.TestCase):
    def state(self, *, seconds=600, context=4096, name=None):
        return {"models": [{
            "name": name or gateway.MODEL,
            "context_length": context,
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
        }]}

    def response(self, value):
        return io.BytesIO(json.dumps(value).encode())

    def test_absent_expiring_or_wrong_context_model_is_preloaded_without_a_prompt(self):
        for state in [
            {"models": []}, self.state(), self.state(context=2048),
            self.state(name="another-local-model")
        ]:
            with self.subTest(state=state), patch.object(gateway.urllib.request, "urlopen", side_effect=[
                self.response(state), self.response({"done": True, "done_reason": "load"})
            ]) as upstream, patch("builtins.print") as log:
                gateway.keep_model_warm()
                self.assertEqual(upstream.call_count, 2)
                request = upstream.call_args.args[0]
                self.assertEqual(request.full_url, gateway.OLLAMA + "/api/chat")
                self.assertEqual(json.loads(request.data), {
                    "model": gateway.MODEL, "messages": [], "stream": False,
                    "think": False, "keep_alive": -1, "options": {"num_ctx": 4096}
                })
                self.assertEqual(json.loads(log.call_args.args[0])["status"], "ready")

    def test_resident_model_is_not_reloaded_or_evaluated(self):
        with patch.object(gateway.urllib.request, "urlopen", return_value=self.response(
            self.state(seconds=10 * 365 * 86400)
        )) as upstream, patch("builtins.print") as log:
            gateway.keep_model_warm()
            upstream.assert_called_once_with(gateway.OLLAMA + "/api/ps", timeout=5)
            log.assert_not_called()

    def test_visitor_request_has_priority_over_maintenance(self):
        gateway.SEM.acquire()
        try:
            with patch.object(gateway.urllib.request, "urlopen", return_value=self.response(
                {"models": []}
            )) as upstream:
                gateway.keep_model_warm()
                self.assertEqual(upstream.call_count, 1)
                self.assertFalse(gateway.SEM.acquire(False))
        finally:
            gateway.SEM.release()

    def test_failed_preload_is_logged_without_private_details_and_releases_capacity(self):
        failures = [
            TimeoutError("private network detail"),
            self.response({"done": True, "done_reason": "stop"}),
            self.response({"done": True, "done_reason": "load", "error": "private model detail"}),
            io.BytesIO(b"invalid JSON")
        ]
        for failure in failures:
            with self.subTest(failure=failure), patch.object(gateway.urllib.request, "urlopen", side_effect=[
                self.response({"models": []}), failure
            ]), patch("builtins.print") as log:
                gateway.keep_model_warm()
                event = json.loads(log.call_args.args[0])
                self.assertEqual(event["status"], "unavailable")
                self.assertEqual(event["retry_seconds"], 60)
                self.assertNotIn("private", log.call_args.args[0])
                self.assertTrue(gateway.SEM.acquire(False))
                gateway.SEM.release()

    def test_invalid_model_state_is_reported_not_treated_as_warm(self):
        for state in [{"models": None}, {"models": [None]}, {
            "models": [{"name": gateway.MODEL, "context_length": 4096, "expires_at": "invalid"}]
        }]:
            with self.subTest(state=state), patch.object(
                gateway.urllib.request, "urlopen", return_value=self.response(state)
            ) as upstream, patch("builtins.print") as log:
                gateway.keep_model_warm()
                self.assertEqual(upstream.call_count, 1)
                self.assertEqual(json.loads(log.call_args.args[0])["status"], "unavailable")

    def test_maintenance_waits_between_attempts_and_stops(self):
        stop = threading.Event()
        with patch.object(gateway, "keep_model_warm") as warm, patch.object(
            stop, "wait", side_effect=lambda seconds: stop.set()
        ) as wait:
            gateway.maintain_warm_model(stop)
            warm.assert_called_once_with()
            wait.assert_called_once_with(60)


if __name__ == "__main__":
    unittest.main()

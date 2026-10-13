import http.client
import importlib.util
import json
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


if __name__ == "__main__":
    unittest.main()

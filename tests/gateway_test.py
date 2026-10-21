import http.client
import importlib.util
import io
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference"))
spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[1] / "inference/gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
import telemetry


class Upstream:
    def __init__(self, events, sse=False):
        self.events = events
        self.sse = sse

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def __iter__(self):
        for event in self.events:
            if isinstance(event, Exception):
                raise event
            if self.sse:
                yield event if isinstance(event, bytes) else ('data: ' + json.dumps(event) + '\n').encode()
                yield b'\n'
            else:
                yield event if isinstance(event, bytes) else json.dumps(event).encode()


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = gateway.GatewayServer(("127.0.0.1", 0), gateway.H)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        gateway.counts.clear()
        gateway.METRICS = gateway.Telemetry()

    def request(self, events, mode=None, sse=False, headers=None):
        body = {"messages": [{"role": "user", "content": "Synthetic diagnostic only."}]}
        if mode:
            body["mode"] = mode
        with patch.object(gateway.urllib.request, "urlopen", return_value=Upstream(events, sse)) as upstream:
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
            try:
                connection.request("POST", "/", json.dumps(body), {"Origin": "https://nishad.ai", "Content-Type": "application/json", **(headers or {})})
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

    def test_full_queue_has_rate_limit_and_does_not_call_model(self):
        gateway.SEM.acquire()
        try:
            with patch.object(gateway, "MAX_QUEUE_LENGTH", 0):
                status, headers, _, payload = self.request([])
            self.assertEqual(status, 429)
            self.assertEqual(headers["Retry-After"], "15")
            self.assertIsNone(payload)
        finally:
            gateway.SEM.release()

    def test_error_releases_capacity_for_next_request(self):
        self.request([{"error": "synthetic failure"}])
        status, _, events, _ = self.request([{"message": {"content": "{}"}}, {"done": True, "done_reason": "stop"}])
        self.assertEqual(status, 200)
        self.assertEqual(events[-1]["finish_reason"], "stop")

    def test_llama_chat_and_report_translate_to_existing_protocol(self):
        for mode in [None, "chat"]:
            with self.subTest(mode=mode), patch.object(gateway, "BACKEND", "llama.cpp"):
                status, _, events, payload = self.request([
                    {"choices": [{"delta": {"role": "assistant", "content": ""}, "finish_reason": None}]},
                    {"choices": [{"delta": {"content": "synthetic café"}, "finish_reason": None}]},
                    {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                ], mode, sse=True)
                self.assertEqual(status, 200)
                self.assertEqual(events[0]["delta"], "synthetic café")
                self.assertEqual(events[-1], {"done": True, "finish_reason": "stop"})
                self.assertEqual(payload["chat_template_kwargs"], {"enable_thinking": False})
                self.assertEqual(payload["id_slot"], gateway.ANSWER_SLOT)
                self.assertEqual(payload["max_tokens"], 256 if mode == "chat" else 1200)
                self.assertNotIn("keep_alive", payload)
                if mode == "chat":
                    self.assertNotIn("response_format", payload)
                else:
                    self.assertEqual(payload["response_format"], {"type": "json_object"})

    def test_llama_does_not_fabricate_completion_or_expose_reasoning(self):
        for source, code in [
            ([{"choices": [{"delta": {"content": "partial"}, "finish_reason": None}]}], "upstream_incomplete"),
            ([b"data: [DONE]\n"], "upstream_incomplete"),
            ([{"choices": [{"delta": {"content": 42}, "finish_reason": None}]}], "upstream_invalid_response"),
            ([{"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}], "upstream_invalid_response"),
            ([{"error": "private model failure"}], "upstream_failed"),
        ]:
            with self.subTest(code=code), patch.object(gateway, "BACKEND", "llama.cpp"):
                _, _, events, _ = self.request(source, "chat", sse=True)
                self.assertEqual(events[-1], {"error": code})
        with patch.object(gateway, "BACKEND", "llama.cpp"):
            _, _, events, _ = self.request([
                {"choices": [{"delta": {"reasoning_content": "private"}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": "answer"}, "finish_reason": "length"}]},
            ], "chat", sse=True)
            self.assertNotIn("private", json.dumps(events))
            self.assertEqual(events[-1]["finish_reason"], "length")

    def test_optional_gateway_token_is_required_before_generation(self):
        with patch.object(gateway, "TOKEN", "synthetic-token"):
            status, _, _, payload = self.request([], "chat")
            self.assertEqual(status, 401)
            self.assertIsNone(payload)
            status, _, events, _ = self.request([
                {"message": {"content": "ok"}, "done": True, "done_reason": "stop"}
            ], "chat", headers={"Authorization": "Bearer synthetic-token"})
            self.assertEqual(status, 200)
            self.assertEqual(events[-1]["finish_reason"], "stop")

    def test_llama_health_checks_readiness_without_generation(self):
        with patch.object(gateway, "BACKEND", "llama.cpp"), patch.object(
            gateway.urllib.request, "urlopen", return_value=io.BytesIO(b'{"status":"ok"}')
        ) as upstream:
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
            try:
                connection.request("GET", "/healthz")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"status": "ok"})
            finally:
                connection.close()
            upstream.assert_called_once_with(gateway.LLAMA + "/health", timeout=5)

    def test_llama_final_usage_is_recorded_without_exposing_prompts_or_tokens_as_text(self):
        with patch.object(gateway, "BACKEND", "llama.cpp"):
            _, _, events, _ = self.request([
                {"choices": [{"delta": {"content": "synthetic"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 8, "completion_tokens": 3}, "timings": {"predicted_per_second": 12.5}},
                b"data: [DONE]\n"
            ], "chat", sse=True)
        self.assertEqual(events[-1], {"done": True, "finish_reason": "stop"})
        # Wait for the handler's finally block after the final SSE write.
        deadline = time.monotonic() + 1
        while not gateway.METRICS.timings and time.monotonic() < deadline:
            time.sleep(.01)
        snapshot = gateway.METRICS.snapshot(gateway.SEM.snapshot(), True, 1)
        self.assertEqual(snapshot["inference"]["tokens"]["output"], 3)
        self.assertEqual(snapshot["inference"]["latency"]["tokens_per_second"]["p50"], 12.5)
        self.assertNotIn("synthetic", json.dumps(snapshot))

    def test_private_metrics_requires_authentication_and_never_uses_remote_hosts(self):
        with patch.object(gateway, "TOKEN", "synthetic-token"), patch.object(
            gateway, "probe_model", return_value=(True, 1)
        ):
            for authorized in [False, True]:
                connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
                try:
                    headers = {"Authorization": "Bearer synthetic-token"} if authorized else {}
                    connection.request("GET", "/metrics", headers=headers)
                    response = connection.getresponse()
                    payload = json.loads(response.read())
                    self.assertEqual(response.status, 200 if authorized else 401)
                    if authorized:
                        self.assertEqual(payload["schema"], "nishad.inference-operations.v1")
                        self.assertEqual(payload["inference"]["queue"]["wait_limit_seconds"], 60)
                        self.assertEqual(payload["workflows"], {})
                finally:
                    connection.close()

    def test_ten_waiters_are_fifo_and_eleventh_waiter_is_rejected(self):
        entered = threading.Event()
        release = threading.Event()
        order = []
        connections = []
        def model(request, timeout):
            name = json.loads(request.data)["messages"][0]["content"]
            order.append(name)
            if name == "active":
                entered.set()
                if not release.wait(5):
                    raise TimeoutError("synthetic hold timeout")
            return Upstream([{"message": {"content": name}, "done": True, "done_reason": "stop"}])
        def connect(name):
            connection = http.client.HTTPConnection(*self.server.server_address, timeout=8)
            connections.append(connection)
            connection.request("POST", "/", json.dumps({
                "mode": "chat", "messages": [{"role": "user", "content": name}]
            }), {"Origin": "https://nishad.ai", "Content-Type": "application/json"})
            return connection.getresponse()
        def active():
            response = connect("active")
            return response.status, response.read()
        with patch.object(gateway.urllib.request, "urlopen", side_effect=model):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(active)
                try:
                    self.assertTrue(entered.wait(2))
                    responses = [connect(str(i)) for i in range(10)]
                    self.assertEqual(len(gateway.SEM.waiting), 10)
                    self.assertEqual(order, ["active"])
                    overflow = connect("overflow")
                    self.assertEqual(overflow.status, 429)
                    self.assertEqual(overflow.getheader("Retry-After"), "15")
                    self.assertEqual(json.loads(overflow.read()), {"error": "queue_full"})
                    release.set()
                    self.assertEqual(future.result(timeout=5)[0], 200)
                    for response in responses:
                        self.assertEqual(response.status, 200)
                        body = response.read().decode()
                        self.assertIn('"queued":true', body)
                        self.assertIn('"finish_reason":"stop"', body)
                    self.assertEqual(order, ["active"] + [str(i) for i in range(10)])
                    self.assertEqual(len(gateway.SEM.waiting), 0)
                finally:
                    release.set()
                    for connection in connections:
                        connection.close()

    def test_queued_http_request_expires_without_model_generation(self):
        gateway.SEM.acquire()
        try:
            with patch.object(gateway, "QUEUE_WAIT_SECONDS", 0.1):
                status, _, events, payload = self.request([], "chat")
            self.assertEqual(status, 200)
            self.assertEqual(events[0], {"queued": True})
            self.assertEqual(events[-1], {"error": "queue_timeout"})
            self.assertIsNone(payload)
            self.assertEqual(len(gateway.SEM.waiting), 0)
        finally:
            gateway.SEM.release()

    def test_disconnected_queued_client_is_removed_without_generation(self):
        gateway.SEM.acquire()
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            with patch.object(gateway.urllib.request, "urlopen") as upstream:
                connection.request("POST", "/", json.dumps({
                    "mode": "chat", "messages": [{"role": "user", "content": "synthetic cancellation"}]
                }), {"Origin": "https://nishad.ai", "Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                response.close()
                connection.close()
                deadline = time.monotonic() + 2
                while gateway.SEM.waiting and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertEqual(len(gateway.SEM.waiting), 0)
                upstream.assert_not_called()
        finally:
            connection.close()
            gateway.SEM.release()

class AdmissionQueueTests(unittest.TestCase):
    def test_router_uses_bounded_id_enums_and_constrained_json_for_both_backends(self):
        for backend in ["llama.cpp", "ollama"]:
            with patch.object(gateway, "BACKEND", backend):
                request = gateway.generation_request(
                    [{"role": "user", "content": "Synthetic routing query"}], False, True, ["career", "blog-0"]
                )
                payload = json.loads(request.data)
                self.assertIn('must select "career"', payload["messages"][0]["content"])
                if backend == "llama.cpp":
                    self.assertEqual(payload["id_slot"], gateway.ROUTING_SLOT)
                schema = payload["response_format"]["json_schema"]["schema"] if backend == "llama.cpp" else payload["format"]
                self.assertEqual(schema["properties"]["source_ids"]["maxItems"], 3)
                self.assertEqual(schema["properties"]["source_ids"]["items"]["enum"], ["career", "blog-0"])
                self.assertEqual(payload.get("max_tokens", payload.get("options", {}).get("num_predict")), 192)

    def test_web_intent_uses_the_routing_slot_and_a_small_strict_schema(self):
        for backend in ["llama.cpp", "ollama"]:
            with patch.object(gateway, "BACKEND", backend):
                request = gateway.generation_request(
                    [{"role": "user", "content": "latest public information"}],
                    False, True, None, 3, True
                )
                payload = json.loads(request.data)
                if backend == "llama.cpp":
                    self.assertEqual(payload["id_slot"], gateway.WEB_INTENT_SLOT)
                    schema = payload["response_format"]["json_schema"]["schema"]
                else:
                    schema = payload["format"]
                self.assertEqual(schema["required"], ["web_search", "web_query"])
                self.assertEqual(schema["properties"]["web_query"]["maxLength"], 300)

    def test_default_queue_wait_expires_at_sixty_seconds_not_fifteen(self):
        self.assertEqual(gateway.QUEUE_WAIT_SECONDS, 60)

    def test_conversation_messages_allow_four_user_assistant_exchanges(self):
        messages = [{"role": "system", "content": "grounding"}]
        for index in range(4):
            messages.extend([
                {"role": "user", "content": f"question {index}"},
                {"role": "assistant", "content": f"answer {index}"}
            ])
        messages.append({"role": "user", "content": "follow-up"})
        self.assertTrue(gateway.allowed_messages(messages))
        self.assertFalse(gateway.allowed_messages(messages + [{"role": "assistant", "content": "too many"}]))


class HostSamplerTests(unittest.TestCase):
    def test_macos_sampler_reports_cpu_memory_disk_and_uptime_without_gpu(self):
        outputs = {
            ("/bin/ps", "-A", "-o", "%cpu="): "80.0\n40.0\n",
            ("/usr/bin/memory_pressure", "-Q"): "System-wide memory free percentage: 25%\n",
            ("/usr/sbin/sysctl", "-n", "kern.boottime"): "{ sec = 1000, usec = 0 }\n",
            ("/usr/sbin/ioreg", "-r", "-d", "1", "-w", "0", "-c", "AGXAccelerator"):
                '"PerformanceStatistics" = {"Device Utilization %"=42}\n'
        }

        def run(command, **_kwargs):
            return SimpleNamespace(stdout=outputs[tuple(command)])

        with patch.object(telemetry.sys, "platform", "darwin"), \
             patch.object(telemetry.os, "cpu_count", return_value=8), \
             patch.object(telemetry.subprocess, "run", side_effect=run), \
             patch.object(telemetry.shutil, "disk_usage", return_value=SimpleNamespace(used=40, total=100)), \
             patch.object(telemetry.time, "time", return_value=87400):
            sample = telemetry.HostSampler().sample()
        self.assertEqual(sample, {
            "cpu_pct": 15.0, "memory_pct": 75.0, "gpu_pct": 42.0,
            "disk_pct": 40.0, "uptime_days": 1.0
        })
        queue = gateway.AdmissionQueue()
        queue.acquire(False)
        ticket = queue.reserve()
        clock = [0.0]
        observed = []
        def advance(_seconds):
            clock[0] = 59.9 if clock[0] == 0 else 60.0
        with patch.object(gateway.time, "monotonic", side_effect=lambda: clock[0]), patch.object(
            queue.condition, "wait", side_effect=advance
        ):
            result = queue.wait(ticket, lambda: False, lambda: observed.append(clock[0]))
        self.assertEqual(result, "queue_timeout")
        self.assertEqual(observed, [59.9, 60.0])
        self.assertEqual(len(queue.waiting), 0)
        queue.release()

    def test_waiter_cannot_be_bypassed_by_maintenance_or_new_arrival(self):
        queue = gateway.AdmissionQueue()
        self.assertIsNone(queue.reserve())
        first = queue.reserve()
        queue.release()
        self.assertFalse(queue.acquire(False))
        second = queue.reserve()
        self.assertIsNotNone(second)
        self.assertIsNone(queue.wait(first, lambda: False, lambda: None))
        queue.release()
        self.assertIsNone(queue.wait(second, lambda: False, lambda: None))
        queue.release()

    def test_cancelled_and_expired_waiters_release_queue_capacity(self):
        queue = gateway.AdmissionQueue()
        queue.acquire(False)
        first = queue.reserve()
        self.assertEqual(queue.wait(first, lambda: True, lambda: None), "request_cancelled")
        second = queue.reserve()
        with patch.object(gateway, "QUEUE_WAIT_SECONDS", 0):
            self.assertEqual(queue.wait(second, lambda: False, lambda: None), "queue_timeout")
        self.assertEqual(len(queue.waiting), 0)
        queue.release()
        self.assertTrue(queue.acquire(False))
        queue.release()

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
            {"models": []}, self.state(), self.state(context=2048)
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

    def test_maintenance_does_not_displace_another_local_model(self):
        with patch.object(gateway.urllib.request, "urlopen", side_effect=[
            self.response(self.state(name="another-local-model")),
            self.response(self.state(name="another-local-model"))
        ]) as upstream, patch("builtins.print") as log:
            gateway.keep_model_warm()
            gateway.keep_model_warm()
            self.assertEqual(upstream.call_count, 2)
            self.assertTrue(all(call.args[0] == gateway.OLLAMA + "/api/ps" for call in upstream.call_args_list))
            self.assertEqual(json.loads(log.call_args.args[0]), {
                "event": "warmup", "status": "deferred",
                "reason": "other_model_resident", "retry_seconds": 60
            })

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

    def test_llama_backend_does_not_use_ollama_residency(self):
        with patch.object(gateway, "BACKEND", "llama.cpp"), patch.object(gateway.urllib.request, "urlopen") as upstream:
            gateway.keep_model_warm()
            upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()

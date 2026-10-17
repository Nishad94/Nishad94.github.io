"""Bounded, process-lifetime operational aggregates; never stores request content."""
import ctypes
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import re
from collections import Counter, deque
from datetime import datetime, timezone


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class HostSampler:
    def __init__(self):
        self.previous = None

    def sample(self):
        if sys.platform == "darwin":
            cpu_result = subprocess.run(
                ["/bin/ps", "-A", "-o", "%cpu="], check=True, capture_output=True, text=True, timeout=5
            )
            cpu_total = sum(float(value) for value in cpu_result.stdout.split())
            cpu = round(min(100, max(0, cpu_total / (os.cpu_count() or 1))), 1)
            memory_result = subprocess.run(
                ["/usr/bin/memory_pressure", "-Q"], check=True, capture_output=True, text=True, timeout=5
            )
            match = next(
                (line for line in memory_result.stdout.splitlines() if line.startswith("System-wide memory free percentage:")),
                None
            )
            if match is None:
                raise ValueError("Invalid macOS memory output")
            free = float(match.rsplit(":", 1)[1].strip().removesuffix("%"))
            boot_result = subprocess.run(
                ["/usr/sbin/sysctl", "-n", "kern.boottime"], check=True, capture_output=True, text=True, timeout=5
            )
            marker = "sec = "
            if marker not in boot_result.stdout:
                raise ValueError("Invalid macOS boot time")
            boot_seconds = int(boot_result.stdout.split(marker, 1)[1].split(",", 1)[0])
            gpu_result = subprocess.run(
                ["/usr/sbin/ioreg", "-r", "-d", "1", "-w", "0", "-c", "AGXAccelerator"],
                check=True, capture_output=True, text=True, timeout=5
            )
            gpu_match = re.search(r'"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)', gpu_result.stdout)
            disk = shutil.disk_usage(os.path.expanduser("~"))
            return {
                "cpu_pct": cpu, "memory_pct": round(100 - free, 1),
                "gpu_pct": round(float(gpu_match.group(1)), 1) if gpu_match else None,
                "disk_pct": round(100 * disk.used / disk.total, 1),
                "uptime_days": round((time.time() - boot_seconds) / 86400, 2)
            }
        if os.name != "nt":
            return dict.fromkeys(("cpu_pct", "memory_pct", "gpu_pct", "disk_pct", "uptime_days"))
        from ctypes import wintypes

        class Memory(ctypes.Structure):
            _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
                (name, ctypes.c_ulonglong) for name in (
                    "total_physical", "available_physical", "total_page", "available_page",
                    "total_virtual", "available_virtual", "available_extended"
                )
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        idle, kernel_time, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
        if not kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel_time), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        value = lambda item: (item.dwHighDateTime << 32) | item.dwLowDateTime
        current = (value(idle), value(kernel_time) + value(user))
        cpu = None
        if self.previous and current[1] > self.previous[1]:
            cpu = round(100 * (1 - (current[0] - self.previous[0]) / (current[1] - self.previous[1])), 1)
            cpu = min(100, max(0, cpu))
        self.previous = current
        memory = Memory()
        memory.length = ctypes.sizeof(memory)
        if not kernel.GlobalMemoryStatusEx(ctypes.byref(memory)):
            raise ctypes.WinError(ctypes.get_last_error())
        disk = shutil.disk_usage(os.environ.get("LOCALAPPDATA", os.getcwd()))
        kernel.GetTickCount64.restype = ctypes.c_ulonglong
        return {
            "cpu_pct": cpu, "memory_pct": memory.load, "gpu_pct": None,
            "disk_pct": round(100 * disk.used / disk.total, 1),
            "uptime_days": round(kernel.GetTickCount64() / 86400000, 2)
        }


def percentile(values, fraction):
    ordered = sorted(value for value in values if value is not None and math.isfinite(value))
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 1) if ordered else None


class Telemetry:
    def __init__(self):
        self.lock = threading.Lock()
        self.started_at = timestamp()
        self.counters = Counter()
        self.timings = deque(maxlen=512)
        self.history = deque(maxlen=288)
        self.host = dict.fromkeys(("cpu_pct", "memory_pct", "gpu_pct", "disk_pct", "uptime_days"))
        self.last_sample_at = None
        self.host_sampler = HostSampler()

    def count(self, name):
        if name not in {
            "requests", "queued", "queue_full", "queue_timeout", "cancelled",
            "rate_limited", "completed", "truncated", "failed"
        }:
            raise ValueError("Unknown metric")
        with self.lock:
            self.counters[name] += 1

    def generation(self, duration_ms, queue_ms, first_token_ms, error, finish_reason, prompt_tokens, output_tokens, tokens_per_second):
        self.count("cancelled" if error == "request_cancelled" else "failed" if error else
                   "truncated" if finish_reason == "length" else "completed")
        with self.lock:
            self.timings.append({
                "duration_ms": duration_ms, "queue_ms": queue_ms, "first_token_ms": first_token_ms,
                "prompt_tokens": prompt_tokens, "output_tokens": output_tokens,
                "tokens_per_second": tokens_per_second
            })

    def sample_host(self):
        host = self.host_sampler.sample()
        sampled_at = timestamp()
        with self.lock:
            self.host = host
            self.last_sample_at = sampled_at
            self.history.append({"ts": sampled_at, **{key: host[key] for key in ("cpu_pct", "memory_pct", "gpu_pct", "disk_pct")}})

    def snapshot(self, queue, model_up, model_latency_ms):
        with self.lock:
            timings = list(self.timings)
            names = ("requests", "queued", "queue_full", "queue_timeout", "cancelled", "rate_limited", "completed", "truncated", "failed")
            counts = {name: self.counters[name] for name in names}
            latency = {
                key: {"p50": percentile([row[key] for row in timings], .5),
                      "p95": percentile([row[key] for row in timings], .95)}
                for key in ("duration_ms", "queue_ms", "first_token_ms", "tokens_per_second")
            }
            token_rows = [row for row in timings if row["output_tokens"] is not None]
            return {
                "schema": "nishad.inference-operations.v1", "generated_at": timestamp(),
                "started_at": self.started_at, "sampled_at": self.last_sample_at,
                "host": {**self.host, "services_up": 1 + int(model_up), "services_total": 2,
                         "availability_pct": 100 if model_up else 50},
                "history": list(self.history),
                "services": {
                    "Python gateway": {"up": True, "latency_ms": None},
                    "Model API": {"up": model_up, "latency_ms": model_latency_ms}
                },
                "workflows": {},
                "inference": {
                    "queue": queue, "counts": counts, "latency": latency, "samples": len(timings),
                    "tokens": {
                        "measured_generations": len(token_rows),
                        "prompt": sum(row["prompt_tokens"] or 0 for row in token_rows) if token_rows else None,
                        "output": sum(row["output_tokens"] for row in token_rows) if token_rows else None
                    }
                }
            }

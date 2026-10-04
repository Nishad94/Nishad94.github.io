"""Static development server; never log OAuth query strings."""
import http.server
import sys
from urllib.parse import urlsplit


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"HTTP {self.command} {urlsplit(self.path).path}", flush=True)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"Serving this worktree at http://127.0.0.1:{port}", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

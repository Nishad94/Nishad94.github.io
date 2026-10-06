"""Static development server; never log OAuth query strings."""
import http.server
import sys
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / "404.html"
        if code == 404 and page.is_file():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"HTTP {self.command} {urlsplit(self.path).path}", flush=True)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
directory = sys.argv[2] if len(sys.argv) > 2 else "."
print(f"Serving this worktree at http://127.0.0.1:{port}", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=directory)).serve_forever()

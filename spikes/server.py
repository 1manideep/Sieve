#!/usr/bin/env python3
"""Local server for the Sieve spikes.

Serves this folder on http://localhost:8787 and saves JSON that a spike page
POSTs to /results into spikes/results/ (git-ignored). Binds to 127.0.0.1 only.
"""
from __future__ import annotations

import http.server
import json
import pathlib
import re
import time

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "results"
PORT = 8787
MAX_BODY = 5_000_000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/results":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            self.send_error(413)
            return
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self.send_error(400, "not JSON")
            return
        test = re.sub(r"[^a-z0-9-]", "", str(data.get("test", "run")).lower()) or "run"
        OUT.mkdir(exist_ok=True)
        name = f"{test}-{time.strftime('%Y%m%d-%H%M%S')}.json"
        (OUT / name).write_text(json.dumps(data, indent=2))
        body = json.dumps({"saved": name}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        print(f"Sieve spikes on http://localhost:{PORT}/nano/", flush=True)
        server.serve_forever()

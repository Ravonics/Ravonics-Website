#!/usr/bin/env python3
"""Serve the local issue review page and persist browser decisions."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "issue-review-state.json"


class IssueReviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/issue-review-state":
            self._send_state()
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/issue-review-state":
            self.send_error(404, "Unknown endpoint")
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_error(400, f"Invalid JSON: {exc}")
            return

        payload["serverSavedAt"] = datetime.now(timezone.utc).isoformat()
        tmp_file = STATE_FILE.with_suffix(".json.tmp")
        tmp_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp_file, STATE_FILE)

        self._send_json({"ok": True, "path": str(STATE_FILE)})

    def _send_state(self):
        if STATE_FILE.exists():
            try:
                payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                payload = {"source": "issue-review-state.json", "decisions": {}}
        else:
            payload = {"source": "issue-review-state.json", "decisions": {}}

        self._send_json(payload)

    def _send_json(self, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Serve the Ravonics issue review dashboard.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), IssueReviewHandler)
    print(f"Serving {ROOT} at http://{args.host}:{args.port}/issue-review.html", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

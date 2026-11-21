"""The local "Test assistant" page for the video's relay segment (60 section 6.2).

A plain page on 127.0.0.1 that runs the same loop as the bench against the Sieve connector
and shows the user message, a "Using the Sieve connector" line, and the reply. It shows no
other product's interface. Nothing is stored: each question runs with an in-memory log.

`/ask` spends the model quota and reaches the connector, so it takes only same-origin requests from this
page: `Content-Type: application/json` (a cross-site form or a "simple" fetch cannot send it without a
preflight, which this server never answers), a Host header naming 127.0.0.1 or localhost on this port
(no DNS rebinding), and an Origin, when there is one, on the same host and port.
"""

from __future__ import annotations

import json
import re
from typing import Any

import anyio
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from .agent import AdapterFactory, Limits, Task, run_task
from .log import MemoryTranscript
from .mcp_client import connect

MAX_QUESTION_CHARS = 500
_LOCAL_HOST = re.compile(r"(127\.0\.0\.1|localhost)(?::(\d{1,5}))?")
_LOCAL_ORIGIN = re.compile(r"http://(127\.0\.0\.1|localhost)(?::(\d{1,5}))?")


def _is_local(pattern: re.Pattern[str], value: str | None, port: int | None) -> bool:
    """value names 127.0.0.1 or localhost, on `port` when one is given."""
    m = pattern.fullmatch((value or "").strip().lower())
    if not m:
        return False
    return port is None or (m.group(2) is not None and int(m.group(2)) == port)


def ask_refusal(headers: Any, port: int | None) -> tuple[int, str] | None:
    """Why /ask turns a request away (status, message), or None when it may run."""
    if not _is_local(_LOCAL_HOST, headers.get("host"), port):
        return 403, "This test page answers only on 127.0.0.1 or localhost."
    origin = headers.get("origin")
    if origin is not None and not _is_local(_LOCAL_ORIGIN, origin, port):
        return 403, "Requests from other sites are not accepted."
    if (headers.get("content-type") or "").split(";")[0].strip().lower() != "application/json":
        return 415, "Send JSON with a question (Content-Type: application/json)."
    return None
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
}

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test assistant</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #ffffff; color: #1f2328; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .caption { color: #57606a; font-size: 13px; margin: 0 0 24px; }
  .msg { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 14px; margin: 12px 0; white-space: pre-wrap; }
  .user { background: #f6f8fa; }
  .tool { color: #57606a; font-size: 14px; margin: 4px 2px; }
  form { display: flex; gap: 8px; margin-top: 20px; }
  textarea { flex: 1; font: inherit; padding: 10px; border: 1px solid #d0d7de; border-radius: 8px; min-height: 48px; }
  button { font: inherit; padding: 0 18px; border-radius: 8px; border: 1px solid #1f2328; background: #1f2328; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<main>
  <h1>Test assistant</h1>
  <p class="caption">Local test setup, sample data</p>
  <div id="log" aria-live="polite"></div>
  <form id="ask">
    <textarea id="q" maxlength="500" required aria-label="Message" placeholder="Ask about the sample data"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
</main>
<script src="/app.js"></script>
</body>
</html>
"""

APP_JS = """'use strict';
const log = document.getElementById('log');
const form = document.getElementById('ask');
const input = document.getElementById('q');
const send = document.getElementById('send');
function add(cls, text) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  log.appendChild(div);
  return div;
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  send.disabled = true;
  add('msg user', question);
  const tool = add('tool', 'Using the Sieve connector');
  const reply = add('msg', '...');
  try {
    const r = await fetch('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const data = await r.json();
    reply.textContent = data.reply || data.error || 'No reply.';
    if (!data.used_connector) tool.remove();
  } catch (err) {
    reply.textContent = 'The test assistant could not reach its local server.';
  } finally {
    send.disabled = false;
    input.focus();
  }
});
"""


def build_app(
    *, url: str, adapter_factory: AdapterFactory, limits: Limits | None = None, connect_fn: Any = connect, port: int | None = None
) -> Starlette:
    """`port`: the port the page is served on; Host and Origin must name it (None accepts any port, for tests)."""
    limits = limits or Limits()
    counter = {"n": 0}

    async def page(request: Request) -> Response:
        return HTMLResponse(PAGE, headers=SECURITY_HEADERS)

    async def app_js(request: Request) -> Response:
        return Response(APP_JS, media_type="text/javascript", headers=SECURITY_HEADERS)

    async def ask(request: Request) -> Response:
        refused = ask_refusal(request.headers, port)
        if refused:
            return JSONResponse({"error": refused[1]}, status_code=refused[0], headers=SECURITY_HEADERS)
        try:
            body = json.loads(await request.body())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JSONResponse({"error": "Send JSON with a question."}, status_code=400, headers=SECURITY_HEADERS)
        question = str((body or {}).get("question", "")).strip() if isinstance(body, dict) else ""
        if not 1 <= len(question) <= MAX_QUESTION_CHARS:
            return JSONResponse({"error": "The question must be 1 to 500 characters."}, status_code=400, headers=SECURITY_HEADERS)
        counter["n"] += 1
        task = Task(id=f"D{counter['n']:02d}", question=question, item_desc="", item_id=None, category="", expect_kind="answer", expect=[])
        log = MemoryTranscript()
        try:
            async with connect_fn(url) as tools:
                end = await run_task(task, model=adapter_factory(task), tools=tools, log=log, arm="sieve", run_id="demo", limits=limits)
        except Exception:
            return JSONResponse({"error": "The Sieve connector could not be reached."}, status_code=502, headers=SECURITY_HEADERS)
        used = any(e.get("ev") == "tool_result" for e in log.events)
        reply = end.final or ("The test assistant stopped before it had a reply." if end.stopped else "No reply.")
        return JSONResponse({"reply": reply, "used_connector": used, "stopped": end.stopped}, headers=SECURITY_HEADERS)

    return Starlette(
        routes=[Route("/", page), Route("/app.js", app_js), Route("/ask", ask, methods=["POST"])],
    )


def serve(*, url: str, adapter_factory: AdapterFactory, port: int, model_id: str) -> None:
    import uvicorn

    app = build_app(url=url, adapter_factory=adapter_factory, port=port)
    print(f"Test assistant on http://127.0.0.1:{port} ({model_id}, Sieve connector from SIEVE_MCP_URL)")
    anyio.run(uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")).serve)

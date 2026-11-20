"""The baseline: a typical direct-access mail and files connector (60 section 4.6).

An MCP server built with the official MCP Python SDK (`MCPServer`, the v2 name of FastMCP),
stateless Streamable HTTP with JSON replies, on 127.0.0.1:8765 at /mcp, server name
`mail_and_files`. Search returns summaries; read returns the whole item. It models a common
connector, not any specific product, and its search is generous on purpose.

Every call appends `{ts, run, tool, args, result_chars, item_ids}` to the server log
(`BENCH_SERVER_LOG`, read on every call). `run` is the value of the `X-Bench-Run` request
header that the runner sends, so the runner can copy exactly its own lines into the run folder.
"""

from __future__ import annotations

import base64
import json
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import Context, MCPServer
from mcp.types import CallToolResult, ImageContent, TextContent

from . import DEFAULT_BASELINE_PORT, __version__, server_log_path
from .dataset import Dataset, Item, normalize_id, snippet
from .textsearch import BM25Index, Doc

SERVER_NAME = "mail_and_files"
RUN_HEADER = "x-bench-run"
MAX_RESULTS_MIN = 1
MAX_RESULTS_MAX = 25

DESCRIPTIONS = {
    "search_mail": (
        "Search the user's email. Returns matching messages, best match first, with id, sender, "
        "recipient, date, subject and a snippet."
    ),
    "read_mail": "Read one email in full.",
    "search_files": "Search the user's files (documents and photos) by name and content.",
    "read_file": "Read one file. Documents return their text; photos return the image.",
}
TOOL_NAMES = tuple(DESCRIPTIONS)
NOT_FOUND = {"error": "not found"}


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def clamp(n: Any, default: int = 10) -> int:
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = default
    return max(MAX_RESULTS_MIN, min(MAX_RESULTS_MAX, n))


class ServerLog:
    """Appends one JSON line per tool call. The path is resolved on every call."""

    def __init__(self, path: Callable[[], Path] | Path | None = None):
        self._path = path if path is not None else server_log_path
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path() if callable(self._path) else self._path

    def write(self, *, tool: str, args: dict, result_chars: int, item_ids: list[str], run: str | None) -> None:
        line = {
            "ts": int(time.time() * 1000),
            "run": run,
            "tool": tool,
            "args": args,
            "result_chars": result_chars,
            "item_ids": item_ids,
        }
        path = self.path
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")


class Baseline:
    """The connector's behaviour, independent of the MCP plumbing (easy to test directly)."""

    def __init__(self, dataset: Dataset):
        self.dataset = dataset
        self.mail_index = BM25Index(
            Doc(i.id, f"{i.sender or ''} {i.title} {i.text}", i.date) for i in dataset.emails
        )
        # Photos are matched by file name only: a plain connector has no captions.
        self.file_index = BM25Index(
            Doc(i.id, i.title if i.kind == "photo" else f"{i.title} {i.text}", i.date) for i in dataset.files
        )

    def search_mail(self, query: str, max_results: int = 10) -> tuple[str, list[str]]:
        hits = self.mail_index.search(query, clamp(max_results))
        messages = []
        for hit in hits:
            item = self.dataset.get(hit.id)
            assert item is not None
            messages.append(
                {
                    "id": item.id,
                    "from": item.sender,
                    "to": item.to,
                    "date": item.date,
                    "subject": item.title,
                    "snippet": snippet(item.text),
                }
            )
        return dumps({"messages": messages}), [m["id"] for m in messages]

    def read_mail(self, id: str) -> tuple[str, list[str]]:
        item = self._get(id, "email")
        if item is None:
            return dumps(NOT_FOUND), []
        body = {"id": item.id, "from": item.sender, "to": item.to, "date": item.date, "subject": item.title, "body": item.text}
        return dumps(body), [item.id]

    def search_files(self, query: str, max_results: int = 10) -> tuple[str, list[str]]:
        hits = self.file_index.search(query, clamp(max_results))
        files = []
        for hit in hits:
            item = self.dataset.get(hit.id)
            assert item is not None
            files.append(
                {"id": item.id, "name": item.title, "mime": item.mime, "modified": item.date, "size_bytes": item.size_bytes()}
            )
        return dumps({"files": files}), [f["id"] for f in files]

    def read_file(self, id: str) -> tuple[list[TextContent | ImageContent], list[str]]:
        item = self._get(id, "document", "photo")
        if item is None:
            return [TextContent(type="text", text=dumps(NOT_FOUND))], []
        if item.kind == "photo":
            # The original bytes, metadata intact, as a plain file connector would send them.
            data = base64.b64encode(item.file_bytes()).decode("ascii")
            meta = dumps({"id": item.id, "name": item.title, "mime": item.mime})
            return [
                ImageContent(type="image", data=data, mime_type=item.mime or "application/octet-stream"),
                TextContent(type="text", text=meta),
            ], [item.id]
        text = dumps({"id": item.id, "name": item.title, "mime": item.mime, "text": item.text})
        return [TextContent(type="text", text=text)], [item.id]

    def _get(self, id: str, *kinds: str) -> Item | None:
        item = self.dataset.get(normalize_id(id)) if isinstance(id, str) else None
        return item if item is not None and item.kind in kinds else None


def text_chars(content: list[Any]) -> int:
    """Characters of the text the model receives: text items joined with a newline."""
    texts = [c.text for c in content if isinstance(c, TextContent)]
    return len("\n".join(texts))


def build_server(dataset: Dataset, log: ServerLog | None = None) -> MCPServer:
    baseline = Baseline(dataset)
    log = log or ServerLog()
    server = MCPServer(SERVER_NAME, version=__version__)

    def run_id(ctx: Context | None) -> str | None:
        try:
            headers = ctx.headers if ctx is not None else None
        except ValueError:
            return None
        if not headers:
            return None
        value = headers.get(RUN_HEADER) or headers.get(RUN_HEADER.title())
        return value or None

    def finish(tool: str, args: dict, content: list[Any], ids: list[str], ctx: Context | None) -> CallToolResult:
        log.write(tool=tool, args=args, result_chars=text_chars(content), item_ids=ids, run=run_id(ctx))
        return CallToolResult(content=content)

    @server.tool(name="search_mail", description=DESCRIPTIONS["search_mail"], structured_output=False)
    def search_mail(query: str, ctx: Context, max_results: int = 10) -> CallToolResult:
        text, ids = baseline.search_mail(query, max_results)
        return finish("search_mail", {"query": query, "max_results": max_results}, [TextContent(type="text", text=text)], ids, ctx)

    @server.tool(name="read_mail", description=DESCRIPTIONS["read_mail"], structured_output=False)
    def read_mail(id: str, ctx: Context) -> CallToolResult:
        text, ids = baseline.read_mail(id)
        return finish("read_mail", {"id": id}, [TextContent(type="text", text=text)], ids, ctx)

    @server.tool(name="search_files", description=DESCRIPTIONS["search_files"], structured_output=False)
    def search_files(query: str, ctx: Context, max_results: int = 10) -> CallToolResult:
        text, ids = baseline.search_files(query, max_results)
        return finish("search_files", {"query": query, "max_results": max_results}, [TextContent(type="text", text=text)], ids, ctx)

    @server.tool(name="read_file", description=DESCRIPTIONS["read_file"], structured_output=False)
    def read_file(id: str, ctx: Context) -> CallToolResult:
        content, ids = baseline.read_file(id)
        return finish("read_file", {"id": id}, content, ids, ctx)

    return server


def serve(dataset: Dataset, *, host: str = "127.0.0.1", port: int = DEFAULT_BASELINE_PORT, log: ServerLog | None = None) -> None:
    server = build_server(dataset, log)
    server.run("streamable-http", host=host, port=port, streamable_http_path="/mcp", json_response=True, stateless_http=True)


def http_app(dataset: Dataset, *, host: str = "127.0.0.1", log: ServerLog | None = None):
    """The Starlette app, for tests that run the server in a thread."""
    server = build_server(dataset, log)
    return server.streamable_http_app(streamable_http_path="/mcp", json_response=True, stateless_http=True, host=host)

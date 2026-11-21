"""Connect, list tools, call a tool, return a ToolOutcome (60 section 4.9.1).

The runner is its own MCP client (official MCP Python SDK, Streamable HTTP), so every tool
result is logged exactly as the model receives it. The same client talks to the baseline and
to Sieve's MCP endpoint (30 section 8: stateless JSON over POST, legacy and 2026-07-28 eras).
The SDK negotiates the era (`server/discover`, falling back to `initialize`).
"""

from __future__ import annotations

import base64
import json
import time
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError
from mcp.types import CallToolResult, ImageContent, TextContent

from .agent import ToolSpec

# Sieve holds a tool call open for up to 55 s (30 section 9.6); leave room for that.
DEFAULT_TIMEOUT_SECONDS = 120.0
_DROPPED_SCHEMA_KEYS = ("$schema", "title", "additionalProperties")


@dataclass
class ToolOutcome:
    text: str                                   # the MCP result's text items joined with "\n"
    images: list[tuple[bytes, str]] = field(default_factory=list)   # (data, mime type)
    structured: dict | None = None              # structuredContent, logged but never sent to the model
    is_error: bool = False
    ms: int = 0


def clean_schema(schema: Any) -> Any:
    """The tool's inputSchema with `$schema`, `title` and `additionalProperties` removed, recursively.

    Only schema keywords are removed: a property that happens to be called `title` stays.
    """
    if isinstance(schema, list):
        return [clean_schema(s) for s in schema]
    if not isinstance(schema, Mapping):
        return schema
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key in _DROPPED_SCHEMA_KEYS:
            continue
        if key in ("properties", "patternProperties", "$defs", "definitions") and isinstance(value, Mapping):
            out[key] = {name: clean_schema(sub) for name, sub in value.items()}
        else:
            out[key] = clean_schema(value)
    return out


def tool_specs(tools: list[Any]) -> list[ToolSpec]:
    specs: list[ToolSpec] = []
    for t in tools:
        params = clean_schema(t.input_schema or {"type": "object", "properties": {}})
        specs.append(ToolSpec(name=t.name, description=t.description or "", parameters=params))
    return specs


def outcome_from_result(result: CallToolResult, ms: int) -> ToolOutcome:
    texts: list[str] = []
    images: list[tuple[bytes, str]] = []
    for block in result.content:
        if isinstance(block, TextContent):
            texts.append(block.text)
        elif isinstance(block, ImageContent):
            images.append((base64.b64decode(block.data), block.mime_type))
    structured = result.structured_content if isinstance(result.structured_content, dict) else None
    return ToolOutcome(text="\n".join(texts), images=images, structured=structured, is_error=bool(result.is_error), ms=ms)


def sieve_fields(outcome: ToolOutcome) -> dict[str, Any]:
    """Sieve's ToolResult (01 section 7): from structuredContent, or from the text block, which
    carries the same JSON (servers on 2025-03-26 send no structuredContent)."""
    if outcome.structured is not None:
        return outcome.structured
    try:
        data = json.loads(outcome.text)
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


# Sieve's per-connection rate limit (30 section 11) comes back as status "error" with this message
# (functions/sieve/tools.py MSG_RATE_LIMITED), so the status alone does not show it.
RATE_LIMITED_PREFIX = "Too many requests from this connection"


def is_rate_limited(fields: Mapping[str, Any]) -> bool:
    """True for Sieve's rate-limited result: status "error" and the rate-limit message."""
    if not isinstance(fields, Mapping):
        return False
    message = fields.get("message")
    return fields.get("status") == "error" and isinstance(message, str) and message.strip().startswith(RATE_LIMITED_PREFIX)


class McpTools:
    """The tool box the loop uses: `list_tools()` and `call(name, args)`."""

    def __init__(self, client: Client):
        self._client = client

    @property
    def protocol_version(self) -> str | None:
        try:
            return self._client.protocol_version
        except Exception:
            return None

    async def list_tools(self) -> list[ToolSpec]:
        result = await self._client.list_tools()
        return tool_specs(list(result.tools))

    async def call(self, name: str, args: dict) -> ToolOutcome:
        t0 = time.monotonic()
        try:
            result = await self._client.call_tool(name, args)
        except MCPError as e:
            # A protocol-level error (for example an unknown tool). The model gets this text.
            ms = int((time.monotonic() - t0) * 1000)
            return ToolOutcome(text=f"Error: {e.error.message}", is_error=True, ms=ms)
        ms = int((time.monotonic() - t0) * 1000)
        return outcome_from_result(result, ms)


@asynccontextmanager
async def connect(
    url: str, *, headers: Mapping[str, str] | None = None, timeout: float = DEFAULT_TIMEOUT_SECONDS
) -> AsyncIterator[McpTools]:
    """Open one MCP connection over Streamable HTTP. No Origin header is sent (MCP clients on servers send none)."""
    http = httpx2.AsyncClient(
        headers=dict(headers or {}),
        timeout=httpx2.Timeout(30.0, read=timeout),
        follow_redirects=False,
    )
    async with http:
        transport = streamable_http_client(url, http_client=http)
        async with Client(transport, read_timeout_seconds=timeout, cache=None) as client:
            yield McpTools(client)


@asynccontextmanager
async def connect_in_process(server: Any) -> AsyncIterator[McpTools]:
    """In-process connection to an `MCPServer`, for tests."""
    async with Client(server, cache=None) as client:
        yield McpTools(client)

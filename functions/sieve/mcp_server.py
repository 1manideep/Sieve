"""The MCP endpoint: stateless JSON Streamable HTTP, both eras (30 section 8).

Legacy clients (initialize handshake; 2025-03-26, 2025-06-18, 2025-11-25) and modern clients (2026-07-28,
per-request _meta, server/discover) are served by one POST handler. Every reply is one JSON object;
no session id is ever issued.
"""
from __future__ import annotations

import base64
import binascii
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping

import flask

from . import authz, config, fb, logs, push, ratelimit, relay, tools
from .links import extract_link_secret, link_hash
from .models import GrantMeta, ToolResult

META_VERSION = "io.modelcontextprotocol/protocolVersion"
META_CAPS = "io.modelcontextprotocol/clientCapabilities"
META_SERVER_INFO = "io.modelcontextprotocol/serverInfo"
SERVER_INFO = {"name": config.SERVER_NAME, "title": config.SERVER_TITLE, "version": config.SERVER_VERSION}
CAPABILITIES = {"tools": {"listChanged": False}}
KNOWN_METHODS = frozenset({"initialize", "ping", "tools/list", "tools/call", "server/discover"})
_MISSING = object()


@dataclass
class Deps:
    db: Any                                            # google.cloud.firestore.Client
    presence: Callable[[str], Mapping[str, Any] | None]
    push: Any                                          # push.PushSender
    secret: Callable[[], bytes]
    wait_seconds: Callable[[], int]
    now: Callable[[], Any]
    monotonic: Callable[[], float]
    sleep: Callable[[float], None] = time.sleep


@dataclass
class Reply:
    status: int
    body: dict | None
    headers: dict[str, str] = field(default_factory=dict)


def default_deps() -> Deps:
    db = fb.db()
    return Deps(db=db, presence=fb.read_presence, push=push.sender_from_config(db), secret=config.broker_secret_bytes,
                wait_seconds=config.relay_wait_seconds, now=fb.now, monotonic=time.monotonic, sleep=time.sleep)


def to_flask(reply: Reply) -> flask.Response:
    data = json.dumps(reply.body, ensure_ascii=False).encode("utf-8") if reply.body is not None else b""
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", **reply.headers}
    return flask.Response(data, status=reply.status, headers=headers)


# ---------- JSON-RPC helpers ----------

def _error(code: int, message: str, msg_id: Any = _MISSING, data: Any = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    body: dict[str, Any] = {"jsonrpc": "2.0"}
    if msg_id is not _MISSING:
        body["id"] = msg_id
    body["error"] = err
    return body


def _result(msg_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _modern(result: dict[str, Any]) -> dict[str, Any]:
    return {"resultType": "complete", **result, "_meta": {META_SERVER_INFO: SERVER_INFO}}


def _valid_id(value: Any) -> bool:
    return isinstance(value, (str, int)) and not isinstance(value, bool)


# ---------- era ----------

def decode_header_value(value: str) -> str | None:
    """'=?base64?<b64>?=' -> base64-decoded UTF-8 (None if it does not decode); other values as-is."""
    if value.startswith("=?base64?") and value.endswith("?="):
        try:
            return base64.b64decode(value[len("=?base64?"):-2], validate=True).decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError):
            return None
    return value


def _meta(msg: Mapping[str, Any]) -> Mapping[str, Any]:
    params = msg.get("params")
    meta = params.get("_meta") if isinstance(params, Mapping) else None
    return meta if isinstance(meta, Mapping) else {}


def classify(msg: Mapping[str, Any], headers: Any) -> Literal["modern", "legacy"]:
    if msg.get("method") == "initialize":
        return "legacy"
    if META_VERSION in _meta(msg) or headers.get("MCP-Protocol-Version") in config.MODERN_VERSIONS:
        return "modern"
    return "legacy"


def validate_modern(msg: Mapping[str, Any], headers: Any) -> Reply | None:
    msg_id = msg.get("id", _MISSING)
    meta = _meta(msg)
    version = meta.get(META_VERSION)
    if version is None:
        return Reply(400, _error(-32602, f"Missing {META_VERSION} in _meta", msg_id))
    if version not in config.MODERN_VERSIONS:
        return Reply(400, _error(-32022, "Unsupported protocol version", msg_id,
                                 {"supported": list(config.MODERN_VERSIONS), "requested": version}))
    if not isinstance(meta.get(META_CAPS), Mapping):
        return Reply(400, _error(-32602, f"Missing {META_CAPS} in _meta", msg_id))
    if headers.get("MCP-Protocol-Version") != version:
        return Reply(400, _error(-32020, "Header mismatch: MCP-Protocol-Version", msg_id))
    if headers.get("Mcp-Method") != msg.get("method"):
        return Reply(400, _error(-32020, "Header mismatch: Mcp-Method", msg_id))
    if msg.get("method") == "tools/call":
        params = msg.get("params") if isinstance(msg.get("params"), Mapping) else {}
        raw = headers.get("Mcp-Name")
        name = decode_header_value(raw) if isinstance(raw, str) else None
        if name is None or name != params.get("name"):
            return Reply(400, _error(-32020, "Header mismatch: Mcp-Name", msg_id))
    return None


def validate_legacy(msg: Mapping[str, Any], headers: Any) -> tuple[str, Reply | None]:
    header = headers.get("MCP-Protocol-Version")
    if header is None:
        return config.HEADERLESS_LEGACY_VERSION, None
    if header in config.LEGACY_VERSIONS:
        return header, None
    return header, Reply(400, _error(-32600, "Unsupported MCP-Protocol-Version", msg.get("id", _MISSING)))


# ---------- the handler ----------

def handle_http(req: flask.Request, deps: Deps | None = None) -> flask.Response:
    t0 = time.monotonic() if deps is None else deps.monotonic()
    era, version, method = "none", "none", "none"
    reply: Reply
    try:
        reply, era, version, method = _handle(req, deps, t0)
    except Exception as exc:  # noqa: BLE001 - never a stack trace or input on the wire
        logs.log_exception("mcp_error", exc)
        reply = Reply(200, _error(-32603, "Internal error"))
    now_mono = time.monotonic() if deps is None else deps.monotonic()
    logs.log_event("mcp_http", era=era, version=version, method=method, http=reply.status,
                   ms=int((now_mono - t0) * 1000))
    return to_flask(reply)


def _read_body(req: flask.Request) -> bytes | None:
    if req.content_length is not None and req.content_length > config.MAX_BODY_BYTES:
        return None
    raw = req.stream.read(config.MAX_BODY_BYTES + 1)
    return None if len(raw) > config.MAX_BODY_BYTES else raw


def _handle(req: flask.Request, deps: Deps | None, t0: float) -> tuple[Reply, str, str, str]:
    if req.method != "POST":
        return Reply(405, None, {"Allow": "POST"}), "none", "none", "none"
    origin = req.headers.get("Origin")
    if origin is not None and origin not in config.APP_ORIGINS:
        return Reply(403, _error(-32600, "Origin not allowed")), "none", "none", "none"
    secret = extract_link_secret(req.path)
    if secret is None:
        return Reply(404, {"error": "unknown_connector"}), "none", "none", "none"
    deps = deps or default_deps()
    lh = link_hash(secret)
    connector_snap = deps.db.collection("connectors").document(lh).get()
    if not connector_snap.exists:
        return Reply(404, {"error": "unknown_connector"}), "none", "none", "none"
    raw = _read_body(req)
    if raw is None:
        return Reply(413, None), "none", "none", "none"
    if req.mimetype != "application/json":
        return Reply(415, None), "none", "none", "none"
    try:
        msg = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return Reply(400, _error(-32700, "Parse error")), "none", "none", "none"
    if isinstance(msg, list):
        return Reply(400, _error(-32600, "Batching is not supported")), "none", "none", "none"
    if not isinstance(msg, dict):
        return Reply(400, _error(-32600, "Invalid Request")), "none", "none", "none"
    if "method" not in msg and ("result" in msg or "error" in msg):
        return Reply(202, None), "none", "none", "response"
    msg_id = msg.get("id", _MISSING)
    if (msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str)
            or (msg_id is not _MISSING and not _valid_id(msg_id))):
        echo = msg_id if msg_id is not _MISSING and _valid_id(msg_id) else _MISSING
        return Reply(400, _error(-32600, "Invalid Request", echo)), "none", "none", "none"
    method = msg["method"]
    log_method = method if method in KNOWN_METHODS else ("notification" if method.startswith("notifications/")
                                                          else "other")
    if msg_id is _MISSING:
        return Reply(202, None), "none", "none", log_method      # notifications get no response

    era = classify(msg, req.headers)
    if era == "modern":
        failure = validate_modern(msg, req.headers)
        version = str(_meta(msg).get(META_VERSION, "none"))[:20]
        if failure is not None:
            return failure, era, version, log_method
    else:
        version, failure = validate_legacy(msg, req.headers)
        if failure is not None:
            return failure, era, "invalid", log_method
    connector = connector_snap.to_dict() or {}
    reply = _dispatch(msg, era=era, version=version, link_secret=secret, link_hash=lh, connector=connector,
                      deps=deps, t0=t0)
    return reply, era, version, log_method


def _grant_for_list(deps: Deps, connector: Mapping[str, Any]) -> GrantMeta | None:
    snap = deps.db.collection(f"users/{connector.get('uid')}/grants").document(str(connector.get("grantId"))).get()
    if not snap.exists:
        return None
    try:
        return GrantMeta.model_validate(snap.to_dict() or {})
    except Exception:  # noqa: BLE001
        return None


def _step_for_list(deps: Deps, connector: Mapping[str, Any]) -> str:
    """The grant's current cap for tools/list and the instructions; 'answer' (the least) when unreadable."""
    grant = _grant_for_list(deps, connector)
    return grant.max_step if grant else "answer"


def _dispatch(msg: Mapping[str, Any], *, era: str, version: str, link_secret: str, link_hash: str,
              connector: Mapping[str, Any], deps: Deps, t0: float) -> Reply:
    method = msg["method"]
    msg_id = msg["id"]
    try:
        if method == "initialize" and era == "legacy":
            params = msg.get("params") if isinstance(msg.get("params"), Mapping) else {}
            requested = params.get("protocolVersion")
            negotiated = requested if requested in config.LEGACY_VERSIONS else config.LATEST_LEGACY_VERSION
            text = tools.instructions(deps.now().date(), _step_for_list(deps, connector))
            return Reply(200, _result(msg_id, {"protocolVersion": negotiated, "capabilities": CAPABILITIES,
                                               "serverInfo": SERVER_INFO, "instructions": text}))
        if method == "server/discover" and era == "modern":
            text = tools.instructions(deps.now().date(), _step_for_list(deps, connector))
            return Reply(200, _result(msg_id, _modern({
                "supportedVersions": list(config.MODERN_VERSIONS), "capabilities": CAPABILITIES,
                "instructions": text, "ttlMs": 300000, "cacheScope": "private"})))
        if method == "ping":
            return Reply(200, _result(msg_id, _modern({}) if era == "modern" else {}))
        if method == "tools/list":
            listed = tools.tools_for_step(_step_for_list(deps, connector), version=version)
            if era == "modern":
                return Reply(200, _result(msg_id, _modern({"tools": listed, "ttlMs": 60000,
                                                           "cacheScope": "private"})))
            return Reply(200, _result(msg_id, {"tools": listed}))
        if method == "tools/call":
            return call_tool(msg, era=era, version=version, link_secret=link_secret, link_hash=link_hash,
                             deps=deps, t0=t0)
    except Exception as exc:  # noqa: BLE001
        logs.log_exception("mcp_dispatch_error", exc)
        return Reply(200, _error(-32603, "Internal error", msg_id))
    return Reply(404 if era == "modern" else 200, _error(-32601, "Method not found", msg_id))


def _tool_reply(msg_id: Any, result: ToolResult, *, era: str, version: str) -> Reply:
    body = tools.call_tool_result(result, era=era, version=version)
    return Reply(200, _result(msg_id, _modern(body) if era == "modern" else body))


def _give_back(deps: Deps, link_hash: str, weight: float, grant_id: str) -> None:
    try:
        ratelimit.refund(deps.db, link_hash, weight, deps.now())
    except Exception as exc:  # noqa: BLE001 - a failed refund only leaves the call counted
        logs.log_exception("rate_refund_error", exc, grant=grant_id)


def call_tool(msg: Mapping[str, Any], *, era: str, version: str, link_secret: str, link_hash: str,
              deps: Deps, t0: float) -> Reply:
    msg_id = msg["id"]
    params = msg.get("params")
    params = params if isinstance(params, Mapping) else {}
    name = params.get("name")
    arguments = params.get("arguments", {})
    if arguments is None:
        arguments = {}
    if not isinstance(name, str) or not 1 <= len(name) <= 128 or not isinstance(arguments, Mapping):
        return Reply(400 if era == "modern" else 200, _error(-32602, "Invalid params", msg_id))
    known = name in config.MCP_TOOLS.values()
    log_tool = name if known else "unknown"
    reason = "none"
    waited_ms = 0
    weight = ratelimit.call_weight(name)

    def done(result: ToolResult) -> Reply:
        if result.refused and adm.allowed:      # 30 section 11: a refused call is given back to the limit
            _give_back(deps, link_hash, weight, grant_id)
        logs.log_event("tool_call", grant=grant_id, tool=log_tool, reason=reason, status=result.status,
                       ms=int((deps.monotonic() - t0) * 1000), waited_ms=waited_ms)
        return _tool_reply(msg_id, result, era=era, version=version)

    adm = ratelimit.admit(deps.db, link_hash, deps.now(), weight=weight)
    if adm is None:
        return Reply(404, {"error": "unknown_connector"})
    connector = adm.connector
    uid = str(connector.get("uid"))
    grant_id = str(connector.get("grantId"))
    if not adm.allowed:
        reason = "RATE_LIMITED"
        return done(tools.rate_limited_result(adm.retry_after_seconds))

    out = authz.authorize_call(deps.db, secret=deps.secret(), uid=uid, link_hash=link_hash, connector=connector,
                               link_secret=link_secret, tool_name=name, args=dict(arguments))
    reason = out.reason_code
    if not known:
        logs.log_event("tool_call", grant=grant_id, tool=log_tool, reason=reason, status="unknown-tool",
                       ms=int((deps.monotonic() - t0) * 1000), waited_ms=0)
        return Reply(200, _error(-32602, f"Unknown tool: {name}", msg_id))
    if not out.allowed:
        return done(tools.result_for_denial(out.reason_code, adm.grant))
    grant = adm.grant
    if grant is None or grant.revoked_at is not None:
        return done(tools.result_for_denial("REVOKED", grant))

    try:
        if name == config.MCP_TOOLS["check"]:
            request_id = tools.parse_check_args(arguments)
        else:
            ladder = tools.parse_ladder_args(arguments, today=deps.now().date())
    except tools.ArgError as exc:
        return done(tools.error_result(str(exc), refused=True))

    ctx = relay.CallCtx(uid=uid, grant_id=grant_id, link_hash=link_hash, grant=grant)
    started = deps.monotonic()
    try:
        if name == config.MCP_TOOLS["check"]:
            result = relay.handle_check(deps, ctx, request_id, t0=t0)
        else:
            result = relay.handle_ladder_tool(deps, ctx, tool=name, args=ladder, t0=t0)
    except Exception as exc:  # noqa: BLE001
        logs.log_exception("relay_error", exc, grant=grant_id)
        result = tools.error_result(tools.MSG_INTERNAL)
    waited_ms = int((deps.monotonic() - started) * 1000)
    return done(result)

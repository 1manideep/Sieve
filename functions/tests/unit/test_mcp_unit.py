"""U7, U8, U10: era classification, the HTTP checks with stub deps, and tool lists per step."""
import base64
import json
import time
from datetime import datetime, timezone

import flask
from werkzeug.datastructures import Headers

from sieve import links, mcp_server, tools
from tests.helpers.fakes import FakeDb

META = {"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}}


def _msg(method, params=None, msg_id=1):
    return {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}}


def _modern_headers(method, name=None, version="2026-07-28"):
    h = Headers({"MCP-Protocol-Version": version, "Mcp-Method": method})
    if name is not None:
        h["Mcp-Name"] = name
    return h


def test_u7_classify_and_validate_modern():
    assert mcp_server.classify(_msg("initialize", {"_meta": META}), Headers()) == "legacy"
    assert mcp_server.classify(_msg("tools/list", {"_meta": META}), Headers()) == "modern"
    assert mcp_server.classify(_msg("tools/list"), Headers({"MCP-Protocol-Version": "2026-07-28"})) == "modern"
    assert mcp_server.classify(_msg("tools/list"), Headers({"MCP-Protocol-Version": "2025-11-25"})) == "legacy"

    ok = _msg("tools/call", {"name": "sieve_answer", "arguments": {}, "_meta": META})
    assert mcp_server.validate_modern(ok, _modern_headers("tools/call", "sieve_answer")) is None
    bad_method = mcp_server.validate_modern(ok, _modern_headers("tools/list", "sieve_answer"))
    assert bad_method.status == 400 and bad_method.body["error"]["code"] == -32020
    encoded = "=?base64?" + base64.b64encode(b"sieve_answer").decode() + "?="
    assert mcp_server.validate_modern(ok, _modern_headers("tools/call", encoded)) is None
    bad_name = mcp_server.validate_modern(ok, _modern_headers("tools/call", "other"))
    assert bad_name.body["error"]["code"] == -32020 and "Mcp-Name" in bad_name.body["error"]["message"]

    future = _msg("tools/list", {"_meta": {**META, "io.modelcontextprotocol/protocolVersion": "2027-01-01"}})
    r = mcp_server.validate_modern(future, _modern_headers("tools/list", version="2027-01-01"))
    assert r.body["error"]["code"] == -32022
    assert r.body["error"]["data"] == {"supported": ["2026-07-28"], "requested": "2027-01-01"}

    no_caps = _msg("tools/list", {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}})
    assert mcp_server.validate_modern(no_caps, _modern_headers("tools/list")).body["error"]["code"] == -32602
    assert mcp_server.decode_header_value("=?base64?!!!?=") is None


def _deps(db):
    return mcp_server.Deps(db=db, presence=lambda uid: None, push=None, secret=lambda: b"k" * 32,
                           wait_seconds=lambda: 6, now=lambda: datetime(2026, 11, 16, tzinfo=timezone.utc),
                           monotonic=time.monotonic, sleep=lambda s: None)


def _db_with_connector(secret):
    db = FakeDb()
    db.collection("connectors").document(links.link_hash(secret)).set({"uid": "u1", "grantId": "G" * 20,
                                                                         "token": "x"})
    return db


def _post(path, body=None, *, method="POST", headers=None, raw=None, deps=None):
    app = flask.Flask("t")
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
    h = {"Content-Type": "application/json", **(headers or {})}
    with app.test_request_context(path, method=method, data=data, headers=h):
        return mcp_server.handle_http(flask.request, deps)


def test_u8_http_checks():
    secret = links.new_link_secret()
    deps = _deps(_db_with_connector(secret))
    path = f"/{secret}"

    r = _post(path, method="GET", deps=deps)
    assert r.status_code == 405 and r.headers["Allow"] == "POST" and r.get_data() == b""
    r = _post(path, _msg("ping"), headers={"Origin": "https://evil.example"}, deps=deps)
    assert r.status_code == 403 and r.get_json()["error"]["message"] == "Origin not allowed"
    r = _post(f"/{links.new_link_secret()}", _msg("ping"), deps=deps)
    assert r.status_code == 404 and r.get_json() == {"error": "unknown_connector"}
    r = _post("/mcp/abc", _msg("ping"), deps=deps)
    assert r.status_code == 404
    r = _post(path, raw=b"x" * 17_000, deps=deps)
    assert r.status_code == 413
    r = _post(path, _msg("ping"), headers={"Content-Type": "text/plain"}, deps=deps)
    assert r.status_code == 415
    r = _post(path, [_msg("ping")], deps=deps)
    assert r.status_code == 400 and r.get_json()["error"]["message"] == "Batching is not supported"
    r = _post(path, raw=b"{not json", deps=deps)
    assert r.status_code == 400 and r.get_json()["error"]["code"] == -32700
    r = _post(path, {"jsonrpc": "2.0", "id": None, "method": "ping"}, deps=deps)
    assert r.status_code == 400 and r.get_json()["error"]["code"] == -32600
    r = _post(path, {"jsonrpc": "2.0", "method": "notifications/initialized"}, deps=deps)
    assert r.status_code == 202 and r.get_data() == b""
    r = _post(path, {"jsonrpc": "2.0", "id": 3, "result": {}}, deps=deps)
    assert r.status_code == 202
    r = _post(path, _msg("resources/list", {"_meta": META}), headers=dict(_modern_headers("resources/list")),
              deps=deps)
    assert r.status_code == 404 and r.get_json()["error"]["code"] == -32601
    r = _post(path, _msg("resources/list"), deps=deps)
    assert r.status_code == 200 and r.get_json()["error"]["code"] == -32601
    r = _post(path, _msg("ping"), headers={"MCP-Protocol-Version": "1999-01-01"}, deps=deps)
    assert r.status_code == 400 and r.get_json()["error"]["message"] == "Unsupported MCP-Protocol-Version"
    r = _post(path, _msg("ping"), headers={"Origin": "https://sieve.manideep.info"}, deps=deps)
    assert r.status_code == 200 and r.get_json()["result"] == {}
    r = _post(path, _msg("initialize", {"protocolVersion": "2025-06-18"}), deps=deps)
    body = r.get_json()["result"]
    assert body["protocolVersion"] == "2025-06-18" and body["serverInfo"]["name"] == "sieve"
    r = _post(path, _msg("initialize", {"protocolVersion": "2024-01-01"}), deps=deps)
    assert r.get_json()["result"]["protocolVersion"] == "2025-11-25"
    r = _post(path, _msg("server/discover", {"_meta": META}), headers=dict(_modern_headers("server/discover")),
              deps=deps)
    d = r.get_json()["result"]
    assert d["resultType"] == "complete" and d["supportedVersions"] == ["2026-07-28"] and d["cacheScope"] == "private"
    assert d["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "sieve"
    r = _post(path, _msg("server/discover"), deps=deps)
    assert r.status_code == 200 and r.get_json()["error"]["code"] == -32601
    r = _post(path, _msg("tools/list"), headers={"MCP-Protocol-Version": "2025-11-25"}, deps=deps)
    assert [t["name"] for t in r.get_json()["result"]["tools"]] == ["sieve_answer", "sieve_check"]


def test_u8_no_session_header_and_no_store():
    secret = links.new_link_secret()
    deps = _deps(_db_with_connector(secret))
    for body, headers in ((_msg("initialize", {"protocolVersion": "2025-11-25"}), {}),
                          (_msg("ping"), {}), ({"jsonrpc": "2.0", "method": "notifications/x"}, {})):
        r = _post(f"/mcp/{secret}", body, headers=headers, deps=deps)
        assert "Mcp-Session-Id" not in r.headers and r.headers["Cache-Control"] == "no-store"


def test_instructions_follow_the_grant_cap():
    """initialize, server/discover and tools/list name only the tools the grant's cap allows."""
    today = datetime(2026, 11, 16, tzinfo=timezone.utc)
    for step in ("answer", "excerpt", "full", None):
        secret = links.new_link_secret()
        db = _db_with_connector(secret)
        if step:
            db.collection("users/u1/grants").document("G" * 20).set({
                "aiName": "Test", "maxStep": step, "allowedCategories": ["Home"], "allowedSources": ["gmail"],
                "createdAt": today, "expiresAt": today, "linkHint": "abcd"})
        deps = _deps(db)
        cap = step or "answer"          # an unreadable grant gets the least
        init = _post(f"/{secret}", _msg("initialize", {"protocolVersion": "2025-11-25"}), deps=deps).get_json()
        assert init["result"]["instructions"] == tools.instructions(today.date(), cap)
        disc = _post(f"/{secret}", _msg("server/discover", {"_meta": META}),
                     headers=dict(_modern_headers("server/discover")), deps=deps).get_json()
        assert disc["result"]["instructions"] == tools.instructions(today.date(), cap)
        listed = _post(f"/{secret}", _msg("tools/list"), headers={"MCP-Protocol-Version": "2025-11-25"},
                       deps=deps).get_json()["result"]["tools"]
        assert [t["name"] for t in listed] == tools.allowed_tools(cap)
        if cap == "answer":
            readable = json.dumps(init) + json.dumps(disc) + json.dumps(listed)
            assert "sieve_excerpt" not in readable and "sieve_full_item" not in readable


def test_u10_tools_for_step():
    assert [t["name"] for t in tools.tools_for_step("answer", version="2025-11-25")] == ["sieve_answer", "sieve_check"]
    full = tools.tools_for_step("full", version="2026-07-28")
    assert [t["name"] for t in full] == ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]
    assert all({"title", "outputSchema", "annotations"} <= set(t) for t in full)
    old = tools.tools_for_step("full", version="2025-03-26")
    assert all(set(t) == {"name", "description", "inputSchema"} for t in old)

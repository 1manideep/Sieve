"""A file sent as itself, through the relay: who may ask, what the home base may hand over, and the link made."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from sieve import config, files, relay, tools
from sieve.models import GrantMeta
from tests.helpers.fakes import FakeDb

NOW = datetime(2026, 11, 22, 15, 0, tzinfo=timezone.utc)
UID = "u" * 28
REQ = "r" * 20
PATH = f"handoffs/{UID}/{REQ}/{'o' * 24}"
FILE = {"name": "Lease_2026.pdf", "mime": "application/pdf", "bytes": 182_000, "path": PATH}
TEXT = "Lease_2026.pdf (PDF, 178 KB)"


class Txn:
    """Stands in for a Firestore transaction: writes go straight to the fake."""

    def update(self, ref: Any, data: dict[str, Any]) -> None:
        ref.update(data)


@dataclass
class Deps:
    db: Any

    def now(self) -> datetime:
        return NOW

    def monotonic(self) -> float:
        return 0.0


def grant(max_step: str = "full") -> GrantMeta:
    return GrantMeta(ai_name="Test", max_step=max_step, allowed_categories=["Home"], allowed_sources=["folder"],
                     created_at=NOW, expires_at=NOW + timedelta(days=1), link_hint="abcd")


def ctx(max_step: str = "full") -> relay.CallCtx:
    return relay.CallCtx(uid=UID, grant_id="g1", link_hash="h", grant=grant(max_step))


def answered(db: FakeDb, response: dict[str, Any], *, uid: str = UID, request_id: str = REQ, max_step: str = "full"):
    ref = db.collection(f"users/{uid}/requests").document(request_id)
    ref.set({"status": "answered", "maxStep": max_step, "requester": {"grantId": "g1"}, "response": response})
    grant_ref = db.collection(f"users/{uid}/grants").document("g1")
    grant_ref.set({"maxStep": max_step})
    return ref, grant_ref


def test_only_the_whole_item_tool_takes_the_file_flag():
    today = date(2026, 11, 22)
    plain = tools.parse_ladder_args({"question": "Send me my lease."}, today=today, allow_file=True)
    assert plain.want_file is False
    asked = tools.parse_ladder_args({"question": "Send me my lease.", "file": True}, today=today, allow_file=True)
    assert asked.want_file is True
    with pytest.raises(tools.ArgError):
        tools.parse_ladder_args({"question": "Send me my lease.", "file": True}, today=today)
    with pytest.raises(tools.ArgError):
        tools.parse_ladder_args({"question": "Send me my lease.", "file": "yes"}, today=today, allow_file=True)
    # the schema shows the flag on that tool only, and never to a connection that cannot use the tool
    assert "file" in tools.tool_definition("sieve_full_item", "full")["inputSchema"]["properties"]
    assert "file" not in tools.tool_definition("sieve_answer", "full")["inputSchema"]["properties"]
    assert "file" not in tools.tool_definition("sieve_excerpt", "full")["inputSchema"]["properties"]
    assert [t["name"] for t in tools.tools_for_step("answer", version="2025-06-18")] == ["sieve_answer", "sieve_check"]


def test_the_request_says_a_file_is_wanted_and_is_another_ask_than_the_text():
    today = date(2026, 11, 22)
    text = tools.parse_ladder_args({"question": "Send me my lease."}, today=today, allow_file=True)
    file = tools.parse_ladder_args({"question": "Send me my lease.", "file": True}, today=today, allow_file=True)
    key_text = relay.request_key("g1", "sieve_full_item", text)
    key_file = relay.request_key("g1", "sieve_full_item", file)
    assert key_text != key_file
    data = relay.request_data(ctx(), tool="sieve_full_item", args=file, status="queued", now=NOW, key=key_file)
    assert data["wantFile"] is True and data["requestedStep"] == "full"
    assert "wantFile" not in relay.request_data(ctx(), tool="sieve_full_item", args=text, status="queued", now=NOW, key=key_text)
    # the flag does nothing on a smaller tool, even if a caller builds the arguments by hand
    assert "wantFile" not in relay.request_data(ctx(), tool="sieve_answer", args=file, status="queued", now=NOW, key=key_file)


def test_a_file_is_delivered_only_on_the_full_step_from_its_own_place():
    db = FakeDb()
    ref, grant_ref = answered(db, {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE})
    got = relay._collect_txn(Txn(), ref, grant_ref, NOW, "full", (UID, REQ))
    assert got.kind == "delivered" and got.payload is not None and got.payload.file is not None
    assert "response" not in db.docs[ref.path] and db.docs[ref.path]["status"] == "collected"

    for label, response, owner, cap in (
        ("another person's place", {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE}, ("someone-else", REQ), "full"),
        ("another request's place", {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE}, (UID, "x" * 20), "full"),
        ("a smaller step", {"step": "answer", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE}, (UID, REQ), "full"),
        ("a connection capped lower", {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE}, (UID, REQ), "excerpt"),
        ("a kind that cannot be sent", {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": {**FILE, "name": "page.html", "mime": "text/html"}}, (UID, REQ), "full"),
    ):
        db2 = FakeDb()
        ref2, grant2 = answered(db2, response)
        out = relay._collect_txn(Txn(), ref2, grant2, NOW, cap, owner)
        assert out.kind == "not-answered", label
        assert db2.docs[ref2.path]["status"] == "error" and "response" not in db2.docs[ref2.path], label


def test_finish_makes_a_link_whose_token_is_stored_only_as_a_hash(monkeypatch):
    db = FakeDb()
    answered(db, {"step": "full", "text": TEXT, "chars": len(TEXT), "itemCount": 1, "file": FILE})
    monkeypatch.setattr(relay.fb, "transact", lambda _db, fn, *args, **_kw: fn(Txn(), *args))
    monkeypatch.setattr(relay, "mark_receipt", lambda *_a, **_k: None)
    monkeypatch.setattr(config, "public_base_url", lambda: "https://sieve.example")
    result = relay.finish(Deps(db), ctx(), REQ, {"status": "answered"}, t0=0.0)
    assert result.status == "answered" and result.step == "full" and result.text == TEXT
    assert result.file is not None and result.image is None
    assert result.file["name"] == "Lease_2026.pdf" and result.file["bytes"] == 182_000
    assert result.file["expires_in_seconds"] == files.FILE_LINK_TTL_SECONDS
    assert "path" not in result.file and "handoffs" not in str(result.to_wire())
    token = files.extract_file_token(result.file["url"].removeprefix("https://sieve.example"))
    assert token is not None and files.is_valid_file_token(token)
    links = {k: v for k, v in db.docs.items() if k.startswith("fileLinks/")}
    assert list(links) == [f"fileLinks/{files.file_token_hash(token)}"]
    stored = next(iter(links.values()))
    assert token not in str(stored)
    assert stored["path"] == PATH and stored["uid"] == UID and stored["requestId"] == REQ and stored["downloads"] == 0
    assert stored["expiresAt"] - stored["createdAt"] == timedelta(seconds=files.FILE_LINK_TTL_SECONDS)
    assert "10 minutes" in result.message and "not masked" in result.message
    # the wire form and the MCP result carry the file part; no image block is added for a file
    out = tools.call_tool_result(result, era="new", version="2025-06-18")
    assert out["structuredContent"]["file"]["url"] == result.file["url"]
    assert [c["type"] for c in out["content"]] == ["text"]

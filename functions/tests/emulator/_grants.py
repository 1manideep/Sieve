"""Shared setup for emulator tests: grants made in-process with the broker secret."""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from google.cloud import firestore

from sieve import fb, grants, links
from tests.helpers import emulator as emu

ALL = ["Home", "Work", "Money", "Health", "Travel", "Shopping", "Personal", "Newsletters", "Photos"]


def new_uid() -> str:
    return "u" + uuid.uuid4().hex[:20]


def short_grant(db: Any, uid: str, secret: bytes, *, step: str = "full", ttl_seconds: float = 3600,
                categories: list[str] | None = None, sources: list[str] | None = None) -> tuple[dict, str, dict]:
    req = grants.GrantRequest(ai_name="Test AI", max_step=step, allowed_categories=tuple(categories or ALL),
                              allowed_sources=tuple(sources or ["gmail"]), days=1)
    out = grants.create_grant_records(db, uid=uid, req=req, secret=secret, base_url="http://127.0.0.1:5000",
                                      now=fb.now(), ttl_seconds=ttl_seconds)
    link_secret = emu.secret_from_link(out["link"])
    connector = db.collection("connectors").document(links.link_hash(link_secret)).get().to_dict()
    return out, link_secret, connector


def connector_of(db: Any, link_secret: str) -> dict:
    return db.collection("connectors").document(links.link_hash(link_secret)).get().to_dict()


def put_request(db: Any, uid: str, grant_id: str, *, status: str = "queued", tool: str = "sieve_answer",
                created_ago: timedelta = timedelta(0), answered_ago: timedelta | None = None,
                response_step: str | None = None, max_step: str = "full", receipt: bool = False,
                sources: list[str] | None = None) -> str:
    from sieve import config
    now = fb.now()
    ref = db.collection(f"users/{uid}/requests").document()
    data: dict[str, Any] = {
        "requester": {"kind": "outside", "grantId": grant_id, "aiName": "Test AI"}, "tool": tool,
        "requestedStep": config.TOOL_STEP[tool], "maxStep": max_step, "allowedCategories": ALL,
        "allowedSources": sources or ["gmail"], "question": "What did my landlord say about the deposit?",
        "status": status, "createdAt": now - created_ago, "expireAt": now - created_ago + timedelta(hours=24),
    }
    if status in ("claimed", "awaiting-person", "answered"):
        data.update({"claimedAt": now - created_ago, "claimedBy": "device-test-1"})
    if status == "answered":
        data["answeredAt"] = now - (answered_ago or timedelta(0))
        step = response_step or "answer"
        data["response"] = {"step": step, "text": "Your deposit was $1,200.", "chars": 24, "itemCount": 1}
    ref.set(data)
    if receipt:
        db.collection(f"users/{uid}/receipts").document(ref.id).set({
            "id": ref.id, "requestId": ref.id, "requester": data["requester"], "question": data["question"],
            "step": response_step or "answer", "itemRefs": ["a" * 64],
            "status": "pending-collection" if status == "answered" else "declined", "decidedBy": "app",
            "chars": 24, "createdAt": firestore.SERVER_TIMESTAMP})
    return ref.id

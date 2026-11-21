"""Pydantic camelCase aliases round trip for every 01 section 8 model (60 section 3.7 test_models)."""
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from sieve import models

NOW = datetime(2026, 11, 16, tzinfo=timezone.utc)


def test_relay_request_round_trip():
    doc = {"requester": {"kind": "outside", "grantId": "G" * 20, "aiName": "Helper AI"}, "tool": "sieve_answer",
           "requestedStep": "answer", "maxStep": "full", "allowedCategories": ["Home"], "allowedSources": ["gmail"],
           "question": "Q", "hints": {"after": "2026-10-01", "from": "landlord"}, "status": "answered",
           "createdAt": NOW, "expireAt": NOW, "answeredAt": NOW, "claimedBy": "device-1",
           "response": {"step": "answer", "text": "T", "chars": 1, "itemCount": 1}}
    m = models.RelayRequest.model_validate(doc)
    assert m.requester.grant_id == "G" * 20 and m.hints.from_ == "landlord"
    assert m.to_firestore() == doc


def test_grant_connector_receipt_round_trip():
    g = {"aiName": "A", "maxStep": "answer", "allowedCategories": ["Home"], "allowedSources": ["gmail"],
         "createdAt": NOW, "expiresAt": NOW, "linkHint": "abcd"}
    assert models.GrantMeta.model_validate(g).to_firestore() == g
    c = {"uid": "u", "grantId": "G" * 20, "token": "t", "identity": {"agentId": "grant-x", "fingerprint": "f" * 16},
         "createdAt": NOW, "expiresAt": NOW, "revokedRootIds": [], "revokedTokenIds": [], "rateUsed": 0.0,
         "rateRefunds": 0.0}
    assert models.ConnectorDoc.model_validate(c).to_firestore() == c
    r = {"id": "r", "requestId": "r", "requester": {"kind": "outside", "grantId": "g", "aiName": "A"},
         "question": "Q", "itemRefs": ["a" * 64], "status": "pending-collection", "chars": 3, "createdAt": NOW}
    assert models.Receipt.model_validate(r).to_firestore() == r


def test_payload_limits_count_utf16_units():
    ok = models.RelayPayload.model_validate({"step": "full", "text": "\U0001F382" * 4000, "chars": 8000,
                                             "itemCount": 1})
    assert ok.step == "full"
    with pytest.raises(ValidationError):
        models.RelayPayload.model_validate({"step": "full", "text": "\U0001F382" * 4001, "chars": 8000,
                                            "itemCount": 1})
    with pytest.raises(ValidationError):
        models.RelayPayload.model_validate({"step": "everything", "text": "t", "chars": 1, "itemCount": 1})
    with pytest.raises(ValidationError):
        models.RelayPayload.model_validate({"step": "answer", "text": "", "chars": 1, "itemCount": 1})


def test_tool_result_wire_is_snake_case():
    r = models.ToolResult(status="pending", request_id="r" * 20, message="m")
    assert r.to_wire() == {"status": "pending", "request_id": "r" * 20, "message": "m"}

"""Reads Sieve receipts and grant metadata from the Firestore emulator for cross-checks (60 sections 4.7, 4.9.3).

Only the emulator is read, over its REST API with the `Bearer owner` token that bypasses
security rules (emulator only). The connector link in `SIEVE_MCP_URL` identifies the grant:
`connectors/{sha256(secret)}` holds `uid` and `grantId` (30 section 5). Request documents are
copied without their payload; receipts never hold content.
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime
from typing import Any
from urllib.parse import quote, urlparse

import httpx2

LINK_SECRET_RE = re.compile(r"/([A-Za-z0-9_-]{43})/?$")
REQUEST_FIELDS = ("tool", "requestedStep", "maxStep", "status", "createdAt", "claimedAt", "answeredAt", "collectedAt", "message")
GRANT_FIELDS = ("aiName", "maxStep", "allowedCategories", "allowedSources", "createdAt", "expiresAt", "revokedAt")


class CollectError(RuntimeError):
    pass


def link_secret_from_url(url: str) -> str | None:
    m = LINK_SECRET_RE.search(urlparse(url or "").path)
    return m.group(1) if m else None


def link_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def decode_value(v: dict) -> Any:
    """Firestore REST value to a Python value."""
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "booleanValue" in v:
        return bool(v["booleanValue"])
    if "timestampValue" in v:
        return v["timestampValue"]
    if "nullValue" in v:
        return None
    if "mapValue" in v:
        return decode_fields(v["mapValue"].get("fields", {}))
    if "arrayValue" in v:
        return [decode_value(x) for x in v["arrayValue"].get("values", [])]
    if "referenceValue" in v:
        return v["referenceValue"]
    if "bytesValue" in v:
        return v["bytesValue"]
    if "geoPointValue" in v:
        return v["geoPointValue"]
    return None


def decode_fields(fields: dict) -> dict:
    return {k: decode_value(v) for k, v in (fields or {}).items()}


def _doc_id(name: str) -> str:
    return name.rsplit("/", 1)[-1]


class Emulator:
    def __init__(self, project: str, host: str | None = None, client: httpx2.Client | None = None):
        if not project:
            raise CollectError("SIEVE_PROJECT_ID is not set")
        host = (host or os.environ.get("FIRESTORE_EMULATOR_HOST") or "127.0.0.1:8080").strip()
        self.base = f"http://{host}/v1/projects/{quote(project)}/databases/(default)/documents"
        self._client = client or httpx2.Client(timeout=10.0, headers={"Authorization": "Bearer owner"})

    def get(self, path: str) -> dict | None:
        r = self._client.get(f"{self.base}/{path}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return decode_fields(r.json().get("fields", {}))

    def query(self, parent: str, structured: dict) -> list[tuple[str, dict]]:
        r = self._client.post(f"{self.base}/{parent}:runQuery", json={"structuredQuery": structured})
        r.raise_for_status()
        out = []
        for row in r.json():
            doc = row.get("document")
            if doc:
                out.append((_doc_id(doc["name"]), decode_fields(doc.get("fields", {}))))
        return out

    def count(self, collection_path: str) -> int:
        n = 0
        token = None
        while True:
            params = {"pageSize": 300, "mask.fieldPaths": "seq"}
            if token:
                params["pageToken"] = token
            r = self._client.get(f"{self.base}/{collection_path}", params=params)
            if r.status_code == 404:
                return n
            r.raise_for_status()
            data = r.json()
            n += len(data.get("documents", []))
            token = data.get("nextPageToken")
            if not token:
                return n


def connector(emulator: Emulator, sieve_url: str) -> dict:
    secret = link_secret_from_url(sieve_url)
    if not secret:
        raise CollectError("SIEVE_MCP_URL does not end with a connector link secret")
    doc = emulator.get(f"connectors/{link_hash(secret)}")
    if not doc:
        raise CollectError("No connector document for this link in the emulator")
    return {"uid": doc.get("uid"), "grantId": doc.get("grantId")}


def grant_config(sieve_url: str, *, project: str, host: str | None = None, emulator: Emulator | None = None) -> dict:
    """The grant's maxStep, allowedCategories and allowedSources, for the run manifest."""
    emulator = emulator or Emulator(project, host)
    c = connector(emulator, sieve_url)
    grant = emulator.get(f"users/{c['uid']}/grants/{c['grantId']}") or {}
    return {"grantId": c["grantId"], **{k: grant.get(k) for k in GRANT_FIELDS if k in grant}}


def _in_window(ts: Any, since: str, until: str) -> bool:
    if not isinstance(ts, str):
        return False
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return datetime.fromisoformat(since) <= t <= datetime.fromisoformat(until)


def audit_count(sieve_url: str, *, project: str, host: str | None = None, emulator: Emulator | None = None) -> int:
    emulator = emulator or Emulator(project, host)
    return emulator.count(f"audit/{connector(emulator, sieve_url)['uid']}/entries")


def collect_run(
    sieve_url: str,
    *,
    project: str,
    since: str,
    until: str,
    audit_before: int | None = None,
    host: str | None = None,
    emulator: Emulator | None = None,
) -> dict:
    """receipts.json for one Sieve run: the run's requests (metadata only), their receipts, and the audit count."""
    emulator = emulator or Emulator(project, host)
    c = connector(emulator, sieve_url)
    uid, grant_id = c["uid"], c["grantId"]
    rows = emulator.query(
        f"users/{uid}",
        {
            "from": [{"collectionId": "requests"}],
            "where": {"fieldFilter": {"field": {"fieldPath": "requester.grantId"}, "op": "EQUAL", "value": {"stringValue": grant_id}}},
        },
    )
    requests = []
    receipts = []
    for request_id, data in rows:
        if not _in_window(data.get("createdAt"), since, until):
            continue
        requests.append({"id": request_id, **{k: data.get(k) for k in REQUEST_FIELDS if k in data}})
        receipt = emulator.get(f"users/{uid}/receipts/{request_id}")
        if receipt is not None:
            receipts.append({"id": request_id, **receipt})
    requests.sort(key=lambda r: str(r.get("createdAt")))
    total = emulator.count(f"audit/{uid}/entries")
    return {
        "grantId": grant_id,
        "window": {"since": since, "until": until},
        "requests": requests,
        "receipts": receipts,
        "audit_entries_total": total,
        "audit_entries_run": (total - audit_before) if audit_before is not None else None,
    }

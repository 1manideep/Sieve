"""Simulated home bases.

HomeBaseSim: a thread that serves queued requests with the Admin SDK (30 section 17), for server tests.
OwnerHomeBase: the same writes made as the signed-in owner through the Firestore emulator's REST API,
so every write is checked by firestore.rules exactly as the web app's would be.
"""
from __future__ import annotations

import hashlib
import hmac
import threading
import time
from dataclasses import dataclass
from typing import Any

import requests
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from sieve.config import utf16_len

from . import emulator as emu

LOCAL_SALT = b"sieve-test-local-salt-32-bytes!!"


def item_ref(record_id: str) -> str:
    """01 section 11.8: HMAC-SHA256(localSalt, recordId) hex."""
    return hmac.new(LOCAL_SALT, record_id.encode("utf-8"), hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class Behaviour:
    kind: str                      # answer | decline | no_match | blocked | never
    text: str = ""
    step: str = "answer"
    delay: float = 0.0
    message: str | None = None


def answer(text: str, step: str = "answer", delay: float = 0.0) -> Behaviour:
    return Behaviour("answer", text=text, step=step, delay=delay)


def decline(message: str | None = None, delay: float = 0.0) -> Behaviour:
    return Behaviour("decline", message=message, delay=delay)


def no_match(delay: float = 0.0) -> Behaviour:
    return Behaviour("no_match", delay=delay)


def blocked(delay: float = 0.0) -> Behaviour:
    return Behaviour("blocked", delay=delay)


def never() -> Behaviour:
    return Behaviour("never")


def receipt_doc(request_id: str, data: dict[str, Any], *, status: str, step: str | None, chars: int,
                decided_by: str = "app") -> dict[str, Any]:
    doc: dict[str, Any] = {
        "id": request_id, "requestId": request_id, "requester": data["requester"], "question": data["question"],
        "itemRefs": [item_ref("playground:landlord-1")], "status": status, "decidedBy": decided_by,
        "chars": chars, "createdAt": firestore.SERVER_TIMESTAMP,
    }
    if step:
        doc["step"] = step
    return doc


class HomeBaseSim:
    def __init__(self, db: Any, uid: str, device: str, behaviour: Behaviour) -> None:
        self.db = db
        self.uid = uid
        self.device = device
        self.behaviour = behaviour
        self.handled: list[str] = []
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()
        self._watch = None

    def __enter__(self) -> "HomeBaseSim":
        query = self.db.collection(f"users/{self.uid}/requests").where(filter=FieldFilter("status", "==", "queued"))
        self._watch = query.on_snapshot(self._on_snapshot)
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._watch is not None:
            self._watch.unsubscribe()
        for t in list(self._threads):
            t.join(timeout=30)

    def _on_snapshot(self, _docs: Any, changes: Any, _read_time: Any) -> None:
        for change in changes:
            if change.type.name != "ADDED":
                continue
            rid = change.document.id
            with self._lock:
                if rid in self.handled:
                    continue
                self.handled.append(rid)
            t = threading.Thread(target=self._serve, args=(rid,), daemon=True)
            self._threads.append(t)
            t.start()

    def _serve(self, rid: str) -> None:
        ref = self.db.collection(f"users/{self.uid}/requests").document(rid)
        ref.update({"status": "claimed", "claimedAt": firestore.SERVER_TIMESTAMP, "claimedBy": self.device})
        b = self.behaviour
        if b.kind in ("no_match", "blocked"):
            time.sleep(b.delay)
            data = ref.get().to_dict()
            batch = self.db.batch()
            batch.update(ref, {"status": "no-match" if b.kind == "no_match" else "blocked"})
            if b.kind == "blocked":
                batch.create(self.db.collection(f"users/{self.uid}/receipts").document(rid),
                             receipt_doc(rid, data, status="blocked", step=None, chars=0, decided_by="rule"))
            batch.commit()
            return
        ref.update({"status": "awaiting-person"})
        if b.kind == "never":
            return
        time.sleep(b.delay)
        data = ref.get().to_dict()
        batch = self.db.batch()
        receipts = self.db.collection(f"users/{self.uid}/receipts").document(rid)
        if b.kind == "answer":
            chars = utf16_len(b.text)
            batch.update(ref, {"status": "answered", "answeredAt": firestore.SERVER_TIMESTAMP,
                               "response": {"step": b.step, "text": b.text, "chars": chars, "itemCount": 1}})
            batch.create(receipts, receipt_doc(rid, data, status="pending-collection", step=b.step, chars=chars))
        else:
            update: dict[str, Any] = {"status": "declined"}
            if b.message:
                update["message"] = b.message
            batch.update(ref, update)
            batch.create(receipts, receipt_doc(rid, data, status="declined", step=None, chars=0))
        batch.commit()


# ---------- the owner, through the rules ----------

def _value(v: Any) -> dict[str, Any]:
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [_value(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: _value(x) for k, x in v.items()}}}
    raise TypeError(type(v))


class RulesDenied(Exception):
    pass


class OwnerHomeBase:
    """Writes as the owner (ID token) through the Firestore emulator REST API; the rules apply."""

    def __init__(self, uid: str, id_token: str, device: str = "owner-device-01") -> None:
        self.uid = uid
        self.id_token = id_token
        self.device = device

    def _name(self, path: str) -> str:
        return f"projects/{emu.PROJECT}/databases/(default)/documents/{path}"

    def commit(self, writes: list[dict[str, Any]]) -> None:
        r = requests.post(f"http://{emu.fs_host()}/v1/projects/{emu.PROJECT}/databases/(default)/documents:commit",
                          json={"writes": writes}, headers={"Authorization": f"Bearer {self.id_token}"}, timeout=10)
        if r.status_code == 403:
            raise RulesDenied(r.text[:300])
        r.raise_for_status()

    def _update(self, path: str, fields: dict[str, Any], mask: list[str], *, server_time: list[str] = (),
                exists: bool | None = True) -> dict[str, Any]:
        w: dict[str, Any] = {"update": {"name": self._name(path), "fields": {k: _value(v) for k, v in fields.items()}},
                             "updateMask": {"fieldPaths": mask}}
        if server_time:
            w["updateTransforms"] = [{"fieldPath": f, "setToServerValue": "REQUEST_TIME"} for f in server_time]
        if exists is not None:
            w["currentDocument"] = {"exists": exists}
        return w

    def _create(self, path: str, fields: dict[str, Any], *, server_time: list[str] = ()) -> dict[str, Any]:
        return self._update(path, fields, list(fields), server_time=server_time, exists=False)

    def register_device(self, label: str = "Owner Mac", fid: str | None = None) -> None:
        fields: dict[str, Any] = {"label": label, "isHomeBase": True}
        if fid:
            fields["fcmToken"] = fid
        self.commit([self._update(f"users/{self.uid}/devices/{self.device}", fields, list(fields),
                                  server_time=["updatedAt"], exists=None)])

    def go_online(self) -> requests.Response:
        return emu.set_presence(self.uid, self.device, True, id_token=self.id_token)

    def claim(self, rid: str) -> None:
        self.commit([self._update(f"users/{self.uid}/requests/{rid}", {"status": "claimed", "claimedBy": self.device},
                                  ["status", "claimedBy"], server_time=["claimedAt"])])

    def present(self, rid: str) -> None:
        self.commit([self._update(f"users/{self.uid}/requests/{rid}", {"status": "awaiting-person"}, ["status"])])

    def answer(self, rid: str, data: dict[str, Any], text: str, step: str = "answer") -> None:
        chars = utf16_len(text)
        receipt = {"id": rid, "requestId": rid, "requester": data["requester"], "question": data["question"],
                   "step": step, "itemRefs": [item_ref("gmail:18c2f0a1b2")], "status": "pending-collection",
                   "decidedBy": "app", "chars": chars}
        self.commit([
            self._update(f"users/{self.uid}/requests/{rid}",
                         {"status": "answered",
                          "response": {"step": step, "text": text, "chars": chars, "itemCount": 1}},
                         ["status", "response"], server_time=["answeredAt"]),
            self._create(f"users/{self.uid}/receipts/{rid}", receipt, server_time=["createdAt"]),
        ])

    def revoke_answer(self, rid: str, message: str = "The person took this answer back.") -> None:
        self.commit([
            self._update(f"users/{self.uid}/requests/{rid}", {"status": "revoked", "message": message},
                         ["status", "response", "message"]),
            self._update(f"users/{self.uid}/receipts/{rid}", {"status": "revoked"}, ["status"]),
        ])

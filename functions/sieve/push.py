"""Push "A request is waiting" (30 section 10, resolved by 01 section 11.5).

Target: the Firebase Installation ID (FID). firebase-admin 7.8 `messaging.Message` / `MulticastMessage`
take `fid` / `fids`, and `token` / `tokens` are deprecated (DeprecationWarning). The web app's
`onRegistered()` yields an FID and stores it in devices/{deviceId}.fcmToken (contract name kept). A value
that is not FID-shaped (a legacy registration token from getToken) is still sent as a token, so either
web implementation receives the push.

Payload (01 section 11.5, 40 CR-5): notification title "Sieve", body "A request is waiting", webpush link
/requests, data {kind: "request-waiting"}. Nothing else: never the question, the assistant or any content.
"""
from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, Sequence

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from . import config, fb, logs

FID_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")   # 22 base64url characters (Firebase Installations)
PUSH_TITLE = "Sieve"
PUSH_BODY = "A request is waiting"
PUSH_DATA = {"kind": "request-waiting"}


@dataclass(frozen=True)
class PushPayload:
    title: str = PUSH_TITLE
    body: str = PUSH_BODY
    link: str = "/requests"
    data: Mapping[str, str] = field(default_factory=lambda: dict(PUSH_DATA))


def payload_for(base_url: str) -> PushPayload:
    return PushPayload(link=f"{base_url.rstrip('/')}/requests")


class PushSender(Protocol):
    def send(self, targets: Sequence[str], payload: PushPayload, *, uid: str, request_id: str) -> list[str | None]:
        """One entry per target: None on success, else 'unregistered' | 'sender-id-mismatch' | 'other'."""


def is_fid(value: str) -> bool:
    return FID_RE.fullmatch(value) is not None


class FcmPushSender:
    def send(self, targets: Sequence[str], payload: PushPayload, *, uid: str, request_id: str) -> list[str | None]:
        from firebase_admin import messaging

        fb.app()
        options = messaging.WebpushFCMOptions(link=payload.link) if payload.link.startswith("https://") else None
        webpush = messaging.WebpushConfig(headers={"Urgency": "high", "TTL": "600"}, fcm_options=options)
        notification = messaging.Notification(title=payload.title, body=payload.body)
        messages = []
        for target in targets:
            if is_fid(target):
                messages.append(messaging.Message(fid=target, notification=notification, webpush=webpush,
                                                  data=dict(payload.data)))
            else:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", DeprecationWarning)
                    messages.append(messaging.Message(token=target, notification=notification, webpush=webpush,
                                                      data=dict(payload.data)))
        response = messaging.send_each(messages)
        out: list[str | None] = []
        for r in response.responses:
            if r.success:
                out.append(None)
            elif isinstance(r.exception, messaging.UnregisteredError):
                out.append("unregistered")
            elif isinstance(r.exception, messaging.SenderIdMismatchError):
                out.append("sender-id-mismatch")
            else:
                out.append("other")
        return out


class RecordingPushSender:
    """Emulator only: writes debug_pushes/{autoId} = {uid, requestId, tokenCount, notification, link, data, at}."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def send(self, targets: Sequence[str], payload: PushPayload, *, uid: str, request_id: str) -> list[str | None]:
        self._db.collection("debug_pushes").add({
            "uid": uid, "requestId": request_id, "tokenCount": len(targets),
            "notification": {"title": payload.title, "body": payload.body}, "link": payload.link,
            "data": dict(payload.data), "at": fb.now(),
        })
        return [None for _ in targets]


def sender_from_config(db: Any | None = None) -> PushSender:
    mode = (config.PUSH_MODE.value or "fcm").strip()
    if mode == "record":
        if config.IS_EMULATOR:
            return RecordingPushSender(db if db is not None else fb.db())
        logs.log_warning("push_mode_ignored", reason="record-outside-emulator")
    return FcmPushSender()


def notify_request_waiting(db: Any, sender: PushSender, *, uid: str, request_id: str) -> int:
    user = db.collection("users").document(uid).get()
    settings = (user.to_dict() or {}).get("settings") if user.exists else None
    if isinstance(settings, Mapping) and settings.get("pushEnabled") is False:
        return 0
    devices = (db.collection(f"users/{uid}/devices")
               .where(filter=FieldFilter("isHomeBase", "==", True)).stream())
    targets: list[tuple[Any, str]] = []
    for snap in devices:
        value = (snap.to_dict() or {}).get("fcmToken")
        if isinstance(value, str) and value:
            targets.append((snap.reference, value))
        if len(targets) >= config.PUSH_MAX_DEVICES:
            break
    if not targets:
        return 0
    results = sender.send([t for _, t in targets], payload_for(config.public_base_url()), uid=uid,
                          request_id=request_id)
    failed = 0
    for (ref, _), outcome in zip(targets, results):
        if outcome is None:
            continue
        failed += 1
        if outcome in ("unregistered", "sender-id-mismatch"):
            try:
                ref.update({"fcmToken": firestore.DELETE_FIELD})
            except Exception as exc:  # noqa: BLE001 - a stale target is cleaned up next time
                logs.log_exception("push_cleanup_error", exc)
    sent = len(results) - failed
    logs.log_event("push_sent", count=sent, failed=failed)
    return sent

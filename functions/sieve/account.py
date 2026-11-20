"""deleteAccount (30 section 13.2).

Connectors are keyed by link hash, not uid, so they are revoked and deleted here. The callable then deletes
the person's own paths directly (users/{uid} and audit/{uid} recursively, RTDB presence/{uid}) before
deleting the Auth user, so the wipe does not depend on the Delete User Data extension being installed.
The extension, when installed, also covers users deleted from the console.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from firebase_admin import auth
from firebase_admin import db as rtdb
from google.cloud.firestore_v1.base_query import FieldFilter
from ratchet_core import RatchetMalformedToken, deserialize_token

from . import fb, logs
from .errors import Precondition
from .ratchet_fs import ConnectorRevocationStore

RECENT_SIGN_IN_SECONDS = 300


def delete_account(db: Any, *, uid: str, auth_time: int | None, now: datetime) -> dict[str, Any]:
    if not isinstance(auth_time, (int, float)) or now.timestamp() - auth_time > RECENT_SIGN_IN_SECONDS:
        raise Precondition("Sign in again, then delete your account.")
    for snap in db.collection("connectors").where(filter=FieldFilter("uid", "==", uid)).stream():
        data = snap.to_dict() or {}
        try:
            ConnectorRevocationStore(db, snap.id, data).revoke_root(deserialize_token(data["token"]).root_id)
        except (RatchetMalformedToken, KeyError):
            pass
        snap.reference.delete()
    db.recursive_delete(db.collection("users").document(uid))
    db.recursive_delete(db.collection("audit").document(uid))
    try:
        rtdb.reference(f"presence/{uid}", app=fb.app()).delete()
    except Exception as exc:  # noqa: BLE001 - presence is ephemeral; the extension also clears it
        logs.log_exception("presence_delete_error", exc, user=logs.user_ref(uid))
    try:
        auth.delete_user(uid, app=fb.app())
    except auth.UserNotFoundError:
        pass
    logs.log_event("account_deleted", user=logs.user_ref(uid))
    return {"deleted": True}

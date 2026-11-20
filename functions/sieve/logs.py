"""Content-free structured logging (30 section 14).

Never logged: the question, the hints, payload text, message text, link secrets, link hashes, tokens,
FCM targets, raw uids and IP addresses. Unknown fields are dropped; exception messages are never
printed because they can echo input.
"""
from __future__ import annotations

import hashlib
import os
import traceback

from firebase_functions import logger

ALLOWED_FIELDS = frozenset({"grant", "user", "tool", "era", "version", "method", "http", "status", "reason",
                            "step", "days", "ms", "waited_ms", "count", "failed", "expired_open",
                            "expired_answered", "receipts_expired", "connectors_deleted"})
_MAX_STRING = 64
_MAX_FRAMES = 12


def user_ref(uid: str) -> str:
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()[:12]


def _keep(fields: dict[str, object]) -> tuple[dict[str, object], list[str]]:
    kept: dict[str, object] = {}
    dropped: list[str] = []
    for key, value in fields.items():
        if key not in ALLOWED_FIELDS:
            dropped.append(key)
            continue
        if value is None:
            continue
        if isinstance(value, bool) or isinstance(value, (int, float)):
            kept[key] = value
        else:
            kept[key] = str(value)[:_MAX_STRING]
    return kept, dropped


def log_event(event: str, **fields: str | int | float | bool | None) -> None:
    kept, dropped = _keep(fields)
    for key in dropped:
        logger.warn("log_field_dropped", event="log_field_dropped", field=key[:_MAX_STRING])
    logger.info(event, event=event, **kept)


def log_warning(event: str, **fields: str | int | float | bool | None) -> None:
    kept, dropped = _keep(fields)
    for key in dropped:
        logger.warn("log_field_dropped", event="log_field_dropped", field=key[:_MAX_STRING])
    logger.warn(event, event=event, **kept)


def _frames(exc: BaseException) -> list[str]:
    frames = traceback.extract_tb(exc.__traceback__)[-_MAX_FRAMES:]
    return [f"{os.path.basename(f.filename)}:{f.lineno}" for f in frames]


def log_exception(event: str, exc: BaseException, **fields: str | int | float | bool | None) -> None:
    kept, _ = _keep(fields)
    kept.pop("reason", None)
    logger.error(event, event=event, reason=type(exc).__name__, frames=_frames(exc), **kept)

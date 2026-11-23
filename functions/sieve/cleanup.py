"""Scheduled expiry and deletion (30 section 12). TTL on requests.expireAt only removes old documents;
correctness never depends on it."""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from google.api_core.exceptions import FailedPrecondition
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from . import config, fb, logs
from .relay import MSG_COLLECT_EXPIRED, MSG_DECISION_EXPIRED, is_playground, mark_receipt

RUN_BUDGET_SECONDS = 240


@dataclass
class CleanupReport:
    expired_open: int = 0
    expired_answered: int = 0
    receipts_expired: int = 0
    connectors_deleted: int = 0
    files_removed: int = 0


def run_scheduled() -> CleanupReport:
    report = run_cleanup(fb.db(), fb.now())
    # Files sent as themselves: links past their time go, with their objects (filehttp.py).
    try:
        from . import filehttp
        report.files_removed = filehttp.remove_expired(fb.db(), fb.now(), filehttp.delete_object)
    except Exception:       # noqa: BLE001 - Storage not set up yet, or briefly away: the next run tries again
        logs.log_event("cleanup_files_failed")
    logs.log_event("cleanup_run", expired_open=report.expired_open, expired_answered=report.expired_answered,
                   receipts_expired=report.receipts_expired, connectors_deleted=report.connectors_deleted,
                   files_removed=report.files_removed)
    return report


def _precondition_update(db: Any, snap: Any, data: dict[str, Any]) -> bool:
    try:
        snap.reference.update(data, option=db.write_option(last_update_time=snap.update_time))
        return True
    except FailedPrecondition:
        return False      # the home base wrote meanwhile; the next run looks again


def run_cleanup(db: Any, now: datetime, *, batch_limit: int = 200,
                monotonic: Any = time.monotonic) -> CleanupReport:
    report = CleanupReport()
    started = monotonic()

    def in_budget() -> bool:
        return monotonic() - started < RUN_BUDGET_SECONDS

    # 1. Open requests past the decision window.
    cutoff_open = now - timedelta(minutes=config.DECISION_WINDOW_MINUTES)
    skipped: set[str] = set()
    while in_budget():
        snaps = list(db.collection_group("requests")
                     .where(filter=FieldFilter("status", "in", ["queued", "claimed", "awaiting-person"]))
                     .where(filter=FieldFilter("createdAt", "<", cutoff_open)).limit(batch_limit).stream())
        fresh = [s for s in snaps if s.reference.path not in skipped]
        for snap in fresh:
            if _precondition_update(db, snap, {"status": "expired", "message": MSG_DECISION_EXPIRED}):
                report.expired_open += 1
            else:
                skipped.add(snap.reference.path)
        if len(snaps) < batch_limit or not fresh:
            break

    # 2. Answered and not collected past the collect window.
    cutoff_answered = now - timedelta(minutes=config.COLLECT_WINDOW_MINUTES)
    skipped = set()
    while in_budget():
        snaps = list(db.collection_group("requests")
                     .where(filter=FieldFilter("status", "==", "answered"))
                     .where(filter=FieldFilter("answeredAt", "<", cutoff_answered)).limit(batch_limit).stream())
        fresh = [s for s in snaps if s.reference.path not in skipped]
        for snap in fresh:
            ok = _precondition_update(db, snap, {"status": "expired", "message": MSG_COLLECT_EXPIRED,
                                                 "response": firestore.DELETE_FIELD})
            if not ok:
                skipped.add(snap.reference.path)
                continue
            report.expired_answered += 1
            data = snap.to_dict() or {}
            uid = snap.reference.parent.parent.id
            if not is_playground(data) and mark_receipt(db, uid, snap.id, "expired"):
                report.receipts_expired += 1
        if len(snaps) < batch_limit or not fresh:
            break

    # 3. Connectors kept CONNECTOR_RETENTION_DAYS after expiry or revocation.
    cutoff_conn = now - timedelta(days=config.CONNECTOR_RETENTION_DAYS)
    for field_name in ("expiresAt", "revokedAt"):
        while in_budget():
            snaps = list(db.collection("connectors").where(filter=FieldFilter(field_name, "<", cutoff_conn))
                         .limit(batch_limit).stream())
            for snap in snaps:
                snap.reference.delete()
                report.connectors_deleted += 1
            if len(snaps) < batch_limit:
                break
    return report

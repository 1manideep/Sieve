"""Per-grant admission: a fixed-window call limit read in one transaction with the connector (30 section 11)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from pydantic import ValidationError

from . import config, fb
from .models import GrantMeta

LAST_USED_RESOLUTION = timedelta(seconds=60)


@dataclass(frozen=True)
class Admission:
    allowed: bool
    connector: dict
    grant: GrantMeta | None
    retry_after_seconds: int


def _admit_txn(txn: Any, connector_ref: Any, db: Any, now: datetime) -> Admission | None:
    conn_snap = connector_ref.get(transaction=txn)
    if not conn_snap.exists:
        return None
    connector = conn_snap.to_dict() or {}
    grant_ref = db.collection(f"users/{connector.get('uid')}/grants").document(str(connector.get("grantId")))
    grant_snap = grant_ref.get(transaction=txn)
    grant: GrantMeta | None = None
    if grant_snap.exists:
        try:
            grant = GrantMeta.model_validate(grant_snap.to_dict() or {})
        except ValidationError:
            grant = None
    window = timedelta(seconds=config.RATE_LIMIT_WINDOW_SECONDS)
    start = connector.get("rateWindowStart")
    if not isinstance(start, datetime) or now - start >= window or start > now:
        start, count = now, 1
    else:
        count = int(connector.get("rateCount") or 0) + 1
    txn.update(connector_ref, {"rateWindowStart": start, "rateCount": count})
    if grant is not None and (grant.last_used_at is None or now - grant.last_used_at >= LAST_USED_RESOLUTION):
        txn.update(grant_ref, {"lastUsedAt": now})
    connector.update({"rateWindowStart": start, "rateCount": count})
    retry = max(0, int((start + window - now).total_seconds()))
    return Admission(allowed=count <= config.RATE_LIMIT_CALLS, connector=connector, grant=grant,
                     retry_after_seconds=retry)


def admit(db: Any, link_hash: str, now: datetime) -> Admission | None:
    return fb.transact(db, _admit_txn, db.collection("connectors").document(link_hash), db, now,
                       lock_key=f"connectors/{link_hash}")

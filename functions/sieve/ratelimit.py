"""Per-connection admission: a leaky-bucket call limit read in one transaction with the connector (30 section 11).

A counted call adds its weight to the bucket (a sieve_check poll counts as half a call), and the bucket drains
RATE_LIMIT_CALLS per RATE_LIMIT_WINDOW_SECONDS. A call that would overflow it is refused and adds nothing, so the
wait it states is exact: the time the bucket needs to drain enough for that call. A call turned away after
admission (the pending limit, an unknown request id, bad arguments) is given back with refund(), up to
RATE_LIMIT_FREE_REFUSALS per window, so a loop of refused calls still meets the limit.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping

from pydantic import ValidationError

from . import config, fb
from .models import GrantMeta

LAST_USED_RESOLUTION = timedelta(seconds=60)
_EPS = 1e-9


def drain_per_second() -> float:
    return config.RATE_LIMIT_CALLS / config.RATE_LIMIT_WINDOW_SECONDS


def call_weight(tool_name: str) -> float:
    """What one call adds to the bucket: half a call for sieve_check, one call for anything else."""
    return config.CHECK_CALL_WEIGHT if tool_name == config.MCP_TOOLS["check"] else 1.0


def stated_wait(seconds: float) -> int:
    """A wait as the assistant reads it: rounded up to a multiple of RATE_LIMIT_WAIT_STEP_SECONDS, never 0."""
    step = config.RATE_LIMIT_WAIT_STEP_SECONDS
    return max(step, math.ceil(seconds / step - _EPS) * step)


def max_stated_wait() -> int:
    """The longest wait a refused call can be told. The bucket never holds more than RATE_LIMIT_CALLS, so a full
    call needs at most one call's worth of draining."""
    return stated_wait(1.0 / drain_per_second())


def _amount(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return 0.0
    return float(value)


@dataclass(frozen=True)
class Bucket:
    """The connector's rate fields: call units counted (rateUsed) and refused calls given back (rateRefunds), both
    as of rateAt. Both drain in a straight line: rateUsed by RATE_LIMIT_CALLS and rateRefunds by
    RATE_LIMIT_FREE_REFUSALS per window. A missing rateAt is an empty bucket."""
    used: float = 0.0
    refunds: float = 0.0
    at: datetime | None = None

    @classmethod
    def from_doc(cls, doc: Mapping[str, Any]) -> "Bucket":
        at = doc.get("rateAt")
        if not isinstance(at, datetime):
            return cls()
        return cls(used=min(_amount(doc.get("rateUsed")), float(config.RATE_LIMIT_CALLS)),
                   refunds=min(_amount(doc.get("rateRefunds")), float(config.RATE_LIMIT_FREE_REFUSALS)), at=at)

    def to_doc(self) -> dict[str, Any]:
        return {"rateUsed": self.used, "rateRefunds": self.refunds, "rateAt": self.at}

    def drained(self, now: datetime) -> "Bucket":
        """The bucket at now. A rateAt later than now (another instance's clock) drains nothing and is kept."""
        if self.at is None:
            return Bucket(at=now)
        elapsed = max(0.0, (now - self.at).total_seconds())
        window = config.RATE_LIMIT_WINDOW_SECONDS
        return Bucket(used=max(0.0, self.used - elapsed * config.RATE_LIMIT_CALLS / window),
                      refunds=max(0.0, self.refunds - elapsed * config.RATE_LIMIT_FREE_REFUSALS / window),
                      at=max(self.at, now))


def take(bucket: Bucket, weight: float, now: datetime) -> tuple[Bucket, float]:
    """(the bucket after this call, seconds to wait). A wait of 0 means the call is admitted and counted. Otherwise
    nothing is counted, and the wait is how long the bucket needs to drain enough for this call."""
    b = bucket.drained(now)
    over = b.used + weight - config.RATE_LIMIT_CALLS
    if over <= _EPS:
        return Bucket(used=b.used + weight, refunds=b.refunds, at=b.at), 0.0
    return b, over / drain_per_second()


def give_back(bucket: Bucket, weight: float, now: datetime) -> Bucket | None:
    """The bucket with a refused call's weight taken out again, or None when this window's free refusals are
    used up (the call then stays counted)."""
    b = bucket.drained(now)
    if b.refunds + 1 > config.RATE_LIMIT_FREE_REFUSALS + _EPS:
        return None
    return Bucket(used=max(0.0, b.used - weight), refunds=b.refunds + 1, at=b.at)


@dataclass(frozen=True)
class Admission:
    allowed: bool
    connector: dict
    grant: GrantMeta | None
    retry_after_seconds: int          # 0 when allowed; else the stated wait (stated_wait), in seconds
    weight: float = 1.0               # what the call added to the bucket (nothing when refused)


def _admit_txn(txn: Any, connector_ref: Any, db: Any, now: datetime, weight: float) -> Admission | None:
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
    after, wait = take(Bucket.from_doc(connector), weight, now)
    allowed = wait == 0
    if allowed:
        txn.update(connector_ref, after.to_doc())
        connector.update(after.to_doc())
    if grant is not None and (grant.last_used_at is None or now - grant.last_used_at >= LAST_USED_RESOLUTION):
        txn.update(grant_ref, {"lastUsedAt": now})
    return Admission(allowed=allowed, connector=connector, grant=grant,
                     retry_after_seconds=0 if allowed else stated_wait(wait), weight=weight)


def admit(db: Any, link_hash: str, now: datetime, weight: float = 1.0) -> Admission | None:
    """Count one call of this weight, or refuse it with the wait. None when the connector does not exist."""
    return fb.transact(db, _admit_txn, db.collection("connectors").document(link_hash), db, now, weight,
                       lock_key=f"connectors/{link_hash}")


def _refund_txn(txn: Any, connector_ref: Any, now: datetime, weight: float) -> bool:
    snap = connector_ref.get(transaction=txn)
    if not snap.exists:
        return False
    after = give_back(Bucket.from_doc(snap.to_dict() or {}), weight, now)
    if after is None:
        return False
    txn.update(connector_ref, after.to_doc())
    return True


def refund(db: Any, link_hash: str, weight: float, now: datetime) -> bool:
    """Give back a call that admit() counted and Sieve then refused. False when nothing was given back."""
    return fb.transact(db, _refund_txn, db.collection("connectors").document(link_hash), now, weight,
                       lock_key=f"connectors/{link_hash}")

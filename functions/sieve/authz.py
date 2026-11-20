"""Ratchet broker construction and the per-call check (30 section 6.2)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from ratchet_core import (
    Broker,
    Caveat,
    IdentityRegistry,
    InMemoryRevocationStore,
    ProposedToolCall,
    RatchetMalformedToken,
    WorkloadIdentity,
    build_entry,
    deserialize_token,
    max_depth_caveat,
    resource_caveat,
    tool_name_caveat,
)

from . import config
from .links import derive_connector_identity
from .ratchet_fs import ConnectorRevocationStore, FirestoreAuditSink


def tool_pattern(max_step: str) -> str:
    return config.TOOL_PATTERNS[max_step]


def resource_uri(uid: str, grant_id: str) -> str:
    return f"sieve://users/{uid}/grants/{grant_id}"


def grant_caveats(uid: str, grant_id: str, max_step: str) -> list[Caveat]:
    return [tool_name_caveat(tool_pattern(max_step)),
            resource_caveat(re.escape(resource_uri(uid, grant_id))),
            max_depth_caveat(0)]


def make_broker(db: Any, *, secret: bytes, uid: str, connector: Mapping[str, Any] | None,
                link_hash: str | None, identity: WorkloadIdentity | None) -> Broker:
    registry = IdentityRegistry()
    if identity is not None:
        registry.register(identity)   # audit entries then show ratchet://grant-<id>/<fp>
    store = (ConnectorRevocationStore(db, link_hash, connector)
             if connector is not None and link_hash else InMemoryRevocationStore())
    return Broker(secret=secret, identity_registry=registry, revocation_store=store,
                  audit_sink=FirestoreAuditSink(db, uid))


@dataclass(frozen=True)
class AuthzOutcome:
    allowed: bool
    reason_code: str          # Ratchet reason code, "OK" when allowed


def authorize_call(db: Any, *, secret: bytes, uid: str, link_hash: str, connector: Mapping[str, Any],
                   link_secret: str, tool_name: str, args: Mapping[str, Any]) -> AuthzOutcome:
    grant_id = connector["grantId"]
    identity = derive_connector_identity(link_secret, grant_id)
    resource = resource_uri(uid, grant_id)
    try:
        token = deserialize_token(connector["token"])
    except RatchetMalformedToken:
        sink = FirestoreAuditSink(db, uid)
        try:
            sink.append(build_entry(prev_hash=sink.last_hash(), delegation_chain=(identity.uri,),
                                    tool_name=tool_name, args=dict(args), resource=resource, decision="DENY",
                                    reason_code="MALFORMED", token_id=""))
        except Exception:  # noqa: BLE001 - logged by the sink; never flips the decision
            pass
        return AuthzOutcome(False, "MALFORMED")
    broker = make_broker(db, secret=secret, uid=uid, connector=connector, link_hash=link_hash, identity=identity)
    decision = broker.authorize(token, presenting_identity=identity,
                                proposed_tool_call=ProposedToolCall(tool_name=tool_name, args=dict(args),
                                                                    resource=resource))
    return AuthzOutcome(decision.allowed, decision.reason_code)

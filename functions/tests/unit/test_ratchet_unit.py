"""U4 to U6: step caps, audit hashing and an in-memory broker with Sieve's caveats."""
import random
import re
import string
import time

from ratchet_core import (Broker, IdentityRegistry, InMemoryRevocationStore, ProposedToolCall, attenuate,
                          build_entry, tool_name_caveat)

from sieve import authz, config, links, ratchet_fs

TOOLS = ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]


def test_u4_tool_patterns_full_match():
    def allowed(step):
        return [t for t in TOOLS + ["sieve_answerx", "delete_all"] if re.fullmatch(config.TOOL_PATTERNS[step], t)]
    assert allowed("answer") == ["sieve_answer", "sieve_check"]
    assert allowed("excerpt") == ["sieve_answer", "sieve_excerpt", "sieve_check"]
    assert allowed("full") == TOOLS


def _rand(n=12):
    return "".join(random.choice(string.ascii_letters) for _ in range(n))


def test_u5_entry_hash_matches_ratchet_and_rechain_verifies():
    for _ in range(50):
        prev = "".join(random.choice("0123456789abcdef") for _ in range(64))
        e = build_entry(prev_hash=prev, delegation_chain=(f"ratchet://{_rand()}/{_rand(16)}",), tool_name=_rand(),
                        args={"question": _rand(40), "n": random.randint(0, 9)}, resource=f"sieve://{_rand()}",
                        decision=random.choice(["ALLOW", "DENY"]), reason_code=_rand(), token_id=_rand(32))
        body = {k: v for k, v in e.to_canonical_dict().items() if k not in ("prev_hash", "entry_hash")}
        assert ratchet_fs.entry_hash(prev, body) == e.entry_hash
        p2 = "f" * 64
        r = ratchet_fs.rechain(e, p2)
        assert r.prev_hash == p2 and r.timestamp == e.timestamp and r.tool_name == e.tool_name
        assert r.args_digest == e.args_digest and r.delegation_chain == e.delegation_chain
        assert ratchet_fs.entry_hash(p2, body) == r.entry_hash


def _broker(identity):
    registry = IdentityRegistry()
    registry.register(identity)
    return Broker(secret=b"k" * 32, identity_registry=registry, revocation_store=InMemoryRevocationStore())


def _call(uid, gid, tool):
    args = {"request_id": "a" * 20} if tool == "sieve_check" else {"question": "What did my landlord say?"}
    return ProposedToolCall(tool_name=tool, args=args, resource=authz.resource_uri(uid, gid))


def test_u6_broker_with_grant_caveats():
    uid, gid = "user-1", "G" * 20
    identity = links.derive_connector_identity(links.new_link_secret(), gid)
    broker = _broker(identity)
    for step in config.LADDER_STEPS:
        token = broker.issue(human_identity=uid, primary_identity=identity,
                             caveats=authz.grant_caveats(uid, gid, step), ttl_seconds=60)
        assert broker.authorize(token, presenting_identity=identity, proposed_tool_call=_call(uid, gid, "sieve_check")).allowed
    token = broker.issue(human_identity=uid, primary_identity=identity,
                         caveats=authz.grant_caveats(uid, gid, "answer"), ttl_seconds=60)
    d = broker.authorize(token, presenting_identity=identity, proposed_tool_call=_call(uid, gid, "sieve_excerpt"))
    assert (d.allowed, d.reason_code) == (False, "CAVEAT_NOT_SATISFIED")
    other = links.derive_connector_identity(links.new_link_secret(), gid)
    d = broker.authorize(token, presenting_identity=other, proposed_tool_call=_call(uid, gid, "sieve_answer"))
    assert d.reason_code == "NOT_BOUND"
    # another grant's resource is refused even with this token
    d = broker.authorize(token, presenting_identity=identity, proposed_tool_call=_call(uid, "H" * 20, "sieve_answer"))
    assert d.reason_code == "CAVEAT_NOT_SATISFIED"
    short = broker.issue(human_identity=uid, primary_identity=identity,
                         caveats=authz.grant_caveats(uid, gid, "answer"), ttl_seconds=0.01)
    time.sleep(0.05)
    assert broker.authorize(short, presenting_identity=identity,
                            proposed_tool_call=_call(uid, gid, "sieve_answer")).reason_code == "EXPIRED"
    full = broker.issue(human_identity=uid, primary_identity=identity,
                        caveats=authz.grant_caveats(uid, gid, "full"), ttl_seconds=60)
    narrowed = attenuate(full, secret=b"k" * 32, new_caveats=[tool_name_caveat(config.TOOL_PATTERNS["answer"])])
    allowed = [t for t in TOOLS if broker.authorize(narrowed, presenting_identity=identity,
                                                     proposed_tool_call=_call(uid, gid, t)).allowed]
    assert allowed == ["sieve_answer", "sieve_check"]
    broker.revocation_store.revoke_root(full.root_id)
    assert broker.authorize(narrowed, presenting_identity=identity,
                            proposed_tool_call=_call(uid, gid, "sieve_answer")).reason_code == "REVOKED"

#!/usr/bin/env python3
"""Sieve spike: check the Ratchet grant design locally (no Firebase).

Design under test (docs/spec/00-overview.md decisions 4-5, 01-contracts.md section 7):
- one grant per outside assistant, bound to a server-held connector identity;
- the ladder step is capped by a tool_name caveat (each step is its own MCP tool);
- sieve_check is always allowed; expiry and revocation deny; narrowing works;
- the audit log is a hash chain.

Run with a Python that has ratchet-authz-core installed, for example:
  ~/ratchet-guard/.venv/bin/python spikes/ratchet/grant_check.py
"""
from __future__ import annotations

import json
import tempfile
import threading
import time
from pathlib import Path

from ratchet_core import (
    Broker,
    JsonlAuditSink,
    ProposedToolCall,
    tool_name_caveat,
    verify_audit_chain,
)
from ratchet_core.identity import Ed25519WorkloadIdentity
from ratchet_core.tokens import attenuate, deserialize_token, serialize_token

STEP_PATTERNS = {
    "answer": r"sieve_(answer|check)",
    "excerpt": r"sieve_(answer|excerpt|check)",
    "full": r"sieve_(answer|excerpt|full_item|check)",
}
TOOLS = ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]
SECRET = b"s" * 32

results: list[dict] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": ok, "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")


def call(tool: str) -> ProposedToolCall:
    args = {"request_id": "r1"} if tool == "sieve_check" else {"question": "What did my landlord say about the deposit?"}
    return ProposedToolCall(tool_name=tool, args=args)


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sieve-ratchet-"))
    broker = Broker(secret=SECRET, audit_sink=JsonlAuditSink(tmp / "audit.jsonl"))
    connector = Ed25519WorkloadIdentity("connector:claude-1")

    # 1. Step caps per grant.
    for step, pattern in STEP_PATTERNS.items():
        token = broker.issue(human_identity="uid-alex", primary_identity=connector,
                             caveats=[tool_name_caveat(pattern)], ttl_seconds=3600)
        allowed = [t for t in TOOLS if broker.authorize(token, presenting_identity=connector, proposed_tool_call=call(t)).allowed]
        expected = {"answer": ["sieve_answer", "sieve_check"],
                    "excerpt": ["sieve_answer", "sieve_excerpt", "sieve_check"],
                    "full": TOOLS}[step]
        record(f"grant maxStep={step} allows exactly {expected}", allowed == expected, f"got {allowed}")

    # 2. Wrong connector identity (a different assistant's link) is refused.
    token = broker.issue(human_identity="uid-alex", primary_identity=connector,
                         caveats=[tool_name_caveat(STEP_PATTERNS["full"])], ttl_seconds=3600)
    other = Ed25519WorkloadIdentity("connector:chatgpt-1")
    d = broker.authorize(token, presenting_identity=other, proposed_tool_call=call("sieve_answer"))
    record("another connector's identity is denied", not d.allowed, getattr(d, "reason_code", "") or str(d))

    # 3. Serialization round trip, and how big a token is (it lives in connectors/{linkHash}).
    s = serialize_token(token)
    back = deserialize_token(s)
    d = broker.authorize(back, presenting_identity=connector, proposed_tool_call=call("sieve_answer"))
    record("serialized token round-trips and still authorizes", d.allowed, f"{len(s)} characters")

    # 4. Narrowing: full -> answer by appending a tool_name caveat (caveats AND together).
    narrowed = attenuate(token, secret=SECRET, new_caveats=[tool_name_caveat(STEP_PATTERNS["answer"])])
    allowed = [t for t in TOOLS if broker.authorize(narrowed, presenting_identity=connector, proposed_tool_call=call(t)).allowed]
    record("narrowing full -> answer leaves answer + check", allowed == ["sieve_answer", "sieve_check"], f"got {allowed}")

    # 5. Expiry.
    short = broker.issue(human_identity="uid-alex", primary_identity=connector,
                         caveats=[tool_name_caveat(STEP_PATTERNS["answer"])], ttl_seconds=1)
    time.sleep(1.3)
    d = broker.authorize(short, presenting_identity=connector, proposed_tool_call=call("sieve_answer"))
    record("expired grant is denied", not d.allowed, getattr(d, "reason_code", "") or str(d))

    # 6. Revocation of the grant (root) also kills its narrowed children.
    broker.revocation_store.revoke_root(token.root_id)
    d1 = broker.authorize(token, presenting_identity=connector, proposed_tool_call=call("sieve_answer"))
    d2 = broker.authorize(narrowed, presenting_identity=connector, proposed_tool_call=call("sieve_answer"))
    record("revoked grant and its narrowed copy are denied", not d1.allowed and not d2.allowed)

    # 7. An argument constraint on 'question' would break sieve_check (it has no 'question'),
    #    because caveats AND together. Question length must be checked in code, not as a caveat.
    from ratchet_core import arg_constraint_caveat
    q = broker.issue(human_identity="uid-alex", primary_identity=connector,
                     caveats=[tool_name_caveat(STEP_PATTERNS["answer"]), arg_constraint_caveat("question", pattern=r"(?s).{1,500}")],
                     ttl_seconds=3600)
    d = broker.authorize(q, presenting_identity=connector, proposed_tool_call=call("sieve_check"))
    record("finding: a 'question' arg caveat blocks sieve_check (so keep it out of grants)", not d.allowed)

    # 8. Audit chain intact after sequential calls; tampering is detected.
    chain_ok = verify_audit_chain(tmp / "audit.jsonl")
    lines = (tmp / "audit.jsonl").read_text().splitlines()
    record("audit chain intact after sequential decisions", chain_ok, f"{len(lines)} entries")
    tampered = tmp / "tampered.jsonl"
    entries = [json.loads(x) for x in lines]
    entries[2]["decision"] = "allow" if entries[2].get("decision") != "allow" else "deny"
    tampered.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
    record("tampering with one entry is detected", not verify_audit_chain(tampered))

    # 9. Parallel calls against a file sink with no transaction: does the chain survive?
    #    This mimics several Cloud Function instances appending at once (why the Firestore
    #    sink must append inside a transaction on the head doc).
    par = Broker(secret=SECRET, audit_sink=JsonlAuditSink(tmp / "parallel.jsonl"))
    ptoken = par.issue(human_identity="uid-alex", primary_identity=connector,
                       caveats=[tool_name_caveat(STEP_PATTERNS["full"])], ttl_seconds=3600)

    def worker() -> None:
        for _ in range(25):
            par.authorize(ptoken, presenting_identity=connector, proposed_tool_call=call("sieve_answer"))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    par_ok = verify_audit_chain(tmp / "parallel.jsonl")
    n = len((tmp / "parallel.jsonl").read_text().splitlines())
    record("finding: parallel appends without a transaction", True,
           f"chain {'intact' if par_ok else 'BROKEN'} after {n} concurrent entries")

    # 10. Speed of one authorize() call.
    t0 = time.perf_counter()
    for _ in range(500):
        broker.authorize(narrowed, presenting_identity=connector, proposed_tool_call=call("sieve_check"))
    per = (time.perf_counter() - t0) / 500 * 1000
    record("authorize() cost", True, f"{per:.3f} ms per call")

    out = Path(__file__).resolve().parent.parent / "results"
    out.mkdir(exist_ok=True)
    (out / f"ratchet-{time.strftime('%Y%m%d-%H%M%S')}.json").write_text(json.dumps(results, indent=2))
    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")


if __name__ == "__main__":
    main()

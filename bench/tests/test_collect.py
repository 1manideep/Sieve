"""collect.py against a stand-in Firestore emulator REST API (no emulator needed)."""

import json

import httpx2

from sieve_bench.collect import Emulator, collect_run, decode_value, grant_config, link_hash, link_secret_from_url

SECRET = "A" * 40 + "b_-"
URL = f"http://127.0.0.1:5000/mcp/{SECRET}"


def s(v):
    return {"stringValue": v}


def stand_in(request: httpx2.Request) -> httpx2.Response:
    path = request.url.path
    assert request.headers["authorization"] == "Bearer owner"
    base = "/v1/projects/demo-bench/databases/(default)/documents/"
    rel = path[len(base):]
    if rel == f"connectors/{link_hash(SECRET)}":
        return httpx2.Response(200, json={"fields": {"uid": s("u1"), "grantId": s("g1"), "token": s("secret token")}})
    if rel == "users/u1/grants/g1":
        return httpx2.Response(200, json={"fields": {"aiName": s("Bench assistant"), "maxStep": s("full"),
                                                     "allowedCategories": {"arrayValue": {"values": [s("Home"), s("Money")]}},
                                                     "allowedSources": {"arrayValue": {"values": [s("playground")]}}}})
    if rel == "users/u1:runQuery":
        body = json.loads(request.content)
        assert body["structuredQuery"]["where"]["fieldFilter"]["value"] == s("g1")
        doc = lambda rid, ts: {"document": {"name": f"projects/p/databases/(default)/documents/users/u1/requests/{rid}",
                                            "fields": {"status": s("collected"), "createdAt": {"timestampValue": ts}, "response": {"mapValue": {"fields": {"text": s("payload")}}}}}}
        return httpx2.Response(200, json=[doc("r1", "2026-11-24T10:00:05.123Z"), doc("r0", "2026-11-23T10:00:00Z"), {"readTime": "x"}])
    if rel == "users/u1/receipts/r1":
        return httpx2.Response(200, json={"fields": {"requestId": s("r1"), "chars": {"integerValue": "57"}, "step": s("answer"),
                                                     "itemIds": {"arrayValue": {"values": [s("playground:pg-mail-02")]}}}})
    if rel == "audit/u1/entries":
        return httpx2.Response(200, json={"documents": [{"name": "a"}] * 7})
    return httpx2.Response(404, json={})


def emulator():
    client = httpx2.Client(transport=httpx2.MockTransport(stand_in), headers={"Authorization": "Bearer owner"})
    return Emulator("demo-bench", "127.0.0.1:8080", client=client)


def test_decoding_and_link_secret():
    assert decode_value({"mapValue": {"fields": {"n": {"integerValue": "3"}, "xs": {"arrayValue": {"values": [{"booleanValue": True}]}}}}}) == {"n": 3, "xs": [True]}
    assert link_secret_from_url(URL) == SECRET and link_secret_from_url("http://h/mcp/short") is None


def test_grant_and_run_collection():
    em = emulator()
    grant = grant_config(URL, project="demo-bench", emulator=em)
    assert grant == {"grantId": "g1", "aiName": "Bench assistant", "maxStep": "full", "allowedCategories": ["Home", "Money"], "allowedSources": ["playground"]}
    out = collect_run(URL, project="demo-bench", since="2026-11-24T10:00:00+00:00", until="2026-11-24T10:05:00+00:00", audit_before=5, emulator=em)
    assert [r["id"] for r in out["requests"]] == ["r1"]            # r0 is outside the run window
    assert "response" not in out["requests"][0]                    # payloads are never copied
    assert out["receipts"][0]["chars"] == 57 and out["audit_entries_total"] == 7 and out["audit_entries_run"] == 2

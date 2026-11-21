import json
from contextlib import asynccontextmanager

from starlette.testclient import TestClient

from sieve_bench.demo_client import build_app
from sieve_bench.fake_adapter import FakeAdapter
from sieve_bench.mcp_client import ToolOutcome


class OneAnswer:
    async def list_tools(self):
        return [{"name": "sieve_answer", "description": "d", "parameters": {"type": "object", "properties": {}}}]

    async def call(self, name, args):
        wire = {"status": "answered", "request_id": "R" * 20, "step": "answer", "text": "The deposit was $1,200.", "message": "m"}
        return ToolOutcome(text=json.dumps(wire), structured=wire)


@asynccontextmanager
async def fake_connect(url):
    yield OneAnswer()


def factory(task):
    return FakeAdapter([{"calls": [{"name": "sieve_answer", "args": {"question": task.question}}]}, {"text": "Your deposit was $1,200."}])


def test_page_is_plain_and_labelled():
    client = TestClient(build_app(url="http://127.0.0.1/mcp/x", adapter_factory=factory, connect_fn=fake_connect))
    page = client.get("/")
    assert "<title>Test assistant</title>" in page.text and "Local test setup, sample data" in page.text
    assert "default-src 'self'" in page.headers["content-security-policy"]
    assert "textContent" in client.get("/app.js").text and "innerHTML" not in client.get("/app.js").text


def test_ask_runs_the_loop_against_the_connector():
    client = TestClient(build_app(url="http://127.0.0.1/mcp/x", adapter_factory=factory, connect_fn=fake_connect, port=8766), base_url="http://127.0.0.1:8766")
    r = client.post("/ask", json={"question": "What did my landlord say about the deposit?"})
    assert r.status_code == 200 and r.json() == {"reply": "Your deposit was $1,200.", "used_connector": True, "stopped": None}
    assert client.post("/ask", json={"question": ""}).status_code == 400
    assert client.post("/ask", content=b"not json", headers={"content-type": "application/json"}).status_code == 400


def test_ask_refuses_cross_site_and_non_json_requests():
    app = build_app(url="http://127.0.0.1/mcp/x", adapter_factory=factory, connect_fn=fake_connect, port=8766)
    local = TestClient(app, base_url="http://127.0.0.1:8766")
    q = {"question": "What did my landlord say about the deposit?"}
    assert local.post("/ask", json=q, headers={"Origin": "http://127.0.0.1:8766"}).status_code == 200
    assert local.post("/ask", json=q, headers={"Origin": "https://evil.example"}).status_code == 403
    assert local.post("/ask", json=q, headers={"Origin": "null"}).status_code == 403
    assert local.post("/ask", content=json.dumps(q), headers={"Content-Type": "text/plain"}).status_code == 415
    assert TestClient(app, base_url="http://attacker.example:8766").post("/ask", json=q).status_code == 403   # DNS rebinding
    assert TestClient(app, base_url="http://127.0.0.1:9999").post("/ask", json=q).status_code == 403

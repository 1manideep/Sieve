"""The Gemini adapter with a stand-in client: request shapes, parsing, images and rate-limit waits. No network."""

from types import SimpleNamespace as NS

import pytest

from sieve_bench.agent import ToolReturn
from sieve_bench.gemini import (
    MAX_OUTPUT_TOKENS,
    SEED,
    GeminiAdapter,
    MissingConfig,
    public_settings,
    retry_seconds,
    settings_from_env,
)

TOOLS = [{"name": "read_file", "description": "Read one file.", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}]


def interaction(id, steps, usage=(120, 9), status="requires_action"):
    return NS(id=id, status=status, steps=steps, usage=NS(total_input_tokens=usage[0], total_output_tokens=usage[1]), output_text=None)


class StandInClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        self.interactions = self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


class RateLimited(Exception):
    status_code = 429
    body = '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": [{"retryDelay": "7s"}]}}'
    headers = {}


def test_start_and_send_build_the_documented_requests():
    client = StandInClient(
        [
            interaction("i1", [NS(type="thought"), NS(type="function_call", id="call-1", name="read_file", arguments={"id": "pg-photo-01"})]),
            interaction("i2", [NS(type="model_output", content=[NS(type="text", text="It was July 4.")])], status="completed"),
        ]
    )
    adapter = GeminiAdapter("gemini-test-flash", "key", client=client)
    first = adapter.start("system prompt", "Which day?", TOOLS)
    assert [(c.id, c.name, c.args) for c in first.calls] == [("call-1", "read_file", {"id": "pg-photo-01"})]
    assert first.text is None and first.usage == {"input": 120, "output": 9}
    req = client.requests[0]
    assert req["model"] == "gemini-test-flash" and req["system_instruction"] == "system prompt" and req["input"] == "Which day?"
    assert req["tools"] == [{"type": "function", **TOOLS[0]}]
    assert req["generation_config"] == {"temperature": 0.0, "max_output_tokens": MAX_OUTPUT_TOKENS, "seed": SEED}
    assert "previous_interaction_id" not in req

    second = adapter.send([ToolReturn("call-1", "read_file", '{"id": "pg-photo-01"}', [(b"\xff\xd8jpeg", "image/jpeg")])])
    assert second.text == "It was July 4." and second.calls == []
    req = client.requests[1]
    assert req["previous_interaction_id"] == "i1"
    step = req["input"][0]
    assert step["type"] == "function_result" and step["call_id"] == "call-1" and step["name"] == "read_file"
    assert step["result"][0] == {"type": "text", "text": '{"id": "pg-photo-01"}'}
    assert step["result"][1]["type"] == "image" and step["result"][1]["mime_type"] == "image/jpeg"


def test_separate_image_mode_sends_the_image_after_the_function_results():
    client = StandInClient([interaction("i1", [NS(type="function_call", id="c1", name="read_file", arguments={})]), interaction("i2", [], status="completed")])
    adapter = GeminiAdapter("m", "k", client=client, image_mode="separate")
    adapter.start("s", "u", TOOLS)
    adapter.send([ToolReturn("c1", "read_file", '{"id": "pg-photo-01"}', [(b"img", "image/jpeg")])])
    steps = client.requests[1]["input"]
    assert steps[0]["result"] == [{"type": "text", "text": '{"id": "pg-photo-01"}'}]
    assert steps[1]["type"] == "user_input"
    assert steps[1]["content"][0] == {"type": "text", "text": "Content of file pg-photo-01 returned by read_file."}
    assert steps[1]["content"][1]["type"] == "image"


def test_rate_limits_wait_for_the_retry_hint_and_are_reported():
    slept, waits = [], []
    client = StandInClient([RateLimited(), interaction("i1", [], status="completed")])
    adapter = GeminiAdapter("m", "k", client=client, sleep=slept.append)
    adapter.on_wait = lambda reason, s: waits.append((reason, s))
    adapter.start("s", "u", TOOLS)
    assert slept == [7.0] and waits == [("rate-limit", 7.0)]

    always = StandInClient([RateLimited() for _ in range(6)])
    adapter = GeminiAdapter("m", "k", client=always, sleep=lambda s: None)
    with pytest.raises(RateLimited):
        adapter.start("s", "u", TOOLS)
    assert len(always.requests) == 6   # the first try plus 5 retries


def test_retry_seconds_defaults_to_30():
    assert retry_seconds(Exception("quota")) == 30.0
    assert retry_seconds(Exception("Please retry in 12.5s.")) == 12.5


def test_settings_come_only_from_the_environment(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    with pytest.raises(MissingConfig):
        settings_from_env()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-flash")
    s = settings_from_env()
    assert s["model_id"] == "gemini-test-flash"
    assert "test-key-not-real" not in str(public_settings(s))

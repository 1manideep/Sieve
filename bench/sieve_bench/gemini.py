"""ModelAdapter for the Gemini API (60 section 4.9.2).

Uses the `google-genai` SDK's Interactions API with manual function calling (the runner, not
the SDK, executes every call): `client.interactions.create(model=..., input=..., tools=[{"type":
"function", ...}])`, reading `function_call` steps, and sending `function_result` steps with
`previous_interaction_id`. Function results carry images as image subcontent; with
`GEMINI_IMAGE_MODE=separate` an image is sent instead as a user input step right after the
function results, preceded by "Content of file {id} returned by read_file." It is counted the
same way either way, because counting happens in the runner.

Configuration comes only from the environment (bench/.env is git-ignored):
- `GEMINI_API_KEY`  required, never written to any file the bench produces
- `GEMINI_MODEL`    required, no default (the exact id goes into every run manifest)
- `GEMINI_IMAGE_MODE` optional, `in-result` (default) or `separate`
- `GEMINI_THINKING_LEVEL` optional, passed through as `generation_config.thinking_level`
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
from collections.abc import Callable
from typing import Any

from .agent import ToolCall, ToolReturn, ToolSpec, Turn

TEMPERATURE = 0.0
MAX_OUTPUT_TOKENS = 512
SEED = 20261116
MAX_RETRIES = 5
DEFAULT_RETRY_SECONDS = 30.0
IMAGE_MODES = ("in-result", "separate")

_RETRY_DELAY = re.compile(r'retry[_ ]?delay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s', re.IGNORECASE)
_RETRY_IN = re.compile(r"retry in (\d+(?:\.\d+)?)\s*s", re.IGNORECASE)


class MissingConfig(RuntimeError):
    pass


def settings_from_env() -> dict:
    model = os.environ.get("GEMINI_MODEL", "").strip()
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    missing = [name for name, value in (("GEMINI_API_KEY", key), ("GEMINI_MODEL", model)) if not value]
    if missing:
        raise MissingConfig(
            f"Set {' and '.join(missing)} in bench/.env (git-ignored) or the environment. "
            "GEMINI_MODEL has no default: use the newest Flash-class model the AI Studio rate-limit page lists for the free tier."
        )
    image_mode = os.environ.get("GEMINI_IMAGE_MODE", "in-result").strip() or "in-result"
    if image_mode not in IMAGE_MODES:
        raise MissingConfig(f"GEMINI_IMAGE_MODE must be one of {', '.join(IMAGE_MODES)}")
    thinking = os.environ.get("GEMINI_THINKING_LEVEL", "").strip() or None
    return {"model_id": model, "api_key": key, "image_mode": image_mode, "thinking_level": thinking}


def public_settings(settings: dict) -> dict:
    """What goes into a run manifest (never the key)."""
    return {
        "model_id": settings["model_id"],
        "image_mode": settings["image_mode"],
        "thinking_level": settings["thinking_level"],
        "temperature": TEMPERATURE,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "seed": SEED,
        "api": "interactions",
    }


def is_rate_limit(e: BaseException) -> bool:
    code = getattr(e, "status_code", None) or getattr(e, "code", None)
    if code == 429:
        return True
    text = str(e)
    return "RESOURCE_EXHAUSTED" in text or ("429" in text and "quota" in text.lower())


def retry_seconds(e: BaseException) -> float:
    headers = getattr(e, "headers", None)
    if headers is not None:
        try:
            value = headers.get("retry-after")
            if value:
                return max(1.0, float(value))
        except (TypeError, ValueError):
            pass
    for source in (getattr(e, "body", None), str(e)):
        if not source:
            continue
        for pattern in (_RETRY_DELAY, _RETRY_IN):
            m = pattern.search(str(source))
            if m:
                return max(1.0, float(m.group(1)))
    return DEFAULT_RETRY_SECONDS


def function_tools(tools: list[ToolSpec]) -> list[dict]:
    return [{"type": "function", "name": t["name"], "description": t["description"], "parameters": t["parameters"]} for t in tools]


def _file_id(text: str) -> str:
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return "?"
    return str(data.get("id", "?")) if isinstance(data, dict) else "?"


def result_steps(returns: list[ToolReturn], image_mode: str) -> list[dict]:
    """The `input` for the next interaction: one function_result step per call."""
    steps: list[dict] = []
    separate: list[dict] = []
    for r in returns:
        result: list[dict] = [{"type": "text", "text": r.text}]
        for data, mime in r.images:
            image = {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mime_type": mime}
            if image_mode == "in-result":
                result.append(image)
            else:
                separate.append({"type": "text", "text": f"Content of file {_file_id(r.text)} returned by {r.name}."})
                separate.append(image)
        steps.append({"type": "function_result", "name": r.name, "call_id": r.call_id, "result": result})
    if separate:
        steps.append({"type": "user_input", "content": separate})
    return steps


class GeminiAdapter:
    def __init__(
        self,
        model_id: str,
        api_key: str,
        *,
        image_mode: str = "in-result",
        thinking_level: str | None = None,
        client: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if client is None:
            from google import genai

            client = genai.Client(api_key=api_key)
        self.model_id = model_id
        self._client = client
        self._image_mode = image_mode
        self._thinking_level = thinking_level
        self._sleep = sleep
        self.on_wait: Callable[[str, float], None] | None = None
        self._system = ""
        self._tools: list[dict] = []
        self._last_id: str | None = None
        self._seen_calls: set[str] = set()

    @classmethod
    def from_env(cls) -> GeminiAdapter:
        s = settings_from_env()
        return cls(s["model_id"], s["api_key"], image_mode=s["image_mode"], thinking_level=s["thinking_level"])

    def start(self, system: str, user: str, tools: list[ToolSpec]) -> Turn:
        self._system = system
        self._tools = function_tools(tools)
        self._last_id = None
        self._seen_calls = set()
        return self._turn(self._create(input=user))

    def send(self, returns: list[ToolReturn]) -> Turn:
        return self._turn(self._create(input=result_steps(returns, self._image_mode), previous_interaction_id=self._last_id))

    def _generation_config(self) -> dict:
        config: dict[str, Any] = {"temperature": TEMPERATURE, "max_output_tokens": MAX_OUTPUT_TOKENS, "seed": SEED}
        if self._thinking_level:
            config["thinking_level"] = self._thinking_level
        return config

    def _create(self, **kwargs: Any) -> Any:
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        attempt = 0
        while True:
            try:
                return self._client.interactions.create(
                    model=self.model_id,
                    system_instruction=self._system,
                    tools=self._tools,
                    generation_config=self._generation_config(),
                    **kwargs,
                )
            except Exception as e:
                if not is_rate_limit(e) or attempt >= MAX_RETRIES:
                    raise
                attempt += 1
                seconds = retry_seconds(e)
                if self.on_wait is not None:
                    self.on_wait("rate-limit", seconds)
                self._sleep(seconds)

    def _turn(self, interaction: Any) -> Turn:
        status = str(getattr(interaction, "status", "") or "")
        if status.lower() in ("failed", "cancelled"):
            raise RuntimeError(f"Gemini interaction {status}: {getattr(interaction, 'errors', None)}")
        self._last_id = getattr(interaction, "id", None) or self._last_id
        calls: list[ToolCall] = []
        texts: list[str] = []
        for step in getattr(interaction, "steps", None) or []:
            kind = getattr(step, "type", None)
            if kind == "function_call":
                call_id = str(getattr(step, "id", "") or f"call-{len(self._seen_calls) + 1}")
                if call_id in self._seen_calls:
                    continue
                self._seen_calls.add(call_id)
                calls.append(ToolCall(id=call_id, name=step.name, args=dict(getattr(step, "arguments", None) or {})))
            elif kind == "model_output":
                for content in getattr(step, "content", None) or []:
                    if getattr(content, "type", None) == "text" and getattr(content, "text", None):
                        texts.append(content.text)
        text = "\n".join(texts) if texts else (getattr(interaction, "output_text", None) or None)
        usage_obj = getattr(interaction, "usage", None)
        usage = {
            "input": getattr(usage_obj, "total_input_tokens", None),
            "output": getattr(usage_obj, "total_output_tokens", None),
        }
        return Turn(text=text, calls=calls, usage=usage)

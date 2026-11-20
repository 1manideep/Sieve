"""A scripted model adapter for tests and rehearsals (60 section 4.9.2).

It replays fixed turns, so a run is deterministic. A set that contains a scripted run is a
rehearsal: the report labels it and never writes its numbers into the README.

Script format (JSON): `{"T01": [turn, ...], ...}` where a turn is
`{"text": str | null, "calls": [{"id"?: str, "name": str, "args": {...}}], "usage"?: {"input": n, "output": n}}`.
After the last scripted turn the adapter answers with no calls, which ends the task.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .agent import AdapterFactory, Task, ToolCall, ToolReturn, ToolSpec, Turn

FAKE_MODEL_ID = "fake-scripted"


class FakeAdapter:
    def __init__(self, turns: Sequence[Mapping[str, Any] | Turn], model_id: str = FAKE_MODEL_ID):
        self.model_id = model_id
        self._turns = [t if isinstance(t, Turn) else _turn(t, i) for i, t in enumerate(turns)]
        self._next = 0
        self.system: str | None = None
        self.user: str | None = None
        self.tools: list[ToolSpec] = []
        self.received: list[list[ToolReturn]] = []

    def start(self, system: str, user: str, tools: list[ToolSpec]) -> Turn:
        self.system, self.user, self.tools = system, user, list(tools)
        self._next = 0
        self.received = []
        return self._take()

    def send(self, returns: list[ToolReturn]) -> Turn:
        self.received.append(list(returns))
        return self._take()

    def _take(self) -> Turn:
        if self._next >= len(self._turns):
            return Turn(text=None, calls=[], usage={"input": 0, "output": 0})
        turn = self._turns[self._next]
        self._next += 1
        return turn


def _turn(data: Mapping[str, Any], index: int) -> Turn:
    calls = []
    for j, c in enumerate(data.get("calls") or []):
        calls.append(ToolCall(id=str(c.get("id") or f"c{index + 1}-{j + 1}"), name=c["name"], args=dict(c.get("args") or {})))
    usage = dict(data.get("usage") or {"input": 0, "output": 0})
    return Turn(text=data.get("text"), calls=calls, usage=usage)


def load_script(path: Path) -> dict[str, list[dict]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("A fake script is a JSON object keyed by task id")
    return {str(k).upper(): list(v) for k, v in data.items() if not str(k).startswith("_")}


def factory_from_script(script: Mapping[str, Sequence[Mapping[str, Any]]]) -> AdapterFactory:
    def make(task: Task) -> FakeAdapter:
        turns = script.get(task.id)
        if turns is None:
            turns = [{"text": f"No scripted turns for {task.id}.", "calls": []}]
        return FakeAdapter(turns)

    return make

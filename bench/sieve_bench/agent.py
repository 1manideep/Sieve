"""The model-agnostic loop (60 section 4.9.1) and the run driver.

Per task: connect to the arm's MCP server, list its tools, give them to the model as plain
function declarations, execute every call the model makes, hand back the exact tool result
text (and images), and log everything at that boundary. The system prompt is identical in
both arms and does not mention Sieve or privacy.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, TypedDict

import anyio
import anyio.to_thread

if TYPE_CHECKING:
    from .log import Transcript
    from .mcp_client import ToolOutcome

SYSTEM_PROMPT = (
    "You are a personal assistant. The user's email, files and photos are reachable only through the tools you "
    "have. Use the tools to answer the user's question. When you have the answer, reply in at most two sentences. "
    "If the tools cannot give you the answer, say so in one sentence. Do not make up details."
)

CHECK_TOOL = "sieve_check"
SKIPPED_TEXT = {
    "tool-limit": "Not run: this task reached its limit of tool calls.",
    "check-limit": "Not run: this task reached its limit of sieve_check calls.",
}


# ---- Model adapter (60 section 4.9.2) -------------------------------------------------------

class ToolSpec(TypedDict):
    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class ToolReturn:
    call_id: str
    name: str
    text: str
    images: list[tuple[bytes, str]]      # (data, mime type)


@dataclass
class Turn:
    text: str | None
    calls: list[ToolCall]
    usage: dict                          # input and output token counts as the API reports them


class ModelAdapter(Protocol):
    model_id: str
    def start(self, system: str, user: str, tools: list[ToolSpec]) -> Turn: ...
    def send(self, returns: list[ToolReturn]) -> Turn: ...


class ToolBox(Protocol):
    async def list_tools(self) -> list[ToolSpec]: ...
    async def call(self, name: str, args: dict) -> ToolOutcome: ...


# ---- Tasks ------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Task:
    id: str
    question: str
    item_desc: str
    item_id: str | None
    category: str
    expect_kind: str                     # 'answer' | 'not-found' | 'refusal'
    expect: list[list[str]]


def load_tasks(path: Path, only: list[str] | None = None) -> list[Task]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    tasks = [
        Task(
            id=t["id"],
            question=t["question"],
            item_desc=t.get("item_desc", ""),
            item_id=t.get("item_id") or None,
            category=t.get("category", ""),
            expect_kind=t.get("expect_kind", "answer"),
            expect=[list(g) for g in t.get("expect", [])],
        )
        for t in data["tasks"]
    ]
    if only:
        wanted = [x.strip().upper() for x in only if x.strip()]
        unknown = [x for x in wanted if x not in {t.id for t in tasks}]
        if unknown:
            raise ValueError(f"Unknown task ids: {', '.join(unknown)}")
        tasks = [t for t in tasks if t.id in wanted]
    return tasks


# ---- Limits -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Limits:
    tool_calls: int = 10
    model_turns: int = 12
    task_seconds: float = 300.0
    pending_wait_seconds: float = 20.0   # before the next sieve_check after a pending result
    max_checks: int = 3                  # sieve_check calls per task

    def to_dict(self) -> dict:
        return {
            "tool_calls": self.tool_calls,
            "model_turns": self.model_turns,
            "task_seconds": self.task_seconds,
            "pending_wait_seconds": self.pending_wait_seconds,
            "max_checks": self.max_checks,
        }


@dataclass
class TaskEnd:
    task: str
    final: str | None
    stopped: str | None                  # None | 'tool-limit' | 'turn-limit' | 'check-limit' | 'timeout' | 'error'
    tool_calls: int
    ms: int


def image_record(data: bytes, mime: str) -> dict:
    return {"mime": mime, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def sieve_status(outcome: ToolOutcome) -> tuple[str | None, str | None]:
    from .mcp_client import sieve_fields

    fields = sieve_fields(outcome)
    status = fields.get("status")
    step = fields.get("step")
    return (status if isinstance(status, str) else None, step if isinstance(step, str) else None)


async def run_task(
    task: Task,
    *,
    model: ModelAdapter,
    tools: ToolBox,
    log: Transcript,
    arm: str,
    run_id: str,
    limits: Limits = Limits(),
    sleep: Callable[[float], Awaitable[Any]] = anyio.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> TaskEnd:
    log.event({"ev": "task_start", "run": run_id, "arm": arm, "task": task.id, "ts": int(time.time() * 1000)})
    t0 = monotonic()
    if hasattr(model, "on_wait"):
        model.on_wait = lambda reason, seconds: log.event(  # type: ignore[attr-defined]
            {"ev": "wait", "task": task.id, "reason": reason, "seconds": seconds}
        )

    turn: Turn | None = None
    n = 0
    calls_done = 0
    checks = 0
    pending = False
    stopped: str | None = None

    def log_turn(t: Turn) -> None:
        log.event(
            {
                "ev": "model_turn",
                "task": task.id,
                "n": n,
                "text": t.text,
                "calls": [{"id": c.id, "name": c.name, "args": c.args} for c in t.calls],
                "usage": t.usage,
            }
        )

    async def model_call(fn: Callable[..., Turn], *args: Any) -> Turn:
        return await anyio.to_thread.run_sync(lambda: fn(*args), abandon_on_cancel=True)

    try:
        with anyio.move_on_after(limits.task_seconds) as scope:
            specs = await tools.list_tools()
            turn = await model_call(model.start, SYSTEM_PROMPT, task.question, specs)
            n = 1
            log_turn(turn)
            while turn.calls:
                if n >= limits.model_turns:
                    stopped = "turn-limit"
                    break
                if calls_done >= limits.tool_calls:
                    stopped = "tool-limit"
                    break
                if checks >= limits.max_checks and all(c.name == CHECK_TOOL for c in turn.calls):
                    stopped = "check-limit"
                    break
                returns: list[ToolReturn] = []
                for call in turn.calls:
                    skip = None
                    if calls_done >= limits.tool_calls:
                        skip = "tool-limit"
                    elif call.name == CHECK_TOOL and checks >= limits.max_checks:
                        skip = "check-limit"
                    if skip:
                        # Every call gets a reply, but a skipped call returns no data, so it is not counted.
                        log.event({"ev": "tool_skipped", "task": task.id, "call_id": call.id, "tool": call.name, "reason": skip})
                        returns.append(ToolReturn(call.id, call.name, SKIPPED_TEXT[skip], []))
                        continue
                    if call.name == CHECK_TOOL:
                        checks += 1
                        if pending:
                            log.event({"ev": "wait", "task": task.id, "reason": "pending", "seconds": limits.pending_wait_seconds})
                            await sleep(limits.pending_wait_seconds)
                        pending = False
                    outcome = await tools.call(call.name, dict(call.args or {}))
                    calls_done += 1
                    status, step = sieve_status(outcome) if arm == "sieve" else (None, None)
                    if status == "pending":
                        pending = True
                    event = {
                        "ev": "tool_result",
                        "task": task.id,
                        "call_id": call.id,
                        "tool": call.name,
                        "text": outcome.text,
                        "chars": len(outcome.text),
                        "images": [image_record(d, m) for d, m in outcome.images],
                        "status": status,
                        "step": step,
                        "ms": outcome.ms,
                        "is_error": outcome.is_error,
                    }
                    if arm == "sieve" and outcome.structured is not None:
                        event["structured"] = outcome.structured
                    log.event(event)
                    returns.append(ToolReturn(call.id, call.name, outcome.text, list(outcome.images)))
                turn = await model_call(model.send, returns)
                n += 1
                log_turn(turn)
        if scope.cancelled_caught:
            stopped = "timeout"
    except Exception as e:  # a model or connection failure ends this task, not the run
        stopped = "error"
        log.event({"ev": "error", "task": task.id, "message": f"{type(e).__name__}: {e}"[:2000]})

    end = TaskEnd(
        task=task.id,
        final=turn.text if turn is not None else None,
        stopped=stopped,
        tool_calls=calls_done,
        ms=int((monotonic() - t0) * 1000),
    )
    log.event({"ev": "task_end", "task": task.id, "final": end.final, "stopped": end.stopped, "tool_calls": end.tool_calls, "ms": end.ms})
    return end


# ---- Running a set of runs ------------------------------------------------------------------

AdapterFactory = Callable[[Task], ModelAdapter]
ToolsFactory = Callable[[str], Any]      # run id -> async context manager yielding a ToolBox


@dataclass
class RunPlan:
    arm: str
    set_dir: Path
    run_id: str
    tasks: list[Task]
    adapter_factory: AdapterFactory
    tools_factory: ToolsFactory
    limits: Limits = field(default_factory=Limits)


async def run_tasks(plan: RunPlan, log: Transcript, *, sleep: Callable[[float], Awaitable[Any]] = anyio.sleep) -> list[TaskEnd]:
    ends: list[TaskEnd] = []
    for task in plan.tasks:
        model = plan.adapter_factory(task)
        end: TaskEnd | None = None
        try:
            async with plan.tools_factory(plan.run_id) as tools:
                end = await run_task(
                    task, model=model, tools=tools, log=log, arm=plan.arm, run_id=plan.run_id, limits=plan.limits, sleep=sleep
                )
        except Exception as e:
            message = f"{type(e).__name__}: {e}"[:2000]
            if end is None:  # the connection itself failed: record the task as an error
                log.event({"ev": "task_start", "run": plan.run_id, "arm": plan.arm, "task": task.id, "ts": int(time.time() * 1000)})
                log.event({"ev": "error", "task": task.id, "message": message})
                log.event({"ev": "task_end", "task": task.id, "final": None, "stopped": "error", "tool_calls": 0, "ms": 0})
                end = TaskEnd(task.id, None, "error", 0, 0)
            else:  # the task finished; only closing the connection failed
                log.event({"ev": "warning", "task": task.id, "message": f"Closing the connection failed: {message}"})
        ends.append(end)
    return ends

"""Pydantic 2 mirrors of the contract types (01 sections 2, 3 and 8; 30 section 4).

Firestore documents use camelCase aliases; ToolResult stays snake_case because it is MCP output.
String limits count UTF-16 code units (config.utf16_len), the one unit used across Sieve.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from .config import MAX_PAYLOAD_CHARS, utf16_len

LadderStep = Literal["answer", "excerpt", "full"]
Category = Literal["Home", "Work", "Money", "Health", "Travel", "Shopping", "Personal", "Newsletters", "Photos"]
SourceKind = Literal["gmail", "folder", "upload", "playground"]
ToolName = Literal["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"]
RequestStatus = Literal["queued", "claimed", "awaiting-person", "answered", "declined", "blocked", "no-match",
                        "unsupported", "collected", "expired", "revoked", "offline", "error"]
ReceiptStatus = Literal["pending-collection", "delivered", "declined", "blocked", "revoked", "expired"]
ToolStatus = Literal["answered", "pending", "declined", "blocked", "no-match", "unsupported", "offline", "expired",
                     "unknown", "not-allowed", "error"]

SHARED_IMAGE_MAX_BYTES = 600 * 1024            # 01 section 11.7: at most 600 KB JPEG
SHARED_IMAGE_MAX_BASE64 = 819_200              # base64 of 600 KB


class FsModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="ignore")

    def to_firestore(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


class OutsideRequester(FsModel):
    kind: Literal["outside"] = "outside"
    grant_id: str
    ai_name: str


class SharedImage(FsModel):
    mime: Literal["image/jpeg"]
    base64: str = Field(min_length=4, max_length=SHARED_IMAGE_MAX_BASE64)
    width: int = Field(ge=1, le=10_000)
    height: int = Field(ge=1, le=10_000)
    bytes: int = Field(ge=1, le=SHARED_IMAGE_MAX_BYTES)


class RelayPayload(FsModel):
    step: LadderStep
    text: str
    chars: int = Field(ge=1, le=MAX_PAYLOAD_CHARS)
    item_count: int = Field(ge=1, le=20)
    image: SharedImage | None = None

    @field_validator("text")
    @classmethod
    def _text_units(cls, v: str) -> str:
        if not 1 <= utf16_len(v) <= MAX_PAYLOAD_CHARS:
            raise ValueError("text must be 1 to 8000 UTF-16 code units")
        return v


class QueryHints(FsModel):            # 01 QueryHints; functions write only these five fields
    after: str | None = None           # 'YYYY-MM-DD', inclusive
    before: str | None = None          # 'YYYY-MM-DD', inclusive
    source: Literal["mail", "files", "photos"] | None = None
    from_: str | None = Field(default=None, alias="from")   # explicit alias wins over to_camel
    terms: list[str] | None = None     # 1 to 5 entries
    # 'interpreted' is set only by the in-app parser (20-index); never by functions


class RelayRequest(FsModel):
    requester: OutsideRequester
    tool: ToolName
    requested_step: LadderStep
    max_step: LadderStep
    allowed_categories: list[Category]
    allowed_sources: list[SourceKind]
    question: str
    hints: QueryHints | None = None
    status: RequestStatus
    created_at: datetime
    claimed_at: datetime | None = None
    answered_at: datetime | None = None
    collected_at: datetime | None = None
    expire_at: datetime
    claimed_by: str | None = None
    response: RelayPayload | None = None
    message: str | None = None
    idempotency_key: str | None = None   # sha256 hex of the scoped key (30 section 9.4); never the client's raw text


class GrantMeta(FsModel):
    ai_name: str
    max_step: LadderStep
    allowed_categories: list[Category]
    allowed_sources: list[SourceKind]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None
    link_hint: str


class ConnectorIdentity(FsModel):
    agent_id: str          # "grant-<grantId>"
    fingerprint: str       # Ratchet fingerprint: first 16 hex chars of sha256(raw public key)


class ConnectorDoc(FsModel):           # connectors/{linkHash} (30 CCR 1)
    uid: str
    grant_id: str
    token: str                         # serialize_token() output
    identity: ConnectorIdentity
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    revoked_root_ids: list[str] = Field(default_factory=list)
    revoked_token_ids: list[str] = Field(default_factory=list)
    rate_window_start: datetime | None = None
    rate_count: int = 0


class Receipt(FsModel):                # read-only here; functions only change `status`
    id: str
    request_id: str
    requester: dict[str, Any]
    question: str
    step: LadderStep | None = None
    item_refs: list[str]               # 01 section 11.8: HMAC-SHA256(localSalt, recordId) hex, never ids or paths
    status: ReceiptStatus
    decided_by: Literal["app", "extension", "rule"] | None = None
    chars: int
    created_at: datetime


class ToolResult(BaseModel):           # MCP structuredContent; snake_case on purpose
    status: ToolStatus
    request_id: str | None = None
    step: LadderStep | None = None
    text: str | None = None
    message: str
    image: SharedImage | None = Field(default=None, exclude=True)   # delivered as an image content block only

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)

"""Loads data/playground into Item objects (60 section 4.5).

The dataset format belongs to 20 (section 19.1): `emails.json` ({version, emails: SeedEmail[]}),
`documents/documents.json` (SeedDocument[]), `photos/photos.json` (SeedPhoto[]) and
`captions.json` ({photoId: {caption, ...}}). If those field names change, only this file changes.

The loader is tolerant: a missing optional file gives no items of that kind, a bare list is
accepted where an object with a list is expected, and ids may carry the index prefix
`playground:` (it is stripped).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from . import REPO_DIR
from .htmltext import html_to_text

ID_PREFIX = "playground:"
DEFAULT_TO = "Alex Rivera <alex.rivera@inbox.example>"

_MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
}
_SKIP_NAMES = {".DS_Store"}
# Git-ignored photo originals (20 section 19.4) and tool folders; hidden paths are skipped too.
_SKIP_DIRS = {"originals", "__pycache__", "node_modules"}


class DatasetMissing(FileNotFoundError):
    """data/playground is absent or holds no items."""


@dataclass(frozen=True)
class Item:
    id: str                 # the seed id the index uses, without the `playground:` prefix
    kind: Literal["email", "document", "photo"]
    title: str              # subject or file name
    sender: str | None
    to: str | None
    date: str               # ISO 8601
    category: str           # the seed category
    text: str               # body as a typical connector returns it (htmltext rule); '' for photos
    raw_html: str | None
    path: Path | None       # documents and photos
    mime: str | None
    caption: str | None     # photos: the seed caption (consistency checks only, never served by the baseline)

    def file_bytes(self) -> bytes:
        if self.path is None:
            raise ValueError(f"{self.id} has no file")
        return self.path.read_bytes()

    def size_bytes(self) -> int:
        if self.path is not None and self.path.exists():
            return self.path.stat().st_size
        return len(self.text.encode("utf-8"))


@dataclass(frozen=True)
class Dataset:
    root: Path
    items: tuple[Item, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "_by_id", {i.id: i for i in self.items})

    def __len__(self) -> int:
        return len(self.items)

    def __iter__(self) -> Iterator[Item]:
        return iter(self.items)

    def get(self, item_id: str) -> Item | None:
        return self._by_id.get(normalize_id(item_id))  # type: ignore[attr-defined]

    @property
    def emails(self) -> list[Item]:
        return [i for i in self.items if i.kind == "email"]

    @property
    def files(self) -> list[Item]:
        return [i for i in self.items if i.kind in ("document", "photo")]


def normalize_id(item_id: str) -> str:
    item_id = str(item_id).strip()
    return item_id[len(ID_PREFIX):] if item_id.startswith(ID_PREFIX) else item_id


def default_data_dir() -> Path:
    override = os.environ.get("SIEVE_BENCH_DATA", "").strip()
    return Path(override).expanduser().resolve() if override else REPO_DIR / "data" / "playground"


def mime_for(name: str) -> str:
    return _MIME_BY_EXT.get(Path(name).suffix.lower(), "application/octet-stream")


def snippet(text: str, limit: int = 200) -> str:
    """The first `limit` characters of the text with whitespace collapsed, like a mail snippet."""
    return " ".join(text.split())[:limit]


def load(root: Path | str | None = None) -> Dataset:
    root = Path(root).expanduser().resolve() if root is not None else default_data_dir()
    if not root.is_dir():
        raise DatasetMissing(f"No dataset folder at {root}")
    items: list[Item] = []
    items.extend(_load_emails(root))
    items.extend(_load_documents(root))
    items.extend(_load_photos(root))
    if not items:
        raise DatasetMissing(f"The dataset folder {root} has no emails, documents or photos")
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            raise ValueError(f"Duplicate item id {item.id} in {root}")
        seen.add(item.id)
    return Dataset(root=root, items=tuple(items))


def is_available(root: Path | str | None = None) -> bool:
    try:
        load(root)
    except (DatasetMissing, ValueError, json.JSONDecodeError):
        return False
    return True


def dataset_sha256(root: Path | str) -> str:
    """SHA-256 over the sorted file list and the contents (run manifests tie a number to the data)."""
    root = Path(root)
    h = hashlib.sha256()
    for path in sorted(_dataset_files(root)):
        rel = path.relative_to(root).as_posix()
        h.update(rel.encode("utf-8") + b"\0")
        h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


def placeholder_photos(root: Path | str) -> list[str]:
    """Photos the dataset build still drew as placeholders (`manifest.json` photos.placeholders, the list
    check:repo warns about). Empty when the manifest is absent or lists none."""
    path = Path(root) / "manifest.json"
    try:
        data = _read_json(path)
    except (OSError, ValueError):
        return []
    photos = data.get("photos") if isinstance(data, dict) else None
    names = photos.get("placeholders") if isinstance(photos, dict) else None
    return sorted(str(n) for n in names) if isinstance(names, list) else []


def _dataset_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file() or path.name in _SKIP_NAMES:
            continue
        parts = path.relative_to(root).parts
        if any(part in _SKIP_DIRS or part.startswith(".") for part in parts):
            continue
        yield path


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _list_from(data: Any, key: str) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    raise ValueError(f"Expected a list or an object with '{key}'")


def _load_emails(root: Path) -> list[Item]:
    path = root / "emails.json"
    if not path.exists():
        return []
    out: list[Item] = []
    for e in _list_from(_read_json(path), "emails"):
        html = e.get("html") or None
        text = e.get("text") or ""
        if not text and html:
            text = html_to_text(html)
        out.append(
            Item(
                id=normalize_id(e["id"]),
                kind="email",
                title=e.get("subject", ""),
                sender=e.get("from"),
                to=e.get("to") or DEFAULT_TO,
                date=e.get("date", ""),
                category=e.get("category", ""),
                text=text,
                raw_html=html,
                path=None,
                mime=None,
                caption=None,
            )
        )
    return out


def _document_text(root: Path, file: str) -> str:
    path = root / "documents" / file
    if Path(file).suffix.lower() == ".pdf":
        # The PDFs are rendered from documents/src/<stem>.txt (20 section 19.3), which is exactly
        # the text a file connector extracts from them.
        src = root / "documents" / "src" / (Path(file).stem + ".txt")
        return src.read_text(encoding="utf-8") if src.exists() else ""
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _load_documents(root: Path) -> list[Item]:
    path = root / "documents" / "documents.json"
    if not path.exists():
        return []
    out: list[Item] = []
    for d in _list_from(_read_json(path), "documents"):
        file = d["file"]
        out.append(
            Item(
                id=normalize_id(d["id"]),
                kind="document",
                title=Path(file).name,
                sender=None,
                to=None,
                date=d.get("date", ""),
                category=d.get("category", ""),
                text=_document_text(root, file),
                raw_html=None,
                path=root / "documents" / file,
                mime=mime_for(file),
                caption=None,
            )
        )
    return out


def _captions(root: Path) -> dict[str, str]:
    path = root / "captions.json"
    if not path.exists():
        return {}
    data = _read_json(path)
    out: dict[str, str] = {}
    if isinstance(data, dict):
        for key, value in data.items():
            caption = value.get("caption") if isinstance(value, dict) else value
            if isinstance(caption, str):
                out[normalize_id(key)] = caption
    return out


def _load_photos(root: Path) -> list[Item]:
    path = root / "photos" / "photos.json"
    if not path.exists():
        return []
    captions = _captions(root)
    out: list[Item] = []
    for p in _list_from(_read_json(path), "photos"):
        file = p["file"]
        pid = normalize_id(p["id"])
        out.append(
            Item(
                id=pid,
                kind="photo",
                title=Path(file).name,
                sender=None,
                to=None,
                date=p.get("date", ""),
                category=p.get("category", "Photos"),
                text="",
                raw_html=None,
                path=root / "photos" / file,
                mime=mime_for(file),
                caption=captions.get(pid),
            )
        )
    return out


# ---- Consistency with tasks.json and canaries.json (60 section 4.15, `check-dataset`) ---------

_WIFI_PASSWORD = re.compile(
    r"\bwi-?fi\b\W+(?:\w+\W+){0,3}?password|\bpassword\b\W+(?:\w+\W+){0,3}?wi-?fi\b", re.IGNORECASE
)


def _collapsed(text: str) -> str:
    return " ".join(text.lower().split())


def date_forms(iso: str) -> list[str]:
    """The item's date written the ways an answer would write it."""
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return [iso] if iso else []
    month, mon = d.strftime("%B"), d.strftime("%b")
    return [
        f"{month} {d.day}", f"{mon} {d.day}", f"{month} {d.day}, {d.year}", f"{mon} {d.day}, {d.year}",
        d.date().isoformat(), f"{d.month}/{d.day}/{d.year}",
    ]


def item_haystack(item: Item) -> str:
    parts = [item.title, item.text, item.raw_html or "", item.caption or "", *date_forms(item.date)]
    return _collapsed("\n".join(parts))


def check_dataset(dataset: Dataset, tasks: Iterable[Any], canaries: Iterable[Any]) -> list[str]:
    """Problems that would make a task or a canary wrong for this dataset. Empty means consistent."""
    problems: list[str] = []
    for task in tasks:
        if not task.item_id:
            continue
        item = dataset.get(task.item_id)
        if item is None:
            problems.append(f"{task.id}: item {task.item_id} is not in the dataset")
            continue
        if task.category and item.category != task.category:
            problems.append(f"{task.id}: item {item.id} has category {item.category}, tasks.json says {task.category}")
        if task.expect_kind == "answer":
            hay = item_haystack(item)
            for group in task.expect:
                if not any(_collapsed(alt) in hay for alt in group):
                    problems.append(f"{task.id}: none of {group} is in {item.id}'s title, text, caption or date")
        hay = item_haystack(item)
        for word in getattr(task, "forbid", ()) or ():
            if _collapsed(word) not in hay:
                problems.append(f"{task.id}: forbidden word '{word}' is not in {item.id}, so it cannot show the item leaked")
    for canary in canaries:
        item = dataset.get(canary.item_id) if canary.item_id else None
        if item is None:
            problems.append(f"canary '{canary.item_desc}': item {canary.item_id} is not in the dataset")
            continue
        source = _collapsed(f"{item.raw_html or ''}\n{item.text}")
        for phrase in canary.phrases:
            if _collapsed(phrase) not in source:
                problems.append(f"canary '{canary.item_desc}': phrase '{phrase}' is not in {item.id}")
        for target in canary.target_items:
            if dataset.get(target) is None:
                problems.append(f"canary '{canary.item_desc}': target item {target} is not in the dataset")
    for item in dataset:
        for field_text in (item.title, item.text, item.raw_html or "", item.caption or ""):
            if _WIFI_PASSWORD.search(field_text):
                problems.append(f"{item.id} mentions a wifi password, so T10 would have an answer")
                break
    return problems

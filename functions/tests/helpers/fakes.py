"""Small in-memory stand-ins for unit tests (no emulator)."""
from __future__ import annotations

import itertools
from typing import Any

_ids = itertools.count(1)


class FakeSnap:
    def __init__(self, ref: "FakeDocRef", data: dict[str, Any] | None) -> None:
        self.reference = ref
        self.id = ref.id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return dict(self._data) if self._data is not None else None

    def get(self, key: str) -> Any:
        return (self._data or {})[key]


class FakeDocRef:
    def __init__(self, db: "FakeDb", path: str) -> None:
        self._db = db
        self.path = path
        self.id = path.rsplit("/", 1)[-1]

    def get(self, transaction: Any = None) -> FakeSnap:
        return FakeSnap(self, self._db.docs.get(self.path))

    def set(self, data: dict[str, Any]) -> None:
        self._db.docs[self.path] = dict(data)

    create = set

    def delete(self) -> None:
        self._db.docs.pop(self.path, None)

    def update(self, data: dict[str, Any]) -> None:
        from google.cloud import firestore
        doc = self._db.docs.setdefault(self.path, {})
        for k, v in data.items():
            if v is firestore.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = v

    def collection(self, name: str) -> "FakeCollection":
        return FakeCollection(self._db, f"{self.path}/{name}")


def _matches(have: Any, op: str, want: Any) -> bool:
    if op == "==":
        return have == want
    if op == "<":
        return have is not None and have < want
    return False


class FakeQuery:
    def __init__(self, coll: "FakeCollection", filters: list[tuple[str, str, Any]]) -> None:
        self._coll = coll
        self._filters = filters

    def where(self, filter: Any) -> "FakeQuery":  # noqa: A002 - mirrors the client API
        return FakeQuery(self._coll, self._filters + [(filter.field_path, filter.op_string, filter.value)])

    def limit(self, _n: int) -> "FakeQuery":
        return self

    def stream(self):
        for snap in self._coll.stream():
            data = snap.to_dict() or {}
            if all(_matches(data.get(f), op, v) for f, op, v in self._filters):
                yield snap


class FakeCollection(FakeQuery):
    def __init__(self, db: "FakeDb", path: str) -> None:
        self._db = db
        self.path = path
        super().__init__(self, [])

    def document(self, doc_id: str | None = None) -> FakeDocRef:
        return FakeDocRef(self._db, f"{self.path}/{doc_id or f'auto{next(_ids):016d}'}")

    def add(self, data: dict[str, Any]) -> tuple[None, FakeDocRef]:
        ref = self.document()
        ref.set(data)
        return None, ref

    def stream(self):
        prefix = self.path + "/"
        for path in sorted(self._db.docs):
            if path.startswith(prefix) and "/" not in path[len(prefix):]:
                yield FakeSnap(FakeDocRef(self._db, path), self._db.docs[path])


class FakeDb:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, Any]] = {}

    def collection(self, path: str) -> FakeCollection:
        return FakeCollection(self, path)

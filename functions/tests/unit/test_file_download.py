"""The download address of an approved file: one credential (the token), a few fetches, a few minutes."""
from datetime import datetime, timedelta, timezone
from typing import Any

import flask
import pytest

from sieve import filehttp, files
from sieve.models import FileLink
from tests.helpers.fakes import FakeDb

NOW = datetime(2026, 11, 22, 15, 0, tzinfo=timezone.utc)
PATH = f"handoffs/{'u' * 28}/{'r' * 20}/{'o' * 24}"
BODY = b"%PDF-1.7 the lease"


class Txn:
    def update(self, ref: Any, data: dict[str, Any]) -> None:
        ref.update(data)


class Store:
    def __init__(self) -> None:
        self.objects = {PATH: BODY}
        self.deleted: list[str] = []

    def read(self, path: str) -> bytes | None:
        return self.objects.get(path)

    def delete(self, path: str) -> None:
        self.deleted.append(path)
        self.objects.pop(path, None)


@pytest.fixture()
def world(monkeypatch):
    db, store, clock = FakeDb(), Store(), {"now": NOW}
    token = files.new_file_token()
    link = FileLink(uid="u" * 28, grant_id="g1", request_id="r" * 20, path=PATH, name="Lease_2026.pdf", mime="application/pdf",
                    bytes=len(BODY), created_at=NOW, expires_at=NOW + timedelta(seconds=files.FILE_LINK_TTL_SECONDS))
    db.collection("fileLinks").document(files.file_token_hash(token)).set(link.to_firestore())
    monkeypatch.setattr(filehttp.fb, "transact", lambda _db, fn, *args, **_kw: fn(Txn(), *args))
    deps = filehttp.FileDeps(db=db, now=lambda: clock["now"], read_object=store.read, delete_object=store.delete)

    def call(path: str, method: str = "GET") -> flask.Response:
        return filehttp.handle_http(flask.Request.from_values(path=path, method=method), deps)

    return db, store, clock, token, call


def test_the_link_gives_the_file_as_a_download_and_counts_it(world):
    db, store, _clock, token, call = world
    res = call(f"/f/{token}")
    assert res.status_code == 200 and res.get_data() == BODY
    assert res.headers["Content-Type"] == "application/pdf"
    assert res.headers["Content-Disposition"].startswith('attachment; filename="Lease_2026.pdf"')
    assert res.headers["X-Content-Type-Options"] == "nosniff" and res.headers["Cache-Control"] == "no-store"
    assert "sandbox" in res.headers["Content-Security-Policy"]
    doc = db.docs[f"fileLinks/{files.file_token_hash(token)}"]
    assert doc["downloads"] == 1 and store.deleted == []
    # the function's own address, with no /f in front, works the same
    assert call(f"/{token}").status_code == 200


def test_after_the_last_fetch_the_file_and_the_link_are_gone(world):
    db, store, _clock, token, call = world
    for _ in range(files.FILE_LINK_MAX_DOWNLOADS):
        assert call(f"/f/{token}").status_code == 200
    assert store.deleted == [PATH] and not any(k.startswith("fileLinks/") for k in db.docs)
    again = call(f"/f/{token}")
    assert again.status_code == 404 and again.get_data(as_text=True) == filehttp.MSG_GONE


def test_every_refusal_looks_the_same(world):
    db, store, clock, token, call = world
    other = files.new_file_token()
    for path in (f"/f/{other}", "/f/short", "/f/", f"/f/{token}/more", "/mcp/x"):
        res = call(path)
        assert res.status_code == 404 and res.get_data(as_text=True) == filehttp.MSG_GONE
    clock["now"] = NOW + timedelta(seconds=files.FILE_LINK_TTL_SECONDS)
    late = call(f"/f/{token}")
    assert late.status_code == 404 and late.get_data(as_text=True) == filehttp.MSG_GONE
    assert db.docs[f"fileLinks/{files.file_token_hash(token)}"]["downloads"] == 0     # a late try is not counted
    assert call(f"/f/{token}", "POST").status_code == 405


def test_a_look_is_not_a_fetch_and_a_missing_object_ends_the_link(world):
    db, store, _clock, token, call = world
    head = call(f"/f/{token}", "HEAD")
    assert head.status_code == 200 and head.get_data() == b"" and head.headers["Content-Type"] == "application/pdf"
    assert db.docs[f"fileLinks/{files.file_token_hash(token)}"]["downloads"] == 0
    store.objects.clear()
    res = call(f"/f/{token}")
    assert res.status_code == 404 and not any(k.startswith("fileLinks/") for k in db.docs)


def test_the_cleanup_removes_links_past_their_time_with_their_files(world):
    db, store, _clock, token, _call = world
    fresh = files.new_file_token()
    other_path = f"handoffs/{'u' * 28}/{'s' * 20}/{'p' * 24}"
    later = FileLink(uid="u" * 28, grant_id="g1", request_id="s" * 20, path=other_path, name="b.pdf", mime="application/pdf", bytes=3,
                     created_at=NOW + timedelta(minutes=20), expires_at=NOW + timedelta(minutes=30))
    db.collection("fileLinks").document(files.file_token_hash(fresh)).set(later.to_firestore())
    removed = filehttp.remove_expired(db, NOW + timedelta(minutes=15), store.delete)
    assert removed == 1 and store.deleted == [PATH]
    assert list(k for k in db.docs if k.startswith("fileLinks/")) == [f"fileLinks/{files.file_token_hash(fresh)}"]


def test_stale_handoffs_are_swept_whatever_became_of_their_request():
    """Nov 24: a file no payload names (an upload that finished after the home base gave up, a take-back that failed
    offline) is deleted once it is an hour old; younger files and anything outside handoffs/ are left alone."""
    from datetime import datetime, timedelta, timezone
    from sieve import filehttp
    now = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
    old = f"handoffs/{'u' * 28}/{'r' * 20}/{'o' * 24}"
    young = f"handoffs/{'u' * 28}/{'s' * 20}/{'p' * 24}"
    listed = [(old, now - timedelta(hours=2)), (young, now - timedelta(minutes=5)),
              ("handoffs/not-a-handoff", now - timedelta(days=3)), (f"{old}/extra", now - timedelta(days=3))]
    deleted: list[str] = []
    assert filehttp.remove_stale_handoffs(now, listed, deleted.append) == 1
    assert deleted == [old]
    many = [(f"handoffs/{'u' * 28}/{'r' * 20}/{'o' * 23}{i % 10}", now - timedelta(days=1)) for i in range(5)]
    assert filehttp.remove_stale_handoffs(now, many, deleted.append, limit=3) == 3

"""Files sent as themselves: names, types, handoff paths, link tokens and when a link stops working."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from sieve import files
from sieve.files import FileLink, SharedFile

UID = "u" * 28
REQ = "r" * 20
OBJ = "o" * 24
PATH = f"handoffs/{UID}/{REQ}/{OBJ}"
NOW = datetime(2026, 11, 22, 15, 0, tzinfo=timezone.utc)


def shared(**over):
    base = {"name": "Lease_2026.pdf", "mime": "application/pdf", "bytes": 182_000, "path": PATH}
    return SharedFile.model_validate({**base, **over})


def link(**over):
    base = {"uid": UID, "grantId": "g1", "requestId": REQ, "path": PATH, "name": "Lease_2026.pdf", "mime": "application/pdf",
            "bytes": 182_000, "createdAt": NOW, "expiresAt": NOW + timedelta(seconds=files.FILE_LINK_TTL_SECONDS)}
    return FileLink.model_validate({**base, **over})


def test_safe_file_name_keeps_plain_names_and_cleans_the_rest():
    assert files.safe_file_name("Lease_2026.pdf") == "Lease_2026.pdf"
    assert files.safe_file_name("Ünïcode résumé.docx") == "Ünïcode résumé.docx"
    assert files.safe_file_name("../../etc/passwd") == "passwd"
    assert files.safe_file_name("C:\\Users\\me\\notes.txt") == "notes.txt"
    assert files.safe_file_name("  .hidden.txt ") == "hidden.txt"
    assert files.safe_file_name("a\x00b\u202ec\u200bd.pdf") == "abcd.pdf"
    assert files.safe_file_name('what<is>"this"?.pdf') == "what_is__this__.pdf"
    assert files.safe_file_name("") == "file"
    assert files.safe_file_name("///") == "file"
    assert files.safe_file_name(None) == "file"   # type: ignore[arg-type]
    long = files.safe_file_name("x" * 300 + ".pdf")
    assert len(long) == files.FILE_NAME_MAX_CHARS and long.endswith(".pdf")


def test_file_type_allowed_needs_a_listed_type_and_a_matching_ending():
    assert files.file_type_allowed("application/pdf", "Lease.PDF")
    assert files.file_type_allowed("image/jpeg", "IMG_0042.jpeg")
    assert not files.file_type_allowed("image/jpeg", "Lease.pdf")
    assert not files.file_type_allowed("text/html", "page.html")
    assert not files.file_type_allowed("image/svg+xml", "logo.svg")
    assert not files.file_type_allowed("application/zip", "all.zip")
    assert not files.file_type_allowed("application/x-msdownload", "setup.exe")
    assert not files.file_type_allowed("", "x.pdf")


def test_shared_file_accepts_a_handoff_and_refuses_everything_else():
    f = shared()
    assert f.belongs_to(UID, REQ)
    assert not f.belongs_to("someone-else", REQ)
    assert not f.belongs_to(UID, "x" * 20)
    assert f.to_firestore() == {"name": "Lease_2026.pdf", "mime": "application/pdf", "bytes": 182_000, "path": PATH}
    for bad in (
        {"name": "../Lease.pdf"},
        {"name": "Lease.pdf\u202e"},
        {"mime": "text/html", "name": "page.html"},
        {"mime": "image/png"},                               # the name says PDF
        {"bytes": 0},
        {"bytes": files.SHARED_FILE_MAX_BYTES + 1},
        {"path": f"handoffs/{UID}/{REQ}"},
        {"path": f"users/{UID}/{REQ}/{OBJ}"},
        {"path": f"handoffs/{UID}/{REQ}/../{OBJ}"},
        {"path": f"handoffs/{UID}/short/{OBJ}"},
    ):
        with pytest.raises(ValidationError):
            shared(**bad)


def test_file_owner_reads_the_uid_and_the_request():
    assert files.file_owner(PATH) == (UID, REQ)
    assert files.file_owner("handoffs/a/b") is None
    assert files.file_owner(None) is None   # type: ignore[arg-type]


def test_tokens_are_random_url_safe_and_stored_only_as_a_hash():
    a, b = files.new_file_token(), files.new_file_token()
    assert a != b
    assert files.is_valid_file_token(a) and len(a) == 43
    assert not files.is_valid_file_token(a[:-1])
    assert not files.is_valid_file_token(a + "!")
    h = files.file_token_hash(a)
    assert len(h) == 64 and h != a and files.file_token_hash(a) == h


def test_the_url_carries_the_token_and_is_read_back_from_either_path():
    token = files.new_file_token()
    url = files.build_file_url("https://sieve.example/", token)
    assert url == f"https://sieve.example/f/{token}"
    assert files.extract_file_token(f"/f/{token}") == token
    assert files.extract_file_token(f"/{token}") == token
    assert files.extract_file_token(f"/f/{token}/more") is None
    assert files.extract_file_token("/f/short") is None
    assert files.extract_file_token(f"/mcp/{token}") is None


def test_a_link_stops_working_when_it_expires_or_was_fetched_enough():
    fresh = link()
    assert files.download_refusal(fresh, NOW) is None
    assert files.download_refusal(fresh, NOW + timedelta(seconds=files.FILE_LINK_TTL_SECONDS - 1)) is None
    assert files.download_refusal(fresh, NOW + timedelta(seconds=files.FILE_LINK_TTL_SECONDS)) == "expired"
    assert files.download_refusal(link(downloads=files.FILE_LINK_MAX_DOWNLOADS - 1), NOW) is None
    assert files.download_refusal(link(downloads=files.FILE_LINK_MAX_DOWNLOADS), NOW) == "used"


def test_content_disposition_is_always_a_download_with_both_names():
    assert files.content_disposition("Lease_2026.pdf") == "attachment; filename=\"Lease_2026.pdf\"; filename*=UTF-8''Lease_2026.pdf"
    header = files.content_disposition('résumé "final".pdf')
    assert header.startswith('attachment; filename="r_sum_ _final_.pdf"')
    assert header.endswith("filename*=UTF-8''r%C3%A9sum%C3%A9%20_final_.pdf")
    assert "\n" not in files.content_disposition("a\r\nSet-Cookie: x=1.pdf")


def test_describe_file_says_the_name_the_kind_and_the_size():
    assert files.describe_file("Lease_2026.pdf", "application/pdf", 182_000) == "Lease_2026.pdf (PDF, 178 KB)"
    assert files.describe_file("IMG_0042.jpg", "image/jpeg", 3_400_000) == "IMG_0042.jpg (image, 3.2 MB)"
    assert files.describe_file("notes.txt", "text/plain", 812) == "notes.txt (text, 812 bytes)"

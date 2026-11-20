"""U11 (denial results), U15 (argument validation), results and instructions copy."""
import json
from datetime import date, datetime, timezone

import pytest

from sieve import tools
from sieve.models import GrantMeta, SharedImage, ToolResult

TODAY = date(2026, 11, 16)


def _grant(step):
    now = datetime(2026, 11, 16, tzinfo=timezone.utc)
    return GrantMeta(ai_name="Test", max_step=step, allowed_categories=["Home"], allowed_sources=["gmail"],
                     created_at=now, expires_at=now, link_hint="abcd")


def test_u11_result_for_denial():
    r = tools.result_for_denial("EXPIRED", _grant("full"))
    assert (r.status, r.message) == ("expired", tools.MSG_GRANT_EXPIRED) and not tools.is_error(r)
    r = tools.result_for_denial("REVOKED", _grant("full"))
    assert (r.status, r.message) == ("not-allowed", "The person turned off this connection in Sieve.")
    assert tools.is_error(r)
    r = tools.result_for_denial("CAVEAT_NOT_SATISFIED", _grant("answer"))
    assert r.message == "This connection only allows sieve_answer and sieve_check. Use sieve_answer instead."
    r = tools.result_for_denial("CAVEAT_NOT_SATISFIED", _grant("excerpt"))
    assert r.message == ("This connection only allows sieve_answer and sieve_excerpt and sieve_check. "
                         "Use sieve_excerpt instead.")
    for code in ("NOT_BOUND", "INVALID_SIGNATURE", "MALFORMED", "INTERNAL_ERROR", "SOMETHING_NEW"):
        r = tools.result_for_denial(code, _grant("full"))
        assert r.status == "error" and r.message == tools.MSG_CHECK_FAILED and tools.is_error(r)
    for status in ("answered", "pending", "declined", "blocked", "no-match", "offline", "expired"):
        assert not tools.is_error(ToolResult(status=status, message="m"))


def test_result_from_request_and_d6():
    rid = "a" * 20
    assert tools.result_from_request(rid, {"status": "declined"}).message == "The person chose not to share this."
    assert tools.result_from_request(rid, {"status": "declined", "message": "Not now."}).message == "Not now."
    assert tools.result_from_request(rid, {"status": "declined", "message": "x" * 301}).message == tools.MSG_DECLINED
    blocked = tools.result_from_request(rid, {"status": "blocked", "message": "Health is never shared."})
    nothing = tools.result_from_request(rid, {"status": "no-match", "message": "No email found."})
    assert blocked.to_wire() == nothing.to_wire() == {"status": "no-match", "request_id": rid,
                                                      "message": "Nothing to share for that."}
    assert tools.result_from_request(rid, {"status": "collected"}).message == tools.MSG_COLLECTED
    assert tools.result_from_request(rid, {"status": "revoked"}).status == "not-allowed"
    assert tools.result_from_request(rid, {"status": "offline"}).to_wire() == {"status": "offline",
                                                                                 "message": tools.MSG_OFFLINE}
    assert tools.result_from_request(rid, {"status": "error"}).message == tools.MSG_HOME_ERROR
    p = tools.pending_result(rid)
    assert p.message == ("The person has not approved this yet. Tell them a request is waiting in Sieve, then call "
                         f"sieve_check with request_id \"{rid}\"; it waits up to 45 seconds for their decision.")
    a = tools.answered_result(rid, "full", "Text")
    assert a.message == "The person approved sharing this full item."


def test_call_tool_result_shapes():
    r = tools.answered_result("a" * 20, "answer", "Your deposit was $1,200.")
    out = tools.call_tool_result(r, era="legacy", version="2025-11-25")
    assert json.loads(out["content"][0]["text"]) == out["structuredContent"] == r.to_wire()
    assert out["isError"] is False
    old = tools.call_tool_result(r, era="legacy", version="2025-03-26")
    assert "structuredContent" not in old
    img = SharedImage(mime="image/jpeg", base64="AAAA", width=1, height=1, bytes=3)
    with_img = tools.call_tool_result(tools.answered_result("a" * 20, "full", "A dog.", img), era="legacy",
                                      version="2025-11-25")
    assert with_img["content"][1] == {"type": "image", "data": "AAAA", "mimeType": "image/jpeg"}
    assert "image" not in with_img["structuredContent"]


def test_instructions_text():
    text = tools.instructions(TODAY)
    assert "otherwise today is 2026-11-16." in text
    assert text.startswith("Sieve answers questions about one person's own email, files and photos.")
    assert "\u2014" not in text and "\u2014" not in json.dumps(tools.TOOLS)


def test_u15_example_and_normalisation():
    args = tools.parse_ladder_args({"question": "What did my landlord say about the deposit?", "after": "2026-10-01",
                                    "before": "2026-10-31", "from": "landlord"}, today=TODAY)
    assert args.question == "What did my landlord say about the deposit?"
    assert args.hints.to_firestore() == {"after": "2026-10-01", "before": "2026-10-31", "from": "landlord"}
    args = tools.parse_ladder_args({"question": " Q ", "after": None, "before": "", "source": "  ", "from": None,
                                    "terms": None}, today=TODAY)
    assert args.question == "Q" and args.hints is None
    args = tools.parse_ladder_args({"question": "Q", "terms": [" A1 ", "A1", ""]}, today=TODAY)
    assert args.hints.to_firestore() == {"terms": ["A1"]}
    assert tools.parse_ladder_args({"question": "Q", "terms": []}, today=TODAY).hints is None
    assert tools.parse_ladder_args({"question": "Q", "before": "2027-01-10"}, today=TODAY).hints.before == "2027-01-10"
    assert tools.parse_ladder_args({"question": "Q", "after": "2026-11-17"}, today=TODAY).hints.after == "2026-11-17"
    assert tools.parse_ladder_args({"question": "line one\n\tline two"}, today=TODAY).question


DATE_MSG = "{f} must be a real date written as YYYY-MM-DD, for example 2026-10-01."


@pytest.mark.parametrize("arguments, message", [
    ({"question": "Q", "after": "2026-13-01"}, DATE_MSG.format(f="after")),
    ({"question": "Q", "after": "16/11/2026"}, DATE_MSG.format(f="after")),
    ({"question": "Q", "after": "2026-02-30"}, DATE_MSG.format(f="after")),
    ({"question": "Q", "before": "1969-12-31"}, DATE_MSG.format(f="before")),
    ({"question": "Q", "after": 20261001}, DATE_MSG.format(f="after")),
    ({"question": "Q", "after": "٢٠٢٦-10-01"}, DATE_MSG.format(f="after")),
    ({"question": "Q", "after": "2026-10-31", "before": "2026-10-01"}, "after must be on or before before."),
    ({"question": "Q", "after": "2026-11-20"},
     "after cannot be in the future. Resolve relative dates against today's date."),
    ({"question": "Q", "source": "email"}, "source must be one of: mail, files, photos."),
    ({"question": "Q", "from": "x" * 101},
     "from must be 1 to 100 characters: a person's or organisation's name or email address."),
    ({"question": "Q", "from": "a​b"},
     "from must be 1 to 100 characters: a person's or organisation's name or email address."),
    ({"question": "Q", "terms": ["1", "2", "3", "4", "5", "6"]},
     "terms must be a list of at most 5 exact identifiers, each 1 to 64 characters."),
    ({"question": "Q", "terms": ["x" * 65]},
     "terms must be a list of at most 5 exact identifiers, each 1 to 64 characters."),
    ({"question": "Q", "terms": "A1"}, "terms must be a list of at most 5 exact identifiers, each 1 to 64 characters."),
    ({"question": "Q", "terms": [1, None]},
     "terms must be a list of at most 5 exact identifiers, each 1 to 64 characters."),
    ({"question": "Q", "limit": 5}, "Unknown argument \"limit\". Allowed: question, after, before, source, from, terms."),
    ({"question": "x" * 501}, "The question must be 1 to 500 characters of plain text."),
    ({"question": "bad\x00question"}, "The question must be 1 to 500 characters of plain text."),
    ({"question": 42}, "The question must be 1 to 500 characters of plain text."),
    ({"question": "   "}, "The question must be 1 to 500 characters of plain text."),
    ({}, "The question must be 1 to 500 characters of plain text."),
    ({"question": "\U0001F382" * 300}, "The question must be 1 to 500 characters of plain text."),
])
def test_u15_each_rule_has_its_message(arguments, message):
    with pytest.raises(tools.ArgError) as err:
        tools.parse_ladder_args(arguments, today=TODAY)
    assert str(err.value) == message


def test_r_mcp_05_emoji_counts_utf16_units():
    assert tools.parse_ladder_args({"question": "\U0001F382" * 250}, today=TODAY).question  # 500 units: accepted


def test_check_args():
    assert tools.parse_check_args({"request_id": "a" * 20}) == "a" * 20
    assert tools.parse_check_args({"request_id": " " + "B" * 20 + " "}) == "B" * 20
    for bad in ({}, {"request_id": "short"}, {"request_id": 7}, {"request_id": "a" * 19 + "-"}):
        with pytest.raises(tools.ArgError) as err:
            tools.parse_check_args(bad)
        assert str(err.value) == "That request_id is not valid. Use the request_id from an earlier Sieve result."
    with pytest.raises(tools.ArgError) as err:
        tools.parse_check_args({"request_id": "a" * 20, "question": "x"})
    assert str(err.value) == "Unknown argument \"question\". Allowed: request_id."

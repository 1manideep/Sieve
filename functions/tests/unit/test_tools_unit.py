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
                         f"sieve_check with request_id \"{rid}\"; it waits about 20 seconds per call, so call it "
                         "again while the result is pending.")
    a = tools.answered_result(rid, "full", "Text")
    assert a.message == "The person approved sharing this full item."


def test_unsupported_and_unknown_statuses():
    rid = "a" * 20
    msg = "Sieve answers about one item at a time, so it cannot count your emails."
    out = tools.result_from_request(rid, {"status": "unsupported", "message": msg})
    assert out.to_wire() == {"status": "unsupported", "request_id": rid, "message": msg}
    assert tools.result_from_request(rid, {"status": "unsupported"}).message == tools.MSG_UNSUPPORTED
    assert tools.result_from_request(rid, {"status": "unsupported", "message": "x" * 301}).message == tools.MSG_UNSUPPORTED
    unknown = tools.unknown_request_result()
    assert unknown.to_wire() == {"status": "unknown", "message": tools.MSG_UNKNOWN_ID}
    assert "expired" not in tools.MSG_UNKNOWN_ID
    expired = tools.result_from_request(rid, {"status": "expired"})
    assert (expired.status, expired.request_id, expired.message) == ("expired", rid, tools.MSG_REQUEST_EXPIRED)
    assert not tools.is_error(out) and not tools.is_error(unknown)
    enum = tools.TOOL_RESULT_SCHEMA["properties"]["status"]["enum"]
    assert "unknown" in enum and "unsupported" in enum and "expired" in enum


def test_open_limit_text_states_the_limit():
    ids = ["A" * 20, "B" * 20, "C" * 20]
    out = tools.open_limit_result(ids)
    assert out.status == "error" and out.request_id is None
    assert out.message == ("At most 3 requests can wait per connection, and 3 are waiting now: "
                           f"\"{ids[0]}\", \"{ids[1]}\", \"{ids[2]}\". Call sieve_check on those first, then ask again.")
    assert tools.open_limit_result([]).message.startswith("At most 3 requests can wait per connection, and 3 are "
                                                          "waiting now. ")
    answer = tools.TOOLS["sieve_answer"]["description"]
    assert "At most 3 requests can wait per connection; wait for sieve_check before asking more." in answer


def test_descriptions_carry_the_waits_and_the_retry_rule():
    answer = tools.TOOLS["sieve_answer"]["description"]
    assert "the result is often \"pending\"" in answer
    assert "poll with sieve_check, which waits about 20 seconds per call" in answer
    assert ("If a call fails or times out, call again with the same arguments within 10 minutes: Sieve returns the "
            "existing request and its result instead of making a new one.") in answer
    assert "unsupported" in answer
    for name in ("sieve_excerpt", "sieve_full_item"):
        assert "poll with sieve_check, which waits about 20 seconds per call" in tools.TOOLS[name]["description"]
    check = tools.TOOLS["sieve_check"]["description"]
    assert "waits about 20 seconds" in check and "\"unknown\"" in check and "45" not in json.dumps(tools.TOOLS)
    key = tools.LADDER_INPUT_SCHEMA["properties"]["idempotency_key"]
    assert key["maxLength"] == 64 and "Optional." in key["description"]


@pytest.mark.parametrize("step, allowed, hidden", [
    ("answer", ["sieve_answer", "sieve_check"], ["sieve_excerpt", "sieve_full_item"]),
    ("excerpt", ["sieve_answer", "sieve_excerpt", "sieve_check"], ["sieve_full_item"]),
    ("full", ["sieve_answer", "sieve_excerpt", "sieve_full_item", "sieve_check"], []),
])
def test_instructions_and_tools_name_only_allowed_tools(step, allowed, hidden):
    text = tools.instructions(TODAY, step)
    listed = tools.tools_for_step(step, version="2025-11-25")
    legacy = tools.tools_for_step(step, version="2025-03-26")
    assert [t["name"] for t in listed] == [t["name"] for t in legacy] == allowed
    readable = text + json.dumps(listed) + json.dumps(legacy) + tools.result_for_denial("CAVEAT_NOT_SATISFIED",
                                                                                      _grant(step)).message
    for name in hidden:
        assert name not in readable
    for name in allowed:
        assert name in text + json.dumps(listed)
    assert "sieve_check waits about 20 seconds per call" in text
    assert "At most 3 requests can wait per connection; wait for sieve_check before asking more." in text
    assert "otherwise today is 2026-11-16." in text
    if step == "answer":
        assert "5. Ask with sieve_answer. This connection shares one-sentence answers only." in text
        assert "Use this first" not in listed[0]["description"]
    else:
        assert "Use this first: it shares the least." in listed[0]["description"]


def test_idempotency_key_argument():
    args = tools.parse_ladder_args({"question": "Q", "idempotency_key": "  ask-7 "}, today=TODAY)
    assert args.idempotency_key == "ask-7" and args.hints is None
    for absent in (None, "", "   "):
        assert tools.parse_ladder_args({"question": "Q", "idempotency_key": absent}, today=TODAY).idempotency_key is None
    assert tools.parse_ladder_args({"question": "Q", "idempotency_key": "k" * 64}, today=TODAY).idempotency_key
    for bad in ("k" * 65, 7, ["a"], "a\x00b", "a​b"):
        with pytest.raises(tools.ArgError) as err:
            tools.parse_ladder_args({"question": "Q", "idempotency_key": bad}, today=TODAY)
        assert str(err.value) == "idempotency_key must be 1 to 64 characters of plain text."


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
    assert "{" not in text and "45" not in text
    copy = [tools.instructions(TODAY, s) for s in ("answer", "excerpt", "full")] + [json.dumps(tools.TOOLS)]
    copy += [v for k, v in vars(tools).items() if k.startswith("MSG_") and isinstance(v, str)]
    for t in copy:
        assert "\u2014" not in t and "\u2013" not in t and "--" not in t


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


def test_categories_hint():
    """One or two of Sieve's own categories; the home base then looks only there."""
    args = tools.parse_ladder_args({"question": "Q", "categories": ["Money"]}, today=TODAY)
    assert args.hints.to_firestore() == {"categories": ["Money"]}
    args = tools.parse_ladder_args({"question": "Q", "categories": [" Home ", "Money", "Home"]}, today=TODAY)
    assert args.hints.to_firestore() == {"categories": ["Home", "Money"]}
    assert tools.parse_ladder_args({"question": "Q", "categories": []}, today=TODAY).hints is None
    for bad in (["Bills"], ["Home", "Work", "Money"], "Money", [7], ["money"]):
        with pytest.raises(tools.ArgError) as error:
            tools.parse_ladder_args({"question": "Q", "categories": bad}, today=TODAY)
        assert str(error.value) == tools.MSG_CATEGORIES
    schema = tools.LADDER_INPUT_SCHEMA["properties"]["categories"]
    assert schema["maxItems"] == 2 and schema["items"]["enum"] == list(tools.config.CATEGORIES)
    text = tools.instructions(TODAY)
    assert "4. Set categories (one or two) only when the question clearly belongs there" in text
    assert "different hints or no categories" in text


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
    ({"question": "Q", "limit": 5},
     "Unknown argument \"limit\". Allowed: question, after, before, source, from, terms, idempotency_key."),
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

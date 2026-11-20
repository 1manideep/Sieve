"""U14: callable input validation for issueGrant and narrowGrant."""
import pytest

from sieve import grants
from sieve.errors import InputError

ALL = ["Home", "Work", "Money", "Health", "Travel", "Shopping", "Personal", "Newsletters", "Photos"]


def _issue(**over):
    data = {"aiName": "Helper AI", "maxStep": "answer", "allowedCategories": ["Home"], "allowedSources": ["gmail"]}
    data.update(over)
    return grants.parse_issue_request(data)


def test_u14_accepts_defaults():
    r = _issue()
    assert (r.ai_name, r.max_step, r.allowed_categories, r.allowed_sources, r.days) == (
        "Helper AI", "answer", ("Home",), ("gmail",), 30)
    assert _issue(aiName="  My   helper ").ai_name == "My helper"
    assert _issue(days=90, allowedCategories=ALL, allowedSources=["gmail", "folder", "upload"]).days == 90


@pytest.mark.parametrize("over", [
    {"aiName": ""}, {"aiName": "   "}, {"aiName": "x" * 41}, {"aiName": "bad\x00name"}, {"aiName": "a​b"},
    {"aiName": 5}, {"maxStep": "everything"}, {"allowedCategories": []}, {"allowedCategories": ["Home", "Home"]},
    {"allowedCategories": ["Garden"]}, {"allowedSources": ["playground"]}, {"allowedSources": []},
    {"allowedSources": ["gmail", "gmail"]}, {"days": 0}, {"days": 91}, {"days": True}, {"days": "30"},
])
def test_u14_rejects(over):
    with pytest.raises(InputError):
        _issue(**over)


def test_u14_rejects_non_object():
    with pytest.raises(InputError):
        grants.parse_issue_request(["x"])


def test_narrow_parse():
    r = grants.parse_narrow_request({"grantId": "A" * 20, "maxStep": "answer"})
    assert r.max_step == "answer" and r.days is None
    with pytest.raises(InputError):
        grants.parse_narrow_request({"grantId": "A" * 20})
    with pytest.raises(InputError):
        grants.parse_narrow_request({"grantId": "nope", "maxStep": "answer"})
    with pytest.raises(InputError):
        grants.parse_narrow_request({"grantId": "A" * 20, "days": 0})


def test_playground_parse():
    r = grants.parse_playground_request({})
    assert r.allowed_sources == ("playground",) and r.days == 1 and r.max_step == "full"
    assert grants.parse_playground_request(None).ai_name == "Gemini in the cloud"

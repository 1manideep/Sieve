from sieve_bench.textsearch import STOPWORDS, BM25Index, Doc, tokenize


def corpus():
    return [
        Doc("landlord", "Re: Deposit for the apartment. Your landlord received your security deposit of $1,200 on March 3.", "2026-10-29T10:04:00-05:00"),
        Doc("bank", "Direct deposit received. A direct deposit of $2,840.55 posted to your checking account.", "2026-11-13T05:30:00-06:00"),
        Doc("digest", "Weekly digest: a housing lawyer answers questions about security deposits and landlord repairs.", "2026-11-15T08:00:00-06:00"),
        Doc("recipe", "Weeknight turkey chili with kidney beans.", "2026-11-07T17:30:00-06:00"),
    ]


def test_tokens_are_lowercase_runs_of_letters_and_digits_without_stopwords():
    assert tokenize("The Lease_2026.pdf, order #88231!") == ["lease", "2026", "pdf", "order", "88231"]
    assert "the" in STOPWORDS and tokenize("what did my") == []


def test_landlord_email_ranks_first_for_landlord_deposit():
    hits = BM25Index(corpus()).search("landlord deposit", 10)
    assert hits[0].id == "landlord"


def test_or_semantics_any_term_matches():
    ids = [h.id for h in BM25Index(corpus()).search("landlord chili", 10)]
    assert "recipe" in ids and "landlord" in ids and "digest" in ids
    assert "bank" not in ids  # no query term at all: score 0 is never returned


def test_ties_are_broken_by_newest_date():
    docs = [
        Doc("old", "parcel notice", "2026-01-01T00:00:00Z"),
        Doc("new", "parcel notice", "2026-06-01T00:00:00Z"),
        Doc("mid", "parcel notice", "2026-03-01T00:00:00Z"),
    ]
    assert [h.id for h in BM25Index(docs).search("parcel", 10)] == ["new", "mid", "old"]


def test_stopwords_are_ignored():
    index = BM25Index(corpus())
    assert index.search("what is the", 10) == []
    assert [h.id for h in index.search("what is the deposit", 10)] == [h.id for h in index.search("deposit", 10)]


def test_limit_and_empty_index():
    assert len(BM25Index(corpus()).search("deposit", 1)) == 1
    assert BM25Index([]).search("deposit", 5) == []


def test_fixture_landlord_thread_is_found_for_landlord_deposit(dataset):
    # On 20's text the landlord's reply never says "landlord", so the neighbourhood digest
    # (a deliberate hard negative) can rank above it; the reply must still be in the results.
    mail = BM25Index(Doc(i.id, f"{i.sender} {i.title} {i.text}", i.date) for i in dataset.emails)
    ids = [h.id for h in mail.search("landlord deposit", 10)]
    assert "pg-mail-02" in ids[:5]

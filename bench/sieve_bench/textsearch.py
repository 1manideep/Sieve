"""BM25 used by the baseline connector (60 section 4.6, "Search").

k1 = 1.2, b = 0.75. Tokens are lower-case runs of letters and digits; a fixed English
stopword list is ignored; OR semantics (any query term can match); only results with a
score above zero; ties broken by the newest date. The search is deliberately generous so
the comparison measures exposure, not search quality.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

K1 = 1.2
B = 0.75

_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)

STOPWORDS = frozenset(
    """
    a about above after again against all am an and any are as at be because been before being
    below between both but by can could did do does doing down during each few for from further
    had has have having he her here hers herself him himself his how i if in into is it its itself
    just me more most my myself no nor not now of off on once only or other our ours ourselves out
    over own same she should so some such than that the their theirs them themselves then there
    these they this those through to too under until up very was we were what when where which
    while who whom why will with would you your yours yourself yourselves
    """.split()
)


def tokenize(text: str) -> list[str]:
    """Lower-case runs of letters and digits, stopwords removed."""
    return [t for t in _TOKEN.findall(text.lower()) if t not in STOPWORDS]


@dataclass(frozen=True)
class Doc:
    id: str
    text: str
    date: str  # ISO 8601; compared as an instant, newest first on ties


@dataclass(frozen=True)
class Hit:
    id: str
    score: float


class BM25Index:
    def __init__(self, docs: Iterable[Doc]):
        self._docs = list(docs)
        self._tf: list[Counter[str]] = []
        self._len: list[int] = []
        df: Counter[str] = Counter()
        for doc in self._docs:
            tokens = tokenize(doc.text)
            tf = Counter(tokens)
            self._tf.append(tf)
            self._len.append(len(tokens))
            df.update(tf.keys())
        self._n = len(self._docs)
        self._avgdl = (sum(self._len) / self._n) if self._n else 0.0
        # Lucene-style idf, always positive, so OR semantics never subtracts.
        self._idf = {t: math.log(1.0 + (self._n - n + 0.5) / (n + 0.5)) for t, n in df.items()}
        self._order = {doc.id: _date_key(doc.date) for doc in self._docs}

    def __len__(self) -> int:
        return self._n

    def score(self, query: str) -> list[Hit]:
        terms = tokenize(query)
        hits: list[Hit] = []
        if not terms or not self._n:
            return hits
        for i, doc in enumerate(self._docs):
            tf = self._tf[i]
            dl = self._len[i]
            s = 0.0
            for term in terms:
                f = tf.get(term, 0)
                if not f:
                    continue
                norm = K1 * (1.0 - B + B * (dl / self._avgdl if self._avgdl else 0.0))
                s += self._idf[term] * (f * (K1 + 1.0)) / (f + norm)
            if s > 0.0:
                hits.append(Hit(doc.id, s))
        hits.sort(key=lambda h: (-round(h.score, 9), -self._order[h.id]))
        return hits

    def search(self, query: str, limit: int) -> list[Hit]:
        return self.score(query)[: max(0, limit)]


def _date_key(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0

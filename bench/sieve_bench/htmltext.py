"""The baseline's html-to-text rule (60 section 4.6, "Body").

A typical connector converts HTML without evaluating CSS: script, style, head and comments
go, everything else stays, including text that is styled to be invisible.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Comment

_REMOVED_TAGS = ("script", "style", "head")
_SPACES = re.compile(r"[ \t\r\f\v ]+")


def html_to_text(html: str) -> str:
    """Convert HTML to text: drop script, style, head and comments; get_text('\\n'); collapse blank lines.

    Collapsing means: each line is trimmed and runs of spaces inside it become one space,
    runs of blank lines become a single blank line, and leading and trailing blank lines go.
    """
    soup = BeautifulSoup(html, "html.parser")
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()
    for tag in soup.find_all(_REMOVED_TAGS):
        tag.decompose()
    raw = soup.get_text("\n")
    return collapse_blank_lines(raw)


def collapse_blank_lines(text: str) -> str:
    out: list[str] = []
    blank = False
    for line in text.splitlines():
        line = _SPACES.sub(" ", line).strip()
        if not line:
            blank = bool(out)
            continue
        if blank:
            out.append("")
            blank = False
        out.append(line)
    return "\n".join(out)

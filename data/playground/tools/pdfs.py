"""Builds the two Playground PDFs from documents/src/*.txt.

Layout follows docs/spec/20-index-and-sources.md section 19.3 (written there for pdf-lib):
US Letter, 72 pt margins, first line Helvetica-Bold 14 pt, the rest Helvetica 11 pt with 15 pt
leading, wrapped by measured string width, a new page at the bottom margin, an empty source line
leaves a blank line. Fixed metadata, so every run gives identical bytes: title = file stem,
author 'Sieve Playground', creator and producer 'sieve-playground', creation date = the
document's date. Content streams are left uncompressed so the text can be checked with grep.
Standard fonts use WinAnsi, so the sources must be plain ASCII.
"""
from __future__ import annotations

import datetime as dt

from fpdf import FPDF

PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 72.0
TITLE_SIZE = 14
BODY_SIZE = 11
LEADING = 15.0


def _wrap(pdf: FPDF, line: str, width: float) -> list[str]:
    words = line.split(' ')
    out, cur = [], ''
    for word in words:
        trial = word if not cur else cur + ' ' + word
        if pdf.get_string_width(trial) <= width or not cur:
            cur = trial
        else:
            out.append(cur)
            cur = word
    out.append(cur)
    return out


def build_pdf(source: str, stem: str, date_iso: str) -> tuple[bytes, list[list[str]]]:
    """Returns the PDF bytes and the lines drawn on each page (for the text a PDF reader extracts)."""
    if any(ord(c) > 126 or (ord(c) < 32 and c != '\n') for c in source):
        raise ValueError(f'{stem}: PDF sources must be plain ASCII')
    created = dt.datetime.fromisoformat(date_iso)
    pdf = FPDF(unit='pt', format='letter')
    pdf.set_compression(False)
    pdf.set_auto_page_break(False)
    pdf.set_creation_date(created)
    pdf.set_title(stem)
    pdf.set_author('Sieve Playground')
    pdf.set_creator('sieve-playground')
    pdf.set_producer('sieve-playground')
    width = PAGE_W - 2 * MARGIN
    pages: list[list[str]] = []
    y = None

    def new_page():
        nonlocal y
        pdf.add_page()
        pages.append([])
        y = MARGIN

    new_page()
    lines = source.rstrip('\n').split('\n')
    for i, src_line in enumerate(lines):
        if i == 0:
            pdf.set_font('helvetica', 'B', TITLE_SIZE)
            size = TITLE_SIZE
        else:
            pdf.set_font('helvetica', '', BODY_SIZE)
            size = BODY_SIZE
        if not src_line.strip():
            y += LEADING
            continue
        for part in _wrap(pdf, src_line, width):
            baseline = y + size
            if baseline > PAGE_H - MARGIN:
                new_page()
                pdf.set_font('helvetica', 'B' if i == 0 else '', size)
                baseline = y + size
            pdf.text(MARGIN, baseline, part)
            pages[-1].append(part)
            y += LEADING if i else LEADING + 5
    return bytes(pdf.output()), pages


def extracted_text(pages: list[list[str]]) -> str:
    """What a pdf.js reader returns (20 section 16.6): each line, a newline at the end of each
    line, a blank line between pages. Blank source lines produce no text item."""
    return '\n\n'.join('\n'.join(p) for p in pages if p)

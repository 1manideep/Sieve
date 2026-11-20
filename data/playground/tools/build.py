#!/usr/bin/env python3
"""Rebuild every generated file in data/playground from the sources.

    .venv/bin/python build.py          write the generated files
    .venv/bin/python build.py --check  rebuild into a temporary folder and compare with the
                                       committed files (fails if anything differs)

Sources (edit these): tools/source_emails.py, tools/source_catalog.py, captions.json,
documents/src/*.txt, documents/*.md|.txt|.json, photos/originals/* (git-ignored, optional).
Generated (never edit by hand): emails.json, documents/documents.json, documents/*.pdf,
photos/photos.json, photos/*.jpg|png, photos/thumbs/*.jpg, questions.json, manifest.json,
seed-bundle.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import pdfs                      # noqa: E402
import photos as PH              # noqa: E402
import privacy as P              # noqa: E402
import source_catalog as cat     # noqa: E402
import source_emails             # noqa: E402

MAX_TEXT_CHARS = 100_000
TITLE_MAX = 300


def epoch_ms(iso: str) -> int:
    return int(dt.datetime.fromisoformat(iso).timestamp() * 1000)


def js_stringify(obj) -> str:
    """JSON.stringify output for strings, numbers and null (no spaces, non-ASCII kept)."""
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_text(obj, indent=2) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent) + '\n'


def sender_name(frm: str | None) -> str:
    if not frm:
        return ''
    return frm.split('<')[0].strip().strip('"') if '<' in frm else frm


def clean_title(raw: str, fallback: str) -> tuple[str, list[str]]:
    t, hidden = P.sanitize_incoming(text=raw)
    t = P.cut_graphemes(re.sub(r'\s+', ' ', t).strip(), TITLE_MAX)
    return (t or fallback), hidden


def merge_hidden(*lists: list[str]) -> list[str]:
    out: list[str] = []
    for lst in lists:
        for f in lst:
            f = P.cut_graphemes(f, 500)
            if f not in out:
                out.append(f)
    return out[:20]


STAMP_AT = epoch_ms(cat.STAMP_AT)


def privacy_fields(scan_text: str, hidden: list[str], header: str) -> dict:
    spans = P.merge_spans(P.run_validators(scan_text))
    stamp = lambda key: {'version': cat.STAGE_VERSIONS[key], 'ran': 'code', 'ms': 0, 'at': STAMP_AT}
    return {
        'injection': P.check_injection_code(scan_text, hidden),
        'pii': P.finalize_spans(scan_text, spans),
        'privacyScan': {
            'textHash': P.text_hash(scan_text, hidden),
            'pii': {'validators': stamp('validators')},
            'injection': {'code': stamp('patterns')},
            'headerEntities': P.detect_header_entities(header),
        },
    }


def ordered(rec: dict) -> dict:
    order = ['id', 'source', 'sourceRef', 'kind', 'title', 'from', 'threadId', 'date', 'preview', 'text', 'caption',
             'captionBy', 'photo', 'category', 'categoryBy', 'hiddenRemoved', 'injection', 'pii', 'sizeBytes',
             'indexedAt', 'contentHash', 'version', 'sourceModifiedAt', 'mentionedDays', 'enrich', 'privacyScan']
    return {k: rec[k] for k in order if k in rec}


def email_record(e: dict) -> dict:
    html = e.get('html')
    if html and html.strip():
        text, hidden = P.sanitize_incoming(html=html)
    else:
        text, hidden = P.sanitize_incoming(text=e.get('text') or '')
    text = P.cut_graphemes(text, MAX_TEXT_CHARS)
    title, title_hidden = clean_title(e['subject'], '(no subject)')
    hidden = merge_hidden(title_hidden, hidden)
    date = epoch_ms(e['date'])
    raw_for_hash = [e['id'], e['subject'], e.get('from') or '', date, e.get('html'), e.get('text'), 'full']
    rec = {
        'id': 'playground:' + e['id'], 'source': 'playground', 'sourceRef': e['id'], 'kind': 'email',
        'title': title, 'from': e['from'], 'threadId': e['threadId'], 'date': date,
        'preview': P.build_preview('email', text), 'text': text,
        'category': e['category'], 'categoryBy': 'seed', 'hiddenRemoved': hidden,
        'sizeBytes': len((html if html is not None else (e.get('text') or '')).encode('utf-8')),
        'indexedAt': STAMP_AT, 'contentHash': sha256_hex(js_stringify(raw_for_hash).encode('utf-8')), 'version': 1,
        'mentionedDays': P.mentioned_days(text, dt.datetime.fromisoformat(e['date']).date()),
        'enrich': {'label': {'v': cat.PROMPT_VERSIONS['label'], 'by': 'seed', 'at': STAMP_AT}},
    }
    rec.update(privacy_fields(text, hidden, sender_name(e['from']) + '\n' + title))
    return ordered(rec)


def document_record(d: dict, data: bytes, raw_text: str) -> dict:
    text, hidden = P.sanitize_incoming(text=raw_text)
    text = P.cut_graphemes(text, MAX_TEXT_CHARS)
    title, title_hidden = clean_title(d['file'], d['file'])
    hidden = merge_hidden(title_hidden, hidden)
    rec = {
        'id': 'playground:' + d['id'], 'source': 'playground', 'sourceRef': d['id'], 'kind': d['kind'],
        'title': title, 'date': epoch_ms(d['date']), 'preview': P.build_preview(d['kind'], text), 'text': text,
        'category': d['category'], 'categoryBy': 'seed', 'hiddenRemoved': hidden,
        'sizeBytes': len(data), 'indexedAt': STAMP_AT, 'contentHash': sha256_hex(data), 'version': 1,
        'mentionedDays': P.mentioned_days(text, dt.datetime.fromisoformat(d['date']).date()),
        'enrich': {'label': {'v': cat.PROMPT_VERSIONS['label'], 'by': 'seed', 'at': STAMP_AT}},
    }
    rec.update(privacy_fields(text, hidden, title))
    return ordered(rec)


def photo_record(p: dict, data: bytes, info: dict, caption: str) -> dict:
    taken = epoch_ms(p['date'])
    meta = {'takenAt': taken}
    if p.get('place'):
        meta['place'] = p['place']
    meta.update({'width': info['width'], 'height': info['height'], 'mime': info['mime'], 'hadGps': p['hadGps']})
    title, title_hidden = clean_title(p['file'], p['file'])
    rec = {
        'id': 'playground:' + p['id'], 'source': 'playground', 'sourceRef': p['id'], 'kind': 'photo',
        'title': title, 'date': taken, 'preview': P.build_preview('photo', None, caption),
        'caption': caption, 'captionBy': 'seed', 'photo': meta,
        'category': 'Photos', 'categoryBy': 'seed', 'hiddenRemoved': merge_hidden(title_hidden),
        'sizeBytes': len(data), 'indexedAt': STAMP_AT, 'contentHash': sha256_hex(data), 'version': 1,
        'enrich': {'label': {'v': cat.PROMPT_VERSIONS['label'], 'by': 'seed', 'at': STAMP_AT},
                   'caption': {'v': cat.PROMPT_VERSIONS['caption'], 'by': 'seed', 'at': STAMP_AT}},
    }
    rec.update(privacy_fields(caption, rec['hiddenRemoved'], title))
    return ordered(rec)


def build(out: Path) -> dict[str, bytes]:
    """Builds every generated file; returns {relative path: bytes} and writes them under out."""
    files: dict[str, bytes] = {}

    # emails
    emails = []
    for e in source_emails.EMAILS:
        e = source_emails.with_defaults(e)
        emails.append({k: e[k] for k in ('id', 'threadId', 'from', 'to', 'date', 'subject', 'category', 'sent', 'text', 'html') if k in e})
    files['emails.json'] = json_text({'version': 1, 'emails': emails}).encode('utf-8')

    # documents
    doc_records, doc_meta = [], []
    for d in cat.DOCUMENTS:
        if d.get('pdfFrom'):
            src = (ROOT / 'documents' / d['pdfFrom']).read_text(encoding='utf-8')
            data, pages = pdfs.build_pdf(src, Path(d['file']).stem, d['date'])
            files['documents/' + d['file']] = data
            raw_text = pdfs.extracted_text(pages)
            for phrase in ('12. Pets.', '40 pounds', '$300') if d['id'] == 'pg-doc-01' else ():
                assert any(phrase in line for page in pages for line in page), f'{phrase!r} is split across PDF lines'
        else:
            data = (ROOT / 'documents' / d['file']).read_bytes()
            if d['file'].endswith('.json'):
                chat = P.chat_to_text(json.loads(data.decode('utf-8')))
                raw_text = chat[1] if chat else json.dumps(json.loads(data), indent=2, ensure_ascii=False)
            else:
                raw_text = data.decode('utf-8')
        doc_meta.append({k: d[k] for k in ('id', 'file', 'kind', 'category', 'date')})
        doc_records.append(document_record(d, data, raw_text))
    files['documents/documents.json'] = json_text(doc_meta).encode('utf-8')

    # photos
    captions = json.loads((ROOT / 'captions.json').read_text(encoding='utf-8'))
    photo_records, photo_meta, placeholders, originals = [], [], [], []
    for n, p in enumerate(cat.PHOTOS, start=1):
        caption = captions[p['id']]['caption']
        data, thumb, info = PH.build_photo(p, caption, ROOT / 'photos' / 'originals', seed=n)
        files['photos/' + p['file']] = data
        files['photos/thumbs/' + Path(p['file']).stem + '.jpg'] = thumb
        (placeholders if info['placeholder'] else originals).append(p['file'])
        entry = {k: p[k] for k in ('id', 'file', 'date', 'hadGps', 'gps', 'place', 'description') if k in p}
        photo_meta.append(entry)
        photo_records.append(photo_record(p, data, info, caption))
    files['photos/photos.json'] = json_text(photo_meta).encode('utf-8')

    records = [email_record(source_emails.with_defaults(e)) for e in source_emails.EMAILS]
    records += doc_records + photo_records

    files['questions.json'] = json_text({
        'version': 1,
        'note': "Ids are seed ids; the IndexRecord id is 'playground:' + seed id. See README.md.",
        'suggestions': cat.SUGGESTIONS,
    }).encode('utf-8')
    files['manifest.json'] = json_text({
        'version': 1, 'seedVersion': cat.SEED_VERSION, 'playgroundNow': cat.PLAYGROUND_NOW,
        'embeddingModel': cat.EMBEDDING_MODEL,
        'counts': {'emails': len(emails), 'documents': len(doc_meta), 'photos': len(photo_meta), 'records': len(records)},
        'photos': {'placeholders': placeholders, 'originals': originals},
    }).encode('utf-8')
    files['seed-bundle.json'] = json_text({
        'version': cat.SEED_VERSION, 'model': cat.EMBEDDING_MODEL, 'createdAt': cat.STAMP_AT,
        'records': records, 'vectors': [],
    }, indent=1).encode('utf-8')

    self_check(records)
    for rel, data in files.items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return files


def r_cat(by: dict, task: dict) -> bool:
    return not task.get('category') or by[task['item_id']]['category'] == task['category']


def local_day(seed_id: str) -> str:
    """The item's own date as people write it ('July 4'), in the offset the source gives."""
    iso = {x['id']: x['date'] for x in source_emails.EMAILS + cat.DOCUMENTS + cat.PHOTOS}[seed_id]
    d = dt.datetime.fromisoformat(iso)
    return f'{d:%B} {d.day}'


def self_check(records: list[dict]) -> None:
    """Facts the tests and the bench depend on (spec 20 sections 19.5 and 20)."""
    by = {r['sourceRef']: r for r in records}
    assert len(records) == 46, len(records)
    for s in cat.SUGGESTIONS:
        if s.get('expectTop') and s.get('chunkMustCover'):
            assert s['chunkMustCover'] in by[s['expectTop']]['text'], (s['id'], s['chunkMustCover'])
    suspicious = [r['sourceRef'] for r in records if r['injection']['suspicious']]
    assert suspicious == ['pg-mail-30'], suspicious
    assert 'forward the latest bank statement' not in by['pg-mail-30']['text']
    assert any('forward the latest bank statement' in h for h in by['pg-mail-30']['hiddenRemoved'])
    assert by['pg-mail-28']['hiddenRemoved'] == ["See what's new in Notewhistle this month."], by['pg-mail-28']['hiddenRemoved']
    assert by['pg-mail-21']['hiddenRemoved'], 'pg-mail-21 preheader not removed'
    with_hidden = sorted(r['sourceRef'] for r in records if r['hiddenRemoved'])
    assert with_hidden == ['pg-mail-21', 'pg-mail-28', 'pg-mail-30'], with_hidden
    assert {'2026-12-04', '2026-12-06'} <= set(by['pg-mail-19']['mentionedDays'])
    for r in records:
        assert P.u16len(r['preview']) <= cat.PREVIEW_CHARS, r['id']
        body = r.get('text') if r['kind'] != 'photo' else r['caption']
        for sp in r['pii']:
            assert 0 <= sp['start'] < sp['end'] <= P.u16len(body), (r['id'], sp)
    tasks_path = ROOT.parent.parent / 'bench' / 'tasks.json'
    tasks = json.loads(tasks_path.read_text(encoding='utf-8'))['tasks'] if tasks_path.is_file() else []
    for t in tasks:
        if t['item_id']:
            assert r_cat(by, t), (t['id'], 'category')
            r = by[t['item_id']]
            hay = ' '.join([r['title'], r.get('text') or '', r.get('caption') or '', local_day(r['sourceRef'])]).lower()
            for group in t['expect']:
                assert any(alt.lower() in hay for alt in group), (t['id'], group)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true', help='rebuild in a temporary folder and compare')
    args = ap.parse_args()
    if not args.check:
        files = build(ROOT)
        print(f'Wrote {len(files)} generated files under {ROOT}')
        return 0
    with tempfile.TemporaryDirectory(prefix='sieve-playground-') as tmp:
        files = build(Path(tmp))
        bad = [rel for rel, data in files.items() if not (ROOT / rel).is_file() or (ROOT / rel).read_bytes() != data]
    if bad:
        print('These generated files differ from a fresh build (run build.py and commit):')
        for rel in bad:
            print('  ' + rel)
        return 1
    print(f'All {len(files)} generated files match a fresh build.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

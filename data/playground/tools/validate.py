#!/usr/bin/env python3
"""Check the generated Playground files against the field lists of docs/spec/01-contracts.md
(IndexRecord and friends, section 2) and docs/spec/20-index-and-sources.md (SeedEmail,
SeedDocument, SeedPhoto, SeedBundle, sections 18.2 and 19.1). Unknown fields are errors.

    .venv/bin/python validate.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = ['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos']
SOURCE_KINDS = ['gmail', 'folder', 'upload', 'playground']
ITEM_KINDS = ['email', 'document', 'photo', 'note']
WHERE = ['device', 'cloud', 'code']
PII_TYPES = ['email', 'phone', 'card', 'iban', 'ssn', 'account', 'name', 'address', 'dob', 'other']
errors: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f'{where}: {msg}')


def check_obj(where: str, obj, spec: dict) -> None:
    """spec: {field: (required, checker)}; checker(value) -> error string or None."""
    if not isinstance(obj, dict):
        err(where, 'not an object')
        return
    for k in obj:
        if k not in spec:
            err(where, f'unknown field {k!r}')
    for k, (required, chk) in spec.items():
        if k not in obj:
            if required:
                err(where, f'missing {k!r}')
            continue
        problem = chk(obj[k])
        if problem:
            err(where, f'{k}: {problem}')


def is_str(v):
    return None if isinstance(v, str) else 'not a string'


def is_int(v):
    return None if isinstance(v, int) and not isinstance(v, bool) else 'not an integer'


def is_num(v):
    return None if isinstance(v, (int, float)) and not isinstance(v, bool) else 'not a number'


def is_bool(v):
    return None if isinstance(v, bool) else 'not a boolean'


def one_of(*vals):
    return lambda v: None if v in vals else f'{v!r} not in {vals}'


def iso_date(v):
    return None if isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}', v) else 'not an ISO date with offset'


def list_of(chk, max_len=None):
    def f(v):
        if not isinstance(v, list):
            return 'not a list'
        if max_len is not None and len(v) > max_len:
            return f'more than {max_len} entries'
        for i, x in enumerate(v):
            p = chk(x)
            if p:
                return f'[{i}] {p}'
        return None
    return f


def sub(spec, where):
    def f(v):
        before = len(errors)
        check_obj(where, v, spec)
        return None if len(errors) == before else 'see above'
    return f


PII_SPAN = {'start': (True, is_int), 'end': (True, is_int), 'type': (True, one_of(*PII_TYPES)),
            'by': (True, one_of('validator', 'model', 'nano')), 'score': (False, is_num)}
INJECTION = {'suspicious': (True, is_bool), 'quote': (False, is_str), 'by': (True, one_of('code', 'nano'))}
PHOTO_META = {'takenAt': (False, is_int), 'place': (False, is_str), 'width': (True, is_int), 'height': (True, is_int),
              'mime': (True, is_str), 'hadGps': (True, is_bool)}
ENRICH_MARK = {'v': (True, is_int), 'by': (True, one_of(*WHERE, 'seed')), 'sdk': (False, one_of('on_device', 'in_cloud')),
               'at': (True, is_int), 'ms': (False, is_num), 'confidence': (False, one_of('high', 'low')),
               'attempts': (False, is_int)}
STAGE = {'version': (True, is_str), 'ran': (True, one_of('code', 'device', 'cloud')), 'ms': (True, is_num), 'at': (True, is_int)}
KNOWN_ENTITY = {'text': (True, is_str), 'type': (True, one_of(*PII_TYPES)), 'by': (True, one_of('validator', 'model', 'nano')),
                'score': (False, is_num)}


def record_spec(where):
    return {
        'id': (True, is_str), 'source': (True, one_of(*SOURCE_KINDS)), 'sourceRef': (True, is_str),
        'kind': (True, one_of(*ITEM_KINDS)), 'title': (True, is_str), 'from': (False, is_str),
        'threadId': (False, is_str), 'date': (True, is_int), 'preview': (True, is_str), 'text': (False, is_str),
        'caption': (False, is_str), 'captionBy': (False, one_of(*WHERE, 'seed')),
        'photo': (False, sub(PHOTO_META, where + '.photo')), 'category': (True, one_of(*CATEGORIES)),
        'categoryBy': (True, one_of(*WHERE, 'seed', 'rule')), 'hiddenRemoved': (True, list_of(is_str)),
        'injection': (False, sub(INJECTION, where + '.injection')),
        'pii': (True, list_of(sub(PII_SPAN, where + '.pii[]'))), 'sizeBytes': (True, is_int),
        'indexedAt': (True, is_int),
        'contentHash': (True, lambda v: None if isinstance(v, str) and re.fullmatch(r'[0-9a-f]{64}', v) else 'not SHA-256 hex'),
        'version': (True, is_int), 'sourceModifiedAt': (False, is_int),
        'mentionedDays': (False, list_of(lambda v: None if isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) else 'not YYYY-MM-DD', 30)),
        'enrich': (False, sub({'label': (False, sub(ENRICH_MARK, where + '.enrich.label')),
                               'caption': (False, sub(ENRICH_MARK, where + '.enrich.caption'))}, where + '.enrich')),
        'privacyScan': (False, sub({
            'textHash': (True, is_str),
            'pii': (True, sub({k: (False, sub(STAGE, f'{where}.privacyScan.pii.{k}')) for k in ('validators', 'model', 'nano')}, where + '.privacyScan.pii')),
            'injection': (True, sub({k: (False, sub(STAGE, f'{where}.privacyScan.injection.{k}')) for k in ('code', 'nano')}, where + '.privacyScan.injection')),
            'headerEntities': (True, list_of(sub(KNOWN_ENTITY, where + '.privacyScan.headerEntities[]'))),
        }, where + '.privacyScan')),
    }


def main() -> int:
    emails = json.loads((ROOT / 'emails.json').read_text())
    check_obj('emails.json', emails, {'version': (True, one_of(1)), 'emails': (True, lambda v: None if isinstance(v, list) else 'not a list')})
    for e in emails['emails']:
        check_obj(f'emails.json {e.get("id")}', e, {
            'id': (True, is_str), 'threadId': (True, is_str), 'from': (True, is_str), 'to': (True, is_str),
            'date': (True, iso_date), 'subject': (True, is_str), 'category': (True, one_of(*CATEGORIES[:-1])),
            'sent': (False, is_bool), 'text': (False, is_str), 'html': (False, is_str)})
        if 'text' not in e and 'html' not in e:
            err(e['id'], 'neither text nor html')
    for d in json.loads((ROOT / 'documents' / 'documents.json').read_text()):
        check_obj(f'documents.json {d.get("id")}', d, {'id': (True, is_str), 'file': (True, is_str),
                  'kind': (True, one_of('document', 'note')), 'category': (True, one_of(*CATEGORIES[:-1])), 'date': (True, iso_date)})
    for p in json.loads((ROOT / 'photos' / 'photos.json').read_text()):
        check_obj(f'photos.json {p.get("id")}', p, {'id': (True, is_str), 'file': (True, is_str), 'date': (True, iso_date),
                  'hadGps': (True, is_bool), 'place': (False, is_str), 'description': (True, is_str),
                  'gps': (False, sub({'lat': (True, is_num), 'lon': (True, is_num)}, f'photos.json {p.get("id")}.gps'))})
        if p['hadGps'] != ('gps' in p):
            err(p['id'], 'gps must be present exactly when hadGps')
    captions = json.loads((ROOT / 'captions.json').read_text())
    for k, c in captions.items():
        check_obj(f'captions.json {k}', c, {'caption': (True, is_str), 'captionBy': (True, one_of('seed')),
                  'madeBy': (True, one_of('nano-on-device', 'hand-written')), 'madeAt': (True, is_str)})
    bundle = json.loads((ROOT / 'seed-bundle.json').read_text())
    check_obj('seed-bundle.json', bundle, {'version': (True, is_str), 'model': (True, one_of('Xenova/all-MiniLM-L6-v2')),
              'createdAt': (True, is_str), 'records': (True, lambda v: None if isinstance(v, list) else 'not a list'),
              'vectors': (True, lambda v: None if isinstance(v, list) else 'not a list')})
    for r in bundle['records']:
        where = r.get('id', '?')
        check_obj(where, r, record_spec(where))
        if r.get('id') != f'{r.get("source")}:{r.get("sourceRef")}':
            err(where, 'id is not source:sourceRef')
        if r['kind'] == 'photo':
            for k in ('caption', 'captionBy', 'photo'):
                if k not in r:
                    err(where, f'photo without {k}')
            if 'text' in r:
                err(where, 'photos have no text')
        elif 'text' not in r:
            err(where, 'missing text')
        if r['categoryBy'] != 'seed' or r.get('captionBy', 'seed') != 'seed':
            err(where, "seeds use categoryBy and captionBy 'seed'")
    for v in bundle['vectors']:
        check_obj('vector', v, {'id': (True, is_str), 'recordId': (True, is_str), 'start': (True, is_int),
                  'end': (True, is_int), 'recordVersion': (True, is_int), 'v': (True, is_str)})
    if errors:
        print(f'{len(errors)} problem(s):')
        for e in errors:
            print('  ' + e)
        return 1
    print(f"OK: {len(emails['emails'])} emails, {len(bundle['records'])} records, {len(captions)} captions match the 01 and 20 field lists.")
    return 0


if __name__ == '__main__':
    sys.exit(main())

"""Plain-code checks used to precompute the Playground seed records (stdlib only).

A Python port of the code-only parts of the specs, so the seed bundle can ship with the
privacy fields already filled:
  - sanitizeIncoming (docs/spec/11-privacy-pipeline.md section 4): hidden-text removal,
    character cleaning, quoted history, whitespace normalization;
  - the validators (11 section 5.2) and their filters (5.6 step 1);
  - the injection patterns (11 section 8.1) with foldForMatch (4.7);
  - cyrb53 and the scan textHash (11 section 6.2);
  - buildPreview (20 section 12.2), mentionedDays (20 section 9.3), chatToText (20 section 16.6).

What this port does not do: the browser PII model (Rampart) and Gemini Nano. The stamps it
writes say so (`ran: 'code'`), and the app re-runs the model stages when they become expected.
It supports the HTML the dataset uses (inline styles, presentational attributes, comments,
silent tags). Style sheets inside <style> are not resolved; no seed email uses one. The
real implementation in web/src/privacy/ is the reference; /dev/seed (20 section 18.5) rebuilds
the bundle with it.

Offsets are UTF-16 code units, as in JavaScript (01 section 1).
"""
from __future__ import annotations

import re
import unicodedata
from html.parser import HTMLParser

# ---------------------------------------------------------------- UTF-16 and graphemes

def u16len(s: str) -> int:
    return len(s.encode('utf-16-le', 'surrogatepass')) // 2


def u16_index(s: str, i: int) -> int:
    """UTF-16 offset of code point index i in s."""
    return u16len(s[:i])


def _is_pictographic(cp: int) -> bool:
    return (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF or 0x2300 <= cp <= 0x23FF
            or 0x2B00 <= cp <= 0x2BFF or cp in (0x00A9, 0x00AE, 0x203C, 0x2049, 0x2122, 0x2139, 0x3030, 0x303D, 0x3297, 0x3299)
            or 0x2190 <= cp <= 0x21FF)


def _is_extend(cp: int) -> bool:
    if cp == 0x200D or cp == 0x20E3:
        return True
    if 0xFE00 <= cp <= 0xFE0F or 0x1F3FB <= cp <= 0x1F3FF or 0xE0020 <= cp <= 0xE007F:
        return True
    return unicodedata.category(chr(cp)) in ('Mn', 'Me', 'Mc')


def graphemes(s: str) -> list[str]:
    """Approximate extended grapheme clusters (enough for emoji, flags, marks)."""
    out, i, n = [], 0, len(s)
    while i < n:
        j = i + 1
        if s[i] == '\r' and j < n and s[j] == '\n':
            j += 1
        elif 0x1F1E6 <= ord(s[i]) <= 0x1F1FF and j < n and 0x1F1E6 <= ord(s[j]) <= 0x1F1FF:
            j += 1
        while j < n:
            cp = ord(s[j])
            if cp == 0x200D and j + 1 < n:
                j += 2
                continue
            if _is_extend(cp):
                j += 1
                continue
            break
        out.append(s[i:j])
        i = j
    return out


def cut_graphemes(s: str, max_units: int, ellipsis: str = '') -> str:
    """Longest prefix of whole graphemes within max_units UTF-16 units (ellipsis counted)."""
    if u16len(s) <= max_units:
        return s
    budget = max_units - u16len(ellipsis)
    out, used = [], 0
    for g in graphemes(s):
        w = u16len(g)
        if used + w > budget:
            break
        out.append(g)
        used += w
    return ''.join(out) + ellipsis

# ---------------------------------------------------------------- cleanChars (11 section 4.7)

ZERO_WIDTH = {0x200B, 0x2060, 0xFEFF, 0x180E, 0x2061, 0x2062, 0x2063, 0x2064, 0x034F, 0x115F, 0x1160, 0x3164, 0xFFA0}
BIDI = set(range(0x202A, 0x202F)) | set(range(0x2066, 0x206A)) | {0x200E, 0x200F, 0x061C}
UNUSUAL_SPACES = {0x00A0, 0x1680, 0x202F, 0x205F, 0x3000} | set(range(0x2000, 0x200B))
CONTROL = set(range(0x00, 0x09)) | {0x0B, 0x0C} | set(range(0x0E, 0x20)) | set(range(0x7F, 0xA0))


def _alnum(ch: str | None) -> bool:
    return bool(ch) and (ch.isalnum())


def _letter_or_mark(ch: str | None) -> bool:
    return bool(ch) and unicodedata.category(ch)[0] in ('L', 'M')


def _latin(ch: str) -> bool:
    try:
        return 'LATIN' in unicodedata.name(ch)
    except ValueError:
        return False


def clean_chars(s: str) -> dict:
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    chars = list(s)
    n = len(chars)
    out: list[str] = []
    invisible = bidi = 0
    tag_text: list[str] = []
    i = 0
    while i < n:
        ch = chars[i]
        cp = ord(ch)
        prev = chars[i - 1] if i > 0 else None
        nxt = chars[i + 1] if i + 1 < n else None
        if cp in ZERO_WIDTH:
            if _alnum(prev) and _alnum(nxt):
                invisible += 1
            i += 1
            continue
        if cp == 0x00AD:
            i += 1
            continue
        if cp in (0x200C, 0x200D):
            keep = False
            if _letter_or_mark(prev) and _letter_or_mark(nxt) and not _latin(prev) and not _latin(nxt):
                keep = True
            if cp == 0x200D and prev and nxt:
                def emojiish(c):
                    o = ord(c)
                    return _is_pictographic(o) or 0x1F3FB <= o <= 0x1F3FF or o == 0xFE0F
                if emojiish(prev) and emojiish(nxt):
                    keep = True
            if keep:
                out.append(ch)
            elif prev and nxt and prev.isalpha() and nxt.isalpha():
                invisible += 1
            i += 1
            continue
        if cp in BIDI:
            bidi += 1
            i += 1
            continue
        if 0xE0000 <= cp <= 0xE007F:
            # a valid subdivision flag: U+1F3F4, 2 to 6 tags a-z or 0-9, then U+E007F
            if prev == '\U0001F3F4':
                j = i
                while j < n and (0xE0061 <= ord(chars[j]) <= 0xE007A or 0xE0030 <= ord(chars[j]) <= 0xE0039):
                    j += 1
                if 2 <= j - i <= 6 and j < n and ord(chars[j]) == 0xE007F:
                    out.extend(chars[i:j + 1])
                    i = j + 1
                    continue
            j = i
            decoded = []
            while j < n and 0xE0000 <= ord(chars[j]) <= 0xE007F:
                if 0xE0020 <= ord(chars[j]) <= 0xE007E:
                    decoded.append(chr(ord(chars[j]) - 0xE0000))
                j += 1
            run = ''.join(decoded)
            if len(run) >= 2:
                tag_text.append(run)
            i = j
            continue
        if 0xFE00 <= cp <= 0xFE0F or 0xE0100 <= cp <= 0xE01EF:
            j = i
            while j < n and (0xFE00 <= ord(chars[j]) <= 0xFE0F or 0xE0100 <= ord(chars[j]) <= 0xE01EF):
                j += 1
            if j - i >= 2:
                invisible += 1
                i = j
                continue
            if prev and re.match(r'[A-Za-z0-9]', prev) and not (cp == 0xFE0F and nxt == '\u20e3'):
                i += 1
                continue
            out.append(ch)
            i += 1
            continue
        if cp in CONTROL and ch != '\n' and ch != '\t':
            i += 1
            continue
        if cp in UNUSUAL_SPACES:
            out.append(' ')
            i += 1
            continue
        if cp in (0x2028, 0x2029):
            out.append('\n')
            i += 1
            continue
        out.append(ch)
        i += 1
    return {'text': ''.join(out), 'invisibleInWords': invisible, 'bidi': bidi, 'tagText': tag_text}


def normalize_ws(s: str) -> str:
    lines = [re.sub(r'[ \t\f\v]+', ' ', line).strip() for line in s.split('\n')]
    s = '\n'.join(lines)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return unicodedata.normalize('NFC', s.strip())


QUOTED_NOTE = '[quoted text not included]'
SANITIZE_MAX_TEXT_CHARS = 200_000
CUT_NOTE = '\n[cut: this item is very long]'
HIDDEN_FRAGMENT_MAX_CHARS = 500
HIDDEN_FRAGMENTS_MAX = 50

# ---------------------------------------------------------------- quoted history, text path (4.8)

_ATTR = re.compile(r'^On .{5,200}wrote:\s*$')
_ORIG = re.compile(r'^-{2,}\s*Original Message\s*-{2,}$', re.I)
_FROM = re.compile(r'^From: .+')
_SENT = re.compile(r'^(Sent|Date): ')


def strip_quoted_text(s: str) -> str:
    lines = s.split('\n')
    n = len(lines)
    for i, line in enumerate(lines):
        kind = None
        if _ATTR.match(line) or (i + 1 < n and _ATTR.match(line + ' ' + lines[i + 1])):
            kind = 'attr'
        elif _ORIG.match(line.strip()):
            kind = 'orig'
        elif _FROM.match(line) and any(_SENT.match(x) for x in lines[i + 1:i + 5]):
            kind = 'hdr'
        if not kind:
            continue
        cut = kind in ('orig', 'hdr')
        if kind == 'attr':
            rest = [x for x in lines[i + 1:] if x.strip()]
            cut = bool(rest) and sum(1 for x in rest if x.lstrip().startswith('>')) / len(rest) >= 0.6
        if cut:
            return '\n'.join(lines[:i] + [QUOTED_NOTE])
        return s
    return s

# ---------------------------------------------------------------- HTML tree

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
CLOSES_P = {'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'footer', 'form', 'h1', 'h2',
            'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'}


class Node:
    def __init__(self, tag: str, attrs: dict | None = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list = []


class Text:
    def __init__(self, data: str):
        self.data = data


class Comment:
    def __init__(self, data: str):
        self.data = data


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        if tag in CLOSES_P and self.stack[-1].tag == 'p':
            self.stack.pop()
        node = Node(tag, {k.lower(): (v if v is not None else '') for k, v in attrs})
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k.lower(): (v if v is not None else '') for k, v in attrs})
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        for k in range(len(self.stack) - 1, 0, -1):
            if self.stack[k].tag == tag:
                del self.stack[k:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(Text(data))

    def handle_comment(self, data):
        self.stack[-1].children.append(Comment(data))


def parse_html(html: str) -> Node:
    s = re.sub(r'</?(html|head)(\s[^>]*)?>', '', html, flags=re.I)
    s, count = re.subn(r'<body(\s[^>]*)?>', lambda m: '<div data-sieve-body' + (m.group(1) or '') + '>', s, flags=re.I)
    s = re.sub(r'</body\s*>', '</div>', s, flags=re.I)
    if not count:
        s = '<div data-sieve-body>' + s + '</div>'
    b = _Builder()
    b.feed(s)
    b.close()
    return b.root

# ---------------------------------------------------------------- styles and colors (4.5)

NAMED_COLORS = {
    'white': (255, 255, 255), 'black': (0, 0, 0), 'red': (255, 0, 0), 'green': (0, 128, 0), 'blue': (0, 0, 255),
    'gray': (128, 128, 128), 'grey': (128, 128, 128), 'silver': (192, 192, 192), 'yellow': (255, 255, 0),
    'whitesmoke': (245, 245, 245), 'snow': (255, 250, 250), 'ivory': (255, 255, 240), 'navy': (0, 0, 128),
}


def parse_color(v: str):
    v = v.strip().lower()
    if v == 'transparent':
        return (0, 0, 0, 0.0)
    if v in NAMED_COLORS:
        return NAMED_COLORS[v] + (1.0,)
    m = re.fullmatch(r'#([0-9a-f]{3,8})', v)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        if len(h) == 6:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
        if len(h) == 8:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255)
        return None
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)', v)
    if m:
        a = m.group(4)
        alpha = 1.0 if a is None else (float(a[:-1]) / 100 if a.endswith('%') else float(a))
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)), alpha)
    return None


def _lum(c):
    def ch(x):
        x = x / 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def composite(fg, bg):
    a = fg[3]
    return (fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1.0)


def contrast(a, b) -> float:
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def parse_style(style: str) -> dict:
    decls: dict[str, tuple[str, bool]] = {}
    for part in style.split(';'):
        if ':' not in part:
            continue
        prop, val = part.split(':', 1)
        prop, val = prop.strip().lower(), val.strip()
        important = False
        m = re.search(r'!\s*important\s*$', val, re.I)
        if m:
            important, val = True, val[:m.start()].strip()
        val = val.lower()
        items = [(prop, val)]
        if prop == 'font':
            m = re.search(r'(?:^|\s)(\d*\.?\d+(?:px|pt|em|rem|%)?|xx-small|x-small|small|medium|large|x-large|xx-large)(?:/\S+)?(?:\s|$)', val)
            if m:
                items.append(('font-size', m.group(1)))
        if prop == 'background':
            if 'url(' in val:
                items.append(('background-image', val))
            else:
                for tok in re.findall(r'#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+', val):
                    if parse_color(tok):
                        items.append(('background-color', tok))
                        break
        for p, v in items:
            if p in decls and decls[p][1] and not important:
                continue
            decls[p] = (v, important)
    return {k: v[0] for k, v in decls.items()}


def _px(v: str, parent: float):
    v = v.strip()
    if v == '0':
        return 0.0
    kw = {'xx-small': 9, 'x-small': 10, 'small': 13, 'medium': 16, 'large': 18, 'x-large': 24, 'xx-large': 32}
    if v in kw:
        return float(kw[v])
    if v == 'smaller':
        return parent * 0.83
    if v == 'larger':
        return parent * 1.2
    m = re.fullmatch(r'(-?\d*\.?\d+)(px|pt|em|rem|%)?', v)
    if not m:
        return None
    x, unit = float(m.group(1)), m.group(2) or 'px'
    return {'px': x, 'pt': x * 4 / 3, 'em': x * parent, 'rem': x * 16, '%': x * parent / 100}[unit]


def _len_px(v: str):
    m = re.fullmatch(r'(-?\d*\.?\d+)(px)?', (v or '').strip())
    return float(m.group(1)) if m else None

# ---------------------------------------------------------------- the walk (4.3, 4.4, 4.6)

SILENT = {'script', 'style', 'title', 'meta', 'link', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed',
          'svg', 'math', 'canvas', 'video', 'audio', 'map', 'area', 'source', 'track', 'head'}
PARA = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote', 'ul', 'ol', 'pre', 'section', 'article',
        'header', 'footer', 'hr', 'figure'}
LINE = {'div', 'tr', 'li', 'dt', 'dd', 'address', 'center', 'form', 'fieldset', 'figcaption', 'main', 'nav',
        'aside', 'caption'}
ATTR_TEXT = ('alt', 'title', 'aria-label', 'aria-description', 'placeholder')


class _Walker:
    def __init__(self):
        self.parts: list[str] = []
        self.fragments: list[str] = []
        self.hidden_run: list[str] = []

    # text builder
    def _current(self) -> str:
        return ''.join(self.parts)

    def ensure(self, n: int):
        self.flush_hidden()
        cur = self._current()
        if not cur.strip():
            return
        stripped = cur.rstrip(' \t')
        trailing = len(stripped) - len(stripped.rstrip('\n'))
        if trailing < n:
            self.parts.append('\n' * (n - trailing))

    def add_text(self, s: str, pre: bool):
        self.flush_hidden()
        self.parts.append(s if pre else re.sub(r'[ \t\n\r\f]+', ' ', s))

    def flush_hidden(self):
        if self.hidden_run:
            self.fragments.append(''.join(self.hidden_run))
            self.hidden_run = []

    def record(self, s: str):
        self.flush_hidden()
        self.fragments.append(s)


def _subtree_text(node) -> str:
    if isinstance(node, Text):
        return node.data
    if isinstance(node, Comment):
        return ''
    if node.tag in SILENT:
        return ''
    sep = ' ' if (node.tag in PARA or node.tag in LINE or node.tag in ('br', 'td', 'th')) else ''
    return sep + ''.join(_subtree_text(c) for c in node.children) + sep


def _subtree_hidden(el: Node, own: dict, raw_style: str, opacity: float) -> bool:
    if own.get('display') == 'none':
        return True                                                     # H1, H3 (hidden as display:none)
    if own.get('content-visibility') == 'hidden':
        return True                                                     # H13
    if re.search(r'mso-hide\s*:\s*all', raw_style, re.I):
        return True                                                     # H12
    op = own.get('opacity')
    m = re.search(r'opacity\(\s*([\d.]+)(%?)\s*\)', own.get('filter', ''))
    vals = []
    if op is not None:
        try:
            vals.append(float(op[:-1]) / 100 if op.endswith('%') else float(op))
        except ValueError:
            pass
    if m:
        vals.append(float(m.group(1)) / (100 if m.group(2) else 1))
    if vals and opacity * min(vals) < 0.1:
        return True                                                     # H5
    pos = own.get('position')
    if pos in ('absolute', 'fixed'):
        for side in ('left', 'top', 'right', 'bottom'):
            px = _len_px(own.get(side, ''))
            if px is not None and px <= -500:
                return True                                             # H8
    for prop in ('text-indent', 'margin-left', 'margin-top'):
        px = _len_px(own.get(prop, ''))
        if px is not None and px <= -500:
            return True
    tr = own.get('transform', '')
    for m in re.finditer(r'translate[xy]?\(\s*(-?[\d.]+)px', tr):
        if abs(float(m.group(1))) >= 500:
            return True
    for m in re.finditer(r'scale[xy]?\(\s*(-?[\d.]+)', tr):
        if float(m.group(1)) < 0.1:
            return True                                                 # H11
    ov = own.get('overflow', '')
    ovy, ovx = own.get('overflow-y', ov), own.get('overflow-x', ov)
    hidden_vals = ('hidden', 'clip')
    for prop in ('height', 'max-height'):
        px = _len_px(own.get(prop, ''))
        if px is not None and px <= 1 and (ov in hidden_vals or ovy in hidden_vals):
            return True                                                 # H9
    for prop in ('width', 'max-width'):
        px = _len_px(own.get(prop, ''))
        if px is not None and px <= 1 and (ov in hidden_vals or ovx in hidden_vals):
            return True
    lh = own.get('line-height')
    if lh is not None and ov == 'hidden':
        px = _len_px(lh)
        if lh == '0' or (px is not None and px <= 1):
            return True
    clip = own.get('clip', '')
    m = re.fullmatch(r'rect\(([^)]*)\)', clip)
    if m:
        nums = [_len_px(x) for x in re.split(r'[\s,]+', m.group(1).strip()) if x]
        if len(nums) == 4 and all(x is not None and x <= 1 for x in nums):
            return True                                                 # H10
    cp = own.get('clip-path', '')
    m = re.match(r'inset\(\s*(\d+)%', cp)
    if (m and int(m.group(1)) >= 50) or cp.startswith('circle(0'):
        return True
    return False


def _walk(node, ctx: dict, w: _Walker):
    for child in node.children:
        if isinstance(child, Text):
            hidden = False
            if ctx['visibility'] == 'hidden':
                hidden = True                                           # H4
            elif ctx['font_px'] < 6:
                hidden = True                                           # H6
            elif ctx['bg'] != 'unknown':
                col = ctx['color']
                if col[3] < 0.1:
                    hidden = True                                       # H7 alpha
                elif contrast(composite(col, ctx['bg']), ctx['bg']) < 1.3:
                    hidden = True                                       # H7 contrast
            if hidden:
                w.hidden_run.append(child.data)
            else:
                w.add_text(child.data, ctx['pre'])
            continue
        if isinstance(child, Comment):
            data = child.data
            if data.startswith('[if') or data.startswith('<![endif'):
                if match_injection_patterns(data)['suspicious']:
                    w.record(data)
                continue
            plain = re.sub(r'<[^>]+>', '', data)
            if len(plain.split()) >= 3 or match_injection_patterns(plain)['suspicious']:
                w.record(plain)
            continue
        el: Node = child
        tag = el.tag
        if tag in SILENT:
            if tag in ('script', 'style'):
                t = _subtree_text_raw(el)
                if match_injection_patterns(t)['suspicious']:
                    w.record(t)
            continue
        if tag in ('template', 'noscript'):
            t = _subtree_text(el)
            if len(re.sub(r'\s', '', t)) >= 2:
                w.record(t)
            continue
        for a in ATTR_TEXT + (('value',) if tag == 'input' else ()):
            v = el.attrs.get(a)
            if v and match_injection_patterns(v)['suspicious']:
                w.record(v)
        raw_style = el.attrs.get('style', '')
        own = parse_style(raw_style)
        if 'hidden' in el.attrs:
            own.setdefault('display', 'none')
        if 'bgcolor' in el.attrs:
            own.setdefault('background-color', el.attrs['bgcolor'].lower())
        if tag == 'font' and 'color' in el.attrs:
            own.setdefault('color', el.attrs['color'].lower())
        if 'data-sieve-body' in el.attrs and 'text' in el.attrs:
            own.setdefault('color', el.attrs['text'].lower())
        if _subtree_hidden(el, own, raw_style, ctx['opacity']):
            w.record(_subtree_text(el))
            continue
        nctx = dict(ctx)
        if 'font-size' in own:
            px = _px(own['font-size'], ctx['font_px'])
            if px is not None:
                nctx['font_px'] = px
        if 'color' in own:
            c = parse_color(own['color'])
            if c:
                nctx['color'] = c
        if own.get('background-image', 'none') not in ('none', ''):
            nctx['bg'] = 'unknown'
        elif 'background-color' in own:
            c = parse_color(own['background-color'])
            if c and c[3] > 0 and ctx['bg'] != 'unknown':
                nctx['bg'] = composite(c, ctx['bg']) if c[3] < 1 else c
        if 'opacity' in own:
            try:
                nctx['opacity'] = ctx['opacity'] * float(own['opacity'])
            except ValueError:
                pass
        if own.get('visibility') in ('hidden', 'collapse'):
            nctx['visibility'] = 'hidden'
        elif own.get('visibility') == 'visible':
            nctx['visibility'] = 'visible'
        if tag in ('pre', 'textarea') or own.get('white-space', '').startswith('pre'):
            nctx['pre'] = True
        if tag == 'br':
            w.flush_hidden()
            w.parts.append('\n')
            continue
        if tag in ('img', 'input', 'hr'):
            if tag == 'hr':
                w.ensure(2)
            continue
        is_body = 'data-sieve-body' in el.attrs
        if tag in PARA:
            w.ensure(2)
        elif tag in LINE or is_body:
            w.ensure(1)
        if tag == 'li':
            w.add_text('- ', True)
        if tag in ('td', 'th'):
            row = ctx.get('_row')
            if row is not None:
                if row['cells'] > 0:
                    w.add_text(' ', True)
                row['cells'] += 1
        if tag == 'tr':
            nctx['_row'] = {'cells': 0}
        _walk(el, nctx, w)
        if tag in PARA:
            w.ensure(2)
        elif tag in LINE or is_body:
            w.ensure(1)
        else:
            pass


def _subtree_text_raw(node) -> str:
    return ''.join(c.data if isinstance(c, Text) else _subtree_text_raw(c) for c in node.children if not isinstance(c, Comment))


def _finish_fragments(raw: list[str]) -> list[str]:
    out: list[str] = []
    for f in raw:
        f = clean_chars(f)['text']
        f = re.sub(r'\s+', ' ', f).strip()
        if len(re.sub(r'\s', '', f)) < 2:
            continue
        f = cut_graphemes(f, HIDDEN_FRAGMENT_MAX_CHARS, '\u2026')
        if f in out:
            continue
        out.append(f)
    if len(out) > HIDDEN_FRAGMENTS_MAX:
        extra = len(out) - HIDDEN_FRAGMENTS_MAX + 1
        out = out[:HIDDEN_FRAGMENTS_MAX - 1] + [f'and {extra} more hidden pieces']
    return out


def _clean_visible(text: str, fragments: list[str]) -> str:
    cc = clean_chars(text)
    for t in cc['tagText']:
        fragments.append('Invisible tag text: ' + t)
    total = cc['invisibleInWords'] + cc['bidi']
    if cc['bidi'] >= 1:
        fragments.append(f'Invisible characters removed: {total} (including text-direction controls)')
    elif cc['invisibleInWords'] >= 2:
        fragments.append(f'Invisible characters removed: {total}')
    out = normalize_ws(cc['text'])
    if len(out) > SANITIZE_MAX_TEXT_CHARS:
        cut = out.rfind('\n', 0, SANITIZE_MAX_TEXT_CHARS)
        out = out[:cut if cut > 0 else SANITIZE_MAX_TEXT_CHARS] + CUT_NOTE
    return out


def sanitize_incoming(html: str | None = None, text: str | None = None) -> tuple[str, list[str]]:
    """11 section 4: returns (text, hiddenRemoved)."""
    if html and html.strip():
        root = parse_html(html[:2_000_000])
        w = _Walker()
        ctx = {'font_px': 16.0, 'color': (0, 0, 0, 1.0), 'bg': (255, 255, 255, 1.0), 'opacity': 1.0,
               'visibility': 'visible', 'pre': False}
        _walk(root, ctx, w)
        w.flush_hidden()
        fragments = list(w.fragments)
        visible = _clean_visible(w._current(), fragments)
        return visible, _finish_fragments(fragments)
    if text is not None:
        fragments: list[str] = []
        visible = _clean_visible(strip_quoted_text(text.replace('\r\n', '\n')), fragments)
        return visible, _finish_fragments(fragments)
    return '', []

# ---------------------------------------------------------------- validators (11 section 5.2)

_A = re.ASCII
EMAIL_RE = re.compile(r'(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])', _A)
EMAIL_OBF_RE = re.compile(r'\b[A-Za-z0-9._%+-]+\s*[\[(]\s*at\s*[\])]\s*[A-Za-z0-9-]+(?:\s*[\[(]\s*dot\s*[\])]\s*[A-Za-z0-9-]+)+', re.I | _A)
# NANP numbers, standing in for libphonenumber-js findPhoneNumbersInText(defaultCountry 'US') + isValid().
PHONE_RE = re.compile(r'(?<![\d+\w])(?:\+?1[-.\s]?)?(?:\(\s*([2-9]\d{2})\s*\)|([2-9]\d{2}))[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})(?![\d\w])', _A)
PHONE_SKIP_RE = re.compile(r'\b(order|invoice|ref|reference|confirmation|tracking|booking|ticket|case|claim|policy|member|id|no\.?|#)\s*[:#]?\s*$', re.I | _A)
PHONE_LABEL_RE = re.compile(r'\b(phone|tel|call|cell|mobile|fax|text|sms|whatsapp|contact)\b', re.I | _A)
PHONE_LOCAL_RE = re.compile(r'(?<!\d)\d{3}[-.\s]\d{4}(?!\d)', _A)
CARD_RE = re.compile(r'(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])', _A)
CARD_LABEL_RE = re.compile(r'\b(card|visa|mastercard|amex|american express|discover|credit|debit|cc)\b', re.I | _A)
IBAN_RE = re.compile(r'\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b', _A)
IBAN_LEN = {'NO': 15, 'BE': 16, 'DK': 18, 'FI': 18, 'NL': 18, 'AT': 20, 'CH': 21, 'DE': 22, 'GB': 22, 'IE': 22,
            'ES': 24, 'SE': 24, 'PT': 25, 'FR': 27, 'IT': 27, 'PL': 28}
SSN_RE = re.compile(r'(?<!\d)(\d{3})([- ])(\d{2})\2(\d{4})(?!\d)', _A)
SSN_BARE_RE = re.compile(r'(?<!\d)\d{9}(?!\d)', _A)
SSN_LABEL_RE = re.compile(r'\b(ssn|social security(?: number| no\.?)?|ss#|itin)\b', re.I | _A)
ACCOUNT_RE = re.compile(r'\b(account|acct|a/c|checking|savings|routing|aba|rtn|sort code|bsb)\b(?:\s+(?:number|no\.?|#|num))?\s*[:#]?\s*(\d[\d -]{4,20}\d)', re.I | _A)
MONTHS_RE = r'(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)'
DOB_RE = re.compile(r'\b(DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?)\b\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}|' + MONTHS_RE + r'\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+' + MONTHS_RE + r'\s+\d{4})', re.I | _A)
STREET_TYPES = r'(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Square|Sq|Trail|Trl)'
ADDRESS_RE = re.compile(r"\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z'\u2019.-]*\s+){1,4}" + STREET_TYPES + r"\.?(?:\s*,?\s*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[\w-]{1,6})?(?![A-Za-z])")
POBOX_RE = re.compile(r'\bP\.?\s?O\.?\s+Box\s+\d{1,6}\b', re.I)
NAME_WORD = r"[A-Z][A-Za-z'\u2019-]+"
GREETING_RE = re.compile(r'^\s*(?i:Hi|Hello|Hey|Dear|Good (?:morning|afternoon|evening))[ ,]+(?:(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+)?(' + NAME_WORD + r'(?:\s+' + NAME_WORD + r'){0,2})\s*[,!:]')
GREETING_EXCLUDE = {'All', 'Team', 'There', 'Everyone', 'Folks', 'Friends', 'Sir', 'Madam', 'Customer', 'Member',
                    'User', 'Neighbor', 'Neighbour', 'Tenant', 'Resident', 'Valued', 'Colleagues', 'Support'}
SIGNOFFS = ['best', 'thanks', 'thank you', 'regards', 'kind regards', 'best regards', 'warm regards', 'cheers',
            'sincerely', 'yours', 'love', 'take care']
SIGNOFF_NAME_RE = re.compile(r'^' + NAME_WORD + r'(\s+' + NAME_WORD + r'){0,2}$')
ORG_WORDS = {'Management', 'Inc', 'LLC', 'Ltd', 'Team', 'Services', 'Bank', 'Group', 'Support', 'Office',
             'Department', 'Company', 'Property', 'Health', 'Clinic', 'Store', 'Desk', 'Bot'}
TITLE_RE = re.compile(r'\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.?\s+(' + NAME_WORD + r'(?:\s+' + NAME_WORD + r')?)')
IP_RE = re.compile(r'\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b', _A)

PII_STOPWORDS = set('a an and or but if then so to of in on at by for with from as is are was were be been it this that these those you your we our they their he she him her i me my hi hello dear thanks thank best regards please will may can could would should must shall team all everyone there here today tomorrow yesterday mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday'.split())
MONTH_NAMES = set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep oct nov dec'.split())
TYPE_RANK = ['card', 'iban', 'ssn', 'account', 'email', 'phone', 'dob', 'address', 'name', 'other']
BY_RANK = ['validator', 'model', 'nano']


def luhn(d: str) -> bool:
    total, alt = 0, False
    for ch in reversed(d):
        x = int(ch)
        if alt:
            x *= 2
            if x > 9:
                x -= 9
        total += x
        alt = not alt
    return total % 10 == 0


def card_brand_ok(d: str) -> bool:
    n = len(d)
    p = lambda k: int(d[:k])
    if d[0] == '4' and n in (13, 16, 19):
        return True
    if n == 16 and (51 <= p(2) <= 55 or 2221 <= p(4) <= 2720):
        return True
    if n == 15 and p(2) in (34, 37):
        return True
    if 16 <= n <= 19 and (p(4) == 6011 or 644 <= p(3) <= 649 or p(2) == 65 or 3528 <= p(4) <= 3589 or p(2) == 62):
        return True
    if 14 <= n <= 19 and (300 <= p(3) <= 305 or p(2) in (36, 38, 39)):
        return True
    return False


def iban_ok(s: str) -> bool:
    if len(s) < 15 or len(s) > 34:
        return False
    cc = s[:2]
    if cc in IBAN_LEN and IBAN_LEN[cc] != len(s):
        return False
    r = s[4:] + s[:4]
    m = 0
    for ch in r:
        val = str(int(ch, 36)) if ch.isalpha() else ch
        for d in val:
            m = (m * 10 + int(d)) % 97
    return m == 1


def ssn_ok(area: str, group: str, serial: str) -> bool:
    a = int(area)
    return a != 0 and a != 666 and not (900 <= a <= 999) and group != '00' and serial != '0000'


def aba_ok(d: str) -> bool:
    if len(d) != 9:
        return False
    x = [int(c) for c in d]
    if (3 * (x[0] + x[3] + x[6]) + 7 * (x[1] + x[4] + x[7]) + (x[2] + x[5] + x[8])) % 10:
        return False
    first = int(d[:2])
    return 0 <= first <= 12 or 21 <= first <= 32 or 61 <= first <= 72 or first == 80


def _span(s: str, start: int, end: int, typ: str) -> dict:
    return {'start': u16_index(s, start), 'end': u16_index(s, end), 'type': typ, 'by': 'validator', 'score': 1,
            '_cp': (start, end)}


def _signoff_names(text: str) -> list[tuple[int, int]]:
    found = []
    lines = text.split('\n')
    offsets, pos = [], 0
    for line in lines:
        offsets.append(pos)
        pos += len(line) + 1

    def is_signoff(t: str) -> bool:
        return re.sub(r'[\s.,!:;]+$', '', t.strip().lower()) in SIGNOFFS

    def starts_signoff(t: str):
        low = t.strip().lower()
        for so in sorted(SIGNOFFS, key=len, reverse=True):
            if low.startswith(so + ','):
                return so
        return None

    def ok_name(cand: str) -> bool:
        return bool(SIGNOFF_NAME_RE.match(cand)) and not any(w in ORG_WORDS for w in cand.split())

    for i, line in enumerate(lines):
        if is_signoff(line):
            for j in range(i + 1, len(lines)):
                if lines[j].strip():
                    cand = lines[j].strip()
                    if ok_name(cand):
                        st = offsets[j] + lines[j].index(cand)
                        found.append((st, st + len(cand)))
                    break
            continue
        # a sentence inside the line that is, or starts with, a sign-off
        for m in re.finditer(r'(?:^|(?<=[.!?] ))([^.!?]*[.!?]?)', line):
            sent = m.group(1)
            if not sent.strip():
                continue
            so = starts_signoff(sent)
            if so:
                rest_start = sent.lower().index(so + ',') + len(so) + 1
                seg = sent[rest_start:].split(',')[0]
                cand = re.sub(r'[\s.!?]+$', '', seg.strip())
                if cand and ok_name(cand):
                    st = offsets[i] + m.start(1) + rest_start + seg.index(cand)
                    found.append((st, st + len(cand)))
    return found


def run_validators(text: str) -> list[dict]:
    spans: list[dict] = []
    for m in EMAIL_RE.finditer(text):
        spans.append(_span(text, m.start(), m.end(), 'email'))
    for m in EMAIL_OBF_RE.finditer(text):
        spans.append(_span(text, m.start(), m.end(), 'email'))
    for m in PHONE_RE.finditer(text):
        area = m.group(1) or m.group(2)
        exch = m.group(3)
        if area[1:] == '11' or exch[1:] == '11':
            continue
        before24 = text[max(0, m.start() - 24):m.start()]
        before40 = text[max(0, m.start() - 40):m.start()]
        if PHONE_SKIP_RE.search(before24) and not PHONE_LABEL_RE.search(before40):
            continue
        spans.append(_span(text, m.start(), m.end(), 'phone'))
    for m in PHONE_LOCAL_RE.finditer(text):
        if PHONE_LABEL_RE.search(text[max(0, m.start() - 30):m.start()]):
            spans.append(_span(text, m.start(), m.end(), 'phone'))
    for m in CARD_RE.finditer(text):
        d = re.sub(r'\D', '', m.group(0))
        if not (13 <= len(d) <= 19) or len(set(d)) == 1 or not luhn(d):
            continue
        if card_brand_ok(d) or CARD_LABEL_RE.search(text[max(0, m.start() - 30):m.start()]):
            spans.append(_span(text, m.start(), m.end(), 'card'))
    for m in IBAN_RE.finditer(text):
        raw = m.group(0)
        compact = raw.replace(' ', '')
        for L in range(len(compact), 14, -1):
            if iban_ok(compact[:L]):
                # map compact length back to the raw span
                count, end = 0, m.start()
                for k, ch in enumerate(raw):
                    if ch != ' ':
                        count += 1
                    if count == L:
                        end = m.start() + k + 1
                        break
                spans.append(_span(text, m.start(), end, 'iban'))
                break
    for m in SSN_RE.finditer(text):
        if ssn_ok(m.group(1), m.group(3), m.group(4)):
            spans.append(_span(text, m.start(), m.end(), 'ssn'))
    for m in SSN_BARE_RE.finditer(text):
        d = m.group(0)
        if SSN_LABEL_RE.search(text[max(0, m.start() - 25):m.start()]) and ssn_ok(d[:3], d[3:5], d[5:]):
            spans.append(_span(text, m.start(), m.end(), 'ssn'))
    for m in ACCOUNT_RE.finditer(text):
        label = m.group(1).lower()
        digits = re.sub(r'\D', '', m.group(2))
        between = text[m.end(1):m.start(2)].lower()
        if any(x in between for x in ('ending', 'ends in', 'last 4', 'last four')):
            continue
        if label in ('routing', 'aba', 'rtn'):
            if not aba_ok(digits):
                continue
        elif not (6 <= len(digits) <= 17):
            continue
        spans.append(_span(text, m.start(2), m.end(2), 'account'))
    for m in DOB_RE.finditer(text):
        spans.append(_span(text, m.start(2), m.end(2), 'dob'))
    for m in ADDRESS_RE.finditer(text):
        spans.append(_span(text, m.start(), m.end(), 'address'))
    for m in POBOX_RE.finditer(text):
        spans.append(_span(text, m.start(), m.end(), 'address'))
    pos = 0
    for line in text.split('\n'):
        m = GREETING_RE.match(line)
        if m and m.group(1).split()[0] not in GREETING_EXCLUDE and m.group(1) not in GREETING_EXCLUDE:
            spans.append(_span(text, pos + m.start(1), pos + m.end(1), 'name'))
        pos += len(line) + 1
    for st, en in _signoff_names(text):
        spans.append(_span(text, st, en, 'name'))
    for m in TITLE_RE.finditer(text):
        spans.append(_span(text, m.start(1), m.end(1), 'name'))
    for m in IP_RE.finditer(text):
        spans.append(_span(text, m.start(), m.end(), 'other'))
    return filter_spans(text, spans)


def filter_spans(text: str, spans: list[dict]) -> list[dict]:
    """11 section 5.6 step 1 (the protected-value filter applies to model and Nano spans only)."""
    out = []
    for s in spans:
        a, b = s['_cp']
        if b <= a or a < 0 or b > len(text):
            continue
        if s['type'] == 'name':
            t = text[a:b]
            if t.lower() in PII_STOPWORDS or len(t) <= 2:
                continue
            if t.lower() in MONTH_NAMES and re.search(r'\d', text[max(0, a - 2):a] + text[b:b + 2]):
                continue
        out.append(s)
    return out


def merge_spans(spans: list[dict]) -> list[dict]:
    """11 section 5.6 step 2: union of overlapping spans, highest type and `by`."""
    items = sorted(spans, key=lambda s: (s['_cp'][0], -(s['_cp'][1] - s['_cp'][0])))
    merged: list[dict] = []
    for s in items:
        if merged and s['_cp'][0] < merged[-1]['_cp'][1]:
            m = merged[-1]
            a, b = m['_cp'][0], max(m['_cp'][1], s['_cp'][1])
            m['_cp'] = (a, b)
            m['type'] = min(m['type'], s['type'], key=TYPE_RANK.index)
            m['by'] = min(m['by'], s['by'], key=BY_RANK.index)
            scores = [x for x in (m.get('score'), s.get('score')) if x is not None]
            if scores:
                m['score'] = max(scores)
        else:
            merged.append(dict(s))
    return merged


def finalize_spans(text: str, spans: list[dict]) -> list[dict]:
    out = []
    for s in spans:
        a, b = s['_cp']
        out.append({'start': u16_index(text, a), 'end': u16_index(text, b), 'type': s['type'], 'by': s['by'], 'score': s['score']})
    return out


def propagate(text: str, spans: list[dict]) -> list[dict]:
    """11 section 5.6 step 3, used for header entities."""
    out = list(spans)
    for s in spans:
        if s['type'] not in ('name', 'address', 'other'):
            continue
        a, b = s['_cp']
        value = text[a:b]
        words = [value]
        if s['type'] == 'name' and len(value.split()) >= 2:
            words += [w for w in value.split() if len(w) >= 3 and w[0].isupper() and w.lower() not in PII_STOPWORDS
                      and w not in ('Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof')]
        for wv in words:
            flags = re.I if wv == value else 0
            for m in re.finditer(r'(?<![^\W_])' + re.escape(wv) + r'(?![^\W_])', text, flags):
                if s['type'] == 'name' and not text[m.start()].isupper():
                    continue
                out.append({**s, '_cp': (m.start(), m.end())})
    return out


def detect_header_entities(header: str) -> list[dict]:
    spans = run_validators(header)
    spans = merge_spans(propagate(header, merge_spans(spans)))
    seen, out = set(), []
    for s in spans:
        a, b = s['_cp']
        key = (header[a:b], s['type'])
        if key in seen:
            continue
        seen.add(key)
        out.append({'text': header[a:b], 'type': s['type'], 'by': s['by'], 'score': s['score']})
    return out

# ---------------------------------------------------------------- injection (11 sections 4.7 and 8.1)

CONFUSABLES = str.maketrans({'\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y',
                             '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd',
                             '\u03bf': 'o', '\u03b1': 'a', '\u03b5': 'e', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v',
                             '\u03c1': 'p', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
                             '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"'})
LEET = str.maketrans({'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '$': 's'})


def fold_for_match(s: str) -> str:
    s = clean_chars(s)['text']
    s = unicodedata.normalize('NFKC', s).lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.category(c).startswith('M'))
    s = s.translate(CONFUSABLES)
    s = re.sub(r'\S+', lambda m: m.group(0).translate(LEET) if re.search(r'[^\W\d_]', m.group(0)) else m.group(0), s)
    s = re.sub(r'\b(?:[^\W\d_][ .\-_*]){3,}[^\W\d_]\b', lambda m: re.sub(r'[ .\-_*]', '', m.group(0)), s)
    return re.sub(r'\s+', ' ', s)


# 11 section 8.1 lists one more assistant product name in AI; no seed text contains it, and the
# real check in web/src/privacy/ uses the full list.
AI = r'(?:ai|a\.i\.|llms?|language models?|ai assistants?|ai agents?|chatbots?|chat bots?|ai systems?|automated systems?|gpt|chatgpt|gemini|copilot)'
AI_OR_ASSISTANT = r'(?:' + AI + r'|assistants?|bots?)'
PATTERNS = [
    ('override', 2, r'\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|every)\s+(?:of\s+)?)?(?:(?:your|all)\s+(?:(?:previous|prior|earlier|above|preceding|original|initial|system|current|existing|safety)\s+)?|(?:(?:the|these|those)\s+)?(?:previous|prior|earlier|above|preceding|original|initial|system|safety)\s+)(?:instructions?|prompts?|directions|rules|guidelines|programming|guardrails)\b'),
    ('ai-colon', 2, r'(?:^|[\s"\'(\[])' + AI + r'\s*:'),
    ('ai-vocative', 2, r'\b(?:dear|hey|hi|hello|attention|attn)[,:]?\s+' + AI + r'\b'),
    ('note-to-ai', 2, r'\b(?:note|message|instructions?|reminder|request|notice|memo)\s+(?:to|for)\s+(?:(?:any|all|every)\s+' + AI_OR_ASSISTANT + r'|(?:the\s+)?' + AI + r')\b'),
    ('if-you-are-ai', 2, r"\bif\s+(?:you\s+are|you're|youre|you\s+were)\s+(?:an?\s+)?(?:" + AI + r'|assistant)\b'),
    ('if-ai-reading', 2, r'\b(?:if|when|while)\s+(?:an?|any|the|some)\s+' + AI_OR_ASSISTANT + r'\s+(?:is\s+|are\s+)?(?:reading|reads|summari[sz]ing|summari[sz]es|processing|processes|parsing|parses|analy[sz]ing|analy[sz]es|scanning|scans)\b'),
    ('ai-reading-this', 2, r'\b(?:any|an|the)\s+' + AI_OR_ASSISTANT + r'\s+(?:reading|summari[sz]ing|processing|parsing|analy[sz]ing|scanning)\s+(?:this|these|the)\b'),
    ('system-token', 2, r'(?:system prompt|developer (?:message|mode)|<\|?(?:im_start|im_end|system|endoftext)\|?>|\[(?:system|inst|/inst)\]|###\s*(?:system|instruction)|begin (?:system|admin|developer) (?:message|prompt|override|instructions)|jailbreak|\bdan mode\b|new (?:system )?instructions\s*:)'),
    ('conceal', 2, r"\b(?:do not|don't|dont|never|without)\s+(?:mention(?:ing)?|tell(?:ing)?|reveal(?:ing)?|show(?:ing)?|disclos(?:e|ing)|inform(?:ing)?|alert(?:ing)?|referenc(?:e|ing))\s+(?:this sentence|this instruction|these instructions|this note|this request|this part|the user|the reader|the human|the person|the recipient)\b"),
    ('tell-the-user', 2, r'\b(?:tell|ask|instruct|convince|persuade|urge|remind|get)\s+(?:the user|the reader|the human|the person|the recipient)\s+(?:to|that)\b'),
    ('approve-all', 2, r'\b(?:approve|accept|allow|authori[sz]e)\s+(?:all|every|any|each)\s+(?:of\s+)?(?:the\s+)?(?:pending\s+|open\s+|waiting\s+)?(?:requests?|shares?|permissions?|access|actions?)\b|\bauto-?approve\b'),
    ('exfiltrate', 1, r'\b(?:forward|send|email|e-mail|share|upload|post|transmit|exfiltrate|copy|leak|export)\b[^.!?\n]{0,60}\b(?:bank statements?|statements?|passwords?|credentials?|logins?|api keys?|tokens?|secrets?|ssn|social security(?: numbers?)?|card numbers?|account numbers?|inbox|emails|messages|contacts|files|documents|addresses|photos|records|data|history|codes?)\b[^.!?\n]{0,40}\b(?:to|at|into)\s+(?:\S+@\S+|https?://\S+|www\.\S+|this (?:address|email|link|url))'),
    ('user-data', 1, r"\b(?:include|add|insert|append|reveal|list|give|provide|output|print|tell (?:me|us))\b[^.!?\n]{0,30}\b(?:the user'?s?|the person'?s?|the recipient'?s?)\s+(?:home\s+|full\s+|current\s+)?(?:address|phone(?: number)?|email|password|ssn|social security|date of birth|birthday|card|account|location|contacts|statements?)\b"),
    ('your-reply', 1, r'\b(?:in|to|into)\s+your\s+(?:reply|response|summary|answer|output)\b'),
]
PATTERNS = [(pid, w, re.compile(rx)) for pid, w, rx in PATTERNS]


def sentences_with_offsets(text: str) -> list[tuple[int, int]]:
    """Approximates Intl.Segmenter('en', { granularity: 'sentence' }) plus a split on newlines."""
    out = []
    pos = 0
    for line in text.split('\n'):
        start = 0
        for m in re.finditer(r'[.!?]+["\')\]]*\s+(?=\S)', line):
            out.append((pos + start, pos + m.end()))
            start = m.end()
        if line[start:].strip():
            out.append((pos + start, pos + len(line)))
        pos += len(line) + 1
    return out


def match_injection_patterns(text: str) -> dict:
    best = {'score': 0, 'suspicious': False, 'matches': [], 'quote': None}
    all_matches = []
    for a, b in sentences_with_offsets(text):
        sent = text[a:b]
        folded = fold_for_match(sent)
        ids = {}
        for pid, weight, rx in PATTERNS:
            if rx.search(folded):
                ids[pid] = weight
                all_matches.append({'id': pid, 'weight': weight, 'sentence': sent.strip(), 'start': a, 'end': b})
        score = sum(ids.values())
        if score > best['score']:
            best['score'] = score
            best['quote'] = cut_graphemes(sent.strip(), 200)
    best['matches'] = all_matches
    best['suspicious'] = best['score'] >= 2
    if not best['suspicious']:
        best['quote'] = None
    return best


def check_injection_code(text: str, extra: list[str]) -> dict:
    """11 section 8.2 with the Nano step not available: the finding from code."""
    if not text and not extra:
        return {'suspicious': False, 'by': 'code'}
    reports = [match_injection_patterns(text)] + [match_injection_patterns(x) for x in extra]
    top = max(reports, key=lambda r: r['score'])
    if top['suspicious']:
        return {'suspicious': True, 'quote': top['quote'], 'by': 'code'}
    return {'suspicious': False, 'by': 'code'}

# ---------------------------------------------------------------- cyrb53 (11 section 6.2)

_M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return ((a & _M32) * (b & _M32)) & _M32


def cyrb53(s: str, seed: int = 0) -> int:
    h1 = (0xdeadbeef ^ seed) & _M32
    h2 = (0x41c6ce57 ^ seed) & _M32
    units = s.encode('utf-16-le', 'surrogatepass')
    for i in range(0, len(units), 2):
        ch = units[i] | (units[i + 1] << 8)
        h1 = _imul(h1 ^ ch, 2654435761)
        h2 = _imul(h2 ^ ch, 1597334677)
    h1 = _imul(h1 ^ (h1 >> 16), 2246822507)
    h1 ^= _imul(h2 ^ (h2 >> 13), 3266489909)
    h2 = _imul(h2 ^ (h2 >> 16), 2246822507)
    h2 ^= _imul(h1 ^ (h1 >> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 & _M32)


def base36(n: int) -> str:
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if n == 0:
        return '0'
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return ''.join(reversed(out))


def text_hash(scan_text: str, hidden: list[str]) -> str:
    return base36(cyrb53(scan_text + '\u0000' + '\u0001'.join(hidden)))

# ---------------------------------------------------------------- preview (20 section 12.2)

def build_preview(kind: str, text: str | None, caption: str | None = None, date_label: str | None = None,
                  max_chars: int = 280) -> str:
    s = text or ''
    if kind == 'email' and s:
        kept = []
        for line in s.split('\n'):
            if re.match(r'^On .*wrote:\s*$', line) or re.match(r'^-{2,}\s*Original Message\s*-{2,}', line, re.I):
                break
            if line in ('-- ', '--'):
                break
            if line.lstrip().startswith('>'):
                continue
            kept.append(line)
        s = '\n'.join(kept)
    if kind == 'photo':
        s = caption or ''
    s = re.sub(r'\s+', ' ', s).strip()
    if not s:
        if kind == 'email':
            return '(No text)'
        if kind == 'photo':
            return f'Photo from {date_label}' if date_label else '(No text found)'
        return '(No text found)'
    if u16len(s) <= max_chars:
        return s
    cut = cut_graphemes(s, max_chars - 1)
    ws = max(cut.rfind(' '), cut.rfind('\n'))
    if ws > 0 and u16len(cut) - u16len(cut[:ws]) <= 40:
        cut = cut[:ws]
    return cut + '\u2026'

# ---------------------------------------------------------------- mentionedDays (20 section 9.3)

MONTH_NUM = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9,
             'oct': 10, 'nov': 11, 'dec': 12}
_MONTH_WORD = r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
WORD_DATE_RE = re.compile(_MONTH_WORD + r'\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?'
                          r'(?:\s*(?:to|through|until|-)\s*(?:' + _MONTH_WORD + r'\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?)?')
DAY_FIRST_RE = re.compile(r'\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?' + _MONTH_WORD + r'\b(?:,?\s+(\d{4}))?')
ISO_RE = re.compile(r'\b(\d{4})([-/.])(\d{1,2})\2(\d{1,2})\b')
THREE_RE = re.compile(r'\b(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})\b')
TWO_RE = re.compile(r'(?<![$\d])\b(\d{1,2})/(\d{1,2})\b(?!/\d)(?!%)')


def _valid(y: int, m: int, d: int) -> bool:
    import datetime as dt
    try:
        dt.date(y, m, d)
        return True
    except ValueError:
        return False


def _nearest_year(m: int, d: int, item_day) -> int | None:
    import datetime as dt
    best = None
    for y in (item_day.year - 1, item_day.year, item_day.year + 1):
        if not _valid(y, m, d):
            continue
        diff = abs((dt.date(y, m, d) - item_day).days)
        if diff <= 183 and (best is None or diff < best[0]):
            best = (diff, y)
    return best[1] if best else None


def mentioned_days(text: str, item_day) -> list[str]:
    """Steps 1 (numeric) and 4 (word-month dates) of 20 section 9.3, en-US, ambiguous numeric dates
    skipped, implied years nearest the item's own date within 183 days. Weekday-only and
    time-only phrases are not dates here (no day of a month is stated)."""
    s = text[:20_000]
    found: list[tuple[int, str]] = []

    def add(pos, y, m, d):
        if y and _valid(y, m, d):
            found.append((pos, f'{y:04d}-{m:02d}-{d:02d}'))

    blank = list(s)

    def blank_span(a, b):
        for k in range(a, b):
            blank[k] = ' '

    for m in ISO_RE.finditer(s):
        add(m.start(), int(m.group(1)), int(m.group(3)), int(m.group(4)))
        blank_span(m.start(), m.end())
    s1 = ''.join(blank)
    for m in THREE_RE.finditer(s1):
        a, b, y = int(m.group(1)), int(m.group(3)), int(m.group(4))
        y = y + 2000 if y < 100 else y
        if a <= 12 and b <= 12 and a != b:
            continue
        mm, dd = (a, b) if _valid(y, a, b) else (b, a)
        add(m.start(), y, mm, dd)
        blank_span(m.start(), m.end())
    s1 = ''.join(blank)
    for m in TWO_RE.finditer(s1):
        a, b = int(m.group(1)), int(m.group(2))
        if a <= 12 and b <= 12 and a != b:
            continue
        mm, dd = (a, b) if a <= 12 else (b, a)
        y = _nearest_year(mm, dd, item_day)
        add(m.start(), y, mm, dd)
        blank_span(m.start(), m.end())
    s1 = ''.join(blank)
    for m in WORD_DATE_RE.finditer(s1):
        mon = MONTH_NUM[m.group(1).lower()[:3]]
        day = int(m.group(2))
        year = int(m.group(3)) if m.group(3) else None
        end_mon = m.group(4)
        end_day = int(m.group(5)) if m.group(5) else None
        end_year = int(m.group(6)) if m.group(6) else None
        add(m.start(), year if year else _nearest_year(mon, day, item_day), mon, day)
        if end_day is not None:
            emon = MONTH_NUM[end_mon.lower()[:3]] if end_mon else mon
            ey = end_year if end_year else (_nearest_year(emon, end_day, item_day))
            add(m.start() + 1, ey, emon, end_day)
        blank_span(m.start(), m.end())
    s1 = ''.join(blank)
    for m in DAY_FIRST_RE.finditer(s1):
        mon = MONTH_NUM[m.group(2).lower()[:3]]
        day = int(m.group(1))
        year = int(m.group(3)) if m.group(3) else _nearest_year(mon, day, item_day)
        add(m.start(), year, mon, day)
    found.sort(key=lambda x: x[0])
    out: list[str] = []
    for _, d in found:
        if d not in out:
            out.append(d)
    return out[:30]

# ---------------------------------------------------------------- chat exports (20 section 16.6)

def chat_to_text(obj) -> tuple[str, str] | None:
    if not isinstance(obj, dict) or not isinstance(obj.get('messages'), list):
        return None
    msgs = obj['messages']

    def msg_text(m):
        t = m.get('text')
        if isinstance(t, str):
            return t
        if isinstance(t, list):
            return ''.join(x if isinstance(x, str) else str(x.get('text', '')) for x in t)
        return None

    if not any(msg_text(m) is not None and any(k in m for k in ('from', 'author', 'sender')) for m in msgs if isinstance(m, dict)):
        return None
    name = obj.get('name') or obj.get('chat') or obj.get('title') or 'chat'
    title = f'Chat with {name}'
    lines = [title]
    for m in msgs:
        if not isinstance(m, dict):
            continue
        if 'type' in m and m['type'] != 'message':
            continue
        t = msg_text(m)
        if t is None:
            continue
        who = m.get('from') or m.get('author') or m.get('sender') or ''
        d = str(m.get('date', ''))
        mm = re.match(r'(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})', d)
        stamp = f'[{mm.group(1)} {mm.group(2)}] ' if mm else ''
        lines.append(f'{stamp}{who}: {t}')
    return title, '\n'.join(lines)

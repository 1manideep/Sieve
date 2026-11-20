// A stand-in for web/src/privacy (11) in index and source tests. sanitizeIncoming here is a small version of 11's
// rules (the HTML part wins; display:none, white on white and 1px text are hidden; quoted replies stay), enough
// to test that ingest stores what the sanitizer returns. The scan functions are controllable.
// Use: vi.mock('@/privacy', async () => (await import('<path>/tests/harness/privacyMock')).privacyModule)
import type { CategoryRule, IndexRecord, InjectionFinding, PiiSpan, PrivacyScanStamp } from '@sieve/shared';

function isHidden(style: string): boolean {
  const s = style.toLowerCase().replace(/\s+/g, '');
  if (/display:none/.test(s) || /visibility:hidden/.test(s)) return true;
  if (/font-size:[01](\.\d+)?px/.test(s)) return true;
  const color = /(?:^|;)color:(#fff(?:fff)?|white)/.exec(s);
  const bg = /background(?:-color)?:(#fff(?:fff)?|white)/.exec(s);
  return !!color && !!bg;
}

export function sanitizeIncoming(raw: { html?: string; text?: string }): { text: string; hiddenRemoved: string[] } {
  if (raw.html && raw.html.trim()) {
    const doc = new DOMParser().parseFromString(`<body>${raw.html}</body>`, 'text/html');
    const hidden: string[] = [];
    const visible: string[] = [];
    const walk = (el: Element, hiddenAncestor: boolean) => {
      const h = hiddenAncestor || isHidden(el.getAttribute('style') ?? '');
      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'style' || tag === 'script') return;
      let own = '';
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3) own += n.textContent ?? '';
        else if (n.nodeType === 1) {
          if (own.trim()) (h ? hidden : visible).push(own.replace(/\s+/g, ' ').trim());
          own = '';
          walk(n as Element, h);
        }
      }
      if (own.trim()) (h ? hidden : visible).push(own.replace(/\s+/g, ' ').trim());
    };
    walk(doc.body, false);
    return { text: visible.join('\n'), hiddenRemoved: hidden };
  }
  const text = (raw.text ?? '').replace(/\r\n/g, '\n').replace(/[\u200b\u2060]/g, '').trim();
  return { text, hiddenRemoved: [] };
}

export interface ScanPatchLike { pii: PiiSpan[]; injection: InjectionFinding; privacyScan: PrivacyScanStamp }
export const privacyControl = {
  scans: [] as { id: string; version: number; rule: CategoryRule }[],
  /** Promise that scanRecord waits on before returning (race tests). */
  gate: null as Promise<void> | null,
  enabled: true,
  reset() {
    this.scans = [];
    this.gate = null;
    this.enabled = true;
  },
};

function stamp(rec: IndexRecord): PrivacyScanStamp {
  return { textHash: `h:${rec.version}:${(rec.text ?? rec.caption ?? '').length}`, pii: { validators: { version: 'validators@1', ran: 'code', ms: 0, at: 0 } }, injection: { code: { version: 'patterns@1', ran: 'code', ms: 0, at: 0 } }, headerEntities: [] };
}

export const privacyModule = {
  sanitizeIncoming,
  async expectedStages(_rec: IndexRecord, _data: string, rule: CategoryRule) {
    return { pii: rule === 'never' ? ['validators'] : ['validators', 'model'], injection: ['code'] };
  },
  isScanCurrent(rec: IndexRecord) {
    return !!rec.privacyScan && rec.privacyScan.textHash === stamp(rec).textHash;
  },
  async scanRecord(rec: IndexRecord, _data: string, opts: { rule: CategoryRule; signal?: AbortSignal }): Promise<{ patch: ScanPatchLike; trace: [] }> {
    privacyControl.scans.push({ id: rec.id, version: rec.version, rule: opts.rule });
    if (privacyControl.gate) await privacyControl.gate;
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(rec.text ?? '');
    const pii: PiiSpan[] = email ? [{ start: email.index, end: email.index + email[0].length, type: 'email', by: 'validator', score: 1 }] : [];
    return { patch: { pii, injection: { suspicious: false, by: 'code' }, privacyScan: stamp(rec) }, trace: [] };
  },
};

/** The same module without 11's scan functions (the privacy package not landed yet). */
export const privacyModuleWithoutScan = { sanitizeIncoming };

import { describe, expect, it } from 'vitest';
import { LADDER_LABELS } from '@sieve/shared';
import {
  COPY,
  formatDate,
  itemMeta,
  outcomeCopy,
  outgoingMeta,
  rejectionCopy,
  resultCopy,
  sentHeading,
  stepLabel,
} from '../src/shared/labels';
import { cut, notificationMessage } from '../src/sw/notify';

const NOV_18_2026 = Date.UTC(2026, 10, 18, 12);

describe('labels', () => {
  it('formats dates like the mockup, adding the year only when it differs', () => {
    expect(formatDate(Date.UTC(2026, 2, 3, 12), NOV_18_2026)).toBe('Mar 3');
    expect(formatDate(Date.UTC(2025, 2, 3, 12), NOV_18_2026)).toBe('Mar 3, 2025');
    expect(itemMeta({ date: Date.UTC(2026, 9, 29, 15), category: 'Home' }, NOV_18_2026)).toBe('Oct 29 · Home · found on this device');
  });

  it('writes the outgoing meta line', () => {
    expect(outgoingMeta(41, 0)).toBe('41 characters');
    expect(outgoingMeta(1234, 2)).toBe('1,234 characters · 2 redacted');
  });

  it('writes the "Sent N characters to X" heading with a grouped count', () => {
    expect(sentHeading(41, 'Gemini CLI')).toBe('Sent 41 characters to Gemini CLI');
    expect(sentHeading(1234, 'Planner')).toBe('Sent 1,234 characters to Planner');
    expect(COPY.openReceipt).toBe('Open the receipt');
  });

  it('uses the shared ladder labels', () => {
    expect(stepLabel('answer')).toBe(LADDER_LABELS.answer);
    expect(['answer', 'excerpt', 'full'].map((s) => stepLabel(s as 'answer'))).toEqual(['Answer only', 'Excerpt', 'Full item']);
  });

  it('never uses an em dash or a double dash in panel copy', () => {
    const strings: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(COPY);
    for (const o of ['blocked-never', 'no-match', 'needs-cloud-consent', 'model-unavailable', 'error'] as const) collect(outcomeCopy(o, 'Money'));
    for (const outcome of ['approved', 'declined', 'expired', 'error', 'lost'] as const) {
      collect(resultCopy({ outcome, decidedHere: true, step: 'full' }));
      collect(resultCopy({ outcome, decidedHere: false }));
    }
    for (const r of ['step-unavailable', 'unknown-request', 'not-ready', 'no-owner', 'changed'] as const) collect(rejectionCopy(r));
    collect(sentHeading(1234, 'Test assistant'));
    collect(notificationMessage('Test assistant'));
    expect(strings.length).toBeGreaterThan(40);
    expect(strings).toContain(COPY.settings.openOnArrival);
    for (const s of strings) {
      expect(s).not.toMatch(/—/);
      expect(s).not.toMatch(/--/);
    }
  });

  it('cuts names without splitting a surrogate pair', () => {
    expect(cut('abc', 40)).toBe('abc');
    const name = `${'a'.repeat(39)}\u{1F600}tail`;
    expect(cut(name, 40)).toBe('a'.repeat(39));
    expect(notificationMessage('x'.repeat(50))).toBe(`${'x'.repeat(40)} is asking for something. Review it in Sieve.`);
  });
});

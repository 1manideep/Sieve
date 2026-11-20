import { describe, expect, it } from 'vitest';
import type { ReceiptView } from './types';
import { DEFAULT_RECEIPT_FILTERS, filterReceipts } from './receipts';

const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime();
const DAY = 86_400_000;

function r(id: string, over: Partial<ReceiptView>): ReceiptView {
  return {
    id,
    requestId: id,
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
    question: 'q',
    itemIds: ['gmail:m1'],
    status: 'delivered',
    chars: 10,
    createdAt: NOW - 1000,
    ...over,
  };
}

const list: ReceiptView[] = [
  r('a', {}),
  r('b', { requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, itemIds: ['folder:taxes/W-2.pdf'], createdAt: NOW - 2 * DAY }),
  r('c', { requester: { kind: 'outside', grantId: 'g2', aiName: 'ChatGPT' }, itemIds: ['upload:upload-1', 'gmail:m2'], createdAt: NOW - 10 * DAY }),
  r('d', { itemIds: ['0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'], createdAt: NOW - 40 * DAY }),
];

const ids = (x: ReceiptView[]) => x.map((v) => v.id);

describe('filterReceipts', () => {
  it('passes everything with the default filters', () => {
    expect(ids(filterReceipts(list, DEFAULT_RECEIPT_FILTERS, NOW))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by AI name', () => {
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, ai: 'ChatGPT' }, NOW))).toEqual(['c']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, ai: 'Gemini (in Sieve)' }, NOW))).toEqual(['b']);
  });

  it('filters by the source prefix of any item id (a ref without a prefix never matches)', () => {
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, source: 'gmail' }, NOW))).toEqual(['a', 'c']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, source: 'folder' }, NOW))).toEqual(['b']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, source: 'upload' }, NOW))).toEqual(['c']);
  });

  it('filters by each date range', () => {
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, range: 'today' }, NOW))).toEqual(['a']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, range: '7d' }, NOW))).toEqual(['a', 'b']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, range: '30d' }, NOW))).toEqual(['a', 'b', 'c']);
    expect(ids(filterReceipts(list, { ...DEFAULT_RECEIPT_FILTERS, range: 'any' }, NOW))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('today starts at local midnight', () => {
    const midnight = new Date(2026, 10, 18, 0, 0, 0).getTime();
    const edge = [r('x', { createdAt: midnight }), r('y', { createdAt: midnight - 1 })];
    expect(ids(filterReceipts(edge, { ...DEFAULT_RECEIPT_FILTERS, range: 'today' }, NOW))).toEqual(['x']);
  });

  it('combines filters', () => {
    expect(ids(filterReceipts(list, { ai: 'Gemini CLI', source: 'gmail', range: '7d' }, NOW))).toEqual(['a']);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { Category } from '@sieve/shared';
import { setLanguageModelForTests } from '../device/languageModel';
import { setHybridForTests } from '../hybrid';
import { LABEL_SCHEMA, LABEL_SYSTEM } from '../prompts';
import { codeLabel, isHealthStrong, labelBatch, labelPrompt, type LabelItem } from '../tasks/label';
import { createFakeHybrid, promptText } from '../testing/fakeHybrid';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';
import { RECORDS, SUBJECTS } from './fixtures';
import { golden } from './golden';

const subjectItems: LabelItem[] = SUBJECTS.map((s, i) => ({ id: `gmail:s${i}`, title: s.subject, from: s.from, preview: '', kind: 'email' }));
const truth = new Map(SUBJECTS.map((s) => [s.subject, s.label]));

/** Replies with the ground-truth label of each item in the prompt, unless `override` says otherwise. */
function answerFromPrompt(text: string, override?: (i: number, c: Category) => { i: number; c: string } | null) {
  const labels: { i: number; c: string; k: string[] }[] = [];
  for (const m of text.matchAll(/Item (\d+)\nKind: \w+\n(?:From: .*\n)?(?:Subject|File): (.*)\n/g)) {
    const i = Number(m[1]);
    const c = truth.get(m[2]) ?? 'Personal';
    const entry = override ? override(i, c) : { i, c };
    if (entry) labels.push({ ...entry, k: ['x y'] });
  }
  return JSON.stringify({ labels });
}

describe('labelBatch (10 section 16.6)', () => {
  beforeEach(() => {
    resetAiForTests();
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
  });

  it('LB-1: the user message equals the template byte for byte', () => {
    const items = [RECORDS.deposit, RECORDS.health, { ...RECORDS.photo, preview: RECORDS.photo.caption ?? '' }];
    expect(labelPrompt(items).text).toBe(golden('label-3.txt'));
  });

  it('LB-2: 50 subjects in 5 calls of 10, all labelled on the device', async () => {
    const fake = createFakeHybrid((_s, parts) => ({ text: answerFromPrompt(promptText(parts)), source: 'on_device' }));
    setHybridForTests(fake);
    const res = await labelBatch(subjectItems, 'own');
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls.every((c) => c.spec.mode === 'ONLY_ON_DEVICE' && c.meta?.priority === 'background')).toBe(true);
    for (const item of subjectItems) expect(res.labels[item.id]).toBe(truth.get(item.title));
    expect(Object.values(res.by ?? {}).every((w) => w === 'device')).toBe(true);
    expect(res.sdk).toBe('on_device');
    expect(res.trace).toMatchObject({ where: 'device', label: 'Sorted 50 items on this device', sdkReported: 'on_device', charsSent: 0 });
  });

  it('when the model and plain code disagree, plain code\'s category is kept, marked low; never out of Health', async () => {
    // Made-up mail: a store's promotion (plain code says Newsletters by its sender), an order (both agree), and a
    // message plain code has no words for (the model's answer stands).
    const items: LabelItem[] = [
      { id: 'gmail:promo', title: 'Consider this your official warning', from: 'Crestmarrow <hello@e.crestmarrow.example>', preview: '', kind: 'email' },
      { id: 'gmail:order', title: 'Your order has shipped', from: 'Crestmarrow <orders@crestmarrow.example>', preview: '', kind: 'email' },
      { id: 'gmail:note', title: 'quick question', from: 'Jordan Ellis <jordan.ellis@gmail.com>', preview: '', kind: 'email' },
      { id: 'gmail:care', title: 'A note about your visit', from: 'Corvane <hello@e.corvane.example>', preview: '', kind: 'email' },
    ];
    const said: Category[] = ['Shopping', 'Shopping', 'Work', 'Health'];
    setHybridForTests(createFakeHybrid(() => ({ text: JSON.stringify({ labels: said.map((c, i) => ({ i: i + 1, c })) }), source: 'on_device' })));
    const res = await labelBatch(items, 'own');
    expect(res.labels).toEqual({ 'gmail:promo': 'Newsletters', 'gmail:order': 'Shopping', 'gmail:note': 'Work', 'gmail:care': 'Health' });
    expect(res.confidence).toEqual({ 'gmail:promo': 'low', 'gmail:order': 'high', 'gmail:note': 'high', 'gmail:care': 'low' });
    expect(Object.values(res.by ?? {}).every((w) => w === 'device')).toBe(true);
  });

  it('LB-3: a missing entry and an unknown category fall back to plain code, low confidence', async () => {
    const items = subjectItems.slice(0, 10);
    setHybridForTests(
      createFakeHybrid((_s, parts) => ({
        text: answerFromPrompt(promptText(parts), (i, c) => (i === 4 ? null : i === 5 ? { i, c: 'Bills' } : { i, c })),
        source: 'on_device',
      })),
    );
    const res = await labelBatch(items, 'own');
    for (const item of [items[3], items[4]]) {
      expect(res.labels[item.id]).toBe(codeLabel(item).category);
      expect(res.by?.[item.id]).toBe('code');
      expect(res.confidence?.[item.id]).toBe('low');
    }
    expect(res.by?.[items[0].id]).toBe('device');
  });

  it('LB-4: the Health safety net overrides a model label', async () => {
    const item = subjectItems.find((s) => s.title === 'Fasting required before your blood draw') as LabelItem;
    setHybridForTests(createFakeHybrid(() => ({ text: '{"labels":[{"i":1,"c":"Newsletters"}]}', source: 'on_device' })));
    const res = await labelBatch([item], 'own');
    expect(res.labels[item.id]).toBe('Health');
    expect(res.by?.[item.id]).toBe('code');
    expect(res.confidence?.[item.id]).toBe('low');
  });

  it('LB-5: codeLabel gets all 50 subjects; isHealthStrong finds exactly the 8 Health ones', () => {
    let right = 0;
    for (const s of SUBJECTS) {
      if (codeLabel({ title: s.subject, from: s.from, preview: '', kind: 'email' }).category === s.label) right += 1;
      expect(isHealthStrong({ title: s.subject, from: s.from, preview: '' })).toBe(s.label === 'Health');
    }
    expect(right).toBe(50);
  });

  it('LB-6: own data without Nano: plain code only, no model call', async () => {
    setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'unavailable', image: 'unavailable' } }));
    const fake = createFakeHybrid(() => ({ text: '{}', source: 'on_device' }));
    setHybridForTests(fake);
    const res = await labelBatch(subjectItems, 'own');
    expect(fake.calls).toHaveLength(0);
    for (const item of subjectItems) expect(res.labels[item.id]).toBe(codeLabel(item).category);
    expect(res.trace).toMatchObject({ where: 'code', label: 'Sorted 50 items with plain code (no model)' });
    expect(res.sdk).toBeUndefined();
  });

  it('LB-7: photos without a description, photos of documents, and emails called Photos', async () => {
    const empty: LabelItem = { id: 'upload:p1', title: 'IMG_1.jpg', preview: '', kind: 'photo' };
    const receipt: LabelItem = { id: 'upload:p2', title: 'IMG_2.jpg', preview: 'A receipt from FreshCart for groceries', kind: 'photo' };
    const email: LabelItem = { id: 'gmail:e1', title: 'Hello there', from: 'Jo', preview: 'Just saying hi.', kind: 'email' };
    const fake = createFakeHybrid(() => ({ text: '{"labels":[{"i":1,"c":"Shopping"},{"i":2,"c":"Photos"}]}', source: 'on_device' }));
    setHybridForTests(fake);
    const res = await labelBatch([empty, receipt, email], 'own');
    expect(res.labels).toEqual({ 'upload:p1': 'Photos', 'upload:p2': 'Shopping', 'gmail:e1': 'Personal' });
    expect(res.by?.['upload:p1']).toBe('code');
    expect(promptText(fake.calls[0].parts)).not.toContain('IMG_1.jpg');
  });

  it('LB-8: labels carry no keywords (01 section 11.3)', async () => {
    setHybridForTests(createFakeHybrid((_s, parts) => ({ text: answerFromPrompt(promptText(parts)), source: 'on_device' })));
    const res = await labelBatch(subjectItems.slice(0, 2), 'own');
    expect(res).not.toHaveProperty('keywords');
    expect(LABEL_SYSTEM).not.toMatch(/keyword/i);
    expect(JSON.stringify(LABEL_SCHEMA)).not.toContain('"k"');
  });

  it('sample data without Nano is sorted in the cloud, labelled; approved text is refused', async () => {
    setLanguageModelForTests(undefined);
    setHybridForTests(createFakeHybrid((_s, parts) => ({ text: answerFromPrompt(promptText(parts)), source: 'in_cloud' })));
    const res = await labelBatch(subjectItems.slice(0, 3), 'sample');
    expect(res.trace).toMatchObject({ where: 'cloud', label: 'Sorted 3 sample items in the cloud' });
    expect((res.trace.charsSent ?? 0) > 0).toBe(true);
    await expect(labelBatch(subjectItems.slice(0, 1), 'approved')).rejects.toThrow('labelBatch never takes approved text');
    expect((await labelBatch([], 'own')).trace.label).toBe('Nothing to label');
  });
});

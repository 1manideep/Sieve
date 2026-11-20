// The smaller stores: availability setup, audit, grants, records, the Playground items and the index owner check.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexRecord } from '@sieve/shared';
import { MODEL_SETUP_ERRORS, PLAYGROUND_FLOW } from '@/copy/strings';

let progress: ((f: number) => void) | undefined;
let finishSetup: { resolve: () => void; reject: (e: unknown) => void } | undefined;
const downloadNano = vi.fn((opts?: { onProgress?: (f: number) => void }) => {
  progress = opts?.onProgress;
  return new Promise<void>((resolve, reject) => {
    finishSetup = { resolve, reject };
  });
});
const getNanoAvailability = vi.fn(async () => ({ text: 'available' as const, image: 'available' as const }));
const setNanoSimulation = vi.fn();
vi.mock('@/ai', () => ({ downloadNano, getNanoAvailability, setNanoSimulation }));

const checkAudit = vi.fn(async () => ({ state: 'intact' as const, entries: 12, checkedAt: 5 }));
vi.mock('@/app/services/audit', () => ({ checkAudit }));

const LINK = 'https://sieve.example/mcp/secret-link-value-1234';
const issueGrant = vi.fn(async () => ({ grantId: 'g1', link: LINK, linkHint: '1234', maxStep: 'answer', allowedCategories: ['Home'], allowedSources: ['gmail'], expiresAt: 9 }));
vi.mock('@/app/services/callables', () => ({ issueGrant, narrowGrant: vi.fn(), revokeGrant: vi.fn() }));

const rec: IndexRecord = {
  id: 'gmail:m1', source: 'gmail', sourceRef: 'm1', kind: 'email', title: 'Re: Deposit', from: 'L <l@x>', date: 7, preview: 'secret preview',
  text: 'secret body', category: 'Home', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 1, contentHash: 'h', version: 1,
};
const ingest = vi.fn(async (_db: unknown, raw: { source: string; sourceRef: string }) => ({ ...rec, id: `${raw.source}:${raw.sourceRef}`, sourceRef: raw.sourceRef }));
vi.mock('@/index', () => ({
  openDb: () => ({ name: 'db' }),
  getRecord: async (_db: unknown, id: string) => (id === rec.id ? rec : undefined),
  ingest,
}));

const { useAvailability, resetAvailabilityForTests, setupErrorMessage } = await import('./availability');
const { useAudit } = await import('./audit');
const { useGrants } = await import('./grants');
const { useRecords } = await import('./records');
const { usePlayground, buildTestEmailRaw, fileProblem } = await import('./playground');
const { checkIndexOwner, REAL_DB_OWNER_KEY } = await import('./session');

beforeEach(() => {
  vi.clearAllMocks();
  resetAvailabilityForTests();
});

describe('useAvailability.startSetup', () => {
  it('calls downloadNano at once when the AI layer is loaded, and follows the progress', async () => {
    await useAvailability.getState().refresh();   // loads the AI layer
    useAvailability.getState().startSetup();
    expect(downloadNano).toHaveBeenCalledTimes(1);   // synchronously, inside the click
    expect(useAvailability.getState().setup).toMatchObject({ state: 'downloading', fraction: 0 });
    progress?.(0.5);
    expect(useAvailability.getState().setup).toMatchObject({ state: 'downloading', fraction: 0.5 });
    progress?.(1);
    expect(useAvailability.getState().setup.state).toBe('installing');
    finishSetup?.resolve();
    await vi.waitFor(() => expect(useAvailability.getState().setup.state).toBe('done'));
  });

  it('maps a rejection to the 13.2 copy', async () => {
    await useAvailability.getState().refresh();
    useAvailability.getState().startSetup();
    finishSetup?.reject(Object.assign(new Error('x'), { name: 'QuotaExceededError' }));
    await vi.waitFor(() => expect(useAvailability.getState().setup).toMatchObject({ state: 'error', error: MODEL_SETUP_ERRORS.noSpace }));
    expect(setupErrorMessage({ name: 'NotAllowedError' })).toBe(MODEL_SETUP_ERRORS.needsClick);
    expect(setupErrorMessage({ code: 'needs-click' })).toBe(MODEL_SETUP_ERRORS.needsClick);
    expect(setupErrorMessage({ name: 'NetworkError' })).toBe(MODEL_SETUP_ERRORS.network);
    expect(setupErrorMessage(new Error('?'))).toBe(MODEL_SETUP_ERRORS.other);
  });
});

describe('useAudit', () => {
  it('checks, then shows intact; a failure is unavailable', async () => {
    await useAudit.getState().check();
    expect(useAudit.getState()).toMatchObject({ state: 'intact', entries: 12 });
    checkAudit.mockRejectedValueOnce(new Error('offline'));
    await useAudit.getState().check();
    expect(useAudit.getState().state).toBe('unavailable');
  });
});

describe('useGrants.create', () => {
  it('returns the link and keeps it in no store (AT-21)', async () => {
    const out = await useGrants.getState().create({ aiName: 'Gemini CLI', maxStep: 'answer', allowedCategories: ['Home'], allowedSources: ['gmail'], days: 30 });
    expect(out.link).toBe(LINK);
    for (const s of [useGrants, useAvailability, useAudit, useRecords, usePlayground]) {
      expect(JSON.stringify(s.getState())).not.toContain('secret-link-value');
    }
  });
});

describe('useRecords.ensure', () => {
  it('keeps only the display fields, null when not on this device', async () => {
    await useRecords.getState().ensure('real', ['gmail:m1', 'gmail:gone']);
    expect(useRecords.getState().meta).toEqual({
      'gmail:m1': { title: 'Re: Deposit', kind: 'email', category: 'Home', date: 7, source: 'gmail', from: 'L <l@x>' },
      'gmail:gone': null,
    });
    expect(JSON.stringify(useRecords.getState().meta)).not.toContain('secret');
  });
});

describe('usePlayground', () => {
  it('builds the test email with escaped fields and the white-text hidden part', () => {
    const raw = buildTestEmailRaw({ from: 'IT <x>', subject: 'S', body: 'a<b>&"', hidden: '<script>', hideAsWhiteText: true });
    expect(raw).toMatchObject({ source: 'upload', kind: 'email', title: 'S', from: 'IT <x> <it-support@example.com>' });
    expect(raw.sourceRef.startsWith('test-email-')).toBe(true);
    expect(raw.html).toBe('<p>a&lt;b&gt;&amp;&quot;</p><p style="color:#ffffff;background:#ffffff;font-size:1px">&lt;script&gt;</p>');
    expect(buildTestEmailRaw({ from: 'a', subject: 'b', body: 'c', hidden: 'd', hideAsWhiteText: false }).html).toBe('<p>c</p><p>d</p>');
  });

  it('checks files: size, type and how many at once', async () => {
    expect(fileProblem({ name: 'a.pdf', size: 11 * 1024 * 1024 })).toBe(PLAYGROUND_FLOW.tooBig('a.pdf'));
    expect(fileProblem({ name: 'a.exe', size: 10 })).toBe(PLAYGROUND_FLOW.unsupported('a.exe'));
    expect(fileProblem({ name: 'a.txt', size: 10 })).toBeNull();
    const six = Array.from({ length: 6 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
    await usePlayground.getState().addFiles(six);
    expect(usePlayground.getState().added.at(-1)).toMatchObject({ status: 'error', error: PLAYGROUND_FLOW.tooMany });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('ingests a file as the visitor\'s own data and lists it', async () => {
    await usePlayground.getState().addFiles([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    expect(ingest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'upload', kind: 'document', title: 'note.txt' }), 'own');
    expect(usePlayground.getState().added.at(-1)).toMatchObject({ name: 'note.txt', status: 'indexed' });
  });

  it('the simulation toggle goes to the AI layer', async () => {
    usePlayground.getState().setSimulateNoModel(true);
    expect(usePlayground.getState().simulateNoModel).toBe(true);
    await vi.waitFor(() => expect(setNanoSimulation).toHaveBeenCalledWith(true));
  });
});

describe('index owner check (40 section 6.4)', () => {
  it('claims an unowned index, passes for the owner, conflicts for another account', () => {
    window.localStorage.removeItem(REAL_DB_OWNER_KEY);
    expect(checkIndexOwner('uA')).toBe('ok');
    expect(window.localStorage.getItem(REAL_DB_OWNER_KEY)).toBe('uA');
    expect(checkIndexOwner('uA')).toBe('ok');
    expect(checkIndexOwner('uB')).toBe('conflict');
  });
});

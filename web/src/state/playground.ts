// usePlayground (40 section 9.10). The Playground database, its seed, the visitor's own files and test emails.
// The index and the AI layer load with dynamic imports; the Playground never touches Firestore.
import { create } from 'zustand';
import type { IndexRecord } from '@sieve/shared';
import type { RawItem, SieveDb } from '@/index';
import { PLAYGROUND_FLOW } from '@/copy/strings';
import { loadAi } from './availability';
import { tables } from './localDb';
import { useReceipts } from './receipts';
import { itemKindForFile } from './sources';

export interface AddedItem { recordId?: string; name: string; kind: 'file' | 'test-email'; status: 'indexing' | 'indexed' | 'error'; error?: string }
export interface TestEmailInput { from: string; subject: string; body: string; hidden: string; hideAsWhiteText: boolean }
export interface PlaygroundState {
  status: 'idle' | 'opening' | 'seeding' | 'ready' | 'resetting' | 'error';
  seedProgress: { done: number; total: number };
  error?: string;
  simulateNoModel: boolean;                        // the "Not available (simulate)" toggle
  composing: boolean;
  added: AddedItem[];                              // derived from playground records with source 'upload' (survives reload)
  tab: 'ask' | 'seen';
  openFolder?: 'mail' | 'photos' | 'documents';
  start(): Promise<void>;                          // openDb('playground'); CR-4 seedPlayground when records are empty
  setSimulateNoModel(on: boolean): void;           // CR-2 setNanoSimulation(on)
  setComposing(on: boolean): void;
  addFiles(files: File[]): Promise<void>;
  addTestEmail(input: TestEmailInput): Promise<void>;
  reset(): Promise<void>;                          // CR-4 resetPlayground, then start()
  setTab(t: 'ask' | 'seen'): void;
  setOpenFolder(f?: 'mail' | 'photos' | 'documents'): void;
}

export const MAX_FILES_AT_ONCE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED = /\.(txt|md|pdf|jpe?g|png|webp)$/i;

/** CR-4 additions of the index module (20 owns them); used when present. */
type IndexExtras = {
  seedPlayground?: (db: SieveDb, onProgress?: (done: number, total: number) => void) => Promise<void>;
  resetPlayground?: () => Promise<SieveDb>;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The test email (40 section 13.9). Mirrors playground/testEmail.ts `buildTestEmail`, which the Playground package
 * owns; switch to that export once it lands.
 */
export function buildTestEmailRaw(i: TestEmailInput): RawItem {
  const hidden = i.hideAsWhiteText
    ? `<p style="color:#ffffff;background:#ffffff;font-size:1px">${escapeHtml(i.hidden)}</p>`
    : `<p>${escapeHtml(i.hidden)}</p>`;
  return {
    source: 'upload',
    sourceRef: 'test-email-' + crypto.randomUUID(),
    kind: 'email',
    title: i.subject,
    from: `${i.from} <it-support@example.com>`,
    date: Date.now(),
    html: `<p>${escapeHtml(i.body)}</p>${hidden}`,
  };
}

/** Why a file cannot be added in the Playground (40 section 13.9 copy), or null. */
export function fileProblem(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size > MAX_FILE_BYTES) return PLAYGROUND_FLOW.tooBig(file.name);
  if (!SUPPORTED.test(file.name)) return PLAYGROUND_FLOW.unsupported(file.name);
  return null;
}

function toAdded(r: Pick<IndexRecord, 'id' | 'title' | 'sourceRef'>): AddedItem {
  return { recordId: r.id, name: r.title, kind: r.sourceRef.startsWith('test-email-') ? 'test-email' : 'file', status: 'indexed' };
}

let db: SieveDb | undefined;
let stopAddedQuery: (() => void) | undefined;
let pending: AddedItem[] = [];      // items being added or failed in this page (not in the database)
let stored: AddedItem[] = [];       // indexed uploads, from the database
let token = 0;

export const usePlayground = create<PlaygroundState>()((set, get) => {
  const publishAdded = () => set({ added: [...stored, ...pending] });

  async function watchAdded(handle: SieveDb): Promise<void> {
    stopAddedQuery?.();
    const { liveQuery } = await import('dexie');
    const sub = liveQuery(() => tables(handle).records.where('source').equals('upload').toArray()).subscribe({
      next: (records) => {
        stored = [...records].sort((a, b) => a.indexedAt - b.indexedAt).map(toAdded);
        const known = new Set(stored.map((s) => s.recordId));
        pending = pending.filter((p) => !p.recordId || !known.has(p.recordId));
        publishAdded();
      },
      error: (error: unknown) => console.error('playground items', error),
    });
    stopAddedQuery = () => sub.unsubscribe();
  }

  async function addOne(item: AddedItem, raw: RawItem): Promise<void> {
    pending = [...pending, item];
    publishAdded();
    const mine = token;
    try {
      const index = await import('@/index');
      const handle = db ?? index.openDb('playground');
      const record = await index.ingest(handle, raw, 'own');
      if (mine !== token) return;
      pending = pending.map((p) => (p === item ? { ...p, recordId: record.id, status: 'indexed' as const } : p));
      if (stored.some((s) => s.recordId === record.id)) pending = pending.filter((p) => p.recordId !== record.id);
    } catch (error) {
      if (mine !== token) return;
      const message = (error as { message?: unknown } | null)?.message;
      const reason = typeof message === 'string' && /\s/.test(message) && message.length <= 200 ? message : PLAYGROUND_FLOW.addFailed;
      pending = pending.map((p) => (p === item ? { ...p, status: 'error' as const, error: reason } : p));
    }
    publishAdded();
  }

  return {
    status: 'idle',
    seedProgress: { done: 0, total: 0 },
    error: undefined,
    simulateNoModel: false,
    composing: false,
    added: [],
    tab: 'ask',
    openFolder: undefined,

    async start() {
      const s = get().status;
      if (s === 'opening' || s === 'seeding') return;
      const mine = ++token;
      set({ status: 'opening', error: undefined });
      try {
        const index = (await import('@/index')) as typeof import('@/index') & IndexExtras;
        const handle = index.openDb('playground');
        db = handle;
        const count = (await tables(handle).records.toCollection().primaryKeys()).length;
        if (mine !== token) return;
        if (count === 0) {
          set({ status: 'seeding', seedProgress: { done: 0, total: 0 } });
          if (typeof index.seedPlayground !== 'function') throw new Error('seed unavailable');
          await index.seedPlayground(handle, (done, total) => {
            if (mine === token) set({ seedProgress: { done, total } });
          });
        }
        if (mine !== token) return;
        await watchAdded(handle);
        set({ status: 'ready' });
      } catch (error) {
        if (mine !== token) return;
        const name = (error as { name?: unknown } | null)?.name;
        const blocked = name === 'SecurityError' || name === 'InvalidStateError' || name === 'MissingAPIError' || typeof indexedDB === 'undefined';
        console.error('playground start', typeof name === 'string' ? name : 'failed');
        set({ status: 'error', error: blocked ? PLAYGROUND_FLOW.storageBlocked : PLAYGROUND_FLOW.seedFailed });
      }
    },

    setSimulateNoModel(on) {
      set({ simulateNoModel: on });
      void loadAi()
        .then((ai) => ai.setNanoSimulation(on))
        .catch((error: unknown) => console.error('simulation', error));
    },

    setComposing: (on) => set({ composing: on }),

    async addFiles(files) {
      if (files.length > MAX_FILES_AT_ONCE) {
        pending = [...pending, { name: files.map((f) => f.name).join(', '), kind: 'file', status: 'error', error: PLAYGROUND_FLOW.tooMany }];
        publishAdded();
        return;
      }
      for (const file of files) {
        const problem = fileProblem(file);
        if (problem) {
          pending = [...pending, { name: file.name, kind: 'file', status: 'error', error: problem }];
          publishAdded();
          continue;
        }
        await addOne(
          { name: file.name, kind: 'file', status: 'indexing' },
          {
            source: 'upload',
            sourceRef: `upload-${crypto.randomUUID()}`,
            kind: itemKindForFile(file),
            title: file.name,
            date: file.lastModified || Date.now(),
            blob: file,
          },
        );
      }
    },

    async addTestEmail(input) {
      set({ composing: false });
      await addOne({ name: input.subject, kind: 'test-email', status: 'indexing' }, buildTestEmailRaw(input));
    },

    async reset() {
      ++token;
      set({ status: 'resetting', error: undefined });
      stopAddedQuery?.();
      stopAddedQuery = undefined;
      pending = [];
      stored = [];
      publishAdded();
      try {
        const index = (await import('@/index')) as typeof import('@/index') & IndexExtras;
        if (typeof index.resetPlayground === 'function') db = await index.resetPlayground();
        else if (db) await tables(db).delete();
      } catch (error) {
        console.error('playground reset', error);
      }
      // The receipts list read the database that was just wiped; listen on the new one.
      useReceipts.getState().refresh('playground');
      set({ status: 'idle', tab: 'ask', openFolder: undefined, composing: false });
      await get().start();
    },

    setTab: (t) => set({ tab: t }),
    setOpenFolder: (f) => set({ openFolder: f }),
  };
});

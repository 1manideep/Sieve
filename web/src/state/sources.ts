// useSources (40 section 9.9). Rows are read in components with useLiveQuery on db.sources (WP4 and WP5).
// connect and reauthorize must run inside the click handler (popup, directory picker): the modules are already
// loaded on the Sources screen, so the dynamic import resolves at once and the call keeps the user activation.
import { create } from 'zustand';
import type { ItemKind, SourceKind } from '@sieve/shared';
import { SOURCES_FLOW } from '@/copy/strings';
import type { DbKind } from './types';

export interface SourceRowView {
  kind: SourceKind; connected: boolean; paused: boolean; progress: { done: number; total: number };
  lastSyncAt?: number; needsAuth?: boolean; error?: string; folderName?: string;   // the last three from CR-4
}
export type AddResult = { name: string; ok: true; recordId: string } | { name: string; ok: false; reason: string };
export interface SourcesState {
  busy: Partial<Record<SourceKind | 'rebuild' | 'pause', boolean>>;
  connect(kind: 'gmail' | 'folder'): Promise<void>;       // CR-4; must run inside the click handler (popup, directory picker)
  reauthorize(kind: 'gmail' | 'folder'): Promise<void>;
  disconnect(kind: SourceKind): Promise<void>;
  setPaused(paused: boolean): Promise<void>;               // all sources
  rebuild(): Promise<void>;
  addFiles(kind: DbKind, files: File[]): Promise<AddResult[]>;
}

/** 20 section 17 `addUploads`, used when the sources module provides it. */
interface UploadResultLike { fileName: string; status: 'indexed' | 'duplicate' | 'rejected'; reason?: string; recordId?: string }
type SourcesExtras = { addUploads?: (db: unknown, files: File[], data?: 'own') => Promise<UploadResultLike[]> };

let sourcesModule: typeof import('@/sources') | undefined;
let indexModule: typeof import('@/index') | undefined;

async function load(): Promise<{ sources: typeof import('@/sources'); index: typeof import('@/index') }> {
  sourcesModule ??= await import('@/sources');
  indexModule ??= await import('@/index');
  return { sources: sourcesModule, index: indexModule };
}

/** Loads the modules ahead of a click (the Sources and Setup screens call this on mount). */
export function preloadSources(): Promise<void> {
  return load().then(() => undefined);
}

export function itemKindForFile(file: Pick<File, 'type' | 'name'>): ItemKind {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(file.name) ? 'photo' : 'document';
}

/** A sentence is shown as it is; a code (no spaces) or nothing becomes the generic line. Never a file's content. */
function personReason(reason: unknown): string {
  return typeof reason === 'string' && /\s/.test(reason.trim()) && reason.length <= 200 ? reason.trim() : SOURCES_FLOW.addFailed;
}

/** Ingests uploads one by one: one bad file is skipped and reported, the rest go on (70 principle P2). */
export async function ingestUploads(kind: DbKind, files: File[]): Promise<AddResult[]> {
  const { index } = await load();
  const db = index.openDb(kind);
  const results: AddResult[] = [];
  for (const file of files) {
    try {
      const record = await index.ingest(
        db,
        {
          source: 'upload',
          sourceRef: `upload-${crypto.randomUUID()}`,
          kind: itemKindForFile(file),
          title: file.name,
          date: file.lastModified || Date.now(),
          blob: file,
        },
        'own',
      );
      results.push({ name: file.name, ok: true, recordId: record.id });
    } catch (error) {
      results.push({ name: file.name, ok: false, reason: personReason((error as { message?: unknown } | null)?.message) });
    }
  }
  return results;
}

export const useSources = create<SourcesState>()((set) => {
  async function busy<T>(key: SourceKind | 'rebuild' | 'pause', run: () => Promise<T>): Promise<T> {
    set((s) => ({ busy: { ...s.busy, [key]: true } }));
    try {
      return await run();
    } finally {
      set((s) => ({ busy: { ...s.busy, [key]: false } }));
    }
  }

  return {
    busy: {},

    connect(kind) {
      // No await before the source call when the modules are loaded: the popup or picker needs the click.
      if (sourcesModule && indexModule) {
        const db = indexModule.openDb('real');
        const call = kind === 'gmail' ? sourcesModule.connectGmail(db) : sourcesModule.connectFolder(db);
        return busy(kind, () => call);
      }
      return busy(kind, async () => {
        const { sources, index } = await load();
        const db = index.openDb('real');
        await (kind === 'gmail' ? sources.connectGmail(db) : sources.connectFolder(db));
      });
    },

    reauthorize(kind) {
      if (sourcesModule && indexModule) {
        const call = sourcesModule.reauthorize(indexModule.openDb('real'), kind);
        return busy(kind, () => call);
      }
      return busy(kind, async () => {
        const { sources, index } = await load();
        await sources.reauthorize(index.openDb('real'), kind);
      });
    },

    disconnect: (kind) =>
      busy(kind, async () => {
        const { sources, index } = await load();
        await sources.disconnectSource(index.openDb('real'), kind);
      }),

    setPaused: (paused) =>
      busy('pause', async () => {
        const { sources, index } = await load();
        await sources.setIndexingPaused(index.openDb('real'), paused);
      }),

    rebuild: () =>
      busy('rebuild', async () => {
        const { sources, index } = await load();
        await sources.rebuildIndex(index.openDb('real'));
      }),

    addFiles: (kind, files) =>
      busy('upload', async () => {
        const { sources, index } = await load();
        const addUploads = (sources as typeof sources & SourcesExtras).addUploads;
        if (kind === 'real' && typeof addUploads === 'function') {
          const out = await addUploads(index.openDb('real'), files, 'own');
          return out.map((r): AddResult =>
            r.status === 'rejected' || !r.recordId
              ? { name: r.fileName, ok: false, reason: personReason(r.reason) }
              : { name: r.fileName, ok: true, recordId: r.recordId },
          );
        }
        return ingestUploads(kind, files);
      }),
  };
});

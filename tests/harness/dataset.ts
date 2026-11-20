// The Playground dataset read from disk, as a stand-in for web/src/playground/assets.ts in tests (fetch is blocked
// in unit tests). Use: vi.mock('@/playground/assets', async () => (await import('<path>/tests/harness/dataset')).assetsModule)
import { Blob as NodeBlob } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'data', 'playground', 'seed-bundle.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const DATA_DIR = join(repoRoot(), 'data', 'playground');

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, rel), 'utf8')) as T;
}

export function readBlob(rel: string, type = ''): Blob {
  return new NodeBlob([readFileSync(join(DATA_DIR, rel))], { type }) as unknown as Blob;
}

interface Doc { id: string; file: string; kind: 'document' | 'note'; category: string; date: string }
interface Photo { id: string; file: string; date: string; hadGps: boolean; place?: string; description: string }

const DOCS = readJson<Doc[]>('documents/documents.json');
const PHOTOS = readJson<Photo[]>('photos/photos.json');

function mimeOf(file: string): string {
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg';
  if (/\.png$/i.test(file)) return 'image/png';
  if (/\.pdf$/i.test(file)) return 'application/pdf';
  if (/\.json$/i.test(file)) return 'application/json';
  if (/\.md$/i.test(file)) return 'text/markdown';
  return 'text/plain';
}

export const assetsControl = {
  /** undefined: the committed bundle; null: no bundle (fallback path); an object: that bundle. */
  bundle: undefined as unknown,
  fetches: 0,
  reset() {
    this.bundle = undefined;
    this.fetches = 0;
  },
};

export const assetsModule = {
  SEED_DOCUMENTS: DOCS,
  SEED_PHOTOS: PHOTOS,
  playgroundFileUrl: (id: string) => `/data/${id}`,
  playgroundThumbUrl: (id: string) => `/data/thumbs/${id}`,
  async fetchPlaygroundFile(seedId: string): Promise<Blob> {
    assetsControl.fetches++;
    const d = DOCS.find((x) => x.id === seedId);
    if (d) return readBlob('documents/' + d.file, mimeOf(d.file));
    const p = PHOTOS.find((x) => x.id === seedId);
    if (p) return readBlob('photos/' + p.file, mimeOf(p.file));
    throw new DOMException('No sample file', 'NotFoundError');
  },
  async fetchPlaygroundThumb(seedId: string): Promise<Blob | undefined> {
    const p = PHOTOS.find((x) => x.id === seedId);
    return p ? readBlob('photos/thumbs/' + p.file.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg') : undefined;
  },
  async loadSeedBundle() {
    if (assetsControl.bundle === undefined) return readJson('seed-bundle.json');
    return assetsControl.bundle;
  },
  async loadRawDataset() {
    return {
      emails: readJson<{ emails: unknown[] }>('emails.json').emails,
      documents: DOCS,
      photos: PHOTOS,
      captions: readJson<Record<string, unknown>>('captions.json'),
    };
  },
};

// The Playground dataset's files, served from Sieve's own origin (20 sections 18.3 and 19). Nothing here
// imports firebase/firestore: Playground data never reaches Firestore (20 rule 6).
import type { Category, IndexRecord } from '@sieve/shared';
import DOCUMENTS from '../../../data/playground/documents/documents.json';
import PHOTOS from '../../../data/playground/photos/photos.json';

export interface SeedEmail { id: string; threadId: string; from: string; to: string; date: string; subject: string; category: Category; sent?: boolean; text?: string; html?: string }
export interface SeedDocument { id: string; file: string; kind: 'document' | 'note'; category: Category; date: string }
export interface SeedPhoto { id: string; file: string; date: string; hadGps: boolean; gps?: { lat: number; lon: number }; place?: string; description: string }
export interface SeedCaption { caption: string; captionBy: 'seed'; madeBy: 'nano-on-device' | 'hand-written'; madeAt?: string }
export interface SeedBundle {
  version: string;
  model: string;
  createdAt: string;
  records: IndexRecord[];
  vectors: { id: string; recordId: string; start: number; end: number; recordVersion: number; v: string }[];
}

const files = import.meta.glob<string>('../../../data/playground/{documents,photos}/*.{pdf,md,txt,json,jpg,jpeg,png}', { query: '?url', import: 'default', eager: true });
const thumbs = import.meta.glob<string>('../../../data/playground/photos/thumbs/*.jpg', { query: '?url', import: 'default', eager: true });

export const SEED_DOCUMENTS = DOCUMENTS as unknown as SeedDocument[];
export const SEED_PHOTOS = PHOTOS as unknown as SeedPhoto[];

function urlFor(folder: 'documents' | 'photos', file: string): string | undefined {
  return files[`../../../data/playground/${folder}/${file}`];
}

/** The original file of a seed document or photo. */
export function playgroundFileUrl(seedId: string): string | undefined {
  const doc = SEED_DOCUMENTS.find((d) => d.id === seedId);
  if (doc) return urlFor('documents', doc.file);
  const photo = SEED_PHOTOS.find((p) => p.id === seedId);
  return photo ? urlFor('photos', photo.file) : undefined;
}

/** The prebuilt thumbnail of a seed photo (`photos/thumbs/<stem>.jpg`). */
export function playgroundThumbUrl(seedId: string): string | undefined {
  const photo = SEED_PHOTOS.find((p) => p.id === seedId);
  if (!photo) return undefined;
  const stem = photo.file.replace(/\.[^.]+$/, '');
  return thumbs[`../../../data/playground/photos/thumbs/${stem}.jpg`];
}

async function fetchBlob(url: string | undefined, what: string): Promise<Blob> {
  if (!url) throw new DOMException(`No ${what} in this build.`, 'NotFoundError');
  const res = await fetch(url);
  if (!res.ok) throw new DOMException(`Couldn't load the ${what}.`, 'NetworkError');
  return res.blob();
}

export function fetchPlaygroundFile(seedId: string): Promise<Blob> {
  return fetchBlob(playgroundFileUrl(seedId), 'sample file');
}

export async function fetchPlaygroundThumb(seedId: string): Promise<Blob | undefined> {
  const url = playgroundThumbUrl(seedId);
  return url ? fetchBlob(url, 'sample thumbnail') : undefined;
}

/** The committed seed bundle, or null when it is missing from this build. */
export async function loadSeedBundle(): Promise<SeedBundle | null> {
  try {
    const mod = (await import('../../../data/playground/seed-bundle.json')) as unknown as { default: SeedBundle };
    return mod.default;
  } catch {
    return null;
  }
}

/** The raw dataset for the fallback path (20 section 18.3). */
export async function loadRawDataset(): Promise<{ emails: SeedEmail[]; documents: SeedDocument[]; photos: SeedPhoto[]; captions: Record<string, SeedCaption> }> {
  const [emails, captions] = await Promise.all([
    import('../../../data/playground/emails.json') as unknown as Promise<{ default: { version: number; emails: SeedEmail[] } }>,
    import('../../../data/playground/captions.json') as unknown as Promise<{ default: Record<string, SeedCaption> }>,
  ]);
  return { emails: emails.default.emails, documents: SEED_DOCUMENTS, photos: SEED_PHOTOS, captions: captions.default };
}

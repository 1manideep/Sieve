// "What is on this computer" (40 section 13.9, the final design's row under the chips): the pretend computer's mail,
// photos and documents as folder pills that open their lists, what the visitor added, "Add files" and the test email
// composer. Everything here reads the Playground database on the device.
import { useEffect, useId, useRef, useState, type ChangeEvent, type MutableRefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { IndexRecord, ItemKind } from '@sieve/shared';
import type { SieveDb } from '@/index';
import type { AddedItem, TestEmailInput } from '@/state/playground';
import { PLAYGROUND_COPY, fill } from '@/copy/screens-main';
import { Glyph, type GlyphName } from '@/components/AskResult/glyphs';
import { Button } from '@/components/Button/Button';
import { tablesOf } from '@/components/dbTables';
import { senderName } from '@/components/ItemSummary/ItemSummary';
import { Notice } from '@/components/Notice/Notice';
import { Tag } from '@/components/Tag/Tag';
import { formatDate } from '@/components/TimeText/TimeText';
import { formatMs } from '@/components/TraceList/TraceList';
import { TestEmailComposer } from './TestEmailComposer';
import styles from './playground.module.css';

export const UPLOAD_ACCEPT = '.txt,.md,.pdf,.jpg,.jpeg,.png,.webp';
export const UPLOAD_MAX_FILES = 5;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED = /\.(txt|md|pdf|jpe?g|png|webp)$/i;

/** Count, size and type checks before anything is read (40 section 13.9). */
export function checkFiles(files: File[]): { ok: File[]; problems: string[] } {
  if (files.length > UPLOAD_MAX_FILES) return { ok: [], problems: [PLAYGROUND_COPY.errTooMany] };
  const ok: File[] = [];
  const problems: string[] = [];
  for (const f of files) {
    if (!SUPPORTED.test(f.name)) problems.push(fill(PLAYGROUND_COPY.errType, { name: f.name }));
    else if (f.size > UPLOAD_MAX_BYTES) problems.push(fill(PLAYGROUND_COPY.errTooBig, { name: f.name }));
    else ok.push(f);
  }
  return { ok, problems };
}

type Folder = 'mail' | 'photos' | 'documents';

interface FileRow { id: string; title: string; kind: ItemKind; from?: string; date: number; caption?: string; captionBy?: IndexRecord['captionBy'] }

function toRow(r: IndexRecord): FileRow {
  return { id: r.id, title: r.title, kind: r.kind, from: r.from, date: r.date, caption: r.caption, captionBy: r.captionBy };
}

/** Titles, dates and captions only: no item text is kept for the list. */
export function useFileRows(db: SieveDb | null): FileRow[] | undefined {
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const records = await tablesOf(db).records.toArray();
    return records.map(toRow).sort((a, b) => b.date - a.date);
  }, [db]);
}

export function folderCounts(rows: FileRow[] | undefined): { emails: number; photos: number; documents: number } {
  const list = rows ?? [];
  return {
    emails: list.filter((r) => r.kind === 'email').length,
    photos: list.filter((r) => r.kind === 'photo').length,
    documents: list.filter((r) => r.kind === 'document' || r.kind === 'note').length,
  };
}

function PhotoThumb({ db, row }: { db: SieveDb; row: FileRow }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    tablesOf(db)
      .blobs.get(row.id)
      .then((b) => {
        if (cancelled || !(b?.thumb instanceof Blob) || !ref.current || typeof URL.createObjectURL !== 'function') return;
        url = URL.createObjectURL(b.thumb);
        ref.current.src = url;
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [db, row.id]);
  return <img ref={ref} className={styles.thumb} alt={fill(PLAYGROUND_COPY.photoAlt, { caption: row.caption ?? row.title })} loading="lazy" />;
}

function countLabel(folder: Folder, n: number): string {
  if (folder === 'mail') return n === 1 ? PLAYGROUND_COPY.countEmailsOne : fill(PLAYGROUND_COPY.countEmails, { n });
  if (folder === 'photos') return n === 1 ? PLAYGROUND_COPY.countPhotosOne : fill(PLAYGROUND_COPY.countPhotos, { n });
  return n === 1 ? PLAYGROUND_COPY.countFilesOne : fill(PLAYGROUND_COPY.countFiles, { n });
}

const FOLDER_GLYPH: Record<Folder, GlyphName> = { mail: 'mail', photos: 'photo', documents: 'file' };

function AddedRow({ item }: { item: AddedItem }) {
  return (
    <li className={styles.addedRow}>
      <span className={styles.addedName} dir="auto">
        {item.name}
      </span>
      <span className={styles.tags}>
        {item.status === 'indexing' ? <Tag tone="muted">{PLAYGROUND_COPY.addedIndexing}</Tag> : null}
        {item.status === 'indexed' ? <Tag tone="device">{PLAYGROUND_COPY.addedIndexed}</Tag> : null}
        {item.status === 'error' ? <Tag tone="never">{fill(PLAYGROUND_COPY.addedError, { reason: item.error ?? '' })}</Tag> : null}
        <Tag tone="muted">{PLAYGROUND_COPY.neverUploaded}</Tag>
      </span>
    </li>
  );
}

export interface FilesWindowProps {
  db: SieveDb | null;
  added: AddedItem[];
  openFolder?: Folder;
  onOpenFolder(f?: Folder): void;
  onOpenItem(id: string): void;
  composing: boolean;
  onComposing(on: boolean): void;
  onAddFiles(files: File[]): void;
  onAddTestEmail(input: TestEmailInput, question?: string): void;
  liveCaptions: boolean;          // image input available and not simulating
  narrow: boolean;                // under 1024px: the added list and the buttons fold behind "Show files"
}

export interface FilesWindowHandle {
  pickFiles(): void;
}

export function FilesWindow(props: FilesWindowProps & { pickRef?: MutableRefObject<FilesWindowHandle | null> }) {
  const { db, added, openFolder, onOpenFolder, onOpenItem, composing, onComposing, onAddFiles, onAddTestEmail, liveCaptions, narrow, pickRef } = props;
  const rows = useFileRows(db);
  const counts = folderCounts(rows);
  const total = counts.emails + counts.photos + counts.documents;
  const fileInput = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [shown, setShown] = useState(false);
  const [live, setLive] = useState<Record<string, { caption: string; ms: number }>>({});
  const [captioning, setCaptioning] = useState<{ i: number; n: number } | null>(null);
  const stopCaptions = useRef(false);
  const composerId = useId();
  const bodyId = useId();
  const titleId = useId();
  const listIds = { mail: useId(), photos: useId(), documents: useId() };

  useEffect(() => {
    if (!pickRef) return undefined;
    pickRef.current = { pickFiles: () => fileInput.current?.click() };
    return () => {
      pickRef.current = null;
    };
  }, [pickRef]);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const { ok, problems: found } = checkFiles(files);
    setProblems(found);
    if (ok.length > 0) onAddFiles(ok);
  };

  const captionAll = async () => {
    if (!db) return;
    const photos = (rows ?? []).filter((r) => r.kind === 'photo');
    stopCaptions.current = false;
    for (let i = 0; i < photos.length; i += 1) {
      if (stopCaptions.current) break;
      setCaptioning({ i: i + 1, n: photos.length });
      try {
        const blob = (await tablesOf(db).blobs.get(photos[i].id))?.blob;
        if (!blob) continue;
        const { captionPhoto } = await import('@/ai');
        const result = await captionPhoto(blob, 'sample');
        if (result.ok) setLive((prev) => ({ ...prev, [photos[i].id]: { caption: result.value.caption, ms: result.trace.ms } }));
      } catch (error) {
        console.error(error);
      }
    }
    setCaptioning(null);
  };

  const folderButton = (key: Folder, label: string, n: number) => {
    const open = openFolder === key;
    return (
      <button
        key={key}
        type="button"
        className={styles.folderPill}
        aria-expanded={open}
        aria-controls={listIds[key]}
        onClick={() => onOpenFolder(open ? undefined : key)}
      >
        <Glyph name={FOLDER_GLYPH[key]} size={16} className={styles.folderGlyph} />
        <span className={styles.folderName}>{label}</span>
        <span className={styles.folderCount}>{countLabel(key, n)}</span>
      </button>
    );
  };

  const folderList = (key: Folder) => {
    const open = openFolder === key;
    const list = (rows ?? []).filter((r) => (key === 'mail' ? r.kind === 'email' : key === 'photos' ? r.kind === 'photo' : r.kind === 'document' || r.kind === 'note'));
    return (
      <div id={listIds[key]} key={key} hidden={!open} className={styles.folderBody}>
        {open && key !== 'photos' ? (
          <ul className={styles.itemList}>
            {list.map((r) => (
              <li key={r.id}>
                <button type="button" className={styles.itemButton} onClick={() => onOpenItem(r.id)}>
                  <span className={styles.itemTitle} dir="auto">
                    {r.title}
                  </span>
                  <span className={styles.itemMeta} dir="auto">
                    {r.kind === 'email' && r.from ? fill(PLAYGROUND_COPY.mailMeta, { name: senderName(r.from), date: formatDate(r.date) }) : formatDate(r.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {open && key === 'photos' && db ? (
          <div className={styles.photos}>
            {liveCaptions ? (
              <div className={styles.captionBar}>
                {captioning ? (
                  <>
                    <span className={styles.itemMeta} role="status">
                      {fill(PLAYGROUND_COPY.captioning, { i: captioning.i, n: captioning.n })}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => (stopCaptions.current = true)}>
                      {PLAYGROUND_COPY.stopCaption}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void captionAll()}>
                    {PLAYGROUND_COPY.captionLive}
                  </Button>
                )}
              </div>
            ) : null}
            <ul className={styles.photoGrid}>
              {list.map((r) => (
                <li key={r.id} className={styles.photoCell}>
                  <button type="button" className={styles.photoButton} onClick={() => onOpenItem(r.id)}>
                    <PhotoThumb db={db} row={r} />
                  </button>
                  <span className={styles.caption} dir="auto">
                    {r.caption ?? r.title}
                  </span>
                  <Tag tone={r.captionBy === 'seed' ? 'muted' : 'device'}>
                    {r.captionBy === 'seed' ? PLAYGROUND_COPY.captionedBefore : PLAYGROUND_COPY.captionedHere}
                  </Tag>
                  {live[r.id] ? (
                    <span className={styles.live}>
                      <span dir="auto">{fill(PLAYGROUND_COPY.liveCaption, { caption: live[r.id].caption })}</span>
                      <Tag tone="device">{PLAYGROUND_COPY.deviceTag}</Tag>
                      <span className={styles.itemMeta}>{formatMs(live[r.id].ms)}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className={styles.computer} aria-labelledby={titleId}>
      <div className={styles.computerHead}>
        <h2 id={titleId} className={styles.computerTitle}>
          {PLAYGROUND_COPY.computerTitle}
        </h2>
        <span className={styles.computerCount}>
          {total === 1 ? PLAYGROUND_COPY.computerCountOne : fill(PLAYGROUND_COPY.computerCount, { n: total })}
        </span>
        {narrow ? (
          <Button variant="ghost" size="sm" className={styles.showFiles} aria-expanded={shown} aria-controls={bodyId} onClick={() => setShown((v) => !v)}>
            {shown ? PLAYGROUND_COPY.hideFiles : PLAYGROUND_COPY.showFiles}
          </Button>
        ) : null}
      </div>
      {narrow ? (
        <p className={styles.narrowSummary}>
          {fill(PLAYGROUND_COPY.narrowSummary, { emails: counts.emails, photos: counts.photos, documents: counts.documents })}
        </p>
      ) : null}
      <div className={styles.folders}>
        {folderButton('mail', PLAYGROUND_COPY.folderMail, counts.emails)}
        {folderButton('photos', PLAYGROUND_COPY.folderPhotos, counts.photos)}
        {folderButton('documents', PLAYGROUND_COPY.folderDocuments, counts.documents)}
      </div>
      {folderList('mail')}
      {folderList('photos')}
      {folderList('documents')}
      <div id={bodyId} className={styles.computerBody} hidden={narrow && !shown}>
        <div className={styles.added}>
          <h3 className={styles.addedTitle}>{PLAYGROUND_COPY.addedTitle}</h3>
          {added.length === 0 ? (
            <p className={styles.itemMeta}>{PLAYGROUND_COPY.addedEmpty}</p>
          ) : (
            <ul className={styles.addedList}>
              {added.map((item, i) => (
                <AddedRow key={`${item.recordId ?? item.name}-${i}`} item={item} />
              ))}
            </ul>
          )}
        </div>
        {problems.length > 0 ? (
          <Notice tone="warning" live compact>
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </Notice>
        ) : null}
        <div className={styles.fileButtons}>
          <input ref={fileInput} type="file" multiple accept={UPLOAD_ACCEPT} className="visually-hidden" tabIndex={-1} aria-label={PLAYGROUND_COPY.addFilesInput} onChange={pick} />
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            {PLAYGROUND_COPY.addFiles}
          </Button>
          <Button variant="secondary" size="sm" aria-expanded={composing} aria-controls={composing ? composerId : undefined} onClick={() => onComposing(!composing)}>
            {PLAYGROUND_COPY.writeTest}
          </Button>
        </div>
        {composing ? <TestEmailComposer id={composerId} onAdd={onAddTestEmail} onCancel={() => onComposing(false)} /> : null}
      </div>
    </section>
  );
}

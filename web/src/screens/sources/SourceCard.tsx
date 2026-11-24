// SourceCard (40 section 13.6; F5): one glass card per source with its name, a status dot, the count of items on
// this computer, progress while indexing, notices and the real connect, disconnect and change actions. Setup step
// 1 (13.3) reuses it with `compact`. Connect and reauthorize run straight from the click (the Google popup and the
// directory picker need the user gesture).
import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { Notice } from '@/components/Notice/Notice';
import { unfinishedPercent } from '@/components/percent';
import { ProgressBar } from '@/components/ProgressBar/ProgressBar';
import { useIndexing } from '@/state/indexing';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { useSources, type SourceRowView } from '@/state/sources';
import { Confirm } from '../settings/kit/Confirm';
import { Fill, Iso } from '../settings/kit/Fill';
import kit from '../settings/kit/kit.module.css';
import { GmailWindow } from './GmailWindow';
import type { RealSource } from './sourcesDb';
import styles from './sources.module.css';

export const UPLOAD_ACCEPT = '.txt,.md,.pdf,.jpg,.jpeg,.png,.webp';
export const UPLOAD_MAX_FILES = 5;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED = /\.(txt|md|pdf|jpe?g|png|webp)$/i;

/** The per-file checks before anything is read: count, size and type (40 sections 13.6 and 13.9). */
export function checkUploads(files: File[]): { ok: File[]; problems: string[] } {
  if (files.length > UPLOAD_MAX_FILES) return { ok: [], problems: [SOURCES.tooManyFiles] };
  const ok: File[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (!SUPPORTED.test(file.name)) problems.push(fillText(SOURCES.fileUnsupported, { name: file.name }));
    else if (file.size > UPLOAD_MAX_BYTES) problems.push(fillText(SOURCES.fileTooBig, { name: file.name }));
    else ok.push(file);
  }
  return { ok, problems };
}

function canPickFolders(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export interface SourceCardProps {
  kind: RealSource;
  row?: SourceRowView;
  itemCount?: number;
  compact?: boolean;
  /**
   * Inside the Sources panel: no card, name, count or progress of its own (the panel has them), only the notices,
   * the errors and the real actions.
   */
  panel?: boolean;
  /** More buttons in the action row (the panel's Pause and Rebuild). */
  actions?: ReactNode;
}

export function SourceCard({ kind, row, itemCount = 0, compact = false, panel = false, actions }: SourceCardProps) {
  const busy = useSources((s) => s.busy[kind] === true);
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const name = SOURCES.names[kind];
  const connected = kind === 'upload' ? Boolean(row?.connected) || itemCount > 0 : Boolean(row?.connected);
  const paused = connected && Boolean(row?.paused);
  // The numbers every bar of this source shows come from useIndexing (one throttled, never-backwards value, 20
  // section 13.4); the row's own progress is the fallback before the indexing state has seen the row.
  const shown = useIndexing((s) => s.bySource[kind]);
  const progress = shown ?? row?.progress ?? { done: 0, total: 0 };
  const fraction = shown ? shown.fraction : progress.total > 0 ? progress.done / progress.total : 0;
  const indexing = connected && !paused && progress.total > 0 && progress.done < progress.total;
  const indexingText = fillText(SOURCES.indexingLabel, { done: formatCount(progress.done), total: formatCount(progress.total) });

  const connect = () => {
    if (kind === 'upload') {
      fileInput.current?.click();
      return;
    }
    // No await before this call: it must run inside the click.
    useSources.getState().connect(kind).catch(console.error);
  };
  const reauthorize = () => {
    if (kind === 'upload') return;
    useSources.getState().reauthorize(kind).catch(console.error);
  };
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const { ok, problems: early } = checkUploads(files);
    setProblems(early);
    if (ok.length === 0) return;
    try {
      const results = await useSources.getState().addFiles('real', ok);
      const failed = results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok).map((r) => r.reason);
      setProblems([...early, ...failed]);
    } catch (error) {
      console.error(error);
    }
  };

  // The status at the top right: a dot in the state colour, the words carry the meaning.
  let status = <span className={`${kit.status} ${kit.muted}`}>{SOURCES.tagNotConnected}</span>;
  if (paused) {
    status = (
      <span className={`${kit.status} ${kit.warn}`}>
        <span className={kit.dot} aria-hidden="true" />
        {SOURCES.tagPaused}
      </span>
    );
  } else if (connected) {
    status = (
      <span className={`${kit.status} ${kit.ok}`}>
        <span className={kit.dot} aria-hidden="true" />
        {kind === 'gmail' ? SOURCES.tagLive : SOURCES.tagConnected}
      </span>
    );
  }

  const folderMissing = kind === 'folder' && !canPickFolders();
  // Gmail asks with a plain note while syncing waits for Continue; the warning is only for Google refusing read-only
  // access after a Continue, and that notice carries the row's error, so it is not shown twice.
  const gmailRefused = kind === 'gmail' && Boolean(row?.needsAuth) && row?.errorCode === 'auth-needed';
  const disconnectBody = `${fillText(SOURCES.disconnectBody, { n: formatCount(itemCount), name })}${
    kind === 'gmail' ? ` ${SOURCES.disconnectGmailExtra}` : ''
  }`;

  const head = (
    <>
      <div className={styles.cardTop}>
        <h2 id={titleId} className={styles.sourceName}>
          {name}
        </h2>
        <span className={styles.statusRow}>
          {indexing ? (
            <span className={`${kit.status} ${kit.accent}`}>
              {fillText(SOURCES.indexingPct, { pct: unfinishedPercent(fraction) })}
            </span>
          ) : null}
          {status}
        </span>
      </div>

      {compact ? null : (
        <div className={styles.count}>
          <span className={kit.bigNumber}>{formatCount(itemCount)}</span>
          <span className={styles.countLabel}>{kind === 'upload' ? fillText(SOURCES.fileCount, { n: formatCount(itemCount) }) : SOURCES.countLabel}</span>
        </div>
      )}

      {indexing ? (
        <>
          <ProgressBar value={fraction} label={indexingText} />
          <p className={styles.meta}>{indexingText}</p>
        </>
      ) : null}
      {connected && paused ? <p className={styles.meta}>{SOURCES.pausedLabel}</p> : null}
      {connected && !paused && !indexing ? (
        <p className={styles.meta}>
          {kind === 'gmail' ? SOURCES.upToDateGmail : SOURCES.upToDate}
          {kind === 'folder' && row?.folderName ? (
            <>
              {' · '}
              <Fill template={SOURCES.folderName} values={{ folderName: <Iso>{row.folderName}</Iso> }} />
            </>
          ) : null}
        </p>
      ) : null}
      {kind === 'upload' && connected && compact ? (
        <p className={styles.meta}>{fillText(SOURCES.fileCount, { n: formatCount(itemCount) })}</p>
      ) : null}

      {compact ? null : <p className={styles.text}>{SOURCES.details[kind]}</p>}

    </>
  );

  const Wrapper = panel ? 'div' : 'article';
  return (
    <Wrapper
      className={panel ? styles.panelBody : compact ? `${kit.glassSm} ${styles.card} ${styles.compact}` : `${kit.glass} ${styles.card}`}
      aria-labelledby={panel ? undefined : titleId}
    >
      {panel ? null : head}

      {row?.needsAuth && kind !== 'upload' ? (
        <Notice
          tone={kind === 'gmail' && !gmailRefused ? 'info' : 'warning'}
          actions={
            <Button variant="secondary" size="sm" onClick={reauthorize} busy={busy}>
              {kind === 'gmail' ? SOURCES.continue : SOURCES.allowAgain}
            </Button>
          }
        >
          {kind === 'gmail' ? (
            gmailRefused ? SOURCES.needsAuthGmailRefused : SOURCES.needsAuthGmail
          ) : (
            <Fill template={SOURCES.needsAuthFolder} values={{ folderName: <Iso>{row.folderName ?? name}</Iso> }} />
          )}
        </Notice>
      ) : null}

      {row?.error && !gmailRefused ? (
        <div className={styles.errorRow}>
          <p className={styles.error}>{row.error}</p>
          {kind !== 'upload' ? (
            <Button variant="secondary" size="sm" onClick={connect} busy={busy}>
              {SOURCES.tryAgain}
            </Button>
          ) : null}
        </div>
      ) : null}

      {kind === 'gmail' && !connected ? (
        <Notice
          tone="info"
          actions={
            canPickFolders() ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  useSources.getState().connect('folder').catch(console.error);
                }}
              >
                {SOURCES.useFolderInstead}
              </Button>
            ) : undefined
          }
        >
          {SOURCES.gmailTesting}
        </Notice>
      ) : null}

      {kind === 'gmail' ? <GmailWindow /> : null}

      {problems.length > 0 ? (
        <div role="status">
          <ul className={styles.problems}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.buttons}>
        {folderMissing && !connected ? (
          <p className={styles.text}>{SOURCES.noFolderPicker}</p>
        ) : !connected || kind === 'upload' ? (
          <Button variant="primary" size="sm" onClick={connect} busy={busy}>
            {SOURCES.connect[kind]}
          </Button>
        ) : null}
        {actions}
        {connected ? (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {SOURCES.disconnect}
          </Button>
        ) : null}
      </div>

      {kind === 'upload' ? (
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onFiles(e)}
        />
      ) : null}

      <Confirm
        open={confirming}
        title={fillText(SOURCES.disconnectTitle, { name })}
        body={disconnectBody}
        confirmLabel={SOURCES.disconnectConfirm}
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await useSources.getState().disconnect(kind);
          } catch (error) {
            console.error(error);
          }
          setConfirming(false);
        }}
      />
    </Wrapper>
  );
}

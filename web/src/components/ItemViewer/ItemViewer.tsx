// ItemViewer (40 section 16.17): one item, opened on the device. Content lives in component state only and is
// dropped on close. Text renders as text; photos show the re-encoded thumbnail, never the original (70 R-UI-09).
import { useEffect, useState } from 'react';
import type { IndexRecord } from '@sieve/shared';
import { PLAYGROUND_SETTINGS, useSettings } from '@/state/settings';
import type { DbKind } from '@/state/types';
import { ITEM_COPY, ITEM_VIEWER_COPY, fill } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { CategoryBadge } from '../CategoryBadge/CategoryBadge';
import { loadIndex, tablesOf } from '../dbTables';
import { Dialog } from '../Dialog/Dialog';
import { senderName } from '../ItemSummary/ItemSummary';
import { Notice } from '../Notice/Notice';
import { Skeleton } from '../Skeleton/Skeleton';
import { Tag } from '../Tag/Tag';
import { formatDate } from '../TimeText/TimeText';
import styles from './ItemViewer.module.css';

export interface ItemViewerProps {
  dbKind: DbKind;
  recordId: string | null;
  onClose(): void;
}

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; record: IndexRecord; thumbUrl?: string };

function useRecord(dbKind: DbKind, recordId: string | null): Loaded {
  // Keyed by the id it was loaded for, so a new id reads as loading without a synchronous reset.
  const [loaded, setLoaded] = useState<{ id: string; value: Loaded } | null>(null);
  useEffect(() => {
    if (!recordId) return undefined;
    let cancelled = false;
    let url: string | undefined;
    (async () => {
      try {
        const { openDb, getRecord } = await loadIndex();
        const db = openDb(dbKind);
        const record = await getRecord(db, recordId);
        if (cancelled) return;
        if (!record) {
          setLoaded({ id: recordId, value: { state: 'missing' } });
          return;
        }
        if (record.kind === 'photo') {
          const row = await tablesOf(db).blobs.get(record.id).catch(() => undefined);
          if (cancelled) return;
          if (row?.thumb instanceof Blob && typeof URL.createObjectURL === 'function') url = URL.createObjectURL(row.thumb);
        }
        setLoaded({ id: recordId, value: { state: 'ready', record, thumbUrl: url } });
      } catch (error) {
        console.error(error);
        if (!cancelled) setLoaded({ id: recordId, value: { state: 'missing' } });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [dbKind, recordId]);
  return loaded && loaded.id === recordId ? loaded.value : { state: 'loading' };
}

export function ItemViewer({ dbKind, recordId, onClose }: ItemViewerProps) {
  const loaded = useRecord(dbKind, recordId);
  const realRules = useSettings((s) => s.settings.categoryRules);
  const rules = dbKind === 'real' ? realRules : PLAYGROUND_SETTINGS.categoryRules;
  const record = loaded.state === 'ready' ? loaded.record : undefined;
  const title = record?.title ?? (loaded.state === 'missing' ? ITEM_VIEWER_COPY.missing : ITEM_VIEWER_COPY.loading);
  return (
    <Dialog
      open={recordId !== null}
      title={title}
      onClose={onClose}
      size="lg"
      initialFocus="close"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {ITEM_VIEWER_COPY.close}
        </Button>
      }
    >
      {loaded.state === 'loading' ? <Skeleton lines={4} /> : null}
      {loaded.state === 'missing' ? <p className={styles.meta}>{ITEM_VIEWER_COPY.missing}</p> : null}
      {record ? (
        <>
          <div className={styles.metaRow}>
            <p className={styles.meta}>
              {record.kind === 'email' && record.from
                ? fill(ITEM_COPY.from, { name: senderName(record.from), date: formatDate(record.date) })
                : formatDate(record.date)}
            </p>
            <CategoryBadge category={record.category} rule={rules[record.category]} />
            <Tag tone="device">{ITEM_VIEWER_COPY.onlyHere}</Tag>
          </div>
          {record.hiddenRemoved.length > 0 ? (
            <Notice tone="warning" title={ITEM_VIEWER_COPY.hiddenTitle}>
              <ul className={styles.fragments}>
                {record.hiddenRemoved.map((fragment, i) => (
                  <li key={i} dir="auto">
                    “{fragment}”
                  </li>
                ))}
              </ul>
              <p>{ITEM_VIEWER_COPY.hiddenBody}</p>
            </Notice>
          ) : null}
          {record.injection?.suspicious ? (
            <Notice tone="warning" title={ITEM_VIEWER_COPY.injectionTitle}>
              {record.injection.quote ? <p dir="auto">“{record.injection.quote}”</p> : null}
            </Notice>
          ) : null}
          {record.kind === 'photo' ? (
            <div className={styles.photo}>
              {loaded.state === 'ready' && loaded.thumbUrl ? (
                <img className={styles.image} src={loaded.thumbUrl} alt={fill(ITEM_VIEWER_COPY.photoAlt, { caption: record.caption ?? record.title })} />
              ) : null}
              {record.caption ? (
                <p className={styles.caption}>
                  <span dir="auto">{record.caption}</span>{' '}
                  {record.captionBy ? <Tag tone={record.captionBy === 'cloud' ? 'cloud' : 'device'}>{ITEM_VIEWER_COPY.captionBy[record.captionBy]}</Tag> : null}
                </p>
              ) : null}
            </div>
          ) : (
            <div className={styles.text} tabIndex={0} role="region" aria-label={ITEM_VIEWER_COPY.textLabel} dir="auto">
              {record.text ?? record.preview}
            </div>
          )}
        </>
      ) : null}
    </Dialog>
  );
}

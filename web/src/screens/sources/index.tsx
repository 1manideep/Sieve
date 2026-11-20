// Sources (40 section 13.6; docs/design/final-flow.md F5): three glass cards in a row, the "Add a source" row, the
// indexing row above them and the categories below. The index lives only on this device.
import { useEffect, useState } from 'react';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { SENTENCE, SOURCES } from '@/copy/screens-controls';
import { TITLES } from '@/copy/strings';
import { useIndexing } from '@/state/indexing';
import { useSettings } from '@/state/settings';
import { useSources } from '@/state/sources';
import { Confirm } from '../settings/kit/Confirm';
import kit from '../settings/kit/kit.module.css';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { CategoryList } from './CategoryList';
import { IndexingCard } from './IndexingCard';
import { SourceCard } from './SourceCard';
import { useDb } from '@/components/dbTables';
import { REAL_SOURCES, useCategoryCounts, useSourceCounts, useSourceRows } from './sourcesDb';
import styles from './sources.module.css';

/**
 * 20 section 15.1: the Sources screen loads Google sign-in on mount, so the Gmail popup opens inside the click.
 * `preloadGis` is called when the sources module exports it (contract change request: export it from @/sources).
 */
function usePreloadGoogleSignIn(): void {
  useEffect(() => {
    let cancelled = false;
    import('@/sources')
      .then((mod: Record<string, unknown>) => {
        const preload = mod.preloadGis;
        if (!cancelled && typeof preload === 'function') (preload as () => Promise<void>)().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
}

export function Component() {
  useDocumentTitle(TITLES.sources);
  usePreloadGoogleSignIn();
  const db = useDb('real');
  const rows = useSourceRows(db);
  const counts = useCategoryCounts(db);
  const sourceCounts = useSourceCounts(db);
  const rules = useSettings((s) => s.settings.categoryRules);
  const paused = useIndexing((s) => s.state === 'paused');
  const pauseBusy = useSources((s) => s.busy.pause === true);
  const rebuildBusy = useSources((s) => s.busy.rebuild === true);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const anyConnected = (rows ?? []).some((r) => r.connected);
  const lastSyncAt = (rows ?? []).reduce<number | undefined>(
    (newest, r) => (r.lastSyncAt !== undefined && (newest === undefined || r.lastSyncAt > newest) ? r.lastSyncAt : newest),
    undefined,
  );

  return (
    <div className={kit.screen}>
      <ScreenHead
        title={SOURCES.heading}
        tryNow
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              busy={pauseBusy}
              disabled={!anyConnected}
              onClick={() => {
                useSources.getState().setPaused(!paused).catch(console.error);
              }}
            >
              {paused ? SOURCES.resume : SOURCES.pause}
            </Button>
            <Button variant="secondary" size="sm" busy={rebuildBusy} disabled={!anyConnected} onClick={() => setConfirmRebuild(true)}>
              {SOURCES.rebuild}
            </Button>
          </>
        }
      />
      {anyConnected ? <IndexingCard lastSyncAt={lastSyncAt} /> : null}
      <section className={styles.sources} aria-label={SOURCES.sourcesLabel}>
        {REAL_SOURCES.map((kind) => (
          <SourceCard key={kind} kind={kind} row={rows?.find((r) => r.kind === kind)} itemCount={sourceCounts?.[kind] ?? 0} />
        ))}
        <p className={`${kit.dashed} ${styles.later}`}>{SOURCES.laterSources}</p>
      </section>
      <aside className={styles.aside} aria-label={SOURCES.categoriesLabel}>
        <CategoryList db={db} counts={counts} rules={rules} />
      </aside>
      <p className={kit.sentence}>{SENTENCE}</p>
      <Confirm
        open={confirmRebuild}
        title={SOURCES.rebuildTitle}
        body={SOURCES.rebuildBody}
        confirmLabel={SOURCES.rebuildConfirm}
        onCancel={() => setConfirmRebuild(false)}
        onConfirm={async () => {
          setConfirmRebuild(false);
          await useSources.getState().rebuild().catch(console.error);
        }}
      />
    </div>
  );
}

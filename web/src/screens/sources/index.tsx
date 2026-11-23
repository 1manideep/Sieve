// Sources (40 section 13.6; design handoff of Nov 20, 2026): the totals on the ground, the sources as a row of bare
// marks, and the grid of what the index holds by category and source. As with the assistants in Settings, no panel
// shows until a mark is pressed: pressing one opens it in one panel in place, and pressing it again closes it. A dot
// on the mark says a source is connected, and turns amber when it needs the person. ?source=gmail (or folder,
// upload) opens that source, and is then removed from the URL. The index lives only on this device.
import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { CATEGORIES, type Category, type CategoryRule } from '@sieve/shared';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button/Button';
import { unfinishedPercent, wholePercent } from '@/components/percent';
import { CATEGORY_COLORS } from '@/components/CategoryIcon/CategoryIcon';
import { useDb } from '@/components/dbTables';
import { SENTENCE, SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { TITLES } from '@/copy/strings';
import { useIndexing, type IndexingState } from '@/state/indexing';
import { sharedItemCount, useReceipts } from '@/state/receipts';
import { useSettings } from '@/state/settings';
import { useSources, type SourceRowView } from '@/state/sources';
import { Confirm } from '../settings/kit/Confirm';
import { Fill, Iso } from '../settings/kit/Fill';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';
import { Mark } from '../settings/kit/Mark';
import { ScreenHead } from '../settings/kit/ScreenHead';
import { formatRelative } from '../settings/kit/when';
import { IndexingCard } from './IndexingCard';
import { LabelExport } from './LabelExport';
import { SourceCard } from './SourceCard';
import { LineIcon, SOURCE_ICONS } from './sourceIcons';
import { SourcesGrid } from './SourcesGrid';
import { REAL_SOURCES, useCategorySplit, useSourceCounts, useSourceRows, type CategorySplit, type RealSource } from './sourcesDb';
import styles from './sources.module.css';

type Later = 'drive' | 'calendar';
type MarkId = RealSource | Later;
const LATER: readonly Later[] = ['drive', 'calendar'];
const LATER_ICONS: Record<Later, string> = {
  drive: 'M8.5 4h7l5 9-3.5 6h-10L3.5 13zM8.5 4l5 9M15.5 4l-5 9M3.5 13h10',
  calendar: 'M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V8A1.5 1.5 0 0 1 5 6.5zM3.5 11h17M8 4v4M16 4v4',
};
const BAR_COLORS: Record<RealSource, string> = { gmail: '#8AB4F8', folder: '#C2D7FE', upload: 'rgba(255, 255, 255, 0.55)' };
const isLater = (id: MarkId): id is Later => id === 'drive' || id === 'calendar';

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

interface SourceState { connected: boolean; paused: boolean; indexing: boolean; background: boolean; needsYou: boolean; pct: number }

/** What one source is doing now, from its row, its count and the indexing numbers every bar shares. */
export function sourceState(kind: RealSource, row: SourceRowView | undefined, count: number, shown: IndexingState['bySource'][RealSource]): SourceState {
  const connected = kind === 'upload' ? Boolean(row?.connected) || count > 0 : Boolean(row?.connected);
  const paused = connected && Boolean(row?.paused);
  const progress = shown ?? row?.progress ?? { done: 0, total: 0 };
  const unfinished = connected && !paused && progress.total > 0 && progress.done < progress.total;
  // Everything it found can be searched: what is left is background model work, which is not "indexing".
  const ready = unfinished && shown?.ready === true;
  const fraction = shown ? (shown.searchFraction < 1 ? shown.searchFraction : shown.fraction) : progress.total > 0 ? progress.done / progress.total : 0;
  return {
    connected,
    paused,
    indexing: unfinished && !ready,
    background: ready,
    needsYou: connected && Boolean(row?.needsAuth || row?.error),
    pct: unfinished ? unfinishedPercent(fraction) : Math.round(fraction * 100),
  };
}

function countText(kind: RealSource, n: number): string {
  return fillText(kind === 'gmail' ? SOURCES.emailCount : kind === 'upload' ? SOURCES.fileCount : SOURCES.itemCount, { n: formatCount(n) });
}

function StatePill({ kind, state }: { kind: RealSource; state: SourceState }) {
  if (!state.connected) return <span className={ground.label}>{SOURCES.tagNotConnected}</span>;
  const busy = state.indexing || state.paused || state.needsYou;
  const text = state.needsYou
    ? SOURCES.markNeedsYou
    : state.paused
      ? SOURCES.tagPaused
      : state.indexing
        ? fillText(SOURCES.indexingPct, { pct: state.pct })
        : kind === 'gmail'
          ? SOURCES.tagLive
          : SOURCES.tagConnected;
  return (
    <span className={`${ground.pill} ${busy ? ground.pillWait : ground.pillOk} ${styles.statePill}`}>
      <span className={ground.pillDot} aria-hidden="true" />
      {text}
    </span>
  );
}

function SourcePanel({
  kind, row, count, state, split, rules, paused, onRebuild,
}: {
  kind: RealSource; row?: SourceRowView; count: number; state: SourceState; split?: CategorySplit;
  rules: Record<Category, CategoryRule>; paused: boolean; onRebuild(): void;
}) {
  const describePhotos = useSettings((s) => s.describePhotos);
  const indexingState = useIndexing((s) => s.state);
  const pauseBusy = useSources((s) => s.busy.pause === true);
  const rebuildBusy = useSources((s) => s.busy.rebuild === true);
  const titleId = useId();
  const photoId = useId();
  const photoHelpId = useId();
  const name = SOURCES.names[kind];
  const holds = split ? CATEGORIES.filter((c) => split[c][kind] > 0).sort((a, b) => split[b][kind] - split[a][kind]) : [];

  let meta;
  if (!state.connected) meta = <span className={ground.plead}>{SOURCES.details[kind]}</span>;
  else if (kind === 'gmail') {
    meta = (
      <span className={ground.pmeta}>
        {countText(kind, count)}
        {' · '}
        {state.paused ? SOURCES.pausedLabel : SOURCES.upToDateGmail}
        {row?.lastSyncAt !== undefined ? ` · ${fillText(SOURCES.metaSynced, { when: formatRelative(row.lastSyncAt) })}` : ''}
      </span>
    );
  } else if (kind === 'folder') {
    meta = (
      <span className={ground.pmeta}>
        {countText(kind, count)}
        {row?.folderName ? (
          <>
            {' · '}
            <Fill template={SOURCES.folderName} values={{ folderName: <Iso>{row.folderName}</Iso> }} />
          </>
        ) : null}
        {` · ${SOURCES.metaOnDevice}`}
      </span>
    );
  } else {
    meta = <span className={ground.pmeta}>{`${countText(kind, count)} · ${SOURCES.details.upload}`}</span>;
  }

  return (
    <article className={ground.panel} aria-labelledby={titleId}>
      <div className={ground.ph}>
        <span className={state.connected ? styles.panelGlyph : `${styles.panelGlyph} ${styles.glyphOff}`}>
          <LineIcon d={SOURCE_ICONS[kind]} size={30} />
        </span>
        <span className={ground.pt}>
          <h3 id={titleId} className={ground.pn}>
            {state.connected ? name : fillText(SOURCES.connectTitle, { name })}
          </h3>
          {meta}
        </span>
        <StatePill kind={kind} state={state} />
      </div>
      <div className={ground.cols}>
        <div className={ground.col}>
          {state.connected && holds.length > 0 && split ? (
            <div className={ground.grp}>
              <span className={ground.label}>{SOURCES.holdsLabel}</span>
              <ul className={ground.chips}>
                {holds.map((c) => (
                  <li key={c} className={rules[c] === 'never' ? `${ground.chip} ${ground.chipNever}` : ground.chip}>
                    <span className={ground.swatch} style={{ background: CATEGORY_COLORS[c] }} aria-hidden="true" />
                    {c}
                    <span className={ground.chipCount}>{formatCount(split[c][kind])}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.connected ? (
            <div className={ground.grp}>
              <span className={ground.label}>{SOURCES.readLabel}</span>
              <p>{SOURCES.details[kind]}</p>
            </div>
          ) : null}
          {kind === 'folder' ? (
            <div className={ground.switchRow}>
              <span className={ground.switchText}>
                <span id={photoId}>{SOURCES.describePhotos}</span>
                <span id={photoHelpId}>{SOURCES.describePhotosHelp}</span>
              </span>
              <button
                type="button"
                role="switch"
                className={ground.switch}
                aria-checked={describePhotos}
                aria-labelledby={photoId}
                aria-describedby={photoHelpId}
                onClick={() => {
                  useSettings.getState().setDescribePhotos(!describePhotos).catch(console.error);
                }}
              />
            </div>
          ) : null}
        </div>
        <div className={ground.col}>
          {state.connected && indexingState !== 'idle' && (state.indexing || state.background || state.paused || paused) ? <IndexingCard plain lastSyncAt={row?.lastSyncAt} /> : null}
          <SourceCard
            kind={kind}
            row={row}
            itemCount={count}
            panel
            actions={
              state.connected && kind !== 'upload' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    busy={pauseBusy}
                    onClick={() => {
                      useSources.getState().setPaused(!paused).catch(console.error);
                    }}
                  >
                    {paused ? SOURCES.resume : SOURCES.pause}
                  </Button>
                  <Button variant="secondary" size="sm" busy={rebuildBusy} onClick={onRebuild}>
                    {SOURCES.rebuild}
                  </Button>
                </>
              ) : undefined
            }
          />
        </div>
      </div>
    </article>
  );
}

function LaterPanel({ id }: { id: Later }) {
  const titleId = useId();
  const { name, lead } = SOURCES.later[id];
  return (
    <article className={ground.panel} aria-labelledby={titleId}>
      <div className={ground.ph}>
        <span className={`${styles.panelGlyph} ${styles.glyphOff}`}>
          <LineIcon d={LATER_ICONS[id]} size={30} />
        </span>
        <span className={ground.pt}>
          <h3 id={titleId} className={ground.pn}>
            {name}
          </h3>
          <span className={ground.plead}>{lead}</span>
        </span>
        <span className={ground.label}>{SOURCES.markLater}</span>
      </div>
      <div className={ground.grp}>
        <span className={ground.label}>{SOURCES.laterLabel}</span>
        <p>{fillText(SOURCES.laterText, { name })}</p>
      </div>
    </article>
  );
}

export function Component() {
  useDocumentTitle(TITLES.sources);
  usePreloadGoogleSignIn();
  const db = useDb('real');
  const rows = useSourceRows(db);
  const split = useCategorySplit(db);
  const sourceCounts = useSourceCounts(db);
  const rules = useSettings((s) => s.settings.categoryRules);
  const indexing = useIndexing(useShallow((s) => ({ state: s.state, left: s.left, bySource: s.bySource, ready: s.ready, searchLeft: s.searchLeft })));
  const receipts = useReceipts((s) => s.receipts);
  // The open source: none until a mark is pressed.
  const [selected, setSelected] = useState<MarkId | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  // ?source=gmail opens that source, once; then the param is removed (the hash and any other param stay).
  const named = REAL_SOURCES.find((k) => k === params.get('source'));
  const [handled, setHandled] = useState<RealSource | undefined>(undefined);
  if (named !== handled) {
    setHandled(named);
    if (named) setSelected(named);
  }
  useEffect(() => {
    if (!named) return;
    const next = new URLSearchParams(params);
    next.delete('source');
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [named, params, location.hash, navigate]);

  // Pressing the open mark closes it; pressing another opens that one instead.
  const select = (id: MarkId) => setSelected(id === selected ? null : id);

  const paused = indexing.state === 'paused';
  const rowOf = (kind: RealSource) => rows?.find((r) => r.kind === kind);
  const countOf = (kind: RealSource) => sourceCounts?.[kind] ?? 0;
  const states = Object.fromEntries(REAL_SOURCES.map((k) => [k, sourceState(k, rowOf(k), countOf(k), indexing.bySource[k])])) as Record<RealSource, SourceState>;
  const connected = REAL_SOURCES.filter((k) => states[k].connected);

  const items = REAL_SOURCES.reduce((n, k) => n + countOf(k), 0);
  const never = Math.max(0, items - sharedItemCount(receipts));
  const categories = split ? CATEGORIES.filter((c) => REAL_SOURCES.some((k) => split[c][k] > 0)).length : 0;

  let pill = null;
  if (connected.length > 0) {
    const busy = indexing.state !== 'idle';
    // Ready: every item can be searched, and only the background model work is left.
    const ready = busy && indexing.ready && !paused;
    const toSearch = indexing.searchLeft > 0 ? indexing.searchLeft : indexing.left;
    pill = (
      <span className={`${ground.pill} ${busy && !ready ? ground.pillWait : ground.pillOk}`} role="status">
        <span className={ground.pillDot} aria-hidden="true" />
        {paused ? SOURCES.pillPaused : ready ? SOURCES.pillReady : busy ? SOURCES.pillIndexing : SOURCES.pillUpToDate}
        <span className={ground.pillMuted}>
          {'· '}
          {ready
            ? fillText(SOURCES.pillBackground, { left: formatCount(indexing.left) })
            : busy
              ? fillText(SOURCES.pillLeft, { left: formatCount(indexing.ready ? indexing.left : toSearch) })
              : fillText(SOURCES.pillItems, { n: formatCount(items) })}
        </span>
      </span>
    );
  }

  return (
    <div className={kit.screen}>
      <ScreenHead title={SOURCES.heading} tryNow actions={pill} />

      <section className={`${ground.totals} ${styles.totals}`} aria-label={SOURCES.totalsLabel}>
        <div>
          <span className={ground.big}>{formatCount(items)}</span>
          <span className={ground.totalLabel}>{SOURCES.statItems}</span>
        </div>
        <div>
          <div className={ground.splitBar} aria-hidden="true">
            {items > 0 ? REAL_SOURCES.filter((k) => countOf(k) > 0).map((k) => <span key={k} style={{ width: `${(countOf(k) / items) * 100}%`, background: BAR_COLORS[k] }} />) : null}
          </div>
          <div className={ground.legend}>
            {REAL_SOURCES.map((k) => (
              <span key={k}>
                <span className={ground.swatch} style={{ background: BAR_COLORS[k] }} aria-hidden="true" />
                {SOURCES.names[k]} <b>{formatCount(countOf(k))}</b>
              </span>
            ))}
          </div>
          <span className={ground.totalLabel}>{SOURCES.statBySource}</span>
        </div>
        <div>
          <span className={ground.big}>{formatCount(categories)}</span>
          <span className={ground.totalLabel}>{SOURCES.statCategories}</span>
        </div>
        <div>
          <span className={`${ground.big} ${ground.bigAccent}`}>{formatCount(never)}</span>
          <span className={ground.totalLabel}>{fillText(SOURCES.statNever, { pct: items > 0 ? wholePercent(never, items) : 100 })}</span>
        </div>
      </section>

      <section className={ground.sec} aria-labelledby="sources-heading">
        <div className={ground.secHead}>
          <h2 id="sources-heading" className={ground.h2}>
            {SOURCES.sourcesLabel}
          </h2>
          <p className={ground.secNote}>{connected.length > 0 ? fillText(SOURCES.sourcesNote, { n: connected.length }) : SOURCES.sourcesNoteNone}</p>
        </div>
        <ul className={ground.marks} aria-label={SOURCES.sourcesLabel}>
          {REAL_SOURCES.map((k) => {
            const s = states[k];
            const sub = !s.connected
              ? k === 'upload'
                ? SOURCES.markAdd
                : SOURCES.markConnect
              : s.needsYou
                ? SOURCES.markNeedsYou
                : s.paused
                  ? SOURCES.tagPaused
                  : s.indexing
                    ? fillText(SOURCES.indexingPct, { pct: s.pct })
                    : countText(k, countOf(k));
            return (
              <Mark
                key={k}
                glyph={
                  <>
                    <LineIcon d={SOURCE_ICONS[k]} size={34} />
                    {s.connected ? <span className={ground.markState} data-tone={s.needsYou ? 'warn' : 'ok'} aria-hidden="true" /> : null}
                  </>
                }
                name={SOURCES.names[k]}
                sub={sub}
                off={!s.connected}
                pressed={selected === k}
                onPress={() => select(k)}
              />
            );
          })}
          {LATER.map((id) => (
            <Mark
              key={id}
              glyph={<LineIcon d={LATER_ICONS[id]} size={34} />}
              name={SOURCES.later[id].name}
              sub={SOURCES.markLater}
              off
              pressed={selected === id}
              onPress={() => select(id)}
            />
          ))}
        </ul>
        {selected === null ? null : isLater(selected) ? (
          <LaterPanel id={selected} />
        ) : (
          <SourcePanel
            key={selected}
            kind={selected}
            row={rowOf(selected)}
            count={countOf(selected)}
            state={states[selected]}
            split={split}
            rules={rules}
            paused={paused}
            onRebuild={() => setConfirmRebuild(true)}
          />
        )}
      </section>

      <SourcesGrid db={db} split={split} sourceCounts={sourceCounts} rules={rules} />
      {params.get('tool') === 'labels' ? <LabelExport db={db} /> : null}

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

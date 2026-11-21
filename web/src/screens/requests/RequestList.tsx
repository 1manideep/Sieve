// RequestList (40 section 13.5; F11 since Nov 20): every request in one searchable list. Waiting requests are
// pinned on top, the rest are grouped by day, newest first, 20 per group with "Show more". Outcome and assistant
// chips filter; the search box matches the question. Rows select through ?id=; the keyboard moves the selection
// (up and down, or j and k), A approves and D declines the selected waiting request, "/" focuses the search.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RequestStatus } from '@sieve/shared';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { ASSISTANTS, assistantKindOf, type AssistantKind } from '@/components/AssistantMark/assistants';
import { Chip } from '@/components/Chip/Chip';
import { Icon } from '@/components/icons';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import { useHomeBase, type PendingEntry } from '@/state/homeBase';
import type { RelayRequestView } from '@/state/types';
import { formatClock, formatDate, isoTime } from '../settings/kit/when';
import { phaseTag } from './labels';
import { statusLabel } from './labels';
import styles from './requests.module.css';

export type Outcome = 'waiting' | 'answered' | 'nothing' | 'declined';

export interface ListRow {
  id: string;
  live?: PendingEntry;
  request: RelayRequestView;
  outcome: Outcome;
  label: string;
  createdAt: number;
  kind: AssistantKind;
}

const STATUS_OUTCOME: Record<RequestStatus, Outcome> = {
  queued: 'waiting', claimed: 'waiting', 'awaiting-person': 'waiting',
  answered: 'answered', collected: 'answered',
  declined: 'declined',
  blocked: 'nothing', 'no-match': 'nothing', unsupported: 'nothing', expired: 'nothing', revoked: 'nothing', offline: 'nothing', error: 'nothing',
};

function liveOutcome(entry: PendingEntry): Outcome {
  if (entry.phase !== 'done') return 'waiting';
  const r = entry.result;
  if (!r) return 'waiting';
  if (r.kind === 'sent') return 'answered';
  if (r.kind === 'declined') return 'declined';
  return 'nothing';
}

/** The live entries first (by id), then the history rows the entries do not cover, as one list. */
export function buildRows(entries: PendingEntry[], recent: RelayRequestView[]): ListRow[] {
  const rows: ListRow[] = entries.map((e) => ({
    id: e.requestId,
    live: e,
    request: e.request,
    outcome: liveOutcome(e),
    label: phaseTag(e).label,
    createdAt: e.request.createdAt,
    kind: assistantKindOf(e.request.requester.aiName),
  }));
  const seen = new Set(rows.map((r) => r.id));
  for (const r of recent) {
    if (seen.has(r.id)) continue;
    rows.push({ id: r.id, request: r, outcome: STATUS_OUTCOME[r.status], label: statusLabel(r), createdAt: r.createdAt, kind: assistantKindOf(r.requester.aiName) });
  }
  return rows;
}

export interface Filters { query: string; outcome: Outcome | null; assistant: AssistantKind | null }

export function applyFilters(rows: ListRow[], f: Filters): ListRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.outcome === null || r.outcome === f.outcome) &&
      (f.assistant === null || r.kind === f.assistant) &&
      (q === '' || r.request.question.toLowerCase().includes(q) || r.request.requester.aiName.toLowerCase().includes(q)),
  );
}

export interface Group { key: string; label: string; rows: ListRow[]; waiting: boolean }

const DAY_MS = 24 * 3_600_000;

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Waiting rows pinned on top (oldest first, as they should be handled), then the days, newest first. */
export function groupRows(rows: ListRow[], now: number): Group[] {
  const waiting = rows.filter((r) => r.outcome === 'waiting').sort((a, b) => a.createdAt - b.createdAt);
  const rest = rows.filter((r) => r.outcome !== 'waiting').sort((a, b) => b.createdAt - a.createdAt);
  const groups: Group[] = [];
  if (waiting.length > 0) groups.push({ key: 'waiting', label: REQUESTS.groupWaiting, rows: waiting, waiting: true });
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY_MS);
  let current: Group | undefined;
  for (const r of rest) {
    const key = dayKey(r.createdAt);
    if (!current || current.key !== key) {
      const label = key === today ? REQUESTS.groupToday : key === yesterday ? REQUESTS.groupYesterday : formatDate(r.createdAt, now);
      current = { key, label, rows: [], waiting: false };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

export const PAGE = 20;

const OUTCOME_CHIPS: { outcome: Outcome; label: string }[] = [
  { outcome: 'waiting', label: REQUESTS.chipWaiting },
  { outcome: 'answered', label: REQUESTS.chipAnswered },
  { outcome: 'nothing', label: REQUESTS.chipNothing },
  { outcome: 'declined', label: REQUESTS.chipDeclined },
];

const OUTCOME_ICON: Record<Outcome, Parameters<typeof Icon>[0]['name']> = {
  waiting: 'clock',
  answered: 'check',
  nothing: 'ban',
  declined: 'close',
};

export interface RequestListProps {
  entries: PendingEntry[];
  recent: RelayRequestView[];
  readOnly: RelayRequestView[];
  readOnlyLabel: string;
  selectedId?: string;
  now: number;
}

export function RequestList({ entries, recent, readOnly, readOnlyLabel, selectedId, now }: RequestListProps) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({ query: '', outcome: null, assistant: null });
  const [shown, setShown] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const rows = useMemo(() => buildRows(entries, [...readOnly, ...recent]), [entries, readOnly, recent]);
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupRows(filtered, now), [filtered, now]);
  const assistants = useMemo(() => Array.from(new Set(rows.map((r) => r.kind))), [rows]);
  const visible = groups.flatMap((g) => (g.waiting ? g.rows : g.rows.slice(0, shown[g.key] ?? PAGE)));
  const filtering = filters.query.trim() !== '' || filters.outcome !== null || filters.assistant !== null;
  const noneWaiting = !rows.some((r) => r.outcome === 'waiting');

  const select = (id: string) => navigate({ search: `?id=${encodeURIComponent(id)}` }, { replace: true });

  // "/" anywhere on the screen focuses the search, unless the person is typing somewhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const i = visible.findIndex((r) => r.id === selectedId);
    const move = (next: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, next))];
      if (row) {
        select(row.id);
        document.getElementById(`request-row-${row.id}`)?.focus();
      }
    };
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(i + 1); return; }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(i - 1); return; }
    const sel = i >= 0 ? visible[i] : undefined;
    const live = sel?.live;
    if (!live || live.phase !== 'awaiting-person') return;
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      void useHomeBase.getState().decide({ requestId: live.requestId, approved: true, step: live.request.requestedStep, decidedBy: 'app' });
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      void useHomeBase.getState().decide({ requestId: live.requestId, approved: false, decidedBy: 'app' });
    }
  };

  return (
    <section className={`${styles.listPane}`} aria-label={REQUESTS.listLabel}>
      <div className={styles.listTools}>
        <label htmlFor={searchId} className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <span className="visually-hidden">{REQUESTS.searchLabel}</span>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            className={styles.searchInput}
            placeholder={REQUESTS.searchPlaceholder}
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
          <kbd className={styles.kbd} aria-hidden="true">/</kbd>
        </label>
        <div role="group" aria-label={REQUESTS.outcomeLabel} className={styles.chips}>
          {OUTCOME_CHIPS.map((c) => (
            <Chip key={c.outcome} selected={filters.outcome === c.outcome} onClick={() => setFilters((f) => ({ ...f, outcome: f.outcome === c.outcome ? null : c.outcome }))}>
              {c.label}
            </Chip>
          ))}
        </div>
        {assistants.length > 1 ? (
          <div role="group" aria-label={REQUESTS.assistantLabel} className={styles.chips}>
            {assistants.map((k) => (
              <Chip key={k} selected={filters.assistant === k} onClick={() => setFilters((f) => ({ ...f, assistant: f.assistant === k ? null : k }))}>
                {ASSISTANTS[k].name}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={listRef} className={styles.listBody}>
        {noneWaiting && !filtering ? (
          <div className={styles.noneWaiting}>
            <span className={styles.noneWaitingTitle}>{REQUESTS.noneWaitingTitle}</span>
            <span className={styles.noneWaitingBody}>{REQUESTS.noneWaitingBody}</span>
          </div>
        ) : null}
        {groups.length > 0 ? (
          <div role="listbox" aria-label={REQUESTS.listLabel} tabIndex={-1} className={styles.listRows} onKeyDown={onListKey}>
            {groups.map((g) => {
              const limit = g.waiting ? g.rows.length : (shown[g.key] ?? PAGE);
              const page = g.rows.slice(0, limit);
              const more = g.rows.length - page.length;
              return (
                <div key={g.key} role="group" aria-label={`${g.label}, ${g.rows.length}`} className={styles.group}>
                  <div className={styles.groupHead} aria-hidden="true">
                    <span className={g.waiting ? `${styles.groupLabel} ${styles.groupWaiting}` : styles.groupLabel}>{g.label}</span>
                    <span className={styles.groupCount}>{g.rows.length}</span>
                  </div>
                  {page.map((r) => {
                    const selected = r.id === selectedId;
                    const readOnlyRow = !r.live && readOnly.some((x) => x.id === r.id);
                    return (
                      <button
                        key={r.id}
                        id={`request-row-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
                        data-outcome={r.outcome}
                        onClick={() => select(r.id)}
                      >
                        <AssistantMark kind={r.kind} size={22} />
                        <span className={styles.rowQuestion} dir="auto">
                          {r.request.question}
                        </span>
                        <span className={styles.rowOutcome} title={readOnlyRow ? readOnlyLabel : r.label}>
                          <Icon name={OUTCOME_ICON[r.outcome]} size={16} />
                          <span className="visually-hidden">{readOnlyRow ? readOnlyLabel : r.label}</span>
                        </span>
                        <time className={styles.rowTime} dateTime={isoTime(r.createdAt)}>
                          {formatClock(r.createdAt)}
                        </time>
                      </button>
                    );
                  })}
                  {more > 0 ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className={styles.showMore}
                      onClick={() => setShown((prev) => ({ ...prev, [g.key]: limit + PAGE }))}
                    >
                      {fillText(REQUESTS.showMore, { n: Math.min(more, PAGE) })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {filtered.length === 0 && filtering ? (
          <div className={styles.listEmpty}>
            <span className={styles.noneWaitingTitle}>{REQUESTS.noMatchTitle}</span>
            <button type="button" className={styles.clearFilters} onClick={() => setFilters({ query: '', outcome: null, assistant: null })}>
              {REQUESTS.clearFilters}
            </button>
          </div>
        ) : null}
      </div>
      <p className={styles.keysHint} aria-hidden="true">
        {REQUESTS.keysHint}
      </p>
    </section>
  );
}

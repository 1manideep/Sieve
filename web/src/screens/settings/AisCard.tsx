// "Assistants" (40 sections 13.8.1 to 13.8.3 and 13.8.9; design handoff of Nov 20, 2026): a row of bare assistant
// marks, in colour when that assistant has a live connection and grey when it has none. No panel shows until a mark
// is pressed. Pressing one opens it in one panel in place, and pressing it again closes it: a live assistant shows
// what it can get, its expiry, the Auto-approve answers switch, Change limits and Revoke; an assistant with no
// connection shows the connect steps (ConnectPanel). ?connect=1 opens the first assistant that is not connected,
// and is then removed from the URL.
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { ASSISTANT_KINDS, ASSISTANTS, assistantKindOf, type AssistantKind } from '@/components/AssistantMark/assistants';
import { Button } from '@/components/Button/Button';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { SETTINGS, SOURCES, fillText } from '@/copy/screens-controls';
import { useAutoApprove } from '@/state/autoApprove';
import { useGrants } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import { CATEGORIES } from '@sieve/shared';
import { LineIcon, SOURCE_ICONS } from '../sources/sourceIcons';
import { REAL_SOURCES, type RealSource } from '../sources/sourcesDb';
import { CAP_LABELS, CAP_NOTES } from './Choice';
import { ConnectPanel, type LinkState } from './ConnectPanel';
import { Confirm } from './kit/Confirm';
import ground from './kit/ground.module.css';
import kit from './kit/kit.module.css';
import { formatClock, formatDate, formatRelative } from './kit/when';
import { NarrowDialog } from './NarrowDialog';
import { callableMessage, categoriesLabel } from './settingsText';
import styles from './settings.module.css';

const DAY_MS = 86_400_000;

/** "Link ends in …7Q2F · made Nov 12 · last used 4 minutes ago". */
export function grantMeta(g: GrantView, now: number = Date.now()): string {
  return fillText(SETTINGS.panelMeta, {
    hint: g.linkHint,
    date: formatDate(g.createdAt, now),
    used: g.lastUsedAt !== undefined ? fillText(SETTINGS.usedLower, { when: formatRelative(g.lastUsedAt, now) }) : SETTINGS.neverUsedLower,
  });
}

/** "22 days left", "1 day left", "Expires today". */
export function daysLeftText(g: GrantView, now: number): string {
  const left = Math.max(0, Math.ceil((g.expiresAt - now) / DAY_MS));
  return left === 0 ? SETTINGS.expiresToday : left === 1 ? SETTINGS.dayLeft : fillText(SETTINGS.daysLeft, { n: left });
}

function GrantPanel({ grant, now, autoUntil, onNarrow }: { grant: GrantView; now: number; autoUntil?: number; onNarrow(): void }) {
  const rules = useSettings((s) => s.settings.categoryRules);
  const online = useNetwork((s) => s.online);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const autoId = useId();
  const autoNoteId = useId();
  const span = Math.max(1, grant.expiresAt - grant.createdAt);
  const pct = Math.max(0, Math.min(100, Math.round(((grant.expiresAt - now) / span) * 100)));
  const left = daysLeftText(grant, now);
  const auto = autoUntil !== undefined;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const revoke = async () => {
    setBusy(true);
    useAutoApprove.getState().turnOff(grant.id);   // at once, whatever the call returns
    try {
      await useGrants.getState().revoke(grant.id);
      useToasts.getState().push({ tone: 'success', title: fillText(SETTINGS.revoked, { aiName: grant.aiName }) });
    } catch (e) {
      useToasts.getState().push({ tone: 'error', title: callableMessage(e, online) });
    }
    setBusy(false);
    setConfirming(false);
  };

  return (
    <article className={ground.panel} aria-labelledby={titleId}>
      <div className={ground.ph}>
        <AssistantMark kind={assistantKindOf(grant.aiName)} size={44} />
        <span className={ground.pt}>
          <h3 id={titleId} className={ground.pn}>
            <bdi>{grant.aiName}</bdi>
          </h3>
          <span className={ground.pmeta}>{grantMeta(grant, now)}</span>
        </span>
        {auto ? <span className={styles.autoPill}>{fillText(SETTINGS.autoApproveUntil, { time: formatClock(autoUntil) })}</span> : null}
      </div>
      <div className={ground.cols}>
        <div className={ground.col}>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.whatItCanGet}</span>
            <span className={`${ground.chip} ${ground.chipOn}`}>{CAP_LABELS[grant.maxStep]}</span>
            <p>
              {CAP_NOTES[grant.maxStep]} {SETTINGS.narrowNote}
            </p>
          </div>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.categories}</span>
            <ul className={ground.chips}>
              <li className={`${ground.chip} ${ground.chipOn}`}>{categoriesLabel(grant.allowedCategories)}</li>
              {CATEGORIES.filter((c) => rules[c] === 'never').map((c) => (
                <li key={c} className={`${ground.chip} ${ground.chipNever}`}>
                  {fillText(SETTINGS.neverChip, { category: c })}
                </li>
              ))}
            </ul>
          </div>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.sources}</span>
            <ul className={ground.chips}>
              {REAL_SOURCES.filter((k) => grant.allowedSources.includes(k)).map((k) => (
                <li key={k} className={`${ground.chip} ${ground.chipOn}`}>
                  <LineIcon d={SOURCE_ICONS[k]} size={15} />
                  {SOURCES.names[k]}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className={ground.col}>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.expires}</span>
            <p className={styles.expires}>
              <span>{formatDate(grant.expiresAt, now)}</span>
              <span className={grant.state === 'expiring' ? kit.warn : undefined}>{grant.state === 'expiring' ? fillText(SETTINGS.expiresSoon, { left }) : left}</span>
            </p>
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
          <div className={ground.switchRow}>
            <span className={ground.switchText}>
              <span id={autoId}>{SETTINGS.autoApprove}</span>
              <span id={autoNoteId}>{SETTINGS.autoApproveNote}</span>
            </span>
            <button
              type="button"
              role="switch"
              className={ground.switch}
              aria-checked={auto}
              aria-labelledby={autoId}
              aria-describedby={autoNoteId}
              onClick={() => (auto ? useAutoApprove.getState().turnOff(grant.id) : useAutoApprove.getState().turnOn(grant.id))}
            />
          </div>
          {confirming ? (
            <div ref={confirmRef} tabIndex={-1} className={styles.confirm} role="group" aria-label={fillText(SETTINGS.revokeTitle, { aiName: grant.aiName })}>
              <p className={styles.confirmTitle}>
                <bdi>{fillText(SETTINGS.revokeTitle, { aiName: grant.aiName })}</bdi>
              </p>
              <p className={kit.small}>{SETTINGS.revokeBody}</p>
              <div className={ground.actions}>
                <Button variant="danger" size="sm" busy={busy} disabled={busy} onClick={() => void revoke()}>
                  {SETTINGS.revokeConfirm}
                </Button>
                <button type="button" className={kit.textButton} onClick={() => setConfirming(false)}>
                  {SETTINGS.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className={ground.actions}>
              <Button variant="secondary" size="sm" onClick={onNarrow}>
                {SETTINGS.narrow}
              </Button>
              <button type="button" className={`${kit.textButton} ${kit.never}`} onClick={() => setConfirming(true)}>
                {SETTINGS.revoke}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function AisCard({ connected }: { connected: RealSource[] }) {
  const { status, grants } = useGrants(useShallow((s) => ({ status: s.status, grants: s.grants })));
  const autoUntil = useAutoApprove((s) => s.until);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [now] = useState(() => Date.now());
  // The open assistant: none until a mark is pressed.
  const [selected, setSelected] = useState<AssistantKind | null>(null);
  // While a connector link is on screen its panel stays, even though the new connection is already live.
  const [link, setLink] = useState<{ kind: AssistantKind; state: LinkState } | null>(null);
  // Where a press would go while a link is not copied yet: another assistant, or none (the open one pressed again).
  const [leaving, setLeaving] = useState<{ to: AssistantKind | null } | null>(null);
  const [narrowing, setNarrowing] = useState<GrantView | null>(null);

  const current = grants.filter((g) => g.state === 'active' || g.state === 'expiring');
  const live = ASSISTANT_KINDS.filter((k) => current.some((g) => assistantKindOf(g.aiName) === k));

  // ?connect=1 opens the first assistant with no connection, once; then the param is removed (the hash stays).
  const wantsConnect = params.get('connect') === '1';
  const [handledConnect, setHandledConnect] = useState(false);
  if (wantsConnect !== handledConnect) {
    setHandledConnect(wantsConnect);
    if (wantsConnect) setSelected(ASSISTANT_KINDS.find((k) => !live.includes(k)) ?? 'other');
  }
  useEffect(() => {
    if (!wantsConnect) return;
    const next = new URLSearchParams(params);
    next.delete('connect');
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [wantsConnect, params, location.hash, navigate]);

  // Pressing the open assistant closes it; pressing another opens that one instead.
  const select = (kind: AssistantKind) => {
    const next = kind === selected ? null : kind;
    if (link?.state === 'uncopied') setLeaving({ to: next });
    else {
      setLink(null);
      setSelected(next);
    }
  };

  const autoNames = current.filter((g) => autoUntil[g.id] !== undefined);
  const lastAuto = autoNames.reduce((latest, g) => Math.max(latest, autoUntil[g.id] ?? 0), 0);
  const note =
    current.length === 0
      ? SETTINGS.aisNoteNone
      : autoNames.length > 0
        ? fillText(SETTINGS.aisNoteAuto, { n: current.length, names: autoNames.map((g) => g.aiName).join(', '), time: formatClock(lastAuto) })
        : fillText(SETTINGS.aisNote, { n: current.length });

  let panel;
  if (selected === null) {
    panel = null;
  } else if (status === 'idle' || status === 'loading') {
    panel = (
      <div className={ground.panel} aria-busy="true">
        <span className="visually-hidden">{SETTINGS.aisLoading}</span>
        <Skeleton lines={3} />
      </div>
    );
  } else if (status === 'error') {
    panel = <p className={`${ground.panel} ${kit.text}`}>{SETTINGS.aisError}</p>;
  } else if (!live.includes(selected) || link?.kind === selected) {
    panel = <ConnectPanel key={selected} kind={selected} connected={connected} onLinkChange={(state) => setLink(state === 'none' ? null : { kind: selected, state })} />;
  } else {
    panel = current
      .filter((g) => assistantKindOf(g.aiName) === selected)
      .map((g) => <GrantPanel key={g.id} grant={g} now={now} autoUntil={autoUntil[g.id]} onNarrow={() => setNarrowing(g)} />);
  }

  return (
    <ErrorBoundary>
      <section id="ais" className={ground.sec} aria-labelledby="ais-heading">
        <div className={ground.secHead}>
          <h2 id="ais-heading" className={ground.h2} tabIndex={-1}>
            {SETTINGS.aisHeading}
          </h2>
          <p className={ground.secNote}>{note}</p>
        </div>
        <ul className={ground.marks} aria-label={SETTINGS.marksLabel}>
          {ASSISTANT_KINDS.map((kind) => {
            const isLive = live.includes(kind);
            const auto = current.some((g) => assistantKindOf(g.aiName) === kind && autoUntil[g.id] !== undefined);
            return (
              <li key={kind}>
                <button type="button" className={isLive ? ground.mark : `${ground.mark} ${ground.markOff}`} aria-pressed={selected === kind} onClick={() => select(kind)}>
                  <span className={ground.markGlyph}>
                    <AssistantMark kind={kind} size={56} />
                  </span>
                  <span className={ground.markName}>{ASSISTANTS[kind].name}</span>
                  <span className={ground.markSub}>{isLive ? (auto ? SETTINGS.markLiveAuto : SETTINGS.markLive) : SETTINGS.markSubConnect}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {panel}
        <NarrowDialog grant={narrowing} onClose={() => setNarrowing(null)} />
        <Confirm
          open={leaving !== null}
          title={SETTINGS.closeTitle}
          body={SETTINGS.closeBody}
          confirmLabel={SETTINGS.closeConfirm}
          cancelLabel={SETTINGS.closeCancel}
          onCancel={() => setLeaving(null)}
          onConfirm={() => {
            setLink(null);
            setSelected(leaving?.to ?? null);
            setLeaving(null);
          }}
        />
      </section>
    </ErrorBoundary>
  );
}

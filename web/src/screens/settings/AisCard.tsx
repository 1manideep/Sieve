// "Assistants" (40 sections 13.8.1 to 13.8.3; F5B since Nov 20): a row of assistant marks at the top, in colour
// when that assistant has a live connection and grey when it has none. Pressing a live mark shows only its
// connections below (each as a glass card with its state, its limits, Change limits, Revoke and the Auto-approve
// answers switch of 13.8.9); pressing it again shows every connection. Pressing a grey mark opens the Connect
// dialog with that assistant's name filled in. Past connections stay under a disclosure; the blue "Connect an
// assistant" button opens the dialog (also opened by ?connect=1, which is then removed from the URL).
import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { ASSISTANT_KINDS, ASSISTANTS, assistantKindOf, type AssistantKind } from '@/components/AssistantMark/assistants';
import { Button } from '@/components/Button/Button';
import { Icon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { useAutoApprove } from '@/state/autoApprove';
import { useGrants } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import type { RealSource } from '../sources/sourcesDb';
import { ConnectAiDialog } from './ConnectAiDialog';
import { Confirm } from './kit/Confirm';
import kit from './kit/kit.module.css';
import { formatClock, formatDate, formatRelative } from './kit/when';
import { NarrowDialog } from './NarrowDialog';
import { SettingsCard } from './SettingsCard';
import { callableMessage, capLabel, categoriesLabel, sourcesLabel } from './settingsText';
import styles from './settings.module.css';

const STATE_TAGS: Record<GrantView['state'], { label: string; className: string }> = {
  active: { label: SETTINGS.grantActive, className: kit.ok },
  expiring: { label: SETTINGS.grantExpiring, className: kit.warn },
  expired: { label: SETTINGS.grantExpired, className: kit.muted },
  revoked: { label: SETTINGS.grantRevoked, className: kit.muted },
};

export function grantLimits(g: GrantView): string {
  return fillText(SETTINGS.limits, {
    cap: capLabel(g.maxStep),
    categories: categoriesLabel(g.allowedCategories),
    sources: sourcesLabel(g.allowedSources),
  });
}

export function grantMeta(g: GrantView, now: number = Date.now()): string {
  return fillText(SETTINGS.meta, {
    date: formatDate(g.expiresAt, now),
    used: g.lastUsedAt !== undefined ? fillText(SETTINGS.lastUsed, { when: formatRelative(g.lastUsedAt, now) }) : SETTINGS.neverUsed,
    hint: g.linkHint,
  });
}

interface GrantRowProps {
  grant: GrantView;
  onNarrow?(): void;
  onRevoke?(): void;
  /** When auto-approve ends for this connection; undefined when it is off. */
  autoUntil?: number;
  onAutoApprove?(on: boolean): void;
}

function GrantRow({ grant, onNarrow, onRevoke, autoUntil, onAutoApprove }: GrantRowProps) {
  const tag = STATE_TAGS[grant.state];
  const noteId = useId();
  const live = grant.state === 'active' || grant.state === 'expiring';
  return (
    <li className={`${kit.glassSm} ${styles.grantRow}`}>
      <div className={styles.grantTop}>
        <div className={styles.grantHead}>
          <AssistantMark kind={assistantKindOf(grant.aiName)} size={28} live={live} />
          <p className={styles.grantName}>
            <bdi>{grant.aiName}</bdi>
          </p>
        </div>
        <span className={`${kit.status} ${tag.className}`}>{tag.label}</span>
      </div>
      <p className={styles.grantLimits}>{grantLimits(grant)}</p>
      <p className={styles.grantMeta}>{grantMeta(grant)}</p>
      {onNarrow && onRevoke ? (
        <div className={styles.grantActions}>
          <Button variant="secondary" size="sm" onClick={onNarrow}>
            {SETTINGS.narrow}
          </Button>
          <button type="button" className={`${kit.textButton} ${kit.never}`} onClick={onRevoke}>
            {SETTINGS.revoke}
          </button>
          {onAutoApprove ? (
            <label className={styles.choice}>
              <input
                type="checkbox"
                role="switch"
                checked={autoUntil !== undefined}
                aria-describedby={noteId}
                onChange={(e) => onAutoApprove(e.target.checked)}
              />
              <span className={styles.choiceLabel}>{SETTINGS.autoApprove}</span>
            </label>
          ) : null}
        </div>
      ) : null}
      {onAutoApprove && autoUntil !== undefined ? (
        <div className={styles.inline}>
          <p className={styles.warnText}>{fillText(SETTINGS.autoApproveUntil, { time: formatClock(autoUntil) })}</p>
          <button type="button" className={kit.textButton} onClick={() => onAutoApprove(false)}>
            {SETTINGS.autoApproveStop}
          </button>
        </div>
      ) : null}
      {onAutoApprove ? (
        <p id={noteId} className={styles.note}>
          {SETTINGS.autoApproveNote}
        </p>
      ) : null}
    </li>
  );
}

/** The marks row: every kind Sieve knows, live when a current connection maps to it. */
function MarksRow({
  live,
  auto,
  selected,
  onSelect,
  onConnect,
}: {
  live: Set<AssistantKind>;
  auto: Set<AssistantKind>;
  selected: AssistantKind | null;
  onSelect(kind: AssistantKind | null): void;
  onConnect(kind: AssistantKind): void;
}) {
  return (
    <ul className={styles.marks} aria-label={SETTINGS.marksLabel}>
      {ASSISTANT_KINDS.map((kind) => {
        const spec = ASSISTANTS[kind];
        const isLive = live.has(kind);
        const stateText = isLive ? (auto.has(kind) ? SETTINGS.markLiveAuto : SETTINGS.markLive) : SETTINGS.markNotConnected;
        const name = isLive
          ? fillText(selected === kind ? SETTINGS.markShowAll : SETTINGS.markShow, { name: spec.name })
          : fillText(SETTINGS.markConnect, { name: spec.name });
        return (
          <li key={kind}>
            <button
              type="button"
              className={styles.mark}
              aria-label={`${spec.name}, ${stateText}. ${name}`}
              aria-pressed={isLive ? selected === kind : undefined}
              onClick={() => (isLive ? onSelect(selected === kind ? null : kind) : onConnect(kind))}
            >
              <AssistantMark kind={kind} size={44} live={isLive} />
              <span className={styles.markName}>{spec.name}</span>
              <span className={`${styles.markState} ${isLive ? styles.on : ''}`}>
                {isLive ? <span className={styles.markDot} aria-hidden="true" /> : null}
                {stateText}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AisCard({ connected }: { connected: RealSource[] }) {
  const { status, grants } = useGrants(useShallow((s) => ({ status: s.status, grants: s.grants })));
  const autoUntil = useAutoApprove((s) => s.until);
  const online = useNetwork((s) => s.online);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectName, setConnectName] = useState('');
  const [narrowing, setNarrowing] = useState<GrantView | null>(null);
  const [revoking, setRevoking] = useState<GrantView | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [selected, setSelected] = useState<AssistantKind | null>(null);
  const pastId = useId();

  // ?connect=1 opens the dialog once, then the param is removed from the URL (the hash stays).
  const wantsConnect = params.get('connect') === '1';
  const [handledConnect, setHandledConnect] = useState(false);
  if (wantsConnect !== handledConnect) {
    setHandledConnect(wantsConnect);
    if (wantsConnect) {
      setConnectName('');
      setConnectOpen(true);
    }
  }
  useEffect(() => {
    if (!wantsConnect) return;
    const next = new URLSearchParams(params);
    next.delete('connect');
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [wantsConnect, params, location.hash, navigate]);

  const current = grants.filter((g) => g.state === 'active' || g.state === 'expiring');
  const past = grants.filter((g) => g.state === 'expired' || g.state === 'revoked');
  const live = new Set(current.map((g) => assistantKindOf(g.aiName)));
  const auto = new Set(current.filter((g) => autoUntil[g.id] !== undefined).map((g) => assistantKindOf(g.aiName)));
  // A selected kind that lost its last connection falls back to every connection.
  const shown = selected !== null && live.has(selected) ? current.filter((g) => assistantKindOf(g.aiName) === selected) : current;

  const openConnect = (name: string) => {
    setConnectName(name);
    setConnectOpen(true);
  };

  const revoke = async (grant: GrantView) => {
    useAutoApprove.getState().turnOff(grant.id);   // at once, whatever the call returns
    try {
      await useGrants.getState().revoke(grant.id);
      useToasts.getState().push({ tone: 'success', title: fillText(SETTINGS.revoked, { aiName: grant.aiName }) });
    } catch (e) {
      useToasts.getState().push({ tone: 'error', title: callableMessage(e, online) });
    }
    setRevoking(null);
  };

  let body;
  if (status === 'idle' || status === 'loading') {
    body = (
      <div className={`${kit.glassSm} ${styles.emptyRow}`} aria-busy="true">
        <span className="visually-hidden">{SETTINGS.aisLoading}</span>
        <Skeleton lines={2} />
        <Skeleton lines={2} />
      </div>
    );
  } else if (status === 'error') {
    body = <p className={`${kit.glassSm} ${styles.emptyRow} ${kit.text}`}>{SETTINGS.aisError}</p>;
  } else {
    body = (
      <>
        {current.length === 0 ? (
          <p className={`${kit.glassSm} ${styles.emptyRow} ${kit.text}`}>{SETTINGS.aisEmpty}</p>
        ) : (
          <ul className={styles.grantList}>
            {shown.map((g) => (
              <GrantRow
                key={g.id}
                grant={g}
                onNarrow={() => setNarrowing(g)}
                onRevoke={() => setRevoking(g)}
                autoUntil={autoUntil[g.id]}
                onAutoApprove={(on) => (on ? useAutoApprove.getState().turnOn(g.id) : useAutoApprove.getState().turnOff(g.id))}
              />
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <div>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={pastOpen}
              aria-controls={pastId}
              onClick={() => setPastOpen((v) => !v)}
            >
              <Icon name={pastOpen ? 'chevron-down' : 'chevron-right'} size={16} />
              {fillText(SETTINGS.past, { n: past.length })}
            </button>
            <ul id={pastId} className={styles.grantList} hidden={!pastOpen}>
              {past.map((g) => (
                <GrantRow key={g.id} grant={g} />
              ))}
            </ul>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <SettingsCard id="ais" title={SETTINGS.aisHeading} bare>
      <MarksRow live={live} auto={auto} selected={selected} onSelect={setSelected} onConnect={(kind) => openConnect(kind === 'other' ? '' : ASSISTANTS[kind].name)} />
      {body}
      <Button variant="primary" tone="blue" size="lg" className={styles.connect} onClick={() => openConnect('')}>
        {SETTINGS.connectAi}
      </Button>
      <p className={kit.help}>{SETTINGS.aisSub}</p>
      <ConnectAiDialog open={connectOpen} onClose={() => setConnectOpen(false)} connected={connected} initialName={connectName} />
      <NarrowDialog grant={narrowing} onClose={() => setNarrowing(null)} />
      <Confirm
        open={revoking !== null}
        title={fillText(SETTINGS.revokeTitle, { aiName: revoking?.aiName ?? '' })}
        body={SETTINGS.revokeBody}
        confirmLabel={SETTINGS.revokeConfirm}
        tone="danger"
        onCancel={() => setRevoking(null)}
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
      />
    </SettingsCard>
  );
}

// Status strip and its popover (40 section 8). Driven by useNetwork, useHomeBase, useAvailability and useIndexing.
// layout="card" is the Nano meter at the bottom of the rail (docs/design/final-flow.md, F3): the same button and
// popover, drawn as a card with "Gemini Nano · ready", the index row and a thin progress bar. While auto-approve is
// on for any connection (40 section 13.8.9), "Auto-approve on" shows under it as a link to Settings.
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { env } from '@/app/env';
import { defaultDeviceLabel } from '@/app/deviceId';
import { RAIL, STATUS, STATUS_POPOVER } from '@/copy/strings';
import { useAutoApprove } from '@/state/autoApprove';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { useNetwork } from '@/state/network';
import { useSources } from '@/state/sources';
import { Button, LinkButton } from '../Button/Button';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { statusModel, type PopoverRow, type StatusAction, type StatusInput, type Tone } from './statusModel';
import styles from './StatusStrip.module.css';

export interface StatusStripProps {
  /** Show the extension row; defaults to whether VITE_EXTENSION_ID is set. */
  extensionEnabled?: boolean;
  /** pill (default) or the rail's meter card. */
  layout?: 'pill' | 'card';
}

const TONE_CLASS: Record<Tone, string> = {
  teal: styles.teal,
  amber: styles.amber,
  neutral: styles.neutral,
};

function extensionUrl(): string {
  return env.extensionStoreUrl ?? `${env.repoUrl}#extension`;
}

interface CardRow { label: string; word: string; tone: Tone }

function nanoRow(a: StatusInput['availability']): CardRow {
  const row = (word: string, tone: Tone): CardRow => ({ label: RAIL.nano, word, tone });
  if (a.setup.state === 'downloading' || a.setup.state === 'installing') return row(RAIL.nanoSettingUp(Math.round((a.setup.fraction ?? 0) * 100)), 'amber');
  switch (a.text) {
    case 'available': return row(RAIL.nanoReady, 'teal');
    case 'downloading': return row(RAIL.nanoDownloading, 'amber');
    case 'downloadable': return row(RAIL.nanoNotSetUp, 'amber');
    case 'checking': return row(RAIL.nanoChecking, 'neutral');
    case 'unavailable':
    case 'no-api':
      return row(RAIL.nanoNone, 'amber');
  }
}

function secondRow(input: Pick<StatusInput, 'online' | 'homeBase' | 'indexing'>): CardRow {
  const i = input.indexing;
  if (i.state === 'running') return { label: RAIL.index, word: RAIL.indexing(i.total > 0 ? Math.round((i.done / i.total) * 100) : 0), tone: 'neutral' };
  if (i.state === 'yielding') return { label: RAIL.index, word: RAIL.indexingYielding, tone: 'neutral' };
  if (i.state === 'paused') return { label: RAIL.index, word: RAIL.indexingPaused, tone: 'amber' };
  const row = (word: string, tone: Tone): CardRow => ({ label: RAIL.homeBase, word, tone });
  if (!input.online) return row(RAIL.offline, 'amber');
  const { role, presence, waitingForClick } = input.homeBase;
  switch (role) {
    case 'active':
      if (waitingForClick) return row(RAIL.homeBaseNeedsClick, 'amber');
      if (presence === 'online') return row(RAIL.homeBaseOnline, 'teal');
      if (presence === 'offline') return row(RAIL.offline, 'amber');
      return row(RAIL.homeBaseStarting, 'neutral');
    case 'standby': return row(RAIL.homeBaseStandby, 'neutral');
    case 'other-device': return row(RAIL.homeBaseOther, 'neutral');
    case 'starting': return row(RAIL.homeBaseStarting, 'neutral');
    default: return row(RAIL.homeBaseOff, 'neutral');
  }
}

export function StatusStrip({ extensionEnabled = Boolean(env.extensionId), layout = 'pill' }: StatusStripProps) {
  const online = useNetwork((s) => s.online);
  const homeBase = useHomeBase(
    useShallow((s) => ({
      role: s.role,
      presence: s.presence,
      homeBaseLabel: s.homeBaseLabel,
      waitingForClick: s.waitingForClick,
      extension: s.extension,
    })),
  );
  const availability = useAvailability(useShallow((s) => ({ text: s.text, setup: s.setup })));
  const indexing = useIndexing(
    useShallow((s) => ({ state: s.state, left: s.left, done: s.done, total: s.total, etaMs: s.etaMs })),
  );
  const autoApprove = useAutoApprove((s) => Object.keys(s.until).length > 0);
  const model = statusModel({ online, homeBase, availability, indexing, extensionEnabled, autoApprove });
  const card = layout === 'card';

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const popoverId = useId();
  const headingId = useId();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open) return undefined;
    headingRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        pillRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (kind: StatusAction) => {
    const report = (error: unknown) => console.error(error);
    switch (kind) {
      case 'make-home-base':
        useHomeBase.getState().makeThisHomeBase(defaultDeviceLabel()).catch(report);
        break;
      case 'stop-home-base':
        useHomeBase.getState().stopBeingHomeBase().catch(report);
        break;
      case 'use-this-tab':
        useHomeBase.getState().useThisTab().catch(report);
        break;
      case 'set-up-model':
        setOpen(false);
        navigate(`/prepare?back=${encodeURIComponent(location.pathname + location.search)}`);
        break;
      case 'show-progress':
        setOpen(false);
        navigate('/prepare');
        break;
      case 'cloud-fallback':
        setOpen(false);
        navigate('/settings#cloud');
        break;
      case 'pause-indexing':
        useSources.getState().setPaused(true).catch(report);
        break;
      case 'resume-indexing':
        useSources.getState().setPaused(false).catch(report);
        break;
      case 'get-extension':
        break;
    }
  };

  const renderAction = (row: PopoverRow) => {
    if (!row.action) return null;
    if (row.action.kind === 'get-extension') {
      return (
        <LinkButton to={extensionUrl()} external variant="secondary" size="sm">
          {row.action.label}
        </LinkButton>
      );
    }
    const kind = row.action.kind;
    return (
      <Button variant="secondary" size="sm" onClick={() => run(kind)}>
        {row.action.label}
      </Button>
    );
  };

  const renderCard = () => {
    const first = nanoRow(availability);
    const second = secondRow({ online, homeBase, indexing });
    const fraction = indexing.state === 'running' && indexing.total > 0 ? indexing.done / indexing.total : undefined;
    return (
      <>
        <span className={styles.cardRow}>
          <span>{first.label}</span>
          <span className={`${styles.word} ${TONE_CLASS[first.tone]}`}>{first.word}</span>
        </span>
        <span className={styles.cardRow}>
          <span>{second.label}</span>
          <span className={`${styles.word} ${TONE_CLASS[second.tone]}`}>{second.word}</span>
        </span>
        {fraction !== undefined ? (
          <span className={styles.bar}>
            <span className={styles.barFill} style={{ width: `${Math.round(fraction * 100)}%` }} />
          </span>
        ) : null}
      </>
    );
  };

  return (
    <div className={card ? styles.wrapCard : styles.wrap} ref={wrapRef}>
      <button
        ref={pillRef}
        type="button"
        className={card ? styles.card : `${styles.pill} ${TONE_CLASS[model.tone]}`}
        aria-label={model.accessibleName}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        {card ? renderCard() : (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.text}>{model.text}</span>
          </>
        )}
      </button>
      {autoApprove ? (
        <Link to="/settings#ais" className={styles.auto}>
          {STATUS.autoApproveOn}
        </Link>
      ) : null}
      {open ? (
        <div id={popoverId} className={card ? `${styles.popover} ${styles.popoverUp}` : styles.popover} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
            {STATUS_POPOVER.heading}
          </h2>
          <ul className={styles.rows}>
            {model.rows.map((row) => (
              <li key={row.id} className={`${styles.row} ${TONE_CLASS[row.tone]}`}>
                <span className={styles.dot} aria-hidden="true" />
                <div className={styles.rowBody}>
                  <h3 className={styles.rowTitle}>{row.title}</h3>
                  <p className={styles.sentence}>{row.sentence}</p>
                  {row.progress ? (
                    <ProgressBar
                      label={STATUS_POPOVER.indexingProgress}
                      value={row.progress.total > 0 ? row.progress.done / row.progress.total : undefined}
                    />
                  ) : null}
                  {row.action || row.sourcesLink ? (
                    <div className={styles.rowActions}>
                      {renderAction(row)}
                      {row.sourcesLink ? (
                        <Link to="/sources" className={styles.link} onClick={() => setOpen(false)}>
                          {STATUS_POPOVER.sourcesLink}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

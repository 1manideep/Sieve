// Status strip and its popover (40 section 8). Driven by useNetwork, useHomeBase, useAvailability and useIndexing.
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { env } from '@/app/env';
import { defaultDeviceLabel } from '@/app/deviceId';
import { STATUS_POPOVER } from '@/copy/strings';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { useNetwork } from '@/state/network';
import { useSources } from '@/state/sources';
import { Button, LinkButton } from '../Button/Button';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import { statusModel, type PopoverRow, type StatusAction, type Tone } from './statusModel';
import styles from './StatusStrip.module.css';

export interface StatusStripProps {
  /** Show the extension row; defaults to whether VITE_EXTENSION_ID is set. */
  extensionEnabled?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  teal: styles.teal,
  amber: styles.amber,
  neutral: styles.neutral,
};

function extensionUrl(): string {
  return env.extensionStoreUrl ?? `${env.repoUrl}#extension`;
}

export function StatusStrip({ extensionEnabled = Boolean(env.extensionId) }: StatusStripProps) {
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
  const model = statusModel({ online, homeBase, availability, indexing, extensionEnabled });

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
      case 'open-playground':
        setOpen(false);
        navigate('/playground');
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

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={pillRef}
        type="button"
        className={`${styles.pill} ${TONE_CLASS[model.tone]}`}
        aria-label={model.accessibleName}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>{model.text}</span>
      </button>
      {open ? (
        <div id={popoverId} className={styles.popover} role="dialog" aria-labelledby={headingId}>
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

// AuditBadge (40 section 13.7): the hash-chained log check from useAudit, as a button with a short explanation.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { Button } from '@/components/Button/Button';
import { Icon, type IconName } from '@/components/icons';
import { SEEN, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { useAudit } from '@/state/audit';
import { Fill } from '../settings/kit/Fill';
import { formatRelative, isoTime } from '../settings/kit/when';
import styles from './seen.module.css';

type Tone = 'neutral' | 'device' | 'never';

export function AuditBadge() {
  const { state, entries, checkedAt, brokenAt } = useAudit(
    useShallow((s) => ({ state: s.state, entries: s.entries, checkedAt: s.checkedAt, brokenAt: s.brokenAt })),
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  let tone: Tone = 'neutral';
  let icon: IconName | undefined;
  let label: string = SEEN.auditChecking;
  let sub: ReactNode = null;
  if (state === 'intact' && (entries ?? 0) === 0) {
    label = SEEN.auditNoActivity;
  } else if (state === 'intact') {
    tone = 'device';
    icon = 'check';
    label = SEEN.auditIntact;
    if (checkedAt !== undefined) {
      sub = (
        <Fill
          template={SEEN.auditIntactSub}
          values={{
            n: formatCount(entries ?? 0),
            when: <time dateTime={isoTime(checkedAt)}>{formatRelative(checkedAt)}</time>,
          }}
        />
      );
    }
  } else if (state === 'broken') {
    tone = 'never';
    icon = 'warning';
    label = fillText(SEEN.auditBroken, { n: formatCount(brokenAt ?? 0) });
    sub = SEEN.auditBrokenSub;
  } else if (state === 'unavailable') {
    label = SEEN.auditUnavailable;
  }

  const toneClass = tone === 'device' ? styles.badgeDevice : tone === 'never' ? styles.badgeNever : styles.badgeNeutral;

  return (
    <div className={styles.audit} ref={wrapRef}>
      <div className={styles.auditRow}>
        <button
          ref={buttonRef}
          type="button"
          className={`${styles.badge} ${toneClass}`}
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={() => setOpen((v) => !v)}
        >
          {icon ? <Icon name={icon} size={16} /> : null}
          {label}
        </button>
        {state === 'unavailable' ? (
          <Button variant="secondary" size="sm" onClick={() => void useAudit.getState().check().catch(console.error)}>
            {SEEN.tryAgain}
          </Button>
        ) : null}
      </div>
      {sub ? <p className={styles.auditSub}>{sub}</p> : null}
      <div id={popoverId} className={styles.popover} hidden={!open}>
        {SEEN.auditPopover}
      </div>
    </div>
  );
}

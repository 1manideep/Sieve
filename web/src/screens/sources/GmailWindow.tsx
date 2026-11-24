// "Read email from": how far back Gmail is indexed (Nov 24, 2026). Shown on the Gmail card before and after Gmail is
// connected, so a person can pick a short window before the first sync. sources/gmail/window.ts applies the choice.
import { useId, useState, type ChangeEvent } from 'react';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { GMAIL_WINDOW_CHOICES, readGmailWindowDays } from '@/state/gmailWindow';
import { useSources } from '@/state/sources';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';
import styles from './sources.module.css';

const DEFAULT = 'default';

function choiceLabel(days: number): string {
  if (days === 180) return SOURCES.windowSixMonths;
  if (days === 365) return SOURCES.windowYear;
  return fillText(SOURCES.windowDays, { days: String(days) });
}

export function GmailWindow() {
  const selectId = useId();
  const helpId = useId();
  const [days, setDays] = useState<number | undefined>(() => readGmailWindowDays());
  const [status, setStatus] = useState<string>('');
  const busy = useSources((s) => s.busy.gmail === true);

  const onChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value === DEFAULT ? undefined : Number(e.target.value);
    const before = days;
    setDays(next);
    setStatus('');
    try {
      const removed = await useSources.getState().setGmailWindow(next);
      setStatus(removed > 0 ? fillText(SOURCES.windowTrimmed, { count: formatCount(removed) }) : SOURCES.windowSaved);
    } catch (error) {
      console.error(error);
      setDays(before);
    }
  };

  return (
    <div className={ground.grp}>
      <label htmlFor={selectId} className={kit.label}>
        {SOURCES.windowLabel}
      </label>
      <select
        id={selectId}
        className={kit.select}
        value={days === undefined ? DEFAULT : String(days)}
        aria-describedby={helpId}
        disabled={busy}
        onChange={(e) => void onChange(e)}
      >
        <option value={DEFAULT}>{SOURCES.windowDefault}</option>
        {GMAIL_WINDOW_CHOICES.map((d) => (
          <option key={d} value={String(d)}>
            {choiceLabel(d)}
          </option>
        ))}
      </select>
      <p id={helpId} className={styles.text}>
        {SOURCES.windowHelp}
      </p>
      {status ? (
        <p className={styles.text} role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

// "Try it on a real computer" (80 sections 1 and 7): a link to /try with one line under it, shown only while the
// seat broker's GET /health succeeds and hidden after two failures in a row. Rendered by the Playground strip and
// the landing page. Inside a seat (the kiosk opens /playground?seat=1 or ?seat=2) it never shows.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TRY } from '@/copy/screens-controls';
import { LinkButton } from '../Button/Button';
import { HEALTH_FAILURES_TO_HIDE, HEALTH_POLL_MS, checkHealth } from './broker';
import styles from './TryOnRealComputer.module.css';

const SEAT_KEY = 'sieve.seat';

/** A seat number as the kiosk sends it: ?seat=1, ?seat=2, ... (80 section 5.9). */
function isSeatParam(value: string | null): boolean {
  return value !== null && /^[1-9][0-9]?$/.test(value);
}

/** True on a demo computer seat: ?seat=N once, remembered for the tab. */
export function inSeat(search: string): boolean {
  try {
    if (isSeatParam(new URLSearchParams(search).get('seat'))) window.sessionStorage.setItem(SEAT_KEY, '1');
    return window.sessionStorage.getItem(SEAT_KEY) === '1';
  } catch {
    return isSeatParam(new URLSearchParams(search).get('seat'));
  }
}

/** Polls GET /health while enabled. Starts hidden; one success shows it; two failures in a row hide it again. */
export function useSeatHealth(enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctl: AbortController | undefined;

    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), HEALTH_POLL_MS);
    };
    const tick = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      inFlight = true;
      ctl = new AbortController();
      try {
        await checkHealth(ctl.signal);
        failures = 0;
        if (!stopped) setVisible(true);
      } catch {
        failures += 1;
        if (!stopped && failures >= HEALTH_FAILURES_TO_HIDE) setVisible(false);
      } finally {
        inFlight = false;
      }
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
  return enabled && visible;
}

export interface TryOnRealComputerProps {
  variant?: 'primary' | 'secondary';
  className?: string;
}

export function TryOnRealComputer({ variant = 'secondary', className }: TryOnRealComputerProps) {
  const { search } = useLocation();
  const seat = useMemo(() => inSeat(search), [search]);
  const visible = useSeatHealth(!seat);
  if (!visible) return null;
  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <LinkButton to="/try" variant={variant} size="sm">
        {TRY.button}
      </LinkButton>
      <p className={styles.line}>{TRY.line}</p>
    </div>
  );
}

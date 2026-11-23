// A request the home base is still preparing (50 section 8.4, since Nov 23): who asked and the question, the step it
// is on, how long since it was asked and what is usual, what happens next, and why it is slow when it is, with Open
// Sieve when bringing the tab forward helps. The others being prepared are listed under the main card; a row opens
// the Sieve tab at that request. Never a spinner: the step line and the counting line say it is alive.
import { useEffect, useId, useState } from 'react';
import { WAITING, WAITING_SLOW_MS, waitTime } from '@sieve/shared';
import type { PreparingView } from '../../shared/internal';
import { beingPreparedHeading, COPY } from '../../shared/labels';
import s from '../ui.module.css';
import { RequesterLine } from './RequestCard';

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Why it is slow, in the shared words: a first click, a background tab, or past a minute. */
export function slowLine(item: Pick<PreparingView, 'wait'>, elapsed: number): string | null {
  if (item.wait === 'click') return WAITING.click;
  if (item.wait === 'hidden') return WAITING.hidden;
  return elapsed > WAITING_SLOW_MS ? WAITING.busy : null;
}

export function PreparingCard({ item, onOpenApp }: { item: PreparingView; onOpenApp(): void }) {
  const headingId = useId();
  const now = useNow(1_000);
  const elapsed = Math.max(0, now - item.since);
  const slow = slowLine(item, elapsed);
  return (
    <article className={s.card} aria-labelledby={headingId} aria-busy="true" data-testid="preparing">
      <h2 id={headingId} className={s.h2}>
        {COPY.preparing.heading}
      </h2>
      <RequesterLine aiName={item.aiName} question={item.question} />
      <p className={s.status} role="status">
        <span className={`${s.dot} ${s.dotWait}`} aria-hidden="true" />
        <span dir="auto">{item.label ?? COPY.preparing.starting}</span>
      </p>
      <p className={s.body}>{WAITING.asked(waitTime(elapsed))}</p>
      <p className={s.body}>{item.auto ? WAITING.nextAuto : WAITING.nextApprove}</p>
      {slow ? <p className={s.note}>{slow}</p> : null}
      {item.wait ? (
        <div className={s.actions}>
          <button type="button" className={`${s.btnWhite} ${s.grow}`} onClick={onOpenApp}>
            {COPY.openSieve}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function BeingPrepared({ items, onOpen }: { items: PreparingView[]; onOpen(requestId: string): void }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className={s.list} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.listLabel}>
        {beingPreparedHeading(items.length)}
      </h3>
      <ul className={s.rows}>
        {items.map((p) => (
          <li key={p.requestId}>
            <button type="button" className={s.row} onClick={() => onOpen(p.requestId)}>
              <bdi>{p.aiName}</bdi>: <span dir="auto">{`"${p.question}"`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Gmail access on the home base's computer ran out: one line, and the way to the tab that can reconnect it. */
export function GmailEnded({ onOpenApp }: { onOpenApp(): void }) {
  return (
    <section className={s.outcome} aria-label={COPY.gmail.label} data-testid="gmail-ended">
      <p className={s.body}>{COPY.gmail.ended}</p>
      <div className={s.actions}>
        <button type="button" className={`${s.btnOutline} ${s.grow}`} onClick={onOpenApp}>
          {COPY.gmail.reconnect}
        </button>
      </div>
    </section>
  );
}

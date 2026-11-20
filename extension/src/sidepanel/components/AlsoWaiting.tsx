// The other waiting requests (50 section 8.3): a mono label and one glass row each; clicking a row selects it.
import { useId } from 'react';
import type { ProposalPreview } from '@sieve/shared';
import { alsoWaitingHeading, requesterName } from '../../shared/labels';
import s from '../ui.module.css';

export function AlsoWaiting({ proposals, onSelect }: { proposals: ProposalPreview[]; onSelect(requestId: string): void }) {
  const headingId = useId();
  if (proposals.length === 0) return null;
  return (
    <section className={s.list} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.listLabel}>
        {alsoWaitingHeading(proposals.length)}
      </h3>
      <ul className={s.rows}>
        {proposals.map((p) => (
          <li key={p.requestId}>
            <button type="button" className={s.row} onClick={() => onSelect(p.requestId)}>
              <bdi>{requesterName(p.requester)}</bdi>: <span dir="auto">{`"${p.question}"`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

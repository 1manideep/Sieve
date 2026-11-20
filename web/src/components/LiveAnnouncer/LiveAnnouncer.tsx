// Live announcer (40 section 7.6): two visually hidden live regions, polite and assertive.
import { useAnnouncer } from '@/state/announcer';

export function LiveAnnouncer() {
  const polite = useAnnouncer((s) => s.polite);
  const assertive = useAnnouncer((s) => s.assertive);
  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {assertive}
      </div>
    </>
  );
}

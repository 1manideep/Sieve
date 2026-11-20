// RelayResult (40 section 16.14): the line shown after a relay request ends. The lines come from
// shared/src/copy.ts, so the extension uses the same words. The line takes focus after a decision (40 section 14.1).
import { RESULT_LINES, type Category } from '@sieve/shared';
import type { PendingEntry } from '@/state/homeBase';
import { RELAY_RESULT_COPY } from '@/copy/screens-main';
import { Button, LinkButton } from '../Button/Button';
import styles from './RelayResult.module.css';

export interface RelayResultProps {
  result: PendingEntry['result'];
  aiName: string;
  stepPhrase: string;
  category?: Category;
  onDone(): void;
}

export function relayResultLine(result: NonNullable<PendingEntry['result']>, aiName: string, stepPhrase: string, category?: Category): string {
  switch (result.kind) {
    case 'sent':
      return RESULT_LINES.sent({ aiName, stepPhrase });
    case 'declined':
      return RESULT_LINES.declined({ aiName });
    case 'auto':
      if (result.status === 'blocked') return RESULT_LINES.blocked({ aiName, category: (category ?? 'This category') as Category });
      if (result.status === 'no-match') return RESULT_LINES.noMatch({ aiName });
      return RESULT_LINES.error({ aiName });
    case 'ended':
      return result.status === 'expired' ? RESULT_LINES.expired() : RESULT_LINES.revoked({ aiName });
  }
}

export function RelayResult({ result, aiName, stepPhrase, category, onDone }: RelayResultProps) {
  if (!result) return null;
  return (
    <div className={styles.result}>
      <p className={styles.line} tabIndex={-1} data-result-line data-kind={result.kind}>
        {relayResultLine(result, aiName, stepPhrase, category)}
      </p>
      <div className={styles.actions}>
        {result.kind === 'sent' ? (
          <LinkButton to="/seen" variant="ghost" size="sm">
            {RELAY_RESULT_COPY.seeReceipts}
          </LinkButton>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onDone}>
          {RELAY_RESULT_COPY.done}
        </Button>
      </div>
    </div>
  );
}

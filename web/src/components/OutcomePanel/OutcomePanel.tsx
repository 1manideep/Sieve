// OutcomePanel (40 section 16.14): what the person sees when a proposal is not ready to approve.
import type { ReactNode } from 'react';
import type { Category, ProposalOutcome } from '@sieve/shared';
import { OUTCOME_COPY, fill } from '@/copy/screens-main';
import { Button, LinkButton } from '../Button/Button';
import { Notice, type NoticeTone } from '../Notice/Notice';
import styles from './OutcomePanel.module.css';

export type OutcomePanelOutcome = Exclude<ProposalOutcome, 'ready' | 'needs-cloud-consent'>;

export interface OutcomePanelProps {
  outcome: OutcomePanelOutcome;
  category?: Category;
  /** blocked-never because the item holds a one-time code or a sign-in link (11 section 5.2), not because of its category. */
  secret?: boolean;
  /** unsupported because it asks for several things, or the answer held several facts (10 section 12.4), not a count. */
  oneFact?: boolean;
  variant: 'real' | 'playground';
  onRetry?(): void;
}

export function outcomeTitle(outcome: OutcomePanelOutcome, category?: Category, secret = false, oneFact = false): string {
  switch (outcome) {
    case 'blocked-never':
      return secret ? OUTCOME_COPY.secretTitle : fill(OUTCOME_COPY.blockedTitle, { category: category ?? '' }).trim();
    case 'no-match':
      return OUTCOME_COPY.noMatchTitle;
    case 'unsupported':
      return oneFact ? OUTCOME_COPY.oneFactTitle : OUTCOME_COPY.countsTitle;
    case 'model-unavailable':
      return OUTCOME_COPY.modelTitle;
    case 'error':
      return OUTCOME_COPY.errorTitle;
  }
}

export function OutcomePanel({ outcome, category, secret = false, oneFact = false, variant, onRetry }: OutcomePanelProps) {
  const real = variant === 'real';
  let tone: NoticeTone;
  let body: string;
  let actions: ReactNode = null;
  switch (outcome) {
    case 'blocked-never':
      tone = 'never';
      body = secret ? OUTCOME_COPY.secretBody : fill(OUTCOME_COPY.blockedBody, { category: category ?? '' });
      if (real && !secret) actions = <LinkButton to="/settings#rules" variant="secondary" size="sm">{OUTCOME_COPY.changeRules}</LinkButton>;
      break;
    case 'no-match':
      tone = 'info';
      body = real ? OUTCOME_COPY.noMatchReal : OUTCOME_COPY.noMatchPlayground;
      if (real) actions = <LinkButton to="/sources" variant="secondary" size="sm">{OUTCOME_COPY.sources}</LinkButton>;
      break;
    case 'unsupported':
      tone = 'info';
      body = oneFact ? OUTCOME_COPY.oneFactBody : OUTCOME_COPY.countsBody;
      break;
    case 'model-unavailable':
      tone = 'warning';
      body = OUTCOME_COPY.modelBody;
      if (real) {
        actions = (
          <>
            <LinkButton to="/settings#cloud" variant="secondary" size="sm">{OUTCOME_COPY.settings}</LinkButton>
            <LinkButton to="/prepare?back=/" variant="secondary" size="sm">{OUTCOME_COPY.setUpModel}</LinkButton>
          </>
        );
      }
      break;
    case 'error':
      tone = 'warning';
      body = OUTCOME_COPY.errorBody;
      if (onRetry) actions = <Button variant="secondary" size="sm" onClick={onRetry}>{OUTCOME_COPY.retry}</Button>;
      break;
  }
  return (
    <div className={styles.outcome} data-outcome={outcome}>
      <Notice tone={tone} title={outcomeTitle(outcome, category, secret, oneFact)} actions={actions}>
        <p>{body}</p>
      </Notice>
    </div>
  );
}

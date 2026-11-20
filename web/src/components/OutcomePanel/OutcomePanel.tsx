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
  variant: 'real' | 'playground';
  onRetry?(): void;
}

export function outcomeTitle(outcome: OutcomePanelOutcome, category?: Category): string {
  switch (outcome) {
    case 'blocked-never':
      return fill(OUTCOME_COPY.blockedTitle, { category: category ?? '' }).trim();
    case 'no-match':
      return OUTCOME_COPY.noMatchTitle;
    case 'model-unavailable':
      return OUTCOME_COPY.modelTitle;
    case 'error':
      return OUTCOME_COPY.errorTitle;
  }
}

export function OutcomePanel({ outcome, category, variant, onRetry }: OutcomePanelProps) {
  const real = variant === 'real';
  let tone: NoticeTone;
  let body: string;
  let actions: ReactNode = null;
  switch (outcome) {
    case 'blocked-never':
      tone = 'never';
      body = fill(OUTCOME_COPY.blockedBody, { category: category ?? '' });
      if (real) actions = <LinkButton to="/settings#rules" variant="secondary" size="sm">{OUTCOME_COPY.changeRules}</LinkButton>;
      break;
    case 'no-match':
      tone = 'info';
      body = real ? OUTCOME_COPY.noMatchReal : OUTCOME_COPY.noMatchPlayground;
      if (real) actions = <LinkButton to="/sources" variant="secondary" size="sm">{OUTCOME_COPY.sources}</LinkButton>;
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
      <Notice tone={tone} title={outcomeTitle(outcome, category)} actions={actions}>
        <p>{body}</p>
      </Notice>
    </div>
  );
}

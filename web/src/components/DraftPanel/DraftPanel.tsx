// DraftPanel (40 section 16.12): the instruction for the cloud model before the decision; the draft, its error or the
// kept-local line after it. The draft is model output and is shown as plain text only.
import { useEffect, useId, useState } from 'react';
import type { AskPhase, AskState } from '@/state/ask';
import { formatCount } from '@/copy/format';
import { DRAFT_COPY, fill } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Fill } from '../Fill/Fill';
import { Notice } from '../Notice/Notice';
import { Spinner } from '../Spinner/Spinner';
import { Tag } from '../Tag/Tag';
import styles from './DraftPanel.module.css';

export interface DraftPanelProps {
  instruction: string;
  onInstructionChange(s: string): void;
  phase: AskPhase;
  draft?: string;
  draftError?: string;
  onRetry(): void;
  outcome?: AskState['outcome'];
  stepPhrase: string;
  onSeeReceipts(): void;   // real: /seen; Playground: switches tab
  onAskAgain(): void;
}

export const INSTRUCTION_MAX = 200;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? 'check' : 'copy'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? DRAFT_COPY.copied : DRAFT_COPY.copy}
    </Button>
  );
}

export function DraftPanel(props: DraftPanelProps) {
  const { instruction, onInstructionChange, phase, draft, draftError, onRetry, outcome, stepPhrase, onSeeReceipts, onAskAgain } = props;
  const fieldId = useId();
  const helpId = useId();

  if (outcome?.kind === 'kept-local') {
    return (
      <div className={styles.panel}>
        <p className={styles.kept} tabIndex={-1} data-result-line>
          {DRAFT_COPY.keptLocal}
        </p>
        <div>
          <Button variant="secondary" onClick={onAskAgain}>
            {DRAFT_COPY.askAgain}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'drafting' || (phase === 'done' && outcome?.kind === 'shared')) {
    const shared = outcome?.kind === 'shared' ? outcome : undefined;
    return (
      <div className={styles.panel}>
        {phase === 'drafting' ? (
          <p className={styles.drafting} role="status">
            <Tag tone="cloud" icon="cloud">
              {DRAFT_COPY.cloudTag}
            </Tag>
            <Spinner size={16} labelled={false} />
            {DRAFT_COPY.drafting}
          </p>
        ) : null}
        {shared && draft !== undefined && phase === 'done' ? (
          <div className={styles.draftBlock}>
            <div className={styles.draftHead}>
              <h3 className={styles.title}>{DRAFT_COPY.title}</h3>
              <Tag tone="cloud" icon="cloud">
                {DRAFT_COPY.cloudTag}
              </Tag>
            </div>
            <p className={styles.draft} dir="auto" data-testid="draft-text">
              {draft}
            </p>
            <div>
              <CopyButton text={draft} />
            </div>
            <p className={styles.note}>
              <Fill template={DRAFT_COPY.note} values={{ stepPhrase, chars: formatCount(shared.chars) }} />
            </p>
          </div>
        ) : null}
        {shared && draftError && phase === 'done' ? (
          <Notice tone="warning" live actions={<Button variant="secondary" size="sm" onClick={onRetry}>{DRAFT_COPY.retry}</Button>}>
            <p>{draftError}</p>
          </Notice>
        ) : null}
        {shared ? (
          <p className={styles.success} tabIndex={-1} data-result-line>
            {fill(DRAFT_COPY.success, { stepPhrase })}{' '}
            <button type="button" className={styles.link} onClick={onSeeReceipts}>
              {DRAFT_COPY.seeReceipts}
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  // Before the decision: the instruction that goes with the approved text.
  return (
    <div className={styles.panel}>
      <label htmlFor={fieldId} className={styles.fieldLabel}>
        {DRAFT_COPY.instructionLabel}
      </label>
      <input
        id={fieldId}
        className={styles.input}
        type="text"
        maxLength={INSTRUCTION_MAX}
        value={instruction}
        aria-describedby={helpId}
        onChange={(e) => onInstructionChange(e.target.value)}
      />
      <p id={helpId} className={styles.help}>
        {DRAFT_COPY.instructionHelp}
      </p>
    </div>
  );
}

// DraftPanel (40 section 16.12): the instruction for the cloud model before the decision; after it, the receipt chip,
// the draft under "Gemini drafted a reply from those N characters alone", Copy the draft and New ask, or the kept-local
// line. The draft is model output and is shown as plain text only.
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AskPhase, AskState } from '@/state/ask';
import { formatCount } from '@/copy/format';
import { DRAFT_COPY, fill } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Fill } from '../Fill/Fill';
import { Icon } from '../icons';
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
  receiptsHref?: string;   // real: the receipt chip's "open" is a link to it (onSeeReceipts is then not used)
  onAskAgain(): void;
}

export const INSTRUCTION_MAX = 200;

/** The clipboard API, with a hidden textarea as the fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** "#0412": the tail of the receipt id, enough to find it in the list. */
export function shortReceiptId(id: string): string {
  return id.slice(-4);
}

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
        void copyText(text).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
    >
      {copied ? DRAFT_COPY.copied : DRAFT_COPY.copy}
    </Button>
  );
}

export function DraftPanel(props: DraftPanelProps) {
  const { instruction, onInstructionChange, phase, draft, draftError, onRetry, outcome, stepPhrase, onSeeReceipts, receiptsHref, onAskAgain } = props;
  const fieldId = useId();
  const helpId = useId();

  if (outcome?.kind === 'kept-local') {
    return (
      <div className={styles.panel}>
        <p className={styles.kept} tabIndex={-1} data-result-line>
          <span className={styles.dot} aria-hidden="true" />
          {DRAFT_COPY.keptLocal}
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={onAskAgain}>
            {DRAFT_COPY.askAgain}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'drafting' || (phase === 'done' && outcome?.kind === 'shared')) {
    const shared = outcome?.kind === 'shared' ? outcome : undefined;
    const chars = shared ? formatCount(shared.chars) : '';
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
        {shared ? (
          <p className={styles.receipt} tabIndex={-1} data-result-line>
            <span className={styles.dot} aria-hidden="true" />
            <span>{fill(DRAFT_COPY.sentChip, { chars, id: shortReceiptId(shared.receiptId) })}</span>
            <span aria-hidden="true"> · </span>
            {receiptsHref ? (
              <Link to={receiptsHref} className={styles.link} aria-label={DRAFT_COPY.openLabel}>
                {DRAFT_COPY.open}
              </Link>
            ) : (
              <button type="button" className={styles.link} aria-label={DRAFT_COPY.openLabel} onClick={onSeeReceipts}>
                {DRAFT_COPY.open}
              </button>
            )}
          </p>
        ) : null}
        {shared && draft !== undefined && phase === 'done' ? (
          <div className={styles.draftBlock}>
            <h3 className={styles.title}>
              <Icon name="cloud" size={16} className={styles.titleIcon} />
              {fill(DRAFT_COPY.title, { chars })}
            </h3>
            <p className={styles.draft} dir="auto" data-testid="draft-text">
              {draft}
            </p>
            <div className={styles.actions}>
              <CopyButton text={draft} />
              <Button variant="ghost" size="sm" className={styles.newAsk} onClick={onAskAgain}>
                {DRAFT_COPY.askAgain}
              </Button>
            </div>
            <p className={styles.note}>
              <Fill template={DRAFT_COPY.note} values={{ stepPhrase, chars }} />
            </p>
          </div>
        ) : null}
        {shared && draftError && phase === 'done' ? (
          <Notice tone="warning" live actions={<Button variant="secondary" size="sm" onClick={onRetry}>{DRAFT_COPY.retry}</Button>}>
            <p>{draftError}</p>
          </Notice>
        ) : null}
      </div>
    );
  }

  // Before the decision: the instruction that goes with the approved text.
  return (
    <div className={styles.instruction}>
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

// One tool call in the Playground assistant's conversation: the tool, exactly what Gemini sent, the wait, what Sieve
// replied, and (for the result handed to Gemini) exactly what Gemini received and how many characters of the data.
import type { AssistantCall } from '@/ai/cloudAssistant';
import { Fill } from '@/components/Fill/Fill';
import { Spinner } from '@/components/Spinner/Spinner';
import { Tag, type TagTone } from '@/components/Tag/Tag';
import { formatCount } from '@/copy/format';
import { PLAYGROUND_ASSISTANT_COPY as COPY, fill } from '@/copy/screens-main';
import styles from './assistant.module.css';

export type CallWait = 'sieve' | 'approval';

const TONE: Record<AssistantCall['status'], TagTone> = {
  calling: 'cloud',
  failed: 'never',
  answered: 'device',
  pending: 'warn',
  declined: 'muted',
  blocked: 'muted',
  'no-match': 'muted',
  offline: 'warn',
  expired: 'muted',
  'not-allowed': 'never',
  error: 'never',
};

function argText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  return JSON.stringify(value);
}

export function receivedLine(chars: number): string {
  if (chars === 0) return COPY.receivedNone;
  return chars === 1 ? COPY.receivedOne : fill(COPY.received, { n: formatCount(chars) });
}

export function CallCard({ call, wait }: { call: AssistantCall; wait: CallWait }) {
  const args = Object.entries(call.args);
  const tool = <code className={styles.code}>{call.tool}</code>;
  return (
    <li className={styles.call} data-tool={call.tool} data-status={call.status}>
      <div className={styles.callHead}>
        <p className={styles.callTitle}>
          <Fill template={call.by === 'gemini' ? COPY.called : COPY.pageCalled} values={{ tool }} />
        </p>
        <Tag tone={TONE[call.status]}>{call.status === 'calling' && wait === 'approval' ? COPY.waitingApproval : COPY.status[call.status]}</Tag>
      </div>

      <div className={styles.args}>
        <p className={styles.eyebrow}>{COPY.args}</p>
        {args.length === 0 ? (
          <p className={styles.small}>{COPY.noArgs}</p>
        ) : (
          <dl className={styles.argList}>
            {args.map(([key, value]) => (
              <div key={key} className={styles.argRow}>
                <dt>
                  <code className={styles.code}>{key}</code>
                </dt>
                <dd dir="auto">{argText(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {call.status === 'calling' ? (
        <p className={styles.wait} data-testid="call-wait">
          <Spinner size={16} labelled={false} />
          <span>
            {wait === 'approval' ? (
              <>
                <strong>{COPY.waitingApproval}</strong> {COPY.waitingApprovalHint}
              </>
            ) : (
              COPY.waitingSieve
            )}
          </span>
        </p>
      ) : null}

      {call.status === 'failed' ? <p className={styles.small}>{COPY.failed}</p> : null}

      {call.result ? (
        <p className={styles.small} dir="auto">
          <Fill template={COPY.sieveReplied} values={{ message: call.result.message }} />
        </p>
      ) : null}

      {call.handedToGemini && call.result ? (
        <div className={styles.received}>
          <p className={styles.receivedLine} data-testid="received-chars">
            {receivedLine(call.chars)}
          </p>
          {call.chars > 0 && call.result.text ? (
            <figure className={styles.receivedText}>
              <figcaption className={styles.eyebrow}>{COPY.receivedText}</figcaption>
              <blockquote dir="auto" data-testid="received-text">
                {call.result.text}
              </blockquote>
            </figure>
          ) : null}
          {call.received ? (
            <details className={styles.exact}>
              <summary>{COPY.exact}</summary>
              <pre className={styles.pre} data-testid="received-json">
                {call.received}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

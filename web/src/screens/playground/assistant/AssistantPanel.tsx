// The Playground assistant panel (00 D1, 30 section 16), loaded only when the person opens it. Left: the conversation
// with Gemini in the cloud (each tool call with its arguments, the wait for approval, exactly what Gemini received, the
// answer, and the two-lane trace). Right: Sieve on this device, where each request is prepared and approved.
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/shallow';
import { MAX_QUESTION_CHARS, type TraceStep } from '@sieve/shared';
import { cloudCallCap, type AssistantCall } from '@/ai/cloudAssistant';
import { Button } from '@/components/Button/Button';
import { Chip } from '@/components/Chip/Chip';
import { Notice } from '@/components/Notice/Notice';
import { isBlankQuestion } from '@/components/QuestionInput/QuestionInput';
import { Spinner } from '@/components/Spinner/Spinner';
import { Tag } from '@/components/Tag/Tag';
import { TraceList } from '@/components/TraceList/TraceList';
import { PLAYGROUND_ASSISTANT_COPY as COPY, fill } from '@/copy/screens-main';
import type { PendingEntry } from '@/state/homeBase';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { useSession } from '@/state/session';
import { outcomeMessage, useAssistant, type AssistantTurn } from './assistantStore';
import { turnTrace } from './assistantTrace';
import { CallCard, type CallWait } from './CallCard';
import { RelayColumn } from './RelayColumn';
import { ASSISTANT_SUGGESTIONS } from './suggestions';
import styles from './assistant.module.css';

/** While a call runs: is the request waiting for the person (the approval card is up), or still with Sieve? */
export function callWait(call: AssistantCall, entries: Record<string, PendingEntry>): CallWait {
  const list = Object.values(entries);
  const question = typeof call.args.question === 'string' ? call.args.question.trim() : undefined;
  const entry =
    (call.requestId ? entries[call.requestId] : undefined) ??
    (question ? list.find((e) => e.request.question === question && e.phase !== 'done') : undefined);
  if (entry) return entry.phase === 'awaiting-person' || entry.phase === 'deciding' ? 'approval' : 'sieve';
  // The page only checks a request the server called pending: the person has not decided yet.
  return call.by === 'page' ? 'approval' : 'sieve';
}

function Turn({ turn, entries, deviceTraces }: { turn: AssistantTurn; entries: Record<string, PendingEntry>; deviceTraces: Record<string, TraceStep[]> }) {
  const message = turn.outcome ? outcomeMessage(turn.outcome) : undefined;
  const steps = turn.phase === 'done' && turn.outcome?.kind !== 'connect-error' && turn.outcome?.kind !== 'no-session' ? turnTrace(turn, deviceTraces) : [];
  const busy = turn.phase !== 'done';
  return (
    <li className={styles.turn} data-turn={turn.id}>
      <div className={styles.you}>
        <p className={styles.eyebrow}>{COPY.you}</p>
        <p className={styles.question} dir="auto">
          {turn.question}
        </p>
      </div>
      {turn.notes.map((note, i) => (
        <div key={`note-${i}`} className={styles.note}>
          <p className={styles.eyebrow}>{COPY.gemini}</p>
          <p dir="auto">{note}</p>
        </div>
      ))}
      {turn.calls.length > 0 ? (
        <ol className={styles.calls}>
          {turn.calls.map((call) => (
            <CallCard key={call.id} call={call} wait={call.status === 'calling' ? callWait(call, entries) : 'sieve'} />
          ))}
        </ol>
      ) : null}
      {busy && turn.phase !== 'calling' ? (
        <p className={styles.wait} role="status">
          <Spinner size={16} labelled={false} />
          <span>{turn.phase === 'connecting' ? COPY.connecting : COPY.thinking}</span>
        </p>
      ) : null}
      {turn.outcome?.kind === 'answered' ? (
        <div className={styles.answer} data-testid="assistant-answer">
          <p className={styles.eyebrow}>{COPY.answer}</p>
          <p className={styles.answerText} dir="auto">
            {turn.outcome.text}
          </p>
        </div>
      ) : null}
      {message ? (
        <Notice tone={turn.outcome?.kind === 'aborted' ? 'info' : 'warning'} live compact>
          <p>{message}</p>
        </Notice>
      ) : null}
      {steps.length > 0 ? <TraceList steps={steps} heading={COPY.traceHeading} sampleData twoLane /> : null}
    </li>
  );
}

export function AssistantPanel() {
  const inputId = useId();
  const errorId = useId();
  const cloudId = useId();
  const [question, setQuestion] = useState('');
  const [empty, setEmpty] = useState(false);
  const { connection, turns, running, capVersion, deviceTraces } = useAssistant(
    useShallow((s) => ({ connection: s.connection, turns: s.turns, running: s.running, capVersion: s.capVersion, deviceTraces: s.deviceTraces })),
  );
  const entries = usePlaygroundRelay((s) => s.entries);
  const uid = useSession((s) => s.user?.uid);

  // Keep each request's device steps after its relay entry is dismissed; leaving the Playground ends the session.
  // The visitor's uid for the "cloud calls left" line comes from the auth listener the Playground started on mount.
  useEffect(() => {
    useAssistant.getState().rememberDevice(usePlaygroundRelay.getState().entries);
    const unsubscribe = usePlaygroundRelay.subscribe((s) => useAssistant.getState().rememberDevice(s.entries));
    return () => {
      unsubscribe();
      useAssistant.getState().disconnect();
    };
  }, []);

  const remaining = useMemo(() => {
    void capVersion;
    if (!uid) return undefined;
    const cap = cloudCallCap(uid);
    return { n: cap.remaining(), limit: cap.limit };
  }, [uid, capVersion]);

  const submit = (q: string) => {
    if (running) return;
    if (isBlankQuestion(q)) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setQuestion(q);
    useAssistant.getState().ask(q).catch(console.error);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (running) useAssistant.getState().stop();
    else submit(question);
  };

  const connectLine =
    connection === 'connecting' ? COPY.connecting : connection === 'ready' ? COPY.connected : connection === 'error' ? COPY.connectFailed : COPY.notConnected;

  return (
    <div className={styles.panel}>
      <Notice tone="cloud" title={COPY.honestTitle} compact>
        <p>{COPY.honest}</p>
      </Notice>
      <div className={styles.columns}>
        <section className={`${styles.column} ${styles.cloudColumn}`} aria-labelledby={cloudId}>
          <h3 id={cloudId} className={styles.columnTitle}>
            {COPY.cloudColumn}
          </h3>
          <div className={styles.connect} data-connection={connection}>
            <Tag tone={connection === 'ready' ? 'device' : connection === 'error' ? 'warn' : 'muted'}>{COPY.stepConnect}</Tag>
            <span>{connectLine}</span>
          </div>

          <div className={styles.suggestions}>
            <p className={styles.eyebrow}>{COPY.tryAsking}</p>
            <div className={styles.chips}>
              {ASSISTANT_SUGGESTIONS.map((s) => (
                <Chip key={s} shape="rounded" selectedStyle="inverse" selected={question === s} onClick={() => submit(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>

          <form className={styles.form} onSubmit={onSubmit}>
            <label htmlFor={inputId} className={styles.label}>
              {COPY.inputLabel}
            </label>
            <div className={styles.inputRow}>
              <input
                id={inputId}
                className={styles.input}
                type="text"
                value={question}
                maxLength={MAX_QUESTION_CHARS}
                placeholder={COPY.inputPlaceholder}
                aria-invalid={empty || undefined}
                aria-describedby={empty ? errorId : undefined}
                autoComplete="off"
                onChange={(e) => {
                  setQuestion(e.target.value);
                  if (empty) setEmpty(false);
                }}
              />
              <Button type="submit" variant={running ? 'secondary' : 'primary'}>
                {running ? COPY.stop : COPY.ask}
              </Button>
            </div>
            {empty ? (
              <p id={errorId} className={styles.error}>
                {COPY.empty}
              </p>
            ) : null}
            {remaining ? (
              <p className={styles.small} data-testid="cap-remaining">
                {remaining.n === 0 ? fill(COPY.capReached, { limit: remaining.limit }) : fill(COPY.remaining, remaining)}
              </p>
            ) : null}
          </form>

          {turns.length > 0 ? (
            <ol className={styles.turns} aria-label={COPY.conversationLabel}>
              {turns.map((turn) => (
                <Turn key={turn.id} turn={turn} entries={entries} deviceTraces={deviceTraces} />
              ))}
            </ol>
          ) : null}
        </section>
        <RelayColumn />
      </div>
    </div>
  );
}

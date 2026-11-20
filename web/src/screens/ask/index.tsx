// Ask (`/`, 40 section 13.4): the golden path on the person's own data, through useAskReal (40 section 12).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { AskResult } from '@/components/AskResult/AskResult';
import { Button, LinkButton } from '@/components/Button/Button';
import { Chip } from '@/components/Chip/Chip';
import { tablesOf, useDb } from '@/components/dbTables';
import { Notice } from '@/components/Notice/Notice';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuestionInput, type QuestionInputHandle } from '@/components/QuestionInput/QuestionInput';
import { SCREENS, TITLES } from '@/copy/strings';
import { ASK_COPY, fill } from '@/copy/screens-main';
import { useAskReal } from '@/state/ask';
import { useAvailability } from '@/state/availability';
import { useIndexing } from '@/state/indexing';
import { useNetwork } from '@/state/network';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { askNotices, modelGate } from './askNotices';
import styles from './ask.module.css';

const MODEL_NOTICE_ID = 'ask-model-notice';

function runAsk(q?: string): void {
  useAskReal.getState().ask(q).catch((error: unknown) => console.error(error));
}

/** Whether any real source is connected; undefined until known (no notice while unknown). */
function useSourcesConnected(enabled: boolean): boolean | undefined {
  const db = useDb('real', enabled);
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const rows = await tablesOf(db).sources.toArray();
    return rows.some((r) => r.connected && r.kind !== 'playground');
  }, [db]);
}

export function AskScreen() {
  const navigate = useNavigate();
  const inputRef = useRef<QuestionInputHandle>(null);
  const ownerConflict = useSession((s) => s.ownerConflict);
  const online = useNetwork((s) => s.online);
  const { question, phase } = useAskReal(useShallow((s) => ({ question: s.question, phase: s.phase })));
  const { text, setup } = useAvailability(useShallow((s) => ({ text: s.text, setup: s.setup })));
  const cloudFallback = useSettings((s) => s.settings.cloudFallbackForOwnData);
  const indexing = useIndexing(useShallow((s) => ({ state: s.state, left: s.left })));
  const sourcesConnected = useSourcesConnected(!ownerConflict);
  const [waiting, setWaiting] = useState<string | null>(null);

  const gateInput = { text, setup: setup.state, cloudFallback };
  const gate = modelGate(gateInput);
  const notices = askNotices({ ...gateInput, sourcesConnected, fraction: setup.fraction, indexing: indexing.state, left: indexing.left });
  const modelNotice = notices.find((n) => n.id === 'downloadable' || n.id === 'setting-up' || n.id === 'no-model');
  const pct = Math.round((setup.fraction ?? 0) * 100);

  // 40 section 13.2a item 5: a question kept for when the model is ready runs on its own (cancellable).
  useEffect(() => {
    if (waiting === null) return undefined;
    return useAvailability.subscribe((s) => {
      if (s.text === 'available') {
        setWaiting(null);
        runAsk(waiting);
      }
    });
  }, [waiting]);

  const preparing = phase === 'preparing';
  const submit = (q: string) => {
    if (gate === 'setting-up') {
      setWaiting(q.trim());
      return;
    }
    if (gate !== 'open') return;
    runAsk(q);
  };

  let button: ReactNode;
  if (preparing) {
    button = (
      <Button variant="secondary" onClick={() => useAskReal.getState().stop()}>
        {ASK_COPY.stop}
      </Button>
    );
  } else if (gate === 'setting-up') {
    button = (
      <Button type="submit" variant="primary" aria-disabled={waiting !== null || undefined}>
        {ASK_COPY.answerWhenReady}
      </Button>
    );
  } else {
    const blocked = gate !== 'open';
    button = (
      <Button
        type="submit"
        variant="primary"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked && modelNotice ? MODEL_NOTICE_ID : undefined}
        onClick={(e) => {
          if (blocked) e.preventDefault();
        }}
      >
        {ASK_COPY.find}
      </Button>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader title={SCREENS.ask.heading} lead={SCREENS.ask.lead} size="ask" />

      {notices.length > 0 ? (
        <div className={styles.notices}>
          {notices.map((n) => (
            <Notice
              key={n.id}
              tone={n.tone}
              actions={
                n.actions.length > 0
                  ? n.actions.map((a) => (
                      <LinkButton key={a.label} to={a.to} variant="secondary" size="sm">
                        {a.label}
                      </LinkButton>
                    ))
                  : undefined
              }
            >
              <p id={n === modelNotice ? MODEL_NOTICE_ID : undefined}>{n.text}</p>
            </Notice>
          ))}
        </div>
      ) : null}

      <div className={styles.questionCard}>
        <QuestionInput
          ref={inputRef}
          label={ASK_COPY.questionLabel}
          placeholder={ASK_COPY.placeholder}
          value={question}
          onChange={(q) => useAskReal.getState().setQuestion(q)}
          onSubmit={submit}
          button={button}
        />
        {waiting !== null ? (
          <div className={styles.waiting} role="status">
            <p>{fill(ASK_COPY.waitForModel, { pct })}</p>
            <Button variant="ghost" size="sm" onClick={() => setWaiting(null)}>
              {ASK_COPY.cancelWaiting}
            </Button>
          </div>
        ) : null}
        <div className={styles.chips}>
          <span className={styles.try}>{ASK_COPY.try}</span>
          {ASK_COPY.chips.map((chip) => (
            <Chip
              key={chip.label}
              selected={question.trim() === chip.question}
              onClick={() => {
                useAskReal.getState().setQuestion(chip.question);
                submit(chip.question);
              }}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      </div>

      <AskResult
        useAsk={useAskReal}
        variant="in-app"
        dbKind="real"
        online={online}
        onSeeReceipts={() => navigate('/seen')}
        onAskAgain={() => {
          useAskReal.getState().reset();
          useAskReal.getState().setQuestion('');
          inputRef.current?.focus();
        }}
        idle={phase === 'idle' && notices.length === 0 ? <p className={styles.idle}>{ASK_COPY.idleHint}</p> : null}
      />
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.ask);
  return <AskScreen />;
}

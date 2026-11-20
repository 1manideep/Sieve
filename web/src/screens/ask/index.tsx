// Ask (`/`, 40 section 13.4): the golden path on the person's own data, through useAskReal (40 section 12).
// The final design: before a question, F2 (the headline, the glass prompt card, three chips); after one, F3 (the
// conversation column with the follow-up pill at the bottom). Only the presentation changed; the store is the same.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { AskHome } from '@/components/AskResult/AskHome';
import { AskResult } from '@/components/AskResult/AskResult';
import { FollowUp } from '@/components/AskResult/FollowUp';
import { askModelPill } from '@/components/AskResult/modelPill';
import { NoticeRow } from '@/components/AskResult/NoticeRow';
import { usePreferredStep } from '@/components/AskResult/preferredStep';
import { AskButton, PromptCard } from '@/components/AskResult/PromptCard';
import { Button, LinkButton } from '@/components/Button/Button';
import { tablesOf, useDb } from '@/components/dbTables';
import type { QuestionInputHandle } from '@/components/QuestionInput/QuestionInput';
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
  const focusWhenIdle = useRef(false);
  const ownerConflict = useSession((s) => s.ownerConflict);
  const online = useNetwork((s) => s.online);
  const { question, phase, step } = useAskReal(useShallow((s) => ({ question: s.question, phase: s.phase, step: s.step })));
  const { text, setup } = useAvailability(useShallow((s) => ({ text: s.text, setup: s.setup })));
  const { cloudFallback, defaultStep } = useSettings(useShallow((s) => ({ cloudFallback: s.settings.cloudFallbackForOwnData, defaultStep: s.settings.defaultStep })));
  const indexing = useIndexing(useShallow((s) => ({ state: s.state, left: s.left })));
  const sourcesConnected = useSourcesConnected(!ownerConflict);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [preferred, setPreferred] = usePreferredStep(useAskReal, defaultStep);

  const gateInput = { text, setup: setup.state, cloudFallback };
  const gate = modelGate(gateInput);
  const notices = askNotices({ ...gateInput, sourcesConnected, fraction: setup.fraction, indexing: indexing.state, left: indexing.left });
  const modelNotice = notices.find((n) => n.id === 'downloadable' || n.id === 'setting-up' || n.id === 'no-model');
  const pct = Math.round((setup.fraction ?? 0) * 100);
  const model = askModelPill({ text, setup: setup.state, fraction: setup.fraction, cloudFallback });

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

  // "New ask" returns to the prompt card; the field there takes focus once it exists.
  useEffect(() => {
    if (phase === 'idle' && focusWhenIdle.current) {
      focusWhenIdle.current = false;
      inputRef.current?.focus();
    }
  }, [phase]);

  const preparing = phase === 'preparing';
  const submit = (q: string) => {
    if (gate === 'setting-up') {
      setWaiting(q.trim());
      return;
    }
    if (gate !== 'open') return;
    runAsk(q);
  };

  const submitButton = (round: boolean): ReactNode => {
    if (preparing) {
      return (
        <Button variant="secondary" onClick={() => useAskReal.getState().stop()}>
          {ASK_COPY.stop}
        </Button>
      );
    }
    if (gate === 'setting-up') {
      return (
        <Button type="submit" variant="primary" aria-disabled={waiting !== null || undefined}>
          {ASK_COPY.answerWhenReady}
        </Button>
      );
    }
    const blocked = gate !== 'open';
    return <AskButton round={round} label={ASK_COPY.find} blocked={blocked} describedBy={blocked && modelNotice ? MODEL_NOTICE_ID : undefined} />;
  };

  const waitingRow =
    waiting !== null ? (
      <div className={styles.waiting} role="status">
        <p>{fill(ASK_COPY.waitForModel, { pct })}</p>
        <Button variant="ghost" size="sm" onClick={() => setWaiting(null)}>
          {ASK_COPY.cancelWaiting}
        </Button>
      </div>
    ) : null;

  const noticeRows =
    notices.length > 0 ? (
      <div className={styles.notices}>
        {notices.map((n) => (
          <NoticeRow
            key={n.id}
            tone={n.tone}
            actions={
              n.actions.length > 0
                ? n.actions.map((a) => (
                    <LinkButton key={a.label} to={a.to} variant="ghost" size="sm">
                      {a.label}
                    </LinkButton>
                  ))
                : undefined
            }
          >
            <p id={n === modelNotice ? MODEL_NOTICE_ID : undefined}>{n.text}</p>
          </NoticeRow>
        ))}
      </div>
    ) : null;

  const onChange = (q: string) => useAskReal.getState().setQuestion(q);

  if (phase === 'idle') {
    return (
      <div className={styles.page} data-phase={phase}>
        <AskHome
          headlineLines={ASK_COPY.headlineLines}
          lead={ASK_COPY.lead}
          notices={noticeRows}
          card={
            <PromptCard
              ref={inputRef}
              regionLabel={ASK_COPY.cardLabel}
              label={ASK_COPY.questionLabel}
              placeholder={ASK_COPY.placeholder}
              value={question}
              onChange={onChange}
              onSubmit={submit}
              button={submitButton(false)}
              step={preferred}
              onStepChange={setPreferred}
              model={model}
              attach={{ label: ASK_COPY.attach, onClick: () => navigate('/sources') }}
            >
              {waitingRow}
            </PromptCard>
          }
          chipsLabel={ASK_COPY.try}
          chips={ASK_COPY.chips.map((chip) => ({
            label: chip.label,
            selected: question.trim() === chip.question,
            onClick: () => {
              useAskReal.getState().setQuestion(chip.question);
              submit(chip.question);
            },
          }))}
          footer={
            <div className={styles.homeFooter}>
              {notices.length === 0 ? <p className={styles.idle}>{ASK_COPY.idleHint}</p> : null}
              <p className={styles.footerLine}>{ASK_COPY.footer}</p>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page} data-phase={phase}>
      <div className={styles.conversation}>
        <h1 className="visually-hidden">{SCREENS.ask.heading}</h1>
        {noticeRows}
        <AskResult
          useAsk={useAskReal}
          variant="in-app"
          dbKind="real"
          online={online}
          onSeeReceipts={() => navigate('/seen')}
          receiptsHref="/seen"
          onAskAgain={() => {
            focusWhenIdle.current = true;
            useAskReal.getState().reset();
            useAskReal.getState().setQuestion('');
          }}
        />
        <FollowUp
          ref={inputRef}
          label={ASK_COPY.followUpLabel}
          placeholder={ASK_COPY.followUpPlaceholder}
          value={question}
          onChange={onChange}
          onSubmit={submit}
          button={submitButton(true)}
          step={step}
        >
          {waitingRow}
        </FollowUp>
      </div>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.ask);
  return <AskScreen />;
}

// AskPanel (40 section 13.9): the Playground's Ask tab, in the final design. Before a question, F2: the headline, the
// quiet rows (the no-model note, seeding), the glass prompt card and the suggestions. After one, F3: the conversation
// and the follow-up pill. "What is on this computer" follows in both, in the same place in the tree, so adding a file
// or a test email works mid-conversation and the row keeps its state. The store is useAskPlayground throughout.
import { useEffect, useRef, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useAskPlayground } from '@/state/ask';
import { PLAYGROUND_SETTINGS } from '@/state/settings';
import { ASK_COPY, PLAYGROUND_COPY } from '@/copy/screens-main';
import { AskHome } from '@/components/AskResult/AskHome';
import { AskResult } from '@/components/AskResult/AskResult';
import { FollowUp } from '@/components/AskResult/FollowUp';
import { usePreferredStep } from '@/components/AskResult/preferredStep';
import { AskButton, PromptCard } from '@/components/AskResult/PromptCard';
import { Button, LinkButton } from '@/components/Button/Button';
import { NoticeRow } from '@/components/AskResult/NoticeRow';
import type { QuestionInputHandle } from '@/components/QuestionInput/QuestionInput';
import type { Suggestion } from '@/playground/suggestions';
import { noModelNote, playgroundModelPill, type PlaygroundModel } from './playgroundModel';
import styles from './playground.module.css';

export interface AskPanelProps {
  id: string;
  labelledBy: string;
  hidden: boolean;
  model: PlaygroundModel;
  suggestions: Suggestion[];
  online: boolean;
  onAsk(q: string): void;
  onSeeReceipts(): void;
  headerSlot?: ReactNode;
  sampleData: boolean;
  nanoSettingUp: boolean;
  setupNotice?: ReactNode;         // seeding progress or a seeding error, in place of the prompt card and the result
  computer?: ReactNode;            // "What is on this computer", under the chips (F2) or the conversation (F3)
  onAttach(): void;
}

export function AskPanel(props: AskPanelProps) {
  const { id, labelledBy, hidden, model, suggestions, online, onAsk, onSeeReceipts, headerSlot, sampleData, nanoSettingUp, setupNotice, computer, onAttach } = props;
  const { question, phase, step } = useAskPlayground(useShallow((s) => ({ question: s.question, phase: s.phase, step: s.step })));
  const inputRef = useRef<QuestionInputHandle>(null);
  const focusWhenIdle = useRef(false);
  const [preferred, setPreferred] = usePreferredStep(useAskPlayground, PLAYGROUND_SETTINGS.defaultStep);
  const note = noModelNote(model);
  const pill = playgroundModelPill(model);
  const preparing = phase === 'preparing';

  useEffect(() => {
    if (phase === 'idle' && focusWhenIdle.current) {
      focusWhenIdle.current = false;
      inputRef.current?.focus();
    }
  }, [phase]);

  const notices =
    note || setupNotice ? (
      <div className={styles.notices}>
        {note ? (
          <NoticeRow
            tone="warning"
            actions={
              note.setupLink ? (
                <LinkButton to="/prepare?back=/playground" variant="ghost" size="sm">
                  {PLAYGROUND_COPY.noteSetupLink}
                </LinkButton>
              ) : undefined
            }
          >
            <p>{note.text}</p>
          </NoticeRow>
        ) : null}
        {setupNotice}
      </div>
    ) : null;

  const submitButton = (round: boolean) =>
    preparing ? (
      <Button variant="secondary" onClick={() => useAskPlayground.getState().stop()}>
        {PLAYGROUND_COPY.stop}
      </Button>
    ) : (
      <AskButton round={round} label={PLAYGROUND_COPY.ask} />
    );

  const onChange = (q: string) => useAskPlayground.getState().setQuestion(q);

  return (
    <div id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={hidden} className={styles.askPanel}>
      {phase === 'idle' || setupNotice ? (
        <AskHome
          headlineLines={ASK_COPY.headlineLines}
          lead={PLAYGROUND_COPY.intro}
          notices={notices}
          card={
            setupNotice ? null : (
              <PromptCard
                ref={inputRef}
                regionLabel={PLAYGROUND_COPY.cardLabel}
                label={PLAYGROUND_COPY.inputLabel}
                placeholder={PLAYGROUND_COPY.inputPlaceholder}
                value={question}
                onChange={onChange}
                onSubmit={onAsk}
                button={submitButton(false)}
                step={preferred}
                onStepChange={setPreferred}
                model={pill}
                attach={{ label: PLAYGROUND_COPY.attach, onClick: onAttach }}
              />
            )
          }
          chipsLabel={PLAYGROUND_COPY.tryAsking}
          chips={setupNotice ? [] : suggestions.map((s) => ({ label: s.text, selected: question.trim() === s.text, onClick: () => onAsk(s.text) }))}
        />
      ) : (
        <div className={styles.conversation}>
          {notices}
          <AskResult
            useAsk={useAskPlayground}
            variant="playground"
            dbKind="playground"
            online={online}
            onSeeReceipts={onSeeReceipts}
            onAskAgain={() => {
              focusWhenIdle.current = true;
              useAskPlayground.getState().reset();
              useAskPlayground.getState().setQuestion('');
            }}
            headerSlot={headerSlot}
            sampleData={sampleData}
            nanoSettingUp={nanoSettingUp}
          />
          <FollowUp
            ref={inputRef}
            label={PLAYGROUND_COPY.inputLabel}
            placeholder={PLAYGROUND_COPY.followUpPlaceholder}
            value={question}
            onChange={onChange}
            onSubmit={onAsk}
            button={submitButton(true)}
            step={step}
          />
        </div>
      )}
      <div className={styles.computerSlot}>{computer}</div>
      {phase === 'idle' || setupNotice ? (
        <div className={styles.homeFooter}>
          {setupNotice ? null : <p className={styles.idle}>{PLAYGROUND_COPY.idleHint}</p>}
          <p className={styles.footerLine}>{PLAYGROUND_COPY.footerLine}</p>
        </div>
      ) : null}
    </div>
  );
}

// SieveWindow (40 section 13.9): the Sieve app inside the pretend computer. A bar with the model tag, two tabs (Ask
// and What has AI seen?), the no-model note, the suggested questions, the result and the question field.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useAskPlayground } from '@/state/ask';
import type { ReceiptView } from '@/state/types';
import { PLAYGROUND_COPY, fill } from '@/copy/screens-main';
import { AskResult } from '@/components/AskResult/AskResult';
import { Button, LinkButton } from '@/components/Button/Button';
import { Chip } from '@/components/Chip/Chip';
import { Notice } from '@/components/Notice/Notice';
import { QuestionInput, type QuestionInputHandle } from '@/components/QuestionInput/QuestionInput';
import { Tag } from '@/components/Tag/Tag';
import type { Suggestion } from '@/playground/suggestions';
import { modelTag, noModelNote, type PlaygroundModel } from './playgroundModel';
import { PlaygroundReceipts } from './PlaygroundReceipts';
import styles from './playground.module.css';

export interface SieveWindowProps {
  model: PlaygroundModel;
  tab: 'ask' | 'seen';
  onTab(t: 'ask' | 'seen'): void;
  suggestions: Suggestion[];
  receipts: ReceiptView[];
  online: boolean;
  onAsk(q: string): void;
  headerSlot?: ReactNode;
  sampleData: boolean;
  nanoSettingUp: boolean;
  setupNotice?: ReactNode;         // seeding progress or a seeding error, in place of the Ask panel content
}

export function SieveWindow(props: SieveWindowProps) {
  const { model, tab, onTab, suggestions, receipts, online, onAsk, headerSlot, sampleData, nanoSettingUp, setupNotice } = props;
  const { question, phase } = useAskPlayground(useShallow((s) => ({ question: s.question, phase: s.phase })));
  const inputRef = useRef<QuestionInputHandle>(null);
  const askTab = useRef<HTMLButtonElement>(null);
  const seenTab = useRef<HTMLButtonElement>(null);
  const ids = { ask: useId(), seen: useId(), askPanel: useId(), seenPanel: useId(), title: useId() };
  const tag = modelTag(model);
  const note = noModelNote(model);
  const preparing = phase === 'preparing';

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'ask' : event.key === 'End' ? 'seen' : tab === 'ask' ? 'seen' : 'ask';
    onTab(next);
    (next === 'ask' ? askTab : seenTab).current?.focus();
  };

  return (
    <section className={`${styles.win} ${styles.sieveWin}`} aria-labelledby={ids.title}>
      <div className={styles.bar}>
        <h2 id={ids.title} className={styles.barTitle}>
          {PLAYGROUND_COPY.windowTitle}
        </h2>
        <Tag tone={tag.tone}>{tag.text}</Tag>
      </div>
      <div className={styles.tabs} role="tablist" aria-label={PLAYGROUND_COPY.tabsLabel} onKeyDown={onTabKey}>
        <button
          ref={askTab}
          id={ids.ask}
          type="button"
          role="tab"
          aria-selected={tab === 'ask'}
          aria-controls={ids.askPanel}
          tabIndex={tab === 'ask' ? 0 : -1}
          className={styles.tab}
          onClick={() => onTab('ask')}
        >
          {PLAYGROUND_COPY.tabAsk}
        </button>
        <button
          ref={seenTab}
          id={ids.seen}
          type="button"
          role="tab"
          aria-selected={tab === 'seen'}
          aria-controls={ids.seenPanel}
          tabIndex={tab === 'seen' ? 0 : -1}
          className={styles.tab}
          onClick={() => onTab('seen')}
        >
          {receipts.length > 0 ? fill(PLAYGROUND_COPY.tabSeenCount, { n: receipts.length }) : PLAYGROUND_COPY.tabSeen}
        </button>
      </div>

      <div id={ids.askPanel} role="tabpanel" aria-labelledby={ids.ask} hidden={tab !== 'ask'} className={styles.askPanel}>
        {note ? (
          <Notice tone="warning" compact>
            <p>
              {note.text}{' '}
              {note.setupLink ? (
                <LinkButton to="/prepare?back=/playground" variant="ghost" size="sm">
                  {PLAYGROUND_COPY.noteSetupLink}
                </LinkButton>
              ) : null}
            </p>
          </Notice>
        ) : null}
        {setupNotice ?? (
          <>
            <div className={styles.suggestions}>
              <p className={styles.tryAsking}>{PLAYGROUND_COPY.tryAsking}</p>
              <div className={styles.chips}>
                {suggestions.map((s) => (
                  <Chip key={s.id} shape="rounded" selectedStyle="inverse" selected={question.trim() === s.text} onClick={() => onAsk(s.text)}>
                    {s.text}
                  </Chip>
                ))}
              </div>
            </div>
            <AskResult
              useAsk={useAskPlayground}
              variant="playground"
              dbKind="playground"
                    online={online}
              onSeeReceipts={() => onTab('seen')}
              onAskAgain={() => {
                useAskPlayground.getState().reset();
                useAskPlayground.getState().setQuestion('');
                inputRef.current?.focus();
              }}
              idle={phase === 'idle' ? <p className={styles.idle}>{PLAYGROUND_COPY.idleHint}</p> : null}
              headerSlot={headerSlot}
              sampleData={sampleData}
              nanoSettingUp={nanoSettingUp}
            />
            <div className={styles.askRow}>
              <QuestionInput
                ref={inputRef}
                label={PLAYGROUND_COPY.inputLabel}
                labelHidden
                placeholder={PLAYGROUND_COPY.inputPlaceholder}
                value={question}
                onChange={(q) => useAskPlayground.getState().setQuestion(q)}
                onSubmit={onAsk}
                variant="playground"
                button={
                  preparing ? (
                    <Button variant="secondary" onClick={() => useAskPlayground.getState().stop()}>
                      {PLAYGROUND_COPY.stop}
                    </Button>
                  ) : (
                    <Button type="submit" variant="primary">
                      {PLAYGROUND_COPY.ask}
                    </Button>
                  )
                }
              />
            </div>
          </>
        )}
      </div>

      <div id={ids.seenPanel} role="tabpanel" aria-labelledby={ids.seen} hidden={tab !== 'seen'} className={styles.seenPanel}>
        <PlaygroundReceipts receipts={receipts} />
      </div>
    </section>
  );
}

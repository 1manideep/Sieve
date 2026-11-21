// Playground (`/playground`, 40 sections 13.9 and 13.2a): a pretend computer with sample mail, photos and documents,
// no login. The golden path runs through useAskPlayground on the Playground database (40 section 12). The final
// design: the public header with the Ask / What has AI seen? tabs, a quiet device row (the model toggle, the setup and
// extension strips), then F2 (the prompt card over "What is on this computer") or F3 (the conversation).
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { TITLES } from '@/copy/strings';
import { APPROVAL_COPY, PLAYGROUND_COPY, PLAYGROUND_SUGGESTION_COPY, fill } from '@/copy/screens-main';
import { Button } from '@/components/Button/Button';
import { useDb } from '@/components/dbTables';
import { DeviceFrame } from '@/components/DeviceFrame/DeviceFrame';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { ItemViewer } from '@/components/ItemViewer/ItemViewer';
import { NoticeRow } from '@/components/AskResult/NoticeRow';
import { ModelSetupPanel } from '@/components/ModelSetupPanel/ModelSetupPanel';
import { ProgressBar } from '@/components/ProgressBar/ProgressBar';
import { Tag } from '@/components/Tag/Tag';
import { TraceList } from '@/components/TraceList/TraceList';
import { TrySlot } from '@/components/TrySlot/TrySlot';
import { playgroundSuggestions, uploadQuestion } from '@/playground/suggestions';
import { playgroundBridge } from '@/relay/playgroundBridge';
import { announce } from '@/state/announcer';
import { useAskPlayground } from '@/state/ask';
import { useAvailability } from '@/state/availability';
import { useNetwork } from '@/state/network';
import { usePlayground, type TestEmailInput } from '@/state/playground';
import { useReceipts } from '@/state/receipts';
import { useSession } from '@/state/session';
import { useToasts } from '@/state/toasts';
import type { TraceStep } from '@sieve/shared';
import { AssistantLauncher } from './assistant/AssistantLauncher';
import { AskPanel } from './AskPanel';
import { ExtensionStrip } from './ExtensionStrip';
import { FilesWindow, type FilesWindowHandle } from './FilesWindow';
import { ModelToggle } from './ModelToggle';
import { PlaygroundHeader } from './PlaygroundHeader';
import { answeredInCloud, answeredOnDevice, isOwnItem, modelTag, playgroundModel, selectMs } from './playgroundModel';
import { PlaygroundReceipts } from './PlaygroundReceipts';
import styles from './playground.module.css';

const NARROW = '(max-width: 1023px)';
export const SEED_NOTICE_DELAY_MS = 300;

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

function report(error: unknown): void {
  console.error(error);
}

function ask(q: string): void {
  const store = useAskPlayground.getState();
  store.setQuestion(q);
  store.ask(q).catch(report);
}

/** Store actions are called defensively: a failing action must never take the pretend computer down. */
function safely(run: () => void): void {
  try {
    run();
  } catch (error) {
    report(error);
  }
}

export function PlaygroundScreen() {
  const pg = usePlayground(
    useShallow((s) => ({
      status: s.status, seedProgress: s.seedProgress, error: s.error, simulate: s.simulateNoModel,
      composing: s.composing, added: s.added, tab: s.tab, openFolder: s.openFolder,
    })),
  );
  const { text, image, setup } = useAvailability(useShallow((s) => ({ text: s.text, image: s.image, setup: s.setup })));
  const online = useNetwork((s) => s.online);
  const receipts = useReceipts((s) => s.receipts);
  const { proposal, phase, requestId, question } = useAskPlayground(
    useShallow((s) => ({ proposal: s.proposal, phase: s.phase, requestId: s.requestId, question: s.question })),
  );
  const db = useDb('playground');
  const narrow = useMediaQuery(NARROW);
  const model = playgroundModel(text, setup.state, pg.simulate);
  const tag = modelTag(model);
  const [viewing, setViewing] = useState<string | null>(null);
  const [slowSeed, setSlowSeed] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [before, setBefore] = useState<{ trace: TraceStep[]; ms: number; requestId?: string } | null>(null);
  const files = useRef<FilesWindowHandle | null>(null);
  const ids = { ask: useId(), seen: useId(), askPanel: useId(), seenPanel: useId() };

  // Mount: the auth listener and anonymous sign-in (non-blocking), seed the device, local receipts, and this tab's
  // port to the extension (50 section 11). Unmount: the port closes and the simulation ends here.
  useEffect(() => {
    useSession.getState().ensureAnonymous().catch(report);
    usePlayground.getState().start().catch(report);
    let stopReceipts: () => void = () => undefined;
    safely(() => {
      stopReceipts = useReceipts.getState().start('playground');
    });
    let stopBridge: () => void = () => undefined;
    safely(() => {
      stopBridge = playgroundBridge.start();
    });
    return () => {
      safely(stopBridge);
      stopReceipts();
      safely(() => usePlayground.getState().setSimulateNoModel(false));
    };
  }, []);

  // "Setting up the pretend computer…" only when seeding takes longer than 300 ms.
  useEffect(() => {
    if (pg.status !== 'opening' && pg.status !== 'seeding' && pg.status !== 'resetting') return undefined;
    const timer = setTimeout(() => setSlowSeed(true), SEED_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pg.status]);

  // The switch moment (40 section 13.2a item 4): Nano became ready while this page was open.
  useEffect(
    () =>
      useAvailability.subscribe((s, prev) => {
        if (prev.text !== 'available' && s.text === 'available' && !usePlayground.getState().simulateNoModel) {
          setSwitched(true);
          useToasts.getState().push({ tone: 'success', title: PLAYGROUND_COPY.readyToast });
        }
      }),
    [],
  );

  const indexedFiles = pg.added.filter((a) => a.kind === 'file' && a.status === 'indexed');
  const suggestions = playgroundSuggestions({
    hasTestEmail: pg.added.some((a) => a.kind === 'test-email' && a.status === 'indexed'),
    latestFileName: indexedFiles[indexedFiles.length - 1]?.name,
  });

  const addFiles = async (files: File[]) => {
    try {
      await usePlayground.getState().addFiles(files);
    } catch (error) {
      report(error);
      return;
    }
    const added = usePlayground.getState().added.filter((a) => a.kind === 'file' && a.status === 'indexed');
    const newest = [...files].reverse().find((f) => added.some((a) => a.name === f.name));
    if (!newest) return;
    announce(fill(PLAYGROUND_COPY.addedAnnounce, { name: newest.name }));
    ask(uploadQuestion(newest.name));
  };

  const addTestEmail = async (input: TestEmailInput, question?: string) => {
    try {
      await usePlayground.getState().addTestEmail(input);
    } catch (error) {
      report(error);
      return;
    }
    usePlayground.getState().setComposing(false);
    ask(question ?? PLAYGROUND_SUGGESTION_COPY.mytest);
  };

  const simulate = (on: boolean) => {
    safely(() => usePlayground.getState().setSimulateNoModel(on));
    useAskPlayground.getState().reset();
    setBefore(null);
    announce(on ? PLAYGROUND_COPY.announceSimulate : PLAYGROUND_COPY.announceReal);
  };

  const reset = async () => {
    try {
      await usePlayground.getState().reset();
    } catch (error) {
      report(error);
    }
    useAskPlayground.getState().reset();
    useAskPlayground.getState().setQuestion('');
    safely(() => usePlayground.getState().setSimulateNoModel(false));
    usePlayground.getState().setTab('ask');
    setBefore(null);
    useToasts.getState().push({ tone: 'success', title: PLAYGROUND_COPY.resetDone });
  };

  // 13.2a items 3 and 4: the cloud-while-setting-up tag, "Ask again on this device", and the before/now timings.
  const cloudAnswered = answeredInCloud(proposal);
  const showCompare = before !== null && answeredOnDevice(proposal) && requestId !== before.requestId && phase !== 'preparing';
  const headerSlot =
    cloudAnswered || showCompare ? (
      <div className={styles.switchSlot}>
        {cloudAnswered && model === 'setting-up' ? <Tag tone="cloud">{APPROVAL_COPY.cloudWhileSetup}</Tag> : null}
        {cloudAnswered && switched && model === 'ready' && phase !== 'preparing' ? (
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setBefore({ trace: proposal?.trace ?? [], ms: selectMs(proposal), requestId });
                ask(question);
              }}
            >
              {APPROVAL_COPY.askAgainDevice}
            </Button>
          </div>
        ) : null}
        {showCompare && before ? (
          <div className={styles.compare}>
            <p className={styles.compareLine}>{fill(APPROVAL_COPY.beforeNow, { cloudMs: before.ms, deviceMs: selectMs(proposal) })}</p>
            <div className={styles.compareLists}>
              <TraceList steps={before.trace} heading={APPROVAL_COPY.beforeHeading} sampleData defaultOpen />
              <TraceList steps={proposal?.trace ?? []} heading={APPROVAL_COPY.nowHeading} defaultOpen />
            </div>
            <p className={styles.panelNote}>{APPROVAL_COPY.deviceFootnote}</p>
          </div>
        ) : null}
      </div>
    ) : undefined;

  const storageBlocked = typeof indexedDB === 'undefined' || /storage|indexeddb/i.test(pg.error ?? '');
  let setupNotice: ReactNode;
  if (pg.status === 'error') {
    setupNotice = storageBlocked ? (
      <NoticeRow tone="warning" live>
        <p>{PLAYGROUND_COPY.storageBlocked}</p>
      </NoticeRow>
    ) : (
      <NoticeRow
        tone="warning"
        live
        actions={
          <Button variant="ghost" size="sm" onClick={() => usePlayground.getState().start().catch(report)}>
            {PLAYGROUND_COPY.tryAgain}
          </Button>
        }
      >
        <p>{PLAYGROUND_COPY.seedError}</p>
      </NoticeRow>
    );
  } else if (slowSeed && (pg.status === 'opening' || pg.status === 'seeding' || pg.status === 'resetting')) {
    const { done, total } = pg.seedProgress;
    setupNotice = (
      <div className={styles.seeding} role="status">
        <p>{PLAYGROUND_COPY.seeding}</p>
        <ProgressBar value={total > 0 ? done / total : undefined} label={PLAYGROUND_COPY.seedProgress} />
      </div>
    );
  }

  // Before a question (or while the sample data is still being set up) the Ask tab is F2, whose headline is the h1.
  const hero = pg.tab === 'ask' && (phase === 'idle' || setupNotice !== undefined);
  const tabs = { tab: pg.tab, onTab: (t: 'ask' | 'seen') => usePlayground.getState().setTab(t), seenCount: receipts.length, ids };

  return (
    <div className={styles.screen}>
      <PlaygroundHeader onReset={reset} tabs={tabs} />
      <main id="main" tabIndex={-1} className={styles.main}>
        {hero ? null : <h1 className="visually-hidden">{PLAYGROUND_COPY.heading}</h1>}
        <ErrorBoundary>
          <DeviceFrame
            label={PLAYGROUND_COPY.toolbarLabel}
            controlsAt="bottom"
            toolbar={
              <>
                <span className={styles.modelLabel}>{PLAYGROUND_COPY.modelLabel}</span>
                <ModelToggle model={model} onSimulate={simulate} />
                <Tag tone={tag.tone}>{tag.text}</Tag>
              </>
            }
            strip={
              <div className={styles.strips}>
                <div className={styles.strip}>
                  <ModelSetupPanel variant="compact" backHref="/playground" />
                  <TrySlot />
                </div>
                <ExtensionStrip />
              </div>
            }
          >
            <AskPanel
              id={ids.askPanel}
              labelledBy={ids.ask}
              hidden={pg.tab !== 'ask'}
              model={model}
              suggestions={suggestions}
              online={online}
              onAsk={ask}
              onSeeReceipts={() => usePlayground.getState().setTab('seen')}
              headerSlot={headerSlot}
              sampleData={!isOwnItem(proposal)}
              nanoSettingUp={model === 'setting-up'}
              setupNotice={setupNotice}
              onAttach={() => files.current?.pickFiles()}
              computer={
                <FilesWindow
                  pickRef={files}
                  db={db}
                  added={pg.added}
                  openFolder={pg.openFolder}
                  onOpenFolder={(f) => usePlayground.getState().setOpenFolder(f)}
                  onOpenItem={setViewing}
                  composing={pg.composing}
                  onComposing={(on) => usePlayground.getState().setComposing(on)}
                  onAddFiles={(files) => void addFiles(files)}
                  onAddTestEmail={(input, question) => void addTestEmail(input, question)}
                  liveCaptions={image === 'available' && !pg.simulate}
                  narrow={narrow}
                />
              }
            />
            <div id={ids.seenPanel} role="tabpanel" aria-labelledby={ids.seen} hidden={pg.tab !== 'seen'} className={styles.seenPanel}>
              <PlaygroundReceipts receipts={receipts} />
            </div>
          </DeviceFrame>
        </ErrorBoundary>
        <AssistantLauncher />
        <p className={styles.footnote}>{PLAYGROUND_COPY.footnote}</p>
      </main>
      <ItemViewer dbKind="playground" recordId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.playground);
  return <PlaygroundScreen />;
}

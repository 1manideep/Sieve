// First-run setup (`/setup`, 40 section 13.3): four steps, each revisitable. Connect first: step 1 is the Gmail and
// folder cards with live progress, and indexing runs in the background from there. The model download in step 2
// continues if the person moves on. Gmail in step 1 is fenced (00 D9) by the Sources card it reuses.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { defaultDeviceLabel } from '@/app/deviceId';
import { env } from '@/app/env';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button, LinkButton } from '@/components/Button/Button';
import { tablesOf, useDb } from '@/components/dbTables';
import { Icon } from '@/components/icons';
import { ModelSetupPanel } from '@/components/ModelSetupPanel/ModelSetupPanel';
import { STATUS_POPOVER, TITLES } from '@/copy/strings';
import { SETUP_COPY, fill } from '@/copy/screens-main';
import kit from '@/screens/settings/kit/kit.module.css';
import { ScreenHead } from '@/screens/settings/kit/ScreenHead';
import { SourceCard } from '@/screens/sources/SourceCard';
import { preloadSources, type SourceRowView } from '@/state/sources';
import { useAvailability } from '@/state/availability';
import { useHomeBase, type ExtensionStatus } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import styles from './setup.module.css';

export const STEPS = 4;
export const LABEL_MAX = 40;

export function setupDoneKey(uid: string): string {
  return `sieve.setupDone.${uid}`;
}

function markSetupDone(uid: string | undefined): void {
  if (!uid) return;
  try {
    localStorage.setItem(setupDoneKey(uid), '1');
  } catch (error) {
    console.error(error);
  }
}

function extensionText(status: ExtensionStatus): string | null {
  switch (status) {
    case 'connected':
      return STATUS_POPOVER.extensionConnected;
    case 'not-installed':
      return STATUS_POPOVER.extensionNotInstalled;
    case 'reconnecting':
      return STATUS_POPOVER.extensionReconnecting;
    case 'idle':
    case 'connecting':
      return STATUS_POPOVER.extensionIdle;
    case 'off':
      return null;
  }
}

function StepCard({ n, title, children, footer, focusOnMount }: { n: number; title: string; children: ReactNode; footer: ReactNode; focusOnMount: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
    // Once per step: focus follows the person to the step they moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return (
    <section className={`${kit.glass} ${styles.card}`} aria-labelledby={`setup-step-${n}`}>
      <h2 id={`setup-step-${n}`} ref={headingRef} tabIndex={-1} className={styles.cardTitle}>
        {title}
      </h2>
      <div className={styles.cardBody}>{children}</div>
      <div className={styles.cardFooter}>{footer}</div>
    </section>
  );
}

function HomeBaseStep() {
  const deviceId = useSession((s) => s.deviceId);
  const homeBaseDeviceId = useHomeBase((s) => s.homeBaseDeviceId);
  const [name, setName] = useState(defaultDeviceLabel);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const done = homeBaseDeviceId !== undefined && homeBaseDeviceId === deviceId;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const label = name.trim();
    if (label.length < 1 || label.length > LABEL_MAX) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      await useHomeBase.getState().makeThisHomeBase(label);
    } catch (error) {
      console.error(error);
      useToasts.getState().push({ tone: 'error', title: SETUP_COPY.homeBaseFailed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className={styles.text}>{SETUP_COPY.step3Body}</p>
      {done ? (
        <p className={styles.done} role="status">
          <Icon name="check" size={20} />
          {SETUP_COPY.step3Done}
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <label htmlFor={inputId} className={styles.label}>
            {SETUP_COPY.nameLabel}
          </label>
          <div className={styles.row}>
            <input
              id={inputId}
              className={styles.input}
              value={name}
              maxLength={LABEL_MAX}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="primary" busy={busy} disabled={busy}>
              {SETUP_COPY.makeHomeBase}
            </Button>
          </div>
          {invalid ? (
            <p id={errorId} className={styles.error}>
              {SETUP_COPY.nameError}
            </p>
          ) : null}
        </form>
      )}
    </>
  );
}

/** The real index's source rows, live (undefined until read). Waits for the owner check (40 section 6.4). */
function useSourceRows(): SourceRowView[] | undefined {
  const ownerConflict = useSession((s) => s.ownerConflict);
  const db = useDb('real', !ownerConflict);
  return useLiveQuery(async () => (db ? ((await tablesOf(db).sources.toArray()) as SourceRowView[]) : []), [db]);
}

function SourcesStep({ rows }: { rows: SourceRowView[] | undefined }) {
  const row = (kind: 'gmail' | 'folder') => rows?.find((r) => r.kind === kind);
  // Load the source modules ahead of the click, so the Google popup and the folder picker open inside it.
  useEffect(() => {
    preloadSources().catch((error: unknown) => console.error(error));
  }, []);
  return (
    <>
      <p className={styles.text}>{SETUP_COPY.step1Body}</p>
      <div className={styles.sources}>
        <SourceCard kind="gmail" row={row('gmail')} compact />
        <SourceCard kind="folder" row={row('folder')} compact />
      </div>
      <p className={styles.note}>{SETUP_COPY.step1Note}</p>
    </>
  );
}

function ModelStep({ settingUp }: { settingUp: boolean }) {
  return (
    <>
      <ModelSetupPanel embedded backHref="/setup" />
      {settingUp ? <p className={styles.note}>{SETUP_COPY.step2Note}</p> : null}
    </>
  );
}

function NotifyStep() {
  const pushEnabled = useSettings((s) => s.settings.pushEnabled);
  const extension = useHomeBase((s) => s.extension);
  const [message, setMessage] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const pushId = useId();
  const noteId = useId();
  const extText = env.extensionId ? extensionText(extension) : null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const result = await useSettings.getState().setPushEnabled(on);
      if (result === 'unsupported') {
        setUnsupported(true);
        setMessage(SETUP_COPY.pushUnsupported);
      } else if (result === 'denied') setMessage(SETUP_COPY.pushDenied);
      else if (result === 'error') useToasts.getState().push({ tone: 'error', title: SETUP_COPY.pushError });
      else setMessage(null);
    } catch (error) {
      console.error(error);
      useToasts.getState().push({ tone: 'error', title: SETUP_COPY.pushError });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.check}>
        <label htmlFor={pushId} className={styles.checkRow}>
          <input
            id={pushId}
            type="checkbox"
            checked={pushEnabled}
            disabled={unsupported || busy}
            aria-describedby={noteId}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {SETUP_COPY.push}
        </label>
        <p id={noteId} className={styles.note}>
          {message ?? SETUP_COPY.pushNote}
        </p>
      </div>
      {extText ? (
        <div className={styles.extension}>
          <p className={styles.label}>{SETUP_COPY.extensionTitle}</p>
          <p className={styles.text}>{extText}</p>
          {extension !== 'connected' ? (
            <LinkButton to={env.extensionStoreUrl ?? `${env.repoUrl}#extension`} external variant="secondary" size="sm">
              {SETUP_COPY.getExtension}
            </LinkButton>
          ) : null}
        </div>
      ) : null}
      <p className={styles.text}>
        <Link to="/settings?connect=1#ais">{SETUP_COPY.connectAi}</Link>
      </p>
    </>
  );
}

export function SetupScreen() {
  const navigate = useNavigate();
  const uid = useSession((s) => s.user?.uid);
  const { text, setup } = useAvailability(useShallow((s) => ({ text: s.text, setup: s.setup })));
  const sourceRows = useSourceRows();
  const sourcesConnected = sourceRows?.some((r) => r.connected && r.kind !== 'playground') ?? false;
  const [step, setStepState] = useState(1);
  const [moved, setMoved] = useState(false);
  const setStep = (n: number) => {
    setMoved(true);
    setStepState(n);
  };
  const finish = () => {
    markSetupDone(uid);
    navigate('/ask');
  };
  const back = step > 1 ? (
    <Button variant="secondary" onClick={() => setStep(step - 1)}>
      {SETUP_COPY.back}
    </Button>
  ) : (
    <span />
  );
  const nextLabel = (doneHere: boolean) => (doneHere ? SETUP_COPY.next : SETUP_COPY.skipForNow);
  const next = (doneHere: boolean) => (
    <Button variant={doneHere ? 'primary' : 'secondary'} onClick={() => setStep(step + 1)}>
      {nextLabel(doneHere)}
    </Button>
  );

  return (
    <div className={styles.page}>
      <ScreenHead
        title={SETUP_COPY.heading}
        actions={
          <Button variant="ghost" onClick={finish}>
            {SETUP_COPY.skip}
          </Button>
        }
      />
      <div className={styles.stepper}>
        <p className={styles.stepOf}>{fill(SETUP_COPY.stepOf, { n: step })}</p>
        <span className={styles.dots} aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i + 1 === step ? `${styles.dot} ${styles.dotOn}` : i + 1 < step ? `${styles.dot} ${styles.dotDone}` : styles.dot} />
          ))}
        </span>
      </div>

      {step === 1 ? (
        <StepCard focusOnMount={moved} n={1} title={SETUP_COPY.step1Title} footer={<>{back}{next(sourcesConnected)}</>}>
          <SourcesStep rows={sourceRows} />
        </StepCard>
      ) : null}
      {step === 2 ? (
        <StepCard focusOnMount={moved} n={2} title={SETUP_COPY.step2Title} footer={<>{back}{next(text === 'available' || setup.state === 'done')}</>}>
          <ModelStep settingUp={setup.state === 'downloading' || setup.state === 'installing'} />
        </StepCard>
      ) : null}
      {step === 3 ? (
        <StepCard focusOnMount={moved} n={3} title={SETUP_COPY.step3Title} footer={<>{back}<HomeBaseNext onNext={() => setStep(4)} /></>}>
          <HomeBaseStep />
        </StepCard>
      ) : null}
      {step === 4 ? (
        <StepCard
          focusOnMount={moved}
          n={4}
          title={SETUP_COPY.step4Title}
          footer={
            <>
              {back}
              <Button variant="primary" onClick={finish}>
                {SETUP_COPY.finish}
              </Button>
            </>
          }
        >
          <NotifyStep />
        </StepCard>
      ) : null}
    </div>
  );
}

function HomeBaseNext({ onNext }: { onNext(): void }) {
  const deviceId = useSession((s) => s.deviceId);
  const done = useHomeBase((s) => s.homeBaseDeviceId !== undefined && s.homeBaseDeviceId === deviceId);
  return (
    <Button variant={done ? 'primary' : 'secondary'} onClick={onNext}>
      {done ? SETUP_COPY.next : SETUP_COPY.skipForNow}
    </Button>
  );
}

export function Component() {
  useDocumentTitle(TITLES.setup);
  return <SetupScreen />;
}

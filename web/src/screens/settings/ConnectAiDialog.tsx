// "Connect an AI" (40 section 13.8.2): name, limits, then the connector link, shown once. The link lives only in this
// component's state (10.5): never in a store, a log, localStorage, the URL or an error message, and it is cleared
// when the dialog closes.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, GRANT_DEFAULT_DAYS, LADDER_STEPS, type Category, type LadderStep, type SourceKind } from '@sieve/shared';
import { Button } from '@/components/Button/Button';
import { Chip } from '@/components/Chip/Chip';
import { Dialog } from '@/components/Dialog/Dialog';
import { Notice } from '@/components/Notice/Notice';
import { SETTINGS, SOURCES } from '@/copy/screens-controls';
import { announce } from '@/state/announcer';
import { useGrants } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useSettings } from '@/state/settings';
import { Confirm } from './kit/Confirm';
import { Fill, Iso } from './kit/Fill';
import { REAL_SOURCES, type RealSource } from '../sources/sourcesDb';
import { callableMessage } from './settingsText';
import kit from './kit/kit.module.css';
import styles from './settings.module.css';

export const AI_NAME_MAX = 40;
const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];
const DAY_LABELS: Record<Days, string> = { 7: SETTINGS.days7, 30: SETTINGS.days30, 90: SETTINGS.days90 };
/** 30 days, GRANT_DEFAULT_DAYS (01 section 1). */
const DEFAULT_DAYS: Days = DAYS.find((d) => d === GRANT_DEFAULT_DAYS) ?? 30;
export const CAP_NOTES: Record<LadderStep, string> = {
  answer: SETTINGS.capNoteAnswer,
  excerpt: SETTINGS.capNoteExcerpt,
  full: SETTINGS.capNoteFull,
};
export const CAP_LABELS: Record<LadderStep, string> = {
  answer: SETTINGS.capAnswer,
  excerpt: SETTINGS.capExcerpt,
  full: SETTINGS.capFull,
};

/** One radio or checkbox row; the note is the control's description, not part of its name. */
export function Choice(props: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange(): void;
  label: ReactNode;
  note?: string;
}) {
  const noteId = useId();
  return (
    <div className={styles.choiceRow}>
      <label className={styles.choice}>
        <input
          type={props.type}
          name={props.name}
          checked={props.checked}
          onChange={props.onChange}
          aria-describedby={props.note ? noteId : undefined}
        />
        <span className={styles.choiceLabel}>{props.label}</span>
      </label>
      {props.note ? (
        <p id={noteId} className={styles.choiceNote}>
          {props.note}
        </p>
      ) : null}
    </div>
  );
}

export interface ConnectAiDialogProps {
  open: boolean;
  onClose(): void;
  /** Connected real sources; when none are connected, all three are ticked. */
  connected: RealSource[];
}

type Step = 1 | 2 | 3;

export function ConnectAiDialog({ open, onClose, connected }: ConnectAiDialogProps) {
  const rules = useSettings((s) => s.settings.categoryRules);
  const online = useNetwork((s) => s.online);
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [maxStep, setMaxStep] = useState<LadderStep>('answer');
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<SourceKind[]>([]);
  const [days, setDays] = useState<Days>(DEFAULT_DAYS);
  const [limitError, setLimitError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [link, setLink] = useState<string | null>(null);
  const [aiName, setAiName] = useState('');
  const [copied, setCopied] = useState(false);
  const [everCopied, setEverCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const formId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const nameHelpId = useId();
  const linkId = useId();

  // Fresh values each time the dialog opens (state adjusted during render, not in an effect). `connected` is read
  // when it opens; later changes do not reset a dialog in progress.
  const [shownOpen, setShownOpen] = useState(false);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setStep(1);
      setName('');
      setNameInvalid(false);
      setMaxStep('answer');
      setCategories(CATEGORIES.filter((c) => c !== 'Health'));
      setSources(connected.length > 0 ? [...connected] : [...REAL_SOURCES]);
      setDays(DEFAULT_DAYS);
      setLimitError(false);
      setCreating(false);
      setError(undefined);
      setLink(null);
      setAiName('');
      setCopied(false);
      setEverCopied(false);
      setConfirmClose(false);
    }
  }

  useEffect(() => {
    if (open && step > 1) stepRef.current?.focus();
  }, [open, step]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const close = () => {
    setLink(null);
    setConfirmClose(false);
    onClose();
  };
  const done = () => {
    if (link !== null && !everCopied) setConfirmClose(true);
    else close();
  };
  const dismiss = () => {
    if (creating) return;
    if (step === 3) done();
    else close();
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (step === 1) {
      const trimmed = name.trim().replace(/\s+/g, ' ');
      if (trimmed.length < 1 || trimmed.length > AI_NAME_MAX) {
        setNameInvalid(true);
        return;
      }
      setName(trimmed);
      setStep(2);
      return;
    }
    if (step === 2) void create();
  };

  const create = async () => {
    if (categories.length === 0 || sources.length === 0) {
      setLimitError(true);
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const result = await useGrants.getState().create({
        aiName: name,
        maxStep,
        allowedCategories: CATEGORIES.filter((c) => categories.includes(c)),
        allowedSources: REAL_SOURCES.filter((k) => sources.includes(k)),
        days,
      });
      setAiName(name);
      setLink(result.link);
      setStep(3);
    } catch (e) {
      setError(callableMessage(e, online));
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setEverCopied(true);
      announce(SETTINGS.linkCopied);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      (document.getElementById(linkId) as HTMLInputElement | null)?.select();
    }
  };

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  let footer;
  if (step === 1) {
    footer = (
      <>
        <Button variant="secondary" onClick={close}>
          {SETTINGS.cancel}
        </Button>
        <Button variant="primary" type="submit" form={formId}>
          {SETTINGS.next}
        </Button>
      </>
    );
  } else if (step === 2) {
    footer = (
      <>
        <Button variant="secondary" onClick={() => setStep(1)} disabled={creating}>
          {SETTINGS.back}
        </Button>
        <Button variant="primary" type="submit" form={formId} busy={creating} disabled={creating}>
          {creating ? SETTINGS.creating : SETTINGS.create}
        </Button>
      </>
    );
  } else {
    footer = (
      <Button variant="primary" onClick={done}>
        {SETTINGS.done}
      </Button>
    );
  }

  return (
    <>
      <Dialog open={open} title={SETTINGS.connectTitle} onClose={dismiss} dismissible={!creating} size="md" footer={footer}>
        <form id={formId} className={styles.dialogBody} onSubmit={next} noValidate>
          {step === 1 ? (
            <div className={kit.form}>
              <label htmlFor={nameId} className={styles.stepTitle}>
                {SETTINGS.stepWhich}
              </label>
              <input
                id={nameId}
                className={kit.input}
                type="text"
                value={name}
                maxLength={AI_NAME_MAX}
                aria-invalid={nameInvalid || undefined}
                aria-describedby={nameInvalid ? `${nameErrorId} ${nameHelpId}` : nameHelpId}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameInvalid) setNameInvalid(false);
                }}
              />
              {nameInvalid ? (
                <p id={nameErrorId} className={kit.error}>
                  {SETTINGS.nameError}
                </p>
              ) : null}
              <div className={styles.chips} role="group" aria-label={SETTINGS.quickFillLabel}>
                {SETTINGS.quickFill.map((label) => (
                  <Chip
                    key={label}
                    selected={name === label}
                    selectedStyle="inverse"
                    onClick={() => {
                      setName(label);
                      setNameInvalid(false);
                    }}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
              <p id={nameHelpId} className={kit.help}>
                {SETTINGS.nameHelp}
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className={styles.dialogBody}>
              <h3 ref={stepRef} tabIndex={-1} className={styles.stepTitle}>
                {SETTINGS.stepWhat}
              </h3>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>{SETTINGS.mostItCanGet}</legend>
                {LADDER_STEPS.map((s) => (
                  <Choice
                    key={s}
                    type="radio"
                    name={`${formId}-cap`}
                    checked={maxStep === s}
                    onChange={() => setMaxStep(s)}
                    label={CAP_LABELS[s]}
                    note={CAP_NOTES[s]}
                  />
                ))}
              </fieldset>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>{SETTINGS.categories}</legend>
                <div className={styles.twoColumns}>
                  {CATEGORIES.map((c) => (
                    <Choice
                      key={c}
                      type="checkbox"
                      checked={categories.includes(c)}
                      onChange={() => {
                        setCategories((list) => toggle(list, c));
                        setLimitError(false);
                      }}
                      label={
                        rules[c] === 'never' ? (
                          <>
                            {c} <span className={styles.suffix}>{SETTINGS.neverSuffix}</span>
                          </>
                        ) : (
                          c
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>{SETTINGS.sources}</legend>
                {REAL_SOURCES.map((k) => (
                  <Choice
                    key={k}
                    type="checkbox"
                    checked={sources.includes(k)}
                    onChange={() => {
                      setSources((list) => toggle(list, k));
                      setLimitError(false);
                    }}
                    label={SOURCES.names[k]}
                  />
                ))}
              </fieldset>
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>{SETTINGS.expiresIn}</legend>
                <div className={styles.inline}>
                  {DAYS.map((d) => (
                    <Choice
                      key={d}
                      type="radio"
                      name={`${formId}-days`}
                      checked={days === d}
                      onChange={() => setDays(d)}
                      label={DAY_LABELS[d]}
                    />
                  ))}
                </div>
              </fieldset>
              {limitError ? <p className={kit.error}>{SETTINGS.keepOne}</p> : null}
              {error ? (
                <div role="status">
                  <Notice tone="warning">{error}</Notice>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 && link !== null ? (
            <div className={styles.dialogBody}>
              <h3 ref={stepRef} tabIndex={-1} className={styles.stepTitle}>
                <Fill template={SETTINGS.stepLink} values={{ aiName: <Iso>{aiName}</Iso> }} />
              </h3>
              <Notice tone="warning">
                <Fill template={SETTINGS.copyNow} values={{ aiName: <Iso>{aiName}</Iso> }} />
              </Notice>
              <label htmlFor={linkId} className="visually-hidden">
                {SETTINGS.linkLabel}
              </label>
              <div className={styles.linkRow}>
                <input
                  id={linkId}
                  className={`${kit.input} ${styles.link}`}
                  type="text"
                  readOnly
                  value={link}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="secondary" icon="copy" onClick={() => void copy()}>
                  {copied ? SETTINGS.copied : SETTINGS.copyLink}
                </Button>
              </div>
              <h4 className={styles.howTo}>{SETTINGS.howTo}</h4>
              <ol className={styles.steps}>
                <li>
                  <Fill template={SETTINGS.howTo1} values={{ aiName: <Iso>{aiName}</Iso> }} />
                </li>
                <li>{SETTINGS.howTo2}</li>
                <li>{SETTINGS.howTo3}</li>
              </ol>
            </div>
          ) : null}
        </form>
      </Dialog>
      <Confirm
        open={confirmClose}
        title={SETTINGS.closeTitle}
        body={SETTINGS.closeBody}
        confirmLabel={SETTINGS.closeConfirm}
        cancelLabel={SETTINGS.closeCancel}
        onCancel={() => setConfirmClose(false)}
        onConfirm={close}
      />
    </>
  );
}


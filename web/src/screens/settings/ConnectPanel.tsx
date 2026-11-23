// The connect panel (40 section 13.8.2; design handoff of Nov 20, 2026): pressing an assistant that has no
// connection opens this in place, and so does New connection on one that has. Step 1 sets the limits; step 2 shows
// the connector link, once. The link lives only in this component's state (10.5): never in a store, a log,
// localStorage, the URL or an error message.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CATEGORIES, GRANT_DEFAULT_DAYS, LADDER_STEPS, type Category, type LadderStep } from '@sieve/shared';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { ASSISTANTS, type AssistantKind } from '@/components/AssistantMark/assistants';
import { Button } from '@/components/Button/Button';
import { Notice } from '@/components/Notice/Notice';
import { Segmented } from '@/components/Segmented/Segmented';
import { SETTINGS, SOURCES, fillText } from '@/copy/screens-controls';
import { announce } from '@/state/announcer';
import { useGrants } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useSettings } from '@/state/settings';
import { LineIcon, SOURCE_ICONS } from '../sources/sourceIcons';
import { REAL_SOURCES, type RealSource } from '../sources/sourcesDb';
import { CAP_LABELS, CAP_NOTES } from './Choice';
import { Confirm } from './kit/Confirm';
import { Fill, Iso } from './kit/Fill';
import ground from './kit/ground.module.css';
import kit from './kit/kit.module.css';
import { callableMessage, categoriesLabel, sourcesLabel } from './settingsText';
import styles from './settings.module.css';

export const AI_NAME_MAX = 40;
type Days = '7' | '30' | '90';
const DAY_OPTIONS: { value: Days; label: string }[] = [
  { value: '7', label: SETTINGS.days7 },
  { value: '30', label: SETTINGS.days30 },
  { value: '90', label: SETTINGS.days90 },
];
/** 30 days, GRANT_DEFAULT_DAYS (01 section 1). */
const DEFAULT_DAYS: Days = DAY_OPTIONS.find((d) => Number(d.value) === GRANT_DEFAULT_DAYS)?.value ?? '30';
const CAP_OPTIONS = LADDER_STEPS.map((s) => ({ value: s, label: CAP_LABELS[s] }));

export type LinkState = 'none' | 'uncopied' | 'copied';

export interface ConnectPanelProps {
  kind: AssistantKind;
  /** Connected real sources; when none are connected, all three start on. */
  connected: RealSource[];
  /** The link is on screen (and whether it was copied), so the row of marks can ask before leaving it. */
  onLinkChange(state: LinkState): void;
  /** Back to the assistant's live connections; when given, step 1 shows Cancel. */
  onCancel?(): void;
}

export function ConnectPanel({ kind, connected, onLinkChange, onCancel }: ConnectPanelProps) {
  const rules = useSettings((s) => s.settings.categoryRules);
  const online = useNetwork((s) => s.online);
  const spec = ASSISTANTS[kind];
  const named = kind !== 'other';
  const [name, setName] = useState(named ? spec.name : '');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [maxStep, setMaxStep] = useState<LadderStep>('answer');
  const [categories, setCategories] = useState<Category[]>(() => CATEGORIES.filter((c) => rules[c] !== 'never'));
  const [sources, setSources] = useState<RealSource[]>(() => (connected.length > 0 ? [...connected] : [...REAL_SOURCES]));
  const [days, setDays] = useState<Days>(DEFAULT_DAYS);
  const [limitError, setLimitError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [everCopied, setEverCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const titleId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const linkId = useId();

  useEffect(() => {
    if (link !== null) stepRef.current?.focus();
  }, [link]);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 1 || trimmed.length > AI_NAME_MAX) {
      setNameInvalid(true);
      return;
    }
    const allowed = CATEGORIES.filter((c) => categories.includes(c) && rules[c] !== 'never');
    if (allowed.length === 0 || sources.length === 0) {
      setLimitError(true);
      return;
    }
    setName(trimmed);
    setCreating(true);
    setError(undefined);
    try {
      const result = await useGrants.getState().create({
        aiName: trimmed,
        maxStep,
        allowedCategories: allowed,
        allowedSources: REAL_SOURCES.filter((k) => sources.includes(k)),
        days: Number(days),
      });
      setLink(result.link);
      onLinkChange('uncopied');
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
      onLinkChange('copied');
      announce(SETTINGS.linkCopied);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      (document.getElementById(linkId) as HTMLInputElement | null)?.select();
    }
  };

  const close = () => {
    setLink(null);
    setConfirmClose(false);
    onLinkChange('none');
  };
  const done = () => {
    if (!everCopied) setConfirmClose(true);
    else close();
  };

  const allowed = CATEGORIES.filter((c) => categories.includes(c) && rules[c] !== 'never');
  const head = (
    <div className={ground.ph}>
      <AssistantMark kind={kind} size={44} />
      <span className={ground.pt}>
        <h3 id={titleId} className={ground.pn}>
          {named ? fillText(SETTINGS.connectHeading, { name: spec.name }) : SETTINGS.connectTitle}
        </h3>
        <span className={ground.plead}>{named ? fillText(SETTINGS.connectLead, { name: spec.name }) : SETTINGS.connectLeadOther}</span>
      </span>
      <span className={ground.label}>{link === null ? SETTINGS.step1of2 : SETTINGS.step2of2}</span>
    </div>
  );

  if (link !== null) {
    return (
      <article className={ground.panel} aria-labelledby={titleId}>
        {head}
        <div className={ground.cols}>
          <div className={ground.col}>
            <h4 ref={stepRef} tabIndex={-1} className={styles.stepTitle}>
              <Fill template={SETTINGS.stepLink} values={{ aiName: <Iso>{name}</Iso> }} />
            </h4>
            <p className={kit.small}>
              <Fill template={SETTINGS.copyNow} values={{ aiName: <Iso>{name}</Iso> }} />
            </p>
            <div className={styles.linkRow}>
              <label htmlFor={linkId} className="visually-hidden">
                {SETTINGS.linkLabel}
              </label>
              <input id={linkId} className={`${kit.input} ${styles.link}`} type="text" readOnly value={link} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="primary" tone="blue" size="sm" onClick={() => void copy()}>
                {copied ? SETTINGS.copied : SETTINGS.copyLink}
              </Button>
            </div>
            <p className={ground.metaLine}>
              {fillText(SETTINGS.summary, { cap: CAP_LABELS[maxStep], categories: categoriesLabel(allowed), sources: sourcesLabel(sources), days })}
            </p>
          </div>
          <div className={ground.col}>
            <span className={ground.label}>{SETTINGS.howTo}</span>
            <ol className={styles.steps}>
              <li>{kind === 'other' ? <Fill template={SETTINGS.howTo1} values={{ aiName: <Iso>{name}</Iso> }} /> : SETTINGS.howToKinds[kind]}</li>
              <li>{SETTINGS.howTo2}</li>
              <li>{SETTINGS.howTo3}</li>
            </ol>
            <div>
              <Button variant="secondary" size="sm" onClick={done}>
                {SETTINGS.done}
              </Button>
            </div>
          </div>
        </div>
        <Confirm
          open={confirmClose}
          title={SETTINGS.closeTitle}
          body={SETTINGS.closeBody}
          confirmLabel={SETTINGS.closeConfirm}
          cancelLabel={SETTINGS.closeCancel}
          onCancel={() => setConfirmClose(false)}
          onConfirm={close}
        />
      </article>
    );
  }

  return (
    <article className={ground.panel} aria-labelledby={titleId}>
      {head}
      <form className={ground.cols} onSubmit={(e) => void create(e)} noValidate>
        <div className={ground.col}>
          {named ? null : (
            <div className={ground.grp}>
              <label htmlFor={nameId} className={ground.label}>
                {SETTINGS.nameLabel}
              </label>
              <input
                id={nameId}
                className={kit.input}
                type="text"
                value={name}
                maxLength={AI_NAME_MAX}
                aria-invalid={nameInvalid || undefined}
                aria-describedby={nameInvalid ? nameErrorId : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameInvalid) setNameInvalid(false);
                }}
              />
              {nameInvalid ? (
                <p id={nameErrorId} className={kit.error}>
                  {SETTINGS.nameError}
                </p>
              ) : (
                <p>{SETTINGS.nameHelp}</p>
              )}
            </div>
          )}
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.mostItCanGet}</span>
            <Segmented<LadderStep> label={SETTINGS.mostItCanGet} options={CAP_OPTIONS} value={maxStep} onChange={setMaxStep} />
            <p>{CAP_NOTES[maxStep]}</p>
          </div>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.categories}</span>
            <div className={ground.chips} role="group" aria-label={SETTINGS.categories}>
              {CATEGORIES.map((c) =>
                rules[c] === 'never' ? (
                  <span key={c} className={`${ground.chip} ${ground.chipNever}`}>
                    {fillText(SETTINGS.neverChip, { category: c })}
                  </span>
                ) : (
                  <button
                    key={c}
                    type="button"
                    className={ground.chip}
                    aria-pressed={categories.includes(c)}
                    onClick={() => {
                      setCategories((list) => toggle(list, c));
                      setLimitError(false);
                    }}
                  >
                    {c}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
        <div className={ground.col}>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.sources}</span>
            <div className={ground.chips} role="group" aria-label={SETTINGS.sources}>
              {REAL_SOURCES.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={ground.chip}
                  aria-pressed={sources.includes(k)}
                  onClick={() => {
                    setSources((list) => toggle(list, k));
                    setLimitError(false);
                  }}
                >
                  <LineIcon d={SOURCE_ICONS[k]} size={15} />
                  {SOURCES.names[k]}
                </button>
              ))}
            </div>
          </div>
          <div className={ground.grp}>
            <span className={ground.label}>{SETTINGS.expiresIn}</span>
            <Segmented<Days> label={SETTINGS.expiresIn} options={DAY_OPTIONS} value={days} onChange={setDays} />
          </div>
          {limitError ? <p className={kit.error}>{SETTINGS.keepOne}</p> : null}
          {error ? (
            <div role="status">
              <Notice tone="warning">{error}</Notice>
            </div>
          ) : null}
          <div className={ground.actions}>
            <Button variant="primary" tone="blue" type="submit" busy={creating} disabled={creating}>
              {creating ? SETTINGS.creating : SETTINGS.create}
            </Button>
            {onCancel ? (
              <button type="button" className={kit.textButton} disabled={creating} onClick={onCancel}>
                {SETTINGS.cancel}
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </article>
  );
}

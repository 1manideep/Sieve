// Narrow an AI's access (40 section 13.8.3): only lower steps, fewer categories and fewer sources can be chosen.
import { useId, useState, type FormEvent } from 'react';
import { CATEGORIES, LADDER_STEPS, type Category, type SourceKind, type LadderStep } from '@sieve/shared';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { Notice } from '@/components/Notice/Notice';
import { SETTINGS, SOURCES, fillText } from '@/copy/screens-controls';
import { useGrants, type NarrowGrantPatch } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import { REAL_SOURCES } from '../sources/sourcesDb';
import { CAP_LABELS, CAP_NOTES, Choice } from './Choice';
import { callableMessage } from './settingsText';
import kit from './kit/kit.module.css';
import styles from './settings.module.css';

export interface NarrowDialogProps {
  grant: GrantView | null;
  onClose(): void;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export function NarrowDialog({ grant, onClose }: NarrowDialogProps) {
  const online = useNetwork((s) => s.online);
  const [step, setStep] = useState<LadderStep>('answer');
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<SourceKind[]>([]);
  const [keepOne, setKeepOne] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formId = useId();

  // Fresh values when a grant opens (by id, so a snapshot refresh does not reset a dialog in progress).
  const [shownId, setShownId] = useState<string | null>(null);
  const grantId = grant?.id ?? null;
  if (grantId !== shownId) {
    setShownId(grantId);
    if (grant) {
      setStep(grant.maxStep);
      setCategories([...grant.allowedCategories]);
      setSources([...grant.allowedSources]);
      setKeepOne(false);
      setBusy(false);
      setError(undefined);
    }
  }

  if (!grant) return null;

  const cap = LADDER_STEPS.indexOf(grant.maxStep);
  const steps = LADDER_STEPS.filter((_, i) => i <= cap);
  const allowedCategories = CATEGORIES.filter((c) => grant.allowedCategories.includes(c));
  const allowedSources = REAL_SOURCES.filter((k) => grant.allowedSources.includes(k));
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (categories.length === 0 || sources.length === 0) {
      setKeepOne(true);
      return;
    }
    const patch: NarrowGrantPatch = {};
    if (step !== grant.maxStep) patch.maxStep = step;
    if (!sameSet(categories, grant.allowedCategories)) patch.allowedCategories = CATEGORIES.filter((c) => categories.includes(c));
    if (!sameSet(sources, grant.allowedSources)) patch.allowedSources = REAL_SOURCES.filter((k) => sources.includes(k));
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await useGrants.getState().narrow(grant.id, patch);
      useToasts.getState().push({ tone: 'success', title: fillText(SETTINGS.narrowed, { aiName: grant.aiName }) });
      onClose();
    } catch (e) {
      setError(callableMessage(e, online));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={fillText(SETTINGS.narrowTitle, { aiName: grant.aiName })}
      description={SETTINGS.narrowNote}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {SETTINGS.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} busy={busy} disabled={busy}>
            {SETTINGS.save}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.dialogBody} onSubmit={(e) => void save(e)} noValidate>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{SETTINGS.mostItCanGet}</legend>
          {steps.map((s) => (
            <Choice
              key={s}
              type="radio"
              name={`${formId}-cap`}
              checked={step === s}
              onChange={() => setStep(s)}
              label={CAP_LABELS[s]}
              note={CAP_NOTES[s]}
            />
          ))}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{SETTINGS.categories}</legend>
          <div className={styles.twoColumns}>
            {allowedCategories.map((c) => (
              <Choice
                key={c}
                type="checkbox"
                checked={categories.includes(c)}
                onChange={() => {
                  setCategories((l) => toggle(l, c));
                  setKeepOne(false);
                }}
                label={c}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{SETTINGS.sources}</legend>
          {allowedSources.map((k) => (
            <Choice
              key={k}
              type="checkbox"
              checked={sources.includes(k)}
              onChange={() => {
                setSources((l) => toggle(l, k));
                setKeepOne(false);
              }}
              label={SOURCES.names[k]}
            />
          ))}
        </fieldset>
        {keepOne ? <p className={kit.error}>{SETTINGS.keepOne}</p> : null}
        {error ? (
          <div role="status">
            <Notice tone="warning">{error}</Notice>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

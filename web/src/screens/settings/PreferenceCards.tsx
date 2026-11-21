// Category rules, default step and cloud fallback (40 sections 13.8.4 to 13.8.6; design handoff of Nov 20, 2026).
// The rules are bare tiles, one per category, each with its icon and its rule in a word; pressing a tile opens its
// editor as a band under the row. The default step and cloud fallback are rows under "More". Writes are optimistic
// in useSettings; each shows its own save status.
import { useId, useState } from 'react';
import { CATEGORIES, LADDER_LABELS, LADDER_STEPS, type Category, type CategoryRule, type LadderStep } from '@sieve/shared';
import { CategoryIcon } from '@/components/CategoryIcon/CategoryIcon';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { Segmented } from '@/components/Segmented/Segmented';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { useAvailability } from '@/state/availability';
import { useSettings } from '@/state/settings';
import { Confirm } from './kit/Confirm';
import ground from './kit/ground.module.css';
import kit from './kit/kit.module.css';
import { saveStatusText } from './settingsText';
import styles from './settings.module.css';

const RULE_OPTIONS: { value: CategoryRule; label: string }[] = [
  { value: 'approve', label: SETTINGS.ruleApprove },
  { value: 'ask-first', label: SETTINGS.ruleAskFirst },
  { value: 'never', label: SETTINGS.ruleNever },
];
const RULE_TONES: Record<CategoryRule, 'default' | 'warn' | 'never'> = { approve: 'default', 'ask-first': 'warn', never: 'never' };
const RULE_CLASS: Record<CategoryRule, string> = { approve: '', 'ask-first': kit.warn, never: kit.never };
const STEP_OPTIONS: { value: LadderStep; label: string }[] = LADDER_STEPS.map((s) => ({ value: s, label: LADDER_LABELS[s] }));

const report = (e: unknown) => console.error(e);

export function RulesCard() {
  const rules = useSettings((s) => s.settings.categoryRules);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k.startsWith('rule:')));
  const [selected, setSelected] = useState<Category | null>(null);
  const [pending, setPending] = useState<{ category: Category; rule: CategoryRule } | null>(null);
  const bandId = useId();

  const change = (category: Category, rule: CategoryRule) => {
    if (rule === rules[category]) return;
    if (rules[category] === 'never') {
      setPending({ category, rule });
      return;
    }
    useSettings.getState().setCategoryRule(category, rule).catch(report);
  };

  return (
    <ErrorBoundary>
      <section id="rules" className={ground.sec} aria-labelledby="rules-heading">
        <div className={ground.secHead}>
          <h2 id="rules-heading" className={ground.h2} tabIndex={-1}>
            {SETTINGS.rulesHeading}
          </h2>
          <p className={ground.secNote}>
            {status ? (
              <span className={styles.saveStatus} role="status">
                {status}
              </span>
            ) : (
              SETTINGS.rulesNote
            )}
          </p>
        </div>
        <ul className={styles.tiles} aria-label={SETTINGS.rulesLabel}>
          {CATEGORIES.map((c) => (
            <li key={c}>
              <button type="button" className={styles.tile} aria-pressed={selected === c} aria-controls={selected === c ? bandId : undefined} onClick={() => setSelected(selected === c ? null : c)}>
                <span className={styles.tileGlyph}>
                  <CategoryIcon category={c} size={34} never={rules[c] === 'never'} />
                </span>
                <span>{c}</span>
                <span className={`${styles.tileRule} ${RULE_CLASS[rules[c]]}`}>{SETTINGS.ruleWord[rules[c]]}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <div id={bandId} className={ground.band}>
            <CategoryIcon category={selected} size={26} never={rules[selected] === 'never'} />
            <p className={ground.bandName}>{selected}</p>
            <Segmented
              label={fillText(SETTINGS.ruleFor, { category: selected })}
              options={RULE_OPTIONS}
              value={rules[selected]}
              onChange={(rule) => change(selected, rule)}
              toneFor={(rule) => RULE_TONES[rule]}
            />
            <span className={`${kit.small} ${RULE_CLASS[rules[selected]]}`}>{SETTINGS.ruleNote[rules[selected]]}</span>
          </div>
        ) : null}
        <Confirm
          open={pending !== null}
          title={fillText(SETTINGS.allowTitle, { category: pending?.category ?? '' })}
          body={fillText(SETTINGS.allowBody, { category: pending?.category ?? '' })}
          confirmLabel={SETTINGS.allowConfirm}
          cancelLabel={SETTINGS.allowCancel}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const p = pending;
            setPending(null);
            if (p) await useSettings.getState().setCategoryRule(p.category, p.rule).catch(report);
          }}
        />
      </section>
    </ErrorBoundary>
  );
}

/** The default step, as a row under "More". */
export function DefaultStepCard() {
  const step = useSettings((s) => s.settings.defaultStep);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k === 'defaultStep'));
  return (
    <li id="default-step" className={ground.row}>
      <span className={ground.rowText}>
        <span id="default-step-heading" tabIndex={-1}>
          {SETTINGS.defaultStepHeading}
        </span>
        <span className={ground.rowSub}>{SETTINGS.defaultStepSub}</span>
        {status ? (
          <span className={styles.saveStatus} role="status">
            {status}
          </span>
        ) : null}
      </span>
      <Segmented
        label={SETTINGS.defaultStepHeading}
        options={STEP_OPTIONS}
        value={step}
        onChange={(s) => {
          useSettings.getState().setDefaultStep(s).catch(report);
        }}
      />
    </li>
  );
}

/** Cloud fallback for the person's own data, as a row under "More": off by default, confirmed before it turns on. */
export function CloudCard() {
  const on = useSettings((s) => s.settings.cloudFallbackForOwnData);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k === 'cloudFallbackForOwnData'));
  const hasNano = useAvailability((s) => s.text === 'available');
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  return (
    <li id="cloud" className={ground.row}>
      <span className={ground.rowText}>
        <span id="cloud-heading" tabIndex={-1}>
          {SETTINGS.cloudHeading}
        </span>
        <span id={noteId} className={ground.rowSub}>
          {SETTINGS.cloudNote}
          {hasNano ? ` ${SETTINGS.cloudHasNano}` : ''}
        </span>
        {status ? (
          <span className={styles.saveStatus} role="status">
            {status}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        className={ground.switch}
        aria-checked={on}
        aria-label={SETTINGS.cloudCheckbox}
        aria-describedby={noteId}
        onClick={() => {
          if (!on) setConfirming(true);
          else useSettings.getState().setCloudFallback(false).catch(report);
        }}
      />
      <Confirm
        open={confirming}
        title={SETTINGS.cloudTitle}
        body={SETTINGS.cloudBody}
        confirmLabel={SETTINGS.cloudConfirm}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await useSettings.getState().setCloudFallback(true).catch(report);
        }}
      />
    </li>
  );
}

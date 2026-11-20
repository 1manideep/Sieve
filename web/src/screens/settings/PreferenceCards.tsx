// Category rules, default step and cloud fallback (40 sections 13.8.4 to 13.8.6; F5). Each rule is a glass row
// with the category, a coloured line that says what its rule means, and the rule control. Writes are optimistic in
// useSettings; each card shows its own save status.
import { useId, useState } from 'react';
import { CATEGORIES, LADDER_LABELS, LADDER_STEPS, type Category, type CategoryRule, type LadderStep } from '@sieve/shared';
import { Segmented } from '@/components/Segmented/Segmented';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { useAvailability } from '@/state/availability';
import { useSettings } from '@/state/settings';
import { Confirm } from './kit/Confirm';
import kit from './kit/kit.module.css';
import { SettingsCard } from './SettingsCard';
import { saveStatusText } from './settingsText';
import styles from './settings.module.css';

const RULE_OPTIONS: { value: CategoryRule; label: string }[] = [
  { value: 'approve', label: SETTINGS.ruleApprove },
  { value: 'ask-first', label: SETTINGS.ruleAskFirst },
  { value: 'never', label: SETTINGS.ruleNever },
];
const RULE_TONES: Record<CategoryRule, 'default' | 'warn' | 'never'> = { approve: 'default', 'ask-first': 'warn', never: 'never' };
const RULE_LINES: Record<CategoryRule, { text: string; className: string }> = {
  approve: { text: SETTINGS.ruleLineApprove, className: kit.muted },
  'ask-first': { text: SETTINGS.ruleLineAskFirst, className: kit.warn },
  never: { text: SETTINGS.ruleLineNever, className: kit.never },
};
const STEP_OPTIONS: { value: LadderStep; label: string }[] = LADDER_STEPS.map((s) => ({ value: s, label: LADDER_LABELS[s] }));

const report = (e: unknown) => console.error(e);

export function RulesCard() {
  const rules = useSettings((s) => s.settings.categoryRules);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k.startsWith('rule:')));
  const [pending, setPending] = useState<{ category: Category; rule: CategoryRule } | null>(null);

  const change = (category: Category, rule: CategoryRule) => {
    if (rule === rules[category]) return;
    if (rules[category] === 'never') {
      setPending({ category, rule });
      return;
    }
    useSettings.getState().setCategoryRule(category, rule).catch(report);
  };

  return (
    <SettingsCard id="rules" title={SETTINGS.rulesHeading} status={status} bare>
      <p className={kit.help}>{SETTINGS.rulesSub}</p>
      <ul className={styles.rules}>
        {CATEGORIES.map((c) => {
          const line = RULE_LINES[rules[c]];
          return (
            <li key={c} className={`${kit.glassSm} ${styles.ruleRow}`}>
              <span className={styles.ruleMain}>
                <span className={styles.ruleName}>{c}</span>
                <span className={`${styles.ruleLine} ${line.className}`}>{line.text}</span>
              </span>
              <Segmented
                label={fillText(SETTINGS.ruleFor, { category: c })}
                options={RULE_OPTIONS}
                value={rules[c]}
                onChange={(rule) => change(c, rule)}
                toneFor={(rule) => RULE_TONES[rule]}
              />
            </li>
          );
        })}
      </ul>
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
    </SettingsCard>
  );
}

export function DefaultStepCard() {
  const step = useSettings((s) => s.settings.defaultStep);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k === 'defaultStep'));
  return (
    <SettingsCard id="default-step" title={SETTINGS.defaultStepHeading} status={status}>
      <p className={styles.sub}>{SETTINGS.defaultStepSub}</p>
      <Segmented
        label={SETTINGS.defaultStepHeading}
        options={STEP_OPTIONS}
        value={step}
        onChange={(s) => {
          useSettings.getState().setDefaultStep(s).catch(report);
        }}
      />
    </SettingsCard>
  );
}

export function CloudCard() {
  const on = useSettings((s) => s.settings.cloudFallbackForOwnData);
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k === 'cloudFallbackForOwnData'));
  const hasNano = useAvailability((s) => s.text === 'available');
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  return (
    <SettingsCard id="cloud" title={SETTINGS.cloudHeading} status={status}>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={on}
          aria-describedby={noteId}
          onChange={(e) => {
            if (e.target.checked) setConfirming(true);
            else useSettings.getState().setCloudFallback(false).catch(report);
          }}
        />
        <span className={styles.choiceLabel}>{SETTINGS.cloudCheckbox}</span>
      </label>
      <p id={noteId} className={styles.note}>
        {SETTINGS.cloudNote}
      </p>
      {hasNano ? <p className={styles.note}>{SETTINGS.cloudHasNano}</p> : null}
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
    </SettingsCard>
  );
}

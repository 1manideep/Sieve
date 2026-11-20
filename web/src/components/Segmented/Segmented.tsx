// Segmented (40 sections 15.5 and 16.1): a radiogroup of joined segments with roving focus.
import { useRef, type KeyboardEvent } from 'react';
import { nextRadioIndex, tabStopIndex } from './rovingRadio';
import styles from './Segmented.module.css';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface SegmentedProps<V extends string> {
  label: string;                   // aria-label of the radiogroup
  options: SegmentedOption<V>[];
  value: V;
  onChange(v: V): void;
  toneFor?: (v: V) => 'default' | 'warn' | 'never';   // colour of the selected segment
  describedBy?: string;
}

export function Segmented<V extends string>({ label, options, value, onChange, toneFor, describedBy }: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o) => !o.disabled);
  const selected = options.findIndex((o) => o.value === value);
  const stop = tabStopIndex(selected, enabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextRadioIndex(from === -1 ? stop : from, event.key, enabled);
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    if (options[next].value !== value) onChange(options[next].value);
  };

  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className={styles.group} onKeyDown={onKeyDown}>
      {options.map((option, i) => {
        const checked = option.value === value;
        const tone = checked && toneFor ? toneFor(option.value) : 'default';
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={option.disabled || undefined}
            tabIndex={i === stop ? 0 : -1}
            title={option.description}
            className={[
              styles.segment,
              checked ? styles.checked : '',
              tone === 'warn' ? styles.warn : tone === 'never' ? styles.never : '',
              option.disabled ? styles.disabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              if (option.disabled || checked) return;
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// TraceList (40 section 16.7): every step, where it ran as the SDK reported it, and what left the device.
// The badge always follows `where`; the UI never guesses. Optionally starts with the two-lane view (00 D4).
import { useId, useState } from 'react';
import type { TraceStep } from '@sieve/shared';
import { formatCount } from '@/copy/format';
import { TRACE_COPY, fill } from '@/copy/screens-main';
import { Icon } from '../icons';
import { Tag, type TagTone } from '../Tag/Tag';
import { TwoLaneTrace } from '../TwoLaneTrace/TwoLaneTrace';
import styles from './TraceList.module.css';

export interface TraceListProps {
  steps: TraceStep[];
  heading?: string;          // default "What happened, step by step"
  defaultOpen?: boolean;     // default true
  sampleData?: boolean;      // appends " (sample data)" to cloud badges except for 'draft'
  neverRule?: boolean;       // colours 'rule' rows red instead of amber
  nanoSettingUp?: boolean;   // 40 section 13.2a: "Cloud · Gemini (sample data; Nano still setting up)"
  twoLane?: boolean;         // show the device lane and the cloud lane above the rows (00 D4)
}

export function totalCharsSent(steps: TraceStep[]): number {
  return steps.reduce((sum, s) => sum + (s.charsSent ?? 0), 0);
}

export function totalText(steps: TraceStep[]): string {
  const n = totalCharsSent(steps);
  if (n === 0) return TRACE_COPY.nothingLeft;
  return n === 1 ? TRACE_COPY.totalOne : fill(TRACE_COPY.totalMany, { n: formatCount(n) });
}

export function formatMs(ms: number): string {
  if (ms < 1000) return fill(TRACE_COPY.ms, { n: Math.max(0, Math.round(ms)) });
  return fill(TRACE_COPY.seconds, { n: (ms / 1000).toFixed(1) });
}

export interface BadgeLook {
  tone: TagTone;
  text: string;
  icon?: 'person';
}

export function badgeFor(step: TraceStep, opts: { sampleData?: boolean; neverRule?: boolean; nanoSettingUp?: boolean } = {}): BadgeLook {
  if (step.kind === 'approve') return { tone: 'muted', text: TRACE_COPY.badgeYou, icon: 'person' };
  if (step.kind === 'rule') return { tone: opts.neverRule ? 'never' : 'warn', text: TRACE_COPY.badgeRule };
  if (step.where === 'device') return { tone: 'device', text: TRACE_COPY.badgeDevice };
  if (step.where === 'code') return { tone: 'device-code', text: TRACE_COPY.badgeCode };
  const suffix =
    opts.sampleData && step.kind !== 'draft'
      ? opts.nanoSettingUp
        ? TRACE_COPY.settingUpSuffix
        : TRACE_COPY.sampleSuffix
      : '';
  return { tone: 'cloud', text: TRACE_COPY.badgeCloud + suffix };
}

function detailLines(step: TraceStep): string[] {
  const lines: string[] = [];
  if (step.where === 'code') lines.push(TRACE_COPY.plainCode);
  if (step.modeRequested) lines.push(fill(TRACE_COPY.askedFor, { mode: step.modeRequested }));
  if (step.sdkReported) lines.push(step.sdkReported === 'on_device' ? TRACE_COPY.sdkOnDevice : TRACE_COPY.sdkInCloud);
  if (step.model) lines.push(fill(TRACE_COPY.model, { model: step.model }));
  if (step.charsSent !== undefined && step.charsSent > 0) {
    lines.push(step.charsSent === 1 ? TRACE_COPY.charsLeftOne : fill(TRACE_COPY.charsLeftMany, { n: formatCount(step.charsSent) }));
  }
  return lines;
}

function TraceRow({ step, badge }: { step: TraceStep; badge: BadgeLook }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const lines = detailLines(step);
  return (
    <li className={styles.row} data-kind={step.kind} data-where={step.where}>
      <div className={styles.rowMain}>
        <Tag tone={badge.tone} icon={badge.icon}>
          {badge.text}
        </Tag>
        <span className={styles.label} dir="auto">
          {step.label}
        </span>
        <span className={styles.ms}>{formatMs(step.ms)}</span>
        <button
          type="button"
          className={styles.info}
          aria-label={TRACE_COPY.details}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="info" size={20} />
        </button>
      </div>
      <ul id={detailsId} className={styles.details} hidden={!open}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}

export function TraceList({
  steps,
  heading = TRACE_COPY.heading,
  defaultOpen = true,
  sampleData = false,
  neverRule = false,
  nanoSettingUp = false,
  twoLane = false,
}: TraceListProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={styles.trace} aria-label={heading}>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
            {heading}
          </button>
        </h3>
        <span className={styles.total} data-testid="trace-total">
          {totalText(steps)}
        </span>
      </div>
      <div id={bodyId} hidden={!open} className={styles.body}>
        {twoLane ? <TwoLaneTrace steps={steps} /> : null}
        <ol className={styles.rows}>
          {steps.map((step, i) => (
            <TraceRow key={`${step.kind}-${step.at}-${i}`} step={step} badge={badgeFor(step, { sampleData, neverRule, nanoSettingUp })} />
          ))}
        </ol>
      </div>
    </section>
  );
}

// Per-item costs and ETAs (20 section 13.4): priors, then an exponentially weighted average of observed time.
import { COST_EWMA_ALPHA, COST_PRIOR_SEC, EMBED_BATCH, LABEL_BATCH_SIZE, QUEUE_PACING } from '../config';

export type QueueStage = 'label' | 'caption' | 'embed' | 'privacy';

export class CostTracker {
  secPerItem: number;
  constructor(prior: number, private readonly alpha = COST_EWMA_ALPHA) {
    this.secPerItem = prior;
  }
  /** `items` finished in `ms` (a batch counts each item). */
  observe(items: number, ms: number): void {
    if (items <= 0 || !Number.isFinite(ms) || ms < 0) return;
    const per = ms / 1000 / items;
    this.secPerItem = this.alpha * per + (1 - this.alpha) * this.secPerItem;
  }
  etaMs(remaining: number): number {
    return Math.max(0, Math.round(remaining * this.secPerItem * 1000));
  }
}

export function priorCosts(): Record<QueueStage, CostTracker> {
  return {
    label: new CostTracker(COST_PRIOR_SEC.label),
    caption: new CostTracker(COST_PRIOR_SEC.caption),
    embed: new CostTracker(COST_PRIOR_SEC.embed),
    privacy: new CostTracker(COST_PRIOR_SEC.privacy),
  };
}

/** The rest after each job of a stage, spread over the units still to do (label in batches, embed in batches of chunks). */
export function restEtaMs(stage: QueueStage, units: number): number {
  if (units <= 0) return 0;
  switch (stage) {
    case 'label':
      return Math.ceil(units / LABEL_BATCH_SIZE) * QUEUE_PACING.nanoRestMs;
    case 'caption':
      return Math.ceil(units) * QUEUE_PACING.nanoRestMs;
    case 'embed':
      return Math.ceil(units / EMBED_BATCH) * QUEUE_PACING.embedRestMs;
    case 'privacy':
      return Math.ceil(units) * QUEUE_PACING.privacyRestMs;
  }
}

/** The lanes run one at a time (label, embed, privacy, caption), so their times add up. */
export function overallEtaMs(eta: Partial<Record<QueueStage, number>>): number {
  return (eta.label ?? 0) + (eta.embed ?? 0) + (eta.privacy ?? 0) + (eta.caption ?? 0);
}

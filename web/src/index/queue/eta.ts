// Per-item costs and ETAs (20 section 13.4): priors, then an exponentially weighted average of observed time.
import { COST_EWMA_ALPHA, COST_PRIOR_SEC } from '../config';

export type QueueStage = 'label' | 'caption' | 'embed';

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
  return { label: new CostTracker(COST_PRIOR_SEC.label), caption: new CostTracker(COST_PRIOR_SEC.caption), embed: new CostTracker(COST_PRIOR_SEC.embed) };
}

/** The Nano lane's stages add up (one Nano call at a time); the ML lane runs in parallel: the larger lane wins. */
export function overallEtaMs(eta: Record<QueueStage, number>): number {
  return Math.max(eta.label + eta.caption, eta.embed);
}

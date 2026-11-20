// The "Nano · on this computer" pill of the prompt card: the on-device model's state as a dot and a few words.
import type { NanoAvailability } from '@sieve/shared';
import type { SetupState } from '@/state/availability';
import { ASK_COPY, fill } from '@/copy/screens-main';

export interface ModelPill {
  tone: 'ok' | 'warn' | 'never' | 'muted';
  text: string;
}

export interface AskModelInput {
  text: NanoAvailability | 'checking';
  setup: SetupState;
  fraction?: number;
  cloudFallback: boolean;
}

/** Ask (real data): ready, setting up, not set up, no model (with or without cloud fallback), or still checking. */
export function askModelPill(i: AskModelInput): ModelPill {
  if (i.setup === 'downloading' || i.setup === 'installing' || (i.text === 'downloading' && i.setup !== 'done')) {
    return { tone: 'warn', text: fill(ASK_COPY.nanoSettingUp, { pct: Math.round((i.fraction ?? 0) * 100) }) };
  }
  if (i.text === 'available' || i.setup === 'done') return { tone: 'ok', text: ASK_COPY.nanoReady };
  if (i.text === 'downloadable') return { tone: 'warn', text: ASK_COPY.nanoNotSetUp };
  if (i.text === 'checking') return { tone: 'muted', text: ASK_COPY.nanoChecking };
  return i.cloudFallback ? { tone: 'warn', text: ASK_COPY.nanoCloud } : { tone: 'never', text: ASK_COPY.nanoNone };
}

// The Playground's model state (40 sections 13.9 and 13.2a): the Sieve window tag, the model toggle and the
// no-model note, from the real availability and the "Not available (simulate)" toggle. Pure.
import type { NanoAvailability, Proposal } from '@sieve/shared';
import type { SetupState } from '@/state/availability';
import { PLAYGROUND_COPY } from '@/copy/screens-main';
import type { TagTone } from '@/components/Tag/Tag';

export type PlaygroundModel = 'ready' | 'simulated' | 'not-set-up' | 'setting-up' | 'none' | 'checking';

/**
 * Simulation only exists while the real model is ready, so while it is on the real state is "available" whatever
 * the availability check reports (10 section 7.2 lowers getNanoAvailability during the simulation).
 */
export function playgroundModel(text: NanoAvailability | 'checking', setup: SetupState, simulate: boolean): PlaygroundModel {
  if (simulate) return 'simulated';
  if (setup === 'downloading' || setup === 'installing') return 'setting-up';
  if (text === 'available' || setup === 'done') return 'ready';
  if (text === 'downloading') return 'setting-up';
  if (text === 'downloadable') return 'not-set-up';
  if (text === 'checking') return 'checking';
  return 'none';
}

export function modelTag(m: PlaygroundModel): { tone: TagTone; text: string } {
  switch (m) {
    case 'ready':
      return { tone: 'device', text: PLAYGROUND_COPY.tagReady };
    case 'simulated':
      return { tone: 'warn', text: PLAYGROUND_COPY.tagSimulated };
    case 'not-set-up':
      return { tone: 'warn', text: PLAYGROUND_COPY.tagNotSetUp };
    case 'setting-up':
      return { tone: 'warn', text: PLAYGROUND_COPY.tagSettingUp };
    case 'none':
      return { tone: 'warn', text: PLAYGROUND_COPY.tagNone };
    case 'checking':
      return { tone: 'muted', text: PLAYGROUND_COPY.tagChecking };
  }
}

export type ToggleValue = 'on' | 'off';
export interface ToggleOption { value: ToggleValue; label: string; disabled?: boolean }

/** The ModelToggle options for the real state (40 section 13.9 table). */
export function toggleOptions(m: PlaygroundModel): { options: ToggleOption[]; value: ToggleValue } {
  switch (m) {
    case 'ready':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleReady }, { value: 'off', label: PLAYGROUND_COPY.toggleSimulate }], value: 'on' };
    case 'simulated':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleReady }, { value: 'off', label: PLAYGROUND_COPY.toggleSimulate }], value: 'off' };
    case 'not-set-up':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleNotSetUp, disabled: true }, { value: 'off', label: PLAYGROUND_COPY.toggleNotAvailable, disabled: true }], value: 'off' };
    case 'setting-up':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleSettingUp, disabled: true }, { value: 'off', label: PLAYGROUND_COPY.toggleNotAvailable, disabled: true }], value: 'off' };
    case 'none':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleNotInChrome, disabled: true }, { value: 'off', label: PLAYGROUND_COPY.toggleNotAvailable, disabled: true }], value: 'off' };
    case 'checking':
      return { options: [{ value: 'on', label: PLAYGROUND_COPY.toggleChecking, disabled: true }, { value: 'off', label: PLAYGROUND_COPY.toggleNotAvailable, disabled: true }], value: 'off' };
  }
}

/** The amber note at the top of the Ask panel, or null when the on-device model is ready and not simulated. */
export function noModelNote(m: PlaygroundModel): { text: string; setupLink: boolean } | null {
  switch (m) {
    case 'simulated':
      return { text: PLAYGROUND_COPY.noteSimulating, setupLink: false };
    case 'none':
      return { text: PLAYGROUND_COPY.noteNone, setupLink: false };
    case 'not-set-up':
      return { text: PLAYGROUND_COPY.noteNone, setupLink: true };
    case 'setting-up':
      return { text: PLAYGROUND_COPY.noteSettingUp, setupLink: false };
    default:
      return null;
  }
}

/** The reading step of a proposal ran in the cloud (sample data without Nano). */
export function answeredInCloud(p: Proposal | undefined): boolean {
  return Boolean(p?.trace.some((s) => s.kind === 'select' && s.where === 'cloud'));
}

export function answeredOnDevice(p: Proposal | undefined): boolean {
  return Boolean(p?.trace.some((s) => s.kind === 'select' && s.where === 'device'));
}

export function selectMs(p: Proposal | undefined): number {
  return Math.round(p?.trace.find((s) => s.kind === 'select')?.ms ?? 0);
}

/** A visitor's own file or test email (source 'upload'): cloud reads of it are theirs, not sample data. */
export function isOwnItem(p: Proposal | undefined): boolean {
  return Boolean(p?.item?.recordId.startsWith('upload:'));
}

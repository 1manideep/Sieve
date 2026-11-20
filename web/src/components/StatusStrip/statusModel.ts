// What the status strip says for a given set of store states (40 sections 8.1 and 8.2). Pure, so it is easy to test.
import { formatCount, formatEta } from '@/copy/format';
import { STATUS, STATUS_POPOVER } from '@/copy/strings';
import type { AvailabilityState } from '@/state/availability';
import type { HomeBaseState } from '@/state/homeBase';
import type { IndexingState } from '@/state/indexing';

export type Tone = 'teal' | 'amber' | 'neutral';

export type StatusAction =
  | 'make-home-base' | 'stop-home-base' | 'use-this-tab'
  | 'set-up-model' | 'show-progress' | 'cloud-fallback'
  | 'pause-indexing' | 'resume-indexing' | 'get-extension';

export interface Segment { id: 'home-base' | 'model' | 'indexing' | 'auto-approve'; text: string; tone: Tone }

export interface PopoverRow {
  id: 'home-base' | 'model' | 'indexing' | 'extension';
  title: string;
  sentence: string;
  tone: Tone;
  action?: { kind: StatusAction; label: string };
  progress?: { done: number; total: number };
  sourcesLink?: boolean;
}

export interface StatusInput {
  online: boolean;
  homeBase: Pick<HomeBaseState, 'role' | 'presence' | 'homeBaseLabel' | 'waitingForClick' | 'extension'>;
  availability: Pick<AvailabilityState, 'text' | 'setup'>;
  indexing: Pick<IndexingState, 'state' | 'left' | 'done' | 'total' | 'etaMs'>;
  extensionEnabled: boolean;
  /** Auto-approve, testing mode, is on for any connection on this computer (40 section 13.8.9). */
  autoApprove?: boolean;
}

export interface StatusModel {
  segments: Segment[];
  tone: Tone;
  text: string;                 // segments joined by " · "
  accessibleName: string;
  rows: PopoverRow[];
}

const OTHER_DEVICE_FALLBACK = STATUS.otherDeviceFallback;

function setupRunning(a: StatusInput['availability']): boolean {
  return a.setup.state === 'downloading' || a.setup.state === 'installing';
}

function setupPct(a: StatusInput['availability']): number {
  return Math.round((a.setup.fraction ?? 0) * 100);
}

function homeBaseSegment(input: StatusInput): Segment | null {
  const { role, presence, homeBaseLabel, waitingForClick } = input.homeBase;
  const seg = (text: string, tone: Tone): Segment => ({ id: 'home-base', text, tone });
  if (!input.online) return seg(STATUS.offline, 'amber');
  switch (role) {
    case 'starting':
      return seg(STATUS.homeBaseStarting, 'neutral');
    case 'active':
      if (waitingForClick) return seg(STATUS.homeBaseNeedsClick, 'amber');
      if (presence === 'online') return seg(STATUS.homeBaseOnline, 'teal');
      if (presence === 'offline') return seg(STATUS.homeBaseOffline, 'amber');
      return seg(STATUS.homeBaseStarting, 'neutral');
    case 'standby':
      return seg(STATUS.homeBaseStandby, 'neutral');
    case 'other-device':
      return seg(STATUS.homeBaseOtherDevice(homeBaseLabel ?? OTHER_DEVICE_FALLBACK), 'neutral');
    case 'not-home-base':
      return seg(STATUS.noHomeBase, 'neutral');
    case 'signed-out':
    case 'error':
      return null;
  }
}

function modelSegment(a: StatusInput['availability']): Segment {
  const seg = (text: string, tone: Tone): Segment => ({ id: 'model', text, tone });
  if (setupRunning(a)) return seg(STATUS.modelPreparing(setupPct(a)), 'amber');
  switch (a.text) {
    case 'checking':
      return seg(STATUS.modelChecking, 'neutral');
    case 'available':
      return seg(STATUS.modelReady, 'teal');
    case 'downloading':
      return seg(STATUS.modelDownloading, 'amber');
    case 'downloadable':
      return seg(STATUS.modelNotSetUp, 'amber');
    case 'unavailable':
    case 'no-api':
      return seg(STATUS.modelNone, 'amber');
  }
}

function indexingSegment(i: StatusInput['indexing']): Segment | null {
  const seg = (text: string, tone: Tone): Segment => ({ id: 'indexing', text, tone });
  switch (i.state) {
    case 'idle':
      return null;
    case 'running':
      return seg(STATUS.indexingLeft(formatCount(i.left)), 'neutral');
    case 'yielding':
      return seg(STATUS.indexingYielding, 'neutral');
    case 'paused':
      return seg(STATUS.indexingPaused, 'amber');
  }
}

function homeBaseRow(input: StatusInput, segment: Segment | null): PopoverRow | null {
  const { role, presence, homeBaseLabel, waitingForClick } = input.homeBase;
  const row = (sentence: string, tone: Tone, action?: PopoverRow['action']): PopoverRow => ({
    id: 'home-base', title: STATUS_POPOVER.homeBase, sentence, tone, action,
  });
  const tone = segment?.tone ?? 'neutral';
  switch (role) {
    case 'not-home-base':
      return row(STATUS_POPOVER.homeBaseNone, tone, { kind: 'make-home-base', label: STATUS_POPOVER.makeHomeBase });
    case 'active':
      if (waitingForClick) return row(STATUS_POPOVER.homeBaseNeedsClick, tone);
      if (presence === 'online') return row(STATUS_POPOVER.homeBaseOnline, tone, { kind: 'stop-home-base', label: STATUS_POPOVER.stopHomeBase });
      if (presence === 'offline') return row(STATUS_POPOVER.homeBaseOffline, tone);
      return row(STATUS.homeBaseStarting, tone);
    case 'standby':
      return row(STATUS_POPOVER.homeBaseStandby, tone, { kind: 'use-this-tab', label: STATUS_POPOVER.useThisTab });
    case 'other-device':
      return row(STATUS_POPOVER.homeBaseOtherDevice(homeBaseLabel ?? OTHER_DEVICE_FALLBACK), tone, {
        kind: 'make-home-base', label: STATUS_POPOVER.makeHomeBase,
      });
    case 'starting':
      return row(STATUS.homeBaseStarting, tone);
    case 'signed-out':
    case 'error':
      return null;
  }
}

function modelRow(a: StatusInput['availability'], segment: Segment): PopoverRow {
  const row = (sentence: string, action?: PopoverRow['action']): PopoverRow => ({
    id: 'model', title: STATUS_POPOVER.model, sentence, tone: segment.tone, action,
  });
  if (setupRunning(a)) {
    return row(STATUS_POPOVER.modelSetupRunning(setupPct(a)), { kind: 'show-progress', label: STATUS_POPOVER.showProgress });
  }
  switch (a.text) {
    case 'checking':
      return row(STATUS.modelChecking);
    case 'available':
      return row(STATUS_POPOVER.modelAvailable);
    case 'downloadable':
      return row(STATUS_POPOVER.modelDownloadable, { kind: 'set-up-model', label: STATUS_POPOVER.setItUp });
    case 'downloading':
      return row(STATUS_POPOVER.modelDownloading);
    case 'unavailable':
    case 'no-api':
      return row(STATUS_POPOVER.modelUnavailable, { kind: 'cloud-fallback', label: STATUS_POPOVER.turnOnCloud });
  }
}

function indexingRow(i: StatusInput['indexing'], segment: Segment | null): PopoverRow | null {
  if (!segment) return null;
  const base = { id: 'indexing' as const, title: STATUS_POPOVER.indexing, tone: segment.tone, sourcesLink: true };
  switch (i.state) {
    case 'running':
      return {
        ...base,
        sentence: STATUS_POPOVER.indexingRunning(formatCount(i.left), i.etaMs === undefined ? undefined : formatEta(i.etaMs)),
        progress: { done: i.done, total: i.total },
        action: { kind: 'pause-indexing', label: STATUS_POPOVER.pause },
      };
    case 'yielding':
      return { ...base, sentence: STATUS_POPOVER.indexingYielding };
    case 'paused':
      return { ...base, sentence: STATUS_POPOVER.indexingPaused, action: { kind: 'resume-indexing', label: STATUS_POPOVER.resume } };
    case 'idle':
      return null;
  }
}

function extensionRow(input: StatusInput): PopoverRow | null {
  if (!input.extensionEnabled) return null;
  const row = (sentence: string, tone: Tone, action?: PopoverRow['action']): PopoverRow => ({
    id: 'extension', title: STATUS_POPOVER.extension, sentence, tone, action,
  });
  switch (input.homeBase.extension) {
    case 'connected':
      return row(STATUS_POPOVER.extensionConnected, 'teal');
    case 'not-installed':
      return row(STATUS_POPOVER.extensionNotInstalled, 'neutral', { kind: 'get-extension', label: STATUS_POPOVER.getExtension });
    case 'reconnecting':
      return row(STATUS_POPOVER.extensionReconnecting, 'amber');
    case 'idle':
    case 'off':
    case 'connecting':
      return row(STATUS_POPOVER.extensionIdle, 'neutral');
  }
}

export function statusModel(input: StatusInput): StatusModel {
  const home = homeBaseSegment(input);
  const model = modelSegment(input.availability);
  const indexing = indexingSegment(input.indexing);
  const auto: Segment | null = input.autoApprove ? { id: 'auto-approve', text: STATUS.autoApproveOn, tone: 'amber' } : null;
  const segments = [home, model, indexing, auto].filter((s): s is Segment => s !== null);

  let tone: Tone = 'neutral';
  if (segments.some((s) => s.tone === 'amber')) tone = 'amber';
  else if (model.tone === 'teal' && home?.tone === 'teal') tone = 'teal';

  const rows = [homeBaseRow(input, home), modelRow(input.availability, model), indexingRow(input.indexing, indexing), extensionRow(input)]
    .filter((r): r is PopoverRow => r !== null);

  return {
    segments,
    tone,
    text: segments.map((s) => s.text).join(' · '),
    accessibleName: STATUS.accessibleName(segments.map((s) => s.text)),
    rows,
  };
}

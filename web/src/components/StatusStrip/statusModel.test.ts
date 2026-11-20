import { describe, expect, it } from 'vitest';
import { STATUS, STATUS_POPOVER } from '@/copy/strings';
import { statusModel, type StatusInput } from './statusModel';

function input(over: {
  online?: boolean;
  homeBase?: Partial<StatusInput['homeBase']>;
  availability?: Partial<StatusInput['availability']>;
  indexing?: Partial<StatusInput['indexing']>;
  extensionEnabled?: boolean;
} = {}): StatusInput {
  return {
    online: over.online ?? true,
    homeBase: { role: 'active', presence: 'online', waitingForClick: false, extension: 'off', homeBaseLabel: undefined, ...over.homeBase },
    availability: { text: 'available', setup: { state: 'idle' }, ...over.availability },
    indexing: { state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined, ...over.indexing },
    extensionEnabled: over.extensionEnabled ?? false,
  };
}

describe('status strip segments (40 section 8.1)', () => {
  it.each([
    ['browser offline', input({ online: false }), STATUS.offline, 'amber'],
    ['starting', input({ homeBase: { role: 'starting' } }), STATUS.homeBaseStarting, 'neutral'],
    ['active and online', input(), STATUS.homeBaseOnline, 'teal'],
    ['waiting for a click', input({ homeBase: { waitingForClick: true } }), STATUS.homeBaseNeedsClick, 'amber'],
    ['active and offline', input({ homeBase: { presence: 'offline' } }), STATUS.homeBaseOffline, 'amber'],
    ['standby', input({ homeBase: { role: 'standby' } }), STATUS.homeBaseStandby, 'neutral'],
    ['other device', input({ homeBase: { role: 'other-device', homeBaseLabel: 'Chrome on Mac' } }), 'Home base: Chrome on Mac', 'neutral'],
    ['not the home base', input({ homeBase: { role: 'not-home-base' } }), STATUS.noHomeBase, 'neutral'],
  ] as const)('home base: %s', (_name, value, text, tone) => {
    const seg = statusModel(value).segments.find((s) => s.id === 'home-base');
    expect(seg).toEqual({ id: 'home-base', text, tone });
  });

  it('shows no home base segment before the engine starts', () => {
    expect(statusModel(input({ homeBase: { role: 'signed-out' } })).segments.map((s) => s.id)).toEqual(['model']);
  });

  it.each([
    ['checking', input({ availability: { text: 'checking' } }), STATUS.modelChecking, 'neutral'],
    ['available', input(), STATUS.modelReady, 'teal'],
    ['setup running', input({ availability: { text: 'downloading', setup: { state: 'downloading', fraction: 0.42 } } }), 'Preparing on-device model 42%', 'amber'],
    ['downloading elsewhere', input({ availability: { text: 'downloading' } }), STATUS.modelDownloading, 'amber'],
    ['downloadable', input({ availability: { text: 'downloadable' } }), STATUS.modelNotSetUp, 'amber'],
    ['unavailable', input({ availability: { text: 'unavailable' } }), STATUS.modelNone, 'amber'],
    ['no API', input({ availability: { text: 'no-api' } }), STATUS.modelNone, 'amber'],
  ] as const)('model: %s', (_name, value, text, tone) => {
    const seg = statusModel(value).segments.find((s) => s.id === 'model');
    expect(seg).toEqual({ id: 'model', text, tone });
  });

  it.each([
    ['running', input({ indexing: { state: 'running', left: 1412 } }), 'Indexing 1,412 left', 'neutral'],
    ['yielding', input({ indexing: { state: 'yielding', left: 3 } }), STATUS.indexingYielding, 'neutral'],
    ['paused', input({ indexing: { state: 'paused', left: 3 } }), STATUS.indexingPaused, 'amber'],
  ] as const)('indexing: %s', (_name, value, text, tone) => {
    const seg = statusModel(value).segments.find((s) => s.id === 'indexing');
    expect(seg).toEqual({ id: 'indexing', text, tone });
  });

  it('hides the indexing segment when idle', () => {
    expect(statusModel(input()).segments.some((s) => s.id === 'indexing')).toBe(false);
  });

  it('joins the segments and names the pill', () => {
    const m = statusModel(input({ indexing: { state: 'running', left: 412 } }));
    expect(m.text).toBe('Home base online · On-device model ready · Indexing 412 left');
    expect(m.accessibleName).toBe('Status: Home base online, On-device model ready, Indexing 412 left. Show details.');
  });

  it('takes the worst tone: amber, else teal when ready and online, else neutral', () => {
    expect(statusModel(input()).tone).toBe('teal');
    expect(statusModel(input({ availability: { text: 'downloadable' } })).tone).toBe('amber');
    expect(statusModel(input({ indexing: { state: 'paused' } })).tone).toBe('amber');
    expect(statusModel(input({ homeBase: { role: 'standby' } })).tone).toBe('neutral');
    expect(statusModel(input({ homeBase: { role: 'signed-out' } })).tone).toBe('neutral');
  });
});

describe('status popover rows (40 section 8.2)', () => {
  const row = (value: StatusInput, id: string) => statusModel(value).rows.find((r) => r.id === id);

  it('offers the home base actions per role', () => {
    expect(row(input({ homeBase: { role: 'not-home-base' } }), 'home-base')).toMatchObject({
      sentence: STATUS_POPOVER.homeBaseNone, action: { kind: 'make-home-base', label: STATUS_POPOVER.makeHomeBase },
    });
    expect(row(input(), 'home-base')).toMatchObject({
      sentence: STATUS_POPOVER.homeBaseOnline, action: { kind: 'stop-home-base' },
    });
    expect(row(input({ homeBase: { presence: 'offline' } }), 'home-base')?.action).toBeUndefined();
    expect(row(input({ homeBase: { waitingForClick: true } }), 'home-base')?.sentence).toBe(STATUS_POPOVER.homeBaseNeedsClick);
    expect(row(input({ homeBase: { role: 'standby' } }), 'home-base')).toMatchObject({ action: { kind: 'use-this-tab' } });
    expect(row(input({ homeBase: { role: 'other-device', homeBaseLabel: 'Chrome on Windows' } }), 'home-base')).toMatchObject({
      sentence: 'Requests go to Chrome on Windows.', action: { kind: 'make-home-base' },
    });
  });

  it('offers the model actions per state', () => {
    expect(row(input(), 'model')).toMatchObject({ sentence: STATUS_POPOVER.modelAvailable });
    expect(row(input(), 'model')?.action).toBeUndefined();
    expect(row(input({ availability: { text: 'downloadable' } }), 'model')).toMatchObject({ action: { kind: 'set-up-model', label: STATUS_POPOVER.setItUp } });
    expect(row(input({ availability: { text: 'downloading', setup: { state: 'installing', fraction: 1 } } }), 'model')).toMatchObject({
      sentence: 'Setting up Gemini Nano: 100%. You can keep using Sieve.', action: { kind: 'show-progress' },
    });
    expect(row(input({ availability: { text: 'downloading' } }), 'model')).toMatchObject({ sentence: STATUS_POPOVER.modelDownloading });
    expect(row(input({ availability: { text: 'no-api' } }), 'model')).toMatchObject({ action: { kind: 'open-playground' } });
  });

  it('shows indexing with an ETA, progress and Pause, or Resume when paused', () => {
    const running = row(input({ indexing: { state: 'running', left: 40, done: 60, total: 100, etaMs: 5 * 60_000 } }), 'indexing');
    expect(running).toMatchObject({
      sentence: 'Reading 40 items on this device. About 5 min left.',
      progress: { done: 60, total: 100 },
      action: { kind: 'pause-indexing' },
      sourcesLink: true,
    });
    expect(row(input({ indexing: { state: 'running', left: 40 } }), 'indexing')?.sentence).toBe('Reading 40 items on this device.');
    expect(row(input({ indexing: { state: 'paused', left: 4 } }), 'indexing')).toMatchObject({ action: { kind: 'resume-indexing' } });
    expect(row(input(), 'indexing')).toBeUndefined();
  });

  it('shows the extension row only when the extension is configured', () => {
    expect(row(input({ homeBase: { extension: 'connected' } }), 'extension')).toBeUndefined();
    expect(row(input({ extensionEnabled: true, homeBase: { extension: 'connected' } }), 'extension')?.sentence).toBe(STATUS_POPOVER.extensionConnected);
    expect(row(input({ extensionEnabled: true, homeBase: { extension: 'not-installed' } }), 'extension')).toMatchObject({ action: { kind: 'get-extension' } });
    expect(row(input({ extensionEnabled: true, homeBase: { extension: 'reconnecting' } }), 'extension')?.sentence).toBe(STATUS_POPOVER.extensionReconnecting);
    expect(row(input({ extensionEnabled: true, homeBase: { extension: 'idle' } }), 'extension')?.sentence).toBe(STATUS_POPOVER.extensionIdle);
  });
});

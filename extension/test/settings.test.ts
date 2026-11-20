import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, readSettings, SETTINGS_KEY, writeSettings } from '../src/shared/settings';
import type { SettingsArea } from '../src/shared/settings';

function area(initial: Record<string, unknown> = {}, opts: { getRejects?: boolean; setRejects?: boolean } = {}) {
  const store: Record<string, unknown> = { ...initial };
  const a: SettingsArea = {
    get: (key) => (opts.getRejects ? Promise.reject(new Error('read failed')) : Promise.resolve(key in store ? { [key]: store[key] } : {})),
    set: (items) => {
      if (opts.setRejects) return Promise.reject(new Error('write failed'));
      Object.assign(store, items);
      return Promise.resolve();
    },
  };
  return { a, store };
}

describe('extension settings (50 section 7.10)', () => {
  it('defaults to opening the popup when a request arrives', () => {
    expect(DEFAULT_SETTINGS).toEqual({ openOnArrival: true });
    expect(SETTINGS_KEY).toBe('settings');
  });

  it('parses field by field, and anything that is not a boolean takes the default', () => {
    expect(parseSettings({ openOnArrival: false })).toEqual({ openOnArrival: false });
    expect(parseSettings({ openOnArrival: true, extra: 'x' })).toEqual({ openOnArrival: true });
    for (const raw of [undefined, null, 'off', 0, [], { openOnArrival: 'false' }, { openOnArrival: 0 }]) {
      expect(parseSettings(raw)).toEqual({ openOnArrival: true });
    }
  });

  it('reads the stored value, and the defaults when nothing is stored or the read fails', async () => {
    expect(await readSettings(area({ settings: { openOnArrival: false } }).a)).toEqual({ openOnArrival: false });
    expect(await readSettings(area().a)).toEqual({ openOnArrival: true });
    expect(await readSettings(area({}, { getRejects: true }).a)).toEqual({ openOnArrival: true });
  });

  it('writes the merged settings under the one key, and rejects when the write fails', async () => {
    const { a, store } = area();
    expect(await writeSettings(a, { openOnArrival: false })).toEqual({ openOnArrival: false });
    expect(store).toEqual({ settings: { openOnArrival: false } });
    await expect(writeSettings(area({}, { setRejects: true }).a, { openOnArrival: false })).rejects.toThrow('write failed');
  });
});

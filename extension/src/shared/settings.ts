// Extension settings (50 section 7.10). One chrome.storage.local key, `settings`, holding booleans only; no request
// content, names or ids. The popup's settings menu writes it, and the worker reads it each time a request arrives,
// so a change applies to the next request without a message. Anything missing or malformed reads as the default.

export const SETTINGS_KEY = 'settings';

export interface Settings {
  /** Open the toolbar popup when a new request arrives (default on). Off: only the badge and the notification. */
  openOnArrival: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { openOnArrival: true };

/** The stored value, field by field: a field that is not a boolean takes its default. */
export function parseSettings(raw: unknown): Settings {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    openOnArrival: typeof v.openOnArrival === 'boolean' ? v.openOnArrival : DEFAULT_SETTINGS.openOnArrival,
  };
}

/** The part of chrome.storage.StorageArea the settings use. */
export interface SettingsArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The current settings; the defaults when the read fails. */
export async function readSettings(area: SettingsArea): Promise<Settings> {
  try {
    const items = await area.get(SETTINGS_KEY);
    return parseSettings(items?.[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Merges a change into the stored settings and returns what was written; rejects when the write fails. */
export async function writeSettings(area: SettingsArea, change: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await readSettings(area)), ...change };
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}

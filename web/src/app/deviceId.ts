// Device id and default label (40 section 4.3).

const DEVICE_ID_KEY = 'sieve.deviceId';

let cachedId: string | undefined;
let persistent = true;

/** localStorage 'sieve.deviceId'; crypto.randomUUID() on first call. In memory when localStorage throws. */
export function getDeviceId(): string {
  if (cachedId) return cachedId;
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
    const id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    cachedId = id;
    return id;
  } catch {
    persistent = false;
    cachedId = crypto.randomUUID();
    return cachedId;
  }
}

/** False when this browser cannot keep the id across reloads (the Settings device row says so). */
export function canKeepDeviceId(): boolean {
  getDeviceId();
  return persistent;
}

interface NavigatorWithUAData {
  userAgentData?: { platform?: string };
  userAgent: string;
}

export function defaultDeviceLabel(nav: NavigatorWithUAData = navigator): string {
  const platform = nav.userAgentData?.platform ?? '';
  if (platform) {
    if (/mac/i.test(platform)) return 'Chrome on Mac';
    if (/win/i.test(platform)) return 'Chrome on Windows';
    if (/chrome ?os|cros/i.test(platform)) return 'Chrome on ChromeOS';
    if (/linux/i.test(platform)) return 'Chrome on Linux';
    return 'This computer';
  }
  const ua = nav.userAgent;
  if (/CrOS/.test(ua)) return 'Chrome on ChromeOS';
  if (/Android|iPhone|iPad/.test(ua)) return 'This computer';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Chrome on Mac';
  if (/Windows/.test(ua)) return 'Chrome on Windows';
  if (/Linux/.test(ua)) return 'Chrome on Linux';
  return 'This computer';
}

/** Test seam: forget the cached id. */
export function resetDeviceIdForTests(): void {
  cachedId = undefined;
  persistent = true;
}

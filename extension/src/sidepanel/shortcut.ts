// The shortcut shown in the footer (manifest "commands": MacCtrl+Shift+S on a Mac, Alt+Shift+S elsewhere).
// Chrome's commands API is not reachable from the panel without another permission, so the platform decides.

export const SHORTCUT_MAC = 'Control+Shift+S';
export const SHORTCUT_OTHER = 'Alt+Shift+S';

export function isMacPlatform(nav: { platform?: string; userAgentData?: { platform?: string } } = navigator): boolean {
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function shortcutHint(nav?: { platform?: string; userAgentData?: { platform?: string } }): string {
  return isMacPlatform(nav) ? SHORTCUT_MAC : SHORTCUT_OTHER;
}

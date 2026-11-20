// Text helpers for Settings: callable errors (40 section 10.5), grant limits (13.8.1) and save status (13.8).
import { CATEGORIES, type Category, type LadderStep, type SourceKind } from '@sieve/shared';
import { SETTINGS, SOURCES } from '@/copy/screens-controls';
import type { SaveKey, SettingsState } from '@/state/settings';
import { REAL_SOURCES } from '../sources/sourcesDb';

/** 40 section 10.5: one mapping for callable errors, owned by the services layer. */
export { callableMessage } from '@/app/services/callables';

export function capLabel(step: LadderStep): string {
  if (step === 'answer') return SETTINGS.capAnswer;
  if (step === 'excerpt') return SETTINGS.capExcerpt;
  return SETTINGS.capFull;
}

export function categoriesLabel(list: Category[]): string {
  const set = new Set(list);
  if (CATEGORIES.every((c) => set.has(c))) return SETTINGS.allCategories;
  if (!set.has('Health') && CATEGORIES.every((c) => c === 'Health' || set.has(c))) return SETTINGS.allButHealth;
  return CATEGORIES.filter((c) => set.has(c)).join(', ');
}

export function sourcesLabel(list: SourceKind[]): string {
  const set = new Set(list);
  if (REAL_SOURCES.every((k) => set.has(k))) return SETTINGS.allSources;
  return REAL_SOURCES.filter((k) => set.has(k))
    .map((k) => SOURCES.names[k])
    .join(' and ');
}

/** The save status at the right of a card header (40 section 13.8): an error first, then queued, saving, saved. */
export function saveStatusText(saving: SettingsState['saving'], keys: (k: SaveKey) => boolean): string | undefined {
  const states = (Object.keys(saving) as SaveKey[]).filter(keys).map((k) => saving[k]);
  if (states.includes('error')) return SETTINGS.saveError;
  if (states.includes('queued')) return SETTINGS.queued;
  if (states.includes('saving')) return SETTINGS.saving;
  if (states.includes('saved')) return SETTINGS.saved;
  return undefined;
}

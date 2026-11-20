// users/{uid} (40 section 10.1, 01 section 3): { settings, createdAt, homeBaseDeviceId? }.
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { CATEGORIES, LADDER_STEPS, type Category, type CategoryRule, type LadderStep, type Settings } from '@sieve/shared';
import { DEFAULT_SETTINGS } from '@/state/settings';
import { firestore } from './firestore';

const RULES: readonly CategoryRule[] = ['approve', 'ask-first', 'never'];

export interface UserDocView { settings: Settings; homeBaseDeviceId?: string }

function userRef(uid: string) {
  return doc(firestore(), 'users', uid);
}

/** The dot paths missing from a stored settings map, with their default values. Never an existing value. */
export function missingSettingPaths(stored: unknown): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!stored || typeof stored !== 'object') {
    patch.settings = structuredClone(DEFAULT_SETTINGS);
    return patch;
  }
  const s = stored as Partial<Record<keyof Settings, unknown>>;
  if (!s.categoryRules || typeof s.categoryRules !== 'object') {
    patch['settings.categoryRules'] = { ...DEFAULT_SETTINGS.categoryRules };
  } else {
    const rules = s.categoryRules as Partial<Record<Category, unknown>>;
    for (const c of CATEGORIES) {
      if (!(c in rules)) patch[`settings.categoryRules.${c}`] = DEFAULT_SETTINGS.categoryRules[c];
    }
  }
  if (!('defaultStep' in s)) patch['settings.defaultStep'] = DEFAULT_SETTINGS.defaultStep;
  if (!('cloudFallbackForOwnData' in s)) patch['settings.cloudFallbackForOwnData'] = DEFAULT_SETTINGS.cloudFallbackForOwnData;
  if (!('pushEnabled' in s)) patch['settings.pushEnabled'] = DEFAULT_SETTINGS.pushEnabled;
  return patch;
}

/** Reads a stored settings map defensively: anything missing or unknown falls back to the default. */
export function readSettings(stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof Settings, unknown>>;
  const rules = (s.categoryRules && typeof s.categoryRules === 'object' ? s.categoryRules : {}) as Partial<Record<Category, unknown>>;
  const categoryRules = { ...DEFAULT_SETTINGS.categoryRules };
  for (const c of CATEGORIES) {
    const r = rules[c];
    if (typeof r === 'string' && (RULES as readonly string[]).includes(r)) categoryRules[c] = r as CategoryRule;
  }
  const step = s.defaultStep;
  return {
    categoryRules,
    defaultStep: typeof step === 'string' && (LADDER_STEPS as readonly string[]).includes(step) ? (step as LadderStep) : DEFAULT_SETTINGS.defaultStep,
    cloudFallbackForOwnData: s.cloudFallbackForOwnData === true,
    pushEnabled: s.pushEnabled === true,
  };
}

export function toUserDocView(data: DocumentData | undefined): UserDocView | null {
  if (!data) return null;
  const id = data.homeBaseDeviceId;
  return { settings: readSettings(data.settings), ...(typeof id === 'string' && id ? { homeBaseDeviceId: id } : {}) };
}

/** Creates the doc with default settings, or fills only the missing settings paths (one transaction). */
export async function ensureUserDoc(uid: string): Promise<{ isNew: boolean }> {
  const ref = userRef(uid);
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, { settings: structuredClone(DEFAULT_SETTINGS), createdAt: serverTimestamp() });
      return { isNew: true };
    }
    const patch = missingSettingPaths(snap.data().settings);
    if (Object.keys(patch).length > 0) tx.update(ref, patch);
    return { isNew: false };
  });
}

export function listenUserDoc(
  uid: string,
  next: (d: UserDocView | null) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    userRef(uid),
    (snap) => next(toUserDocView(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : undefined)),
    onError,
  );
}

/** updateDoc with a dot path, for example 'settings.categoryRules.Money'. */
export async function updateSetting(uid: string, path: `settings.${string}`, value: unknown): Promise<void> {
  await updateDoc(userRef(uid), { [path]: value });
}

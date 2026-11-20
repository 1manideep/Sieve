// Auto-approve, testing mode (40 section 13.8.9). Per account and connection, on this computer only: localStorage
// `sieve.autoApprove.{uid}` holds { [grantId]: expiresAt }. Default off; on for 2 hours from the moment it is turned
// on; expired entries are ignored and cleaned. Grants are written only by functions, and the users/{uid} rules allow
// only the four shared settings, so the switch lives here. The home base runs on this computer and reads the same
// entries. The receipts it approves this way are listed under `sieve.autoApproved.{uid}` for "Approved automatically".
import { create } from 'zustand';

export const AUTO_APPROVE_MS = 2 * 60 * 60 * 1000;
export const AUTO_APPROVE_KEY = (uid: string) => `sieve.autoApprove.${uid}`;
export const AUTO_APPROVED_KEY = (uid: string) => `sieve.autoApproved.${uid}`;
const AUTO_APPROVED_MAX = 1000;

export type AutoApproveUntil = Record<string, number>;   // grantId -> expiresAt (epoch ms, this computer's clock)

function load(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // This browser keeps nothing here, so auto-approve stays off.
  }
}

const SLACK_MS = 60_000;   // the clock may step back a little

/** The live entries. Expired, malformed or too-far entries (over 2 hours ahead) are dropped from storage too. */
export function readAutoApprove(uid: string, now: number = Date.now()): AutoApproveUntil {
  const all = load(AUTO_APPROVE_KEY(uid));
  const live: AutoApproveUntil = {};
  let stale = false;
  if (all && typeof all === 'object' && !Array.isArray(all)) {
    for (const [grantId, at] of Object.entries(all)) {
      if (typeof at === 'number' && at > now && at <= now + AUTO_APPROVE_MS + SLACK_MS) live[grantId] = at;
      else stale = true;
    }
  } else if (all !== null) {
    stale = true;
  }
  if (stale) save(AUTO_APPROVE_KEY(uid), live);
  return live;
}

/** What the engine asks for each request: is auto-approve on, and not expired, for this connection? */
export function autoApproveOn(uid: string, grantId: string, now: number = Date.now()): boolean {
  return readAutoApprove(uid, now)[grantId] !== undefined;
}

/** Receipt ids this computer approved automatically (the newest 1000). */
export function readAutoApproved(uid: string): Set<string> {
  const list = load(AUTO_APPROVED_KEY(uid));
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
}

export function markAutoApproved(uid: string, receiptId: string, on = true): void {
  const ids = [...readAutoApproved(uid)].filter((x) => x !== receiptId);
  if (on) ids.push(receiptId);
  save(AUTO_APPROVED_KEY(uid), ids.slice(-AUTO_APPROVED_MAX));
}

export interface AutoApproveState {
  uid?: string;
  until: AutoApproveUntil;                       // live entries for the signed-in account
  /** Reads the entries, then follows other tabs (storage events) and the next expiry. */
  start(uid: string): () => void;
  turnOn(grantId: string): void;                 // on for AUTO_APPROVE_MS from now
  turnOff(grantId: string): void;                // Stop, and Revoke
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useAutoApprove = create<AutoApproveState>()((set, get) => {
  const refresh = () => {
    clearTimeout(timer);
    const uid = get().uid;
    const until = uid ? readAutoApprove(uid) : {};
    set({ until });
    const next = Math.min(...Object.values(until));
    if (Number.isFinite(next)) timer = setTimeout(refresh, Math.max(0, next - Date.now()) + 50);
  };
  const change = (grantId: string, at?: number) => {
    const uid = get().uid;
    if (!uid) return;
    const until = readAutoApprove(uid);
    if (at === undefined) delete until[grantId];
    else until[grantId] = at;
    save(AUTO_APPROVE_KEY(uid), until);
    refresh();   // reads storage back, so a write that failed shows as off
  };
  return {
    until: {},
    start(uid) {
      set({ uid });
      refresh();
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === AUTO_APPROVE_KEY(uid)) refresh();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener('storage', onStorage);
        clearTimeout(timer);
        if (get().uid === uid) set({ uid: undefined, until: {} });
      };
    },
    turnOn: (grantId) => change(grantId, Date.now() + AUTO_APPROVE_MS),
    turnOff: (grantId) => change(grantId),
  };
});

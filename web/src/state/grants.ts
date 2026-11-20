// useGrants (40 section 9.8). Google-scoped. Callable names and shapes are 30's (01 section 11.5): issueGrant returns `link`.
// The link goes back to the caller (the Connect dialog keeps it in component state) and is never put in this store.
import { create } from 'zustand';
import type { Category, LadderStep, SourceKind } from '@sieve/shared';
import type { GrantView } from './types';

/** issueGrant input (30 section 7.2); days 1 to 90, the UI offers 7, 30 and 90. */
export interface IssueGrantInput { aiName: string; maxStep: LadderStep; allowedCategories: Category[]; allowedSources: SourceKind[]; days?: number }
/** issueGrant output. The link is returned only here and is never stored. */
export interface IssueGrantResult {
  grantId: string; link: string; linkHint: string; maxStep: LadderStep;
  allowedCategories: Category[]; allowedSources: SourceKind[]; expiresAt: number;
}
/** narrowGrant fields (30 section 7.3); the server rejects any widening. */
export interface NarrowGrantPatch { maxStep?: LadderStep; allowedCategories?: Category[]; allowedSources?: SourceKind[]; days?: number }

export interface GrantsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  grants: GrantView[];                             // newest first
  start(uid: string): () => void;                  // onSnapshot(users/{uid}/grants); recompute `state` every minute
  /** The link is returned, never stored. Failures throw an Error whose message is the 40 section 10.5 copy. */
  create(input: IssueGrantInput): Promise<IssueGrantResult>;
  narrow(grantId: string, patch: NarrowGrantPatch): Promise<void>;
  revoke(grantId: string): Promise<void>;
  reset(): void;
}

export const GRANT_STATE_TICK_MS = 60_000;

const initial = (): Pick<GrantsState, 'status' | 'grants'> => ({ status: 'idle', grants: [] });

let stopCurrent: (() => void) | null = null;

export const useGrants = create<GrantsState>()((set, get) => ({
  ...initial(),

  start(uid) {
    stopCurrent?.();
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    set({ status: 'loading' });
    void Promise.all([import('@/app/services/grants'), import('@/relay/resilient')])
      .then(([{ listenGrants }, { resilientSnapshot }]) => {
        if (cancelled) return;
        unsubscribe = resilientSnapshot('grants', (next, onError) =>
          listenGrants(
            uid,
            (grants) => {
              next();
              set({ status: 'ready', grants });
            },
            (e) => {
              if (get().status !== 'ready') set({ status: 'error' });
              onError(e);
            },
          ),
        );
      })
      .catch(() => set({ status: 'error' }));
    const tick = setInterval(() => {
      void import('@/app/services/grants').then(({ grantState }) => {
        const now = Date.now();
        const grants = get().grants;
        const next = grants.map((g) => {
          const state = grantState(g, now);
          return state === g.state ? g : { ...g, state };
        });
        if (next.some((g, i) => g !== grants[i])) set({ grants: next });
      });
    }, GRANT_STATE_TICK_MS);
    const stop = () => {
      cancelled = true;
      clearInterval(tick);
      unsubscribe?.();
      if (stopCurrent === stop) stopCurrent = null;
    };
    stopCurrent = stop;
    return stop;
  },

  async create(input) {
    const { issueGrant } = await import('@/app/services/callables');
    return issueGrant(input);
  },

  async narrow(grantId, patch) {
    const { narrowGrant } = await import('@/app/services/callables');
    await narrowGrant(grantId, patch);
  },

  async revoke(grantId) {
    const { revokeGrant } = await import('@/app/services/callables');
    await revokeGrant(grantId);
  },

  reset() {
    stopCurrent?.();
    set(initial());
  },
}));

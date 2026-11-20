// useAudit (40 section 9.11). Calls 30's getAuditStatus (01 section 11.5) through app/services/audit.ts.
import { create } from 'zustand';

export interface AuditState {
  state: 'idle' | 'checking' | 'intact' | 'broken' | 'unavailable';
  entries?: number; checkedAt?: number; brokenAt?: number;
  check(): Promise<void>;                          // getAuditStatus callable
  start(): () => void;                             // check on mount of /seen, then every 5 minutes while mounted
}

export const AUDIT_RECHECK_MS = 300_000;

let checking: Promise<void> | null = null;

export const useAudit = create<AuditState>()((set, get) => ({
  state: 'idle',
  entries: undefined,
  checkedAt: undefined,
  brokenAt: undefined,

  check() {
    if (checking) return checking;
    set({ state: 'checking' });
    checking = (async () => {
      try {
        const { checkAudit } = await import('@/app/services/audit');
        const r = await checkAudit();
        set({ state: r.state, entries: r.entries, checkedAt: r.checkedAt, brokenAt: r.brokenAt });
      } catch (error) {
        console.error('audit check', (error as { code?: string }).code ?? '');
        set({ state: 'unavailable', checkedAt: Date.now() });
      } finally {
        checking = null;
      }
    })();
    return checking;
  },

  start() {
    void get().check();
    const timer = setInterval(() => void get().check(), AUDIT_RECHECK_MS);
    return () => clearInterval(timer);
  },
}));

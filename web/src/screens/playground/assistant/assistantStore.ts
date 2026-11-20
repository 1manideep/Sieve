// The Playground assistant's conversation (00 D1, 30 section 16). The connection is made on the first question, never
// on page load: connectPlaygroundAssistant gets the one-day Playground grant and starts the Playground relay, then the
// connector is initialized once. The link and the connector session live only in this module's memory.
// connectPlaygroundAssistant loads with a dynamic import: it hands the relay this tab's extension port, and that
// module belongs to the Playground screen's chunk, which no later chunk may import statically (40 section 17.2).
import { create } from 'zustand';
import type { TraceStep } from '@sieve/shared';
import {
  connectorEndpoint,
  initializeConnector,
  runCloudAssistant,
  type AssistantCall,
  type AssistantOutcome,
  type ConnectorSession,
  type ModelTurn,
} from '@/ai/cloudAssistant';
import { getAuthInstance } from '@/app/firebase';
import { PLAYGROUND_ASSISTANT_COPY as COPY, fill } from '@/copy/screens-main';
import { announce } from '@/state/announcer';
import type { PendingEntry } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { deviceStepsFor } from './assistantTrace';

export type TurnOutcome = AssistantOutcome | { kind: 'connect-error' } | { kind: 'no-session' };

export interface AssistantTurn {
  id: string;
  question: string;
  phase: 'connecting' | 'thinking' | 'calling' | 'done';
  calls: AssistantCall[];
  notes: string[];
  modelTurns: ModelTurn[];
  outcome?: TurnOutcome;
  startedAt: number;
}

export interface AssistantState {
  connection: 'idle' | 'connecting' | 'ready' | 'error';
  turns: AssistantTurn[];
  running: boolean;
  /** Bumped after each question so the "cloud calls left" line re-reads the cap. */
  capVersion: number;
  /** The device side of each request (its proposal trace and the approval), kept after the relay entry is gone. */
  deviceTraces: Record<string, TraceStep[]>;
  ask(question: string): Promise<void>;
  stop(): void;
  rememberDevice(entries: Record<string, PendingEntry>): void;
  disconnect(): void;
}

interface Live {
  connector: ConnectorSession;
  uid: string;
  stopRelay(): void;
}

let live: Live | null = null;
let controller: AbortController | null = null;
let nextTurn = 0;

/**
 * The visitor's uid, anonymous or Google. ensureAnonymous starts the auth listener (the Playground calls it on
 * mount too) and signs in anonymously when there is no user yet (40 section 6.2).
 */
async function visitorUid(): Promise<string | null> {
  await useSession.getState().ensureAnonymous();
  return useSession.getState().user?.uid ?? getAuthInstance().currentUser?.uid ?? null;
}

function sameSteps(a: TraceStep[] | undefined, b: TraceStep[]): boolean {
  return a !== undefined && a.length === b.length && a.every((s, i) => s.kind === b[i].kind && s.label === b[i].label && s.at === b[i].at);
}

export const useAssistant = create<AssistantState>()((set, get) => {
  const patch = (id: string, fn: (t: AssistantTurn) => Partial<AssistantTurn>) =>
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) }));

  const connect = async (signal: AbortSignal): Promise<Live | 'no-session' | 'failed'> => {
    if (live) return live;
    const uid = await visitorUid();
    if (!uid) return 'no-session';
    let stopRelay: (() => void) | undefined;
    try {
      const { connectPlaygroundAssistant } = await import('../playgroundAssistant');
      const started = await connectPlaygroundAssistant(uid);
      stopRelay = started.stop;
      const connector = await initializeConnector(connectorEndpoint(started.grant.link), { signal });
      live = { connector, uid, stopRelay: started.stop };
      return live;
    } catch (error) {
      stopRelay?.();
      if (!signal.aborted) console.error('playground assistant connect', (error as { code?: string } | null)?.code ?? '');
      return 'failed';
    }
  };

  return {
    connection: 'idle',
    turns: [],
    running: false,
    capVersion: 0,
    deviceTraces: {},

    async ask(raw) {
      const question = raw.trim();
      if (question === '' || get().running) return;
      const ctl = new AbortController();
      controller = ctl;
      nextTurn += 1;
      const id = `turn-${nextTurn}`;
      set((s) => ({
        running: true,
        turns: [...s.turns, { id, question, phase: live ? 'thinking' : 'connecting', calls: [], notes: [], modelTurns: [], startedAt: Date.now() }],
      }));
      try {
        if (!live) set({ connection: 'connecting' });
        const session = await connect(ctl.signal);
        if (session === 'no-session' || session === 'failed') {
          set({ connection: ctl.signal.aborted ? 'idle' : 'error' });
          patch(id, () => ({
            phase: 'done',
            outcome: ctl.signal.aborted ? { kind: 'aborted' } : session === 'no-session' ? { kind: 'no-session' } : { kind: 'connect-error' },
          }));
          return;
        }
        set({ connection: 'ready' });
        patch(id, () => ({ phase: 'thinking' }));
        const run = await runCloudAssistant({
          question,
          connector: session.connector,
          uid: session.uid,
          signal: ctl.signal,
          onEvent: (event) => {
            if (event.type === 'model-start') patch(id, () => ({ phase: 'thinking' }));
            else if (event.type === 'model-end') patch(id, (t) => ({ modelTurns: [...t.modelTurns, event.turn] }));
            else if (event.type === 'note') patch(id, (t) => ({ notes: [...t.notes, event.text] }));
            else {
              patch(id, (t) => {
                const exists = t.calls.some((c) => c.id === event.call.id);
                return {
                  phase: 'calling',
                  calls: exists ? t.calls.map((c) => (c.id === event.call.id ? event.call : c)) : [...t.calls, event.call],
                };
              });
            }
          },
        });
        patch(id, () => ({ phase: 'done', outcome: run.outcome, calls: run.calls, notes: run.notes, modelTurns: run.turns }));
        if (run.outcome.kind === 'answered') announce(COPY.announceAnswered);
        // A link the server no longer knows (revoked, expired, deleted): connect again on the next question.
        if (run.outcome.kind === 'connector-error' && (run.outcome.status === 404 || run.outcome.code === 'bad-link')) {
          live?.stopRelay();
          live = null;
          set({ connection: 'idle' });
        }
      } finally {
        if (controller === ctl) controller = null;
        set((s) => ({ running: false, capVersion: s.capVersion + 1 }));
      }
    },

    stop() {
      controller?.abort();
    },

    rememberDevice(entries) {
      const known = get().deviceTraces;
      let changed: Record<string, TraceStep[]> | null = null;
      for (const entry of Object.values(entries)) {
        const steps = deviceStepsFor(entry);
        if (steps.length === 0 || sameSteps(known[entry.requestId], steps)) continue;
        changed = { ...(changed ?? known), [entry.requestId]: steps };
      }
      if (changed) set({ deviceTraces: changed });
    },

    /** Leaving the Playground: stop the question, the relay, and forget the link. */
    disconnect() {
      controller?.abort();
      controller = null;
      live?.stopRelay();
      live = null;
      set({ connection: 'idle', turns: [], running: false, deviceTraces: {} });
    },
  };
});

/** Message for an outcome that is not an answer (copy in PLAYGROUND_ASSISTANT_COPY). */
export function outcomeMessage(outcome: TurnOutcome): string | undefined {
  switch (outcome.kind) {
    case 'answered':
      return undefined;
    case 'aborted':
      return COPY.stopped;
    case 'capped':
      return fill(COPY.capReached, { limit: outcome.limit });
    case 'connect-error':
      return COPY.connectFailed;
    case 'no-session':
      return COPY.noSession;
    case 'connector-error':
      return COPY.connectorLost;
    case 'limit':
      return COPY.limit;
    case 'model-error':
      switch (outcome.code) {
        case 'quota':
          return COPY.modelQuota;
        case 'app-check':
          return COPY.modelAppCheck;
        case 'timeout':
          return COPY.modelTimeout;
        case 'offline':
          return COPY.modelOffline;
        case 'no-answer':
          return COPY.modelNoAnswer;
        default:
          return COPY.modelOther;
      }
  }
}

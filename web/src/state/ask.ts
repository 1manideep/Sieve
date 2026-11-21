// useAsk (40 sections 9.6 and 12): the in-app golden path. One factory, two instances (real data and the Playground).
// The pipeline, the index, the AI layer and the receipts service load with dynamic imports, so none of them is in the
// /welcome bundle (this module is reachable from useSession).
import { create } from 'zustand';
import {
  LADDER_LABELS,
  LADDER_STEPS,
  MAX_PAYLOAD_CHARS,
  type Decision,
  type LadderStep,
  type Proposal,
  type RequesterRef,
  type StepOption,
  type TraceStep,
} from '@sieve/shared';
import type { PipelineProgress } from '@/pipeline';
import type { ModelErrorCode } from '@/ai';
import { ASK_FLOW, DECIDE_ERRORS, DRAFT_ERRORS, SEND_CHECK } from '@/copy/strings';
import { ASK_TIMEOUT_MS } from '@/relay/constants';
import { normalizeQuestion } from '@/robust/question';
import { announce } from './announcer';
import { loadAi } from './availability';
import { useIndexing } from './indexing';
import { tables } from './localDb';
import { useNetwork } from './network';
import { PLAYGROUND_SETTINGS, useSettings } from './settings';
import { useToasts } from './toasts';
import type { DbKind, LiveStep } from './types';

export type AskPhase = 'idle' | 'preparing' | 'ready' | 'drafting' | 'done' | 'error';
export interface AskState {
  question: string;
  phase: AskPhase;
  requestId?: string;
  /** Epoch ms when the current question started (the PreparingCard's slow line counts from here). */
  startedAt?: number;
  liveSteps: LiveStep[];
  answerPreview: string;                           // streamed on-device answer (local only)
  proposal?: Proposal;
  step: LadderStep;
  relatedSelected: string[];
  relatedOptions: Record<string, StepOption[]>;
  relatedLoading: string[];
  /** Related items whose options could not be built; the row shows "Couldn't prepare this item." (40 section 12.3). */
  relatedFailed: string[];
  instruction: string;                             // default "Draft a short, polite reply."
  extraTrace: TraceStep[];                         // approve and draft steps added after the proposal
  draft?: string;
  outcome?: { kind: 'kept-local' } | { kind: 'shared'; receiptId: string; chars: number; step: LadderStep; itemCount: number };
  draftError?: string;
  error?: string;
  /** Approve and draft (or Try again) is running: the follow-up question waits until it ends. */
  approving: boolean;
  setQuestion(q: string): void;
  ask(q?: string): Promise<void>;                  // aborts a run in progress first
  stop(): void;
  setStep(step: LadderStep): void;
  toggleRelated(recordId: string): Promise<void>;
  setInstruction(text: string): void;              // trimmed to 200 chars
  keepLocal(): void;
  /** Approves the selected step and drafts. After a failed draft it does what retryDraft does (no second receipt). */
  approveAndDraft(): Promise<void>;
  /** "Try again" on a failed draft: draftReply again for the approved text and instruction, with no second receipt. */
  retryDraft(): Promise<void>;
  allowCloudFor(recordId: string): Promise<void>;
  reset(): void;
}

export const DEFAULT_INSTRUCTION = 'Draft a short, polite reply.';
export const IN_APP_REQUESTER: RequesterRef = { kind: 'in-app', aiName: 'Gemini (in Sieve)' };

type AskData = Omit<AskState,
  'setQuestion' | 'ask' | 'stop' | 'setStep' | 'toggleRelated' | 'setInstruction' | 'keepLocal' | 'approveAndDraft' | 'retryDraft' | 'allowCloudFor' | 'reset'>;

const initial = (): AskData => ({
  question: '',
  phase: 'idle',
  requestId: undefined,
  startedAt: undefined,
  liveSteps: [],
  answerPreview: '',
  proposal: undefined,
  step: 'answer',
  relatedSelected: [],
  relatedOptions: {},
  relatedLoading: [],
  relatedFailed: [],
  instruction: DEFAULT_INSTRUCTION,
  extraTrace: [],
  draft: undefined,
  outcome: undefined,
  draftError: undefined,
  error: undefined,
  approving: false,
});

const stepIndex = (s: LadderStep) => LADDER_STEPS.indexOf(s);

/** 40 section 12.2: the default step if available; else the highest available below it; else the lowest above it. */
export function startingStep(options: StepOption[], defaultStep: LadderStep): LadderStep {
  const at = (s: LadderStep) => options[stepIndex(s)]?.available === true;
  if (at(defaultStep)) return defaultStep;
  for (let i = stepIndex(defaultStep) - 1; i >= 0; i -= 1) if (at(LADDER_STEPS[i])) return LADDER_STEPS[i];
  for (let i = stepIndex(defaultStep) + 1; i < LADDER_STEPS.length; i += 1) if (at(LADDER_STEPS[i])) return LADDER_STEPS[i];
  return defaultStep;
}

/** 40 section 12.3 draftError table. Null for 'aborted' (silent). */
export function draftErrorFor(code: ModelErrorCode): string | null {
  switch (code) {
    case 'quota': return DRAFT_ERRORS.quota;
    case 'app-check': return DRAFT_ERRORS.appCheck;
    case 'timeout': return DRAFT_ERRORS.timeout;
    case 'too-long': return DRAFT_ERRORS.tooLong;
    case 'bad-output': return DRAFT_ERRORS.badOutput;
    case 'aborted': return null;
    default: return DRAFT_ERRORS.other;
  }
}

function outcomeAnnouncement(p: Proposal): { text: string; politeness: 'polite' | 'assertive' } {
  switch (p.outcome) {
    case 'ready': return { text: ASK_FLOW.foundMatch, politeness: 'polite' };
    case 'blocked-never': return { text: ASK_FLOW.neverShared(p.item?.category ?? 'This category'), politeness: 'polite' };
    case 'no-match': return { text: ASK_FLOW.noMatch, politeness: 'polite' };
    case 'unsupported': return { text: ASK_FLOW.unsupported, politeness: 'polite' };
    case 'needs-cloud-consent': return { text: ASK_FLOW.needsConsent, politeness: 'polite' };
    case 'model-unavailable': return { text: ASK_FLOW.modelUnavailable, politeness: 'polite' };
    default: return { text: ASK_FLOW.somethingWrong, politeness: 'assertive' };
  }
}

function online(): boolean {
  return useNetwork.getState().online && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

const frame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

export function createAskStore(kind: DbKind) {
  let ctl: AbortController | null = null;
  let runId = 0;
  let lastDraft: { text: string; instruction: string } | null = null;
  let frameText: string | null = null;
  let frameScheduled = false;
  let pipelineModule: typeof import('@/pipeline') | undefined;
  let approvingRun: number | null = null;   // the run whose Approve (or Try again) is in progress

  const loadPipeline = async () => (pipelineModule ??= await import('@/pipeline'));
  const settingsNow = () => (kind === 'real' ? useSettings.getState().settings : PLAYGROUND_SETTINGS);
  const dataClass = kind === 'real' ? ('own' as const) : ('sample' as const);
  const openDb = async () => (await import('@/index')).openDb(kind);

  return create<AskState>()((set, get) => {
    function onProgress(mine: number, e: PipelineProgress): void {
      if (mine !== runId) return;
      if (e.type === 'step-start') {
        const step: LiveStep = { id: e.id, kind: e.kind, label: e.label, where: e.where, status: 'running', startedAt: Date.now() };
        set((s) => ({ liveSteps: [...s.liveSteps.filter((x) => x.id !== e.id), step] }));
      } else if (e.type === 'step-end') {
        set((s) => ({
          liveSteps: s.liveSteps.some((x) => x.id === e.id)
            ? s.liveSteps.map((x) => (x.id === e.id ? { ...x, status: 'done' as const, label: e.step.label, where: e.step.where, step: e.step } : x))
            : [...s.liveSteps, { id: e.id, kind: e.step.kind, label: e.step.label, where: e.step.where, status: 'done' as const, startedAt: e.step.at, step: e.step }],
        }));
      } else {
        // One store update per animation frame (40 section 17.3).
        frameText = e.text;
        if (!frameScheduled) {
          frameScheduled = true;
          frame(() => {
            frameScheduled = false;
            if (mine === runId && get().phase === 'preparing' && frameText !== null) set({ answerPreview: frameText });
          });
        }
      }
    }

    /** The main option plus the ticked related options at `step`, or null when any part is missing. */
    function parts(s: AskState, step: LadderStep): StepOption[] | null {
      const main = s.proposal?.options[stepIndex(step)];
      if (!main) return null;
      const related = s.relatedSelected.map((id) => s.relatedOptions[id]?.[stepIndex(step)]);
      if (related.some((o) => o === undefined)) return null;
      return [main, ...(related as StepOption[])];
    }

    function composedAvailable(s: AskState, step: LadderStep): boolean {
      const p = parts(s, step);
      if (!p || !p.every((o) => o.available)) return false;
      if (!pipelineModule) return p.length === 1;
      return pipelineModule.composeOutgoingText(p).length <= MAX_PAYLOAD_CHARS;
    }

    /**
     * When the current step is no longer available for the composed set, drop to the highest available step below it.
     * When none is below (a related item has no answer step), take the smallest step above: the preview shows it
     * before anything can be approved, and nothing is raised further than needed.
     */
    function adjustStep(): void {
      const s = get();
      if (composedAvailable(s, s.step)) return;
      for (let i = stepIndex(s.step) - 1; i >= 0; i -= 1) {
        if (composedAvailable(s, LADDER_STEPS[i])) {
          set({ step: LADDER_STEPS[i] });
          return;
        }
      }
      for (let i = stepIndex(s.step) + 1; i < LADDER_STEPS.length; i += 1) {
        if (composedAvailable(s, LADDER_STEPS[i])) {
          set({ step: LADDER_STEPS[i] });
          return;
        }
      }
    }

    /** `mine`: the run this draft belongs to. A new question or a reset in the meantime drops its result. */
    async function runDraft(mine: number, text: string, instruction: string, shared: NonNullable<AskState['outcome']>): Promise<void> {
      if (mine !== runId) return;
      set({ phase: 'drafting', draftError: undefined });
      const end = useIndexing.getState().beginForeground();
      let draft: string | undefined;
      let draftError: string | undefined;
      try {
        const ai = await loadAi();
        const result = await ai.draftReply(text, instruction);
        if (mine !== runId) return;
        set((s) => ({ extraTrace: [...s.extraTrace, result.trace] }));   // success or not: the trace stays truthful
        if (result.ok) draft = result.value.draft;
        else draftError = draftErrorFor(result.error.code) ?? undefined;
      } catch {
        draftError = DRAFT_ERRORS.other;
      } finally {
        end();
      }
      if (mine !== runId) return;
      set({ phase: 'done', outcome: shared, ...(draft !== undefined ? { draft, draftError: undefined } : { draftError }) });
      if (draft !== undefined) announce(ASK_FLOW.draftReady);
    }

    /** True after an approval whose receipt was written and whose draft then failed. */
    function draftFailed(s: AskState): boolean {
      return s.phase === 'done' && s.outcome?.kind === 'shared' && !!s.draftError && lastDraft !== null;
    }

    /** "Try again" after a failed draft: the same approved text and instruction, only draftReply, no second receipt. */
    async function retry(): Promise<void> {
      const s = get();
      const again = lastDraft;
      if (!draftFailed(s) || !again || s.outcome?.kind !== 'shared') return;
      if (!online()) {
        set({ draftError: ASK_FLOW.offlineDraft });
        return;
      }
      await runDraft(runId, again.text, again.instruction, s.outcome);
    }

    async function approve(): Promise<void> {
      const s = get();
      if (draftFailed(s)) {
        await retry();
        return;
      }
      // Every await below may outlive this question (a new question, Ask again): nothing is written for an old run.
      const mine = runId;
      const stale = () => mine !== runId;
      const proposal = s.proposal;
      if (!proposal || s.phase !== 'ready' || !proposal.item) return;
      if (!online()) {
        set({ draftError: ASK_FLOW.offlineDraft });
        return;
      }
      const step = s.step;
      const p = parts(s, step);
      if (!p || !p.every((o) => o.available)) {
        set({ draftError: DECIDE_ERRORS.invalidStep });
        return;
      }
      const [pipeline, index] = await Promise.all([loadPipeline(), import('@/index')]);
      if (stale()) return;
      const composed = pipeline.composeOutgoingText(p);
      if (composed.length === 0) {
        set({ draftError: SEND_CHECK.empty });
        return;
      }
      if (composed.length > MAX_PAYLOAD_CHARS) {
        set({ draftError: DECIDE_ERRORS.tooLong });
        return;
      }
      const itemIds = [proposal.item.recordId, ...s.relatedSelected];
      const decision: Decision = {
        requestId: s.requestId ?? proposal.requestId,
        approved: true,
        step,
        itemIds,
        decidedBy: 'app',
        decidedAt: Date.now(),
      };
      const relatedOptions: Record<string, StepOption[]> = {};
      for (const id of s.relatedSelected) {
        const o = s.relatedOptions[id];
        if (o) relatedOptions[id] = o;
      }
      const db = index.openDb(kind);
      let result: Awaited<ReturnType<typeof pipeline.finalizeDecision>>;
      try {
        result = await pipeline.finalizeDecision(proposal, decision, { relatedOptions, db });
      } catch (error) {
        if (stale()) return;
        const message = (error as { message?: unknown } | null)?.message;
        set({ draftError: typeof message === 'string' && message ? message : ASK_FLOW.somethingWrong });
        return;
      }
      if (stale() || get().proposal !== proposal) return;
      const payload = result.payload;
      if (!payload || payload.text !== composed) {
        console.error('payload mismatch', decision.requestId);
        useToasts.getState().push({ tone: 'error', title: ASK_FLOW.mismatch });
        return;
      }
      // 70 section 3.3: rules read fresh, items still here, the text unchanged.
      const { checkBeforeSend } = await import('@/relay/sendCheck');
      if (stale()) return;
      const guard = await checkBeforeSend({
        step,
        approvedText: composed,
        payloadText: payload.text,
        itemIds,
        requester: IN_APP_REQUESTER,
        settings: settingsNow(),
        blockedRecordIds: [],
        now: Date.now(),
        getRecord: (id) => index.getRecord(db, id),
      });
      if (stale()) return;
      if (!guard.ok) {
        set({ draftError: guard.message });
        return;
      }
      const approve: TraceStep = {
        kind: 'approve',
        label: ASK_FLOW.approveTrace(LADDER_LABELS[step]),
        where: 'device',
        ms: 0,
        at: Date.now(),
      };
      set((x) => ({ extraTrace: [...x.extraTrace, approve] }));
      const instruction = get().instruction;
      const chars = payload.chars + instruction.length;
      // The receipt is saved before the cloud call: the text may leave even if the call then fails.
      try {
        if (kind === 'real') {
          const { useSession } = await import('./session');
          const uid = useSession.getState().user?.uid;
          if (!uid) throw new Error('no user');
          const { saveReceipt } = await import('@/app/services/receipts');
          if (stale()) return;
          // Only the instruction reached the cloud model; the person's own question never leaves the device.
          await saveReceipt(uid, { ...result.receipt, question: instruction, chars });
        } else {
          await tables(db).receipts.put({ ...result.receipt, chars });
        }
      } catch (error) {
        console.error('receipt not saved', (error as { code?: string }).code ?? '');
        if (!stale()) set({ draftError: ASK_FLOW.receiptFailed });
        return;
      }
      // The receipt is kept even when the question changed meanwhile: it records what was approved.
      if (stale()) return;
      const shared = { kind: 'shared' as const, receiptId: result.receipt.id, chars, step, itemCount: itemIds.length };
      lastDraft = { text: payload.text, instruction };
      await runDraft(mine, payload.text, instruction, shared);
    }

    async function guarded(run: () => Promise<void>): Promise<void> {
      const mine = runId;
      if (approvingRun === mine) return;
      approvingRun = mine;
      set({ approving: true });
      try {
        await run();
      } finally {
        if (approvingRun === mine) {
          approvingRun = null;
          set({ approving: false });
        }
      }
    }

    return {
      ...initial(),

      setQuestion: (q) => set({ question: q }),

      async ask(q) {
        // 70 section 3.1: one cleaning step for every question (invisible, direction and tag characters, pasted HTML).
        // QuestionInput's maxLength and paste note (R-IN-02) keep typed questions within the limit.
        const check = normalizeQuestion(q ?? get().question);
        if (check.error === 'empty') {
          set({ error: ASK_FLOW.emptyQuestion });
          return;
        }
        const question = check.text;
        ctl?.abort('superseded');
        const mine = ++runId;
        const c = new AbortController();
        ctl = c;
        lastDraft = null;
        frameText = null;
        const requestId = crypto.randomUUID();
        set({
          ...initial(),
          question,
          instruction: get().instruction,
          requestId,
          startedAt: Date.now(),
          phase: 'preparing',
        });
        const settings = settingsNow();
        const end = useIndexing.getState().beginForeground();
        const timer = setTimeout(() => c.abort('timeout'), ASK_TIMEOUT_MS);
        let proposal: Proposal | undefined;
        let thrown = false;
        try {
          const [pipeline, db] = await Promise.all([loadPipeline(), openDb()]);
          if (mine !== runId) return;
          proposal = await pipeline.prepareProposal({
            db,
            requestId,
            question,
            requester: IN_APP_REQUESTER,
            requestedStep: settings.defaultStep,
            maxStep: 'full',
            settings,
            dataClass,
            signal: c.signal,
            onProgress: (e) => onProgress(mine, e),
          });
        } catch {
          thrown = true;
        } finally {
          end();
          clearTimeout(timer);
        }
        if (mine !== runId) return;   // superseded, or reset
        ctl = null;
        const reason = c.signal.aborted ? (c.signal.reason as string) : undefined;
        if (reason === 'stopped') {
          set({ phase: 'idle', answerPreview: '', liveSteps: [] });
          announce(ASK_FLOW.stopped);
          return;
        }
        if (reason === 'timeout' || thrown || !proposal) {
          const error = reason === 'timeout' ? ASK_FLOW.tooSlow : ASK_FLOW.somethingWrong;
          set({ phase: 'error', error, answerPreview: '' });
          announce(error, 'assertive');
          return;
        }
        set({ phase: 'ready', proposal, step: startingStep(proposal.options, settings.defaultStep), answerPreview: '' });
        const a = outcomeAnnouncement(proposal);
        announce(a.text, a.politeness);
      },

      stop() {
        ctl?.abort('stopped');
      },

      setStep: (step) => set({ step }),

      async toggleRelated(recordId) {
        const s = get();
        const proposal = s.proposal;
        if (!proposal || s.phase !== 'ready') return;
        if (s.relatedSelected.includes(recordId)) {
          set({ relatedSelected: s.relatedSelected.filter((x) => x !== recordId) });
          return;
        }
        set({
          relatedSelected: [...s.relatedSelected, recordId],
          relatedFailed: s.relatedFailed.filter((x) => x !== recordId),
        });
        if (!s.relatedOptions[recordId]) {
          set((x) => ({ relatedLoading: [...x.relatedLoading, recordId] }));
          try {
            const [pipeline, db] = await Promise.all([loadPipeline(), openDb()]);
            const options = await pipeline.buildRelatedOptions({ db, proposal, recordId, dataClass });
            if (get().proposal !== proposal) return;
            set((x) => ({ relatedOptions: { ...x.relatedOptions, [recordId]: options } }));
          } catch {
            if (get().proposal !== proposal) return;
            set((x) => ({
              relatedSelected: x.relatedSelected.filter((id) => id !== recordId),
              relatedFailed: [...x.relatedFailed, recordId],
            }));
          } finally {
            set((x) => ({ relatedLoading: x.relatedLoading.filter((id) => id !== recordId) }));
          }
        }
        adjustStep();
      },

      setInstruction: (text) => set({ instruction: text.trim().slice(0, 200) }),

      keepLocal() {
        if (get().phase !== 'ready') return;
        set({ outcome: { kind: 'kept-local' }, phase: 'done' });
        announce(ASK_FLOW.keptLocal);
      },

      // A double click must not write two receipts or run two drafts. The guard is per question: an approval still
      // finishing for an old question does not hold up the new one.
      approveAndDraft: () => guarded(approve),
      retryDraft: () => guarded(retry),

      async allowCloudFor(recordId) {
        const db = await openDb();
        await tables(db).consents.put({ recordId, cloudAllowedAt: Date.now() });
        await get().ask(get().question);
      },

      reset() {
        ctl?.abort('reset');
        ctl = null;
        runId += 1;
        lastDraft = null;
        set({ ...initial(), question: get().question });
      },
    };
  });
}

export const useAskReal = createAskStore('real');
export const useAskPlayground = createAskStore('playground');

// Test fixtures for the relay and state layers: request views, proposals and step options.
import { LADDER_STEPS, type LadderStep, type Proposal, type StepOption } from '@sieve/shared';
import type { PendingEntry } from '@/state/homeBase';
import type { RelayRequestView } from '@/state/types';

export const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);

export function request(over: Partial<RelayRequestView> = {}): RelayRequestView {
  return {
    id: 'req1',
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
    tool: 'sieve_answer',
    requestedStep: 'answer',
    maxStep: 'full',
    allowedCategories: ['Home', 'Work', 'Money', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos'],
    allowedSources: ['gmail', 'folder', 'upload'],
    question: 'What did my landlord say about the deposit?',
    status: 'queued',
    createdAt: T0,
    expireAt: T0 + 24 * 3600_000,
    ...over,
  };
}

export function option(step: LadderStep, text: string, over: Partial<StepOption> = {}): StepOption {
  return { step, text, chars: text.length, redactions: 0, available: true, ...over };
}

export const LANDLORD_TEXTS: Record<LadderStep, string> = {
  answer: 'Your deposit was $1,200, paid on March 3.',
  excerpt: 'The deposit of $1,200 was received on March 3.',
  full: 'Subject: Re: Deposit for the apartment\nThe deposit of $1,200 was received on March 3. Thanks.',
};

export function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    requestId: 'req1',
    requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
    question: 'What did my landlord say about the deposit?',
    requestedStep: 'answer',
    maxStep: 'full',
    item: { recordId: 'gmail:m1', title: 'Re: Deposit for the apartment', kind: 'email', category: 'Home', date: T0 - 86400_000, from: 'Landlord <l@example.com>' },
    related: [{ recordId: 'gmail:m2', score: 0.5, matchedBy: 'vector', reason: 'also about the flat' }],
    options: LADDER_STEPS.map((s) => option(s, LANDLORD_TEXTS[s], { trace: [{ kind: 'answer', label: 'x', where: 'device', ms: 1, at: T0 }] })),
    rule: 'approve',
    warnings: [],
    trace: [{ kind: 'retrieve', label: 'Searched', where: 'code', ms: 3, at: T0 }],
    outcome: 'ready',
    createdAt: T0 + 1000,
    ...over,
  };
}

export function entry(over: Partial<PendingEntry> = {}): PendingEntry {
  return {
    requestId: 'req1',
    request: request({ status: 'awaiting-person', claimedBy: 'dev1' }),
    phase: 'awaiting-person',
    liveSteps: [],
    answerPreview: '',
    proposal: proposal(),
    relatedSelected: [],
    relatedOptions: {},
    relatedLoading: [],
    lastPreviewItemIds: [],
    ...over,
  };
}

/** The pipeline's composeOutgoingText (10 section 12.8). */
export const compose = (parts: StepOption[]): string => parts.map((o) => o.text).join('\n\n');

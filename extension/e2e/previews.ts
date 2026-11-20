// ProposalPreview fixtures from the Playground persona (data/playground): the deposit email, the lease pets
// clause, and a Money statement that asks first. Shared by the e2e specs and the unit tests.
import type { LadderStep, ProposalPreview, StepOption } from '@sieve/shared';

export function option(step: LadderStep, text: string, extra: Partial<StepOption> = {}): StepOption {
  return { step, text, chars: text.length, redactions: 0, available: true, ...extra };
}

export const DEPOSIT_ANSWER = 'Your deposit was $1,200, paid on March 3.';
export const DEPOSIT_EXCERPT =
  'We received your security deposit of $1,200 on March 3. It will be returned within 30 days of move-out, minus any repair costs.';
export const DEPOSIT_FULL =
  'Hi Alex, thanks for your email. We received your security deposit of $1,200 on March 3. It will be returned within 30 days of move-out, minus any repair costs. Let me know your move-out date so we can schedule the inspection.\n\nBest,\nDana\nThistlewick Property Management\n[phone]';

export const DEPOSIT: ProposalPreview = {
  requestId: 'req-deposit-1',
  requester: { kind: 'outside', grantId: 'grant-test-1', aiName: 'Test assistant' },
  question: 'What did my landlord say about the deposit?',
  requestedStep: 'answer',
  maxStep: 'full',
  item: { title: 'Re: Deposit for the apartment', kind: 'email', category: 'Home', date: Date.UTC(2026, 9, 29, 15, 4) },
  options: [
    option('answer', DEPOSIT_ANSWER),
    option('excerpt', DEPOSIT_EXCERPT),
    option('full', DEPOSIT_FULL, { redactions: 1 }),
  ],
  rule: 'approve',
  warnings: [],
  outcome: 'ready',
};

export const LEASE_ANSWER = 'You may keep one cat or one dog under 40 pounds with written approval, after a $300 pet fee.';
export const LEASE_EXCERPT =
  '12. Pets. Tenant may keep one cat or one dog under 40 pounds with prior written approval from the Landlord. A non-refundable pet fee of $300 is due before the pet moves in. Exotic animals are not permitted.';

export const LEASE: ProposalPreview = {
  requestId: 'req-lease-pets-1',
  requester: { kind: 'outside', grantId: 'grant-test-2', aiName: 'Planner' },
  question: 'Can I have a dog in my apartment?',
  requestedStep: 'excerpt',
  maxStep: 'excerpt',
  item: { title: 'Lease_2026.pdf', kind: 'document', category: 'Home', date: Date.UTC(2026, 0, 2, 12, 0) },
  options: [
    option('answer', LEASE_ANSWER),
    option('excerpt', LEASE_EXCERPT),
    option('full', '', { available: false, unavailableReason: 'Planner may only receive an excerpt.' }),
  ],
  rule: 'approve',
  warnings: [],
  outcome: 'ready',
};

export const STATEMENT_ANSWER = 'Your ending balance on November 2 was $3,482.17.';

export const STATEMENT: ProposalPreview = {
  requestId: 'req-statement-1',
  requester: { kind: 'outside', grantId: 'grant-test-1', aiName: 'Test assistant' },
  question: "What's my latest bank balance?",
  requestedStep: 'answer',
  maxStep: 'full',
  item: { title: 'Your November statement is ready', kind: 'email', category: 'Money', date: Date.UTC(2026, 10, 3, 12, 15) },
  options: [
    option('answer', STATEMENT_ANSWER),
    option('excerpt', 'Statement period: October 3 to November 2, 2026\nEnding balance: $3,482.17', { redactions: 0 }),
    option('full', 'Hello [name],\n\nYour statement for checking account [account ending 4417] is ready to view.', {
      redactions: 2,
    }),
  ],
  rule: 'ask-first',
  warnings: [{ kind: 'ask-first', message: 'Money items ask first. Check the text before you approve.' }],
  outcome: 'ready',
};

/** A copy with a new id and any changes, for building lists. */
export function variant(base: ProposalPreview, changes: Partial<ProposalPreview>): ProposalPreview {
  return { ...base, ...changes };
}

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Proposal, StepOption } from '@sieve/shared';
import { expectNoAxeViolations } from '@/test/axe';
import {
  bankAskFirst, DEPOSIT_ANSWER, errorOutcome, healthBlocked, landlordReady, modelUnavailable, noMatch, option, parcelInjection,
  traceSteps, uploadNeedsConsent,
} from '../__fixtures__/proposals';
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard';
import { askCardView } from './askView';
import { composeOptions, startingStep } from './composedOptions';

const compose = (o: StepOption[]) => o.map((x) => x.text).join('\n\n');

function props(proposal: Proposal, extra: Partial<ApprovalCardProps> = {}): ApprovalCardProps {
  return {
    variant: 'in-app',
    proposal,
    aiName: 'Gemini (in Sieve)',
    meta: {},
    step: 'answer',
    onStepChange: vi.fn(),
    composedOptions: proposal.options,
    relatedSelected: [],
    relatedLoading: [],
    onToggleRelated: vi.fn(),
    phase: 'open',
    canApprove: true,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onAllowCloud: vi.fn(),
    onOpenItem: vi.fn(),
    ...extra,
  };
}

function renderCard(p: ApprovalCardProps) {
  return render(<MemoryRouter><main><ApprovalCard {...p} /></main></MemoryRouter>);
}

describe('ApprovalCard', () => {
  it('in-app: item, answer headline, ladder, exact preview with the instruction, warnings, decision and trace', async () => {
    const p = props(landlordReady, { instruction: 'Draft a short, polite reply.', instructionSlot: <p>instruction slot</p> });
    renderCard(p);
    expect(screen.getByRole('heading', { level: 2, name: 'Re: Deposit for the apartment' })).toBeInTheDocument();
    expect(screen.getByTestId('answer-headline').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByRole('radiogroup', { name: 'Share the least it can' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 · Answer only' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '3 · Full email' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_ANSWER);
    expect(screen.getByText('Plus your instruction')).toBeInTheDocument();
    expect(screen.getByText('instruction slot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use it here, share nothing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft a reply with the cloud model' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Might also matter' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Where each step ran' })).toBeInTheDocument();
    expect(screen.queryByText(/Approve only if you asked/)).toBeNull();   // 70 R-MCP-09: relay cards only
    await expectNoAxeViolations();
  });

  it('relay: no headline, the relay labels, the list column with the main item first', async () => {
    renderCard(props({ ...landlordReady, requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' } }, { variant: 'relay', aiName: 'Gemini CLI' }));
    expect(screen.queryByTestId('answer-headline')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'What Gemini CLI would receive' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Exactly what Gemini CLI would receive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.getByText('Best match')).toBeInTheDocument();
    // 70 R-MCP-09: the social-engineering line, last before the decision buttons
    const line = screen.getByText("Approve only if you asked Gemini CLI for this. If you didn't, deny it and turn off this connection in Settings.");
    expect(line.compareDocumentPosition(screen.getByRole('button', { name: 'Approve and send' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expectNoAxeViolations();
  });

  it('Playground: the rule line and the collapsed "Might also matter (2)" disclosure', async () => {
    renderCard(props(landlordReady, { variant: 'playground', sampleData: true }));
    expect(screen.getByText('Home · shares with your approval')).toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: 'Might also matter (2)' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(disclosure);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await expectNoAxeViolations();
  });

  it('the "Money asks first" banner sits directly before the decision buttons', async () => {
    renderCard(props(bankAskFirst, { instructionSlot: <label>Instruction<input /></label> }));
    const banner = document.querySelector('[data-warning="ask-first"]') as HTMLElement;
    expect(banner).toHaveTextContent('Money asks first');
    const deny = screen.getByRole('button', { name: 'Use it here, share nothing' });
    const focusables = [...document.querySelectorAll('input, button')];
    const afterBanner = focusables.filter((e) => banner.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(afterBanner[0]).toBe(deny);
    const warnings = [...document.querySelectorAll('[data-warning]')];
    expect(warnings[warnings.length - 1]).toBe(banner);
    await expectNoAxeViolations();
  });

  it('warnings for a hidden instruction', () => {
    renderCard(props(parcelInjection));
    expect(screen.getByText('Possible instruction aimed at an AI')).toBeInTheDocument();
    expect(screen.getByText('Hidden text removed before any model read it')).toBeInTheDocument();
  });

  it('decided: the ladder and related checkboxes are disabled, buttons gone, the result shows', async () => {
    renderCard(props(landlordReady, { phase: 'decided', resultSlot: <p data-result-line tabIndex={-1}>Sent only the answer to the cloud model.</p> }));
    expect(screen.queryByRole('button', { name: 'Draft a reply with the cloud model' })).toBeNull();
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByText('Sent only the answer to the cloud model.')).toHaveFocus();
    await expectNoAxeViolations();
  });

  it('ticking a related item and changing the step call back', async () => {
    const p = props(landlordReady);
    renderCard(p);
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(p.onToggleRelated).toHaveBeenCalledWith('playground:pg-mail-01');
    await userEvent.click(screen.getByRole('radio', { name: '2 · Excerpt' }));
    expect(p.onStepChange).toHaveBeenCalledWith('excerpt');
    await userEvent.click(screen.getByRole('button', { name: 'Open on this device' }));
    expect(p.onOpenItem).toHaveBeenCalledWith('playground:pg-mail-02');
  });

  it.each([
    [healthBlocked, 'Health is never shared'],
    [noMatch, 'Nothing on this device matched'],
    [modelUnavailable, "The on-device model isn't available"],
    [errorOutcome, 'Something went wrong on this device'],
  ])('outcome %#: the outcome panel and the trace, no decision buttons', async (proposal, title) => {
    renderCard(props(proposal, { onRetry: vi.fn() }));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft a reply with the cloud model' })).toBeNull();
    expect(screen.getByRole('button', { name: 'What happened, step by step' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a never item shows only its title and category, and red rule rows', () => {
    renderCard(props(healthBlocked));
    expect(screen.getByRole('heading', { name: 'Your test results are ready to view' })).toBeInTheDocument();
    expect(screen.queryByText('Found on this device')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open on this device' })).toBeNull();
    const rule = document.querySelector('li[data-kind="rule"]') as HTMLElement;
    expect(within(rule).getByText('Rule').closest('[data-tone]')).toHaveAttribute('data-tone', 'never');
  });

  it('needs-cloud-consent: the consent panel; allowing names the item', async () => {
    const p = props(uploadNeedsConsent, { variant: 'playground' });
    renderCard(p);
    expect(screen.getByRole('heading', { name: 'Allow the cloud model to read this item?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow the cloud for this file' }));
    expect(p.onAllowCloud).toHaveBeenCalledWith('upload:upload-1');
    await expectNoAxeViolations();
  });
});

describe('composeOptions and askCardView', () => {
  const related = [unavailableAnswer(), option('excerpt', 'Also shared: Deposit (Oct 28, 2026)\nI paid it on March 3.'), option('full', 'Also shared: full')];
  function unavailableAnswer(): StepOption {
    return { step: 'answer', text: '', chars: 0, redactions: 0, available: false, unavailableReason: 'Related items can be shared as an excerpt or the full item.' };
  }

  it('returns the main options when nothing is ticked, and composes with the pipeline function otherwise', () => {
    expect(composeOptions(landlordReady.options, [], compose)).toEqual(landlordReady.options);
    const out = composeOptions(landlordReady.options, [related], compose);
    expect(out[0].available).toBe(false);
    expect(out[0].unavailableReason).toBe('Related items can be shared as an excerpt or the full item.');
    expect(out[1].text).toBe(`${landlordReady.options[1].text}\n\nAlso shared: Deposit (Oct 28, 2026)\nI paid it on March 3.`);
    expect(out[1].chars).toBe(out[1].text.length);
    expect(out[2].redactions).toBe(3);
  });

  it('marks a composition over 8,000 characters as too long, keeping its text for the preview', () => {
    const big = [unavailableAnswer(), option('excerpt', 'x'.repeat(8000)), option('full', 'y')];
    const out = composeOptions(landlordReady.options, [big], compose);
    expect(out[1].available).toBe(false);
    expect(out[1].unavailableReason).toBe('Too long to send at once');
    expect(out[1].chars).toBeGreaterThan(8000);
  });

  it('starting step: the default when available, else the highest below, else the lowest above', () => {
    expect(startingStep(landlordReady.options, 'answer')).toBe('answer');
    expect(startingStep(uploadNeedsConsent.options, 'answer')).toBe('full');
    expect(startingStep([option('answer', 'a'), unavailableAnswerAt('excerpt'), option('full', 'f')], 'excerpt')).toBe('answer');
    function unavailableAnswerAt(step: 'excerpt'): StepOption {
      return { step, text: '', chars: 0, redactions: 0, available: false };
    }
  });

  it('askCardView: approve reasons in order (offline, loading, too long, unavailable) and the step phrase', () => {
    const base = { phase: 'ready' as const, proposal: landlordReady, step: 'answer' as const, relatedSelected: [], relatedOptions: {}, relatedLoading: [] };
    expect(askCardView(base, { online: true, compose })?.canApprove).toBe(true);
    expect(askCardView(base, { online: false, compose })?.approveBlockedReason).toBe("You're offline. Drafting needs the cloud model.");
    expect(askCardView({ ...base, relatedSelected: ['playground:pg-mail-01'], relatedLoading: ['playground:pg-mail-01'] }, { online: true, compose })?.approveBlockedReason).toBe(
      'Wait for the ticked items to be ready.',
    );
    const ticked = askCardView({ ...base, step: 'excerpt', relatedSelected: ['playground:pg-mail-01'], relatedOptions: { 'playground:pg-mail-01': related } }, { online: true, compose });
    expect(ticked?.stepPhrase).toBe('an excerpt from 2 items');
    expect(ticked?.canApprove).toBe(true);
    expect(askCardView({ ...base, relatedSelected: ['playground:pg-mail-01'], relatedOptions: { 'playground:pg-mail-01': related } }, { online: true, compose })?.approveBlockedReason).toBe(
      "This step isn't available.",
    );
    expect(askCardView({ ...base, phase: 'drafting' }, { online: true, compose })?.cardPhase).toBe('decided');
    expect(askCardView({ ...base, proposal: { ...landlordReady, trace: [...landlordReady.trace, traceSteps.approve()] } }, { online: true, compose })?.stepPhrase).toBe('the answer');
  });
});

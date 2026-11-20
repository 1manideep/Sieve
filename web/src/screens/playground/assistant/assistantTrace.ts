// The two-lane trace of one question to the Playground assistant (00 D4): the device lane is what Sieve did for the
// request on this device (the proposal trace and the approval), the cloud lane is what Gemini did with what it got.
// Only the approved text Gemini received counts as crossing to the cloud.
import { LADDER_LABELS, type TraceStep } from '@sieve/shared';
import { formatCount } from '@/copy/format';
import { PLAYGROUND_ASSISTANT_COPY as COPY, fill } from '@/copy/screens-main';
import type { PendingEntry } from '@/state/homeBase';
import type { AssistantTurn } from './assistantStore';

/** The relay entry's own steps, plus "You approved" once the person sent it. */
export function deviceStepsFor(entry: PendingEntry | undefined): TraceStep[] {
  if (!entry?.proposal) return [];
  const steps = [...entry.proposal.trace];
  const result = entry.result;
  if (result?.kind === 'sent' && !steps.some((s) => s.kind === 'approve')) {
    const last = steps.reduce((at, s) => Math.max(at, s.at + s.ms), entry.proposal.createdAt);
    steps.push({ kind: 'approve', label: fill(COPY.approvedLabel, { step: LADDER_LABELS[result.step] }), where: 'device', ms: 0, at: last });
  }
  return steps;
}

export function turnTrace(turn: AssistantTurn, device: Record<string, TraceStep[]>): TraceStep[] {
  const ids = [...new Set(turn.calls.map((c) => c.requestId).filter((id): id is string => Boolean(id)))];
  const deviceSteps = ids.flatMap((id) => device[id] ?? []);
  const cloud: TraceStep[] = [];
  for (const call of turn.calls) {
    if (!call.handedToGemini || call.chars === 0) continue;
    cloud.push({
      kind: 'deliver',
      label: call.chars === 1 ? COPY.deliveredLabelOne : fill(COPY.deliveredLabel, { n: formatCount(call.chars) }),
      where: 'cloud',
      ms: call.ms,
      charsSent: call.chars,
      at: call.startedAt + call.ms,
    });
  }
  const last = turn.modelTurns[turn.modelTurns.length - 1];
  if (turn.outcome?.kind === 'answered' && last) {
    const n = turn.modelTurns.length;
    cloud.push({
      kind: 'answer',
      label: n === 1 ? COPY.replyLabelOne : fill(COPY.replyLabel, { n }),
      where: 'cloud',
      modeRequested: 'ONLY_IN_CLOUD',
      sdkReported: last.source,
      model: last.model,
      ms: turn.modelTurns.reduce((sum, t) => sum + t.ms, 0),
      at: last.at,
    });
  }
  return [...deviceSteps, ...cloud];
}

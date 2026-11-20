// The pipeline (docs/spec/10-ai-layer.md section 12): question to Proposal, decision to payload and receipt.
// Contract: 01 section 9 with the additions of 01 section 11.4.

export type { CloudConsentRequest, PipelineProgress, PrepareInput } from './types';
export { prepareProposal, screenCandidates } from './prepareProposal';
export { finalizeDecision, type FinalizeExtras, type FinalizeResult } from './finalizeDecision';
export { DecisionError, type DecisionErrorCode } from './errors';
export { buildRelatedOptions } from './related';
export { composeOutgoingText, recordDataClass, ruleFor, stepIndex } from './steps';
export { getCloudConsentRequest, grantCloudConsent } from './consent';
export { splitDraftRequest, actionVerb } from './split';
export { STEP_LABEL, LABELS, RUNNING, WARNINGS, UNAVAILABLE, WHERE_PHRASE, formatDate, kindNoun } from './copy';
export { startEnrichment, nudgeEnrichment, needsWork, type EnrichController, type EnrichMark, type EnrichTask } from './enrich';

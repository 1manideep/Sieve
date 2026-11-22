// The AI layer (docs/spec/10-ai-layer.md): every model call, Firebase AI Logic, Gemini Nano, App Check, prompts and
// the trace. Contract: 01 section 9, with the additions of 01 section 11.4 and 10 section 18.

export type { DataClass, ModelError, ModelErrorCode, OwnCloudPolicy, Priority, PromptPart, Purpose, RunModelArgs, RunModelResult } from './types';

// Calls
export { runModel, getPolicyBreaches, RETRY_REMINDER } from './runModel';
export { labelBatch, parseLabels, labelPrompt, type LabelBatchResult, type LabelItem } from './tasks/label';
export {
  selectAndAnswer, recordBody, fitPassages, deriveExcerpt, excerptBasis, bestWindow, snapToSentences, selectPrompt, countNoun,
  type Passage, type PassageRange, type SelectOptions, type SelectValue,
} from './tasks/select';
export { verifyAnswer, verifyPrompt, type VerifyOptions, type VerifyValue } from './tasks/verify';
export { captionPhoto } from './tasks/caption';
export { draftReply, draftPrompt } from './tasks/draft';
export { codeLabel, isBulkTab, isHealthStrong, isSystemSender, CODE_LABEL_RULES, HEALTH_STRONG } from './tasks/codeLabel';
export { toJpegPart } from './image';

// Prompts and versions
export { PROMPT_VERSIONS } from './versions';
export {
  LABEL_SYSTEM, LABEL_SCHEMA, SELECT_SYSTEM, SELECT_SCHEMA, VERIFY_SYSTEM, VERIFY_SCHEMA, CAPTION_SYSTEM, DRAFT_SYSTEM, DEFAULT_DRAFT_INSTRUCTION,
} from './prompts';

// Setup, availability and the device engine
export { initAi, getAiInstance, getAppCheckInstance } from './init';
export {
  getNanoAvailability, getNanoState, subscribeNano, setNanoSimulation, isNanoSimulated, type NanoState,
} from './device/availability';
export { downloadNano, NanoSetupError, NANO_SETUP_MESSAGES, type NanoSetupCode } from './device/setup';
export { deviceSchedulerState, subscribeScheduler, currentDeviceCall, type DeviceCallContext } from './device/scheduler';

// Policy
export { resolveRoute, hasFreshConsent, consentsOf, POLICY_MESSAGES, type ConsentRow, type Route } from './policy';

// Plain-code helpers shared with the pipeline
export { sentences, contentWords, stem, collapseWhitespace, cutAtWord, localDay, STOPWORDS, type Range } from './text';
export { extractFacts, normFact, findUnsupportedFacts } from './facts';
export { estimateTokens, estimatePromptTokens, charsForTokens } from './budget';
export { codeTrace, modelTrace } from './trace';
export { CANDIDATE_POOL, CONSENT_MAX_AGE_MS, EXCERPT_MAX_CHARS, ANSWER_MAX_CHARS, SELECT_MAX_PASSAGES } from './config';

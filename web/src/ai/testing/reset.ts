// Resets every piece of module state in the AI layer, for unit tests.
import { TIMING, BACKGROUND_RESUME_DELAY_MS, SAMPLE_QUOTA_RETRY_MS } from '../config';
import { resetAvailabilityForTests } from '../device/availability';
import { setLanguageModelForTests } from '../device/languageModel';
import { resetSchedulerForTests } from '../device/scheduler';
import { dropBaseSessions } from '../device/sessions';
import { resetE2EHooksForTests } from '../e2e';
import { clearModelCache, setHybridForTests } from '../hybrid';
import { resetInitForTests } from '../init';
import { resetPolicyBreachesForTests } from '../runModel';

export function resetAiForTests(): void {
  dropBaseSessions();
  resetSchedulerForTests();
  resetAvailabilityForTests();
  setLanguageModelForTests(null);
  setHybridForTests(null);
  clearModelCache();
  resetInitForTests();
  resetPolicyBreachesForTests();
  resetE2EHooksForTests();
  TIMING.backgroundResumeDelayMs = BACKGROUND_RESUME_DELAY_MS;
  TIMING.sampleQuotaRetryMs = SAMPLE_QUOTA_RETRY_MS;
}

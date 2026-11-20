// 10 section 16.12: checks with the real Gemini Nano. They need Chrome with the model on Mani's Mac, so they are run by
// hand (from the spike page, or the Playground with Nano), not in Vitest. Listed here so they show in every test run.
import { describe, it } from 'vitest';

describe('16.12 with the real Nano (manual, on the demo Mac)', () => {
  it.todo('RN-1: each EMAILS case through selectAndAnswer alone and mixed with 4 distractors: every expect group found; missing gives recordId null');
  it.todo('RN-2: labelBatch on the 50 SUBJECTS: Health 8/8; 45/50 or better; time per 10 under 10 s');
  it.todo('RN-3: each INJECTION sample as the only passage, "What does this email want?": the answer never repeats the instruction, no email address or link');
  it.todo('RN-4: golden path in the Playground with Nano: proposal in 15 s or less, first answer text in 4 s or less, select on this device, draft in the cloud');
  it.todo('RN-5: the same with setNanoSimulation(true): select in the cloud, labelled, warning sample-data-cloud');
  it.todo('RN-6: a question while a label batch runs: the batch is preempted, the answer streams within 4 s');
  it.todo('V1/S1: routing through SieveDeviceAdapter reports on_device; forced unavailable throws unsupported with no network request');
  it.todo('V4/S13: initialPrompts with string system content is accepted and followed');
  it.todo('V5/S4: promptStreaming yields deltas (the adapter converts cumulative text if not)');
  it.todo('V6/S2: clone of a warm base is 300 ms or less and keeps the system prompt');
  it.todo('V7/S8: create() without a click when the model is available (decides the "Click anywhere" path)');
  it.todo('V2, V3, V10/S12: cloud models accept responseSchema with propertyOrdering and the thinking levels; App Check failure status and message');
  it.todo('R-IN-08/V20: whether expectedInputs and expectedOutputs may list en, es, ja, de, fr without lowering availability');
});

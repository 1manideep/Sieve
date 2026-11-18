// Sieve spike: Gemini Nano THROUGH Firebase AI Logic (firebase/ai 13.3.0), not the raw Prompt API.
// Day-1 checks from 00-overview section 10 (D3, D12, D13) and 10-ai-layer section 14 (S1, S2, S8):
//   T1 the SDK's built-in Chrome adapter, ONLY_ON_DEVICE: does inferenceSource say on_device?
//   T2 Sieve's own adapter (10-ai-layer 7.5) passed to new GenerativeModel(...): same question
//   T3 Sieve's adapter with isAvailable forced false: AIError 'unsupported' and NO network request
//   T4 streaming through Sieve's adapter: chunks arrive as deltas, time to first chunk
//   S2 create() vs clone() from a warm base
//   S8 create() on a fresh page load with no click (run from the auto-run on load)
// Run once online, then again with Wi-Fi off. Results are POSTed to spikes/results/ (git-ignored).
// The Firebase config is a placeholder unless one is pasted: on-device calls need no project, which is
// itself part of the check (nothing should leave this computer in ONLY_ON_DEVICE).
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, GenerativeModel, AIError } from 'firebase/ai';

const $ = (s) => document.querySelector(s);
const logEl = $('#log');
const TEXT_IO = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const PLACEHOLDER = { apiKey: 'placeholder-no-project-yet', projectId: 'sieve-placeholder', appId: '1:000000000000:web:placeholder' };
const PROMPT = 'Reply with exactly one word: BANANA';
const AI_HOSTS = ['firebasevertexai.googleapis.com', 'generativelanguage.googleapis.com', 'firebaseappcheck.googleapis.com'];

function log(msg, cls = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg;
  logEl.append(d);
  d.scrollIntoView({ block: 'nearest' });
}
const since = (t0) => Math.round(performance.now() - t0);
const results = { test: 'firebase-ai', startedAt: new Date().toISOString(), userAgent: navigator.userAgent, sdk: '13.3.0', runs: [] };

function loadConfig() {
  try {
    const raw = localStorage.getItem('sieve-spike-firebase-config');
    if (raw) return { config: JSON.parse(raw), placeholder: false };
  } catch { /* ignore */ }
  return { config: PLACEHOLDER, placeholder: true };
}

function networkCallsToAi(sinceIndex) {
  const entries = performance.getEntriesByType('resource').slice(sinceIndex);
  return entries.filter((e) => AI_HOSTS.some((h) => e.name.includes(h))).map((e) => e.name);
}

// Sieve's adapter, reduced to what the SDK needs (10-ai-layer 7.5). One user message per call,
// parts mapped to Prompt API content, a fresh clone of a warm base per prompt, destroyed after.
class SieveDeviceAdapter {
  constructor({ mode, forceUnavailable = false, base = null }) {
    this.mode = mode;                       // read by the SDK's routing
    this.forceUnavailable = forceUnavailable;
    this.base = base;                       // warm base session (may be null: create per call)
    this.calls = [];
  }
  async isAvailable(request) {
    if (this.forceUnavailable) return false;
    const hasImage = (request.contents ?? []).some((c) => (c.parts ?? []).some((p) => p.inlineData));
    const a = await LanguageModel.availability(hasImage ? { expectedInputs: [{ type: 'image' }] } : TEXT_IO);
    return a === 'available';
  }
  async _session() {
    if (this.base) return this.base.clone();
    return LanguageModel.create(TEXT_IO);
  }
  _content(request) {
    const contents = request.contents ?? [];
    if (contents.length !== 1 || contents[0].role !== 'user') throw new Error('Sieve sends one user message per call');
    return contents[0].parts.map((p) => (p.text !== undefined ? { type: 'text', value: p.text } : { type: 'image', value: p.inlineData }));
  }
  async generateContent(request) {
    const content = this._content(request);
    const s = await this._session();
    try {
      const t0 = performance.now();
      const text = await s.prompt([{ role: 'user', content }]);
      this.calls.push({ kind: 'generate', ms: since(t0) });
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }), { headers: { 'Content-Type': 'application/json' } });
    } finally { s.destroy(); }
  }
  async generateContentStream(request) {
    const content = this._content(request);
    const s = await this._session();
    const enc = new TextEncoder();
    const src = s.promptStreaming([{ role: 'user', content }]);
    const reader = src.getReader();
    const stats = { kind: 'stream', chunks: 0, firstMs: null, cumulative: null, t0: performance.now() };
    this.calls.push(stats);
    let prev = '';
    const body = new ReadableStream({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) { controller.close(); s.destroy(); stats.totalMs = since(stats.t0); return; }
        stats.chunks += 1;
        if (stats.firstMs === null) stats.firstMs = since(stats.t0);
        // Chrome 157 Prompt API streams deltas; record whether a chunk repeats the previous text (cumulative)
        if (stats.chunks === 2) stats.cumulative = value.startsWith(prev) && prev.length > 0;
        prev = value;
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: value }] } }] })}\n\n`));
      },
      cancel() { reader.cancel(); s.destroy(); },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  countTokens() { return Promise.reject(new Error('countTokens is not used on device')); }
}

async function run(label) {
  $('#run').disabled = true;
  results.runs = [];
  const { config, placeholder } = loadConfig();
  const run = { label, online: navigator.onLine, placeholderConfig: placeholder, at: new Date().toISOString(), steps: {} };
  results.runs.push(run);
  log(`Run "${label}": navigator.onLine=${navigator.onLine}, config=${placeholder ? 'placeholder' : 'real project'}`);

  if (!('LanguageModel' in self)) { log('No Prompt API in this Chrome.', 'bad'); run.steps.env = 'no LanguageModel'; return finish(); }
  run.steps.availability = await LanguageModel.availability(TEXT_IO);
  log(`Prompt API availability (text): ${run.steps.availability}`, run.steps.availability === 'available' ? 'good' : 'warn');

  const app = initializeApp(config, `spike-${Date.now()}`);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const resourceMark = performance.getEntriesByType('resource').length;

  // T1 built-in adapter
  try {
    const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams: { createOptions: TEXT_IO } });
    const t0 = performance.now();
    const res = await model.generateContent(PROMPT);
    const text = res.response.text();
    run.steps.t1 = { ok: true, ms: since(t0), inferenceSource: res.response.inferenceSource, text: text.slice(0, 80) };
    log(`T1 built-in adapter, ONLY_ON_DEVICE: ${since(t0)} ms, inferenceSource=${res.response.inferenceSource}, text="${text.trim().slice(0, 40)}"`, res.response.inferenceSource === 'on_device' ? 'good' : 'bad');
  } catch (e) {
    run.steps.t1 = { ok: false, error: `${e.name}: ${e.message}`, code: e instanceof AIError ? e.code : undefined };
    log(`T1 failed: ${e.name} ${e.code ?? ''} ${e.message}`, 'bad');
  }

  // S2 warm base: create vs clone
  let base = null;
  try {
    let t0 = performance.now();
    base = await LanguageModel.create(TEXT_IO);
    const createMs = since(t0);
    t0 = performance.now();
    const c = await base.clone();
    const cloneMs = since(t0);
    c.destroy();
    run.steps.s2 = { createMs, cloneMs };
    log(`S2 create() ${createMs} ms, clone() ${cloneMs} ms`, cloneMs <= 300 ? 'good' : 'warn');
  } catch (e) { run.steps.s2 = { error: `${e.name}: ${e.message}` }; log(`S2 failed: ${e.message}`, 'bad'); }

  // T2 Sieve adapter
  try {
    const adapter = new SieveDeviceAdapter({ mode: InferenceMode.ONLY_ON_DEVICE, base });
    const model = new GenerativeModel(ai, { model: 'gemini-3.5-flash-lite' }, undefined, adapter);
    const t0 = performance.now();
    const res = await model.generateContent(PROMPT);
    const text = res.response.text();
    run.steps.t2 = { ok: true, ms: since(t0), inferenceSource: res.response.inferenceSource, text: text.slice(0, 80), adapterCalls: adapter.calls };
    log(`T2 Sieve adapter, ONLY_ON_DEVICE: ${since(t0)} ms, inferenceSource=${res.response.inferenceSource}, text="${text.trim().slice(0, 40)}"`, res.response.inferenceSource === 'on_device' ? 'good' : 'bad');
  } catch (e) {
    run.steps.t2 = { ok: false, error: `${e.name}: ${e.message}`, code: e instanceof AIError ? e.code : undefined };
    log(`T2 failed: ${e.name} ${e.code ?? ''} ${e.message}`, 'bad');
  }

  // T3 forced unavailable: must throw 'unsupported' and make no network call
  try {
    const before = performance.getEntriesByType('resource').length;
    const adapter = new SieveDeviceAdapter({ mode: InferenceMode.ONLY_ON_DEVICE, forceUnavailable: true });
    const model = new GenerativeModel(ai, { model: 'gemini-3.5-flash-lite' }, undefined, adapter);
    const t0 = performance.now();
    let outcome;
    try { const res = await model.generateContent(PROMPT); outcome = { threw: false, inferenceSource: res.response.inferenceSource }; }
    catch (e) { outcome = { threw: true, name: e.name, code: e instanceof AIError ? e.code : undefined, message: e.message.slice(0, 160) }; }
    await new Promise((r) => setTimeout(r, 300));
    outcome.networkCallsToAi = networkCallsToAi(before);
    outcome.ms = since(t0);
    run.steps.t3 = outcome;
    const pass = outcome.threw && outcome.code === 'unsupported' && outcome.networkCallsToAi.length === 0;
    log(`T3 forced unavailable: ${outcome.threw ? `threw ${outcome.name} code=${outcome.code}` : `did NOT throw (source=${outcome.inferenceSource})`}; AI network calls: ${outcome.networkCallsToAi.length}`, pass ? 'good' : 'bad');
  } catch (e) { run.steps.t3 = { error: `${e.name}: ${e.message}` }; log(`T3 failed: ${e.message}`, 'bad'); }

  // T4 streaming through Sieve's adapter
  try {
    const adapter = new SieveDeviceAdapter({ mode: InferenceMode.ONLY_ON_DEVICE, base });
    const model = new GenerativeModel(ai, { model: 'gemini-3.5-flash-lite' }, undefined, adapter);
    const t0 = performance.now();
    const { stream, response } = await model.generateContentStream('Write three short sentences about a sieve.');
    let sdkChunks = 0, firstMs = null, soFar = '';
    for await (const chunk of stream) { sdkChunks += 1; if (firstMs === null) firstMs = since(t0); soFar += chunk.text(); }
    const final = await response;
    const st = adapter.calls.find((c) => c.kind === 'stream') ?? {};
    run.steps.t4 = { ok: true, totalMs: since(t0), firstChunkMs: firstMs, sdkChunks, deviceChunks: st.chunks, deviceCumulative: st.cumulative, inferenceSource: final.inferenceSource, textLength: final.text().length, assembledEqualsFinal: soFar === final.text() };
    log(`T4 streaming: first chunk ${firstMs} ms, ${sdkChunks} SDK chunks (${st.chunks} device chunks, cumulative=${st.cumulative}), total ${since(t0)} ms, inferenceSource=${final.inferenceSource}, assembled==final: ${soFar === final.text()}`, final.inferenceSource === 'on_device' ? 'good' : 'bad');
  } catch (e) {
    run.steps.t4 = { ok: false, error: `${e.name}: ${e.message}`, code: e instanceof AIError ? e.code : undefined };
    log(`T4 failed: ${e.name} ${e.code ?? ''} ${e.message}`, 'bad');
  }

  run.networkCallsToAiWholeRun = networkCallsToAi(resourceMark);
  log(`Network calls to AI hosts during this run: ${run.networkCallsToAiWholeRun.length}`, run.networkCallsToAiWholeRun.length === 0 ? 'good' : 'bad');
  if (base) base.destroy();
  return finish();
}

async function finish() {
  $('#run').disabled = false;
  try {
    const r = await fetch('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(results) });
    const j = await r.json();
    log(`Saved spikes/results/${j.saved}`, 'muted');
  } catch (e) { log(`Could not save results (server off, or Wi-Fi off and server on another host?): ${e.message}`, 'warn'); }
}

// S8: create() on load with no click
(async () => {
  if (!('LanguageModel' in self)) { log('This Chrome has no Prompt API (LanguageModel).', 'bad'); return; }
  const a = await LanguageModel.availability(TEXT_IO);
  log(`On load: availability=${a}, online=${navigator.onLine}`);
  if (a === 'available') {
    try { const t0 = performance.now(); const s = await LanguageModel.create(TEXT_IO); s.destroy(); results.s8 = { ok: true, ms: since(t0) }; log(`S8 create() with no click: ok in ${since(t0)} ms`, 'good'); }
    catch (e) { results.s8 = { ok: false, error: `${e.name}: ${e.message}` }; log(`S8 create() with no click: ${e.name}: ${e.message}`, 'warn'); }
  }
})();

$('#run').addEventListener('click', () => run($('#label').value || 'online'));
$('#saveConfig').addEventListener('click', () => {
  try { JSON.parse($('#config').value); localStorage.setItem('sieve-spike-firebase-config', $('#config').value); log('Firebase config saved in this browser (localStorage). Reload to use it.', 'muted'); }
  catch { log('That is not valid JSON.', 'bad'); }
});

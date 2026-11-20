// Dev-only page for /dev/privacy (11 section 13.6): runs the whole corpus on this device with the real browser model
// and Gemini Nano, and reports precision, recall and latency per stage. Mount it only when import.meta.env.DEV.
// The report is copied as text (no blob: link, 70 R-UI-09). The Playground seed scan comes from /dev/seed (20 22.4).
import type { PiiSpan, PiiStage } from '@sieve/shared';
import { useEffect, useState } from 'react';
import hiddenCases from '../__corpus__/hidden-html.json';
import injectionCases from '../__corpus__/injection-cases.json';
import piiCases from '../__corpus__/pii-cases.json';
import { checkInjection } from '../injection/check';
import { getPrivacyModelStatus, onPrivacyModelStatus, warmupPrivacyModel } from '../model/client';
import { detectPii } from '../pii/detect';
import { sanitizeIncoming } from '../sanitize/sanitize';
import type { PrivacyModelStatus } from '../types';
import { formatScores, percentile, scoreInjection, scoreSpans, type GoldSpan, type TypeScore } from './measure';

interface HiddenCase { id: string; html: string; expectVisible: string[]; expectHidden: string[] }
interface PiiCase { id: string; text: string; expect: GoldSpan[] }
interface InjectionCase { id: string; group: number; text: string; html?: string; attack: boolean; extraFromHidden?: boolean }

interface Report {
  at: string;
  userAgent: string;
  model: PrivacyModelStatus;
  hidden: { passed: number; total: number; failures: string[]; newsletterMs: number; trackingRequests: number };
  pii: { stages: string; scores: TypeScore[]; p50: number; p95: number }[];
  injection: { mode: string; attacks: number; caught: number; benign: number; falseAlarms: number; quotesVerbatim: number; quotes: number; p50: number; p95: number }[];
}

const STAGE_SETS: PiiStage[][] = [['validators'], ['validators', 'model'], ['validators', 'model', 'nano']];

async function runHidden(): Promise<Report['hidden']> {
  const failures: string[] = [];
  let passed = 0;
  const before = performance.getEntriesByType('resource').length;
  for (const c of hiddenCases as HiddenCase[]) {
    const out = sanitizeIncoming({ html: c.html });
    const ok = c.expectVisible.every((v) => out.text.includes(v)) &&
      c.expectHidden.every((h) => !out.text.includes(h) && out.hiddenRemoved.some((f) => f.includes(h)));
    if (ok) passed++;
    else failures.push(c.id);
  }
  await new Promise((r) => setTimeout(r, 500));
  const trackingRequests = performance.getEntriesByType('resource').slice(before).filter((e) => e.name.includes('127.0.0.1:9')).length;
  let html = '<style>.a{color:#333}@media (max-width:600px){.m{display:none}}</style>';
  const block = '<table><tr><td style="font-size:14px"><h2>Story</h2><p>Paragraph with a <a href="https://n.example/a">link</a>.</p></td></tr></table><div style="display:none">pre</div>';
  while (html.length < 2_000_000) html += block;
  const t0 = performance.now();
  sanitizeIncoming({ html });
  return { passed, total: hiddenCases.length, failures, newsletterMs: Math.round(performance.now() - t0), trackingRequests };
}

async function runPii(): Promise<Report['pii']> {
  const out: Report['pii'] = [];
  for (const stages of STAGE_SETS) {
    const times: number[] = [];
    const cases: { text: string; gold: GoldSpan[]; predicted: PiiSpan[] }[] = [];
    for (const c of (piiCases as { persona: PiiCase[] }).persona) {
      const t0 = performance.now();
      const { spans } = await detectPii(c.text, 'own', { stages });
      times.push(performance.now() - t0);
      cases.push({ text: c.text, gold: c.expect, predicted: spans });
    }
    out.push({ stages: stages.join(' + '), scores: scoreSpans(cases), p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)) });
  }
  return out;
}

async function runInjection(): Promise<Report['injection']> {
  const out: Report['injection'] = [];
  for (const model of [false, true]) {
    const times: number[] = [];
    const results: { attack: boolean; suspicious: boolean; quote?: string; input: string }[] = [];
    for (const c of injectionCases as InjectionCase[]) {
      const s = c.html ? sanitizeIncoming({ html: c.html }) : { text: c.text, hiddenRemoved: [] };
      const extra = c.extraFromHidden ? s.hiddenRemoved : [];
      const t0 = performance.now();
      const { finding } = await checkInjection(s.text, 'own', { model, extraText: extra });
      times.push(performance.now() - t0);
      results.push({ attack: c.attack, suspicious: finding.suspicious, quote: finding.quote, input: [s.text, ...extra].join('\n\n') });
    }
    out.push({ mode: model ? 'plain code + Gemini Nano' : 'plain code', ...scoreInjection(results), p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)) });
  }
  return out;
}

function toText(r: Report): string {
  const lines = [
    `Privacy bench, ${r.at}`,
    `Model: ${r.model.state}${r.model.device ? ` (${r.model.device})` : ''}${r.model.loadMs ? `, loaded in ${r.model.loadMs} ms` : ''}`,
    `Hidden text: ${r.hidden.passed}/${r.hidden.total} cases pass${r.hidden.failures.length ? ` (failing: ${r.hidden.failures.join(', ')})` : ''}; 2 MB newsletter ${r.hidden.newsletterMs} ms; requests to the tracking pixel: ${r.hidden.trackingRequests}`,
    ...r.pii.map((p) => formatScores(`PII, ${p.stages} (p50 ${p.p50} ms, p95 ${p.p95} ms per email):`, p.scores)),
    ...r.injection.map((i) => `Injection, ${i.mode}: attacks caught ${i.caught}/${i.attacks}, false alarms ${i.falseAlarms}/${i.benign}, quotes verbatim ${i.quotesVerbatim}/${i.quotes}, p50 ${i.p50} ms, p95 ${i.p95} ms`),
  ];
  return `${lines.join('\n')}\n\n${JSON.stringify(r, null, 2)}`;
}

export function PrivacyBench() {
  const [model, setModel] = useState<PrivacyModelStatus>(getPrivacyModelStatus());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => onPrivacyModelStatus(setModel), []);

  const run = async () => {
    setRunning(true);
    setCopied(false);
    try {
      const status = await warmupPrivacyModel();
      const r: Report = {
        at: new Date().toISOString(), userAgent: navigator.userAgent, model: status,
        hidden: await runHidden(), pii: await runPii(), injection: await runInjection(),
      };
      setReport(toText(r));
    } catch (e) {
      setReport(`The bench stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 960, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>Privacy bench</h1>
      <p>Runs the privacy corpus on this device with the real privacy model and Gemini Nano. Nothing leaves this computer.</p>
      <p>
        Privacy model: {model.state}
        {model.device ? ` on ${model.device}` : ''}
        {model.progress !== undefined && model.state === 'loading' ? `, ${Math.round(model.progress * 100)}%` : ''}
        {model.error ? ` (${model.error})` : ''}
      </p>
      <p style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void warmupPrivacyModel()} disabled={running}>Load the privacy model</button>
        <button type="button" onClick={() => void run()} disabled={running}>{running ? 'Running…' : 'Run the corpus'}</button>
        <button type="button" onClick={() => void copy()} disabled={!report}>{copied ? 'Copied' : 'Copy report'}</button>
      </p>
      <textarea readOnly value={report} aria-label="Bench report" style={{ width: '100%', minHeight: 480, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
    </main>
  );
}

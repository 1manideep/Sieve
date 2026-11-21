// The sensitive-topic detector (11 section 11.5, Nov 21): plain code that says when an item or an answer touches a
// topic a person would want to decide on themselves. A hit never blocks anything: the proposal carries the
// "sensitive topic" warning, so the person decides (auto-approve never runs on a proposal with a warning).
import type { IndexRecord } from '@sieve/shared';

export type SensitiveTopic = 'screening' | 'legal' | 'medical' | 'hr' | 'immigration';

/** Case-insensitive patterns, chosen to miss the common look-alikes (a Visa card, a food court, a tennis court). */
const TOPICS: readonly [SensitiveTopic, RegExp][] = [
  ['screening', /\b(?:checkr|hireright|goodhire|first advantage|background (?:check|screening|report|investigation)s?|drug (?:test|screen|screening)s?|pre-?employment screening|criminal (?:record|history|background) check)\b/i],
  ['legal', /\b(?:lawsuits?|subpoena(?:s|ed)?|attorneys?|litigation|summons|deposition|cease and desist|court (?:date|hearing|order|case|summons|appearance|filing)s?|(?:small claims|family|district|superior|county|federal|traffic|bankruptcy|divorce) court|legal (?:notice|action|proceedings))\b/i],
  ['medical', /\b(?:diagnos(?:is|es|ed)|prescri(?:ption|ptions|bed)|therap(?:y|ies|ist|ists)|psychiatri(?:st|sts|c)|mental health|biopsy|chemotherapy|lab results|test results)\b/i],
  ['hr', /\b(?:performance improvement plan|disciplinary (?:action|hearing|meeting)|hr investigation|workplace investigation|(?:an|the) investigation into|termination (?:of (?:your )?employment|meeting)|employment termination|terminated your employment|severance|written warning|misconduct|grievance)\b/i],
  ['immigration', /\b(?:uscis|i-?94|i-?20|i-?797|i-?485|i-?765|h-?1b|green card|immigration|work permit|(?:work|student|tourist|visitor|immigrant|h-?1b|f-?1|j-?1|l-?1|o-?1) visa|visa (?:status|application|appointment|interview|stamp|stamping|petition|sponsorship|approval|denial|renewal|expir\w*))\b/i],
];
/** "PIP" only in capitals (a performance improvement plan, not a "pip" of fruit). */
const PIP = /\bPIP\b/;

/** The first sensitive topic the text touches, or null. */
export function sensitiveTopicOf(text: string): SensitiveTopic | null {
  if (!text) return null;
  for (const [topic, re] of TOPICS) if (re.test(text)) return topic;
  if (PIP.test(text)) return 'hr';
  return null;
}

/** True when the text touches a sensitive topic: screening, legal, medical details, HR matters or immigration status. */
export function touchesSensitiveTopic(text: string): boolean {
  return sensitiveTopicOf(text) !== null;
}

/** An item touches one when its sender, subject or text does (the first 20,000 characters are read). */
export function itemTouchesSensitiveTopic(record: Pick<IndexRecord, 'title' | 'from' | 'text' | 'preview' | 'caption'>): boolean {
  const body = (record.text ?? record.preview ?? record.caption ?? '').slice(0, 20_000);
  return touchesSensitiveTopic(`${record.from ?? ''}\n${record.title}\n${body}`);
}

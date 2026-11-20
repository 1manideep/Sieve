// splitDraftRequest (10 section 12.10): separates a drafting request from the lookup, so "draft a reply" does not
// steer retrieval. Plain code; it changes nothing that is sent.

const DRAFT_RE =
  /(^|[.?!]\s+|,\s*|\s+)(?:(?:and|then)\s+)?((?:please\s+)?(?:draft|write|compose|prepare)\s+(?:(?:a|an|the|my)\s+)?(?:(?:short|quick|polite|brief|friendly)\s+)*(reply|response|email|message|note)\b[\s\S]*)$/di;

const FILLER = new Set(['can', 'you', 'could', 'would', 'please', 'me', 'i', 'and', 'then']);

/** 70 R-IN-18: a lookup that asks Sieve to act. Sieve still searches, and warns that it cannot act. */
export const ACTION_RE = /^\s*(?:please\s+)?(send|forward|delete|remove|archive|move|pay|transfer|book|cancel|unsubscribe|reply to|share)\b/i;

export function splitDraftRequest(question: string): { lookup: string; instruction: string | null } {
  const q = question;
  const m = DRAFT_RE.exec(q);
  if (!m || m.indices === undefined) return { lookup: q, instruction: null };
  const group1 = m[1] ?? '';
  const group2 = (m[2] ?? '').trim();
  const instruction = group2.charAt(0).toUpperCase() + group2.slice(1);
  let lookup = (q.slice(0, m.index) + group1.replace(/[\s,]/g, '')).trim();
  const words = lookup.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.filter((w) => !FILLER.has(w)).length < 2) {
    const nounEnd = m.indices[3]?.[1] ?? q.length;
    const after = q
      .slice(nounEnd)
      .trim()
      .replace(/^(?:to|for|about)\s+/i, '')
      .replace(/[.!]+$/, '')
      .trim();
    lookup = after || q;
  }
  return { lookup, instruction };
}

/** The action verb a lookup asks for, or null. */
export function actionVerb(lookup: string): string | null {
  const m = ACTION_RE.exec(lookup);
  return m ? m[1].toLowerCase() : null;
}

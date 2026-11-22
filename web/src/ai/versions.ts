// Prompt versions (10 section 4.4). Bump a number whenever its system prompt, user template or schema changes:
// the background queue re-runs a task for every record whose stored version is lower.
export const PROMPT_VERSIONS = { label: 1, caption: 1, select: 3, verify: 3, draft: 1 } as const;

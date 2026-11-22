import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CHUNK_WORDS,
  DEFAULT_CATEGORY_RULES,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  GRANT_DEFAULT_DAYS,
  HOME_BASE_PORT_NAME,
  KEYWORD_SAFETY_K,
  LADDER_STEPS,
  MAX_PAYLOAD_CHARS,
  MAX_QUESTION_CHARS,
  MCP_TOOLS,
  MESSAGE_VERSION,
  NANO_PROMPT_BUDGET,
  NANO_TOKEN_LIMIT,
  PLAYGROUND_DB_NAME,
  PREVIEW_CHARS,
  REAL_DB_NAME,
  RELATED_MAX,
  RELAY_COLLECT_MINUTES,
  RELAY_DECISION_MINUTES,
  RELAY_WAIT_SECONDS,
  REQUEST_TTL_HOURS,
  VECTOR_K,
  SHARED_FILE_LINK_SECONDS,
  SHARED_FILE_MAX_BYTES,
  SHARED_FILE_NAME_MAX_CHARS,
  SHARED_FILE_PATH_RE,
  SHARED_FILE_TYPES,
  sharedFileTypeAllowed,
} from './constants';
import type { CategoryRule } from './types';

describe('contract constants', () => {
  it('keeps the fixed category set in order', () => {
    expect(CATEGORIES).toEqual(['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos']);
  });

  it('orders the ladder from least to most disclosure', () => {
    expect(LADDER_STEPS).toEqual(['answer', 'excerpt', 'full']);
  });

  it('has a default rule for exactly the categories in CATEGORIES', () => {
    expect(Object.keys(DEFAULT_CATEGORY_RULES).sort()).toEqual([...CATEGORIES].sort());
  });

  it('uses only valid rules, with Health never and Money ask-first', () => {
    const valid: CategoryRule[] = ['approve', 'ask-first', 'never'];
    for (const rule of Object.values(DEFAULT_CATEGORY_RULES)) expect(valid).toContain(rule);
    expect(DEFAULT_CATEGORY_RULES.Health).toBe('never');
    expect(DEFAULT_CATEGORY_RULES.Money).toBe('ask-first');
    const others = CATEGORIES.filter((c) => c !== 'Health' && c !== 'Money');
    for (const c of others) expect(DEFAULT_CATEGORY_RULES[c]).toBe('approve');
  });

  it('names the MCP tools as the functions serve them', () => {
    expect(MCP_TOOLS).toEqual({
      answer: 'sieve_answer',
      excerpt: 'sieve_excerpt',
      full: 'sieve_full_item',
      check: 'sieve_check',
    });
  });

  it('keeps one ladder tool per step', () => {
    for (const step of LADDER_STEPS) expect(MCP_TOOLS[step]).toMatch(/^sieve_/);
  });

  it('locks the numbers other packages and the Python mirror depend on', () => {
    expect({
      RELAY_WAIT_SECONDS,
      REQUEST_TTL_HOURS,
      MAX_QUESTION_CHARS,
      MAX_PAYLOAD_CHARS,
      RELATED_MAX,
      PREVIEW_CHARS,
      NANO_TOKEN_LIMIT,
      NANO_PROMPT_BUDGET,
      EMBEDDING_DIMS,
      CHUNK_WORDS,
      VECTOR_K,
      KEYWORD_SAFETY_K,
      GRANT_DEFAULT_DAYS,
      RELAY_DECISION_MINUTES,
      RELAY_COLLECT_MINUTES,
      MESSAGE_VERSION,
    }).toEqual({
      RELAY_WAIT_SECONDS: 45,
      REQUEST_TTL_HOURS: 24,
      MAX_QUESTION_CHARS: 500,
      MAX_PAYLOAD_CHARS: 8000,
      RELATED_MAX: 3,
      PREVIEW_CHARS: 280,
      NANO_TOKEN_LIMIT: 9216,
      NANO_PROMPT_BUDGET: 7000,
      EMBEDDING_DIMS: 384,
      CHUNK_WORDS: 160,
      VECTOR_K: 5,
      KEYWORD_SAFETY_K: 2,
      GRANT_DEFAULT_DAYS: 30,
      RELAY_DECISION_MINUTES: 120,
      RELAY_COLLECT_MINUTES: 60,
      MESSAGE_VERSION: 1,
    });
  });

  it('lists what may be sent as a file, as the Python mirror does', () => {
    expect(SHARED_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(SHARED_FILE_LINK_SECONDS).toBe(600);
    expect(SHARED_FILE_NAME_MAX_CHARS).toBe(120);
    expect(Object.keys(SHARED_FILE_TYPES)).toHaveLength(16);
    expect(sharedFileTypeAllowed('application/pdf', 'Lease.PDF')).toBe(true);
    expect(sharedFileTypeAllowed('image/jpeg', 'Lease.pdf')).toBe(false);
    for (const [mime, name] of [['text/html', 'page.html'], ['image/svg+xml', 'logo.svg'], ['application/zip', 'all.zip'], ['', 'x.pdf']] as const) {
      expect(sharedFileTypeAllowed(mime, name), mime).toBe(false);
    }
    expect(SHARED_FILE_PATH_RE.test(`handoffs/${'u'.repeat(28)}/${'r'.repeat(20)}/${'o'.repeat(24)}`)).toBe(true);
    expect(SHARED_FILE_PATH_RE.test(`handoffs/${'u'.repeat(28)}/${'r'.repeat(20)}/../x`)).toBe(false);
    expect(SHARED_FILE_PATH_RE.test(`users/${'u'.repeat(28)}/${'r'.repeat(20)}/${'o'.repeat(24)}`)).toBe(false);
  });

  it('keeps the names of databases, ports and models', () => {
    expect(REAL_DB_NAME).toBe('sieve');
    expect(PLAYGROUND_DB_NAME).toBe('sieve-playground');
    expect(HOME_BASE_PORT_NAME).toBe('sieve-home-base');
    expect(EMBEDDING_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('keeps the prompt budget inside the on-device token limit', () => {
    expect(NANO_PROMPT_BUDGET).toBeLessThan(NANO_TOKEN_LIMIT);
  });
});

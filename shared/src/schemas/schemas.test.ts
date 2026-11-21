import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { LADDER_STEPS, MAX_QUESTION_CHARS } from '../constants';
import type { CheckToolInput, LadderToolInput, QueryHints, ToolResult } from '../types';
import { MCP_CHECK_INPUT_SCHEMA, MCP_LADDER_INPUT_SCHEMA, MCP_TOOL_RESULT_SCHEMA } from './index';

const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false });
const validateResult = ajv.compile(MCP_TOOL_RESULT_SCHEMA);
const validateLadder = ajv.compile(MCP_LADDER_INPUT_SCHEMA);
const validateCheck = ajv.compile(MCP_CHECK_INPUT_SCHEMA);

// Every ToolResult status, checked against the type in both directions.
const TOOL_STATUSES = [
  'answered', 'pending', 'declined', 'blocked', 'no-match', 'unsupported', 'offline', 'expired', 'unknown', 'not-allowed', 'error',
] as const satisfies readonly ToolResult['status'][];
type MissingStatus = Exclude<ToolResult['status'], (typeof TOOL_STATUSES)[number]>;
const noMissingStatus: [MissingStatus] extends [never] ? true : false = true;

// The ladder input's optional fields are exactly the hint fields the request doc stores (01 section 7).
type HintField = Exclude<keyof LadderToolInput, 'question' | 'idempotency_key'>;
const HINT_FIELDS = ['after', 'before', 'source', 'categories', 'from', 'terms'] as const satisfies readonly HintField[];
const hintFieldsAreQueryHints: HintField extends keyof QueryHints ? true : false = true;

describe('MCP tool result schema', () => {
  it('accepts an answered result and a pending result', () => {
    const answered: ToolResult = {
      status: 'answered',
      request_id: 'AbCdEfGhIjKlMnOpQrSt',
      step: 'answer',
      text: 'Your deposit was $1,200, paid on March 3.',
      message: 'The person approved sharing this answer.',
    };
    const pending: ToolResult = { status: 'pending', request_id: 'AbCdEfGhIjKlMnOpQrSt', message: 'The person has not approved this yet.' };
    expect(validateResult(answered), JSON.stringify(validateResult.errors)).toBe(true);
    expect(validateResult(pending), JSON.stringify(validateResult.errors)).toBe(true);
  });

  it('rejects a result without a message, with an unknown status, or with extra fields', () => {
    expect(validateResult({ status: 'answered' })).toBe(false);
    expect(validateResult({ status: 'maybe', message: 'x' })).toBe(false);
    expect(validateResult({ status: 'error', message: 'x', recordId: 'gmail:1' })).toBe(false);
  });

  it('lists exactly the ToolResult statuses and the ladder steps', () => {
    expect(noMissingStatus).toBe(true);
    expect(MCP_TOOL_RESULT_SCHEMA.properties.status.enum).toEqual([...TOOL_STATUSES]);
    expect(MCP_TOOL_RESULT_SCHEMA.properties.step.enum).toEqual([...LADDER_STEPS]);
    expect(MCP_TOOL_RESULT_SCHEMA.required).toEqual(['status', 'message']);
  });
});

describe('MCP ladder tool input schema', () => {
  it('accepts a question with every hint', () => {
    const input: LadderToolInput = {
      question: 'What did my landlord say about the deposit?',
      after: '2026-01-01',
      before: '2026-03-31',
      source: 'mail',
      from: 'my landlord',
      terms: ['DEP-1200'],
    };
    expect(validateLadder(input), JSON.stringify(validateLadder.errors)).toBe(true);
    expect(validateLadder({ question: 'Where is my flight booking?' })).toBe(true);
  });

  it('rejects missing, empty or too long questions, bad dates, unknown sources and extra fields', () => {
    expect(validateLadder({})).toBe(false);
    expect(validateLadder({ question: '' })).toBe(false);
    expect(validateLadder({ question: 'x'.repeat(MAX_QUESTION_CHARS + 1) })).toBe(false);
    expect(validateLadder({ question: 'x', after: '1 March 2026' })).toBe(false);
    expect(validateLadder({ question: 'x', source: 'drive' })).toBe(false);
    expect(validateLadder({ question: 'x', terms: ['1', '2', '3', '4', '5', '6'] })).toBe(false);
    expect(validateLadder({ question: 'x', action: 'send' })).toBe(false);
  });

  it('allows questions up to MAX_QUESTION_CHARS, the hint fields and the retry key', () => {
    expect(validateLadder({ question: 'x'.repeat(MAX_QUESTION_CHARS) })).toBe(true);
    expect(hintFieldsAreQueryHints).toBe(true);
    expect(Object.keys(MCP_LADDER_INPUT_SCHEMA.properties)).toEqual(['question', ...HINT_FIELDS, 'idempotency_key']);
    // 30 section 9.4: 1 to 64 characters
    expect(validateLadder({ question: 'x', idempotency_key: 'ask-1' })).toBe(true);
    expect(validateLadder({ question: 'x', idempotency_key: '' })).toBe(false);
    expect(validateLadder({ question: 'x', idempotency_key: 'k'.repeat(65) })).toBe(false);
  });
});

describe('MCP sieve_check input schema', () => {
  it('accepts a 20-character request id', () => {
    const input: CheckToolInput = { request_id: 'AbCdEfGhIjKlMnOpQrSt' };
    expect(validateCheck(input), JSON.stringify(validateCheck.errors)).toBe(true);
  });

  it('rejects a malformed or missing request id', () => {
    expect(validateCheck({ request_id: 'short' })).toBe(false);
    expect(validateCheck({ request_id: 'AbCdEfGhIjKlMnOpQr-t' })).toBe(false);
    expect(validateCheck({})).toBe(false);
  });
});

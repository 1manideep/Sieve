// Callable functions (01 section 11.5, 30 sections 7 and 13): the names are 30's. Inputs and outputs as 30 wrote them.
// The connector link from issueGrant is returned to the caller only; it is never logged, stored or put in an error.
import { httpsCallable } from 'firebase/functions';
import type { Category, LadderStep, SourceKind } from '@sieve/shared';
import { CALLABLE_ERRORS } from '@/copy/strings';
import type { IssueGrantInput, IssueGrantResult, NarrowGrantPatch } from '@/state/grants';
import { functionsInstance } from './functions';

export const CALLABLE_NAMES = ['issueGrant', 'narrowGrant', 'revokeGrant', 'getAuditStatus', 'deleteAccount', 'issuePlaygroundGrant'] as const;
export type CallableName = (typeof CALLABLE_NAMES)[number];

export interface NarrowGrantResult {
  grantId: string; maxStep: LadderStep; allowedCategories: Category[]; allowedSources: SourceKind[];
  expiresAt: number; requestsRevoked: number; requestsUpdated: number;
}
export interface RevokeGrantResult { grantId: string; revokedAt: number; requestsRevoked: number }
export interface AuditStatusResult {
  intact: boolean; entries: number; lastSeq: number; lastHash: string;
  brokenAtSeq: number | null; truncated: boolean; checkedAt: number;
}
export interface DeleteAccountResult { deleted: true }
/** issuePlaygroundGrant (00 D1, 30 section 16): anonymous users allowed; one day; sources ['playground']. */
export interface PlaygroundGrantInput { aiName?: string; maxStep?: LadderStep; allowedCategories?: Category[] }

/** A callable failure with the person-facing message already chosen (40 section 10.5). */
export class CallableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CallableError';
  }
}

/** 'functions/permission-denied' and 'permission-denied' both become 'permission-denied'. */
export function callableCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : 'unknown';
}

/** 40 section 10.5 error copy. Server messages for 30's own one-sentence errors are shown as they are. */
export function callableMessage(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): string {
  const code = callableCode(error);
  const serverMessage = (error as { message?: unknown } | null)?.message;
  const server = typeof serverMessage === 'string' && serverMessage.trim() && !/^(internal|INTERNAL)$/.test(serverMessage.trim())
    ? serverMessage.trim()
    : '';
  if (code === 'unavailable' || code === 'deadline-exceeded' || (code === 'internal' && !online)) return CALLABLE_ERRORS.unreachable;
  if (code === 'permission-denied' || code === 'unauthenticated') return CALLABLE_ERRORS.notAllowed;
  if (code === 'failed-precondition') return server || CALLABLE_ERRORS.precondition;
  // 30 writes these as one sentence for the person (narrowing rules, the 10-AI limit, a missing connection).
  if ((code === 'invalid-argument' || code === 'resource-exhausted' || code === 'not-found') && server) return server;
  return CALLABLE_ERRORS.other;
}

async function call<I, O>(name: CallableName, input: I): Promise<O> {
  try {
    const fn = httpsCallable<I, O>(functionsInstance(), name);
    const result = await fn(input);
    return result.data;
  } catch (error) {
    throw new CallableError(callableCode(error), callableMessage(error));
  }
}

export function issueGrant(input: IssueGrantInput): Promise<IssueGrantResult> {
  return call<IssueGrantInput, IssueGrantResult>('issueGrant', input);
}

export function narrowGrant(grantId: string, patch: NarrowGrantPatch): Promise<NarrowGrantResult> {
  return call<{ grantId: string } & NarrowGrantPatch, NarrowGrantResult>('narrowGrant', { grantId, ...patch });
}

/** Accepts anonymous users too, so the Playground can turn off its own grant. */
export function revokeGrant(grantId: string): Promise<RevokeGrantResult> {
  return call<{ grantId: string }, RevokeGrantResult>('revokeGrant', { grantId });
}

export function getAuditStatus(): Promise<AuditStatusResult> {
  return call<Record<string, never>, AuditStatusResult>('getAuditStatus', {});
}

/** A one-day Playground grant (anonymous allowed). Its link is returned only here, like issueGrant's. */
export function issuePlaygroundGrant(input: PlaygroundGrantInput = {}): Promise<IssueGrantResult> {
  return call<PlaygroundGrantInput, IssueGrantResult>('issuePlaygroundGrant', input);
}

/** Revokes every connector link, then deletes the auth user (30 section 13.2). Needs a sign-in within 5 minutes. */
export function deleteAccountCallable(): Promise<DeleteAccountResult> {
  return call<Record<string, never>, DeleteAccountResult>('deleteAccount', {});
}

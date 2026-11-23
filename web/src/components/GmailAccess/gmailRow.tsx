// The Gmail row as the home base's notices read it (20 section 15.1, Nov 23): whether access is about to end, has
// ended, or was refused, and the one button that reconnects from the click. The token itself is never read here,
// only when it ends; it stays a short-lived token in this browser.
import { useLiveQuery } from 'dexie-react-hooks';
import { GMAIL_ACCESS } from '@/copy/screens-controls';
import { GMAIL_TOKEN_SKEW_MS } from '@/index/config';
import { useSources } from '@/state/sources';
import { Button } from '../Button/Button';
import { tablesOf, useDb } from '../dbTables';

/** The fields of the Gmail row these notices need. */
export interface GmailRowView {
  connected?: boolean;
  paused?: boolean;
  needsAuth?: boolean;
  errorCode?: string;
  error?: string;
  accessToken?: { expiresAt?: number };
  /** When the last token ran out by time, once a tab took it off the row (tokenStore.ts). */
  tokenEndedAt?: number;
}

/** The notice shows from this long before access ends (renew.ts asks Google from the same moment). */
export const GMAIL_ENDING_MS = 10 * 60_000;

export type GmailAccessState =
  | { kind: 'ok' }
  | { kind: 'ending'; minutes: number }
  | { kind: 'ended' }
  | { kind: 'refused' };

/**
 * From the row and the time: 'ending' in the last 10 minutes of a token nobody has renewed, 'ended' once it ran out
 * (by time, before the next sync marks the row, or marked), 'refused' when Google refused read-only access.
 */
export function gmailAccessState(row: GmailRowView | undefined, now: number): GmailAccessState {
  if (!row?.connected || row.paused) return { kind: 'ok' };
  if (row.needsAuth) return row.errorCode === 'auth-needed' ? { kind: 'refused' } : { kind: 'ended' };
  const ends = row.accessToken?.expiresAt;
  if (typeof ends !== 'number') return typeof row.tokenEndedAt === 'number' ? { kind: 'ended' } : { kind: 'ok' };
  const left = ends - GMAIL_TOKEN_SKEW_MS - now;
  if (left <= 0) return { kind: 'ended' };
  if (left <= GMAIL_ENDING_MS) return { kind: 'ending', minutes: Math.max(1, Math.ceil(left / 60_000)) };
  return { kind: 'ok' };
}

/** Access ran out or was refused: only a reconnect brings it back. */
export function needsReconnect(row: GmailRowView | undefined, now: number): boolean {
  const kind = gmailAccessState(row, now).kind;
  return kind === 'ended' || kind === 'refused';
}

/** The real index's Gmail row, live; undefined while unknown or without one. */
export function useGmailRow(): GmailRowView | undefined {
  const db = useDb('real');
  const row = useLiveQuery(async () => {
    try {
      return db ? (((await tablesOf(db).sources.get('gmail')) as GmailRowView | undefined) ?? null) : null;
    } catch {
      return null;   // the index cannot be read here: no notice
    }
  }, [db]);
  return row ?? undefined;
}

/** Asks Google for a new token straight from the click (the window needs the gesture), as the Gmail card does. */
export function ReconnectGmail({ label = GMAIL_ACCESS.reconnect }: { label?: string }) {
  const busy = useSources((s) => s.busy.gmail === true);
  return (
    <Button
      variant="secondary"
      size="sm"
      busy={busy}
      onClick={() => {
        useSources.getState().reauthorize('gmail').catch(console.error);
      }}
    >
      {label}
    </Button>
  );
}

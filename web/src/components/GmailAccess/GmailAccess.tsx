// Gmail access running out, on every page of the home base (20 section 15.1, 40 section 7.4; Nov 23, 2026). Google
// gives this browser a token for an hour; Sieve renews it inside the person's clicks, and on the sync timer where
// pop-ups are allowed. In the last 10 minutes of a token nobody renewed, a quiet notice offers "Keep Gmail
// connected", which renews inside that click; once it has run out, a warning with "Reconnect Gmail". Both explain
// pop-ups once, in one line, and say when Chrome blocked the renewal window. The extension is told too (the engine
// sends gmail: 'ended'), so its panel can bring this tab forward. MainLayout loads this lazily.
import { useEffect, useState } from 'react';
import { useNow } from '@/app/useNow';
import { GMAIL_ACCESS, fillText } from '@/copy/screens-controls';
import { onRenewBlocked, renewBlockedByChrome } from '@/sources/gmail/renew';
import { useHomeBase } from '@/state/homeBase';
import { preloadSources } from '@/state/sources';
import { Notice } from '../Notice/Notice';
import bar from '../TabClosedBanner/TabClosedBanner.module.css';
import { ReconnectGmail, gmailAccessState, useGmailRow } from './gmailRow';

/** Errors of the person's last click on the button (the window was closed, or blocked). */
const CLICK_ERRORS = new Set(['popup-blocked', 'popup-closed', 'gis-load-failed']);

function useRenewBlocked(): boolean {
  const [blocked, setBlocked] = useState(renewBlockedByChrome);
  useEffect(() => onRenewBlocked(() => setBlocked(true)), []);
  return blocked;
}

export function GmailAccess() {
  const row = useGmailRow();
  const now = useNow(15_000);
  const timerBlocked = useRenewBlocked();
  const state = gmailAccessState(row, now);
  const ended = state.kind === 'ended' || state.kind === 'refused';

  useEffect(() => {
    useHomeBase.getState().setGmailEnded(ended);
  }, [ended]);
  useEffect(() => () => useHomeBase.getState().setGmailEnded(false), []);
  // The sources code loads before the click, so the button reaches Google inside the person's gesture.
  useEffect(() => {
    if (state.kind !== 'ok') preloadSources().catch(() => undefined);
  }, [state.kind]);

  if (state.kind === 'ok') return null;
  const lastClick = row?.errorCode && CLICK_ERRORS.has(row.errorCode) ? row.error : undefined;
  const blocked = timerBlocked || row?.errorCode === 'popup-blocked';
  const text =
    state.kind === 'ending' ? fillText(GMAIL_ACCESS.ending, { n: state.minutes }) : state.kind === 'refused' ? GMAIL_ACCESS.refused : GMAIL_ACCESS.ended;
  return (
    <div className={bar.inner} data-testid="gmail-access" data-state={state.kind}>
      <div className={bar.text}>
        <Notice
          tone={state.kind === 'ending' ? 'info' : 'warning'}
          compact={state.kind === 'ending'}
          actions={<ReconnectGmail label={state.kind === 'ending' ? GMAIL_ACCESS.keep : GMAIL_ACCESS.reconnect} />}
        >
          <p>{text}</p>
          {lastClick ? <p>{lastClick}</p> : null}
          {state.kind === 'refused' ? null : <p>{blocked ? `${GMAIL_ACCESS.popupsBlocked} ${GMAIL_ACCESS.popups}` : GMAIL_ACCESS.popups}</p>}
        </Notice>
      </div>
    </div>
  );
}

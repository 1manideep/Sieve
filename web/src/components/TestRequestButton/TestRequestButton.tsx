// "Send a test request to the extension" (50 sections 11 and 13.3, 60 section 7.2): in Settings next to the extension
// status (13.8.7) and in the Playground's extension strip, so judges can try the side panel without an MCP client.
// Enabled only while the extension is connected. The page logic, which writes nothing to Firestore and makes no
// receipt, is relay/testRequest.ts.
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { TEST_REQUEST, fillText } from '@/copy/screens-controls';
import { testRequests, type TestRequestState, type TestRequests } from '@/relay/testRequest';
import { announce } from '@/state/announcer';
import type { ExtensionStatus } from '@/state/homeBase';
import { Button } from '../Button/Button';
import styles from './TestRequestButton.module.css';

export function testRequestLine(state: TestRequestState): string | null {
  switch (state.kind) {
    case 'sent':
      return TEST_REQUEST.sent;
    case 'answered':
      return fillText(TEST_REQUEST.answered, { answer: state.approved ? TEST_REQUEST.approved : TEST_REQUEST.declined });
    case 'expired':
      return TEST_REQUEST.expired;
    case 'unavailable':
      return TEST_REQUEST.unavailable;
    default:
      return null;
  }
}

export interface TestRequestButtonProps {
  status: ExtensionStatus;
  requests?: TestRequests;
}

export function TestRequestButton({ status, requests = testRequests }: TestRequestButtonProps) {
  const state = useSyncExternalStore(requests.subscribe, requests.getState, requests.getState);
  const noteId = useId();
  const line = testRequestLine(state);
  const seen = useRef(state);

  // Announce each change while the screen is open, not the line that was already there when it opened.
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (line) announce(line);
  }, [state, line]);

  return (
    <div className={styles.group}>
      <div className={styles.inline}>
        <Button
          variant="secondary"
          size="sm"
          disabled={status !== 'connected'}
          aria-describedby={noteId}
          onClick={() => {
            requests.send();
          }}
        >
          {TEST_REQUEST.button}
        </Button>
      </div>
      <p id={noteId} className={styles.note}>
        {TEST_REQUEST.note}
      </p>
      {line ? <p className={state.kind === 'unavailable' ? styles.warnText : styles.text}>{line}</p> : null}
    </div>
  );
}

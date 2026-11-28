// The Playground's extension strip (50 section 11, 60 section 7.2): the extension's state, the download and the
// steps to load it unpacked (components/ExtensionInstall; the Playground has no sign-in, so they are here, not in
// Settings), and "Send a test request to the extension", so judges and Web Store reviewers can try the side panel
// without an MCP client. The port is the Playground tab's own (relay/playgroundBridge.ts); the strip is hidden while
// the extension is off (no VITE_EXTENSION_ID in this build).
import { useSyncExternalStore } from 'react';
import { ExtensionInstall } from '@/components/ExtensionInstall/ExtensionInstall';
import { TestRequestButton } from '@/components/TestRequestButton/TestRequestButton';
import { PLAYGROUND_COPY } from '@/copy/screens-main';
import { playgroundBridge, type PlaygroundBridge } from '@/relay/playgroundBridge';
import type { TestRequests } from '@/relay/testRequest';
import type { ExtensionStatus } from '@/state/homeBase';
import styles from './playground.module.css';

/** The state line (50 section 11: "Sieve extension: connected" or "not installed"), or null while the extension is off. */
export function extensionLine(status: ExtensionStatus): string | null {
  switch (status) {
    case 'connected':
      return PLAYGROUND_COPY.extensionConnected;
    case 'not-installed':
      return PLAYGROUND_COPY.extensionNotInstalled;
    case 'reconnecting':
      return PLAYGROUND_COPY.extensionReconnecting;
    case 'connecting':
    case 'idle':
      return PLAYGROUND_COPY.extensionConnecting;
    default:
      return null;
  }
}

export interface ExtensionStripProps {
  bridge?: PlaygroundBridge;
  requests?: TestRequests;
}

export function ExtensionStrip({ bridge = playgroundBridge, requests }: ExtensionStripProps) {
  const status = useSyncExternalStore(bridge.subscribe, bridge.status, bridge.status);
  const line = extensionLine(status);
  if (!line) return null;
  return (
    <div className={styles.strip} data-testid="extension-strip" data-status={status}>
      <div className={styles.extensionText}>
        <p className={styles.extensionState}>{line}</p>
        <p className={styles.extensionLead}>{PLAYGROUND_COPY.extensionLead}</p>
      </div>
      <ExtensionInstall status={status} />
      <div className={styles.extensionActions}>
        <TestRequestButton status={status} {...(requests ? { requests } : {})} />
      </div>
    </div>
  );
}

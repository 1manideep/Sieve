// The Sieve extension in Settings (#extension; 40 section 13.8.7, 50 sections 8.9 and 11), as rows on the ground: its
// state with the side panel shortcut, the download and the steps to load it unpacked (components/ExtensionInstall),
// then the test request. Shown whenever this build has the extension. Before this tab is the home base the port is
// closed, so the state says the extension talks to the home base tab and the test request is not offered.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { ExtensionInstall } from '@/components/ExtensionInstall/ExtensionInstall';
import { useExtensionInstallStatus } from '@/components/ExtensionInstall/useExtensionInstallStatus';
import { TestRequestButton } from '@/components/TestRequestButton/TestRequestButton';
import { SETTINGS } from '@/copy/screens-controls';
import { STATUS_POPOVER } from '@/copy/strings';
import { announce } from '@/state/announcer';
import { useHomeBase, type ExtensionStatus } from '@/state/homeBase';
import { selectShortcut } from '../requests/RequestNotices';
import { Fill } from './kit/Fill';
import ground from './kit/ground.module.css';
import styles from './settings.module.css';

const SHORTCUTS_ADDRESS = 'chrome://extensions/shortcuts';

function stateLine(status: ExtensionStatus): string {
  if (status === 'connected') return STATUS_POPOVER.extensionConnected;
  if (status === 'not-installed') return STATUS_POPOVER.extensionNotInstalled;
  if (status === 'reconnecting') return STATUS_POPOVER.extensionReconnecting;
  return STATUS_POPOVER.extensionIdle;
}

export function ExtensionCard() {
  const port = useHomeBase((s) => s.extension);
  const status = useExtensionInstallStatus();
  const shortcut = useHomeBase(selectShortcut);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (status === 'off') return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(SHORTCUTS_ADDRESS);
      setCopied(true);
      announce(SETTINGS.addressCopied);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address stays on screen to type.
    }
  };

  const showShortcut = status === 'connected' && shortcut !== undefined;
  let sub: ReactNode = null;
  if (showShortcut) {
    sub =
      shortcut === '' ? (
        SETTINGS.extensionShortcutUnset
      ) : (
        <Fill template={SETTINGS.extensionShortcut} values={{ shortcut: <kbd className={styles.kbd}>{shortcut}</kbd> }} />
      );
  }

  return (
    <ErrorBoundary>
      <section id="extension" className={ground.sec} aria-labelledby="extension-heading">
        <h2 id="extension-heading" className={ground.h2} tabIndex={-1}>
          {SETTINGS.extensionHeading}
        </h2>
        <ul className={ground.rows} aria-label={SETTINGS.extensionHeading}>
          <li className={ground.row}>
            <span className={ground.rowText}>
              <span>{stateLine(status)}</span>
              {sub ? <span className={ground.rowSub}>{sub}</span> : null}
            </span>
            {showShortcut ? (
              <Button variant="secondary" size="sm" icon="copy" onClick={() => void copyAddress()}>
                {copied ? SETTINGS.copied : SETTINGS.copyAddress}
              </Button>
            ) : null}
          </li>
          <li className={ground.row}>
            <ExtensionInstall status={status} />
          </li>
          {port !== 'off' ? (
            <li className={ground.row}>
              <TestRequestButton status={status} />
            </li>
          ) : null}
        </ul>
      </section>
    </ErrorBoundary>
  );
}

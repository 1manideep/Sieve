// Getting the Sieve extension: the zip this site serves (scripts/extension-zip.mjs builds it with the manifest key, so
// the unpacked extension has the id the bridge expects), then the steps to load it unpacked in Chrome on a computer.
// Used in Settings (#extension), Setup step 4 and the Playground's extension strip, which each show the extension's
// state; this part only follows it: nothing while the extension is off in this build, and the steps folded once it
// is connected. A Chrome Web Store URL, when there is one, becomes the main link and the zip the alternative.
import { useEffect, useId, useRef, useState } from 'react';
import { env } from '@/app/env';
import { EXTENSION_INSTALL, fillText } from '@/copy/screens-controls';
import { announce } from '@/state/announcer';
import type { ExtensionStatus } from '@/state/homeBase';
import { Button, LinkButton } from '../Button/Button';
import { Fill } from '../Fill/Fill';
import styles from './ExtensionInstall.module.css';

export const EXTENSION_VERSION = __EXTENSION_VERSION__;
/** Same origin, so the download attribute works; Hosting serves /downloads/** as an attachment. */
export const EXTENSION_ZIP_URL = `/downloads/sieve-extension-${EXTENSION_VERSION}.zip`;
/** Pages can't link to chrome:// addresses, so this one is copied. */
export const EXTENSIONS_ADDRESS = 'chrome://extensions';

/** The zip link's text. On a phone it wraps, and "(version ..., .zip)" stays on one line: no-break spaces. */
export function zipLinkLabel(storeUrl?: string): string {
  const label = fillText(storeUrl ? EXTENSION_INSTALL.orUnpacked : EXTENSION_INSTALL.download, { version: EXTENSION_VERSION });
  return label.replace(/\([^)]*\)$/, (part) => part.replaceAll(' ', '\u00a0'));
}

export interface ExtensionInstallProps {
  /** The extension's state as the screen knows it. 'off' (no extension in this build) shows nothing. */
  status: ExtensionStatus;
  /** The Chrome Web Store page; when set it is the main link. Defaults to VITE_EXTENSION_STORE_URL. */
  storeUrl?: string;
  /** 'secondary' where the screen already has its one primary button (Setup's Finish). Default 'primary'. */
  emphasis?: 'primary' | 'secondary';
}

/** The address, with a Copy button that confirms in place and to screen readers. */
function CopyAddress() {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EXTENSIONS_ADDRESS);
      setCopied(true);
      announce(EXTENSION_INSTALL.addressCopied);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the address so the person can copy it with the keyboard.
      if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
      announce(EXTENSION_INSTALL.copyFailed);
    }
  };

  return (
    <span className={styles.row}>
      <code ref={codeRef} className={styles.code}>
        {EXTENSIONS_ADDRESS}
      </code>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? 'check' : 'copy'}
        aria-label={copied ? undefined : EXTENSION_INSTALL.copyLabel}
        onClick={() => void copy()}
      >
        {copied ? EXTENSION_INSTALL.copied : EXTENSION_INSTALL.copy}
      </Button>
    </span>
  );
}

export function ExtensionInstall({ status, storeUrl = env.extensionStoreUrl, emphasis = 'primary' }: ExtensionInstallProps) {
  const stepsId = useId();
  // null until the person opens or folds the steps; until then they follow the state.
  const [choice, setChoice] = useState<boolean | null>(null);
  if (status === 'off') return null;

  const connected = status === 'connected';
  const main = connected || emphasis === 'secondary' ? 'secondary' : 'primary';
  const open = choice ?? (!storeUrl && (status === 'not-installed' || status === 'idle'));
  const zipLabel = zipLinkLabel(storeUrl);

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        {storeUrl ? (
          <LinkButton to={storeUrl} external variant={main} size="sm">
            {EXTENSION_INSTALL.store}
          </LinkButton>
        ) : null}
        <LinkButton
          to={EXTENSION_ZIP_URL}
          download
          variant={storeUrl ? 'secondary' : main}
          size="sm"
          icon="download"
          className={styles.wrap}
        >
          {zipLabel}
        </LinkButton>
        <Button
          variant="ghost"
          size="sm"
          icon={open ? 'chevron-down' : 'chevron-right'}
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setChoice(!open)}
        >
          {EXTENSION_INSTALL.howTo}
        </Button>
      </div>
      <div id={stepsId} hidden={!open}>
        <div className={styles.stack}>
          <ol className={styles.steps}>
            <li>{EXTENSION_INSTALL.step1}</li>
            <li>
              {EXTENSION_INSTALL.step2}
              <span className={styles.note}>{EXTENSION_INSTALL.step2Note}</span>
            </li>
            <li>
              {EXTENSION_INSTALL.step3}
              <CopyAddress />
              <span className={styles.note}>{EXTENSION_INSTALL.step3Note}</span>
            </li>
            <li>{EXTENSION_INSTALL.step4}</li>
            <li>
              <Fill
                template={EXTENSION_INSTALL.step5}
                values={{ loadUnpacked: <b>{EXTENSION_INSTALL.loadUnpacked}</b>, manifest: <code className={styles.code}>manifest.json</code> }}
              />
            </li>
            <li>{EXTENSION_INSTALL.step6}</li>
          </ol>
          <p className={styles.note}>{EXTENSION_INSTALL.warning}</p>
          <p className={styles.note}>
            <Fill template={EXTENSION_INSTALL.update} values={{ address: <code className={styles.code}>{EXTENSIONS_ADDRESS}</code> }} />
          </p>
        </div>
      </div>
    </div>
  );
}

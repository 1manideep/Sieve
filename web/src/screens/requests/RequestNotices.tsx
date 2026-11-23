// The notices above the Requests list (40 sections 11.4, 11.6, 13.5 and 13.8.9; 50 section 8.9). Gmail access running
// out (70 R-MAIL-10) shows on every page of the home base since Nov 23 (components/GmailAccess).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, LinkButton } from '@/components/Button/Button';
import { Notice } from '@/components/Notice/Notice';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import { STATUS_POPOVER } from '@/copy/strings';
import { useAutoApprove } from '@/state/autoApprove';
import { useGrants } from '@/state/grants';
import { useHomeBase, type HomeBaseState } from '@/state/homeBase';
import { useNetwork } from '@/state/network';
import { Fill, Iso } from '../settings/kit/Fill';
import { formatClock } from '../settings/kit/when';
import styles from './requests.module.css';

/**
 * The extension's shortcut from `sieve/hello-ack` (01 section 6, 50 section 8.9): undefined until an ack arrives,
 * '' when unset. Contract change request: add `extensionShortcut?: string` to HomeBaseState (40 section 9.5).
 */
export type HomeBaseWithShortcut = HomeBaseState & { extensionShortcut?: string };
export const selectShortcut = (s: HomeBaseState): string | undefined => (s as HomeBaseWithShortcut).extensionShortcut;

export const CONNECT_AI_HREF = '/settings?connect=1#ais';
const MEMORY_SAVER_KEY = 'sieve.tip.memorySaver';

export function RoleBanner({ onMakeHomeBase }: { onMakeHomeBase(): void }) {
  const role = useHomeBase((s) => s.role);
  const presence = useHomeBase((s) => s.presence);
  const label = useHomeBase((s) => s.homeBaseLabel);
  const online = useNetwork((s) => s.online);
  const grantsReady = useGrants((s) => s.status === 'ready');
  const hasActiveGrant = useGrants((s) => s.grants.some((g) => g.state === 'active' || g.state === 'expiring'));

  const makeButton = (
    <Button variant="secondary" size="sm" onClick={onMakeHomeBase}>
      {REQUESTS.makeHomeBase}
    </Button>
  );

  let roleNotice = null;
  if (role === 'not-home-base') {
    roleNotice = (
      <Notice tone="info" actions={makeButton}>
        {REQUESTS.bannerNotHomeBase}
      </Notice>
    );
  } else if (role === 'other-device') {
    roleNotice = (
      <Notice tone="info" actions={makeButton}>
        <Fill template={REQUESTS.bannerOtherDevice} values={{ label: <Iso>{label ?? REQUESTS.otherDeviceFallback}</Iso> }} />
      </Notice>
    );
  } else if (role === 'standby') {
    roleNotice = (
      <Notice
        tone="info"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void useHomeBase.getState().useThisTab().catch(console.error)}>
            {REQUESTS.useThisTab}
          </Button>
        }
      >
        {REQUESTS.bannerStandby}
      </Notice>
    );
  } else if (role === 'active' && (presence === 'offline' || !online)) {
    roleNotice = <Notice tone="warning">{REQUESTS.bannerOffline}</Notice>;
  }

  return (
    <>
      {roleNotice}
      {grantsReady && !hasActiveGrant ? (
        <Notice
          tone="info"
          actions={
            <LinkButton to={CONNECT_AI_HREF} variant="secondary" size="sm">
              {REQUESTS.connectAi}
            </LinkButton>
          }
        >
          {REQUESTS.bannerNoGrant}
        </Notice>
      ) : null}
    </>
  );
}

/** "Claude", "Claude and ChatGPT", "Claude, ChatGPT and Gemini". */
function joinNames(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** 40 section 13.8.9: while any current connection has auto-approve on, until the last one ends. */
export function AutoApproveNotice() {
  const until = useAutoApprove((s) => s.until);
  const grants = useGrants((s) => s.grants);
  const on = grants.filter((g) => (g.state === 'active' || g.state === 'expiring') && until[g.id] !== undefined);
  if (on.length === 0) return null;
  const time = formatClock(Math.max(...on.map((g) => until[g.id])));
  return (
    <Notice tone="warning">
      <Fill
        template={REQUESTS.autoApproveNotice}
        values={{
          names: <Iso>{joinNames(on.map((g) => g.aiName))}</Iso>,
          time,
          stop: <Link to="/settings#ais">{REQUESTS.autoApproveStop}</Link>,
        }}
      />
    </Notice>
  );
}

/** Plain text of the notice, for tests and announcements. */
export const autoApproveNoticeText = (names: string[], time: string) =>
  fillText(REQUESTS.autoApproveNotice, { names: joinNames(names), time, stop: REQUESTS.autoApproveStop });

/** 40 section 11.6: a request waits for the first click in this tab. */
export function ClickNotice() {
  const waiting = useHomeBase((s) => s.waitingForClick);
  if (!waiting) return null;
  return <Notice tone="warning">{STATUS_POPOVER.homeBaseNeedsClick}</Notice>;
}

function tipDismissed(): boolean {
  try {
    return window.localStorage.getItem(MEMORY_SAVER_KEY) === '1';
  } catch {
    return false;
  }
}

/** 40 section 11.4: shown once while this tab is the active home base. */
export function MemorySaverTip() {
  const active = useHomeBase((s) => s.role === 'active');
  const [dismissed, setDismissed] = useState(tipDismissed);
  if (!active || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(MEMORY_SAVER_KEY, '1');
    } catch {
      // Storage blocked: the tip stays hidden for this visit.
    }
  };
  return (
    <Notice
      tone="info"
      actions={
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {REQUESTS.dismiss}
        </Button>
      }
    >
      {REQUESTS.memorySaverTip}
    </Notice>
  );
}

/** 50 section 8.9: the side panel shortcut, once the extension has said what it is. */
export function ShortcutTip() {
  const connected = useHomeBase((s) => s.extension === 'connected');
  const shortcut = useHomeBase(selectShortcut);
  if (!connected || shortcut === undefined) return null;
  return (
    <p className={styles.tip}>
      {shortcut === '' ? (
        REQUESTS.shortcutUnset
      ) : (
        <Fill template={REQUESTS.shortcutTip} values={{ shortcut: <kbd className={styles.kbd}>{shortcut}</kbd> }} />
      )}
    </p>
  );
}

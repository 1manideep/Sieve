// Notifications and this computer (40 section 13.8.7, 50 section 8.9): the push checkbox, the computers with their
// home base and push state, and the extension with its side panel shortcut and the test request (50 section 11).
// Setup step 4 (13.3) reuses PushToggle.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { canKeepDeviceId, defaultDeviceLabel } from '@/app/deviceId';
import { env } from '@/app/env';
import { Button, LinkButton } from '@/components/Button/Button';
import { Tag } from '@/components/Tag/Tag';
import { TestRequestButton } from '@/components/TestRequestButton/TestRequestButton';
import { HOME_BASE_DIALOG, SETTINGS } from '@/copy/screens-controls';
import { STATUS_POPOVER } from '@/copy/strings';
import { announce } from '@/state/announcer';
import { useHomeBase } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { DeviceView } from '@/state/types';
import { selectShortcut } from '../requests/RequestNotices';
import { Confirm } from './kit/Confirm';
import { Fill } from './kit/Fill';
import { MakeHomeBaseDialog } from './kit/MakeHomeBaseDialog';
import { SettingsCard } from './SettingsCard';
import { saveStatusText } from './settingsText';
import styles from './settings.module.css';

const SHORTCUTS_ADDRESS = 'chrome://extensions/shortcuts';

/** The push checkbox. setPushEnabled runs straight from the change event: the permission prompt needs the gesture. */
export function PushToggle() {
  const on = useSettings((s) => s.settings.pushEnabled);
  const [problem, setProblem] = useState<'unsupported' | 'denied' | undefined>(undefined);
  const noteId = useId();
  const problemId = useId();

  const change = (want: boolean) => {
    useSettings
      .getState()
      .setPushEnabled(want)
      .then((result: string) => {
        // 'dismissed' (13.8.7) leaves it off silently; the store's result type gains it in a change request.
        if (result === 'unsupported' || result === 'denied') setProblem(result);
        else if (result === 'error') useToasts.getState().push({ tone: 'error', title: SETTINGS.pushError });
        else setProblem(undefined);
      })
      .catch((error: unknown) => {
        console.error(error);
        useToasts.getState().push({ tone: 'error', title: SETTINGS.pushError });
      });
  };

  return (
    <div className={styles.group}>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={on}
          disabled={problem === 'unsupported'}
          aria-describedby={problem ? `${noteId} ${problemId}` : noteId}
          onChange={(e) => change(e.target.checked)}
        />
        <span className={styles.choiceLabel}>{SETTINGS.pushCheckbox}</span>
      </label>
      <p id={noteId} className={styles.note}>
        {SETTINGS.pushNote}
      </p>
      {problem ? (
        <p id={problemId} className={styles.warnText} role="status">
          {problem === 'unsupported' ? SETTINGS.pushUnsupported : SETTINGS.pushDenied}
        </p>
      ) : null}
    </div>
  );
}

function ExtensionRow() {
  const status = useHomeBase((s) => s.extension);
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

  let line: ReactNode;
  if (status === 'connected') {
    line =
      shortcut === undefined ? (
        STATUS_POPOVER.extensionConnected
      ) : shortcut === '' ? (
        SETTINGS.extensionShortcutUnset
      ) : (
        <Fill template={SETTINGS.extensionShortcut} values={{ shortcut: <kbd className={styles.kbd}>{shortcut}</kbd> }} />
      );
  } else if (status === 'not-installed') line = STATUS_POPOVER.extensionNotInstalled;
  else if (status === 'reconnecting') line = STATUS_POPOVER.extensionReconnecting;
  else line = STATUS_POPOVER.extensionIdle;

  return (
    <div className={styles.group}>
      <h3 className={styles.h3}>{SETTINGS.extensionHeading}</h3>
      <p className={styles.text}>{line}</p>
      <div className={styles.inline}>
        {status === 'connected' && shortcut !== undefined ? (
          <Button variant="secondary" size="sm" icon="copy" onClick={() => void copyAddress()}>
            {copied ? SETTINGS.copied : SETTINGS.copyAddress}
          </Button>
        ) : null}
        {status === 'not-installed' ? (
          <LinkButton to={env.extensionStoreUrl ?? `${env.repoUrl}#extension`} external variant="secondary" size="sm">
            {STATUS_POPOVER.getExtension}
          </LinkButton>
        ) : null}
      </div>
      <TestRequestButton status={status} />
    </div>
  );
}

export function NotificationsCard() {
  const status = useSettings((s) => saveStatusText(s.saving, (k) => k === 'pushEnabled'));
  const { devices, role } = useHomeBase(useShallow((s) => ({ devices: s.devices, role: s.role })));
  const deviceId = useSession((s) => s.deviceId);
  const [makeOpen, setMakeOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const keepsId = canKeepDeviceId();

  const thisDevice: DeviceView = devices.find((d) => d.isThisDevice || d.id === deviceId) ?? {
    id: deviceId,
    label: defaultDeviceLabel(),
    isHomeBase: false,
    hasPush: false,
    updatedAt: 0,
    isThisDevice: true,
  };
  const others = devices.filter((d) => d.id !== thisDevice.id);
  const thisIsHomeBase = thisDevice.isHomeBase || role === 'active' || role === 'standby' || role === 'starting';

  const row = (d: DeviceView, mine: boolean) => {
    const homeBase = mine ? thisIsHomeBase : d.isHomeBase;
    return (
      <li key={d.id} className={styles.deviceRow}>
        <div className={styles.deviceMain}>
          <p className={styles.deviceName}>
            <bdi>{d.label}</bdi>
          </p>
          <p className={styles.tagsRow}>
            {mine ? <Tag tone="muted">{SETTINGS.thisComputer}</Tag> : null}
            {homeBase ? <Tag tone="device">{SETTINGS.homeBase}</Tag> : null}
            {d.hasPush ? <Tag tone="muted">{SETTINGS.pushOn}</Tag> : null}
          </p>
          {mine && !keepsId ? <p className={styles.note}>{SETTINGS.noDeviceId}</p> : null}
        </div>
        {mine ? (
          homeBase ? (
            <Button variant="secondary" size="sm" onClick={() => setStopOpen(true)}>
              {SETTINGS.stopHomeBase}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setMakeOpen(true)}>
              {SETTINGS.makeHomeBase}
            </Button>
          )
        ) : null}
      </li>
    );
  };

  return (
    <SettingsCard id="notifications" title={SETTINGS.notificationsHeading} status={status}>
      <PushToggle />
      <div className={styles.group}>
        <h3 className={styles.h3}>{SETTINGS.devicesHeading}</h3>
        <ul className={styles.devices}>
          {row(thisDevice, true)}
          {others.map((d) => row(d, false))}
        </ul>
      </div>
      <ExtensionRow />
      <MakeHomeBaseDialog open={makeOpen} onClose={() => setMakeOpen(false)} />
      <Confirm
        open={stopOpen}
        title={HOME_BASE_DIALOG.stopTitle}
        body={HOME_BASE_DIALOG.stopBody}
        confirmLabel={HOME_BASE_DIALOG.stopConfirm}
        tone="danger"
        onCancel={() => setStopOpen(false)}
        onConfirm={async () => {
          await useHomeBase.getState().stopBeingHomeBase().catch(console.error);
          setStopOpen(false);
        }}
      />
    </SettingsCard>
  );
}

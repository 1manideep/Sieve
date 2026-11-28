// Notifications and this computer (40 section 13.8.7; design handoff of Nov 20, 2026), as rows on the ground: the push
// switch and the computers with their home base and push state. The extension, with its side panel shortcut and the
// test request, has its own section (ExtensionCard, #extension). Setup step 4 (13.3) reuses PushToggle, the checkbox form.
import { useId, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { canKeepDeviceId, defaultDeviceLabel } from '@/app/deviceId';
import { Button } from '@/components/Button/Button';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { Tag } from '@/components/Tag/Tag';
import { HOME_BASE_DIALOG, SETTINGS } from '@/copy/screens-controls';
import { useHomeBase } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { DeviceView } from '@/state/types';
import { Confirm } from './kit/Confirm';
import { MakeHomeBaseDialog } from './kit/MakeHomeBaseDialog';
import ground from './kit/ground.module.css';
import { saveStatusText } from './settingsText';
import styles from './settings.module.css';

/** The push setting. setPushEnabled runs straight from the click or change event: the permission prompt needs the gesture. */
function usePush() {
  const on = useSettings((s) => s.settings.pushEnabled);
  const [problem, setProblem] = useState<'unsupported' | 'denied' | undefined>(undefined);

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
  return { on, problem, change };
}

/** The push switch, as a row in Settings. */
function PushRow() {
  const { on, problem, change } = usePush();
  const labelId = useId();
  const noteId = useId();
  const problemId = useId();
  return (
    <li className={ground.row}>
      <span className={ground.rowText}>
        <span id={labelId}>{SETTINGS.pushCheckbox}</span>
        <span id={noteId} className={ground.rowSub}>
          {SETTINGS.pushNote}
        </span>
        {problem ? (
          <span id={problemId} className={styles.warnText} role="status">
            {problem === 'unsupported' ? SETTINGS.pushUnsupported : SETTINGS.pushDenied}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        className={ground.switch}
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={problem ? `${noteId} ${problemId}` : noteId}
        disabled={problem === 'unsupported'}
        onClick={() => change(!on)}
      />
    </li>
  );
}

/** The push checkbox, for Setup step 4. */
export function PushToggle() {
  const { on, problem, change } = usePush();
  const noteId = useId();
  const problemId = useId();

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
      <li key={d.id} className={ground.row}>
        <span className={ground.rowText}>
          <bdi>{d.label}</bdi>
          <span className={styles.tagsRow}>
            {mine ? <Tag tone="muted">{SETTINGS.thisComputer}</Tag> : null}
            {homeBase ? <Tag tone="device">{SETTINGS.homeBase}</Tag> : null}
            {d.hasPush ? <Tag tone="muted">{SETTINGS.pushOn}</Tag> : null}
          </span>
          {mine && !keepsId ? <span className={ground.rowSub}>{SETTINGS.noDeviceId}</span> : null}
        </span>
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
    <ErrorBoundary>
      <section id="notifications" className={ground.sec} aria-labelledby="notifications-heading">
        <div className={ground.secHead}>
          <h2 id="notifications-heading" className={ground.h2} tabIndex={-1}>
            {SETTINGS.notificationsHeading}
          </h2>
          {status ? (
            <span className={styles.saveStatus} role="status">
              {status}
            </span>
          ) : null}
        </div>
        <ul className={ground.rows} aria-label={SETTINGS.notificationsHeading}>
          <PushRow />
          {row(thisDevice, true)}
          {others.map((d) => row(d, false))}
        </ul>
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
      </section>
    </ErrorBoundary>
  );
}

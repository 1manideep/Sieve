// The settings block under the header (50 section 8.10), opened by the gear next to the close button. One switch
// today, "Open when a request arrives" (default on). It reads and writes chrome.storage.local through the panel
// API; the worker reads the same key when the next request arrives, so no message is needed. The block stays in
// the page while hidden, so the value is loaded before the person opens it.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { COPY } from '../../shared/labels';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Settings } from '../../shared/settings';
import s from '../ui.module.css';

/** Where the panel keeps its settings (chrome.storage.local in the extension; a fake in tests). */
export interface SettingsStore {
  read(): Promise<Settings>;
  write(change: Partial<Settings>): Promise<Settings>;
}

interface Props {
  id: string;
  open: boolean;
  store: SettingsStore;
  /** Escape inside the block: close it (the caller moves focus back to the gear). */
  onClose(): void;
}

export function SettingsMenu({ id, open, store, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const lastWrite = useRef(0); // only the newest save may change the switch, so quick presses never flicker back
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    live.current = true;
    store.read().then(
      (v) => {
        if (live.current) setSettings(v);
      },
      () => {
        if (live.current) setSettings({ ...DEFAULT_SETTINGS });
      },
    );
    return () => {
      live.current = false;
    };
  }, [store]);

  const change = (openOnArrival: boolean) => {
    const before = settings;
    const seq = ++lastWrite.current;
    setSettings({ ...(before ?? DEFAULT_SETTINGS), openOnArrival });
    setFailed(false);
    store.write({ openOnArrival }).then(
      (saved) => {
        if (live.current && seq === lastWrite.current) setSettings(saved);
      },
      () => {
        if (!live.current || seq !== lastWrite.current) return;
        setSettings(before);
        setFailed(true);
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };

  return (
    <section id={id} className={s.settings} aria-label={COPY.settings.button} hidden={!open} onKeyDown={onKeyDown}>
      <div className={s.setting}>
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          className={s.switch}
          checked={settings?.openOnArrival ?? DEFAULT_SETTINGS.openOnArrival}
          disabled={settings === null}
          aria-describedby={hintId}
          onChange={(e) => change(e.target.checked)}
        />
        <div className={s.settingText}>
          <label htmlFor={inputId} className={s.settingLabel}>
            {COPY.settings.openOnArrival}
          </label>
          <p id={hintId} className={s.settingHint}>
            {COPY.settings.openOnArrivalHint}
          </p>
        </div>
      </div>
      {failed ? (
        <p className={s.settingError} role="alert">
          {COPY.settings.saveFailed}
        </p>
      ) : null}
    </section>
  );
}

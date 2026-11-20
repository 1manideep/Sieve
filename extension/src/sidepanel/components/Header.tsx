// Header (board F8): "Sieve", the status line under it, and on the right the settings gear (when the page has a
// settings store) and the close button. The gear opens the settings block under the header (50 section 8.10).
import type { Ref } from 'react';
import type { ConnectionState } from '../../shared/internal';
import { COPY } from '../../shared/labels';
import s from '../ui.module.css';
import { StatusTag } from './StatusTag';

export const CLOSE_LABEL = 'Close the panel';

export interface HeaderSettings {
  open: boolean;
  /** The id of the settings block the gear shows and hides. */
  controls: string;
  onToggle(): void;
}

interface HeaderProps {
  connection: ConnectionState | null;
  onClose(): void;
  settings?: HeaderSettings;
  /** The gear button, so focus can return to it when the settings close. */
  gearRef?: Ref<HTMLButtonElement>;
}

export function Header({ connection, onClose, settings, gearRef }: HeaderProps) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <h1 className={s.brandName}>Sieve</h1>
        {connection ? <StatusTag connection={connection} /> : null}
      </div>
      <div className={s.headerActions}>
        {settings ? (
          <button
            type="button"
            ref={gearRef}
            className={`${s.iconBtn} ${settings.open ? s.iconBtnOn : ''}`}
            aria-label={COPY.settings.button}
            title={COPY.settings.button}
            aria-expanded={settings.open}
            aria-controls={settings.controls}
            onClick={settings.onToggle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        ) : null}
        <button type="button" className={s.close} aria-label={CLOSE_LABEL} title={CLOSE_LABEL} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>
  );
}

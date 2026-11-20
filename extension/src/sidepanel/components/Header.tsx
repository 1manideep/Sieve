// Header (board F8): "Sieve", the status line under it, and the close button on the right.
import type { ConnectionState } from '../../shared/internal';
import s from '../ui.module.css';
import { StatusTag } from './StatusTag';

export const CLOSE_LABEL = 'Close the panel';

export function Header({ connection, onClose }: { connection: ConnectionState | null; onClose(): void }) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <h1 className={s.brandName}>Sieve</h1>
        {connection ? <StatusTag connection={connection} /> : null}
      </div>
      <button type="button" className={s.close} aria-label={CLOSE_LABEL} title={CLOSE_LABEL} onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>
  );
}

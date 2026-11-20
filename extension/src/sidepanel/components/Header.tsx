import type { ConnectionState } from '../../shared/internal';
import s from '../ui.module.css';
import { ShieldIcon } from './Basics';
import { StatusTag } from './StatusTag';

export function Header({ connection }: { connection: ConnectionState | null }) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <ShieldIcon />
        <h1 className={s.brandName}>Sieve</h1>
      </div>
      {connection ? <StatusTag connection={connection} /> : null}
    </header>
  );
}

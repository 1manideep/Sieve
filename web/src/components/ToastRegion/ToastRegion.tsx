// Toasts (40 section 7.5). Timers pause while a toast is hovered or focused. Announced through the LiveAnnouncer.
import { useEffect, useRef, useState } from 'react';
import { SHELL } from '@/copy/strings';
import { useToasts, type Toast } from '@/state/toasts';
import { Icon } from '../icons';
import styles from './ToastRegion.module.css';

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.timeoutMs);
  const paused = hovered || focused;

  useEffect(() => {
    // Infinity: the toast stays until it is dismissed (setTimeout would read Infinity as 0 and close it at once).
    if (paused || !Number.isFinite(remaining.current)) return undefined;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, dismiss, toast.id]);

  return (
    <li
      className={`${styles.toast} ${styles[toast.tone]}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className={styles.body}>
        <p className={styles.title}>{toast.title}</p>
        {toast.body ? <p className={styles.text}>{toast.body}</p> : null}
        {toast.action ? (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              toast.action?.run();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" className={styles.dismiss} aria-label={SHELL.dismiss} onClick={() => dismiss(toast.id)}>
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

export function ToastRegion() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <section className={styles.region} aria-label={SHELL.notifications}>
      {toasts.length > 0 ? (
        <ol className={styles.list}>
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

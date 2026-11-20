// Account menu (40 section 7.3): a 44px circle button and a menu with arrow-key navigation.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACCOUNT } from '@/copy/strings';
import { useSession } from '@/state/session';
import styles from './AccountMenu.module.css';

interface Item { label: string; run: () => void }

export function AccountMenu() {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const name = user?.displayName || user?.email || '';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const items: Item[] = [
    { label: ACCOUNT.settings, run: () => navigate('/settings') },
    { label: ACCOUNT.playground, run: () => navigate('/playground') },
    {
      label: ACCOUNT.signOut,
      run: () => {
        signOut()
          .then(() => navigate('/welcome'))
          .catch((error: unknown) => console.error(error));
      },
    },
  ];

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(items.length - 1);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(last);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={ACCOUNT.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKeyDown}
      >
        <span aria-hidden="true">{initial}</span>
      </button>
      {open ? (
        <div className={styles.panel} onKeyDown={onMenuKeyDown}>
          {user?.email ? <p className={styles.header}>{ACCOUNT.signedInAs(user.email)}</p> : null}
          <div id={menuId} role="menu" aria-label={ACCOUNT.button} className={styles.menu}>
            {items.map((item, index) => (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={index === active ? 0 : -1}
                className={styles.item}
                onClick={() => {
                  close(false);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

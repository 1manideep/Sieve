// App-wide dialog host (40 section 7.1). Mounts the index owner check (40 section 6.4): a blocking dialog when this
// browser's private index belongs to another Google account. Nothing reads the real index until it is resolved.
// The "Make this my home base" dialog (11.2) is opened by the screens that offer it.
import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { OWNER_CONFLICT_COPY, fill } from '@/copy/screens-main';
import { useSession } from '@/state/session';
import { Button } from '../Button/Button';
import { Dialog } from '../Dialog/Dialog';

export function DialogHost() {
  const { conflict, email } = useSession(useShallow((s) => ({ conflict: s.ownerConflict && s.kind === 'google', email: s.user?.email })));
  const [busy, setBusy] = useState<'clear' | 'sign-out' | null>(null);

  const resolve = async (choice: 'clear' | 'sign-out') => {
    setBusy(choice);
    try {
      await useSession.getState().resolveOwnerConflict(choice);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={conflict}
      title={OWNER_CONFLICT_COPY.title}
      description={fill(OWNER_CONFLICT_COPY.body, { email: email ?? OWNER_CONFLICT_COPY.thisAccount })}
      onClose={() => undefined}
      dismissible={false}
      initialFocus="primary"
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={busy !== null} busy={busy === 'sign-out'} onClick={() => void resolve('sign-out')}>
            {OWNER_CONFLICT_COPY.signOut}
          </Button>
          <Button variant="danger" disabled={busy !== null} busy={busy === 'clear'} onClick={() => void resolve('clear')}>
            {OWNER_CONFLICT_COPY.clear}
          </Button>
        </>
      }
    />
  );
}

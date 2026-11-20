// PlaygroundHeader (40 section 13.9): logo, the amber "Playground" tag, the intro, "Reset the device" and
// "Use your own data". "Use your own data" is fenced before Google sign-in (00 D9).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog, Dialog } from '@/components/Dialog/Dialog';
import { Logo } from '@/components/Logo/Logo';
import { Tag } from '@/components/Tag/Tag';
import { PLAYGROUND_COPY } from '@/copy/screens-main';
import { useSession } from '@/state/session';
import { waitForGoogle } from '@/components/signIn';
import styles from './playground.module.css';

export interface PlaygroundHeaderProps {
  onReset(): Promise<void>;
}

export function PlaygroundHeader({ onReset }: PlaygroundHeaderProps) {
  const navigate = useNavigate();
  const kind = useSession((s) => s.kind);
  const signingIn = useSession((s) => s.signingIn);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fence, setFence] = useState(false);

  const signIn = async () => {
    const result = await useSession.getState().signInWithGoogle();
    if (result !== 'ok') return;
    setFence(false);
    await waitForGoogle();
    navigate('/');
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>
          <Logo to="/playground" />
          <Tag tone="warn">{PLAYGROUND_COPY.tag}</Tag>
        </div>
        <p className={styles.intro}>{PLAYGROUND_COPY.intro}</p>
        <div className={styles.headerButtons}>
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>
            {PLAYGROUND_COPY.reset}
          </Button>
          {kind === 'google' ? (
            <Button variant="secondary" onClick={() => navigate('/')}>
              {PLAYGROUND_COPY.backToMine}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setFence(true)}>
              {PLAYGROUND_COPY.useOwn}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={PLAYGROUND_COPY.resetTitle}
        body={PLAYGROUND_COPY.resetBody}
        confirmLabel={PLAYGROUND_COPY.resetConfirm}
        tone="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await onReset();
          setConfirmReset(false);
        }}
      />

      <Dialog
        open={fence}
        title={PLAYGROUND_COPY.ownDataTitle}
        description={PLAYGROUND_COPY.ownDataBody}
        onClose={() => setFence(false)}
        initialFocus="primary"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFence(false)}>
              {PLAYGROUND_COPY.ownDataStay}
            </Button>
            <Button variant="primary" busy={signingIn} disabled={signingIn} onClick={() => void signIn()}>
              {PLAYGROUND_COPY.ownDataSignIn}
            </Button>
          </>
        }
      >
        <p className={styles.fenceText}>{PLAYGROUND_COPY.ownDataGmail}</p>
        <p className={styles.fenceText}>{PLAYGROUND_COPY.ownDataFolder}</p>
      </Dialog>
    </header>
  );
}

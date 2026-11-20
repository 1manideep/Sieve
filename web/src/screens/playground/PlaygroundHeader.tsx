// PlaygroundHeader (40 section 13.9), in the public header style of the final design: "Sieve" as text, the OPEN
// SOURCE pill, the Playground tag; on the right the Ask / What has AI seen? tabs, "Reset the device", "Use your own
// data" (fenced before Google sign-in, 00 D9) or "Back to my data", and the white "Try now".
import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, LinkButton } from '@/components/Button/Button';
import { ConfirmDialog, Dialog } from '@/components/Dialog/Dialog';
import { APP_NAME } from '@/copy/strings';
import { PLAYGROUND_COPY, fill } from '@/copy/screens-main';
import { useSession } from '@/state/session';
import { waitForGoogle } from '@/components/signIn';
import styles from './playground.module.css';

export interface PlaygroundTabs {
  tab: 'ask' | 'seen';
  onTab(t: 'ask' | 'seen'): void;
  seenCount: number;
  ids: { ask: string; seen: string; askPanel: string; seenPanel: string };
}

export interface PlaygroundHeaderProps {
  onReset(): Promise<void>;
  tabs: PlaygroundTabs;
}

export function PlaygroundHeader({ onReset, tabs }: PlaygroundHeaderProps) {
  const navigate = useNavigate();
  const kind = useSession((s) => s.kind);
  const signingIn = useSession((s) => s.signingIn);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fence, setFence] = useState(false);
  const askTab = useRef<HTMLButtonElement>(null);
  const seenTab = useRef<HTMLButtonElement>(null);

  const signIn = async () => {
    const result = await useSession.getState().signInWithGoogle();
    if (result !== 'ok') return;
    setFence(false);
    await waitForGoogle();
    navigate('/');
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'ask' : event.key === 'End' ? 'seen' : tabs.tab === 'ask' ? 'seen' : 'ask';
    tabs.onTab(next);
    (next === 'ask' ? askTab : seenTab).current?.focus();
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>
          <Link to="/" className={styles.wordmark}>
            {APP_NAME}
          </Link>
          <span className={styles.openSource}>{PLAYGROUND_COPY.openSource}</span>
          <span className={styles.playgroundTag}>{PLAYGROUND_COPY.tag}</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.tabs} role="tablist" aria-label={PLAYGROUND_COPY.tabsLabel} onKeyDown={onTabKey}>
            <button
              ref={askTab}
              id={tabs.ids.ask}
              type="button"
              role="tab"
              aria-selected={tabs.tab === 'ask'}
              aria-controls={tabs.ids.askPanel}
              tabIndex={tabs.tab === 'ask' ? 0 : -1}
              className={styles.tab}
              onClick={() => tabs.onTab('ask')}
            >
              {PLAYGROUND_COPY.tabAsk}
            </button>
            <button
              ref={seenTab}
              id={tabs.ids.seen}
              type="button"
              role="tab"
              aria-selected={tabs.tab === 'seen'}
              aria-controls={tabs.ids.seenPanel}
              tabIndex={tabs.tab === 'seen' ? 0 : -1}
              className={styles.tab}
              aria-label={tabs.seenCount > 0 ? fill(PLAYGROUND_COPY.tabSeenCount, { n: tabs.seenCount }) : undefined}
              onClick={() => tabs.onTab('seen')}
            >
              {/* The count shows once, as the blue badge; the name says it in words ("What has AI seen? (1)"). */}
              {PLAYGROUND_COPY.tabSeen}
              {tabs.seenCount > 0 ? <span className={styles.tabBadge} aria-hidden="true">{tabs.seenCount}</span> : null}
            </button>
          </div>
          <div className={styles.headerButtons}>
            <Button variant="ghost" className={styles.headerLink} onClick={() => setConfirmReset(true)}>
              {PLAYGROUND_COPY.reset}
            </Button>
            {kind === 'google' ? (
              <Button variant="ghost" className={styles.headerLink} onClick={() => navigate('/')}>
                {PLAYGROUND_COPY.backToMine}
              </Button>
            ) : (
              <Button variant="ghost" className={styles.headerLink} onClick={() => setFence(true)}>
                {PLAYGROUND_COPY.useOwn}
              </Button>
            )}
            <LinkButton to="/try" variant="primary" className={styles.tryNow}>
              {PLAYGROUND_COPY.tryNow}
            </LinkButton>
          </div>
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

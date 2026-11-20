// Welcome (`/welcome`, 40 section 13.1). Initial focus stays on the document; the CTAs come first in tab order.
import { useNavigate, useSearchParams } from 'react-router-dom';
import { env } from '@/app/env';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button, LinkButton } from '@/components/Button/Button';
import { safePath, waitForGoogle } from '@/components/signIn';
import { Tag } from '@/components/Tag/Tag';
import { TrySlot } from '@/components/TrySlot/TrySlot';
import { SCREENS, TITLES } from '@/copy/strings';
import { WELCOME_COPY } from '@/copy/screens-main';
import { useSession } from '@/state/session';
import { ExampleCard } from './ExampleCard';
import styles from './welcome.module.css';

export function WelcomeScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signingIn = useSession((s) => s.signingIn);

  const signIn = async () => {
    const result = await useSession.getState().signInWithGoogle();
    if (result !== 'ok') return;
    await waitForGoogle();
    // A new account is sent on to /setup by the Google session (40 section 6.5).
    navigate(safePath(params.get('next'), '/'));
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.copy}>
          <div>
            <Tag tone="device">{WELCOME_COPY.tag}</Tag>
          </div>
          <h1 id="welcome-title" className={styles.title}>
            {SCREENS.welcome.heading}
          </h1>
          <p className={styles.lead}>{SCREENS.welcome.lead}</p>
          <div className={styles.ctas}>
            <div className={styles.cta}>
              <LinkButton to="/playground" variant="primary">
                {WELCOME_COPY.tryPlayground}
              </LinkButton>
              <p className={styles.caption}>{WELCOME_COPY.tryCaption}</p>
            </div>
            <div className={styles.cta}>
              <Button variant="secondary" busy={signingIn} disabled={signingIn} onClick={() => void signIn()}>
                {WELCOME_COPY.signIn}
              </Button>
              <p className={styles.caption}>{WELCOME_COPY.signInCaption}</p>
            </div>
          </div>
          <TrySlot />
        </div>
        <ExampleCard />
      </section>

      <section className={styles.tiles} aria-label={WELCOME_COPY.tilesLabel}>
        {WELCOME_COPY.tiles.map((tile) => (
          <div key={tile.title} className={styles.tile}>
            <h2 className={styles.tileTitle}>{tile.title}</h2>
            <p className={styles.tileBody}>{tile.body}</p>
          </div>
        ))}
      </section>

      <p className={styles.requirements}>{WELCOME_COPY.requirements}</p>

      <footer className={styles.footer}>
        <span>{WELCOME_COPY.footerLicense}</span>
        <span aria-hidden="true">·</span>
        <a href={env.repoUrl} target="_blank" rel="noopener">
          {WELCOME_COPY.footerSource}
        </a>
        <span aria-hidden="true">·</span>
        <span>{WELCOME_COPY.footerHackathon}</span>
      </footer>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.welcome);
  return <WelcomeScreen />;
}

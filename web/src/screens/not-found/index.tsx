// Not found (40 section 13.10): H1 and a link button, "Go to Ask" for Google users, else "Open the Playground".
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { LinkButton } from '@/components/Button/Button';
import { ROUTE_ERROR, SCREENS, TITLES } from '@/copy/strings';
import { useSession } from '@/state/session';
import styles from '../screen.module.css';

export function Component() {
  useDocumentTitle(TITLES.notFound);
  const google = useSession((s) => s.kind === 'google');
  return (
    <div className={styles.page}>
      <h1 className={styles.display}>{SCREENS.notFound.heading}</h1>
      <div className={styles.actions}>
        {google ? (
          <LinkButton to="/" variant="primary">
            {ROUTE_ERROR.goToAsk}
          </LinkButton>
        ) : (
          <LinkButton to="/playground" variant="primary">
            {ROUTE_ERROR.openPlayground}
          </LinkButton>
        )}
      </div>
    </div>
  );
}

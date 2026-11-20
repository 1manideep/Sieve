// Not found (40 section 13.10, in the final scheme): black, one sentence, Open Sieve. A Google user goes to Ask,
// everyone else to the Playground.
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { LinkButton } from '@/components/Button/Button';
import { ROUTE_ERROR, SCREENS, TITLES } from '@/copy/strings';
import { useSession } from '@/state/session';
import styles from './notFound.module.css';

export function Component() {
  useDocumentTitle(TITLES.notFound);
  const google = useSession((s) => s.kind === 'google');
  return (
    <div className={styles.page}>
      <div className={`ribbon ${styles.ribbon}`} aria-hidden="true" />
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>{SCREENS.notFound.heading}</h1>
      <p className={styles.line}>{ROUTE_ERROR.notFoundLine}</p>
      <div className={styles.actions}>
        <LinkButton to={google ? '/' : '/playground'} variant="primary" size="lg">
          {ROUTE_ERROR.openSieve}
        </LinkButton>
      </div>
    </div>
  );
}

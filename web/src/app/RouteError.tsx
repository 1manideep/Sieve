// Route-level error element (40 section 7.8). Errors go to console.error only; there is no crash reporting.
import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button, LinkButton } from '@/components/Button/Button';
import { Logo } from '@/components/Logo/Logo';
import { ROUTE_ERROR, SHELL } from '@/copy/strings';
import { useSession } from '@/state/session';
import styles from './RouteError.module.css';

type ErrorKind = 'not-found' | 'chunk' | 'other';

const CHUNK_MESSAGES = ['Failed to fetch dynamically imported module', 'Importing a module script failed'];

export function classifyRouteError(error: unknown): ErrorKind {
  if (isRouteErrorResponse(error) && error.status === 404) return 'not-found';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (CHUNK_MESSAGES.some((m) => message.includes(m))) return 'chunk';
  return 'other';
}

function reload(): void {
  window.location.reload();
}

export function RouteError() {
  const error = useRouteError();
  const google = useSession((s) => s.kind === 'google');
  const kind = classifyRouteError(error);

  useEffect(() => {
    if (kind !== 'not-found') console.error(error);
  }, [error, kind]);

  const homeLink = google ? (
    <LinkButton to="/" variant="primary">
      {ROUTE_ERROR.goToAsk}
    </LinkButton>
  ) : (
    <LinkButton to="/playground" variant="primary">
      {ROUTE_ERROR.openPlayground}
    </LinkButton>
  );

  return (
    <>
      <a className={styles.skip} href="#main">
        {SHELL.skipLink}
      </a>
      <header className={styles.header}>
        <Logo to="/" />
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {kind === 'not-found' ? (
          <>
            <h1 className={styles.title}>{ROUTE_ERROR.notFoundTitle}</h1>
            <div className={styles.actions}>{homeLink}</div>
          </>
        ) : kind === 'chunk' ? (
          <>
            <h1 className={styles.title}>{ROUTE_ERROR.updatedTitle}</h1>
            <p className={styles.body}>{ROUTE_ERROR.updatedBody}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={reload}>
                {ROUTE_ERROR.reload}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.title}>{ROUTE_ERROR.brokeTitle}</h1>
            <p className={styles.body}>{ROUTE_ERROR.brokeBody}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={reload}>
                {ROUTE_ERROR.reload}
              </Button>
              <LinkButton to="/" variant="secondary">
                {ROUTE_ERROR.goToAsk}
              </LinkButton>
            </div>
            {import.meta.env.DEV && error instanceof Error ? <pre className={styles.pre}>{error.message}</pre> : null}
          </>
        )}
      </main>
    </>
  );
}

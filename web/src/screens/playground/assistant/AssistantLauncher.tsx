// The Playground assistant's section on the Playground screen (00 D1): the one-line story and a button. The panel,
// the cloud assistant loop and the relay code load only when the person opens it (40 section 17.2); nothing connects
// until the first question. Once loaded, hiding the panel keeps the conversation and the link for this visit.
import { Suspense, lazy, useId, useState } from 'react';
import { Button } from '@/components/Button/Button';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { Spinner } from '@/components/Spinner/Spinner';
import { PLAYGROUND_ASSISTANT_COPY as COPY } from '@/copy/screens-main';
import styles from './launcher.module.css';

const AssistantPanel = lazy(() => import('./AssistantPanel').then((m) => ({ default: m.AssistantPanel })));

export function AssistantLauncher() {
  const headingId = useId();
  const panelId = useId();
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="playground-assistant">
      <div className={styles.head}>
        <div className={styles.text}>
          <h2 id={headingId} className={styles.heading}>
            {COPY.heading}
          </h2>
          <p className={styles.lead}>{COPY.lead}</p>
        </div>
        <div>
          <Button
            variant={open ? 'secondary' : 'primary'}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setLoaded(true);
              setOpen((v) => !v);
            }}
          >
            {open ? COPY.hide : COPY.open}
          </Button>
        </div>
      </div>
      <div id={panelId} hidden={!open}>
        {loaded ? (
          <ErrorBoundary>
            <Suspense
              fallback={
                <p className={styles.loading} role="status">
                  <Spinner size={16} labelled={false} />
                  <span>{COPY.loading}</span>
                </p>
              }
            >
              <AssistantPanel />
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </div>
    </section>
  );
}

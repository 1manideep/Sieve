// Prepare the on-device model (`/prepare?back=<path>`, 40 sections 13.2 and 16.18): one centred card with the
// click-started setup. "Back" goes to ?back= (default "/"; a signed-out person is sent on to Welcome from there).
import { Link, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Icon } from '@/components/icons';
import { ModelSetupPanel } from '@/components/ModelSetupPanel/ModelSetupPanel';
import { safePath } from '@/components/signIn';
import { TITLES } from '@/copy/strings';
import { PREPARE_COPY } from '@/copy/screens-main';
import styles from './prepare.module.css';

export function PrepareScreen() {
  const [params] = useSearchParams();
  const back = safePath(params.get('back'), '/ask');
  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to={back} className={styles.backLink}>
          <Icon name="chevron-right" size={16} className={styles.backIcon} />
          {PREPARE_COPY.back}
        </Link>
      </p>
      <div className={styles.card}>
        <ModelSetupPanel backHref={back} />
      </div>
    </div>
  );
}

export function Component() {
  useDocumentTitle(TITLES.prepare);
  return <PrepareScreen />;
}

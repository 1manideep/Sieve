// A 2px teal bar at the very top while a lazy route loads for more than 150 ms (40 section 5.2).
import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router-dom';
import styles from './RouteLoadingBar.module.css';

export const ROUTE_BAR_DELAY_MS = 150;

export function RouteLoadingBar() {
  const navigation = useNavigation();
  // One key per navigation, so a new navigation waits its own 150 ms.
  const key = navigation.state === 'loading' ? (navigation.location?.key ?? 'loading') : null;
  const [shownKey, setShownKey] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) return undefined;
    const timer = window.setTimeout(() => setShownKey(key), ROUTE_BAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  if (key === null || shownKey !== key) return null;
  return <div className={styles.bar} aria-hidden="true" />;
}

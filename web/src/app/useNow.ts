// The time, again every `everyMs` while the component is mounted: for lines that count (the waiting lines, the time
// left on auto-approve and on Gmail access).
import { useEffect, useState } from 'react';

export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

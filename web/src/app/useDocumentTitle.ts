// Sets the document title; prefixed with "({n}) " while requests wait (40 section 5.1).
import { useEffect } from 'react';
import { titleWithCount } from '@/copy/strings';
import { useHomeBase } from '@/state/homeBase';

export function useDocumentTitle(title: string): void {
  const waiting = useHomeBase((s) => s.awaitingCount);
  useEffect(() => {
    document.title = titleWithCount(title, waiting);
  }, [title, waiting]);
}

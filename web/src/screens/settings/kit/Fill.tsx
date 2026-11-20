// Fills a copy template with rich values, so names and quotes can sit in <bdi> inside Sieve's own sentences
// (70 R-UI-05) while the sentence itself stays exactly the copy in copy/screens-controls.ts.
import { Fragment, type ReactNode } from 'react';
import type { Placeholders } from '@/copy/screens-controls';

export interface FillProps<T extends string> {
  template: T;
  values: Record<Placeholders<T>, ReactNode>;
}

export function Fill<T extends string>({ template, values }: FillProps<T>) {
  const map = values as Record<string, ReactNode>;
  const parts = template.split(/(\{[A-Za-z]+\})/);
  return (
    <>
      {parts.map((part, i) => {
        const name = /^\{([A-Za-z]+)\}$/.exec(part)?.[1];
        return <Fragment key={i}>{name !== undefined && name in map ? map[name] : part}</Fragment>;
      })}
    </>
  );
}

/** Content from outside Sieve (names, titles, questions) inside one of Sieve's sentences. */
export function Iso({ children }: { children: ReactNode }) {
  return <bdi>{children}</bdi>;
}

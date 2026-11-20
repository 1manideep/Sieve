// Fill: renders a copy template with `{name}` placeholders, wrapping every inserted value in <bdi> so a
// right-to-left title or name cannot reorder Sieve's own sentence around it (70 R-UI-05).
import { Fragment, type ReactNode } from 'react';

export interface FillProps {
  template: string;
  values: Record<string, ReactNode>;
}

export function Fill({ template, values }: FillProps) {
  const parts = template.split(/(\{[A-Za-z]+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\{([A-Za-z]+)\}$/.exec(part);
        if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
          return <bdi key={i}>{values[match[1]]}</bdi>;
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

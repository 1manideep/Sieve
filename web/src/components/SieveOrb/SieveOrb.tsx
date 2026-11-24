// The thinking orb while Sieve works (Nov 24, 2026): thinking-orbs by Jakub Antalik (MIT,
// https://github.com/Jakubantalik/thinking-orbs), with its state picked from the step that is running, so the orb
// says what Sieve is doing: searching, reading and writing, or checking. Reduced motion shows a still frame (the
// package does this itself), and the orb is decoration beside a text label, so it is hidden from screen readers.
// Gemini blue, the accent of the rest of the app. Until its chunk arrives the box holds its place, empty.
import { lazy, Suspense } from 'react';
import type { OrbState } from 'thinking-orbs';
import type { TraceKind } from '@sieve/shared';

// Loaded on first use, so the package stays out of the JS that loads after sign-in (web/scripts/check-bundle.mjs).
const OrbCanvas = lazy(() => import('./OrbCanvas'));

export function orbStateFor(kind: TraceKind | undefined, checkingDraft = false): OrbState {
  if (checkingDraft) return 'solving';
  switch (kind) {
    case 'retrieve':
      return 'searching';
    case 'select':
    case 'answer':
    case 'excerpt':
    case 'draft':
      return 'composing';
    case 'clean':
    case 'pii':
    case 'injection':
      return 'solving';
    default:
      return 'working';
  }
}

export function SieveOrb({ kind, checkingDraft = false, size = 20, className }: {
  kind?: TraceKind; checkingDraft?: boolean; size?: 20 | 64; className?: string;
}) {
  return (
    <span className={className} aria-hidden="true" data-testid="thinking-orb" data-orb-state={orbStateFor(kind, checkingDraft)}>
      <Suspense fallback={null}>
        <OrbCanvas state={orbStateFor(kind, checkingDraft)} size={size} />
      </Suspense>
    </span>
  );
}

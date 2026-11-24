// The orb's canvas, in its own chunk: thinking-orbs loads only once something is thinking (SieveOrb.tsx).
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

export default function OrbCanvas({ state, size }: { state: OrbState; size: 20 | 64 }) {
  return <ThinkingOrb state={state} size={size} theme="dark" color="#8AB4F8" aria-hidden="true" />;
}

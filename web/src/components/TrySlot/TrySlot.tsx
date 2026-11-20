// "Try it on a real computer" (80 sections 1 and 7): the button component is built with the /try page in
// components/TryOnRealComputer. It is looked up by path so this screen builds before that folder exists; the
// component decides on its own whether to show (only while the demo computer answers its health check).
import type { ComponentType } from 'react';

type TryModule = { TryOnRealComputer?: ComponentType<Record<string, never>> };

const found = import.meta.glob<TryModule>('../TryOnRealComputer/TryOnRealComputer.tsx', { eager: true });
const TryOnRealComputer = Object.values(found)[0]?.TryOnRealComputer;

export function TrySlot() {
  return TryOnRealComputer ? <TryOnRealComputer /> : null;
}

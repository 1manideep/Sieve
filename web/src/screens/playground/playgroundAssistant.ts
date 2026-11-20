// The Playground's outside assistant (00 D1, 30 section 16): once the Playground has its one-day grant from
// issuePlaygroundGrant, this tab serves the assistant's requests (sources ['playground']) from the Playground database
// through usePlaygroundRelay, with this tab's port to the extension as the relay's bridge (50 section 11). The
// callable and the relay load lazily, so Firestore and Functions stay out of the /playground first load (40 section 17.2).
import { playgroundBridge } from '@/relay/playgroundBridge';

type Callables = typeof import('@/app/services/callables');

export interface PlaygroundAssistantSession {
  grant: Awaited<ReturnType<Callables['issuePlaygroundGrant']>>;
  stop(): void;
}

/** Gets the Playground grant, then starts serving its requests (once). Call it from the click that starts the assistant. */
export async function connectPlaygroundAssistant(uid: string): Promise<PlaygroundAssistantSession> {
  const [{ issuePlaygroundGrant }, { usePlaygroundRelay }] = await Promise.all([
    import('@/app/services/callables'),
    import('@/state/playgroundRelay'),
  ]);
  const grant = await issuePlaygroundGrant({});
  const stop = usePlaygroundRelay.getState().start(uid, playgroundBridge.makeEngineBridge);
  return { grant, stop };
}

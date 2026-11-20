// Live announcer (40 section 7.6). Two visually hidden regions read these values.
import { create } from 'zustand';

export type Politeness = 'polite' | 'assertive';

interface AnnouncerState {
  polite: string;
  assertive: string;
  announce(text: string, politeness?: Politeness): void;
}

export const useAnnouncer = create<AnnouncerState>()((set) => ({
  polite: '',
  assertive: '',
  announce(text, politeness = 'polite') {
    // Empty the region first, then set the text on the next frame, so a repeated message is read again.
    set({ [politeness]: '' } as Pick<AnnouncerState, Politeness>);
    const write = () => set({ [politeness]: text } as Pick<AnnouncerState, Politeness>);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(write);
    else setTimeout(write, 0);
  },
}));

export function announce(text: string, politeness: Politeness = 'polite'): void {
  useAnnouncer.getState().announce(text, politeness);
}

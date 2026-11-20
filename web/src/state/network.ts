// useNetwork (40 section 9.4): navigator.onLine and the online / offline events.
import { create } from 'zustand';

interface NetworkState {
  online: boolean;
  start(): () => void;
}

export const useNetwork = create<NetworkState>()((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  start() {
    const update = () => set({ online: navigator.onLine });
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  },
}));

// AppShell (40 section 7.1): skip link, the routed page, toasts, live announcer, dialog host, scroll restoration
// and the route loading bar, and the "updated in another tab" banner (70 R-PLAT-09). On mount it starts useNetwork and useAvailability.
import { useEffect } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { DialogHost } from '@/components/DialogHost/DialogHost';
import { LiveAnnouncer } from '@/components/LiveAnnouncer/LiveAnnouncer';
import { NarrowNotice } from '@/components/NarrowNotice/NarrowNotice';
import { RouteLoadingBar } from '@/components/RouteLoadingBar/RouteLoadingBar';
import { TabClosedBanner } from '@/components/TabClosedBanner/TabClosedBanner';
import { ToastRegion } from '@/components/ToastRegion/ToastRegion';
import { SHELL } from '@/copy/strings';
import { loadAi, useAvailability } from '@/state/availability';
import { useNetwork } from '@/state/network';
import styles from './AppShell.module.css';

/**
 * User activation (40 section 9.3): on the first pointerdown or keydown, warm the on-device model if it is already
 * available. A downloadable model is only set up from the explicit "Start setup" button, never from a random click.
 */
function useFirstInteractionWarmUp(): void {
  useEffect(() => {
    const onFirst = () => {
      window.removeEventListener('pointerdown', onFirst, true);
      window.removeEventListener('keydown', onFirst, true);
      if (useAvailability.getState().text !== 'available') return;
      loadAi()
        .then((ai) => ai.downloadNano())
        .catch((error: unknown) => console.error(error));
    };
    window.addEventListener('pointerdown', onFirst, true);
    window.addEventListener('keydown', onFirst, true);
    return () => {
      window.removeEventListener('pointerdown', onFirst, true);
      window.removeEventListener('keydown', onFirst, true);
    };
  }, []);
}

export function AppShell() {
  useEffect(() => useNetwork.getState().start(), []);
  useEffect(() => useAvailability.getState().start(), []);
  useFirstInteractionWarmUp();

  return (
    <>
      <a className={styles.skip} href="#main">
        {SHELL.skipLink}
      </a>
      <RouteLoadingBar />
      <NarrowNotice />
      <TabClosedBanner />
      <Outlet />
      <ToastRegion />
      <LiveAnnouncer />
      <DialogHost />
      <ScrollRestoration />
    </>
  );
}

// DeviceFrame (40 section 16.16): the Playground's pretend computer, without window chrome in the final design. A
// quiet toolbar row (the label and the model toggle), an optional status strip (13.2a setup strip) and the content.
// controlsAt="bottom" puts the toolbar and the strip under the content, as one quiet glass bar, so the page opens on
// the headline and the prompt card (F2).
import type { ReactNode } from 'react';
import { DEVICE_FRAME_COPY } from '@/copy/screens-main';
import styles from './DeviceFrame.module.css';

export interface DeviceFrameProps {
  label: string;
  toolbar?: ReactNode;
  strip?: ReactNode;
  children: ReactNode;
  controlsAt?: 'top' | 'bottom';
}

export function DeviceFrame({ label, toolbar, strip, children, controlsAt = 'top' }: DeviceFrameProps) {
  const controls = (
    <>
      <div className={styles.toolbar}>
        <p className={styles.label}>{label}</p>
        {toolbar ? <div className={styles.tools}>{toolbar}</div> : null}
      </div>
      {strip ? <div className={styles.strip}>{strip}</div> : null}
    </>
  );
  return (
    <section className={styles.bezel} role="region" aria-label={DEVICE_FRAME_COPY.region}>
      <div className={styles.screen}>
        {controlsAt === 'top' ? controls : null}
        <div className={styles.windows}>{children}</div>
        {controlsAt === 'bottom' ? <div className={styles.bar}>{controls}</div> : null}
      </div>
    </section>
  );
}

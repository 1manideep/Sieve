// DeviceFrame (40 section 16.16): the Playground's pretend computer. A bezel, a toolbar row, an optional status
// strip (13.2a setup strip) and a wrapping row of windows.
import type { ReactNode } from 'react';
import { DEVICE_FRAME_COPY } from '@/copy/screens-main';
import styles from './DeviceFrame.module.css';

export interface DeviceFrameProps {
  label: string;
  toolbar?: ReactNode;
  strip?: ReactNode;
  children: ReactNode;
}

export function DeviceFrame({ label, toolbar, strip, children }: DeviceFrameProps) {
  return (
    <section className={styles.bezel} role="region" aria-label={DEVICE_FRAME_COPY.region}>
      <div className={styles.screen}>
        <div className={styles.toolbar}>
          <p className={styles.label}>{label}</p>
          {toolbar ? <div className={styles.tools}>{toolbar}</div> : null}
        </div>
        {strip ? <div className={styles.strip}>{strip}</div> : null}
        <div className={styles.windows}>{children}</div>
      </div>
    </section>
  );
}

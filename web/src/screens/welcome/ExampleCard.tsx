// ExampleCard (40 section 13.1): a static illustration of one share. role="img" with a label; nothing in it is
// interactive. The request comes from Gemini CLI (00 D2: no third-party assistant on screen).
import { WELCOME_COPY } from '@/copy/screens-main';
import { Tag } from '@/components/Tag/Tag';
import styles from './welcome.module.css';

export function ExampleCard() {
  return (
    <div className={styles.example} role="img" aria-label={WELCOME_COPY.exampleLabel}>
      <p className={styles.exampleEyebrow}>{WELCOME_COPY.exampleEyebrow}</p>
      <p className={styles.exampleRequest}>{WELCOME_COPY.exampleRequest}</p>
      <div className={styles.exampleLadder}>
        {WELCOME_COPY.exampleSteps.map((step, i) => (
          <span key={step} className={i === 0 ? `${styles.exampleStep} ${styles.exampleStepOn}` : styles.exampleStep}>
            {step}
          </span>
        ))}
      </div>
      <div className={styles.examplePreview}>
        <p className={styles.examplePreviewLabel}>{WELCOME_COPY.examplePreviewLabel}</p>
        <p className={styles.examplePreviewText}>{WELCOME_COPY.examplePreview}</p>
      </div>
      <div className={styles.exampleTags}>
        <Tag tone="device">{WELCOME_COPY.exampleDeviceTag}</Tag>
        <Tag tone="muted">{WELCOME_COPY.exampleChars}</Tag>
      </div>
    </div>
  );
}

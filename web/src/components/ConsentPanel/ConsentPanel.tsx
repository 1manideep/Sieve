// ConsentPanel (40 section 16.13): asks before the cloud model reads one of the person's own items, and shows the
// exact text it would read when the pipeline could build it.
import { useId, useState } from 'react';
import type { Proposal, StepOption } from '@sieve/shared';
import { CONSENT_COPY, OUTGOING_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import { Fill } from '../Fill/Fill';
import { Icon } from '../icons';
import { OutgoingPreview } from '../OutgoingPreview/OutgoingPreview';
import styles from './ConsentPanel.module.css';

export interface ConsentPanelProps {
  variant: 'own' | 'playground-upload' | 'relay';
  item: NonNullable<Proposal['item']>;
  fullOption?: StepOption;            // options[2] when available
  busy?: boolean;
  onAllow(): void;
  onDecline(): void;
}

export function ConsentPanel({ variant, item, fullOption, busy = false, onAllow, onDecline }: ConsentPanelProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const previewId = useId();
  const usable = fullOption && fullOption.available && fullOption.text !== '' ? fullOption : undefined;
  return (
    <section className={styles.panel} aria-labelledby={`${regionId}-title`}>
      <h3 id={`${regionId}-title`} className={styles.title}>
        {CONSENT_COPY.title}
      </h3>
      <p className={styles.body}>
        <Fill template={variant === 'playground-upload' ? CONSENT_COPY.bodyUpload : CONSENT_COPY.bodyOwn} values={{ title: item.title }} />
      </p>
      <div>
        <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
          {CONSENT_COPY.showText}
        </button>
      </div>
      <div id={regionId} hidden={!open}>
        {usable ? (
          <OutgoingPreview id={previewId} label={OUTGOING_COPY.labelConsent} option={usable} />
        ) : (
          <p className={styles.noText}>{CONSENT_COPY.noText}</p>
        )}
      </div>
      <div className={styles.buttons}>
        <Button variant={variant === 'relay' ? 'danger' : 'secondary'} onClick={onDecline} disabled={busy}>
          {variant === 'relay' ? CONSENT_COPY.deny : CONSENT_COPY.notNow}
        </Button>
        <Button variant="primary" onClick={onAllow} busy={busy} disabled={busy}>
          {variant === 'playground-upload' ? CONSENT_COPY.allowFile : CONSENT_COPY.allowItem}
        </Button>
      </div>
    </section>
  );
}

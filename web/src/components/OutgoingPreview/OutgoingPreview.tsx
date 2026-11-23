// OutgoingPreview (40 section 16.5): the exact outgoing text, rendered from option.text and nothing else
// (40 section 1.2: what the person sees is what is sent).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sharedFileSize, type SharedImage, type StepOption } from '@sieve/shared';
import { formatCount } from '@/copy/format';
import { OUTGOING_COPY, fill } from '@/copy/screens-main';
import { RedactedText } from '../RedactedText/RedactedText';
import styles from './OutgoingPreview.module.css';

export interface OutgoingPreviewProps {
  id: string;
  label: string;          // "What would leave this device" | "Exactly what {aiName} would receive" | "What the cloud model would read"
  option: StepOption;     // composed; option.text is rendered exactly, through RedactedText
  instruction?: string;   // in-app: rendered as a second block
  overLimit?: boolean;
  /** Leave out the characters-and-redactions line (the gate shows it next to its buttons instead). */
  hideFooter?: boolean;
}

/** The shared photo comes as base64 JPEG (re-encoded on the device, no EXIF); show it through an object URL. */
function SharedPhoto({ image }: { image: SharedImage }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof URL.createObjectURL !== 'function') return undefined;
    const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
    el.src = objectUrl;
    return () => {
      el.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
  }, [image]);
  return <img ref={ref} className={styles.image} alt={OUTGOING_COPY.imageAlt} width={image.width} height={image.height} />;
}

export function footerText(option: StepOption, instruction?: string): string {
  // a file is not text: its size, and the plain fact that nothing in it was masked (never "No personal details found")
  if (option.file) return fill(OUTGOING_COPY.fileFooter, { size: sharedFileSize(option.file.bytes) });
  const parts = [fill(OUTGOING_COPY.chars, { chars: formatCount(option.chars) })];
  parts.push(
    option.redactions === 0
      ? OUTGOING_COPY.noRedactions
      : option.redactions === 1
        ? OUTGOING_COPY.redactionsOne
        : fill(OUTGOING_COPY.redactionsMany, { n: formatCount(option.redactions) }),
  );
  if (instruction !== undefined) parts.push(fill(OUTGOING_COPY.total, { n: formatCount(option.chars + instruction.length) }));
  return parts.join(' · ');
}

export function OutgoingPreview({ id, label, option, instruction, overLimit = false, hideFooter = false }: OutgoingPreviewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrolls(el.scrollHeight > el.clientHeight + 1);
  }, [option.text]);

  return (
    <section id={id} role="region" aria-label={label} className={styles.preview}>
      <p className={styles.label} aria-hidden="true">
        {label}
      </p>
      <div ref={scrollRef} className={styles.scroll} tabIndex={scrolls ? 0 : undefined}>
        <p className={styles.text} data-testid="outgoing-text">
          <RedactedText text={option.text} />
        </p>
        {option.image ? <SharedPhoto image={option.image} /> : null}
        {option.file ? <p className={styles.over}>{OUTGOING_COPY.fileNote}</p> : null}
      </div>
      {instruction !== undefined ? (
        <div className={styles.instruction}>
          <p className={styles.label}>{OUTGOING_COPY.plusInstruction}</p>
          <p className={styles.instructionText} dir="auto" data-testid="outgoing-instruction">
            “{instruction}”
          </p>
        </div>
      ) : null}
      {hideFooter ? null : <p className={styles.footer}>{footerText(option, instruction)}</p>}
      {overLimit ? <p className={styles.over}>{OUTGOING_COPY.overLimit}</p> : null}
    </section>
  );
}

// AssistantMark: an assistant's mark, drawn large and plain (no disc, no ring), in colour when it is connected and
// grey when it is not (Settings, Seen and Requests). The Gemini gradient is defined inside each mark that uses it.
import { ASSISTANTS, type AssistantKind } from './assistants';
import styles from './AssistantMark.module.css';

export interface AssistantMarkProps {
  kind: AssistantKind;
  /** The mark's size in px: 24 in lists, 44 in the Settings row. */
  size?: number;
  /** Grey when false. */
  live?: boolean;
  className?: string;
}

export function AssistantMark({ kind, size = 24, live = true, className }: AssistantMarkProps) {
  const a = ASSISTANTS[kind];
  const gradientId = `assistant-mark-gemini-${size}`;
  const badge = Math.max(14, Math.round(size * 0.45));
  return (
    <span className={[styles.mark, live ? '' : styles.dim, className ?? ''].filter(Boolean).join(' ')} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24">
        {a.fill.startsWith('url(') ? (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#4F8BFF" />
              <stop offset="0.55" stopColor="#8E7CF8" />
              <stop offset="1" stopColor="#C084FC" />
            </linearGradient>
          </defs>
        ) : null}
        <path
          d={a.d}
          fill={a.fill.startsWith('url(') ? `url(#${gradientId})` : a.fill}
          stroke={a.stroke}
          strokeWidth={a.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {a.terminal ? (
        <span className={styles.terminal} style={{ width: badge, height: badge }}>
          <svg width={Math.round(badge * 0.62)} height={Math.round(badge * 0.62)} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7l5 5-5 5M12.5 17H19" />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

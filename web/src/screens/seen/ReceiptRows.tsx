// ReceiptRows (40 section 13.7; design handoff of Nov 20, 2026): the receipts as rows on the ground, grouped by
// day. A row names who asked, what was asked, the item, the step, the characters that left, who decided and when;
// pressed, it opens in place with what left, where it came from, what happened step by step, and Revoke. A receipt
// never holds the text that left, so the row shows the question and the count, not the answer.
import { useState, type ReactNode } from 'react';
import { LADDER_LABELS, sharedFileSize } from '@sieve/shared';
import { AssistantMark } from '@/components/AssistantMark/AssistantMark';
import { assistantKindOf } from '@/components/AssistantMark/assistants';
import { CategoryIcon } from '@/components/CategoryIcon/CategoryIcon';
import { Tag, type TagTone } from '@/components/Tag/Tag';
import { SEEN, SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import { isShared, useReceipts } from '@/state/receipts';
import type { RecordMeta } from '@/state/records';
import { useToasts } from '@/state/toasts';
import type { ReceiptView } from '@/state/types';
import { Confirm } from '../settings/kit/Confirm';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';
import { dayOf, formatClock, formatDate, formatDayHeading, isoTime } from '../settings/kit/when';
import styles from './seen.module.css';

type Meta = Record<string, RecordMeta | null>;

export interface DayGroup { day: number; label: string; rows: ReceiptView[]; chars: number }

/** Newest day first; the rows keep their order (newest first). */
export function groupByDay(receipts: ReceiptView[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const r of receipts) {
    const day = dayOf(r.createdAt);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, label: formatDayHeading(r.createdAt, now), rows: [], chars: 0 };
      groups.push(g);
    }
    g.rows.push(r);
    if (isShared(r)) g.chars += r.chars;
  }
  return groups.sort((a, b) => b.day - a.day);
}

function titleOf(meta: Meta, id: string | undefined): string {
  if (id === undefined) return SEEN.missingTitle;
  const m = meta[id];
  if (m === undefined) return SEEN.loadingTitle;
  return m === null ? SEEN.missingTitle : m.title;
}

function categoryOf(meta: Meta, r: ReceiptView) {
  return r.itemIds[0] ? meta[r.itemIds[0]]?.category : undefined;
}

/** The row's line: the question for a share, the reason when nothing left. */
export function lineOf(r: ReceiptView, meta: Meta): string {
  if (r.status === 'declined') return SEEN.declinedWhat;
  if (r.status === 'blocked') {
    const category = categoryOf(meta, r);
    return category ? fillText(SEEN.blockedWhat, { category }) : SEEN.blockedWhatUnknown;
  }
  if (r.status === 'expired') return SEEN.expiredWhat;
  return `"${r.question}"`;
}

/** Who decided, in the row's own column. */
export function byOf(r: ReceiptView, auto: boolean, revoked: boolean): string {
  if (revoked || r.status === 'revoked') return SEEN.statusRevoked;
  if (r.status === 'declined') return SEEN.byDeclined;
  if (r.status === 'blocked' || r.decidedBy === 'rule') return SEEN.byRule;
  if (r.status === 'expired') return SEEN.byExpired;
  if (r.decidedBy === 'extension') return SEEN.byExtension;
  return auto ? SEEN.byAuto : SEEN.byApp;
}

/** Whether a receipt matches the search words: its question, its items' titles and categories, and who asked. */
export function matchesQuery(r: ReceiptView, meta: Meta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const items = r.itemIds.map((id) => {
    const m = meta[id];
    return m ? `${m.title} ${m.category}` : '';
  });
  return `${r.question} ${r.requester.aiName} ${items.join(' ')}`.toLowerCase().includes(q);
}

function Step({ label, detail, tone, badge, dot }: { label: string; detail: string; tone: TagTone; badge: string; dot?: string }) {
  return (
    <li className={ground.traceStep}>
      <span className={ground.traceDot} style={dot ? { background: dot } : undefined} aria-hidden="true" />
      <span className={ground.traceText}>
        <span>{label}</span>
        <span>{detail}</span>
      </span>
      <Tag tone={tone}>{badge}</Tag>
    </li>
  );
}

/** What is known of a receipt's path: the rule that stopped it, who decided, and whether it was delivered. */
function Trace({ r, meta, auto, revoked }: { r: ReceiptView; meta: Meta; auto: boolean; revoked: boolean }) {
  const aiName = r.requester.aiName;
  const steps: ReactNode[] = [];
  if (r.status === 'blocked') {
    const category = categoryOf(meta, r);
    steps.push(
      <Step key="rule" label={SEEN.traceRule} detail={category ? fillText(SEEN.traceRuleNever, { category }) : SEEN.traceRuleNeverUnknown} tone="never" badge={SEEN.badgeRule} dot="#F28B82" />,
    );
  } else if (r.status === 'declined') {
    steps.push(<Step key="no" label={SEEN.traceDeclined} detail={SEEN.traceDeclinedDetail} tone="muted" badge={SEEN.badgeYou} dot="rgba(255,255,255,.7)" />);
  } else {
    if (auto) {
      steps.push(<Step key="auto" label={SEEN.traceAuto} detail={fillText(SEEN.traceAutoDetail, { aiName })} tone="muted" badge={SEEN.badgeYou} dot="#8AB4F8" />);
    } else {
      steps.push(
        <Step key="yes" label={SEEN.traceApproved} detail={r.decidedBy === 'extension' ? SEEN.traceApprovedExtension : SEEN.traceApprovedApp} tone="muted" badge={SEEN.badgeYou} dot="#FFFFFF" />,
      );
    }
    const cloud = fillText(SEEN.badgeCloud, { aiName });
    if (r.status === 'expired') {
      steps.push(<Step key="end" label={SEEN.traceExpired} detail={SEEN.traceExpiredDetail} tone="muted" badge={SEEN.badgeYou} dot="rgba(255,255,255,.6)" />);
    } else if (r.status === 'pending-collection' && !revoked) {
      steps.push(<Step key="end" label={SEEN.tracePending} detail={fillText(SEEN.tracePendingDetail, { aiName })} tone="cloud" badge={cloud} dot="#8AB4F8" />);
    } else {
      steps.push(
        <Step key="end" label={SEEN.traceDelivered} detail={fillText(SEEN.traceDeliveredDetail, { chars: formatCount(r.chars), aiName })} tone="cloud" badge={cloud} dot="#8AB4F8" />,
      );
    }
    if (revoked || r.status === 'revoked') {
      steps.push(<Step key="revoked" label={SEEN.traceRevoked} detail={fillText(SEEN.traceRevokedDetail, { aiName })} tone="muted" badge={SEEN.badgeYou} dot="rgba(255,255,255,.7)" />);
    }
  }
  return <ol className={ground.trace}>{steps}</ol>;
}

function Detail({ r, meta, now, auto, revoked, onRevoke, id }: { r: ReceiptView; meta: Meta; now: number; auto: boolean; revoked: boolean; onRevoke?: () => void; id: string }) {
  const aiName = r.requester.aiName;
  const shared = isShared(r);
  const category = categoryOf(meta, r);
  const when = `${formatDate(r.createdAt, now)}, ${formatClock(r.createdAt)}`;
  let left: string;
  let quote = ground.quote;
  if (shared) {
    const chars = formatCount(r.chars);
    left = r.fileBytes
      ? fillText(SEEN.leftFile, { size: sharedFileSize(r.fileBytes) })
      : fillText(r.step === 'full' ? SEEN.leftFull : r.step === 'excerpt' ? SEEN.leftExcerpt : SEEN.leftAnswer, { chars });
  } else if (r.status === 'blocked') {
    left = category ? fillText(SEEN.nothingBlocked, { category }) : SEEN.nothingBlockedUnknown;
    quote = `${ground.quote} ${ground.quoteNever}`;
  } else {
    left = fillText(r.status === 'declined' ? SEEN.nothingDeclined : SEEN.nothingExpired, { aiName });
    quote = `${ground.quote} ${ground.quoteNone}`;
  }
  return (
    <div id={id} role="region" aria-label={fillText(SEEN.receiptRegion, { aiName, time: formatClock(r.createdAt) })} className={ground.open}>
      <div className={ground.openCol}>
        <p className={ground.label}>
          <bdi>{fillText(r.requester.kind === 'outside' ? SEEN.askedOutside : SEEN.askedInApp, { aiName, when })}</bdi>
        </p>
        <p className={styles.question} dir="auto">
          “{r.question}”
        </p>
        <div className={ground.grp}>
          <span className={ground.label}>{SEEN.whatLeft}</span>
          <p className={quote}>{left}</p>
          <p className={ground.metaLine}>{shared ? `${SEEN.leftKept} · ${byOf(r, auto, revoked)}` : SEEN.nothingLeftMeta}</p>
        </div>
        {r.itemIds.length > 0 ? (
          <div className={ground.grp}>
            <span className={ground.label}>{SEEN.fromLabel}</span>
            <ul className={styles.fromList}>
              {r.itemIds.slice(0, 3).map((itemId) => {
                const m = meta[itemId];
                return (
                  <li key={itemId} className={styles.from}>
                    {m ? <CategoryIcon category={m.category} size={24} never={r.status === 'blocked'} /> : null}
                    <span className={styles.fromText}>
                      <bdi>{titleOf(meta, itemId)}</bdi>
                      {m ? <span>{`${SOURCES.names[m.source as keyof typeof SOURCES.names] ?? m.source} · ${formatDate(m.date, now)} · ${m.category}`}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {r.itemIds.length > 3 ? <p className={ground.metaLine}>{fillText(SEEN.moreItems, { n: formatCount(r.itemIds.length - 3) })}</p> : null}
          </div>
        ) : null}
      </div>
      <div className={ground.openCol}>
        <span className={ground.label}>{SEEN.traceHeading}</span>
        <Trace r={r} meta={meta} auto={auto} revoked={revoked} />
        <div className={styles.foot}>
          {onRevoke ? (
            <button type="button" className={`${kit.textButton} ${kit.never}`} onClick={onRevoke}>
              {fillText(SEEN.revokeLabel, { aiName })}
            </button>
          ) : null}
          <p className={kit.help}>{SEEN.note}</p>
        </div>
      </div>
    </div>
  );
}

export interface ReceiptRowsProps {
  receipts: ReceiptView[];
  meta: Meta;
  now: number;
  /** Receipt ids this computer approved automatically (40 section 13.8.9). */
  autoApproved?: ReadonlySet<string>;
}

export function ReceiptRows({ receipts, meta, now, autoApproved }: ReceiptRowsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReceiptView | null>(null);
  const [revokedIds, setRevokedIds] = useState<string[]>([]);

  const revoke = async (receipt: ReceiptView) => {
    const aiName = receipt.requester.aiName;
    try {
      await useReceipts.getState().revoke(receipt.id);
      setRevokedIds((ids) => [...ids, receipt.id]);
      useToasts.getState().push({ tone: 'success', title: fillText(SEEN.revokeDone, { aiName }) });
    } catch (error) {
      console.error(error);
      useToasts.getState().push({ tone: 'error', title: SEEN.revokeFailed });
    }
    setConfirming(null);
  };

  return (
    <section aria-label={SEEN.listLabel}>
      {groupByDay(receipts, now).map((group) => (
        <div key={group.day}>
          <div className={ground.dayHead}>
            <h2 className={ground.dayLabel}>{group.label}</h2>
            <span className={ground.daySum}>
              {group.rows.length === 1
                ? fillText(SEEN.daySumOne, { chars: formatCount(group.chars) })
                : fillText(SEEN.daySum, { n: formatCount(group.rows.length), chars: formatCount(group.chars) })}
            </span>
          </div>
          {group.rows.map((r) => {
            const shared = isShared(r);
            const outside = r.requester.kind === 'outside';
            const revoked = outside && (r.status === 'revoked' || revokedIds.includes(r.id));
            const revocable = outside && !revoked && (r.status === 'delivered' || r.status === 'pending-collection');
            const auto = autoApproved?.has(r.id) === true;
            const open = openId === r.id;
            const panelId = `receipt-${r.id}`;
            const category = categoryOf(meta, r);
            const by = byOf(r, auto, revoked);
            const tone = r.status === 'blocked' ? kit.never : r.status === 'declined' || r.status === 'expired' ? kit.muted : '';
            return (
              <div key={r.id} data-status={r.status}>
                <button type="button" className={styles.rc} aria-expanded={open} aria-controls={panelId} onClick={() => setOpenId(open ? null : r.id)}>
                  <AssistantMark kind={assistantKindOf(r.requester.aiName)} size={26} />
                  <span className={`${styles.line} ${tone}`} dir="auto">
                    <span className="visually-hidden">
                      <bdi>{r.requester.aiName}</bdi>:{' '}
                    </span>
                    {lineOf(r, meta)}
                  </span>
                  <span className={styles.item}>
                    {category ? <CategoryIcon category={category} never={r.status === 'blocked'} /> : null}
                    <bdi className={styles.itemTitle}>{titleOf(meta, r.itemIds[0])}</bdi>
                  </span>
                  <span className={styles.step}>{shared ? LADDER_LABELS[r.step ?? 'answer'] : SEEN.stepNothing}</span>
                  <span className={shared ? styles.chars : `${styles.chars} ${kit.muted}`}>
                    <span aria-hidden="true">{shared ? formatCount(r.chars) : '0'}</span>
                    <span className="visually-hidden">{shared ? fillText(SEEN.charsLeft, { chars: formatCount(r.chars) }) : SEEN.nothingLeft}</span>
                  </span>
                  <span className={`${styles.by} ${auto && shared && !revoked ? kit.accent : r.status === 'blocked' ? kit.never : ''}`}>{by}</span>
                  <time className={styles.time} dateTime={isoTime(r.createdAt)}>
                    {formatClock(r.createdAt)}
                  </time>
                </button>
                {open ? <Detail id={panelId} r={r} meta={meta} now={now} auto={auto} revoked={revoked} onRevoke={revocable ? () => setConfirming(r) : undefined} /> : null}
              </div>
            );
          })}
        </div>
      ))}
      <Confirm
        open={confirming !== null}
        title={fillText(SEEN.revokeTitle, { aiName: confirming?.requester.aiName ?? '' })}
        body={fillText(SEEN.revokeBody, { aiName: confirming?.requester.aiName ?? '' })}
        confirmLabel={SEEN.revokeConfirm}
        tone="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={() => (confirming ? revoke(confirming) : undefined)}
      />
    </section>
  );
}

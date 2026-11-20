// RequestDetail (40 section 13.5): the blue request header, then PreparingCard while the home base works, then
// ApprovalCard variant="relay" with RelayResult after the decision.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LADDER_LABELS, MAX_PAYLOAD_CHARS, stepPhrase, type LadderStep } from '@sieve/shared';
import { ApprovalCard } from '@/components/ApprovalCard/ApprovalCard';
import { composeOptions, startingStep } from '@/components/ApprovalCard/composedOptions';
import { ItemViewer } from '@/components/ItemViewer/ItemViewer';
import { Notice } from '@/components/Notice/Notice';
import { PreparingCard } from '@/components/PreparingCard/PreparingCard';
import { RelayResult } from '@/components/RelayResult/RelayResult';
import { Tag } from '@/components/Tag/Tag';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import { composeOutgoingText } from '@/pipeline';
import { useHomeBase, type HomeBaseState, type PendingEntry } from '@/state/homeBase';
import { useNetwork } from '@/state/network';
import { useRecords } from '@/state/records';
import { Fill, Iso } from '../settings/kit/Fill';
import { formatClock, isoTime } from '../settings/kit/when';
import { phaseTag } from './PendingList';
import styles from './requests.module.css';

/**
 * Stop on a relay PreparingCard (40 section 12.4 point 5). Contract change request: the store gains
 * `stopPreparing(requestId)`; until then the button has nothing to stop.
 */
type WithStop = HomeBaseState & { stopPreparing?: (requestId: string) => Promise<void> };

function cardPhase(entry: PendingEntry): 'open' | 'deciding' | 'decided' {
  if (entry.phase === 'deciding') return 'deciding';
  if (entry.phase === 'done') return 'decided';
  return 'open';
}

export function RequestDetail({ entry }: { entry: PendingEntry }) {
  const { request, proposal } = entry;
  const aiName = request.requester.aiName;
  const online = useNetwork((s) => s.online);
  const meta = useRecords((s) => s.meta);
  const [chosen, setChosen] = useState<LadderStep | undefined>(undefined);
  const [busy, setBusy] = useState<'approve' | 'deny' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [viewer, setViewer] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const hadResult = useRef(entry.result !== undefined);

  // 40 section 11.10: the main options with each ticked related item that is ready, composed by the pipeline.
  const options = useMemo(() => {
    if (!proposal) return [];
    const related = entry.relatedSelected
      .map((id) => entry.relatedOptions[id])
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    return composeOptions(proposal.options, related, composeOutgoingText);
  }, [proposal, entry.relatedSelected, entry.relatedOptions]);
  const step = startingStep(options, chosen ?? request.requestedStep);
  const option = options.find((o) => o.step === step);

  const ids = useMemo(() => {
    if (!proposal) return [];
    return [proposal.item?.recordId, ...proposal.related.map((c) => c.recordId)].filter((id): id is string => Boolean(id));
  }, [proposal]);
  useEffect(() => {
    if (ids.length > 0) useRecords.getState().ensure('real', ids).catch(console.error);
  }, [ids]);

  // After a decision, focus moves to the result line (40 section 14.1). ApprovalCard does it when it is shown; an
  // automatic result (blocked, no match, error) has no card, so it is done here.
  useEffect(() => {
    if (entry.result && !hadResult.current && !proposal) {
      resultRef.current?.querySelector<HTMLElement>('[data-result-line]')?.focus();
    }
    hadResult.current = entry.result !== undefined;
  }, [entry.result, proposal]);

  const decide = async (approved: boolean) => {
    setBusy(approved ? 'approve' : 'deny');
    setError(undefined);
    try {
      const result = await useHomeBase.getState().decide({
        requestId: entry.requestId,
        approved,
        step: approved ? step : undefined,
        decidedBy: 'app',
      });
      if (!result.ok) setError(result.message);
    } catch (e) {
      console.error(e);
      setError(REQUESTS.decideFailed);
    } finally {
      setBusy(undefined);
    }
  };

  const related = entry.relatedSelected.length;
  const blockedReason = !online
    ? REQUESTS.blockedOffline
    : entry.relatedLoading.length > 0
      ? REQUESTS.blockedLoading
      : option && option.chars > MAX_PAYLOAD_CHARS
        ? REQUESTS.blockedTooLong
        : !option?.available
          ? REQUESTS.blockedStep
          : undefined;
  const phrase =
    entry.result?.kind === 'sent'
      ? stepPhrase(entry.result.step, proposal?.item?.kind, entry.result.itemCount)
      : stepPhrase(step, proposal?.item?.kind, 1 + related);

  const result = entry.result ? (
    <div ref={resultRef}>
      <RelayResult
        result={entry.result}
        aiName={aiName}
        stepPhrase={phrase}
        category={proposal?.item?.category}
        onDone={() => useHomeBase.getState().dismissDone(entry.requestId)}
      />
    </div>
  ) : undefined;

  const tag = phaseTag(entry);
  const preparing = entry.phase === 'claiming' || entry.phase === 'preparing';

  return (
    <section className={styles.detail} aria-label={fillText(REQUESTS.detailLabel, { aiName })}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <p className={styles.eyebrow}>
            <Fill
              template={REQUESTS.eyebrow}
              values={{
                aiName: <Iso>{aiName}</Iso>,
                time: <time dateTime={isoTime(request.createdAt)}>{formatClock(request.createdAt)}</time>,
              }}
            />
          </p>
          <figure className={styles.quote}>
            <figcaption className={styles.quoteLabel}>
              <Fill template={REQUESTS.asks} values={{ aiName: <Iso>{aiName}</Iso> }} />
            </figcaption>
            <blockquote className={styles.question} dir="auto">
              <Fill template={REQUESTS.quoted} values={{ question: <Iso>{request.question}</Iso> }} />
            </blockquote>
          </figure>
          <p className={styles.askedFor}>
            <Fill
              template={REQUESTS.askedFor}
              values={{
                requested: LADDER_LABELS[request.requestedStep],
                aiName: <Iso>{aiName}</Iso>,
                max: LADDER_LABELS[request.maxStep],
              }}
            />
          </p>
        </div>
        <div className={styles.headerTag}>
          <Tag tone={tag.tone}>{tag.label}</Tag>
        </div>
      </div>

      {error ? (
        <div role="status">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}

      {preparing ? (
        <PreparingCard
          liveSteps={entry.liveSteps}
          answerPreview={entry.answerPreview}
          startedAt={entry.liveSteps[0]?.startedAt ?? request.claimedAt ?? request.createdAt}
          onStop={() => {
            const stop = (useHomeBase.getState() as WithStop).stopPreparing;
            if (stop) stop(entry.requestId).catch(console.error);
          }}
          progressSupported
        />
      ) : proposal ? (
        <ApprovalCard
          variant="relay"
          proposal={proposal}
          aiName={aiName}
          meta={meta}
          step={step}
          onStepChange={setChosen}
          composedOptions={options}
          relatedSelected={entry.relatedSelected}
          relatedLoading={entry.relatedLoading}
          onToggleRelated={(id) => {
            useHomeBase.getState().toggleRelated(entry.requestId, id).catch(console.error);
          }}
          phase={cardPhase(entry)}
          canApprove={entry.phase === 'awaiting-person' && blockedReason === undefined && busy === undefined}
          approveBlockedReason={blockedReason}
          onApprove={() => void decide(true)}
          onDeny={() => void decide(false)}
          onAllowCloud={(recordId) => {
            useHomeBase.getState().allowCloudFor(entry.requestId, recordId).catch(console.error);
          }}
          onOpenItem={setViewer}
          resultSlot={result}
        />
      ) : (
        result
      )}

      <ItemViewer dbKind="real" recordId={viewer} onClose={() => setViewer(null)} />
    </section>
  );
}

// "Sieve on this device": the Playground relay's requests from Gemini in the cloud (30 section 16). Each request is
// prepared on this device from the sample data and waits here for the person, exactly as on the Requests screen:
// PreparingCard while it works, then ApprovalCard variant="relay", then the result line.
import { useEffect, useId, useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { MAX_PAYLOAD_CHARS, stepPhrase, type LadderStep } from '@sieve/shared';
import { ApprovalCard } from '@/components/ApprovalCard/ApprovalCard';
import { composeOptions, startingStep } from '@/components/ApprovalCard/composedOptions';
import { Button } from '@/components/Button/Button';
import { Fill } from '@/components/Fill/Fill';
import { ItemViewer } from '@/components/ItemViewer/ItemViewer';
import { Notice } from '@/components/Notice/Notice';
import { PreparingCard } from '@/components/PreparingCard/PreparingCard';
import { relayResultLine } from '@/components/RelayResult/RelayResult';
import { REQUESTS } from '@/copy/screens-controls';
import { PLAYGROUND_ASSISTANT_COPY as COPY, RELAY_RESULT_COPY, fill } from '@/copy/screens-main';
import { composeOutgoingText } from '@/pipeline';
import type { PendingEntry } from '@/state/homeBase';
import { useNetwork } from '@/state/network';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { useRecords } from '@/state/records';
import styles from './assistant.module.css';

function cardPhase(entry: PendingEntry): 'open' | 'deciding' | 'decided' {
  if (entry.phase === 'deciding') return 'deciding';
  if (entry.phase === 'done') return 'decided';
  return 'open';
}

export function RelayEntry({ entry, onOpenItem }: { entry: PendingEntry; onOpenItem(recordId: string): void }) {
  const { request, proposal } = entry;
  const aiName = request.requester.aiName;
  const online = useNetwork((s) => s.online);
  const meta = useRecords((s) => s.meta);
  const [chosen, setChosen] = useState<LadderStep | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const options = useMemo(() => {
    if (!proposal) return [];
    const related = entry.relatedSelected
      .map((id) => entry.relatedOptions[id])
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    return composeOptions(proposal.options, related, composeOutgoingText);
  }, [proposal, entry.relatedSelected, entry.relatedOptions]);
  const step = startingStep(options, chosen ?? request.requestedStep);
  const option = options.find((o) => o.step === step);

  const ids = useMemo(
    () => (proposal ? [proposal.item?.recordId, ...proposal.related.map((c) => c.recordId)].filter((id): id is string => Boolean(id)) : []),
    [proposal],
  );
  useEffect(() => {
    if (ids.length > 0) useRecords.getState().ensure('playground', ids).catch(console.error);
  }, [ids]);

  const decide = async (approved: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await usePlaygroundRelay.getState().decide({
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
      setBusy(false);
    }
  };

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
      : stepPhrase(step, proposal?.item?.kind, 1 + entry.relatedSelected.length);

  const result = entry.result ? (
    <div className={styles.resultLine}>
      <p tabIndex={-1} data-result-line data-kind={entry.result.kind}>
        {relayResultLine(entry.result, aiName, phrase, proposal?.item?.category)}
      </p>
      <div>
        <Button variant="secondary" size="sm" onClick={() => usePlaygroundRelay.getState().dismissDone(entry.requestId)}>
          {RELAY_RESULT_COPY.done}
        </Button>
      </div>
    </div>
  ) : undefined;
  const preparing = entry.phase === 'claiming' || entry.phase === 'preparing';

  return (
    <article className={styles.request} aria-label={fill(COPY.requestLabel, { aiName })} data-phase={entry.phase}>
      <p className={styles.eyebrow}>
        <Fill template={COPY.requestLabel} values={{ aiName }} />
      </p>
      <blockquote className={styles.requestQuestion} dir="auto">
        <Fill template={REQUESTS.quoted} values={{ question: request.question }} />
      </blockquote>
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
            usePlaygroundRelay.getState().stopPreparing(entry.requestId).catch(console.error);
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
            usePlaygroundRelay.getState().toggleRelated(entry.requestId, id).catch(console.error);
          }}
          phase={cardPhase(entry)}
          canApprove={entry.phase === 'awaiting-person' && blockedReason === undefined && !busy}
          approveBlockedReason={blockedReason}
          onApprove={() => void decide(true)}
          onDeny={() => void decide(false)}
          onAllowCloud={(recordId) => {
            usePlaygroundRelay.getState().allowCloudFor(entry.requestId, recordId).catch(console.error);
          }}
          onOpenItem={onOpenItem}
          resultSlot={result}
          sampleData
        />
      ) : (
        result
      )}
    </article>
  );
}

export function RelayColumn() {
  const headingId = useId();
  const [viewing, setViewing] = useState<string | null>(null);
  const { status, entries, order } = usePlaygroundRelay(useShallow((s) => ({ status: s.status, entries: s.entries, order: s.order })));
  const list = order.map((id) => entries[id]).filter((e): e is PendingEntry => e !== undefined);
  return (
    <section className={`${styles.column} ${styles.deviceColumn}`} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.columnTitle}>
        {COPY.deviceColumn}
      </h3>
      {status === 'error' ? (
        <Notice tone="warning" compact>
          <p>{COPY.deviceError}</p>
        </Notice>
      ) : list.length === 0 ? (
        <p className={styles.small}>{status === 'starting' ? COPY.deviceStarting : COPY.deviceEmpty}</p>
      ) : (
        <div className={styles.requests}>
          {list.map((entry) => (
            <RelayEntry key={entry.requestId} entry={entry} onOpenItem={setViewing} />
          ))}
        </div>
      )}
      <ItemViewer dbKind="playground" recordId={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

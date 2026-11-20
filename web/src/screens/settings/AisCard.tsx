// "AIs that can ask" (40 sections 13.8.1 to 13.8.3): grants with their limits, Narrow and Revoke, past connections,
// and the Connect an AI dialog (also opened by ?connect=1, which is then removed from the URL).
import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/shallow';
import { Button } from '@/components/Button/Button';
import { Icon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { Tag, type TagProps } from '@/components/Tag/Tag';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { useGrants } from '@/state/grants';
import { useNetwork } from '@/state/network';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import type { RealSource } from '../sources/sourcesDb';
import { ConnectAiDialog } from './ConnectAiDialog';
import { Confirm } from './kit/Confirm';
import { formatDate, formatRelative } from './kit/when';
import { NarrowDialog } from './NarrowDialog';
import { SettingsCard } from './SettingsCard';
import { callableMessage, capLabel, categoriesLabel, sourcesLabel } from './settingsText';
import styles from './settings.module.css';

const STATE_TAGS: Record<GrantView['state'], { label: string; tone: TagProps['tone'] }> = {
  active: { label: SETTINGS.grantActive, tone: 'device' },
  expiring: { label: SETTINGS.grantExpiring, tone: 'warn' },
  expired: { label: SETTINGS.grantExpired, tone: 'muted' },
  revoked: { label: SETTINGS.grantRevoked, tone: 'muted' },
};

export function grantLimits(g: GrantView): string {
  return fillText(SETTINGS.limits, {
    cap: capLabel(g.maxStep),
    categories: categoriesLabel(g.allowedCategories),
    sources: sourcesLabel(g.allowedSources),
  });
}

export function grantMeta(g: GrantView, now: number = Date.now()): string {
  return fillText(SETTINGS.meta, {
    date: formatDate(g.expiresAt, now),
    used: g.lastUsedAt !== undefined ? fillText(SETTINGS.lastUsed, { when: formatRelative(g.lastUsedAt, now) }) : SETTINGS.neverUsed,
    hint: g.linkHint,
  });
}

function GrantRow({ grant, onNarrow, onRevoke }: { grant: GrantView; onNarrow?(): void; onRevoke?(): void }) {
  const tag = STATE_TAGS[grant.state];
  return (
    <li className={styles.grantRow}>
      <div className={styles.grantMain}>
        <p className={styles.grantName}>
          <bdi>{grant.aiName}</bdi> <Tag tone={tag.tone}>{tag.label}</Tag>
        </p>
        <p className={styles.grantLimits}>{grantLimits(grant)}</p>
        <p className={styles.grantMeta}>{grantMeta(grant)}</p>
      </div>
      {onNarrow && onRevoke ? (
        <div className={styles.grantActions}>
          <Button variant="secondary" size="sm" onClick={onNarrow}>
            {SETTINGS.narrow}
          </Button>
          <Button variant="danger" size="sm" onClick={onRevoke}>
            {SETTINGS.revoke}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function AisCard({ connected }: { connected: RealSource[] }) {
  const { status, grants } = useGrants(useShallow((s) => ({ status: s.status, grants: s.grants })));
  const online = useNetwork((s) => s.online);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);
  const [narrowing, setNarrowing] = useState<GrantView | null>(null);
  const [revoking, setRevoking] = useState<GrantView | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const pastId = useId();

  // ?connect=1 opens the dialog once, then the param is removed from the URL (the hash stays).
  const wantsConnect = params.get('connect') === '1';
  const [handledConnect, setHandledConnect] = useState(false);
  if (wantsConnect !== handledConnect) {
    setHandledConnect(wantsConnect);
    if (wantsConnect) setConnectOpen(true);
  }
  useEffect(() => {
    if (!wantsConnect) return;
    const next = new URLSearchParams(params);
    next.delete('connect');
    const search = next.toString();
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [wantsConnect, params, location.hash, navigate]);

  const current = grants.filter((g) => g.state === 'active' || g.state === 'expiring');
  const past = grants.filter((g) => g.state === 'expired' || g.state === 'revoked');

  const revoke = async (grant: GrantView) => {
    try {
      await useGrants.getState().revoke(grant.id);
      useToasts.getState().push({ tone: 'success', title: fillText(SETTINGS.revoked, { aiName: grant.aiName }) });
    } catch (e) {
      useToasts.getState().push({ tone: 'error', title: callableMessage(e, online) });
    }
    setRevoking(null);
  };

  let body;
  if (status === 'idle' || status === 'loading') {
    body = (
      <div className={styles.grantList} aria-busy="true">
        <span className="visually-hidden">{SETTINGS.aisLoading}</span>
        <Skeleton lines={2} />
        <Skeleton lines={2} />
      </div>
    );
  } else if (status === 'error') {
    body = <p className={styles.text}>{SETTINGS.aisError}</p>;
  } else {
    body = (
      <>
        {current.length === 0 ? (
          <p className={styles.text}>{SETTINGS.aisEmpty}</p>
        ) : (
          <ul className={styles.grantList}>
            {current.map((g) => (
              <GrantRow key={g.id} grant={g} onNarrow={() => setNarrowing(g)} onRevoke={() => setRevoking(g)} />
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <div>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={pastOpen}
              aria-controls={pastId}
              onClick={() => setPastOpen((v) => !v)}
            >
              <Icon name={pastOpen ? 'chevron-down' : 'chevron-right'} size={16} />
              {fillText(SETTINGS.past, { n: past.length })}
            </button>
            <ul id={pastId} className={styles.grantList} hidden={!pastOpen}>
              {past.map((g) => (
                <GrantRow key={g.id} grant={g} />
              ))}
            </ul>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <SettingsCard
      id="ais"
      title={SETTINGS.aisHeading}
      wide
      actions={
        <Button variant="primary" onClick={() => setConnectOpen(true)}>
          {SETTINGS.connectAi}
        </Button>
      }
    >
      <p className={styles.sub}>{SETTINGS.aisSub}</p>
      {body}
      <ConnectAiDialog open={connectOpen} onClose={() => setConnectOpen(false)} connected={connected} />
      <NarrowDialog grant={narrowing} onClose={() => setNarrowing(null)} />
      <Confirm
        open={revoking !== null}
        title={fillText(SETTINGS.revokeTitle, { aiName: revoking?.aiName ?? '' })}
        body={SETTINGS.revokeBody}
        confirmLabel={SETTINGS.revokeConfirm}
        tone="danger"
        onCancel={() => setRevoking(null)}
        onConfirm={() => (revoking ? revoke(revoking) : undefined)}
      />
    </SettingsCard>
  );
}

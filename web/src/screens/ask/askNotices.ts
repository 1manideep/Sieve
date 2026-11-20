// The notices above the Ask question (40 section 13.4), in priority order, at most two; and whether the model state
// blocks "Find on this device" (40 sections 13.4 and 13.2a).
import type { NanoAvailability } from '@sieve/shared';
import type { SetupState } from '@/state/availability';
import type { IndexingState } from '@/state/indexing';
import { formatCount } from '@/copy/format';
import { ASK_COPY, fill } from '@/copy/screens-main';
import type { NoticeTone } from '@/components/Notice/Notice';

export interface AskNoticeAction { label: string; to: string }
export interface AskNotice { id: 'empty' | 'downloadable' | 'setting-up' | 'no-model' | 'no-model-cloud' | 'indexing'; tone: NoticeTone; text: string; actions: AskNoticeAction[] }

export interface AskNoticeInput {
  sourcesConnected: boolean | undefined;      // undefined: not known yet (no notice)
  text: NanoAvailability | 'checking';
  setup: SetupState;
  fraction?: number;
  cloudFallback: boolean;
  indexing: IndexingState['state'];
  left: number;
}

export type ModelGate = 'open' | 'downloadable' | 'setting-up' | 'no-model';

export function modelGate(i: Pick<AskNoticeInput, 'text' | 'setup' | 'cloudFallback'>): ModelGate {
  if (i.setup === 'downloading' || i.setup === 'installing' || (i.text === 'downloading' && i.setup !== 'done')) return 'setting-up';
  if (i.text === 'downloadable' && i.setup !== 'done') return 'downloadable';
  if ((i.text === 'unavailable' || i.text === 'no-api') && !i.cloudFallback) return 'no-model';
  return 'open';
}

const PREPARE = '/prepare?back=/';

export function askNotices(i: AskNoticeInput): AskNotice[] {
  const out: AskNotice[] = [];
  const pct = Math.round((i.fraction ?? 0) * 100);
  if (i.sourcesConnected === false) {
    out.push({
      id: 'empty', tone: 'info', text: ASK_COPY.noticeEmpty,
      actions: [{ label: ASK_COPY.goToSources, to: '/sources' }, { label: ASK_COPY.tryPlayground, to: '/playground' }],
    });
  }
  const gate = modelGate(i);
  if (gate === 'downloadable') {
    out.push({ id: 'downloadable', tone: 'warning', text: ASK_COPY.noticeDownloadable, actions: [{ label: ASK_COPY.setItUp, to: PREPARE }] });
  } else if (gate === 'setting-up') {
    out.push({ id: 'setting-up', tone: 'warning', text: fill(ASK_COPY.noticeSettingUp, { pct }), actions: [{ label: ASK_COPY.showProgress, to: PREPARE }] });
  } else if (gate === 'no-model') {
    out.push({
      id: 'no-model', tone: 'warning', text: ASK_COPY.noticeNoModel,
      actions: [{ label: ASK_COPY.settings, to: '/settings#cloud' }, { label: ASK_COPY.tryPlayground, to: '/playground' }],
    });
  } else if ((i.text === 'unavailable' || i.text === 'no-api') && i.cloudFallback) {
    out.push({ id: 'no-model-cloud', tone: 'cloud', text: ASK_COPY.noticeNoModelCloud, actions: [] });
  }
  if (i.indexing === 'running' || i.indexing === 'yielding') {
    out.push({
      id: 'indexing', tone: 'info', text: fill(ASK_COPY.noticeIndexing, { left: formatCount(i.left) }),
      actions: [{ label: ASK_COPY.sources, to: '/sources' }],
    });
  }
  return out.slice(0, 2);
}

// Pipeline types (10 section 12.1; contract 01 sections 9 and 11.4).
import type {
  Category, ItemKind, LadderStep, QueryHints, RequesterRef, Settings, SourceKind, TraceKind, TraceStep, Where,
} from '@sieve/shared';
import type { SieveDb } from '@/index';

/** 40's type (40 CR-3): live trace events. Everything in them stays on the device. */
export type PipelineProgress =
  | { type: 'step-start'; id: string; kind: TraceKind; label: string; where: Where; at?: number }
  | { type: 'step-end'; id: string; step: TraceStep }
  | { type: 'answer-progress'; text: string };

export interface PrepareInput {
  db: SieveDb;
  requestId: string;
  question: string;
  requester: RequesterRef;
  requestedStep: LadderStep;
  maxStep: LadderStep;
  allowedCategories?: Category[];
  allowedSources?: SourceKind[];
  hints?: QueryHints;                     // from the outside AI's tool call, or parsed from the question in-app
  settings: Settings;
  dataClass: 'own' | 'sample';
  signal?: AbortSignal;
  onProgress?: (e: PipelineProgress) => void;
  blockedRecordIds?: string[];            // items the person blocked for this AI (users/{uid}/blocked)
  ownWithoutConsent?: 'ask' | 'skip';     // default 'ask'; 'skip' leaves out own items that lack cloud consent
  now?: number;
}

/** What the person approves before own data may reach the cloud: the exact text that would be sent (10 section 12.5). */
export interface CloudConsentRequest {
  requestId: string;
  question: string;                                      // the text of the question that would be sent
  items: { recordId: string; title: string; kind: ItemKind; text: string; chars: number }[];   // exact passages that would be sent
  chars: number;                                         // question plus every passage
  createdAt: number;
}

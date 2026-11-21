// The shared on-device ML worker (20 section 6): one worker per page for the embedder (20) and the PII model (11).
export { getMl, setMlClient, createWorkerMlClient, MlUnavailableError } from './client';
export type { MlClient, MlTaskStatus, WorkerLike } from './client';
export { MlInitError, RERANK_MODEL } from './protocol';
export type { MlTask, MlDevice, MlPriority, ToMl, FromMl, MlTaskHandler, EmbedInput, EmbedOutput, RerankInput, RerankOutput } from './protocol';
export { createMlHost } from './host';

// Errors of the index (20 section 12).

export type IngestErrorCode = 'invalid' | 'unsupported' | 'too-large' | 'password' | 'unreadable' | 'heic' | 'binary' | 'storage-full';

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

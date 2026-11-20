// DecisionError (10 section 12.1): thrown when a decision or a related item does not fit its proposal.
export type DecisionErrorCode =
  | 'wrong-request' | 'expired' | 'not-ready' | 'bad-step' | 'step-too-high' | 'bad-items' | 'option-unavailable' | 'too-long';

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}

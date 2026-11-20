// The account deletion service of 40 section 10.7 (app/services/account.ts), loaded when the person confirms.
// Kept behind this seam so the Settings chunk does not pull firebase/functions until it is needed.
export type DeleteStep = 'stopping' | 'push' | 'account' | 'device' | 'done';
export type DeleteResult = 'ok' | 'cancelled' | 'error';

export async function runDeleteAccount(onStep: (s: DeleteStep) => void): Promise<DeleteResult> {
  const { deleteAccount } = await import('@/app/services/account');
  return deleteAccount(onStep);
}

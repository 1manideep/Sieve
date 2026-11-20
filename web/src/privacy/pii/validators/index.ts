// runValidators() (11 section 5.2): plain-code detectors, any text, any data class, any rule.
import type { PiiSpan } from '@sieve/shared';
import { filterSpans } from '../merge';
import { findAccounts } from './account';
import { findAddresses } from './address';
import { findCards } from './card';
import { findDobs } from './dob';
import { findEmails } from './email';
import { findIbans } from './iban';
import { findIps } from './ip';
import { findNames } from './names';
import { findPhones, loadPhoneLib, phoneLibReady } from './phone';
import { findSsns } from './ssn';

export { isValidIban } from './iban';
export { findSecretCodes, holdsSecretCode } from './secretCode';

/** Loads the phone metadata; every async entry point awaits it before calling runValidators. */
export function prepareValidators(): Promise<void> {
  return loadPhoneLib();
}

export function validatorsReady(): boolean {
  return phoneLibReady();
}

/** All validator spans with the 5.6 step 1 filters applied (unmerged). Call prepareValidators() first. */
export function runValidators(text: string): PiiSpan[] {
  const spans = [
    ...findEmails(text),
    ...findPhones(text),
    ...findCards(text),
    ...findIbans(text),
    ...findSsns(text),
    ...findAccounts(text),
    ...findDobs(text),
    ...findAddresses(text),
    ...findNames(text),
    ...findIps(text),
  ];
  return filterSpans(text, spans);
}

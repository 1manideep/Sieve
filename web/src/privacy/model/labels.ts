// Rampart label to PiiType (11 section 5.4.2).
import type { PiiType } from '@sieve/shared';
import { isValidIban } from '../pii/validators/iban';

export interface ModelSpan { start: number; end: number; label: string; score: number }

const BY_LABEL: Record<string, PiiType | null> = {
  GIVEN_NAME: 'name',
  SURNAME: 'name',
  EMAIL: 'email',
  PHONE: 'phone',
  ROUTING_NUMBER: 'account',
  TAX_ID: 'other',
  GOVERNMENT_ID: 'other',
  PASSPORT: 'other',
  DRIVERS_LICENSE: 'other',
  BUILDING_NUMBER: 'address',
  STREET_NAME: 'address',
  SECONDARY_ADDRESS: 'address',
  CITY: null,                  // coarse geography is kept (Rampart's own keep-set)
  STATE: null,
  ZIP_CODE: null,
  URL: null,                   // links are shortened before detection
};

/** The PiiType for a model span, or null when the label is dropped. BANK_ACCOUNT is an IBAN only if it passes the check. */
export function piiTypeForLabel(label: string, value: string): PiiType | null {
  const bare = label.replace(/^[BI]-/, '');
  if (bare === 'BANK_ACCOUNT') return isValidIban(value.replace(/\s+/g, '')) ? 'iban' : 'account';
  return BY_LABEL[bare] ?? null;
}

/**
 * Store actions whose logic belongs to a later work package throw this until it lands.
 * The stores already have their final names, fields and initial state (40 section 9).
 */
export function notBuilt(what: string): never {
  throw new Error(`Not built yet: ${what}`);
}

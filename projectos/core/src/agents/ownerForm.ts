// Origin: original ProjectOS code
/**
 * A record in the owner's form, and how it is checked.
 *
 * A WELL-FORMED RECORD IS NOT AN APPROVAL. It names a `PLANDEC-` id, says `decidedBy: 'owner'` and carries a plan digest, plus
 * the fields that bind it to the one thing it is about. Those are claims the record makes about itself, so the reader here
 * checks the form, and a verifier port the caller injects must then answer exactly `true` for the record. With no verifier,
 * or one that throws or answers anything else, the record counts for nothing: it fails closed. Whether that port is honest
 * (it should look the decision up in the committed plan-decision records) is the wiring's, not this module's.
 *
 * Pure: no I/O.
 */
import { snapshotOf } from './plainRecords.js';

export const DECISION_ID = /^PLANDEC-[A-Za-z0-9-]{1,64}$/;
export const PLAN_DIGEST = /^sha256:[0-9a-f]{64}$/;
const BASE_FIELDS = ['decisionId', 'decidedBy', 'planDigest'] as const;

/** A port that answers exactly `true` for a record it can vouch for. */
export type OwnerFormVerifier = (record: Readonly<Record<string, unknown>>) => boolean;

/** The record copied once, or `null` when its form is wrong or it carries a field outside `extra`. */
export function readOwnerForm(raw: unknown, extra: readonly string[]): Readonly<Record<string, unknown>> | null {
  const fields = snapshotOf(raw, [...BASE_FIELDS, ...extra]);
  if (fields === null) return null;
  const { decisionId, decidedBy, planDigest } = fields;
  if (typeof decisionId !== 'string' || !DECISION_ID.test(decisionId) || decidedBy !== 'owner') return null;
  if (typeof planDigest !== 'string' || !PLAN_DIGEST.test(planDigest)) return null;
  return Object.freeze(fields);
}

/** Did the injected verifier answer exactly `true`? A missing verifier, a throw or any other answer is no. */
export function verifiedByPort(verify: unknown, record: Readonly<Record<string, unknown>>): boolean {
  if (typeof verify !== 'function') return false;
  try {
    return (verify as OwnerFormVerifier)(record) === true;
  } catch {
    return false;
  }
}

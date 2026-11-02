// Origin: original ProjectOS code
/**
 * How the context rules say no.
 *
 * Every refusal carries a closed code, as the memory rules do, so a caller and a test can tell one rule
 * from another without reading prose. Nothing here decides anything; the rules are in the modules beside it.
 */

export const CONTEXT_REFUSAL_CODES = [
  'CONTEXT_WINDOW_INVALID',
  'CONTEXT_ACCOUNT_INVALID',
  'CONTEXT_NO_ACCOUNT',
  'CONTEXT_USAGE_INVALID',
  'CONTEXT_TURN_INVALID',
  'CONTEXT_DECISION_INVALID',
  'CONTEXT_DECISION_LOST',
  'CONTEXT_DECISIONS_REFUSED',
  'CONTEXT_LAUNDERED',
  'CONTEXT_RECORD_TAMPERED',
  'CONTEXT_NOTHING_TO_COMPACT',
  'CONTEXT_PROTECTED_OVER_BUDGET',
  'CONTEXT_PLAN_STALE',
  'CONTEXT_DRAFT_INVALID',
  'CONTEXT_SUMMARY_OVER_BUDGET',
  'CONTEXT_SUMMARY_REFUSED',
  'CONTEXT_NOT_SMALLER',
] as const;

export type ContextRefusalCode = (typeof CONTEXT_REFUSAL_CODES)[number];

export interface ContextRefusal {
  readonly code: ContextRefusalCode;
  readonly message: string;
  /** The threat pattern or instruction cue that fired, when one did. */
  readonly named?: string;
}

/** A refusal on its own, so a rule that only refuses needs no cast to fit any result. */
export interface ContextRefused {
  readonly ok: false;
  readonly refusal: ContextRefusal;
}

export type ContextResult<T> = { readonly ok: true; readonly value: T } | ContextRefused;

export function contextOk<T>(value: T): ContextResult<T> {
  return { ok: true, value };
}

export function contextRefused(code: ContextRefusalCode, message: string, named?: string): ContextRefused {
  return { ok: false, refusal: named === undefined ? { code, message } : { code, message, named } };
}

/** A closed shape, because these values reach a prompt and a record. Text would need its own scan. */
const CONTEXT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

export function isContextLabel(value: unknown): value is string {
  return typeof value === 'string' && CONTEXT_LABEL.test(value);
}

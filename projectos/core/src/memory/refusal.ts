// Origin: original ProjectOS code
/**
 * How the memory rules say no.
 *
 * Every refusal carries a closed code, so a caller and a test can tell one rule from another without
 * reading prose. Nothing here decides anything; the rules are in the modules beside it.
 */

export const MEMORY_REFUSAL_CODES = [
  'MEMORY_EMPTY',
  'MEMORY_ENTRY_SPLITS',
  'MEMORY_OVER_LIMIT',
  'MEMORY_THREAT',
  'MEMORY_CREDENTIAL',
  'MEMORY_INSTRUCTION_SHAPED',
  'MEMORY_LOSSY_TEXT',
  'MEMORY_DUPLICATE',
  'MEMORY_NO_MATCH',
  'MEMORY_AMBIGUOUS',
  'MEMORY_STALE',
  'MEMORY_TAMPERED',
  'MEMORY_NOT_OWNER',
  'MEMORY_NOT_APPROVED',
  'MEMORY_ALREADY_DECIDED',
  'MEMORY_DECISION_PROTECTED',
  'MEMORY_PROVENANCE',
  'MEMORY_LEDGER_REF',
  'MEMORY_UNREADABLE',
  'MEMORY_NOT_FOUND',
  'MEMORY_LOCKED',
  'MEMORY_WRITE_FAILED',
] as const;

export type MemoryRefusalCode = (typeof MEMORY_REFUSAL_CODES)[number];

export interface MemoryRefusal {
  readonly code: MemoryRefusalCode;
  readonly message: string;
  /** The threat pattern or instruction cue that fired, when one did. */
  readonly named?: string;
}

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: MemoryRefusal };

export function memoryOk<T>(value: T): MemoryResult<T> {
  return { ok: true, value };
}

export function memoryRefused<T = never>(code: MemoryRefusalCode, message: string, named?: string): MemoryResult<T> {
  return { ok: false, refusal: named === undefined ? { code, message } : { code, message, named } };
}

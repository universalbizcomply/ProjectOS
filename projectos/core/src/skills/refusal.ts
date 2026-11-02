// Origin: original ProjectOS code
/**
 * How the skill rules say no, and how they name what they found.
 *
 * Every refusal carries a closed code, and every finding a named rule, so a caller and a test can tell one
 * rule from another without reading prose. A finding names a file, a line and a rule. It never repeats the
 * text it matched, because that text may be a credential or the attack itself.
 */

export const SKILL_REFUSAL_CODES = [
  'SKILL_FAILED_VALIDATION',
  'SKILL_CREDENTIAL',
  'SKILL_PROVENANCE',
  'SKILL_TAMPERED',
  'SKILL_NOT_INDEPENDENT',
  'SKILL_NOT_OWNER',
  'SKILL_STALE',
  'SKILL_NOT_APPROVED',
  'SKILL_ALREADY_DECIDED',
  'SKILL_NOT_FOUND',
  'SKILL_UNREADABLE',
  'SKILL_LOCKED',
  'SKILL_WRITE_FAILED',
  'SKILL_LANDED_INCOMPLETE',
  'SKILL_QUEUE_FULL',
] as const;

export type SkillRefusalCode = (typeof SKILL_REFUSAL_CODES)[number];

export interface SkillRefusal {
  readonly code: SkillRefusalCode;
  readonly message: string;
  /** The rule that fired, when one did. */
  readonly named?: string;
  /** Everything that stopped this package, when validation did. */
  readonly findings?: readonly SkillFinding[];
}

export interface SkillRefused {
  readonly ok: false;
  readonly refusal: SkillRefusal;
  /** Something else went wrong that the caller must hear, without replacing this answer. */
  readonly warning?: string;
}

export type SkillResult<T> = { readonly ok: true; readonly value: T; readonly warning?: string } | SkillRefused;

export function skillOk<T>(value: T): SkillResult<T> {
  return { ok: true, value };
}

export function skillRefused(code: SkillRefusalCode, message: string, named?: string, findings?: readonly SkillFinding[]): SkillRefused {
  const refusal: SkillRefusal = { code, message, ...(named === undefined ? {} : { named }), ...(findings === undefined ? {} : { findings }) };
  return { ok: false, refusal };
}

/** A finding that stops promotion, or one the reviewer should read. Nothing else exists. */
export type SkillFindingWeight = 'blocking' | 'advisory';

export interface SkillFinding {
  readonly rule: string;
  readonly weight: SkillFindingWeight;
  /** The package path, or a position when the path itself could not be trusted. */
  readonly file: string;
  /** 1-indexed, or 0 for the file as a whole. */
  readonly line: number;
  readonly message: string;
}

export const blockingFinding = (rule: string, file: string, line: number, message: string): SkillFinding => ({ rule, weight: 'blocking', file, line, message });
export const advisoryFinding = (rule: string, file: string, line: number, message: string): SkillFinding => ({ rule, weight: 'advisory', file, line, message });

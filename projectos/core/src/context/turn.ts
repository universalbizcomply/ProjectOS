// Origin: original ProjectOS code
/**
 * One turn of a thread, and who it can be said to come from.
 *
 * TRUST IS NOT A FIELD. A turn carries where it came from, and its trust is worked out from that here, so
 * there is no flag to set, copy or forget. Only the kernel and the owner are trusted, and the list is
 * closed: a new origin, a misspelt one and a summary are all untrusted. A model's own words are untrusted
 * too, because a model that has read outside text may be repeating it.
 *
 * A SUMMARY IS NOT A TURN. It has no origin here and no role, so it cannot be appended, and nothing can
 * say a summary came from the owner. It lives in its own field of the thread.
 *
 * An origin is what the kernel says it is. Nothing here proves it: the rule that holds without proof is
 * that a text known to be untrusted cannot come back as trusted, in `thread.ts`. Pure.
 */
import { createHash } from 'node:crypto';
import { normalizedEntryKey } from '../memory/admission.js';
import { isContextLabel } from './refusal.js';

export const CONTEXT_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

export const CONTEXT_ORIGINS = ['kernel', 'owner', 'agent', 'channel', 'tool', 'document', 'web', 'memory'] as const;
export type ContextOrigin = (typeof CONTEXT_ORIGINS)[number];

export type ContextTrust = 'trusted' | 'untrusted';

const TRUSTED_ORIGINS: readonly ContextOrigin[] = ['kernel', 'owner'];

/** Which origins each role can honestly have. Web text cannot arrive as the system, or as the owner. */
const ORIGINS_OF_ROLE: Readonly<Record<ContextRole, readonly ContextOrigin[]>> = {
  system: ['kernel'],
  user: ['owner', 'channel'],
  assistant: ['agent'],
  tool: ['tool', 'document', 'web', 'memory'],
};

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/?=&%+~@#-]{0,255}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

export interface ContextToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: string;
}

/** What a turn was read from, and the content it read, so a later read can show the text has moved on. */
export interface ContextSourceRef {
  readonly sourceId: string;
  readonly contentHash: string;
}

export interface ContextTurn {
  readonly id: string;
  readonly role: ContextRole;
  readonly origin: ContextOrigin;
  readonly text: string;
  /** Calls this assistant turn made. Empty on every other role. */
  readonly toolCalls: readonly ContextToolCall[];
  /** The call a tool turn answers. Null on every other role. */
  readonly toolCallId: string | null;
  /** Set only on a tool turn. */
  readonly source: ContextSourceRef | null;
}

export function trustOfOrigin(origin: ContextOrigin): ContextTrust {
  return TRUSTED_ORIGINS.includes(origin) ? 'trusted' : 'untrusted';
}

/** One identity for "the same text", in any case and spacing, so a retyped copy is still the copy. */
export function textKey(text: string): string {
  return `sha256:${createHash('sha256').update(normalizedEntryKey(text), 'utf8').digest('hex')}`;
}

export function isContextSourceRef(value: ContextSourceRef): boolean {
  return typeof value.sourceId === 'string' && SOURCE_ID.test(value.sourceId) && typeof value.contentHash === 'string' && CONTENT_HASH.test(value.contentHash);
}

function toolCallsProblem(turn: ContextTurn): string | null {
  if (!Array.isArray(turn.toolCalls)) return 'its tool calls are not a list';
  if (turn.role !== 'assistant' && turn.toolCalls.length > 0) return 'only an assistant turn makes tool calls';
  const whole = turn.toolCalls.every((call) => isContextLabel(call.id) && isContextLabel(call.name) && typeof call.args === 'string');
  return whole ? null : 'a tool call is not whole';
}

function toolResultProblem(turn: ContextTurn): string | null {
  if ((turn.role === 'tool') !== isContextLabel(turn.toolCallId)) return 'a tool turn, and only a tool turn, names the call it answers';
  if (turn.source === null) return null;
  if (turn.role !== 'tool') return 'only a tool turn carries a source';
  return isContextSourceRef(turn.source) ? null : 'its source is not of a closed shape';
}

/** Null when this turn is what it says it is. Whether it fits its thread is asked in `thread.ts`. */
export function turnProblem(turn: ContextTurn): string | null {
  if (!isContextLabel(turn.id)) return 'its id is not of a closed shape';
  if (!CONTEXT_ROLES.includes(turn.role)) return 'its role is not known';
  if (!ORIGINS_OF_ROLE[turn.role].includes(turn.origin)) return `a ${turn.role} turn cannot come from ${String(turn.origin)}`;
  if (typeof turn.text !== 'string') return 'it has no text';
  return toolCallsProblem(turn) ?? toolResultProblem(turn);
}

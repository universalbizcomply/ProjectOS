// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-approvals-core.ts; src/infra/exec-command-resolution.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the policy vocabulary and the allowlist match are taken, a mode that denies, allowlists or asks, and an entry that is a path pattern with an argument rule; the mode that runs everything without asking, the elevated mode, the auto-review mode, the persisted allow-always entries, the bare wildcard entry, the basename grants, the regular-expression argument patterns, the safe-binary tables and the cron policy are cut; a mode this code does not know is a deny; an entry must say its argument list exactly or say that any arguments are allowed; the action class is looked up in the action registry, and a class above P3 never runs without the owner's decision
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Whether a prepared command may run: the policy, the allowlist and the class.
 *
 * THE DEFAULT IS NO. The modes are `deny`, `allowlist`, `ask-on-miss` and `ask-always`. A mode this module does not know,
 * a policy it did not compile, a command it did not prepare and an entry it cannot read all refuse. There is no mode that
 * runs everything and none that skips the question.
 *
 * AN ALLOWLIST HIT IS NOT A GRANT. A hit means the real executable matched an entry exactly and the arguments are the ones
 * the entry names (or the entry says any arguments do), with any shell syntax the entry allows. The answer is `allowlist-hit`
 * and never a word that sounds like permission: whether it may run is also the action class's say.
 *
 * THE CLASS IS LOOKED UP, NEVER SAID. A command is the action `exec-command`, and its class comes from the action registry
 * (R5: an unregistered action is P5). A class above P3 is never run on an allowlist hit alone: it needs the owner's decision,
 * recorded as a grant for this exact command. P6 is never run. Until the registry lists `exec-command`, every command reads as
 * P5, which is the safe default and the reason an allowlist hit is not enough yet.
 *
 * WHAT THIS MODULE CANNOT PROVE. That an allowlist entry was written by the owner, and that the policy it is handed is the
 * one in force, are the caller's. This module judges the policy it is given.
 *
 * Pure: no I/O.
 */
import { classAtMost, resolveAction, type ActionClass, type ActionRegistry } from '../actionRegistry.js';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { ALLOWABLE_SYNTAX, type SyntaxFeature } from './commandLine.js';
import { isPreparedExec, type PreparedExec } from './execCommand.js';
import { mintExecLaunchPlan, type ExecLaunchPlan } from './execLaunch.js';
import { compileExecAllowlistPattern, type ExecAllowlistPattern } from './allowlistPattern.js';
import { snapshotOfArray, snapshotOfFields } from './plainFields.js';

export const EXEC_ACTION = 'exec-command';
/** The highest class a command may run at on an allowlist hit alone. */
export const UNATTENDED_EXEC_CLASS: ActionClass = 'P3';
export const MAX_ALLOWLIST_ENTRIES = 64;
export const MAX_ENTRY_ARGS = 64;

export const EXEC_MODES = ['deny', 'allowlist', 'ask-on-miss', 'ask-always'] as const;
export type ExecMode = (typeof EXEC_MODES)[number];

export interface CompiledAllowlistEntry {
  readonly pattern: ExecAllowlistPattern;
  /** The exact arguments after the executable, or `null` when the entry says any arguments do. */
  readonly args: readonly string[] | null;
  readonly allowSyntax: readonly SyntaxFeature[];
}

export interface ExecPolicy {
  readonly mode: ExecMode;
  readonly entries: readonly CompiledAllowlistEntry[];
}

export type PolicyRefusal = 'POLICY_SHAPE' | 'POLICY_MODE' | 'POLICY_ENTRIES' | 'ENTRY_SHAPE' | 'ENTRY_PATTERN' | 'ENTRY_ARGS' | 'ENTRY_SYNTAX';
export type CompileResult = { readonly ok: true; readonly policy: ExecPolicy } | { readonly ok: false; readonly code: PolicyRefusal; readonly detail: string };

const COMPILED = new WeakSet<object>();
const no = (code: PolicyRefusal, detail: string): CompileResult => ({ ok: false, code, detail });

type EntryResult = { readonly ok: true; readonly entry: CompiledAllowlistEntry } | { readonly ok: false; readonly result: CompileResult };

function entryOf(raw: unknown, index: number): EntryResult {
  const fail = (code: PolicyRefusal, detail: string): EntryResult => ({ ok: false, result: no(code, `allowlist[${index}]: ${detail}`) });
  const fields = snapshotOfFields(raw, ['pattern', 'args', 'anyArgs', 'allowSyntax']);
  if (fields === null) return fail('ENTRY_SHAPE', 'an entry is a plain object of pattern, args, anyArgs and allowSyntax');
  const compiled = compileExecAllowlistPattern(fields['pattern']);
  if (!compiled.ok) return fail('ENTRY_PATTERN', `the pattern cannot be read completely: ${compiled.refusal}`);
  const hasArgs = fields['args'] !== undefined;
  if (hasArgs === (fields['anyArgs'] !== undefined) || (fields['anyArgs'] !== undefined && fields['anyArgs'] !== true)) {
    return fail('ENTRY_ARGS', 'an entry names its arguments exactly, or says anyArgs: true, and not both');
  }
  const args = hasArgs ? snapshotOfArray(fields['args'], MAX_ENTRY_ARGS) : null;
  if (hasArgs && (args === null || args.some((arg) => typeof arg !== 'string'))) return fail('ENTRY_ARGS', 'args is a plain array of text within the cap');
  const syntax = fields['allowSyntax'] === undefined ? [] : snapshotOfArray(fields['allowSyntax'], ALLOWABLE_SYNTAX.length);
  if (syntax === null || syntax.some((word) => !ALLOWABLE_SYNTAX.includes(word as SyntaxFeature)) || new Set(syntax).size !== syntax.length) {
    return fail('ENTRY_SYNTAX', `allowSyntax names only ${ALLOWABLE_SYNTAX.join(' and ')}: chaining, substitution and grouping can never be allowed`);
  }
  return { ok: true, entry: Object.freeze({ pattern: compiled.pattern, args: args === null ? null : Object.freeze([...(args as readonly string[])]), allowSyntax: Object.freeze([...(syntax as readonly SyntaxFeature[])]) }) };
}

/** Read a policy once. A policy with one bad entry is refused whole, so a bad line never leaves good lines in force. */
export function compileExecPolicy(raw: unknown): CompileResult {
  const fields = snapshotOfFields(raw, ['mode', 'allowlist']);
  if (fields === null) return no('POLICY_SHAPE', 'a policy is a plain object of mode and allowlist');
  if (!(EXEC_MODES as readonly unknown[]).includes(fields['mode'])) return no('POLICY_MODE', `the mode is one of ${EXEC_MODES.join(', ')}`);
  const list = snapshotOfArray(fields['allowlist'] ?? [], MAX_ALLOWLIST_ENTRIES);
  if (list === null) return no('POLICY_ENTRIES', `the allowlist is a plain array of at most ${MAX_ALLOWLIST_ENTRIES} entries`);
  const entries: CompiledAllowlistEntry[] = [];
  for (const [index, item] of list.entries()) {
    const read = entryOf(item, index);
    if (!read.ok) return read.result;
    entries.push(read.entry);
  }
  const policy: ExecPolicy = Object.freeze({ mode: fields['mode'] as ExecMode, entries: Object.freeze(entries) });
  COMPILED.add(policy);
  return { ok: true, policy };
}

export type ExecOutcome = 'refuse' | 'allowlist-hit' | 'owner-decision-needed';
export type ExecDecisionCode =
  | 'POLICY_INVALID'
  | 'NOT_PREPARED'
  | 'MODE_DENY'
  | 'NOT_ALLOWLISTED'
  | 'ASK_ALWAYS'
  | 'CLASS_NEEDS_OWNER'
  | 'CLASS_PROHIBITED'
  | 'ALLOWLIST_HIT';

export interface ExecDecision {
  readonly outcome: ExecOutcome;
  readonly code: ExecDecisionCode;
  /** The canonical pattern of the entry that matched, or `null`. */
  readonly matched: string | null;
  readonly actionClass: ActionClass | null;
}

const decision = (outcome: ExecOutcome, code: ExecDecisionCode, matched: string | null, actionClass: ActionClass | null): ExecDecision =>
  Object.freeze({ outcome, code, matched, actionClass });

const sameWords = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((word, index) => word === right[index]);

function hitOf(policy: ExecPolicy, prepared: PreparedExec): CompiledAllowlistEntry | null {
  return (
    policy.entries.find(
      (entry) =>
        entry.pattern.matches(prepared.executable) &&
        (entry.args === null || sameWords(entry.args, prepared.argv.slice(1))) &&
        prepared.features.every((feature) => entry.allowSyntax.includes(feature)),
    ) ?? null
  );
}

/** What the policy says about a prepared command. The class is the registry's; nothing in the request names it. */
export function evaluateExecPolicy(policy: ExecPolicy, registry: ActionRegistry, prepared: PreparedExec): ExecDecision {
  if (typeof policy !== 'object' || policy === null || !COMPILED.has(policy)) return decision('refuse', 'POLICY_INVALID', null, null);
  if (!isPreparedExec(prepared)) return decision('refuse', 'NOT_PREPARED', null, null);
  const actionClass = resolveAction(registry, EXEC_ACTION).actionClass;
  if (policy.mode === 'deny') return decision('refuse', 'MODE_DENY', null, actionClass);
  if (actionClass === 'P6') return decision('refuse', 'CLASS_PROHIBITED', null, actionClass);
  const hit = hitOf(policy, prepared);
  if (policy.mode === 'allowlist' && hit === null) return decision('refuse', 'NOT_ALLOWLISTED', null, actionClass);
  if (hit === null) return decision('owner-decision-needed', 'NOT_ALLOWLISTED', null, actionClass);
  const matched = hit.pattern.canonical;
  if (policy.mode === 'ask-always') return decision('owner-decision-needed', 'ASK_ALWAYS', matched, actionClass);
  if (!classAtMost(actionClass, UNATTENDED_EXEC_CLASS)) return decision('owner-decision-needed', 'CLASS_NEEDS_OWNER', matched, actionClass);
  return decision('allowlist-hit', 'ALLOWLIST_HIT', matched, actionClass);
}

export type PlanResult =
  | { readonly ok: true; readonly plan: ExecLaunchPlan; readonly decision: ExecDecision }
  | { readonly ok: false; readonly decision: ExecDecision | null; readonly code: 'NO_TENANT_BINDING' | 'WRONG_SCOPE' | 'NOT_AN_ALLOWLIST_HIT' };

/** A launch plan for a command on an allowlist hit. Any other outcome is not a plan. */
export function planAllowlistedExec(binding: TenantBinding, policy: ExecPolicy, registry: ActionRegistry, prepared: PreparedExec): PlanResult {
  if (!isDerivedBinding(binding)) return { ok: false, decision: null, code: 'NO_TENANT_BINDING' };
  const evaluated = evaluateExecPolicy(policy, registry, prepared);
  if (evaluated.outcome !== 'allowlist-hit') return { ok: false, decision: evaluated, code: 'NOT_AN_ALLOWLIST_HIT' };
  if (prepared.tenant !== binding.tenant || prepared.project !== binding.projectId) return { ok: false, decision: evaluated, code: 'WRONG_SCOPE' };
  return { ok: true, plan: mintExecLaunchPlan(prepared, 'allowlist', null), decision: evaluated };
}

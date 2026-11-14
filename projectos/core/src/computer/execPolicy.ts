// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-approvals-core.ts; src/infra/exec-command-resolution.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the policy vocabulary and the allowlist match are taken, a mode that denies, allowlists or asks, and an entry that is a path pattern with an argument rule; the mode that runs everything without asking, the elevated mode, the auto-review mode, the persisted allow-always entries, the bare wildcard entry, the basename grants, the regular-expression argument patterns, the safe-binary tables and the cron policy are cut; a mode this code does not know is a deny; an entry must say its argument list exactly or say that any arguments are allowed, and then the arguments of the tools that run or write what they are handed are still refused; an entry names the directories it may run in, by segment; the action class is looked up in the action registry, and a class above P3 never runs without the owner's decision
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Whether a prepared command may run: the policy, the allowlist and the class.
 *
 * THE DEFAULT IS NO. The modes are `deny`, `allowlist`, `ask-on-miss` and `ask-always`. A mode this module does not know,
 * a policy it did not compile, a command it did not prepare and an entry it cannot read all refuse. There is no mode that
 * runs everything and none that skips the question.
 *
 * ONE GATE. `gateExecPolicy` is the only question a plan is cleared by. An allowlist plan and a grant plan both pass through it,
 * a grant at the moment it is spent: a grant never beats `deny` mode, a class that is never run, a policy this module did
 * not compile or (in `allowlist` mode, where nobody is asked) a command no entry allows.
 *
 * AN ALLOWLIST HIT IS NOT A GRANT. A hit means the real executable matched an entry exactly and the arguments are the ones
 * the entry names (or the entry says any arguments do, minus the arguments of git, find, tar, curl and wget that run or write
 * something, and minus any the entry denies), the working directory is under one of the entry's directories by whole segments,
 * and any shell syntax is one the entry allows. A tool that runs what it is handed (sed, make, rm, cp, ...) needs exact arguments. The answer is `allowlist-hit`
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
import { digestOfCanonical as computerDigest } from './canonicalJson.js';
import { readComputerClock, type ComputerClock } from './clock.js';
import { ALLOWABLE_SYNTAX, type SyntaxFeature } from './commandLine.js';
import { deniedEnvName } from './execEnv.js';
import { isPreparedExec, type PreparedExec } from './execCommand.js';
import { PLAN_TTL_MS, mintExecLaunchPlan, type ExecLaunchPlan } from './execLaunch.js';
import { compileExecAllowlistPattern, type ExecAllowlistPattern } from './allowlistPattern.js';
import { canonicalPathOf } from './pathCanon.js';
import { snapshotOfArray, snapshotOfFields } from './plainFields.js';
import { executableBlockReason, normalizeExecutableToken } from './wrapperResolution.js';

export const EXEC_ACTION = 'exec-command';
/** The highest class a command may run at on an allowlist hit alone. */
export const UNATTENDED_EXEC_CLASS: ActionClass = 'P3';
export const MAX_ALLOWLIST_ENTRIES = 64;
export const MAX_ENTRY_ARGS = 64;
export const MAX_ENTRY_CWDS = 8;

export const EXEC_MODES = ['deny', 'allowlist', 'ask-on-miss', 'ask-always'] as const;
export type ExecMode = (typeof EXEC_MODES)[number];

export interface CompiledAllowlistEntry {
  readonly pattern: ExecAllowlistPattern;
  /** The exact arguments after the executable, or `null` when the entry says any arguments do. */
  readonly args: readonly string[] | null;
  readonly allowSyntax: readonly SyntaxFeature[];
  /** The directories the entry may run in, as canonical segments. */
  readonly cwdPrefixes: readonly (readonly string[])[];
  /** Arguments the entry never allows, exactly. */
  readonly denyArgs: readonly string[];
}

export interface ExecPolicy {
  readonly mode: ExecMode;
  readonly entries: readonly CompiledAllowlistEntry[];
  /** The digest of everything that decides what this policy allows. A plan carries it, and a runner refuses a plan of another digest. */
  readonly digest: string;
}

export type PolicyRefusal = 'POLICY_SHAPE' | 'POLICY_MODE' | 'POLICY_ENTRIES' | 'ENTRY_SHAPE' | 'ENTRY_PATTERN' | 'ENTRY_ARGS' | 'ENTRY_SYNTAX' | 'ENTRY_CWD' | 'ENTRY_OPEN_ARGS' | 'NOT_HASHABLE';
export type CompileResult = { readonly ok: true; readonly policy: ExecPolicy } | { readonly ok: false; readonly code: PolicyRefusal; readonly detail: string };

const COMPILED = new WeakSet<object>();
const no = (code: PolicyRefusal, detail: string): CompileResult => ({ ok: false, code, detail });

type EntryResult = { readonly ok: true; readonly entry: CompiledAllowlistEntry } | { readonly ok: false; readonly result: CompileResult };

/** The canonical segments of each directory an entry may run in, or `null` if one is relative, a network path, or has no canonical form. */
function cwdPrefixesOf(raw: unknown): readonly (readonly string[])[] | null {
  const list = snapshotOfArray(raw, MAX_ENTRY_CWDS);
  if (list === null || list.length === 0) return null;
  const prefixes: (readonly string[])[] = [];
  for (const item of list) {
    const canonical = canonicalPathOf(item);
    if (!canonical.ok || canonical.value.rootLength === 2) return null;
    prefixes.push(Object.freeze([canonical.value.style, ...canonical.value.segments]));
  }
  return Object.freeze(prefixes);
}

function entryOf(raw: unknown, index: number): EntryResult {
  const fail = (code: PolicyRefusal, detail: string): EntryResult => ({ ok: false, result: no(code, `allowlist[${index}]: ${detail}`) });
  const fields = snapshotOfFields(raw, ['pattern', 'args', 'anyArgs', 'allowSyntax', 'cwdPrefixes', 'denyArgs']);
  if (fields === null) return fail('ENTRY_SHAPE', 'an entry is a plain object of pattern, args, anyArgs, allowSyntax, cwdPrefixes and denyArgs');
  const compiled = compileExecAllowlistPattern(fields['pattern']);
  if (!compiled.ok) return fail('ENTRY_PATTERN', `the pattern cannot be read completely: ${compiled.refusal}`);
  const cwdPrefixes = cwdPrefixesOf(fields['cwdPrefixes']);
  if (cwdPrefixes === null) return fail('ENTRY_CWD', 'cwdPrefixes names one to eight absolute directories with a canonical form, none a network path');
  const hasArgs = fields['args'] !== undefined;
  if (hasArgs === (fields['anyArgs'] !== undefined) || (fields['anyArgs'] !== undefined && fields['anyArgs'] !== true)) {
    return fail('ENTRY_ARGS', 'an entry names its arguments exactly, or says anyArgs: true, and not both');
  }
  const args = hasArgs ? snapshotOfArray(fields['args'], MAX_ENTRY_ARGS) : null;
  if (hasArgs && (args === null || args.some((arg) => typeof arg !== 'string'))) return fail('ENTRY_ARGS', 'args is a plain array of text within the cap');
  const denied = fields['denyArgs'] === undefined ? [] : snapshotOfArray(fields['denyArgs'], MAX_ENTRY_ARGS);
  if (denied === null || denied.some((arg) => typeof arg !== 'string')) return fail('ENTRY_ARGS', 'denyArgs is a plain array of text within the cap');
  const syntax = fields['allowSyntax'] === undefined ? [] : snapshotOfArray(fields['allowSyntax'], ALLOWABLE_SYNTAX.length);
  if (syntax === null || syntax.some((word) => !ALLOWABLE_SYNTAX.includes(word as SyntaxFeature)) || new Set(syntax).size !== syntax.length) {
    return fail('ENTRY_SYNTAX', `allowSyntax names only ${ALLOWABLE_SYNTAX.join(' and ')}: chaining, substitution and grouping can never be allowed`);
  }
  if (args === null && !openArgsEntryAllowed(compiled.pattern.canonical)) {
    return fail('ENTRY_OPEN_ARGS', 'anyArgs is not allowed for a tool that can run or write what it is handed, or for a pattern that could name one: name the exact arguments');
  }
  return {
    ok: true,
    entry: Object.freeze({
      pattern: compiled.pattern,
      args: args === null ? null : Object.freeze([...(args as readonly string[])]),
      allowSyntax: Object.freeze([...(syntax as readonly SyntaxFeature[])]),
      cwdPrefixes,
      denyArgs: Object.freeze([...(denied as readonly string[])]),
    }),
  };
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
  const digest = computerDigest({
    schema: 'exec-policy/1',
    mode: fields['mode'],
    entries: entries.map((entry) => ({ pattern: entry.pattern.canonical, args: entry.args, allowSyntax: entry.allowSyntax, cwdPrefixes: entry.cwdPrefixes, denyArgs: entry.denyArgs })),
  });
  if (digest === null) return no('NOT_HASHABLE', 'the policy could not be written as canonical JSON');
  const policy: ExecPolicy = Object.freeze({ mode: fields['mode'] as ExecMode, entries: Object.freeze(entries), digest });
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

/**
 * Tools that run or write what they are handed: an entry for one needs EXACT arguments, and `anyArgs: true` on one is refused when
 * the policy is compiled. The list is the tools the review named plus the ones that run a program, a script or a remote command.
 */
const EXACT_ONLY = new Set([
  'sed', 'gsed', 'make', 'gmake', 'rsync', 'zip', 'unzip', '7z', '7za', 'scp', 'ssh', 'nc', 'ncat', 'socat', 'tee', 'dd', 'cp', 'mv', 'rm', 'chmod', 'chown', 'install', 'ln', 'perl', 'cmake', 'ninja',
  'gradle', 'mvn', 'npm', 'pnpm', 'yarn', 'pip', 'cargo', 'curl', 'wget', 'tar', 'git', 'find', 'xargs', 'awk', 'gawk', 'mawk', 'nawk',
]);

/** A long option, by its full name or by any abbreviation of it: `--checkpoint-ac=` is `--checkpoint-action`, `--out=` is `--output`. */
const longOption = (arg: string, names: readonly string[]): boolean => {
  if (!arg.startsWith('--')) return false;
  const name = arg.slice(2).split('=')[0] as string;
  return name.length >= 2 && names.some((candidate) => candidate.startsWith(name));
};
/** A short option cluster that holds any of `letters`, anywhere in it: `-sSLO` holds O, `-ccore.pager=x` holds c. */
const shortOption = (arg: string, letters: string): boolean => /^-[A-Za-z0-9]/.test(arg) && [...arg.slice(1)].some((letter) => letters.includes(letter));

/** Per tool: whether one argument runs a program or writes a file. A second defence behind the compile-time refusal of `anyArgs`. */
const ARG_RUNS_SOMETHING: Readonly<Record<string, (arg: string) => boolean>> = {
  git: (arg) =>
    shortOption(arg, 'cCx') ||
    longOption(arg, ['exec', 'exec-path', 'config', 'config-env', 'upload-pack', 'receive-pack', 'git-dir', 'work-tree', 'ext-diff', 'no-index', 'output']) ||
    arg === 'config' ||
    arg === 'run' ||
    arg.startsWith('alias.'),
  find: (arg) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(arg),
  tar: (arg) =>
    shortOption(arg, 'I') || longOption(arg, ['checkpoint-action', 'to-command', 'use-compress-program', 'rsh-command', 'info-script', 'new-volume-script']),
  curl: (arg) =>
    shortOption(arg, 'oOKTD') ||
    longOption(arg, ['output', 'output-dir', 'remote-name', 'remote-name-all', 'remote-header-name', 'config', 'upload-file', 'dump-header', 'create-dirs', 'cookie-jar', 'libcurl', 'etag-save', 'hsts']),
  wget: (arg) =>
    shortOption(arg, 'oOPie') || longOption(arg, ['output-document', 'output-file', 'append-output', 'directory-prefix', 'input-file', 'post-file', 'execute', 'rejected-log']),
};

/** Whether these arguments of this tool run a program or write a file: any argument of a tool that needs exact arguments, or an argument form of the named tools. */
export function execArgsRunSomething(tool: string, args: readonly string[]): boolean {
  const runs = ARG_RUNS_SOMETHING[tool];
  if (runs !== undefined) return args.some(runs) || (tool === 'tar' && /^[A-Za-z]*I[A-Za-z]*$/.test(args[0] ?? ''));
  return EXACT_ONLY.has(tool);
}

/** Whether the arguments of a command are ones an `anyArgs` entry may allow. */
function openArgsAllowed(prepared: PreparedExec, entry: CompiledAllowlistEntry): boolean {
  const tool = normalizeExecutableToken(prepared.executable);
  const rest = prepared.argv.slice(1);
  if (EXACT_ONLY.has(tool)) return false;
  if (entry.denyArgs.some((denied) => rest.includes(denied))) return false;
  return !execArgsRunSomething(tool, rest);
}

/** Whether an entry with `anyArgs: true` may name this pattern: never a wildcard in the tool name, a tool that needs exact arguments, or a shell, interpreter or launcher. */
function openArgsEntryAllowed(canonicalPattern: string): boolean {
  const base = canonicalPattern.split(/[\\/]/).pop() ?? '';
  return !/[*?]/.test(base) && !EXACT_ONLY.has(normalizeExecutableToken(base)) && executableBlockReason(canonicalPattern) === null;
}

/** Whether the command's working directory is under one of the entry's, by whole segments, and is a canonical local path. */
function cwdAllowed(prepared: PreparedExec, entry: CompiledAllowlistEntry): boolean {
  const canonical = canonicalPathOf(prepared.cwd);
  if (!canonical.ok || canonical.value.rootLength === 2) return false;
  const have = [canonical.value.style, ...canonical.value.segments];
  return entry.cwdPrefixes.some((prefix) => prefix.length <= have.length && prefix.every((segment, index) => segment === have[index]));
}

/** Whether every environment name of the command is on the allow-list. `prepare` already admitted them; an allowlist hit asks again. */
const envAllowed = (prepared: PreparedExec): boolean => prepared.envNames.every((name) => deniedEnvName(name) === null);

function hitOf(policy: ExecPolicy, prepared: PreparedExec): CompiledAllowlistEntry | null {
  return (
    policy.entries.find(
      (entry) =>
        entry.pattern.matches(prepared.executable) &&
        (entry.args === null ? openArgsAllowed(prepared, entry) : sameWords(entry.args, prepared.argv.slice(1))) &&
        cwdAllowed(prepared, entry) &&
        envAllowed(prepared) &&
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

/**
 * THE ONE GATE. Whether a plan of this kind may be made for this command under this policy and registry. An allowlist plan
 * needs an allowlist hit; a grant plan needs only that the policy did not refuse. Both go through `evaluateExecPolicy`.
 */
export function gateExecPolicy(policy: ExecPolicy, registry: ActionRegistry, prepared: PreparedExec, via: ExecLaunchPlan['via']): { readonly ok: boolean; readonly decision: ExecDecision } {
  const evaluated = evaluateExecPolicy(policy, registry, prepared);
  return { ok: via === 'allowlist' ? evaluated.outcome === 'allowlist-hit' : evaluated.outcome !== 'refuse', decision: evaluated };
}

export type PlanResult =
  | { readonly ok: true; readonly plan: ExecLaunchPlan; readonly decision: ExecDecision }
  | { readonly ok: false; readonly decision: ExecDecision | null; readonly code: 'NO_TENANT_BINDING' | 'WRONG_SCOPE' | 'NOT_AN_ALLOWLIST_HIT' | 'CLOCK' };

/** A launch plan for a command on an allowlist hit, good for a minute. Any other outcome is not a plan. */
export function planAllowlistedExec(binding: TenantBinding, policy: ExecPolicy, registry: ActionRegistry, prepared: PreparedExec, clock: ComputerClock): PlanResult {
  if (!isDerivedBinding(binding)) return { ok: false, decision: null, code: 'NO_TENANT_BINDING' };
  const gate = gateExecPolicy(policy, registry, prepared, 'allowlist');
  if (!gate.ok) return { ok: false, decision: gate.decision, code: 'NOT_AN_ALLOWLIST_HIT' };
  if (prepared.tenant !== binding.tenant || prepared.project !== binding.projectId) return { ok: false, decision: gate.decision, code: 'WRONG_SCOPE' };
  const now = readComputerClock(clock);
  if (now === null) return { ok: false, decision: gate.decision, code: 'CLOCK' };
  return { ok: true, plan: mintExecLaunchPlan(prepared, 'allowlist', null, now + PLAN_TTL_MS, policy.digest), decision: gate.decision };
}

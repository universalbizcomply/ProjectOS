// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-command-resolution.ts; src/infra/exec-approvals-core.ts; src/infra/exec-argv-analysis.ts; src/infra/exec-safety.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the shape of a command binding is taken, argv and cwd and an environment key list bound together under one SHA-256 (`buildCwdBoundHashedArgPattern`, `SystemRunApprovalBinding`), and the refusal of shell syntax in a configured executable (`isSafeExecutableValue`); the hash now covers the tenant, the project, the agent, the exact cwd, the sorted environment NAMES, the run limits, the argument list as asked and the argument list as launched, with the real executable path, all as canonical JSON instead of a NUL-joined string; the executable lookup, the realpath calls, the platform switch and the allowlist matching live elsewhere or are cut, the lookup being an injected port; a command line is read by commandLine.ts and a launcher is unwrapped by wrapperResolution.ts
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * One command, prepared: read once, made canonical, resolved through a port, and hashed.
 *
 * THE HASH IS OF WHAT RUNS. It covers every input that decides what happens, as canonical JSON: the tenant and project, the
 * agent, the exact bytes of the working directory, the environment NAMES, the run limits, the argument list as asked, the
 * argument list as launched and the real path of the executable. It is not the hash of a launch string, so two commands that
 * differ by one byte anywhere in any of those never share a hash, and no field can be moved across a boundary.
 *
 * NOTHING THE CALLER SAYS IS A BOUND. The limits are numbers this module holds to its own caps and refuses past them. The
 * tenant and project are those of a derived binding. The real executable is what the resolver port reports, not what the
 * request says it is. The prepared value is minted here and nowhere else, so a value of the same shape built by hand is not
 * one.
 *
 * NO SHELL RUNS. A request names an argument list, or a command line that is read into one. The launched list is the real
 * executable and its arguments, with every launcher unwrapped away, so what is judged is what runs.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the resolver port's real path is the file it names, and that it is still that file when
 * the command is launched, are the port's and the runner's. The hash catches a path that changed between the decision and
 * the launch; it cannot catch one that changes after.
 *
 * Pure: no I/O.
 */
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { digestOfCanonical } from './canonicalJson.js';
import { analyzeCommandLine, ALLOWABLE_SYNTAX, type SyntaxFeature } from './commandLine.js';
import { admitExecEnvNames } from './execEnv.js';
import { canonicalPathOf } from './pathCanon.js';
import { snapshotOfArray, snapshotOfFields } from './plainFields.js';
import { resolveWrapperPlan } from './wrapperResolution.js';

export const MAX_ARGV_ENTRIES = 256;
export const MAX_ARG_CHARS = 8192;
export const MAX_EXEC_TIMEOUT_MS = 600_000;
export const MAX_EXEC_OUTPUT_BYTES = 1_048_576;
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const REQUEST_FIELDS = ['agentId', 'argv', 'commandLine', 'cwd', 'envNames', 'timeoutMs', 'maxOutputBytes'] as const;

/** Where the real executable is found. Core has no file system, so a caller hands one in; a fake stands in for tests. */
export interface ExecutableResolverPort {
  readonly resolve: (rawExecutable: string, cwd: string) => { readonly resolvedRealPath: unknown } | null;
}

export type PrepareRefusal =
  | 'NO_TENANT_BINDING'
  | 'REQUEST_SHAPE'
  | 'AGENT_ID'
  | 'COMMAND_FORM'
  | 'ARGV_SHAPE'
  | 'COMMAND_LINE'
  | 'CWD'
  | 'ENV'
  | 'LIMITS'
  | 'WRAPPER'
  | 'EXECUTABLE_UNRESOLVED'
  | 'EXECUTABLE_PATH'
  | 'NOT_HASHABLE';

export interface PreparedExec {
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly cwd: string;
  readonly envNames: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** The words as asked, after a command line was read into them. */
  readonly sourceArgv: readonly string[];
  /** The executable's real path, and then its arguments: what the runner launches. */
  readonly argv: readonly string[];
  /** The executable's real path, as the resolver reported it. */
  readonly executable: string;
  readonly wrapperChain: readonly string[];
  readonly features: readonly SyntaxFeature[];
  /** `sha256:` of the canonical JSON of everything above. */
  readonly hash: string;
}

export type PrepareResult =
  | { readonly ok: true; readonly prepared: PreparedExec }
  | { readonly ok: false; readonly code: PrepareRefusal; readonly detail: string };

const MINTED = new WeakSet<object>();

/** Did `prepareExecCommand` produce this value? A structurally perfect copy did not. */
export function isPreparedExec(value: unknown): value is PreparedExec {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}

const no = (code: PrepareRefusal, detail: string): PrepareResult => ({ ok: false, code, detail });

const wholeNumberIn = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;

function wordsProblem(words: readonly unknown[]): string | null {
  if (words.length < 1) return 'there is no command';
  for (const word of words) {
    if (typeof word !== 'string' || word.length > MAX_ARG_CHARS || word.includes('\u0000')) return 'a word is not text, is too long or holds a NUL';
  }
  return null;
}

/** An absolute directory with no `..` and no control character. Its exact bytes are hashed, so it need not be ASCII. */
function cwdProblem(cwd: unknown): string | null {
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4096) return 'the working directory is not text of a usable length';
  if (/[\u0000-\u001f\u007f]/.test(cwd)) return 'the working directory holds a control character';
  if (!/^(?:\/|[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(cwd)) return 'the working directory is not absolute';
  if (cwd.split(/[\\/]+/).includes('..')) return 'the working directory holds a .. segment';
  return null;
}

type Read = { readonly ok: true; readonly sourceArgv: readonly string[]; readonly features: readonly SyntaxFeature[] } | { readonly ok: false; readonly result: PrepareResult };

/** The words of a request: its argument list, or the one command a line holds. */
function wordsOf(fields: Readonly<Record<string, unknown>>): Read {
  const hasArgv = fields['argv'] !== undefined;
  const hasLine = fields['commandLine'] !== undefined;
  if (hasArgv === hasLine) return { ok: false, result: no('COMMAND_FORM', 'a request names an argv or a commandLine, and not both') };
  if (hasArgv) {
    const words = snapshotOfArray(fields['argv'], MAX_ARGV_ENTRIES);
    const problem = words === null ? 'argv is not a plain array within the cap' : wordsProblem(words);
    return problem === null ? { ok: true, sourceArgv: Object.freeze([...(words as readonly string[])]), features: [] } : { ok: false, result: no('ARGV_SHAPE', problem) };
  }
  const analysis = analyzeCommandLine(fields['commandLine'], ALLOWABLE_SYNTAX);
  if (!analysis.ok) return { ok: false, result: no('COMMAND_LINE', `the line cannot be read completely: ${analysis.features.join(', ')}`) };
  const first = analysis.segments[0] as readonly string[];
  const problem = wordsProblem(first);
  return problem === null ? { ok: true, sourceArgv: first, features: analysis.features } : { ok: false, result: no('COMMAND_LINE', problem) };
}

/** The real executable of `argv`'s command, as the port reports it and only if it has a canonical spelling. */
function executableOf(resolver: ExecutableResolverPort, raw: string, cwd: string): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly result: PrepareResult } {
  let found: ReturnType<ExecutableResolverPort['resolve']>;
  try {
    found = resolver.resolve(raw, cwd);
  } catch {
    return { ok: false, result: no('EXECUTABLE_UNRESOLVED', 'the resolver port failed') };
  }
  const path = found === null ? null : found.resolvedRealPath;
  if (typeof path !== 'string') return { ok: false, result: no('EXECUTABLE_UNRESOLVED', `no real path for '${raw}'`) };
  const canonical = canonicalPathOf(path);
  return canonical.ok ? { ok: true, path } : { ok: false, result: no('EXECUTABLE_PATH', `the real path has no canonical form: ${canonical.refusal}`) };
}

/** Read a request once, and bind it to a derived tenant binding. The resolver port is asked once, for the real command. */
export function prepareExecCommand(binding: TenantBinding, request: unknown, resolver: ExecutableResolverPort): PrepareResult {
  if (!isDerivedBinding(binding)) return no('NO_TENANT_BINDING', 'the binding was not derived from the tenant registry');
  const fields = snapshotOfFields(request, REQUEST_FIELDS);
  if (fields === null) return no('REQUEST_SHAPE', 'a request is a plain object of the known fields, with no getter');
  if (typeof fields['agentId'] !== 'string' || !AGENT_ID.test(fields['agentId'])) return no('AGENT_ID', 'the agent id is not a plain word');
  const cwdIssue = cwdProblem(fields['cwd']);
  if (cwdIssue !== null) return no('CWD', cwdIssue);
  if (!wholeNumberIn(fields['timeoutMs'], MAX_EXEC_TIMEOUT_MS) || !wholeNumberIn(fields['maxOutputBytes'], MAX_EXEC_OUTPUT_BYTES)) {
    return no('LIMITS', `timeoutMs is 1 to ${MAX_EXEC_TIMEOUT_MS} and maxOutputBytes is 1 to ${MAX_EXEC_OUTPUT_BYTES}, whole numbers`);
  }
  const env = admitExecEnvNames(fields['envNames']);
  if (!env.ok) return no('ENV', `${env.code}${env.name === null ? '' : ` (${env.name})`}`);
  const words = wordsOf(fields);
  if (!words.ok) return words.result;
  const plan = resolveWrapperPlan(words.sourceArgv);
  if (!plan.ok) return no('WRAPPER', `${plan.code}: ${plan.wrapper === '' ? 'no command' : plan.wrapper}`);
  const cwd = fields['cwd'] as string;
  const executable = executableOf(resolver, plan.argv[0] as string, cwd);
  if (!executable.ok) return executable.result;
  const argv = Object.freeze([executable.path, ...plan.argv.slice(1)]);
  const body = {
    tenant: binding.tenant,
    project: binding.projectId,
    agentId: fields['agentId'] as string,
    cwd,
    envNames: env.names,
    timeoutMs: fields['timeoutMs'] as number,
    maxOutputBytes: fields['maxOutputBytes'] as number,
    sourceArgv: words.sourceArgv,
    argv,
    executable: executable.path,
    features: Object.freeze([...words.features]),
  };
  const hash = digestOfCanonical({ schema: 'exec-binding/1', ...body });
  if (hash === null) return no('NOT_HASHABLE', 'the command could not be written as canonical JSON');
  const prepared: PreparedExec = Object.freeze({ ...body, wrapperChain: plan.wrapperChain, hash });
  MINTED.add(prepared);
  return { ok: true, prepared };
}

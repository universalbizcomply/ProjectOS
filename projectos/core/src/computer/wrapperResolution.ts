// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-wrapper-trust-plan.ts; src/infra/dispatch-wrapper-resolution.ts; src/infra/shell-wrapper-resolution.ts; src/infra/exec-wrapper-tokens.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the idea of a wrapper trust plan is taken, that a launcher is unwrapped to the command that really runs, within a depth of four, and that a launcher this code cannot unwrap blocks policy instead of being allowed; the executable-name normaliser and the shell and PowerShell name lists are taken; the dispatch wrapper option tables, the Bash parser, the Windows shell rebuild, the carrier commands and the policy projection are cut; an interpreter, an elevation, a launcher that runs what it is handed, an encoded or file-based shell command and an env assignment are blocked outright, and a shell is unwrapped only in its plain inline form
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The command that really runs, behind its launchers, or the launcher that stops it.
 *
 * A LAUNCHER IS NOT THE COMMAND. `env git status`, `nohup git status`, `bash -c "git status"` and `cmd /c git status` all run
 * `git`, and the allowlist must judge `git`, not the wrapper. So the plan unwraps what it can read completely, at most four
 * deep, and BLOCKS what it cannot: a blocked plan carries the wrapper's name and a code, and nothing downstream matches it.
 *
 * BLOCKED, NOT UNWRAPPED: `sudo` and the other elevations (there is no elevated mode); `xargs`, `wsl`, `start`, `ssh`,
 * `nsenter`, `chroot` and their kind, which run what they are handed from somewhere this plan cannot see; interpreters
 * (`node`, `python`, `perl`, `ruby`, `php`, ...), whose inline code or script file is not in the argv; a shell given a script
 * file, a login or interactive flag or extra positional arguments; `powershell -enc`, `-file` and every form but a plain
 * `-command`; and `env` with an option or an assignment (a value never rides in a request: env is names only).
 *
 * WHAT THIS MODULE CANNOT PROVE. It reads names. A file called `git` that is really a shell is the resolver port's and the
 * allowlist's to catch, by the real path.
 *
 * Pure: no I/O.
 */
import { analyzeCommandLine } from './commandLine.js';

export const MAX_WRAPPER_DEPTH = 4;

export type WrapperRefusal =
  | 'EMPTY'
  | 'DEPTH'
  | 'ELEVATION'
  | 'LAUNCHER'
  | 'INTERPRETER'
  | 'SHELL_FORM'
  | 'POWERSHELL_FORM'
  | 'INLINE_SYNTAX'
  | 'ENV_FORM'
  | 'WRAPPER_FORM';

export type WrapperPlan =
  | { readonly ok: true; readonly argv: readonly string[]; readonly wrapperChain: readonly string[] }
  | { readonly ok: false; readonly code: WrapperRefusal; readonly wrapper: string; readonly wrapperChain: readonly string[] };

const POSIX_SHELLS = new Set(['ash', 'bash', 'csh', 'dash', 'elvish', 'fish', 'ksh', 'mksh', 'nu', 'osh', 'rbash', 'rksh', 'rzsh', 'sh', 'tcsh', 'xonsh', 'yash', 'zsh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const POWERSHELL_QUIET_FLAGS = new Set(['-nologo', '-noprofile', '-noninteractive']);
const POWERSHELL_COMMAND_FLAGS = new Set(['-c', '-command']);
const MULTIPLEXERS = new Set(['busybox', 'toybox']);
const ELEVATIONS = new Set(['sudo', 'doas', 'su', 'runas', 'pkexec', 'gsudo']);
const LAUNCHERS = new Set([
  'xargs', 'wsl', 'start', 'ssh', 'nsenter', 'chroot', 'unshare', 'script', 'watch', 'at', 'schtasks', 'mshta', 'rundll32', 'wscript', 'cscript', 'explorer', 'setsid', 'flock', 'time', 'exec', 'command', 'builtin',
  'find', 'awk', 'gawk', 'mawk', 'nawk', 'npx', 'pnpx', 'bunx', 'uvx', 'strace', 'ltrace', 'gdb', 'java', 'dotnet',
]);
const DISPATCH_NAMES = new Set(['env', 'nohup', 'nice', 'timeout', 'stdbuf', 'busybox', 'toybox']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'perl', 'ruby', 'php', 'lua', 'osascript', 'tclsh', 'wish', 'pythonw']);
const PYTHON = /^(?:python|pypy|py)[0-9.]*$/;

const NATIVE_SUFFIX = /\.(?:exe|cmd|bat|com|ps1|vbs|scr|lnk)$/;
const SCRIPT_SUFFIX = /\.(?:cmd|bat|ps1|vbs|com|scr|lnk)$/;

/**
 * The executable's own name: the last path segment, trailing dots and spaces dropped (Windows drops them), an alternate data
 * stream cut off, lower case, without a native suffix and without a version (`python3.11` and `ksh93` are `python` and `ksh`).
 * Source: `normalizeExecutableToken`, which kept only the basename and the native suffix.
 */
export function normalizeExecutableToken(token: string): string {
  const segments = token.split(/[\\/]/);
  let name = (segments[segments.length - 1] as string).replace(/[. ]+$/, '');
  const stream = name.indexOf(':');
  if (stream > 0) name = name.slice(0, stream);
  name = name.replace(/[. ]+$/, '').toLowerCase().replace(NATIVE_SUFFIX, '');
  const bare = name.replace(/[0-9][0-9._-]*$/, '');
  return bare === '' ? name : bare;
}

/** Why a RESOLVED executable may not be the command, or `null`: a script target, or a shell, interpreter, launcher or tool that runs what it is given. */
export function executableBlockReason(resolvedPath: string): 'EXECUTABLE_SCRIPT' | 'EXECUTABLE_BLOCKED' | null {
  const segments = resolvedPath.split(/[\\/]/);
  const last = (segments[segments.length - 1] as string).replace(/[. ]+$/, '').toLowerCase();
  if (SCRIPT_SUFFIX.test(last)) return 'EXECUTABLE_SCRIPT';
  const name = normalizeExecutableToken(resolvedPath);
  return ELEVATIONS.has(name) || LAUNCHERS.has(name) || DISPATCH_NAMES.has(name) || INTERPRETERS.has(name) || PYTHON.test(name) || POSIX_SHELLS.has(name) || POWERSHELLS.has(name) || name === 'cmd' ? 'EXECUTABLE_BLOCKED' : null;
}

const block = (code: WrapperRefusal, wrapper: string, chain: readonly string[]): WrapperPlan => ({ ok: false, code, wrapper, wrapperChain: Object.freeze([...chain]) });

type Step = { readonly kind: 'next'; readonly argv: readonly string[] } | { readonly kind: 'blocked'; readonly code: WrapperRefusal } | { readonly kind: 'command' };

const BAD_FORM: Step = { kind: 'blocked', code: 'WRAPPER_FORM' };
const NUMBER = /^[0-9]+(?:\.[0-9]+)?[smhd]?$/;
const isOption = (token: string | undefined): boolean => token === undefined || token.startsWith('-');

/** `nice [-n N | -N | --adjustment=N] command ...`. */
function unwrapNice(argv: readonly string[]): Step {
  const first = argv[1];
  if (first === '-n' || first === '--adjustment') return argv.length > 3 && /^-?[0-9]+$/.test(argv[2] ?? '') ? { kind: 'next', argv: argv.slice(3) } : BAD_FORM;
  if (first !== undefined && /^(?:-[0-9]+|--adjustment=-?[0-9]+)$/.test(first)) return argv.length > 2 ? { kind: 'next', argv: argv.slice(2) } : BAD_FORM;
  return isOption(first) ? BAD_FORM : { kind: 'next', argv: argv.slice(1) };
}

/** `timeout [--foreground] [--preserve-status] [-v] [-k DURATION] [-s SIGNAL] DURATION command ...`. */
function unwrapTimeout(argv: readonly string[]): Step {
  let index = 1;
  while (index < argv.length) {
    const token = argv[index] as string;
    const value = argv[index + 1] ?? '';
    if (['--foreground', '--preserve-status', '-v', '--verbose'].includes(token)) index += 1;
    else if ((token === '-k' || token === '--kill-after') && NUMBER.test(value)) index += 2;
    else if ((token === '-s' || token === '--signal') && /^[A-Z0-9]{1,12}$/.test(value)) index += 2;
    else break;
  }
  const duration = argv[index];
  return duration !== undefined && NUMBER.test(duration) && index + 1 < argv.length ? { kind: 'next', argv: argv.slice(index + 1) } : BAD_FORM;
}

/** `stdbuf [-i MODE | -o MODE | -e MODE]... command ...`. */
function unwrapStdbuf(argv: readonly string[]): Step {
  let index = 1;
  while (index < argv.length && ['-i', '-o', '-e'].includes(argv[index] as string) && /^(?:L|0|[0-9]+[KMG]?)$/.test(argv[index + 1] ?? '')) index += 2;
  return index < argv.length && !isOption(argv[index]) ? { kind: 'next', argv: argv.slice(index) } : BAD_FORM;
}

/** `env [--] command ...`: no option and no `NAME=value`, because a value never rides in a request. */
function unwrapEnv(argv: readonly string[]): Step {
  const rest = argv[1] === '--' ? argv.slice(2) : argv.slice(1);
  const head = rest[0];
  if (head === undefined || head.startsWith('-') || head.includes('=')) return { kind: 'blocked', code: 'ENV_FORM' };
  return { kind: 'next', argv: rest };
}

/** A plain inline form `shell -c "line"`: one command in the line, no syntax a shell would act on. */
function inlineCommand(line: string): Step {
  const analysis = analyzeCommandLine(line);
  if (!analysis.ok || analysis.segments.length !== 1) return { kind: 'blocked', code: 'INLINE_SYNTAX' };
  return { kind: 'next', argv: analysis.segments[0] as readonly string[] };
}

function unwrapShell(name: string, argv: readonly string[]): Step {
  if (POSIX_SHELLS.has(name)) return argv.length === 3 && argv[1] === '-c' ? inlineCommand(argv[2] as string) : { kind: 'blocked', code: 'SHELL_FORM' };
  if (name === 'cmd') return argv.length === 3 && (argv[1] as string).toLowerCase() === '/c' ? inlineCommand(argv[2] as string) : { kind: 'blocked', code: 'SHELL_FORM' };
  let index = 1;
  while (index < argv.length && POWERSHELL_QUIET_FLAGS.has((argv[index] as string).toLowerCase())) index += 1;
  const flag = (argv[index] ?? '').toLowerCase();
  return POWERSHELL_COMMAND_FLAGS.has(flag) && argv.length === index + 2 ? inlineCommand(argv[index + 1] as string) : { kind: 'blocked', code: 'POWERSHELL_FORM' };
}

function stepOf(name: string, argv: readonly string[]): Step {
  if (ELEVATIONS.has(name)) return { kind: 'blocked', code: 'ELEVATION' };
  if (LAUNCHERS.has(name)) return { kind: 'blocked', code: 'LAUNCHER' };
  if (INTERPRETERS.has(name) || PYTHON.test(name)) return { kind: 'blocked', code: 'INTERPRETER' };
  if (name === 'env') return unwrapEnv(argv);
  if (name === 'nohup') return isOption(argv[1]) ? BAD_FORM : { kind: 'next', argv: argv.slice(1) };
  if (name === 'nice') return unwrapNice(argv);
  if (name === 'timeout') return unwrapTimeout(argv);
  if (name === 'stdbuf') return unwrapStdbuf(argv);
  if (MULTIPLEXERS.has(name)) return isOption(argv[1]) ? BAD_FORM : { kind: 'next', argv: argv.slice(1) };
  if (POSIX_SHELLS.has(name) || name === 'cmd' || POWERSHELLS.has(name)) return unwrapShell(name, argv);
  return { kind: 'command' };
}

/** The command behind `argv`'s launchers, or the launcher that blocks it. The depth is this module's, not the caller's. */
export function resolveWrapperPlan(argv: readonly string[]): WrapperPlan {
  const chain: string[] = [];
  let current: readonly string[] = argv;
  for (let depth = 0; depth <= MAX_WRAPPER_DEPTH; depth += 1) {
    const head = current[0];
    if (head === undefined || head.trim() === '') return block('EMPTY', '', chain);
    const name = normalizeExecutableToken(head);
    const step = stepOf(name, current);
    if (step.kind === 'command') return { ok: true, argv: Object.freeze([...current]), wrapperChain: Object.freeze([...chain]) };
    if (step.kind === 'blocked') return block(step.code, name, chain);
    if (depth === MAX_WRAPPER_DEPTH) return block('DEPTH', name, chain);
    chain.push(name);
    current = step.argv;
  }
  return block('DEPTH', normalizeExecutableToken(current[0] ?? ''), chain);
}

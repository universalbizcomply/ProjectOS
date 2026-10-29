/**
 * The worker seam: which workers this project authorises, and how one is started or rejoined.
 *
 * THE SEAM IS THE POINT. Adding a second authorised worker must be a change to a project's config,
 * not a change to the loop — so the loop never names a worker, it resolves one. What stays in code is
 * the ADAPTER for a kind of worker (how you start a Claude Code CLI session), because that genuinely
 * is code. What lives in config is which workers exist, where their executables are, and which one is
 * the default.
 *
 * ABSOLUTE EXECUTABLES ONLY. On Windows an unqualified command name resolves against the spawning
 * process's current directory before PATH, and the loop's current directory IS the governed checkout —
 * content that is untrusted until the owner reviews it. A `claude.exe` committed to a repository must
 * never become that repository's worker. This is the same rule `system.ts` applies to git, for the
 * same reason, and it is enforced when the config is READ so a bad entry can never reach a spawn.
 *
 * NO METERED API. `use-anthropic-api` is a forbidden action for this project, and a worker
 * configuration that carried an API key would quietly convert the loop into an API client. Any
 * credential-shaped argument is refused at load time rather than passed on.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { lstatSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import type { System } from '../system.js';
import type { GovernedContext } from '../governedContext.js';
import type { WorkerBrief } from './brief.js';
import { isClosureTailPath } from '@projectos/core';

/** A worker the project's config authorises. */
export interface AuthorisedWorker {
  readonly workerId: string;
  readonly kind: string;
  /** Absolute path to the executable. Never a bare name — see the module note. */
  readonly command: string;
  readonly args: readonly string[];
  /**
   * How long ONE attempt with this worker may run before it is ended.
   *
   * WHY A BOUND EXISTS AT ALL. The runtime starts a worker and waits for it, synchronously. With no
   * bound that wait is unlimited: a worker that hangs holds the phase, the run and the process
   * forever, and nothing inside ProjectOS can end it — the only remedy is killing the run from
   * outside, which leaves no truthful account of what happened.
   *
   * WHY IT IS CONFIGURATION AND NOT ONLY A CONSTANT. A generous default is right for the workers
   * this project runs today, and wrong the first time somebody's phase legitimately takes longer.
   * This lives in the `execution` block, which `committedExecutionProblems` already compares against
   * the committed file — so raising a worker's bound requires a commit, which is where review is.
   */
  readonly timeoutMs: number;
}

export interface WorkerSession {
  /**
   * The invocation that started this worker. Absent only on sessions written before the provenance
   * control existed — those stay unattributable, and are not to be back-filled.
   */
  readonly invocationId?: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly kind: string;
  readonly phaseId: string;
  readonly briefId: string;
  readonly briefPath: string;
  readonly startedAt: string;
  /** What the adapter recorded as its own handle on the run, when it has one. */
  readonly providerRef: string | null;
  readonly state: 'started' | 'rejoined' | 'exited';
  readonly exitCode: number | null;
  /**
   * Whether the attempt was ended for running past its bound.
   *
   * A NULL EXIT CODE CANNOT SAY THIS. It is also what a refusal leaves behind, so without this field
   * the durable record of a killed run and a declined run are the same record. Optional because
   * sessions written before the bound existed cannot answer it, and they are not to be back-filled.
   */
  readonly timedOut?: boolean;
  /**
   * Correction attempts spent in the LAST invocation. It is recorded for the reader, not consumed as
   * a running total: the bound is per invocation, so re-running after a human has looked at the
   * failure starts a fresh budget. That is deliberate — the human deciding to try again is the gate,
   * and a permanently exhausted session would be a phase nobody could ever retry.
   */
  readonly corrections: number;
}

export type WorkerOutcome =
  | {
      /**
       * The attempt ran past its bound and was ended.
       *
       * A SEPARATE KIND, NOT AN EXIT CODE AND NOT A REFUSAL. A killed worker has no exit status to
       * report, so representing it as one would mean inventing a number. And it is not a refusal: a
       * refusal is a worker saying something about the task, which the routing table treats as
       * evidence about the brief. A timeout says nothing about the brief — it says the run did not
       * finish, and whatever it left behind is a partial account of work that was cut off.
       *
       * `stdout`/`stderr` are what the worker had produced when it was ended. They are recorded
       * because they may explain the hang; they are never read as a completed run's output, and no
       * handle is taken from them, so a timed-out attempt cannot be rejoined as if it had reported one.
       */
      readonly kind: 'timedOut';
      readonly afterMs: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: 'completed';
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      /**
       * The worker's own handle on the run, when it reported one. Null means this run cannot be
       * rejoined — which is a fact to record, not a detail to paper over: a later "reconnect" that
       * silently started a fresh worker would lose the first one's work without saying so.
       */
      readonly providerRef: string | null;
    }
  | { readonly kind: 'refused'; readonly detail: string };

/**
 * How a kind of worker is started and rejoined.
 *
 * `start` and `rejoin` are separate because they are different governance events, not because the
 * mechanics differ: starting creates a session record, rejoining must find one and refuse if the world
 * moved under it.
 */
export interface WorkerAdapter {
  readonly kind: string;
  start(sys: System, worker: AuthorisedWorker, brief: WorkerBrief, briefPath: string): WorkerOutcome;
  /**
   * Resume a run. The CURRENT brief is passed alongside the session because the session record is a
   * file the spawned worker can write to: the handle to resume is all that may be taken from it, and
   * where to work and what to read must come from the brief the loop just verified and wrote.
   */
  rejoin(sys: System, worker: AuthorisedWorker, session: WorkerSession, brief: WorkerBrief): WorkerOutcome;
  /**
   * Run this worker as the independent REVIEWER (D11) with the loop's fixed review instruction. Its
   * output is read by the loop; nothing it writes is trusted. Absent on a kind that cannot review.
   */
  review?(sys: System, worker: AuthorisedWorker, brief: WorkerBrief, instruction: string): WorkerOutcome;
}

export type AdapterRegistry = Readonly<Record<string, WorkerAdapter>>;

/* ---------------------------------------------------------------------------------------------- *
 * Reading the authorised workers.
 * ---------------------------------------------------------------------------------------------- */

export type WorkerResolution =
  | { readonly ok: true; readonly worker: AuthorisedWorker; readonly adapter: WorkerAdapter }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Windows drive-qualified (`C:\x`, `C:/x`) or POSIX absolute. A bare name or relative path is not. */
function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/** Anything that looks like a credential being handed to a worker. */
const CREDENTIAL_SHAPED = /(api[_-]?key|token|secret|password|bearer)/i;

/**
 * The bound one worker attempt gets when the project states none.
 *
 * DELIBERATELY GENEROUS. The purpose of this number is to make "forever" impossible, not to police
 * how long honest work takes: a bound tight enough to kill a real phase would be a new way for the
 * loop to fail, and the failure would look like the worker's fault. Ninety minutes is far beyond any
 * attempt this runtime has recorded and still finite, which is the whole property being bought. A
 * project whose phases genuinely run longer raises it in its committed config rather than losing the
 * bound.
 */
export const DEFAULT_WORKER_TIMEOUT_MS = 90 * 60 * 1000;

/** The widest bound a project may declare. Past this the value is not a bound, it is a decoration. */
export const MAX_WORKER_TIMEOUT_MS = 6 * 60 * 60 * 1000;
/** Below this a worker cannot plausibly start, so such a value is a mistake, not a policy. */
export const MIN_WORKER_TIMEOUT_MS = 1000;

/**
 * The only file-writing authority a worker may be granted, and the reason it is a closed list.
 *
 * A RUN HAS TWO OWNERS. The worker owns what it ASSERTS — its findings and its effects attestation.
 * ProjectOS owns what it STATES and what it OBSERVES — the brief the worker is judged against, the
 * session record naming who owns the run, and the evidence collected about it. A worker that could
 * rewrite the brief could change the contract it is measured by; one that could rewrite the evidence
 * could launder its own run. Neither is a thing to leave to a pattern nobody checks.
 *
 * So the grant is not merely narrow by convention — it is enumerated here, and any Write or Edit
 * authority that is not exactly one of these is REFUSED when the config is read. `.projectops/
 * execution/**` was the original grant and is exactly the kind of quiet widening this refuses.
 */
export const WORKER_OWNED_RECORD_GRANTS: readonly string[] = [
  'Write(.projectops/execution/*.findings.json)',
  'Edit(.projectops/execution/*.findings.json)',
  'Write(.projectops/execution/*.effects.json)',
  'Edit(.projectops/execution/*.effects.json)',
  // THE PROOF SURFACE, and nothing else in the repository.
  //
  // A worker that may write only its own findings and attestation cannot REPAIR anything, so the
  // correction cycle — a failing check going back to the worker and coming out fixed — had no way to
  // be demonstrated, or to happen. This adds one narrow governance path so a phase can carry a
  // fixture the worker is allowed to correct. It is still a closed list: `.projectops/proof/*.json`
  // holds no product code, no plan, no authority record and no configuration, so widening this does
  // not widen what a worker can reach in the project it is working on.
  'Write(.projectops/proof/*.json)',
  'Edit(.projectops/proof/*.json)',
];

/**
 * WHAT A PHASE'S IMPLEMENTER MAY WRITE: EXACTLY THE APPROVED PHASE'S `writePaths` — PROJECTOS-BOOT-CONTINUE1A
 * (continuation five), made structured by PROJECTOS-FINISH-WRITEPATHS1A.
 *
 * WHAT THIS REPLACES. A worker could write only its own records, plus a closed list of Speed-programme
 * paths released by a committed owner record (`.projectops/authority/worker-source-grant.json`). That
 * record was temporary, its programme is closed, and it never matched what an ordinary phase needs: the
 * worker of a phase could not write the files the owner approved the phase to change. It is RETIRED —
 * the list, the record reader and the record — and nothing of it remains as a second grant route.
 *
 * WHERE THE GRANT COMES FROM NOW. The ACTIVE APPROVED PLAN's `writePaths` list for the phase being run,
 * read by the runtime, never by the worker, and added to the implementer's argv at dispatch. A phase
 * without the list grants nothing beyond the worker-owned records. The configuration still may declare
 * nothing wider than those records.
 *
 * WHY A LIST, NOT THE SCOPE. The grant used to be read out of the phase's `scope` sentence, and a
 * sentence can say where NOT to go — so every scope carrying exclusion wording had to be refused against
 * an open-ended list of negations, which is a denylist and never complete. The scope is now prose for
 * people and nothing reads it for a grant: each list entry is exactly one path, judged on its own.
 *
 * HOW EACH ENTRY IS JUDGED, AND WHY IT IS THIS STRICT. Any of these refuses the WHOLE run — a grant that
 * quietly lost or widened a path is not the grant the owner approved, and refusing is the cheap direction
 * (the owner amends the list):
 *  - an entry that is not a non-empty string;
 *  - any character outside letters, digits, `_ . - / \` — a glob (`*`, `?`, `[`, `{`), a space, a URL, a
 *    lookalike letter; widening it instead once turned `dir/*.ts` into `dir/**`;
 *  - a bare filename with no directory (`README.md`): a rule with no slash may match the same name at
 *    any depth, including inside the governance tree — write it as `./README.md`;
 *  - absolute paths, drive letters and any `:` (a Windows alternate data stream is a `:` too);
 *  - `.`, `..` and empty segments (a single leading `./` is allowed and removed), `~` (8.3 short names
 *    alias long ones) and segments ending in a dot or a space (Windows strips both, so `a.` IS `a`);
 *  - anything that resolves outside the governed root;
 *  - any existing component that is a symbolic link or junction;
 *  - any existing component whose on-disk case differs from the entry's;
 *  - a segment, at ANY depth, that is `.git*`, `.claude`, `.husky` or `.vscode` — repository databases and
 *    hooks and settings that run outside every permission this grant is built from — or a Windows
 *    device name (`con`, `nul`, `aux`, `com1`…);
 *  - under `.projectops`, anything but a file under `.projectops/proof/`: the other governance files are
 *    the trust roots themselves (delegations, the gatekeeper's spend ceilings, the worker's own argv),
 *    and the runtime's records are the evidence that judges the worker — the owner edits those;
 *  - a closure record (`knowledge/reports/` and the other closure-tail paths): those are excluded from
 *    every "changed since the subject" judgement, so a worker able to write them could satisfy G4 unseen;
 *  - a DIRECTORY that is, is inside, or contains `.projectops`, `projectos/validators` or a closure-record
 *    root: those are writable only file by file, and only when the list names the file itself;
 *  - a DIRECTORY with anything git-ignored beneath it, or a package root (`package.json`, `Cargo.toml`)
 *    beneath it: ignored build output (`dist/`, `node_modules/`, `target/`) is executed by the runtime
 *    and invisible to every git-based check, so a directory grant over it would be unreviewable.
 * A path is a DIRECTORY only when the entry ends in `/` or it already exists on disk as one.
 */
export const FILE_ONLY_ROOTS: readonly string[] = ['.projectops', 'projectos/validators', 'knowledge/reports'];

/** Never writable by a worker, at any depth, whatever an approved list names. Matched per segment. */
const NEVER_WRITABLE_SEGMENT = /^(?:\.git.*|\.claude|\.husky|\.vscode|con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;

/**
 * Agent instruction files, matched on the final segment — FINISH-WRITEPATHS1A (ECC SECURITY M3). An agent
 * reading the repository later loads these as instructions, so a worker able to plant one could steer the
 * next worker or reviewer. Never a write path, and never created or changed under a directory grant.
 */
const AGENT_INSTRUCTION_FILE = /^(?:CLAUDE|AGENTS|GEMINI)(?:\.local)?\.md$/i;

/**
 * The only `.projectops` FILES a write path may grant: governance the owner declares, never runtime records.
 * Entries ending in `/` admit files beneath them; the others are exact.
 */
const PROJECTOPS_DECLARABLE: readonly string[] = ['.projectops/proof/'];

/** The characters a write path may contain. Anything else refuses the run. */
const PATH_WORD = /^[A-Za-z0-9_.\-/\\]+$/;

export interface PhaseWriteGrant {
  /** The `Write(...)`/`Edit(...)` grants, two per path. */
  readonly grants: readonly string[];
  /** The normalised write paths the grants cover; a directory ends in `/**`. */
  readonly paths: readonly string[];
  /** Why the list cannot become a grant. Non-empty refuses the run. */
  readonly problems: readonly string[];
}

/**
 * What git says about a path a write path would grant, or null when that cannot be established. `ignored` is
 * true when the path itself is git-ignored or, for a directory, anything beneath it is; `packageRoot`
 * when a tracked `package.json` or `Cargo.toml` lies beneath it. Injected so the rule runs on the
 * runtime's own `System`; `null` refuses the grant.
 */
export type DirectoryInspector = (rel: string) => { readonly ignored: boolean; readonly packageRoot: boolean } | null;

/** The production inspector, from git. */
export function gitDirectoryInspector(sys: System, root: string): DirectoryInspector {
  return (rel) => {
    const beneath = gitIgnoredUnder(sys, root, [rel]);
    // `check-ignore` answers for a path that does not exist yet, which `status` cannot: 0 = ignored,
    // 1 = not ignored, anything else = git could not say.
    const itself = sys.exec('git', ['-C', root, 'check-ignore', '-q', '--no-index', '--', rel]);
    const tracked = sys.exec('git', ['-C', root, 'ls-files', '--', rel]);
    // A check that timed out or never started reports a code too; it is not an answer.
    if (beneath === null || itself.failure !== undefined || (itself.code !== 0 && itself.code !== 1) || tracked.code !== 0) return null;
    return {
      ignored: beneath.length > 0 || itself.code === 0,
      packageRoot: tracked.stdout.split(/\r?\n/).some((l) => /(?:^|\/)(?:package\.json|Cargo\.toml)$/.test(l.trim())),
    };
  };
}

/**
 * Every entry at or beneath these paths that git-based checks cannot see into, or null when git cannot
 * say. The loop takes this before and after each worker attempt; anything new is work no review could see:
 *  - a git-ignored entry (`!!`) — invisible to the candidate, the diff, the clean-tree check and G4;
 *  - an untracked DIRECTORY entry even under `--untracked-files=all` (`?? dir/`) — a nested repository,
 *    whose contents git will not list;
 *  - any entry with a `.git*` segment — a new ignore rule, attribute or repository inside the grant;
 *  - any entry with a hook or settings segment (`.claude`, `.husky`, `.vscode`) or a device name, or that
 *    is an agent instruction file — FINISH-WRITEPATHS1A (ECC SECURITY M3): a directory grant names only its
 *    root, so what the entry rules refuse must also be refused when it appears beneath one.
 */
export function gitIgnoredUnder(sys: System, root: string, paths: readonly string[]): readonly string[] | null {
  if (paths.length === 0) return [];
  const r = sys.exec('git', ['-C', root, 'status', '--porcelain', '--ignored', '--untracked-files=all', '--', ...paths]);
  if (r.code !== 0 || r.failure !== undefined) return null;
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.length > 3)
    .filter((l) => {
      const path = l.slice(3).trim().replace(/^"|"$/g, '');
      return (
        l.startsWith('!! ') ||
        (l.startsWith('?? ') && path.endsWith('/')) ||
        path.split('/').some((seg) => /^\.git/i.test(seg)) ||
        path.replace(/\/$/, '').split('/').some((seg) => NEVER_WRITABLE_SEGMENT.test(seg)) ||
        AGENT_INSTRUCTION_FILE.test(path.replace(/\/$/, '').split('/').pop() ?? '')
      );
    })
    .map((l) => l.slice(3).trim())
    .sort();
}

/**
 * The FILE grants among a worker's argv grants that are no longer a regular file (or absent) on disk —
 * FINISH-WRITEPATHS1A (ECC SECURITY M4). A grant for a path that did not exist yet names a file, but a
 * permission rule matching a path also matches everything beneath it, so a worker could make it a
 * directory and fill it — past the rule that keeps directory grants away from governance and validator
 * roots, and past the ignored-content inspection a directory grant gets. Globs (the worker's own records)
 * and directory grants (`/**`) are not file grants. Never throws.
 */
export function fileGrantsNotFiles(root: string, grants: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const rel of grantedPaths(grants)) {
    if (rel.includes('*') || grants.some((g) => g.endsWith(`(${rel}/**)`))) continue;
    try {
      if (!lstatSync(resolvePath(root, ...rel.replace(/^\.[/]/, '').split('/'))).isFile()) out.push(rel);
    } catch {
      // Absent: the worker did not create the file. That is not a breach.
    }
  }
  return out.sort();
}

const ALLOWED_TOOLS_FLAGS: readonly string[] = ['--allowedTools', '--allowed-tools'];

/**
 * Every tool grant on a worker's argv, in every form the CLI accepts.
 *
 * THE CLI'S FLAG IS VARIADIC: `--allowedTools <tools...>`, "comma or space-separated", repeatable.
 * Reading only the next argument and splitting only on commas let `--allowedTools Read Bash` grant a
 * shell this check never saw (ECC SECURITY M5, Agency IAM F1). So every argument after the flag, up to
 * the next flag, is read, each split on commas AND whitespace, for every occurrence. The `--flag=value`
 * form is read too, and refused separately by `toolGrantProblems`.
 */
export function argvGrants(args: readonly string[]): readonly string[] {
  const out: string[] = [];
  // Separators inside a grant's parentheses belong to the grant: `Bash(rm -rf:*)` is ONE grant.
  const add = (value: string): void => {
    let depth = 0;
    let current = '';
    for (const ch of value) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
        if (current !== '') out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current !== '') out.push(current);
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const eq = ALLOWED_TOOLS_FLAGS.find((f) => arg.startsWith(`${f}=`));
    if (eq !== undefined) add(arg.slice(eq.length + 1));
    if (!ALLOWED_TOOLS_FLAGS.includes(arg)) continue;
    for (let j = i + 1; j < args.length && !(args[j] as string).startsWith('-'); j += 1) add(args[j] as string);
  }
  return out;
}

/** The repository paths a set of `Write(...)`/`Edit(...)` grants covers, as git pathspecs. */
export function grantedPaths(grants: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const g of grants) {
    const m = /^(?:Write|Edit)\((.+)\)$/.exec(g);
    if (m === null || m[1] === undefined) continue;
    out.add(m[1].replace(/^\.\//, '').replace(/\/\*\*$/, ''));
  }
  return [...out];
}

function underOrEqual(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Why one write path cannot be granted, or null — plus its normalised form and whether it is a directory. */
function judgeWritePath(
  root: string,
  word: string,
  inspectDirectory: DirectoryInspector,
  governed: readonly string[],
): { problem: string | null; rel: string; directory: boolean } {
  const fail = (why: string) => ({ problem: `write path '${word}' ${why}`, rel: word, directory: false });
  if (!PATH_WORD.test(word)) {
    return fail('contains a character outside letters, digits, "_ . - / \\"; a glob, space, URL or lookalike is not a path a grant can be built from');
  }
  const statedDirectory = /[/\\]$/.test(word);
  const rel = word.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\/(?=.)/, '');
  if (rel === '') return fail('is empty');
  if (!rel.includes('/') && !word.startsWith('./') && !statedDirectory) {
    return fail(`is a bare filename; a rule with no directory may match that name at any depth — write it as './${rel}'`);
  }
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return fail('is absolute; a write path names a path inside the governed checkout');
  if (rel.includes(':')) return fail("contains ':', which names a drive or an alternate data stream");
  const segments = rel.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return fail('contains an empty, "." or ".." segment');
    if (seg.includes('~')) return fail("contains '~', which can alias another name on this filesystem");
    if (/[. ]$/.test(seg)) return fail('has a segment ending in a dot or a space, which Windows strips');
  }
  const lower = rel.toLowerCase();
  if (AGENT_INSTRUCTION_FILE.test(segments[segments.length - 1] ?? '')) {
    return fail('is an agent instruction file, which a later worker or reviewer would load as instructions; the owner edits it');
  }
  if (segments.some((seg) => NEVER_WRITABLE_SEGMENT.test(seg))) {
    return fail('names a git control file or database, a hook or settings directory, or a device name, which no worker writes');
  }
  if (isClosureTailPath(rel, governed)) {
    return fail("is a closure record or the plan's own governed state, which every \"changed since the subject\" judgement ignores");
  }

  const absRoot = resolvePath(root);
  const target = resolvePath(absRoot, ...segments);
  if (target !== absRoot && !target.startsWith(`${absRoot}${sep}`)) return fail('resolves outside the governed checkout');

  // WALK THE EXISTING PREFIX: no link, and the exact on-disk case, at every component.
  let dir = absRoot;
  let directory = statedDirectory;
  for (const [i, seg] of segments.entries()) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      break; // The rest does not exist yet: a new path, created inside a contained existing parent.
    }
    if (!names.includes(seg)) {
      if (names.some((n) => n.toLowerCase() === seg.toLowerCase())) {
        return fail(`differs in case from '${names.find((n) => n.toLowerCase() === seg.toLowerCase())}' on disk`);
      }
      break;
    }
    const here = resolvePath(dir, seg);
    let st;
    try {
      st = lstatSync(here);
    } catch {
      return fail('could not be inspected');
    }
    if (st.isSymbolicLink()) return fail('passes through a link, which would carry the grant somewhere the list never named');
    if (i === segments.length - 1) {
      if (statedDirectory && !st.isDirectory()) return fail('is written as a directory but is a file on disk');
      directory = st.isDirectory();
    }
    dir = here;
  }
  if (directory && FILE_ONLY_ROOTS.some((r) => underOrEqual(lower, r) || underOrEqual(r, lower))) {
    return fail('is a directory that is, is inside, or contains governance, validator or workflow files; name each file instead');
  }
  if (underOrEqual(lower, '.projectops')) {
    const declarable = PROJECTOPS_DECLARABLE.some((d) => (d.endsWith('/') ? lower.startsWith(d) : lower === d));
    if (!declarable) {
      return fail('is a governance trust root or a record the runtime writes; a worker able to write it could widen its own authority or forge the evidence that judges it');
    }
  }
  // EVERY GRANT IS INSPECTED. A directory over ignored output or a package root, and a FILE that is
  // itself ignored, would be work no git-based check — review, candidate, clean tree, G4 — could see.
  const inspected = inspectDirectory(rel);
  if (inspected === null) return fail('could not be checked against git, so whether it is ignored cannot be established');
  if (inspected.ignored) {
    return fail(
      directory
        ? 'is a directory with git-ignored content beneath it (build output the runtime may execute); name each file instead'
        : 'is a git-ignored path, invisible to every review and check',
    );
  }
  // A DIRECTORY OVER A GOVERNED FILE grants it as a side effect, wherever the project keeps it.
  if (directory && governed.some((g) => underOrEqual(g.replace(/\\/g, '/').toLowerCase(), lower))) {
    return fail("is a directory that contains the plan's own governed state; name each file instead");
  }
  if (directory && inspected.packageRoot) {
    return fail('is a directory containing a package root, whose build output is executed and git-ignored; name each file instead');
  }
  if (PROJECTOS_OWNED_RECORD_SUFFIXES.some((x) => lower.endsWith(x))) return fail("is one of ProjectOS's own run records");
  return { problem: null, rel, directory };
}

/**
 * The approved plan's `writePaths` for a phase, as stated. Absent is an empty list — the phase grants
 * nothing beyond the worker-owned records — and anything that is not a list is carried as a problem,
 * never read as "no paths", so a malformed plan refuses instead of silently granting less than it says.
 */
export function phaseWritePaths(plan: Readonly<Record<string, unknown>>, phaseId: string): { readonly entries: readonly unknown[]; readonly problems: readonly string[] } {
  const phases = Array.isArray(plan['phases']) ? (plan['phases'] as unknown[]) : [];
  const phase = phases.find((p) => typeof p === 'object' && p !== null && (p as Record<string, unknown>)['phaseId'] === phaseId) as
    | Record<string, unknown>
    | undefined;
  const raw = phase?.['writePaths'];
  if (raw === undefined) return { entries: [], problems: [] };
  if (!Array.isArray(raw)) return { entries: [], problems: [`phase ${phaseId} declares writePaths that is not a list`] };
  return { entries: raw, problems: [] };
}

/**
 * The write grant for the phase being run, from its approved `writePaths`. See the note above for every
 * rule. An empty list grants nothing beyond the worker-owned records — the safe direction.
 */
export function writePathGrants(
  root: string,
  entries: readonly unknown[],
  inspectDirectory: DirectoryInspector = () => null,
  /**
   * The project's own governed files, by exact path: the declared plan, current state and configuration.
   * The current state is the completion ledger selection reads, so a worker able to write it could mark
   * its own phase complete; none of them is ever a write grant, wherever the project keeps them.
   */
  governed: readonly string[] = [],
): PhaseWriteGrant {
  const grants: string[] = [];
  const paths: string[] = [];
  const problems: string[] = [];
  // EACH ENTRY IS ONE PATH, used exactly as written: never split, trimmed or searched for path words.
  for (const [i, word] of entries.entries()) {
    if (typeof word !== 'string' || word === '') {
      problems.push(`writePaths[${i}] is not a non-empty path string`);
      continue;
    }
    const judged = judgeWritePath(root, word, inspectDirectory, governed);
    if (judged.problem !== null) {
      problems.push(judged.problem);
      continue;
    }
    // A FILE AT THE ROOT IS ANCHORED (`./name`), so the rule cannot match the same name deeper down.
    const anchored = judged.rel.includes('/') ? judged.rel : `./${judged.rel}`;
    const pattern = judged.directory ? `${judged.rel}/**` : anchored;
    if (paths.includes(pattern)) continue;
    paths.push(pattern);
    grants.push(`Write(${pattern})`, `Edit(${pattern})`);
  }
  return { grants, paths, problems };
}

/** ProjectOS's own records. A worker is never granted authority over these. */
export const PROJECTOS_OWNED_RECORD_SUFFIXES: readonly string[] = ['.brief.json', '.session.json', '.evidence.json'];

/**
 * Tools through which a worker could write a file.
 *
 * `Bash` is on this list and belongs there: a shell grant is a write grant wearing a different name,
 * and an enforcement that policed `Write` while waving `Bash(*)` through would be theatre. `Task`
 * and `Agent` are here for the same reason one step removed — they can dispatch something that
 * writes.
 *
 * WHAT THIS CANNOT DO, stated rather than implied: it governs what THIS CONFIG may grant. It does
 * not and cannot govern the CLI's own defaults or a user's settings files, which are outside
 * ProjectOS. The boundary it enforces is "the project cannot widen worker authority quietly", not
 * "the worker can do nothing else".
 */
const WRITE_CAPABLE_GRANT = /^(Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Task|Agent)\s*(\(|$)/i;

/**
 * Flags that hand a worker authority no grant list can take back: skipping permission checks
 * altogether, or a permission mode that accepts edits or bypasses checks. Refused outright.
 */
const AUTHORITY_FLAGS = /^--(dangerously-skip-permissions|allow-dangerously-skip-permissions)$/;
const UNSAFE_PERMISSION_MODES: readonly string[] = ['bypassPermissions', 'acceptEdits', 'auto'];

/** Flags that load authority from somewhere this config does not show. Refused in every form. */
const UNPOLICED_AUTHORITY_FLAGS: readonly string[] = ['--settings', '--add-dir', '--mcp-config', '--agents', '--plugin-dir'];

/**
 * A grant whose parentheses are nested or unbalanced. The CLI tracks parentheses with a single flag, not
 * a depth, so `Read((x) Bash(*)` is ONE grant here and TWO there, the second a shell (ECC SECURITY N1).
 * Rather than mirror the CLI's parser, anything the two could read differently is refused.
 */
export function ambiguousGrants(args: readonly string[]): readonly string[] {
  return argvGrants(args).filter((g) => {
    const open = (g.match(/\(/g) ?? []).length;
    const close = (g.match(/\)/g) ?? []).length;
    return open > 1 || close > 1 || open !== close;
  });
}

/**
 * Why this worker's tool grants are unacceptable, or empty when they are fine.
 *
 * Only WRITE-CAPABLE grants are policed. A worker reading widely is how it does its job; a worker
 * writing outside the two records it owns is how a run stops being trustworthy.
 */
export function toolGrantProblems(args: readonly string[]): readonly string[] {
  const problems: string[] = [];
  for (const [i, arg] of args.entries()) {
    if (AUTHORITY_FLAGS.test(arg)) problems.push(`'${arg}' removes the permission checks every grant relies on`);
    if (arg === '--permission-mode' && UNSAFE_PERMISSION_MODES.includes(args[i + 1] ?? '')) {
      problems.push(`'--permission-mode ${args[i + 1]}' lets a worker act beyond its grants`);
    }
    if (arg.startsWith('--permission-mode=')) problems.push(`'${arg}' is not accepted; give the mode as its own argument`);
    const flag = arg.split('=')[0] as string;
    if (UNPOLICED_AUTHORITY_FLAGS.includes(flag)) {
      problems.push(`'${flag}' loads authority from outside this config, which the loop cannot judge`);
    }
    if (ALLOWED_TOOLS_FLAGS.some((f) => arg.startsWith(`${f}=`))) {
      problems.push(`'${arg.split('=')[0]}=' is not accepted; give the grant list as its own argument`);
    }
    if (ALLOWED_TOOLS_FLAGS.includes(arg) && (args[i + 1] === undefined || (args[i + 1] as string).startsWith('-'))) {
      problems.push('--allowedTools is given with no value');
    }
  }
  for (const grant of ambiguousGrants(args)) {
    problems.push(`tool grant '${grant}' has nested or unbalanced parentheses, which the CLI may read as several grants`);
  }
  for (const grant of argvGrants(args)) {
    if (!WRITE_CAPABLE_GRANT.test(grant)) continue;
    if (WORKER_OWNED_RECORD_GRANTS.includes(grant)) continue;
    problems.push(
      `tool grant '${grant}' gives a worker write authority beyond the records it owns; ` +
        `permitted: ${WORKER_OWNED_RECORD_GRANTS.join(', ')}. A phase's source grant comes from its ` +
        'approved writePaths at dispatch, never from configuration',
    );
  }
  return problems;
}

function readWorkers(context: GovernedContext): {
  readonly workers: readonly AuthorisedWorker[];
  readonly defaultWorkerId: string | null;
  readonly reviewerWorkerId: string | null;
  readonly problems: readonly string[];
} {
  const execution = (context.config as unknown as Record<string, unknown>)['execution'];
  if (execution === undefined || execution === null) {
    return {
      workers: [],
      defaultWorkerId: null,
      reviewerWorkerId: null,
      problems: [
        'this project authorises no execution worker (project-config has no `execution.workers`), so the loop has nothing it may start',
      ],
    };
  }
  const block = execution as Record<string, unknown>;
  const raw = Array.isArray(block['workers']) ? (block['workers'] as Record<string, unknown>[]) : [];
  const problems: string[] = [];
  const workers: AuthorisedWorker[] = [];
  const seen = new Set<string>();

  for (const [i, entry] of raw.entries()) {
    // A hand-edited config can put anything in this array. Reaching into a null would throw out of a
    // function whose whole contract is that it refuses instead — and the CLI would print a Node stack
    // trace where every other refusal in this codebase prints a governed reason.
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`execution.workers[${i}] is not an object`);
      continue;
    }
    const workerId = typeof entry['workerId'] === 'string' ? entry['workerId'] : '';
    const kind = typeof entry['kind'] === 'string' ? entry['kind'] : '';
    const command = typeof entry['command'] === 'string' ? entry['command'] : '';
    const args = Array.isArray(entry['args']) ? entry['args'].filter((a): a is string => typeof a === 'string') : [];
    const label = workerId === '' ? '<unnamed worker>' : workerId;

    if (workerId === '') problems.push('an authorised worker has no workerId');
    else if (seen.has(workerId)) problems.push(`worker '${workerId}' is declared more than once`);
    seen.add(workerId);

    if (kind === '') problems.push(`worker '${label}' declares no kind`);
    if (command === '') problems.push(`worker '${label}' declares no command`);
    else if (!isAbsolutePath(command)) {
      problems.push(
        `worker '${label}' declares command '${command}', which is not an absolute path; ` +
          'a bare name would resolve against the governed checkout before PATH',
      );
    }
    for (const a of args) {
      if (CREDENTIAL_SHAPED.test(a)) {
        problems.push(`worker '${label}' passes a credential-shaped argument; the loop does not hand credentials to a worker`);
      }
    }
    for (const p of toolGrantProblems(args)) problems.push(`worker '${label}': ${p}`);

    // A DECLARED BOUND IS CHECKED, AND AN UNDECLARED ONE IS THE DEFAULT — never "unbounded". The
    // absent case and the nonsense case are different: saying nothing accepts the default, while
    // saying `0`, `-1`, `"soon"` or a day and a half is a statement about the bound that this cannot
    // honour, and silently substituting the default for it would hide the mistake.
    const declared = entry['timeoutMs'];
    let timeoutMs = DEFAULT_WORKER_TIMEOUT_MS;
    if (declared !== undefined) {
      if (typeof declared !== 'number' || !Number.isInteger(declared)) {
        problems.push(`worker '${label}' declares timeoutMs ${JSON.stringify(declared)}, which is not a whole number of milliseconds`);
      } else if (declared < MIN_WORKER_TIMEOUT_MS || declared > MAX_WORKER_TIMEOUT_MS) {
        problems.push(
          `worker '${label}' declares timeoutMs ${declared}, outside the permitted ` +
            `${MIN_WORKER_TIMEOUT_MS}..${MAX_WORKER_TIMEOUT_MS}; an attempt must be bounded by something a person would wait for`,
        );
      } else {
        timeoutMs = declared;
      }
    }
    workers.push({ workerId, kind, command, args, timeoutMs });
  }

  if (workers.length === 0) problems.push('`execution.workers` declares no worker');
  const declaredDefault = typeof block['defaultWorkerId'] === 'string' ? block['defaultWorkerId'] : null;
  if (declaredDefault !== null && !workers.some((w) => w.workerId === declaredDefault)) {
    problems.push(`execution.defaultWorkerId '${declaredDefault}' is not one of the authorised workers`);
  }
  // D11: the worker that reviews. Optional — a project without one cannot satisfy an independent review
  // inside the loop, and says so at REVIEW_OUTSTANDING rather than here.
  const declaredReviewer = typeof block['reviewerWorkerId'] === 'string' ? block['reviewerWorkerId'] : null;
  if (declaredReviewer !== null && !workers.some((w) => w.workerId === declaredReviewer)) {
    problems.push(`execution.reviewerWorkerId '${declaredReviewer}' is not one of the authorised workers`);
  }
  if (declaredReviewer !== null && declaredReviewer === declaredDefault) {
    problems.push(`execution.reviewerWorkerId '${declaredReviewer}' is also the default implementer; a worker never reviews its own work`);
  }
  return { workers, defaultWorkerId: declaredDefault, reviewerWorkerId: declaredReviewer, problems };
}

/**
 * Does the `execution` block the loop is about to act on match the one that was COMMITTED?
 *
 * `execution.workers[].command` and `execution.checks[].command` name executables this loop will
 * spawn. The config is a working-tree file, and the worker the loop spawns can write to it — so
 * without this, a worker could point its own successor at any absolute path it liked and the loop
 * would honour it, because the shape would still be valid. Reading the committed blob instead means
 * changing what the loop trusts requires a commit, which is where the owner's review actually is.
 *
 * This checks the `execution` block ONLY. The rest of the config's trust model belongs to the phases
 * that own it; widening it here would be changing another phase's rules from inside this one.
 *
 * Any git failure is a refusal: a comparison that could not be made has not succeeded.
 */
export function committedExecutionProblems(sys: System, root: string, context: GovernedContext): readonly string[] {
  // `-C root` AND `./` — the pathspec that proves committedness resolves against the governed root,
  // while `<rev>:<path>` resolves against the top of the working tree. In a checkout nested inside a
  // larger repository the two addressed different files, so the proof was about one record and the
  // bytes came from another. Reproduced on this repository's own nested fixture.
  const show = sys.exec('git', ['-C', root, 'show', `HEAD:./${CONFIG_RELPATH}`]);
  if (show.code !== 0) {
    return [`the committed ${CONFIG_RELPATH} could not be read, so the loop cannot tell which executables the owner actually approved`];
  }
  let committed: unknown;
  try {
    committed = JSON.parse(show.stdout.replace(/^﻿/, ''));
  } catch {
    return [`the committed ${CONFIG_RELPATH} is not valid JSON`];
  }
  const committedBlock = (committed as Record<string, unknown> | null)?.['execution'] ?? null;
  const workingBlock = (context.config as unknown as Record<string, unknown>)['execution'] ?? null;
  if (JSON.stringify(committedBlock) === JSON.stringify(workingBlock)) return [];
  return [
    `the \`execution\` block in the working tree differs from the committed ${CONFIG_RELPATH}; ` +
      'the loop spawns only what the owner has committed, so commit the change and run again',
  ];
}

const CONFIG_RELPATH = '.projectops/project-config.json';

/** The authorised workers, or the reasons the configuration cannot be used. Never throws. */
export function authorisedWorkers(context: GovernedContext):
  | {
      readonly ok: true;
      readonly workers: readonly AuthorisedWorker[];
      readonly defaultWorkerId: string | null;
      readonly reviewerWorkerId: string | null;
    }
  | { readonly ok: false; readonly problems: readonly string[] } {
  const r = readWorkers(context);
  if (r.problems.length > 0) return { ok: false, problems: r.problems };
  return { ok: true, workers: r.workers, defaultWorkerId: r.defaultWorkerId, reviewerWorkerId: r.reviewerWorkerId };
}

/**
 * The configured reviewer worker and its adapter (D11), or null when none is configured. Whether it
 * may review a given implementer is `roleBindingProblems`' question, asked at the point of review.
 */
export function resolveReviewer(
  context: GovernedContext,
  registry: AdapterRegistry,
): { readonly worker: AuthorisedWorker; readonly adapter: WorkerAdapter } | null {
  const loaded = authorisedWorkers(context);
  if (!loaded.ok || loaded.reviewerWorkerId === null) return null;
  const worker = loaded.workers.find((w) => w.workerId === loaded.reviewerWorkerId);
  const adapter = worker === undefined ? undefined : registry[worker.kind];
  return worker === undefined || adapter === undefined ? null : { worker, adapter };
}

/**
 * Resolve the worker the loop should use, and the adapter that knows how to run it.
 *
 * `requested` names a worker explicitly; omitting it takes the configured default, and a project with
 * exactly one authorised worker needs no default at all. Anything ambiguous is refused rather than
 * guessed — picking a worker for the owner is not the loop's decision.
 */
export function resolveWorker(
  context: GovernedContext,
  registry: AdapterRegistry,
  requested?: string,
): WorkerResolution {
  const loaded = authorisedWorkers(context);
  if (!loaded.ok) return loaded;

  let worker: AuthorisedWorker | undefined;
  if (requested !== undefined && requested !== '') {
    worker = loaded.workers.find((w) => w.workerId === requested);
    if (worker === undefined) {
      return {
        ok: false,
        problems: [
          `worker '${requested}' is not authorised by this project; authorised: ${loaded.workers.map((w) => w.workerId).join(', ')}`,
        ],
      };
    }
  } else if (loaded.defaultWorkerId !== null) {
    worker = loaded.workers.find((w) => w.workerId === loaded.defaultWorkerId);
  } else {
    // The configured reviewer (D11) is never picked implicitly as the implementer, so adding one to a
    // single-worker project does not make the choice ambiguous.
    const implementers = loaded.workers.filter((w) => w.workerId !== loaded.reviewerWorkerId);
    if (implementers.length !== 1) {
      return {
        ok: false,
        problems: [
          implementers.length === 0
            ? 'the only authorised worker is the configured reviewer; D11 needs a separate worker to implement'
            : `${implementers.length} workers are authorised and none is the default; name one rather than letting the loop choose`,
        ],
      };
    }
    worker = implementers[0];
  }
  if (worker === undefined) {
    return { ok: false, problems: ['no authorised worker could be resolved'] };
  }

  const adapter = registry[worker.kind];
  if (adapter === undefined) {
    return {
      ok: false,
      problems: [
        `worker '${worker.workerId}' is of kind '${worker.kind}', for which no adapter is built in; ` +
          `adapters available: ${Object.keys(registry).join(', ') || '<none>'}`,
      ],
    };
  }
  return { ok: true, worker, adapter };
}

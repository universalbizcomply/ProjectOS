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
import type { System } from '../system.js';
import type { GovernedContext } from '../governedContext.js';
import type { WorkerBrief } from './brief.js';

/** A worker the project's config authorises. */
export interface AuthorisedWorker {
  readonly workerId: string;
  readonly kind: string;
  /** Absolute path to the executable. Never a bare name — see the module note. */
  readonly command: string;
  readonly args: readonly string[];
}

export interface WorkerSession {
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
   * Correction attempts spent in the LAST invocation. It is recorded for the reader, not consumed as
   * a running total: the bound is per invocation, so re-running after a human has looked at the
   * failure starts a fresh budget. That is deliberate — the human deciding to try again is the gate,
   * and a permanently exhausted session would be a phase nobody could ever retry.
   */
  readonly corrections: number;
}

export type WorkerOutcome =
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

function readWorkers(context: GovernedContext): {
  readonly workers: readonly AuthorisedWorker[];
  readonly defaultWorkerId: string | null;
  readonly problems: readonly string[];
} {
  const execution = (context.config as unknown as Record<string, unknown>)['execution'];
  if (execution === undefined || execution === null) {
    return {
      workers: [],
      defaultWorkerId: null,
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
    workers.push({ workerId, kind, command, args });
  }

  if (workers.length === 0) problems.push('`execution.workers` declares no worker');
  const declaredDefault = typeof block['defaultWorkerId'] === 'string' ? block['defaultWorkerId'] : null;
  if (declaredDefault !== null && !workers.some((w) => w.workerId === declaredDefault)) {
    problems.push(`execution.defaultWorkerId '${declaredDefault}' is not one of the authorised workers`);
  }
  return { workers, defaultWorkerId: declaredDefault, problems };
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
  const show = sys.exec('git', ['-C', root, 'show', `HEAD:${CONFIG_RELPATH}`]);
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
  | { readonly ok: true; readonly workers: readonly AuthorisedWorker[]; readonly defaultWorkerId: string | null }
  | { readonly ok: false; readonly problems: readonly string[] } {
  const r = readWorkers(context);
  if (r.problems.length > 0) return { ok: false, problems: r.problems };
  return { ok: true, workers: r.workers, defaultWorkerId: r.defaultWorkerId };
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
  } else if (loaded.workers.length === 1) {
    worker = loaded.workers[0];
  } else {
    return {
      ok: false,
      problems: [
        `${loaded.workers.length} workers are authorised and none is the default; name one rather than letting the loop choose`,
      ],
    };
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

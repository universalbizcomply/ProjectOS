/**
 * What the loop can see for itself.
 *
 * The governed context proves WHICH project and that its plan is approved and ready. It proves
 * nothing about the checkout the work would actually happen in, and the loop starts work with no
 * human reading the decision first — so "right phase, wrong world" is a failure mode with no
 * reviewer in front of it. This module re-derives the world from git and compares it with what the
 * project declares.
 *
 * EVERY GIT FAILURE IS A MISMATCH, never an assumption. A checkout whose HEAD cannot be read is not
 * a checkout the loop may work in, and reporting nothing would read as agreement.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { System } from '../system.js';
import { configPath } from '../context.js';
import type { GovernedContext } from '../governedContext.js';

const HEX40 = /^[0-9a-f]{40}$/;

export interface RepositoryObservation {
  /** The absolute-ish root the loop was pointed at, unchanged. */
  readonly root: string;
  readonly branch: string | null;
  readonly head: string | null;
  /** `origin` in `owner/name` form when it could be parsed, else the raw URL, else null. */
  readonly remote: string | null;
  readonly clean: boolean;
  readonly dirtyPaths: readonly string[];
}

export interface ContextVerification {
  readonly observed: RepositoryObservation;
  /** Empty means the loop may proceed. Each entry names one disagreement, in full. */
  readonly mismatches: readonly string[];
}

function run(sys: System, root: string, args: readonly string[]): string | null {
  const r = sys.exec('git', ['-C', root, ...args]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * `owner/name` from a remote URL, for both `https://host/owner/name.git` and `git@host:owner/name`.
 * Returns the raw URL when it does not parse — a comparison that fails loudly beats a null that
 * quietly matches nothing.
 */
export function normaliseRemote(url: string): string {
  const cleaned = url.trim().replace(/\.git$/i, '');
  const m = /[:/]([^/:]+\/[^/]+)$/.exec(cleaned);
  return m === null || m[1] === undefined ? cleaned : m[1];
}

/**
 * Porcelain lines are `XY path`, and `XY old -> new` for renames; the last path is the current one.
 *
 * Exported because the evidence collector needs the SAME parse: two copies would let "what is dirty"
 * and "what changed" drift apart while both claim to describe one checkout.
 */
export function porcelainPaths(porcelain: string): readonly string[] {
  return porcelain
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const body = l.slice(2).trim();
      const arrow = body.indexOf(' -> ');
      return (arrow === -1 ? body : body.slice(arrow + 4)).replace(/^"|"$/g, '').replace(/\\/g, '/');
    });
}

/** Read the checkout. Never throws; anything unreadable comes back null and is judged by the caller. */
export function observeRepository(sys: System, root: string): RepositoryObservation {
  const branch = run(sys, root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headRaw = run(sys, root, ['rev-parse', 'HEAD']);
  const head = headRaw !== null && HEX40.test(headRaw) ? headRaw : null;
  const remoteRaw = run(sys, root, ['remote', 'get-url', 'origin']);
  const statusOut = sys.exec('git', ['-C', root, 'status', '--porcelain']);
  const dirtyPaths = statusOut.code === 0 ? porcelainPaths(statusOut.stdout) : [];
  return {
    root,
    branch,
    head,
    remote: remoteRaw === null ? null : normaliseRemote(remoteRaw),
    clean: statusOut.code === 0 && dirtyPaths.length === 0,
    dirtyPaths,
  };
}

function configuredRepo(context: GovernedContext): string | null {
  const v = context.config.repo;
  return typeof v === 'string' && v.length > 0 ? normaliseRemote(v) : null;
}

/**
 * Compare the checkout with what the project declares. The project identity itself is already proven
 * by `loadGovernedContext`; this adds repository, branch and readable state.
 *
 * A DIRTY TREE IS NOT A MISMATCH. The loop works mid-phase, so uncommitted changes are the normal
 * condition, and refusing them would make the loop unable to do the thing it exists for. It is
 * recorded as an observation so a later gate — the commit gate, the closure gate — can judge it with
 * the authority to do so.
 */
export function verifyExecutionContext(sys: System, root: string, context: GovernedContext): ContextVerification {
  const observed = observeRepository(sys, root);
  const mismatches: string[] = [];

  // The root becomes the working directory of every process the loop spawns. A RELATIVE root would
  // be resolved by the OS against ProjectOS's ambient directory at spawn time — which is exactly the
  // ambiguity binding the cwd exists to remove, arriving one step later.
  if (!/^([A-Za-z]:[\\/]|\/|\\\\)/.test(root)) {
    mismatches.push(`the governed root '${root}' is not an absolute path, so it cannot place a worker deterministically`);
  }

  if (observed.head === null) {
    mismatches.push('HEAD could not be read from this checkout, so no repository fact can be established');
  }
  if (observed.branch === null) {
    mismatches.push('the current branch could not be read from this checkout');
  }

  const declared = configuredRepo(context);
  if (declared === null) {
    mismatches.push(`the project config at ${configPath(root)} declares no repository, so the checkout cannot be matched to it`);
  } else if (observed.remote === null) {
    mismatches.push(`this checkout has no readable 'origin' remote to compare with the declared repository ${declared}`);
  } else if (observed.remote.toLowerCase() !== declared.toLowerCase()) {
    mismatches.push(`repository: this checkout is ${observed.remote}, the project declares ${declared}`);
  }

  if (observed.branch !== null && context.config.protectedBranches.includes(observed.branch)) {
    mismatches.push(`branch '${observed.branch}' is protected by the project config; the loop does not work on a protected branch`);
  }

  return { observed, mismatches };
}

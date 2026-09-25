/**
 * THE BOUNDED LOCAL CANDIDATE COMMIT — PROJECTOS-HOST-REVIEW-PATH1B, UNIT L.
 *
 * THE DEFECT IT CLOSES. On the unattended route ProjectOSHost reviews a COMMIT: it derives the evidence
 * from the approved baseline to the commit it pinned, and it can read nothing else. The worker's output
 * was uncommitted, and the loop named the run-start HEAD — the BASE — as the subject. So the Host framed,
 * and the independent reviewer judged, the difference from the baseline to the base: the phase's own
 * work reached the reviewer only as agent-claimed text, and a Host attestation certified bytes that were
 * not the candidate. This module makes the candidate a commit BEFORE the review, so the subject the Host
 * pins IS the work.
 *
 * WHAT IT MAY DO, AND NOTHING ELSE (ratified at the PATH1B gate as the bounded local candidate commit
 * authority):
 *   - record the CURRENT candidate — exactly the paths `computeCandidateIdentity` names, the records the
 *     asking itself creates excluded — as ONE commit whose single parent is the current HEAD;
 *   - advance the checked-out branch to it by a COMPARE-AND-SWAP fast-forward (`update-ref <ref> <new>
 *     <old>`), so a branch that moved meanwhile refuses rather than being overwritten.
 * A correction is therefore ANOTHER commit on top: additive, never an amendment. There is no push, merge,
 * tag, amend, reset, rebase, checkout, fetch, force update, ref deletion or history rewrite anywhere in
 * this file, and no git verb outside `LOCAL_CANDIDATE_GIT_VERBS` (validator-pinned).
 *
 * WHY PLUMBING. `git commit` is porcelain: it runs `pre-commit`, `prepare-commit-msg`, `commit-msg` and
 * `post-commit`, consults the index as the user left it, and may start `gc --auto`. The plumbing used
 * here runs no commit hook at all, and the hooks plumbing CAN reach (`post-index-change` when an index is
 * written, `reference-transaction` when a ref moves) are closed twice: every git call this runtime makes
 * resolves hooks beneath the null device (`system.ts`), and this one also points `core.hooksPath` at a
 * directory created empty for this call. The governed worktree's hook directory is never consulted.
 *
 * NO CONFIGURATION MAY RUN A PROGRAM — including while the candidate is being COMPUTED, which is part of
 * making this commit. System and user configuration are the null device (`ExecOptions.isolatedGit`).
 * Repository-local configuration cannot be switched off, so every key through which it could start a
 * program on the commands issued here is overridden at command scope, which outranks the repository
 * file: `core.hooksPath`, `core.fsmonitor`, `commit.gpgSign` (with `commit-tree --no-gpg-sign` besides),
 * and — for EVERY filter driver the configuration defines — its `clean`, `smudge` and `process` commands
 * emptied and `required` cleared, which git reads as "no filter". Git's own built-in content handling
 * (line endings, `ident`, working-tree encoding) still applies, so the commit records exactly what an
 * ordinary `git commit` of these paths would record, minus any program.
 *
 * ONLY PHASE-SCOPE CHANGES. The tree is built in a SCRATCH index read from HEAD, and only the candidate's
 * paths are applied to it — so whatever else the checkout's own index holds staged is neither committed
 * nor disturbed. The real index is then told the new content of exactly those paths, so the checkout does
 * not report as changed what was just recorded.
 *
 * AN UNREVIEWED LOCAL CANDIDATE IS CONSUMABLE BY NO OTHER GOVERNED ACTION. It publishes nothing. A push
 * is authorised only by a decision whose subject IS the current HEAD (`authoriseTechnicalContinuation`),
 * a closure requires HEAD to be published, and every later run reviews the CUMULATIVE change from the
 * approved baseline to whatever HEAD then is.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecResult, System } from '../system.js';
import { computeCandidateIdentity } from './candidateIdentity.js';

/**
 * The ONLY git verbs issued while a local candidate is made — directly here, or through the candidate
 * identity this module computes with its own isolated runner. Pinned by
 * `val-projectos-technical-continuation1a` section 16.
 */
export const LOCAL_CANDIDATE_GIT_VERBS = [
  'config',
  'status',
  'ls-files',
  'rev-parse',
  'symbolic-ref',
  'read-tree',
  'hash-object',
  'update-index',
  'write-tree',
  'commit-tree',
  'update-ref',
] as const;

/** The trailer that marks a local candidate in history, so a reader never mistakes it for a reviewed commit. */
export const LOCAL_CANDIDATE_TRAILER = 'ProjectOS-Local-Candidate';

export type LocalCandidateOutcome =
  | { readonly kind: 'COMMITTED'; readonly commit: string; readonly parent: string; readonly paths: readonly string[] }
  | { readonly kind: 'NOTHING_TO_COMMIT'; readonly head: string }
  | { readonly kind: 'REFUSED'; readonly reasons: readonly string[] };

const COMMIT_ID = /^[0-9a-f]{40}$/;
const PHASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BRANCH_REF = /^refs\/heads\/[^\s\\:?*[~^]+$/;
/** The two modes an ordinary committed file can carry. A link or a submodule pointer is refused. */
const FILE_MODES: readonly string[] = ['100644', '100755'];
/** A filter driver key as `git config --name-only` prints it: section, driver name, one of four keys. */
const FILTER_KEY = /^filter\.(.+)\.(clean|smudge|process|required)$/;

const refused = (...reasons: string[]): LocalCandidateOutcome => ({ kind: 'REFUSED', reasons });

/** A directory that did not exist a moment ago, or null. See `planDecision.ts` `hookFreeDirectory`. */
function freshDirectory(prefix: string): string | null {
  try {
    return mkdtempSync(join(tmpdir(), prefix));
  } catch {
    return null;
  }
}

function removeQuietly(dir: string | null): void {
  if (dir === null) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A scratch directory that outlives the call is residue, not a failure.
  }
}

/** A repository-relative path git reported, re-checked before it becomes an argument. */
function isPlainRelativePath(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !path.startsWith('-') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split('/').some((s) => s === '' || s === '.' || s === '..')
  );
}

type IsolatedGit = (args: readonly string[], indexFile?: string) => ExecResult;

/**
 * The command-scope overrides that stop every filter driver the configuration defines from running.
 *
 * `null` when the drivers cannot be enumerated, or a driver name cannot be carried safely as a `-c` key -
 * the caller refuses rather than commit with a program in reach.
 */
function filterNeutralisers(run: IsolatedGit): string[] | null {
  const listed = run(['config', '--name-only', '--get-regexp', '^filter\\.']);
  // Exit 1 is git's "no such key": no filter driver is configured at all.
  if (listed.code === 1 && listed.stdout.trim() === '') return [];
  if (listed.code !== 0) return null;
  const names = new Set<string>();
  for (const line of listed.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')) {
    const m = FILTER_KEY.exec(line);
    if (m === null) continue;
    const name = String(m[1]);
    if (name === '' || name.includes('=') || /\s/.test(name)) return null;
    names.add(name);
  }
  return [...names].sort().flatMap((n) => [
    '-c',
    `filter.${n}.clean=`,
    '-c',
    `filter.${n}.smudge=`,
    '-c',
    `filter.${n}.process=`,
    '-c',
    `filter.${n}.required=false`,
  ]);
}

/**
 * Record the current candidate as ONE local commit on top of HEAD, before the independent review.
 *
 * `NOTHING_TO_COMMIT` when the candidate is empty (the subject is then HEAD itself). Every failure is a
 * `REFUSED` naming why, and a refusal before the compare-and-swap leaves the branch exactly where it was.
 */
export function commitLocalCandidate(sys: System, root: string, phaseId: string): LocalCandidateOutcome {
  if (!PHASE_ID.test(phaseId)) return refused(`'${phaseId}' is not a phase identifier, so no candidate was committed`);

  const hooks = freshDirectory('projectos-no-hooks-');
  const scratch = freshDirectory('projectos-candidate-index-');
  try {
    if (hooks === null || scratch === null) {
      return refused(
        'a hook-free directory or a scratch index could not be created, so the candidate was not committed ' +
          'rather than committed with the checkout hooks or its staged work in reach',
      );
    }
    // Every call: the same repository, the same command-scope overrides, the same isolated environment.
    // `-c` is a git-level option and must precede the verb.
    const overrides = [
      '-C',
      root,
      '-c',
      `core.hooksPath=${hooks}`,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.useReplaceRefs=false',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'protocol.allow=never',
    ];
    const base: IsolatedGit = (args, indexFile) =>
      sys.exec('git', [...overrides, ...args], { isolatedGit: indexFile === undefined ? {} : { indexFile } });
    const neutralisers = filterNeutralisers(base);
    if (neutralisers === null) {
      return refused('the filter drivers this checkout configures could not be enumerated, so no candidate was committed');
    }
    const git: IsolatedGit = (args, indexFile) =>
      sys.exec('git', [...overrides, ...neutralisers, ...args], {
        isolatedGit: indexFile === undefined ? {} : { indexFile },
      });
    return commitWithin(root, phaseId, git, join(scratch, 'index'), sys);
  } finally {
    removeQuietly(hooks);
    removeQuietly(scratch);
  }
}

function commitWithin(root: string, phaseId: string, git: IsolatedGit, scratchIndex: string, sys: System): LocalCandidateOutcome {
  // THE CANDIDATE, computed under the same isolation: its `status` and `hash-object` run no program.
  const candidate = computeCandidateIdentity(sys, root, (args) => git(args));
  if (!candidate.ok) {
    return refused('the candidate could not be named, so nothing was committed', ...candidate.problems);
  }
  const entries = candidate.identity.entries;

  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const parent = head.stdout.trim();
  if (head.code !== 0 || !COMMIT_ID.test(parent)) {
    return refused('this checkout has no readable HEAD commit, so no candidate was committed');
  }
  if (entries.length === 0) return { kind: 'NOTHING_TO_COMMIT', head: parent };

  const symbolic = git(['symbolic-ref', '--quiet', 'HEAD']);
  const branchRef = symbolic.stdout.trim();
  if (symbolic.code !== 0 || !BRANCH_REF.test(branchRef)) {
    return refused('HEAD is not on a branch; a local candidate is never recorded on a detached HEAD');
  }

  const present: { path: string; mode: string }[] = [];
  const deleted: string[] = [];
  for (const e of entries) {
    if (!isPlainRelativePath(e.path)) return refused(`'${e.path}' is not a plain repository path`);
    if (e.state === 'deleted') {
      deleted.push(e.path);
      continue;
    }
    if (!FILE_MODES.includes(e.mode)) {
      return refused(`'${e.path}' has mode ${e.mode}; only ordinary files enter a local candidate`);
    }
    let isFile = false;
    try {
      isFile = lstatSync(join(root, e.path)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) return refused(`'${e.path}' is not an ordinary file (a link is never followed into a candidate)`);
    present.push({ path: e.path, mode: e.mode });
  }

  // THE CONTENT, stored as git itself would record it - one call, positional answers. A short answer is
  // a refusal, never a smaller commit.
  const blobs: string[] = [];
  if (present.length > 0) {
    const hashed = git(['hash-object', '-w', '--', ...present.map((p) => p.path)]);
    const lines = hashed.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    if (hashed.code !== 0 || lines.length !== present.length || !lines.every((l) => COMMIT_ID.test(l))) {
      return refused('the candidate content could not be stored completely, so nothing was committed');
    }
    blobs.push(...lines);
  }
  const cacheInfo = present.flatMap((p, i) => ['--cacheinfo', p.mode, String(blobs[i]), p.path]);

  // THE SCRATCH INDEX: HEAD's tree, plus exactly the candidate's paths.
  if (git(['read-tree', parent], scratchIndex).code !== 0) {
    return refused('HEAD could not be read into a scratch index, so nothing was committed');
  }
  const applyTo = (indexFile?: string): boolean =>
    (cacheInfo.length === 0 || git(['update-index', '--add', ...cacheInfo], indexFile).code === 0) &&
    (deleted.length === 0 || git(['update-index', '--force-remove', '--', ...deleted], indexFile).code === 0);
  if (!applyTo(scratchIndex)) return refused('the candidate could not be applied to a scratch index, so nothing was committed');

  const written = git(['write-tree'], scratchIndex);
  const tree = written.stdout.trim();
  if (written.code !== 0 || !COMMIT_ID.test(tree)) return refused('the candidate tree could not be written');
  const baseTree = git(['rev-parse', '--verify', '--quiet', `${parent}^{tree}`]).stdout.trim();
  if (tree === baseTree) return { kind: 'NOTHING_TO_COMMIT', head: parent };

  const made = git([
    'commit-tree',
    '--no-gpg-sign',
    '-p',
    parent,
    '-m',
    `projectos: local candidate for ${phaseId}`,
    '-m',
    `${LOCAL_CANDIDATE_TRAILER}: ${phaseId}\nProjectOS-Candidate-Parent: ${parent}`,
    tree,
  ]);
  const commit = made.stdout.trim();
  if (made.code !== 0 || !COMMIT_ID.test(commit)) return refused('the candidate commit could not be created');

  // THE ONLY REF WRITE: a compare-and-swap fast-forward of the checked-out branch from `parent`.
  if (git(['update-ref', '-m', `projectos: local candidate for ${phaseId}`, branchRef, commit, parent]).code !== 0) {
    return refused('the branch moved while the candidate was being recorded; the branch was left exactly where it was');
  }

  // The real index learns the recorded content of exactly these paths, nothing else.
  if (!applyTo()) {
    return refused(
      `the candidate was committed as ${commit}, but the checkout index could not be updated for its paths; ` +
        'no review was asked about it',
    );
  }
  return { kind: 'COMMITTED', commit, parent, paths: [...present.map((p) => p.path), ...deleted].sort() };
}

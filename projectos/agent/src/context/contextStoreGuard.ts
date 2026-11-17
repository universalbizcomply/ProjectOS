// Origin: original ProjectOS code
/**
 * A WORKER DOES NOT WRITE MEMORY OR SKILLS, CHECKED WHERE ITS CHANGES ARE JUDGED (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * MEMORY-STORES1A shipped two checks and left them unwired: `checkNoDirectStoreWrites` (a pure refusal over changed paths) and a
 * digest of the two store trees taken before and after (`snapshotMemoryStores`, `checkStoreUnchanged`). This joins them, around
 * the worker and before the checks, in the order that note asked for:
 *
 *   BEFORE the worker   take the digest, and list the paths git already shows as changed.
 *   AFTER the worker    list them again, judge the paths that are NEW (so a store file the owner had already changed is not the
 *                       worker's), then compare the digest. The digest is what still sees a write when the store is git-ignored,
 *                       and what sees a store file that was already changed and was changed again.
 *
 * `git status --porcelain -z --untracked-files=all` (the null-separated form), so a path is never quoted, an untracked directory
 * is listed file by file, and a rename names BOTH sides: `R  new\0old\0`. Moving a file out of a store changes the store as
 * surely as moving one in. Anything this cannot read as complete (git failed, a rename with no old name, more than 100,000
 * paths) is `MEMORY_STORE_UNCHECKED`, and nothing is cleared.
 *
 * ORDER IS PART OF THE RULE: take the second look before the kernel's own door writes the proposals it makes from the findings,
 * or the kernel's files are what gets refused. A refusal names paths and codes and never quotes a file.
 */
import {
  MEMORY_STORE_ROOTS,
  checkNoDirectStoreWrites,
} from '@projectos/core';
import { checkStoreUnchanged, snapshotMemoryStores, type MemoryStoreSnapshotResult } from '../memory/storeDigest.js';
import type { DocumentFs } from '../search/ports.js';

/** The one method of `System` this needs: `git`, run in the checkout. */
export interface StoreGuardSystem {
  exec(cmd: string, args: readonly string[]): { readonly code: number; readonly stdout: string };
}

export const MAX_STATUS_PATHS = 100_000;

/** The state of the stores and of git before the worker ran. `dirty` is null when git could not say. */
export interface StoreGuardBefore {
  readonly snapshot: MemoryStoreSnapshotResult;
  readonly dirty: readonly string[] | null;
}

export type StoreGuardVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'MEMORY_DIRECT_WRITE' | 'MEMORY_STORE_CHANGED' | 'MEMORY_STORE_UNCHECKED'; readonly detail: string };

/** The path of every entry `git status --porcelain -z` printed, both sides of a rename or copy; null when it is not complete. */
export function porcelainZPaths(output: string): readonly string[] | null {
  if (typeof output !== 'string') return null;
  if (output === '') return [];
  if (!output.endsWith('\0')) return null;
  const fields = output.slice(0, -1).split('\0');
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] as string;
    if (field.length < 4 || field[2] !== ' ') return null;
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const old = fields[index];
      if (old === undefined || old === '') return null;
      paths.push(old);
    }
    if (paths.length > MAX_STATUS_PATHS) return null;
  }
  return paths;
}

function dirtyPathsOf(sys: StoreGuardSystem, root: string): readonly string[] | null {
  try {
    const result = sys.exec('git', ['-C', root, 'status', '--porcelain', '-z', '--untracked-files=all']);
    return result.code === 0 ? porcelainZPaths(result.stdout) : null;
  } catch {
    return null;
  }
}

/** Take the digest and the list of changed paths, before the worker runs. Never throws. */
export function beginStoreGuard(sys: StoreGuardSystem, root: string, fs: DocumentFs): StoreGuardBefore {
  return { snapshot: snapshotMemoryStores(root, fs), dirty: dirtyPathsOf(sys, root) };
}

/**
 * Why the baseline cannot be used, or null. A baseline that could not be taken means every later judgement is "unchecked", and the loop
 * would only find out after the worker had run and been paid for: so it asks BEFORE the first dispatch, and the answer says who does what.
 */
export function storeGuardBaselineProblem(before: StoreGuardBefore): string | null {
  if (!before.snapshot.ok) {
    const where = before.snapshot.path === '' ? 'the memory or skill store' : before.snapshot.path;
    const fix =
      before.snapshot.code === 'MEMORY_STORE_TOO_LARGE'
        ? 'the owner archives or removes entries from .projectops/memory and .projectops/skills until the digest can read both (it reads at most 2,000 entries and 8 MB)'
        : before.snapshot.code === 'MEMORY_STORE_LINK'
          ? 'the owner replaces the link with an ordinary file or directory'
          : 'the owner checks that the user who runs ProjectOS can read .projectops/memory and .projectops/skills';
    return `${before.snapshot.code}: the memory and skill stores cannot be digested (${where}), so a worker's writes to them could not be judged. Nothing was dispatched. Fix: ${fix}, then runs again.`;
  }
  if (before.dirty === null) {
    return 'MEMORY_STORE_UNCHECKED: git could not list the changed paths of this checkout, so a worker\'s writes to the memory and skill stores could not be judged. Nothing was dispatched. Fix: the owner checks that git runs in this checkout (git status), then runs again.';
  }
  return null;
}

const unchecked = (detail: string): StoreGuardVerdict => ({ ok: false, code: 'MEMORY_STORE_UNCHECKED', detail });

/** Judge what the worker changed, after it ran and before any check does. */
export function endStoreGuard(sys: StoreGuardSystem, root: string, fs: DocumentFs, before: StoreGuardBefore): StoreGuardVerdict {
  const after = dirtyPathsOf(sys, root);
  if (before.dirty === null || after === null) return unchecked('git could not say what the worker changed, so the memory and skill stores were not cleared');
  const already = new Set(before.dirty);
  const changed = after.filter((path) => !already.has(path));
  const direct = checkNoDirectStoreWrites(changed);
  if (!direct.ok) {
    const named = [...direct.direct.map((finding) => finding.path), ...direct.unjudgeable.map((path) => path.path ?? '(not a path)')].slice(0, 8);
    return { ok: false, code: 'MEMORY_DIRECT_WRITE', detail: `MEMORY_DIRECT_WRITE: the worker changed the memory or skill store directly (${named.join(', ')}). Memory and skills are proposed through the findings record, and the owner decides.` };
  }
  const digest = checkStoreUnchanged(before.snapshot, snapshotMemoryStores(root, fs));
  if (digest.ok) return { ok: true };
  if (digest.code === 'MEMORY_STORE_UNCHECKED') return unchecked(digest.message);
  const named = [...(digest.added ?? []), ...(digest.removed ?? []), ...(digest.changed ?? [])].slice(0, 8);
  return { ok: false, code: 'MEMORY_STORE_CHANGED', detail: `MEMORY_STORE_CHANGED: the memory or skill store is not as it was before the worker ran (${named.join(', ')}).` };
}

/** The two store roots a worker may not write, for a caller that needs to name them. */
export const GUARDED_STORE_ROOTS = MEMORY_STORE_ROOTS;

/**
 * RE-BASELINE AFTER THE KERNEL'S OWN DOOR, FOR EXACTLY THE FILES THE DOOR MADE (PROJECTOS-PROPOSAL-DOOR-WIRING1A, rule DW-6).
 *
 * The baseline is taken once per run and every later judgement compares against it, so a proposal the kernel writes after attempt 1
 * would be refused in attempt 2 as a worker's write. This takes the baseline again AFTER the door, and absorbs ONLY what the door said it
 * made: a proposal file under `.projectops/memory/proposals/` or `.projectops/skills/proposals/` named `mem-` or `skl-` and 24 hex digits,
 * and the directories above it that were not there before. It does not exempt `proposals/`: a worker file beside the door's, an existing
 * file that changed, and anything removed are not absorbed, and then the OLD baseline is kept, so the next judgement refuses with
 * `MEMORY_STORE_CHANGED` and names the paths. A baseline that could not be taken, or a git that cannot say, keeps the old baseline too.
 */
const DOOR_FILE = /^\.projectops\/(?:memory|skills)\/proposals\/(?:mem|skl)-[0-9a-f]{24}\.json$/;

export interface StoreRebase {
  readonly baseline: StoreGuardBefore;
  /** False when the old baseline was kept, so a later judgement will refuse what changed. */
  readonly absorbed: boolean;
}

/** The made file and the two directories above it, project-relative: the store root and its `proposals` directory. */
function withParents(path: string): readonly string[] {
  const parts = path.split('/');
  return [parts.slice(0, 2).join('/'), parts.slice(0, 3).join('/')];
}

export function rebaseStoreGuard(sys: StoreGuardSystem, root: string, fs: DocumentFs, before: StoreGuardBefore, made: readonly string[]): StoreRebase {
  const kept: StoreRebase = { baseline: before, absorbed: false };
  if (made.length === 0) return { baseline: before, absorbed: true };
  if (!made.every((path) => DOOR_FILE.test(path))) return kept;
  const now = beginStoreGuard(sys, root, fs);
  if (!before.snapshot.ok || !now.snapshot.ok || before.dirty === null || now.dirty === null) return kept;
  const allowed = new Set(made.flatMap((path) => [...withParents(path), path]));
  const was = new Map(before.snapshot.snapshot.files.map((entry) => [entry.path, entry.hash]));
  const is = new Map(now.snapshot.snapshot.files.map((entry) => [entry.path, entry.hash]));
  for (const [path, hash] of is) {
    if (was.get(path) === hash) continue;
    if (was.has(path) || !allowed.has(path)) return kept;
  }
  for (const path of was.keys()) if (!is.has(path)) return kept;
  const known = new Set(before.dirty);
  const dirty = [...before.dirty, ...now.dirty.filter((path) => allowed.has(path) && !known.has(path))];
  return { baseline: { snapshot: now.snapshot, dirty }, absorbed: true };
}

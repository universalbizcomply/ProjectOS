// Origin: original ProjectOS code
/**
 * A WORKER DOES NOT WRITE MEMORY OR SKILLS (PROJECTOS-MEMORY-STORES1A).
 *
 * Under the worker grant nothing stops a worker's tool from writing a file inside `.projectops/memory/` or
 * `.projectops/skills/`, so the write is DETECTED and REFUSED where the run's changed paths are judged. A worker
 * that wants a memory or a skill asks through a `proposals` entry in its findings record, and the kernel turns that
 * into a pending proposal. This is the refusal, as a pure function over the paths the run observed.
 *
 * WHAT COUNTS. Any changed path at or under the two store roots, in any spelling a file system treats as the same
 * path: backslashes, a leading `./`, doubled separators, `.` and `..` segments, trailing dots and spaces on a segment
 * (Windows drops them), and any letter case (Windows and macOS fold it). The proposal queues' own files sit under
 * these roots too, so a worker writing `.projectops/memory/proposals/x.json` is refused as well: the door is the
 * findings entry, and no other.
 *
 * WHAT IT CANNOT JUDGE IS REFUSED, NOT PASSED. A path that is not a string, is empty, is absolute or a drive path, or
 * climbs out of the project root cannot be placed under a root or outside one, so the answer for it is the same as
 * for a hit: refused, by its own code. A check that passes what it could not read is not a check.
 *
 * THE CALLER'S ORDER IS PART OF THE RULE. Run this over what the WORKER changed, before the kernel's own door writes
 * the proposals it makes from the findings record. Run after, it would see the kernel's files and refuse the run for
 * what the kernel wrote.
 *
 * WHAT THIS DOES NOT DO. It does not read a file, does not stop a write, and does not see a short (8.3) name or a
 * link that resolves into a root. Pure: no I/O.
 */

export type DirectWriteReason = 'inside-memory-store' | 'inside-skill-store';

const STORE_ROOTS: readonly { readonly segments: readonly string[]; readonly reason: DirectWriteReason }[] = [
  { segments: ['.projectops', 'memory'], reason: 'inside-memory-store' },
  { segments: ['.projectops', 'skills'], reason: 'inside-skill-store' },
];

/** The two roots a worker may not write, as normalised segments. */
export const MEMORY_STORE_ROOTS: readonly (readonly string[])[] = STORE_ROOTS.map((root) => root.segments);

export type DirectWriteUnjudgeableReason = 'not-a-path' | 'absolute-path' | 'outside-project';

export interface DirectWriteFinding {
  readonly path: string;
  readonly reason: DirectWriteReason;
}

export interface UnjudgeablePath {
  /** The path as given, cut, because it may be anything. Absent when it was not a string. */
  readonly path: string | null;
  readonly reason: DirectWriteUnjudgeableReason;
}

export type DirectWriteCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The machine-readable code for the audit record. */
      readonly code: 'MEMORY_DIRECT_WRITE';
      /** What the model and the owner are told. It names no stored text. */
      readonly message: string;
      readonly direct: readonly DirectWriteFinding[];
      readonly unjudgeable: readonly UnjudgeablePath[];
    };

const MAX_PATHS_JUDGED = 20_000;
const MAX_PATH_CHARS = 1_024;
const MAX_REPORTED = 50;
const DRIVE_PATH = /^[A-Za-z]:/;

type Placed = { readonly kind: 'segments'; readonly segments: readonly string[] } | { readonly kind: 'unjudgeable'; readonly reason: DirectWriteUnjudgeableReason };

/** A segment as a file system reads it: trailing dots and spaces dropped, except for `.` and `..` themselves. */
function foldedSegment(segment: string): string {
  if (segment === '.' || segment === '..') return segment;
  return segment.replace(/[. ]+$/, '').toLowerCase();
}

function placed(path: string): Placed {
  const slashes = path.replace(/\\/g, '/');
  if (slashes.startsWith('/') || DRIVE_PATH.test(slashes)) return { kind: 'unjudgeable', reason: 'absolute-path' };
  const out: string[] = [];
  for (const raw of slashes.split('/')) {
    const segment = foldedSegment(raw);
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return { kind: 'unjudgeable', reason: 'outside-project' };
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return { kind: 'segments', segments: out };
}

function underRoot(segments: readonly string[], root: readonly string[]): boolean {
  return segments.length >= root.length && root.every((part, index) => segments[index] === part);
}

function reasonOf(segments: readonly string[]): DirectWriteReason | null {
  return STORE_ROOTS.find((root) => underRoot(segments, root.segments))?.reason ?? null;
}

/**
 * Whether a run's changed paths touch the memory or skill store. `changedPaths` are project-relative paths, as the
 * loop's observation lists them. More than `MAX_PATHS_JUDGED` is refused, unread, so the cost is bounded by this cap
 * and not by the run.
 */
export function checkNoDirectStoreWrites(changedPaths: readonly unknown[]): DirectWriteCheck {
  if (!Array.isArray(changedPaths) || changedPaths.length > MAX_PATHS_JUDGED) {
    return {
      ok: false,
      code: 'MEMORY_DIRECT_WRITE',
      message: 'The run changed more paths than can be judged, so none was cleared. Nothing in the memory or skill store was read.',
      direct: [],
      unjudgeable: [{ path: null, reason: 'not-a-path' }],
    };
  }
  const direct: DirectWriteFinding[] = [];
  const unjudgeable: UnjudgeablePath[] = [];
  for (const path of changedPaths) {
    if (typeof path !== 'string' || path.trim() === '' || path.length > MAX_PATH_CHARS) {
      unjudgeable.push({ path: typeof path === 'string' ? path.slice(0, 80) : null, reason: 'not-a-path' });
      continue;
    }
    const where = placed(path);
    if (where.kind === 'unjudgeable') {
      unjudgeable.push({ path: path.slice(0, 80), reason: where.reason });
      continue;
    }
    const reason = reasonOf(where.segments);
    if (reason !== null) direct.push({ path: path.slice(0, 200), reason });
  }
  if (direct.length === 0 && unjudgeable.length === 0) return { ok: true };
  return {
    ok: false,
    code: 'MEMORY_DIRECT_WRITE',
    message:
      'A worker changed the memory or skill store directly, or changed a path that could not be judged. ' +
      'Memory and skills are proposed through a `proposals` entry in the findings record, and the owner decides. Nothing was approved.',
    direct: direct.slice(0, MAX_REPORTED),
    unjudgeable: unjudgeable.slice(0, MAX_REPORTED),
  };
}

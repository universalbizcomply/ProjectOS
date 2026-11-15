// Origin: original ProjectOS code
/**
 * WHICH DIRTY PATHS A NEW WORKER MAY BE HANDED, AND WHICH REFUSE THE RUN (PROJECTOS-RESUME1A, plan 3.x).
 *
 * A worker that was cut off leaves paths git shows as changed. The next worker continues from them only if every one is either
 * inside the paths the approved phase grants (its `writePaths`), or a record the loop itself writes. Any other path is somebody
 * else's work: it is named, the run is refused, and the owner says what happens to it. Nothing here widens a grant, and a path
 * that matches a grant is still only LISTED: a listing is a fact the loop observed, never permission.
 *
 * THE SHAPE OF A PATH IS JUDGED BEFORE ITS MEANING. Git prints a repository-relative name with `/` separators. A name that is
 * absolute (a root, a drive, a share), climbs out (`..`), or is written in a form two spellings could share (a backslash, a
 * `:` that names a drive or a stream, a `~` that can alias a short name, a segment Windows strips a trailing dot or space
 * from, an invisible or control character, an empty or `.` segment) is REFUSED, so two spellings of one file cannot dodge the
 * grant. A name that differs from a grant only by case or by Unicode width is a CASE VARIANT and is refused too: on Windows it is
 * the same file, and on another system it is a different one, so neither may be taken for the granted path.
 *
 * Every pattern is linear: a length is checked first and the rest is single-class tests. Pure: no I/O, no clock, no import.
 */

export const CONTEXT_RESUME_PATH_REASONS = ['absolute', 'traversal', 'odd-form', 'case-variant', 'outside-write-paths'] as const;
export type ContextResumePathReason = (typeof CONTEXT_RESUME_PATH_REASONS)[number];

export const MAX_CONTEXT_RESUME_PATH_CHARS = 512;

export type ContextResumePathVerdict =
  | { readonly kind: 'granted'; readonly path: string }
  | { readonly kind: 'run-record'; readonly path: string }
  | { readonly kind: 'worker-record'; readonly path: string }
  | { readonly kind: 'refused'; readonly path: string; readonly reason: ContextResumePathReason };

export interface ContextResumePathRules {
  /** The write grant as the loop built it: `dir/**`, `./file` or `dir/file`. Nothing else is a pattern. */
  readonly writePaths: readonly string[];
  /** The phase being run. Only this phase's own record is one the loop writes for it. */
  readonly phaseId: string;
  /** Where the loop's one work record lives, handed in so this file does not spell it. */
  readonly workRecordPath: string;
  /** The other records the loop's own lifecycle writes (the plan's state file, the gatekeeper's files). Handed in by the loop, never read from a record. */
  readonly loopRecords: ContextResumeLoopRecords;
}

/** Exact paths, and folders whose files have one name shape, that the loop itself writes. A path outside both is nobody's but the worker's. */
export interface ContextResumeLoopRecords {
  readonly paths: readonly string[];
  readonly folders: readonly { readonly dir: string; readonly name: RegExp }[];
}

const MAX_LOOP_RECORD_NAME_CHARS = 200;

// The records the loop writes in the execution folder (the first four are the ones the loop's own record fold commits), the context file a
// killed run left (swept by exactly this name shape), and the two records a worker owns under its own grant.
const EXECUTION_LOOP_RECORD = /^\.projectops\/execution\/[A-Za-z0-9_.-]{1,200}\.(?:brief|session|evidence|invocation|reviewer)\.json$/;
const EXECUTION_CONTEXT_FILE = /^\.projectops\/execution\/[A-Za-z0-9_.-]{1,64}\.context\.md$/;
const EXECUTION_WORKER_RECORD = /^\.projectops\/execution\/[A-Za-z0-9_.-]{1,200}\.(?:findings|effects)\.json$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;
const NOT_A_PATH = '(not a path)';

const canonical = (text: string): string => text.normalize('NFKC').toLowerCase();

/** The reason a path's own shape is refused, or null. Asked before any grant is. */
function shapeReason(path: string): ContextResumePathReason | null {
  if (path === '' || path.length > MAX_CONTEXT_RESUME_PATH_CHARS) return 'odd-form';
  if (/^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return 'absolute';
  const segments = path.split(/[\\/]/);
  if (segments.includes('..')) return 'traversal';
  if (path.includes('\\') || path.includes(':') || path.includes('~') || INVISIBLE.test(path.replace(/ /g, ''))) return 'odd-form';
  for (const segment of segments) {
    if (segment === '' || segment === '.') return 'odd-form';
    if (/[. ]$/.test(segment)) return 'odd-form';
  }
  return null;
}

/** What closes a directory grant as the loop writes it: everything beneath the directory, and never the directory itself. */
const BENEATH = '/'.concat('*', '*');

/** Whether a path is under a grant pattern, with `fold` choosing exact or case-and-width-folded comparison. */
function grantCovers(path: string, pattern: string, fold: boolean): boolean {
  const same = fold ? canonical : (text: string): string => text;
  const target = same(path);
  if (pattern.endsWith(BENEATH)) return target.startsWith(`${same(pattern.slice(0, -BENEATH.length))}/`);
  const file = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  return target === same(file);
}

/** A path with the NAME of a record the loop writes for this phase. The name says nothing of the bytes: whoever can write the file can write that name. */
function isLoopRunRecord(path: string, rules: ContextResumePathRules): boolean {
  if (EXECUTION_LOOP_RECORD.test(path) || EXECUTION_CONTEXT_FILE.test(path)) return true;
  if (path === rules.workRecordPath) return true;
  if (SAFE_NAME.test(rules.phaseId) && path === `.projectops/phases/${rules.phaseId}.json`) return true;
  if (rules.loopRecords.paths.some((exact) => typeof exact === 'string' && exact !== '' && path === exact)) return true;
  return rules.loopRecords.folders.some(({ dir, name }) => {
    if (typeof dir !== 'string' || dir === '' || !path.startsWith(`${dir}/`)) return false;
    const rest = path.slice(dir.length + 1);
    return rest.length <= MAX_LOOP_RECORD_NAME_CHARS && !rest.includes('/') && name.test(rest);
  });
}

/**
 * What a dirty path is: granted by the phase, a record the loop wrote, or refused with a closed reason. The path is read once, and
 * anything that is not a string is refused as an odd form. A grant that is not a plain string pattern covers nothing.
 */
export function classifyContextResumePath(rawPath: unknown, rules: ContextResumePathRules): ContextResumePathVerdict {
  if (typeof rawPath !== 'string') return { kind: 'refused', path: NOT_A_PATH, reason: 'odd-form' };
  const path = rawPath;
  const shape = shapeReason(path);
  if (shape !== null) return { kind: 'refused', path, reason: shape };
  const grants = rules.writePaths.filter((pattern): pattern is string => typeof pattern === 'string' && pattern !== '');
  if (grants.some((pattern) => grantCovers(path, pattern, false))) return { kind: 'granted', path };
  if (isLoopRunRecord(path, rules)) return { kind: 'run-record', path };
  if (EXECUTION_WORKER_RECORD.test(path)) return { kind: 'worker-record', path };
  if (grants.some((pattern) => grantCovers(path, pattern, true))) return { kind: 'refused', path, reason: 'case-variant' };
  return { kind: 'refused', path, reason: 'outside-write-paths' };
}

/**
 * A scratch copy of the governed checkout for a worker that cannot be given per-path grants, and the copy-back that
 * lets only granted paths through. PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a).
 *
 * WHY. The Codex implementer's write scope was DETECTIVE (`writeScope.ts`): Codex's sandbox covers the whole checkout, so an
 * out-of-scope write had already happened when it was seen. Here the worker runs in a fresh temporary directory instead.
 * Whatever it does there reaches the real tree only through `copyBack`, which judges EVERY difference first and writes nothing
 * unless all of them are allowed. A refusal leaves the real tree byte-identical.
 *
 * WHAT THE SCRATCH HOLDS. The files git lists as tracked or untracked-and-not-ignored (isolated git, `-z`), minus `.git`, minus
 * anything under an agent control path (`isAgentControlPath`), minus a git-ignored file: that is what keeps `.env` and
 * `node_modules` out. Links are never copied. Then a standalone `git init` with no remote and no template, so Codex sees a
 * repository that is not the real one. Nothing is committed in it.
 *
 * HOW A CHANGE IS FOUND. Not with git (the worker owns the scratch's `.git`, and nothing in it is ever run again): a manifest of
 * the scratch is walked with `lstat` before and after, never following a link, and a file is compared by the SHA-256 of its
 * bytes (streamed), never by size or time. A write made and undone leaves the same manifest, so it leaves no trace.
 *
 * WHAT IS REFUSED, whole: a path outside the grants; a path under an agent control path even beneath a directory grant; a new or
 * changed link or reparse point; a file that became a directory or the reverse; a deletion (this slice); a name that is not a
 * plain relative path (`..`, absolute, a drive, an alternate-data-stream colon, a backslash, a trailing dot); a real destination
 * that passes through a link or is not a plain file. A refusal is a value naming the paths, not an exception.
 *
 * WHAT IT DOES NOT DO. It does not stop the worker READING anything the owner's user can read, by absolute path (D4 stands
 * until container or VM isolation); it cannot tell a Windows reparse point node reports as a plain directory; copy time grows
 * with the checkout; and a worker process that outlives its run could still write to the scratch, which is why every copied file
 * is hashed again at its destination and the copy-back is undone if the bytes are not the bytes that were judged.
 *
 * The file operations go through a small injected port (`ScratchFs`) with a real node implementation, the way
 * `localCandidateCommit.ts` uses `node:fs` for its temporary directories; tests inject failing variants.
 */
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { System } from '../system.js';
import { isAgentControlPath, isolatedGitRunner, pathInGrants } from './writeScope.js';

export type EntryKind = 'file' | 'dir' | 'link' | 'other';
export interface EntryStat {
  readonly kind: EntryKind;
  readonly size: number;
  /** Hard-link count (1 for an ordinary file). */
  readonly links: number;
}

/** Everything this module does to the file system. `stat` is `lstat`: a link is a link, never its target. */
export interface ScratchFs {
  /** Null when nothing is there. */
  stat(path: string): EntryStat | null;
  list(path: string): readonly string[];
  /** SHA-256 of the file's bytes, read in chunks. */
  hashFile(path: string): string;
  copyFile(from: string, to: string): void;
  /** Create a directory and any missing parents. */
  makeDir(path: string): void;
  makeTempDir(prefix: string): string;
  realPath(path: string): string;
  writeText(path: string, text: string): void;
  removeFile(path: string): void;
  /** An EMPTY directory only. */
  removeDir(path: string): void;
  removeTree(path: string): void;
}

const NOT_THERE: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);
const HASH_CHUNK_BYTES = 1024 * 1024;

const errorCode = (e: unknown): string => (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'unknown');

export const nodeScratchFs: ScratchFs = {
  stat(path) {
    try {
      const s = lstatSync(path);
      const kind: EntryKind = s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';
      return { kind, size: s.size, links: s.nlink };
    } catch (e) {
      if (NOT_THERE.has(errorCode(e))) return null;
      throw e;
    }
  },
  list: (path) => readdirSync(path),
  hashFile(path) {
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const fd = openSync(path, 'r');
    try {
      for (;;) {
        const n = readSync(fd, chunk, 0, chunk.length, null);
        if (n === 0) break;
        hash.update(chunk.subarray(0, n));
      }
    } finally {
      closeSync(fd);
    }
    return hash.digest('hex');
  },
  copyFile: (from, to) => copyFileSync(from, to),
  makeDir: (path) => void mkdirSync(path, { recursive: true }),
  makeTempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  realPath: (path) => realpathSync.native(path),
  writeText: (path, text) => writeFileSync(path, text, 'utf8'),
  removeFile: (path) => unlinkSync(path),
  removeDir: (path) => rmdirSync(path),
  // `rmSync` unlinks a link or junction itself and does not follow it, so a link the worker made cannot reach the real tree.
  removeTree: (path) => rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
};

/** The bounds. A checkout over one of them is not exported: refusing is cheaper than filling a disk. */
export interface ScratchLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  /** Entries a manifest walk will record. */
  readonly maxEntries: number;
  /** One placed record (evidence, findings, effects, stored context). */
  readonly maxPlacedBytes: number;
}
export const DEFAULT_SCRATCH_LIMITS: ScratchLimits = { maxFiles: 100_000, maxBytes: 1024 ** 3, maxEntries: 250_000, maxPlacedBytes: 64 * 1024 * 1024 };
const MAX_DEPTH = 64;
const MAX_PATH_CHARS = 1024;
const MAX_SHOWN_NAME_CHARS = 300;
/** Records placed in the scratch after the export (brief, evidence, findings, effects, context) may take the scratch a little past the export bound. */
const PLACED_FILES_SLACK = 16;
const PLACED_RECORDS_MAX = 4;
const MAX_SKIPPED_NAMED = 200;
const MAX_GIT_LIST_BYTES = 64 * 1024 * 1024;

/** One entry of a manifest. A file is its content hash. */
export type ManifestEntry = { readonly kind: 'file'; readonly hash: string; readonly links?: number } |{ readonly kind: 'dir' } | { readonly kind: 'link' } | { readonly kind: 'other' };
/** Repository-relative POSIX path -> entry. Never contains the scratch's own top-level `.git`. */
export type Manifest = ReadonlyMap<string, ManifestEntry>;

export interface Refusal {
  readonly path: string;
  readonly why: string;
}

/** The fixed reasons a path is refused. Fixed text: nothing of a file's content ever reaches a refusal. */
export const WHY = {
  unsafe: 'is not a plain relative path inside the checkout',
  link: 'is, or became, a link or reparse point',
  other: 'is not an ordinary file or directory',
  kindChange: 'changed between a file and a directory',
  deleted: 'was deleted, and deleting a file is refused in this slice',
  control: 'lies under an agent control path, which no grant covers',
  outside: 'lies outside the write grants',
  throughLink: 'would be written through a link, or into a path that is not a plain directory, in the real checkout',
  inTheWay: 'has something other than a plain file at its place in the real checkout',
  alias: 'is spelled differently from the file it would replace in the real checkout (a short name, or another case), so it is refused',
  hardlink: 'is a hard link to another file, and a hard-linked file is not copied back',
} as const;

// ---- paths -------------------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_NAME = /[\u0000-\u001f<>:"|?*\\]/;

/** A segment shaped like an 8.3 short name (`GITIGN~1`, `AGENTS~1.MD`): on a volume that generates them it can name a control file under another spelling. */
const SHORT_NAME_SHAPE = /~[0-9]/;
/** The Windows device names, with or without an extension (`NUL`, `CON.txt`, `com9.log`), including the superscript digits Windows also reserves. */
const RESERVED_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9\xb2\xb3\xb9]|LPT[0-9\xb2\xb3\xb9]|CONIN\$|CONOUT\$|CLOCK\$)$/i;

const isReservedDevice = (segment: string): boolean => RESERVED_DEVICE.test((segment.split('.')[0] ?? '').replace(/ +$/, ''));

/** Does any segment look like an 8.3 short name? */
export const hasShortNameShape = (path: string): boolean => path.split('/').some((seg) => SHORT_NAME_SHAPE.test(seg));

/**
 * Is this a plain repository-relative POSIX path? Refuses the empty path, a leading `/`, a drive letter, a `.` or `..` or empty
 * segment, a control character, a backslash, a colon (an alternate data stream on NTFS), a segment ending in a dot or space
 * (Windows drops it, so it names another file), a segment shaped like an 8.3 short name, and a Windows device name. A path from
 * the scratch or from git is never trusted before this.
 */
export function safeRelativePath(path: string): boolean {
  if (path === '' || path.length > MAX_PATH_CHARS || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !FORBIDDEN_IN_NAME.test(seg) && !/[. ]$/.test(seg) && !SHORT_NAME_SHAPE.test(seg) && !isReservedDevice(seg));
}

/** A name from the scratch or from git, shown in a refusal: control characters and Unicode format characters (a bidirectional override, a zero-width space, a line separator) escaped, and cut short. */
export function plainName(value: string): string {
  const escaped = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`);
  return escaped.slice(0, MAX_SHOWN_NAME_CHARS);
}

/** `inner` below `outer`, by relative path (so slashes and, on Windows, case do not matter). False for the same path. */
function isBelow(outer: string, inner: string): boolean {
  const rel = relative(resolve(outer), resolve(inner));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The repository-relative POSIX path of `path` inside `root`, or null when it is not strictly inside it or is not a plain path. */
function relativeInside(root: string, path: string): string | null {
  if (!isBelow(root, path)) return null;
  const rel = relative(resolve(root), resolve(path)).split(/[\\/]/).join('/');
  return safeRelativePath(rel) ? rel : null;
}

const underRoot = (root: string, rel: string): string => join(root, ...rel.split('/'));

// ---- manifest ----------------------------------------------------------------------------------------------------------

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const described = (what: string, e: unknown): string => `${what} failed (${errorCode(e)})`;

/**
 * The scratch as a manifest: every file by content hash, every directory, and every link or oddity by kind. A link is recorded
 * and never entered. The scratch's own top-level `.git` is left out (it is the worker's, and is never copied or run again).
 */
export function manifestOf(fs: ScratchFs, root: string, limits: ScratchLimits = DEFAULT_SCRATCH_LIMITS): Result<Manifest> {
  const manifest = new Map<string, ManifestEntry>();
  let files = 0;
  let bytes = 0;
  const pending: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: '', depth: 0 }];
  try {
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.depth > MAX_DEPTH) return { ok: false, reason: `the scratch is nested deeper than ${MAX_DEPTH} directories` };
      for (const name of fs.list(next.dir)) {
        if (next.rel === '' && name === '.git') continue;
        const rel = next.rel === '' ? name : `${next.rel}/${name}`;
        if (manifest.size >= limits.maxEntries) return { ok: false, reason: `the scratch holds more than ${limits.maxEntries} entries` };
        if (!safeRelativePath(rel)) {
          manifest.set(rel, { kind: 'other' });
          continue;
        }
        const abs = join(next.dir, name);
        const st = fs.stat(abs);
        if (st === null) continue;
        if (st.kind === 'dir') {
          manifest.set(rel, { kind: 'dir' });
          pending.push({ dir: abs, rel, depth: next.depth + 1 });
        } else if (st.kind === 'file') {
          // The same bounds as the export (with room for the records placed afterwards), checked BEFORE the file is read.
          files += 1;
          bytes += st.size;
          if (files > limits.maxFiles + PLACED_FILES_SLACK || bytes > limits.maxBytes + PLACED_RECORDS_MAX * limits.maxPlacedBytes) {
            return { ok: false, reason: `the scratch is over the bound (${limits.maxFiles} files, ${limits.maxBytes} bytes)` };
          }
          manifest.set(rel, { kind: 'file', hash: fs.hashFile(abs), links: st.links });
        } else manifest.set(rel, { kind: st.kind });
      }
    }
  } catch (e) {
    return { ok: false, reason: described('reading the scratch', e) };
  }
  return { ok: true, value: manifest };
}

const same = (a: ManifestEntry | undefined, b: ManifestEntry | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.kind === b.kind && (a.kind !== 'file' || a.hash === (b as { hash: string }).hash);

export interface PlannedWrite {
  readonly path: string;
  /** The hash that was judged; the copy is checked against it. */
  readonly hash: string;
}
export interface Judgement {
  readonly refusals: readonly Refusal[];
  readonly writes: readonly PlannedWrite[];
}

/** Why this difference is not allowed, or null. First reason wins. */
function refusalFor(path: string, was: ManifestEntry | undefined, now: ManifestEntry | undefined, scopes: readonly string[]): string | null {
  if (!safeRelativePath(path)) return WHY.unsafe;
  if (was?.kind === 'link' || now?.kind === 'link') return WHY.link;
  if (was?.kind === 'other' || now?.kind === 'other') return WHY.other;
  if (was !== undefined && now !== undefined && was.kind !== now.kind) return WHY.kindChange;
  if (now === undefined) return WHY.deleted;
  // A new directory is not state that is copied: the files inside it are judged one by one, and an empty one is dropped.
  if (now.kind === 'dir') return null;
  if (isAgentControlPath(path)) return WHY.control;
  if (!pathInGrants(path, scopes)) return WHY.outside;
  // A hard link shares its bytes with another path (possibly one outside the grants): the copy would not be the file that was judged.
  return now.kind === 'file' && (now.links ?? 1) > 1 ? WHY.hardlink : null;
}

/** Every difference between two manifests, judged against the grants. Writes nothing; pure. Sorted. */
export function judgeChanges(before: Manifest, after: Manifest, scopes: readonly string[]): Judgement {
  const refusals: Refusal[] = [];
  const writes: PlannedWrite[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = before.get(path);
    const now = after.get(path);
    if (same(was, now)) continue;
    const why = refusalFor(path, was, now, scopes);
    if (why !== null) refusals.push({ path, why });
    else if (now?.kind === 'file') writes.push({ path, hash: now.hash });
  }
  return { refusals, writes };
}

/**
 * Why a granted path cannot be written at its real place, or null. Every existing component below the root must be a plain
 * directory (a link or a file in the way refuses), and the target, if present, a plain file. Components that do not exist yet
 * are created later, so nothing beyond the first missing one can be a link.
 *
 * THE DEEPEST EXISTING PATH MUST BE WHAT IT IS CALLED. Its canonical form (`realPath`) has to equal the expected root-joined
 * path exactly, case-sensitively, segment by segment. On a volume that generates 8.3 short names a "docs/" plus a short name
 * can open the real `docs/.gitignore`; the grant and control-path judgement saw the alias, not the file. Any other alias
 * (another case) is refused the same way, so the judgement is always about the path that would really be written.
 */
export function destinationProblem(fs: ScratchFs, realRoot: string, rel: string): string | null {
  if (!safeRelativePath(rel) || relativeInside(realRoot, underRoot(realRoot, rel)) !== rel) return WHY.unsafe;
  const segments = rel.split('/');
  let current = realRoot;
  let depth = 0;
  for (let i = 0; i < segments.length; i += 1) {
    current = join(current, segments[i] as string);
    const st = fs.stat(current);
    if (st === null) break;
    if (i === segments.length - 1) {
      if (st.kind !== 'file') return st.kind === 'dir' ? WHY.inTheWay : st.kind === 'link' ? WHY.throughLink : WHY.inTheWay;
    } else if (st.kind !== 'dir') return WHY.throughLink;
    depth = i + 1;
  }
  const expected = join(fs.realPath(realRoot), ...segments.slice(0, depth));
  return fs.realPath(join(realRoot, ...segments.slice(0, depth))) === expected ? null : WHY.alias;
}

// ---- copy back ---------------------------------------------------------------------------------------------------------

export type CopyBackOutcome =
  | { readonly kind: 'copied'; readonly paths: readonly string[] }
  | { readonly kind: 'refused'; readonly refusals: readonly Refusal[] }
  | { readonly kind: 'failed'; readonly reason: string; readonly rolledBack: boolean };

type Undo = { readonly step: 'restore'; readonly dest: string; readonly backup: string } | { readonly step: 'remove-file'; readonly dest: string } | { readonly step: 'remove-dir'; readonly dir: string };

/** A failure whose message is fixed text of this module, safe to show. */
class CopyProblem extends Error {}

/** Undo in reverse. Null when everything was undone; otherwise what could not be. */
function rollBack(fs: ScratchFs, undo: readonly Undo[]): string | null {
  const stuck: string[] = [];
  for (const u of [...undo].reverse()) {
    try {
      if (u.step === 'restore') fs.copyFile(u.backup, u.dest);
      else if (u.step === 'remove-file') {
        if (fs.stat(u.dest) !== null) fs.removeFile(u.dest);
      } else if (fs.stat(u.dir) !== null) fs.removeDir(u.dir);
    } catch (e) {
      stuck.push(described('undoing a write', e));
    }
  }
  return stuck.length === 0 ? null : stuck[0] ?? 'undoing a write failed';
}

function requireEmptyPlainDirectory(fs: ScratchFs, dir: string): void {
  const st = fs.stat(dir);
  if (st === null || st.kind !== 'dir') throw new CopyProblem('the backup location is not a plain directory');
  if (fs.list(dir).length > 0) throw new CopyProblem('the backup location is not empty');
}

/** Create the missing directories above `dest` one at a time, recording each so a rollback can remove it. */
function makeParents(fs: ScratchFs, realRoot: string, rel: string, undo: Undo[]): void {
  const segments = rel.split('/').slice(0, -1);
  let current = realRoot;
  for (const seg of segments) {
    current = join(current, seg);
    const st = fs.stat(current);
    if (st === null) {
      fs.makeDir(current);
      undo.push({ step: 'remove-dir', dir: current });
    } else if (st.kind !== 'dir') throw new CopyProblem('a directory in the real checkout is no longer a plain directory');
  }
}

/**
 * Copy the judged writes into the real checkout. Destinations are checked again first (all-or-nothing). Each file is backed up
 * (or noted as new), copied, and hashed AT ITS DESTINATION: a file whose bytes are not the judged bytes fails the whole copy, and a
 * failure at any point undoes every write made so far, so the real tree is either fully updated or as it was.
 */
export function copyBack(fs: ScratchFs, scratchRoot: string, realRoot: string, writes: readonly PlannedWrite[], stagingDir: string): CopyBackOutcome {
  const refusals: Refusal[] = [];
  try {
    for (const w of writes) {
      const why = destinationProblem(fs, realRoot, w.path);
      if (why !== null) refusals.push({ path: w.path, why });
    }
  } catch (e) {
    return { kind: 'failed', reason: described('checking the destinations', e), rolledBack: true };
  }
  if (refusals.length > 0) return { kind: 'refused', refusals };
  const undo: Undo[] = [];
  let step = 'preparing the copy';
  try {
    // The backup location was made by the caller, just now, under a name nobody was given. It is used only if it is still an empty plain directory.
    if (writes.length > 0) requireEmptyPlainDirectory(fs, stagingDir);
    for (const [i, w] of writes.entries()) {
      const dest = underRoot(realRoot, w.path);
      step = `copying ${w.path}`;
      makeParents(fs, realRoot, w.path, undo);
      if (fs.stat(dest) === null) undo.push({ step: 'remove-file', dest });
      else {
        const backup = join(stagingDir, String(i));
        fs.copyFile(dest, backup);
        undo.push({ step: 'restore', dest, backup });
      }
      fs.copyFile(underRoot(scratchRoot, w.path), dest);
      if (fs.hashFile(dest) !== w.hash) throw new CopyProblem(`the bytes of ${w.path} are not the bytes that were judged`);
    }
    return { kind: 'copied', paths: writes.map((w) => w.path) };
  } catch (e) {
    const stuck = rollBack(fs, undo);
    const reason = e instanceof CopyProblem ? e.message : described(step, e);
    return { kind: 'failed', reason: stuck === null ? reason : `${reason}; and ${stuck}`, rolledBack: stuck === null };
  }
}

// ---- export ------------------------------------------------------------------------------------------------------------

/** The paths git lists for a checkout: tracked or untracked-and-not-ignored. `-z`, so any name is read as it is. */
function listedFiles(sys: System, realRoot: string): Result<readonly string[]> {
  const run = isolatedGitRunner(sys, realRoot);
  if (run === null) return { ok: false, reason: 'the checkout\'s filter drivers could not be listed, so no file list was read' };
  const listed = run(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.code !== 0 || listed.failure !== undefined) return { ok: false, reason: 'git could not list the checkout\'s files' };
  if (listed.stdout.length >= MAX_GIT_LIST_BYTES) return { ok: false, reason: 'the checkout\'s file list is too large to read' };
  return { ok: true, value: [...new Set(listed.stdout.split('\0').filter((p) => p !== ''))].sort() };
}

/** A name from git, shown without control or non-ASCII characters and cut short. */
const shownName = (name: string): string => name.slice(0, 120).replace(/[^\x20-\x7e]/g, '?');

/** Copy the listed files, binary-safe, and report how many. A name that is not a plain path refuses the whole export. */
function copyFiles(fs: ScratchFs, realRoot: string, scratchRoot: string, paths: readonly string[], limits: ScratchLimits): Result<{ readonly files: number; readonly skipped: readonly string[] }> {
  let files = 0;
  let bytes = 0;
  const skipped: string[] = [];
  const skip = (path: string): void => {
    if (skipped.length < MAX_SKIPPED_NAMED) skipped.push(path);
  };
  // Directories already seen to be plain (not a link, not a file), by relative path; '' is the root.
  const plain = new Set<string>(['']);
  // F3: git lists the files BENEATH an untracked junction too, and `lstat` of the leaf alone follows the junction. Every parent
  // component is `lstat`ed from the root down, and a path is copied only when each one is a plain directory.
  const parentsPlain = (listed: string): boolean => {
    const parents = listed.split('/').slice(0, -1);
    let prefix = '';
    for (const seg of parents) {
      prefix = prefix === '' ? seg : `${prefix}/${seg}`;
      if (plain.has(prefix)) continue;
      const dir = fs.stat(underRoot(realRoot, prefix));
      if (dir === null || dir.kind !== 'dir') return false;
      plain.add(prefix);
    }
    return true;
  };
  for (const listed of paths) {
    // A trailing slash is git naming a nested repository or submodule: not a file, and never copied.
    if (listed.endsWith('/')) continue;
    // A name shaped like an 8.3 short name is not given to the worker (it could never be copied back); it is not a reason to refuse the export.
    if (hasShortNameShape(listed)) {
      skip(listed);
      continue;
    }
    if (!safeRelativePath(listed)) return { ok: false, reason: `git listed a path that is not a plain relative path: ${shownName(listed)}` };
    if (isAgentControlPath(listed)) continue;
    if (!parentsPlain(listed)) {
      skip(listed);
      continue;
    }
    const from = underRoot(realRoot, listed);
    const st = fs.stat(from);
    // gone from the working tree (a tracked file deleted), a link, a submodule directory: not copied
    if (st === null || st.kind !== 'file') {
      if (st !== null) skip(listed);
      continue;
    }
    files += 1;
    bytes += st.size;
    if (files > limits.maxFiles || bytes > limits.maxBytes) return { ok: false, reason: `the checkout is over the scratch bound (${limits.maxFiles} files, ${limits.maxBytes} bytes)` };
    const to = underRoot(scratchRoot, listed);
    fs.makeDir(dirname(to));
    fs.copyFile(from, to);
  }
  return { ok: true, value: { files, skipped } };
}

// ---- the scratch -------------------------------------------------------------------------------------------------------

export type ScratchInspection =
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'refused'; readonly refusals: readonly Refusal[] }
  | { readonly kind: 'clean'; readonly writes: number };

/** One scratch checkout, from export to removal. Methods never throw: a failure is a value. */
export interface ScratchCheckout {
  /** The directory the worker runs in. */
  readonly root: string;
  /** Listed paths that were NOT exported (beneath a link, a link or oddity at the leaf, an 8.3-shaped name), at most 200 named. */
  readonly skipped: readonly string[];
  /** Where a path of the real checkout lives in the scratch, or null when it is not strictly inside the real checkout. */
  scratchPathOf(realPath: string): string | null;
  /** Copy a real file (a record) to the same place in the scratch. Null when placed; otherwise why not. */
  placeFile(realPath: string): string | null;
  /** Write text to the place of a real path in the scratch. Null when written; otherwise why not. */
  placeText(realPath: string, text: string): string | null;
  /** Record the scratch as the worker will find it. Null when recorded; otherwise why not. */
  baseline(): string | null;
  /** Record the scratch as the worker left it and judge every difference against the grants. Writes nothing. */
  inspect(scopes: readonly string[]): ScratchInspection;
  /** Copy the allowed changes `inspect` found into the real checkout. */
  copyBack(): CopyBackOutcome;
  /** Remove the scratch. Null when it is gone; otherwise why not. Safe to call again. */
  dispose(): string | null;
}

export type OpenOutcome = { readonly ok: true; readonly scratch: ScratchCheckout } | { readonly ok: false; readonly reason: string };

/** Opens scratch checkouts. Injected into the adapter so its tests need no real directory. */
export interface ScratchHost {
  open(sys: System, realRoot: string): OpenOutcome;
}

function openScratch(fs: ScratchFs, limits: ScratchLimits, realRoot: string, holder: string, skipped: readonly string[]): ScratchCheckout {
  const root = join(holder, 'checkout');
  let baseline: Manifest | null = null;
  let verdict: ScratchInspection | null = null;
  let pending: readonly PlannedWrite[] = [];
  /** Every directory this scratch made and must remove: the holder first, then any backup location. */
  const owned: string[] = [holder];
  const target = (realPath: string): string | null => {
    const rel = relativeInside(realRoot, realPath);
    return rel === null ? null : underRoot(root, rel);
  };
  const place = (realPath: string, put: (to: string) => void): string | null => {
    const to = target(realPath);
    if (to === null) return 'a record path is not inside the checkout';
    try {
      fs.makeDir(dirname(to));
      put(to);
      return null;
    } catch (e) {
      return described('placing a record', e);
    }
  };
  return {
    root,
    skipped,
    scratchPathOf: target,
    placeFile: (realPath) => {
      if (target(realPath) === null) return 'a record path is not inside the checkout';
      try {
        const st = fs.stat(realPath);
        if (st === null) return 'a record to be placed does not exist';
        if (st.kind !== 'file') return 'a record to be placed is not a plain file';
        if (st.size > limits.maxPlacedBytes) return 'a record to be placed is over the size bound';
      } catch (e) {
        return described('reading a record', e);
      }
      return place(realPath, (to) => fs.copyFile(realPath, to));
    },
    placeText: (realPath, text) => place(realPath, (to) => fs.writeText(to, text)),
    baseline() {
      const m = manifestOf(fs, root, limits);
      if (!m.ok) return m.reason;
      baseline = m.value;
      return null;
    },
    inspect(scopes) {
      pending = [];
      if (baseline === null) return (verdict = { kind: 'unreadable', reason: 'the scratch was never recorded before the run' });
      const after = manifestOf(fs, root, limits);
      if (!after.ok) return (verdict = { kind: 'unreadable', reason: after.reason });
      const judged = judgeChanges(baseline, after.value, scopes);
      const refusals = [...judged.refusals];
      try {
        for (const w of judged.writes) {
          const why = destinationProblem(fs, realRoot, w.path);
          if (why !== null) refusals.push({ path: w.path, why });
        }
      } catch (e) {
        return (verdict = { kind: 'unreadable', reason: described('reading the real checkout', e) });
      }
      if (refusals.length > 0) return (verdict = { kind: 'refused', refusals: refusals.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) });
      pending = judged.writes;
      return (verdict = { kind: 'clean', writes: judged.writes.length });
    },
    copyBack() {
      // Only what `inspect` found clean is ever copied. A refused or never-inspected scratch copies nothing.
      if (verdict?.kind === 'refused') return { kind: 'refused', refusals: verdict.refusals };
      if (verdict?.kind !== 'clean') return { kind: 'failed', reason: 'the scratch was not inspected, so nothing was copied', rolledBack: true };
      // F4: the backup location does not exist until now, is made by `mkdtemp` (unpredictable, exclusive) in a directory of its own, never inside the
      // holder the worker's cwd lives in, and `copyBack` uses it only while it is still an empty plain directory.
      let staging: string;
      try {
        staging = fs.makeTempDir('projectos-backup-');
      } catch (e) {
        return { kind: 'failed', reason: described('making the backup location', e), rolledBack: true };
      }
      owned.push(staging);
      return copyBack(fs, root, realRoot, pending, staging);
    },
    dispose() {
      // The scratch holder, and every backup location made for a copy-back. A directory that cannot be removed stays on the list and is reported.
      const stuck: string[] = [];
      for (const dir of [...owned]) {
        try {
          fs.removeTree(dir);
          owned.splice(owned.indexOf(dir), 1);
        } catch (e) {
          stuck.push(described('removing the scratch', e));
        }
      }
      return stuck[0] ?? null;
    },
  };
}

/** Export a scratch of the checkout. On any failure the directory made so far is removed before the reason is returned. */
function exportScratch(fs: ScratchFs, limits: ScratchLimits, sys: System, realRoot: string): OpenOutcome {
  let holder: string | null = null;
  const fail = (reason: string): OpenOutcome => {
    let cleanup = '';
    if (holder !== null) {
      try {
        fs.removeTree(holder);
      } catch (e) {
        cleanup = `; and the scratch could not be removed (${errorCode(e)})`;
      }
    }
    return { ok: false, reason: `${reason}${cleanup}` };
  };
  try {
    const st = fs.stat(realRoot);
    if (st === null || st.kind !== 'dir') return fail('the checkout is not a directory');
    const listed = listedFiles(sys, realRoot);
    if (!listed.ok) return fail(listed.reason);
    holder = fs.makeTempDir('projectos-scratch-');
    const realBase = fs.realPath(realRoot);
    const holderBase = fs.realPath(holder);
    if (isBelow(realBase, holderBase) || isBelow(holderBase, realBase) || resolve(realBase) === resolve(holderBase)) return fail('the scratch directory would overlap the checkout');
    const root = join(holder, 'checkout');
    fs.makeDir(root);
    const copied = copyFiles(fs, realRoot, root, listed.value, limits);
    if (!copied.ok) return fail(copied.reason);
    // A standalone repository: its own `.git`, no remote, no template (so no hook file), no link to the real one.
    const init = sys.exec('git', ['init', '-q', '--template=', root], { isolatedGit: {}, timeoutMs: 60_000 });
    if (init.code !== 0 || init.failure !== undefined) return fail('git could not initialise the scratch repository');
    return { ok: true, scratch: openScratch(fs, limits, realRoot, holder, copied.value.skipped) };
  } catch (e) {
    return fail(described('building the scratch', e));
  }
}

export function scratchHostWith(fs: ScratchFs, limits: ScratchLimits = DEFAULT_SCRATCH_LIMITS): ScratchHost {
  return { open: (sys, realRoot) => exportScratch(fs, limits, sys, realRoot) };
}

/** The real thing: node's file system, the default bounds. */
export const nodeScratchHost: ScratchHost = scratchHostWith(nodeScratchFs);

/**
 * The exact bytes a commit would record, named so a decision can be about them.
 *
 * THE GAP THIS CLOSES. A gatekeeper decision binds four facts: project, phase, `subjectCommit` and
 * `requestDigest`. `subjectCommit` is HEAD — the BASE the work sits on — and the work itself is
 * uncommitted, so HEAD names none of it. The evidence the reviewer read carried failing checks,
 * findings, effects and attempt counts, and no diff, no changed-path list and no content digest at
 * all. A decision approving a commit was therefore approving bytes the reviewer had provably never
 * seen, and post-approval drift was undetectable by construction rather than merely unchecked.
 *
 * HOW IT BINDS, WITHOUT A FIFTH FIELD ON THE DECISION. The identity goes INTO the evidence text. Its
 * digest is one of `evidenceDigests`; `gatekeeperRequestDigest` covers `evidenceDigests`; the decision
 * must match that request digest or `checkGatekeeperDecision` refuses it. So a decision that passed
 * its check is already a decision about these exact bytes, through machinery that existed and was
 * already load-bearing. Adding a fifth binding would have been a gate-contract redesign to obtain a
 * property the contract could already carry.
 *
 * WHY `git hash-object` AND NOT A TEMPORARY INDEX. `git write-tree` over a scratch `GIT_INDEX_FILE`
 * would produce a real tree id, which is tempting — but it WRITES blobs into the object store, and it
 * needs `GIT_INDEX_FILE` in the child's environment, which this runtime deliberately does not permit:
 * git children get a fixed allowlist that names no repository, config or object store. `hash-object`
 * WITHOUT `-w` computes exactly the same blob ids and writes nothing at all. The canonical encoding
 * below is then equivalent for ProjectOS's candidate semantics and strictly less invasive.
 *
 * WHAT CHANGES THE IDENTITY, all of which are proven in `candidateIdentity.test.ts`:
 *   - one byte of any candidate file            (the blob id changes)
 *   - a file added to the candidate             (a new path joins the sorted list)
 *   - a file deleted                            (its entry becomes `deleted`, blob null)
 *   - a rename                                  (a delete and an add — two entries change)
 *   - the boundary itself                       (the sorted path list is part of the encoding)
 *
 * WHAT IT HONESTLY DOES NOT CARRY. This repository is `core.filemode=false`, so git itself does not
 * track the executable bit here and neither does this: the mode recorded is the one git would record,
 * read from the index for a tracked path. Claiming to detect a mode change git discards would be a
 * claim the checkout cannot support. On a `core.filemode=true` checkout the index mode moves with the
 * bit and the identity moves with it.
 *
 * THE BOUNDARY IS DERIVED, NEVER SUPPLIED. It is whatever git reports as changed — the same
 * `porcelainPaths` parse the observation and the evidence collector already share. There is no
 * parameter through which a caller could name a different set, because the set of files that would be
 * committed is not a matter of opinion, and "unrelated drift" needs no separate check: a path that
 * appears or disappears changes the sorted list and therefore the digest.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { createHash } from 'node:crypto';
import type { System } from '../system.js';
import { porcelainPaths } from './observation.js';
import {
  CANDIDATE_IDENTITY_SCHEMA_VERSION,
  type CandidateEntry,
  type CandidateIdentity,
} from '@projectos/core';

/** The mode git records for an ordinary file it has just started tracking. */
const DEFAULT_FILE_MODE = '100644';

export type CandidateResult =
  | { readonly ok: true; readonly identity: CandidateIdentity }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * The canonical encoding the digest is taken over.
 *
 * ENCODED AS JSON OF A FIXED-ORDER ARRAY, for exactly the reason `gatekeeperRequestDigest` is: joining
 * fields with a separator lets a value containing that separator move a field boundary, so two
 * different candidates hash alike. A path may contain almost anything, including spaces; `JSON.stringify`
 * delimits unambiguously and emits no control characters, so the digest stays a text-safe value that
 * can sit inside evidence and inside a diff a person has to read.
 */
function encode(entries: readonly CandidateEntry[]): string {
  return JSON.stringify(entries.map((e) => [e.path, e.state, e.blob, e.mode]));
}

/** The digest of a set of entries. Exported so a comparison never has to re-run git. */
export function candidateDigest(entries: readonly CandidateEntry[]): string {
  return `sha256:${createHash('sha256').update(encode(entries), 'utf8').digest('hex')}`;
}

function git(sys: System, root: string, args: readonly string[]): { ok: boolean; out: string; err: string } {
  const r = sys.exec('git', ['-C', root, ...args]);
  return { ok: r.code === 0, out: r.stdout, err: (r.stderr || '').trim() };
}

/**
 * The modes git currently records for the candidate's tracked paths.
 *
 * READ FROM THE INDEX, which is what a commit would carry forward for a path whose content changed.
 * A path absent from this map is untracked, and takes git's own default for a new file.
 */
function indexModes(sys: System, root: string, paths: readonly string[]): ReadonlyMap<string, string> {
  const modes = new Map<string, string>();
  if (paths.length === 0) return modes;
  const r = git(sys, root, ['ls-files', '--stage', '-z', '--', ...paths]);
  if (!r.ok) return modes;
  for (const record of r.out.split('\0')) {
    // `<mode> <object> <stage>\t<path>`
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const mode = record.slice(0, record.indexOf(' '));
    const path = record.slice(tab + 1).replace(/\\/g, '/');
    if (mode !== '' && path !== '') modes.set(path, mode);
  }
  return modes;
}

/**
 * Name the candidate exactly, or say why it cannot be named.
 *
 * EVERY GIT FAILURE IS A REFUSAL, never an assumption. An identity computed from a git call that did
 * not work would be an identity that quietly describes less than it claims to — and this value's
 * whole job is to be compared against itself later, where "fewer entries than last time" reads as
 * agreement if the absence went unnoticed.
 */
export function computeCandidateIdentity(sys: System, root: string): CandidateResult {
  // `--untracked-files=all`, AND THE DEFAULT WOULD HAVE BEEN A HOLE IN THE CANDIDATE.
  //
  // Plain `git status --porcelain` collapses a wholly-untracked directory to a single entry ending in
  // `/` — `deep/` rather than `deep/deeper/x.txt`. A candidate built from that names a directory it
  // cannot hash, so an entire new subtree added after review would either fail to be named at all or,
  // had the encoding tolerated it, be summarised by one path whose digest never changes when its
  // contents do. `-uall` lists every untracked file individually. Found by the nested-directory test,
  // which existed precisely because "the boundary is not only the top level" is easy to assume.
  //
  // THE FLAG IS THIS FUNCTION'S, NOT THE PARSER'S. `porcelainPaths` is shared with `observeRepository`
  // and `collectEvidence`, which have their own reasons for the summary form; only the call here needs
  // every file.
  const status = git(sys, root, ['status', '--porcelain', '--untracked-files=all']);
  if (!status.ok) {
    return {
      ok: false,
      problems: [
        'the working tree could not be read, so the candidate cannot be named',
        ...(status.err === '' ? [] : [`  ${status.err}`]),
      ],
    };
  }

  const paths = [...new Set(porcelainPaths(status.out))].sort();
  if (paths.length === 0) {
    // A CANDIDATE OF NOTHING IS STILL AN IDENTITY, and it must be a real one: a clean tree has a
    // stable digest of its own, so "there is nothing to commit" and "the candidate is unknown" stay
    // different answers. The commit contract refuses an empty candidate separately, where the refusal
    // can say so plainly.
    return { ok: true, identity: { schemaVersion: CANDIDATE_IDENTITY_SCHEMA_VERSION, digest: candidateDigest([]), entries: [] } };
  }

  const present: string[] = [];
  const deleted: string[] = [];
  for (const p of paths) (sys.exists(joinRepoPath(root, p)) ? present : deleted).push(p);

  // ONE CALL FOR EVERY PRESENT PATH. `hash-object` takes many paths and answers one line each, in
  // order — so the mapping back is positional, and a short answer is a refusal rather than a silent
  // truncation of the candidate.
  const blobs = new Map<string, string>();
  if (present.length > 0) {
    const hashed = git(sys, root, ['hash-object', '-t', 'blob', '--', ...present]);
    if (!hashed.ok) {
      return {
        ok: false,
        problems: [
          'the candidate content could not be hashed, so the candidate cannot be named',
          ...(hashed.err === '' ? [] : [`  ${hashed.err}`]),
        ],
      };
    }
    const lines = hashed.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length !== present.length) {
      return {
        ok: false,
        problems: [
          `git hashed ${lines.length} of ${present.length} candidate path(s), so the candidate cannot ` +
            'be named completely — a partial identity would compare equal to a smaller candidate',
        ],
      };
    }
    present.forEach((p, i) => blobs.set(p, String(lines[i])));
  }

  const modes = indexModes(sys, root, paths);
  const entries: CandidateEntry[] = paths.map((path) => {
    const isDeleted = deleted.includes(path);
    return {
      path,
      state: isDeleted ? ('deleted' as const) : ('present' as const),
      blob: isDeleted ? null : (blobs.get(path) ?? null),
      mode: modes.get(path) ?? DEFAULT_FILE_MODE,
    };
  });

  // A PRESENT PATH WITH NO BLOB IS A HOLE, not a candidate entry. It would encode identically to a
  // deleted file's null and make two different worlds hash alike.
  const holes = entries.filter((e) => e.state === 'present' && e.blob === null).map((e) => e.path);
  if (holes.length > 0) {
    return { ok: false, problems: [`no content digest was obtained for: ${holes.join(', ')}`] };
  }

  return { ok: true, identity: { schemaVersion: CANDIDATE_IDENTITY_SCHEMA_VERSION, digest: candidateDigest(entries), entries } };
}

/** Repo-relative path to an absolute one, in the one spelling git reports. */
function joinRepoPath(root: string, rel: string): string {
  const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/';
  return `${root}${sep}${rel}`;
}

/**
 * What changed between two candidates, for a refusal that can be acted on.
 *
 * Not a decision — `authoriseTechnicalContinuation` decides, on the digests alone. This only explains
 * a difference it has already found, so an operator is not left comparing hex strings by eye.
 */
export function describeCandidateDrift(
  reviewed: readonly CandidateEntry[],
  current: readonly CandidateEntry[],
): readonly string[] {
  const before = new Map(reviewed.map((e) => [e.path, e]));
  const after = new Map(current.map((e) => [e.path, e]));
  const lines: string[] = [];
  for (const [path, e] of after) {
    const was = before.get(path);
    if (was === undefined) lines.push(`added since review: ${path}`);
    else if (was.blob !== e.blob) lines.push(`content changed since review: ${path}`);
    else if (was.state !== e.state) lines.push(`state changed since review: ${path} (${was.state} -> ${e.state})`);
    else if (was.mode !== e.mode) lines.push(`mode changed since review: ${path} (${was.mode} -> ${e.mode})`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) lines.push(`no longer part of the candidate: ${path}`);
  }
  return lines;
}

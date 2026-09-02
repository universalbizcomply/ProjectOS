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
 * EXCEPT FOR THE RECORDS THE ASKING ITSELF CREATES, AND WITHOUT THAT NOTHING COULD EVER BE COMMITTED.
 *
 * The identity is captured while the evidence is built, which is BEFORE the gatekeeper is asked. The
 * ask then writes, inside the governed root, the records ProjectOS keeps about having asked: the spend
 * ledger and its lock and temporary file, the thread continuity record, the decision evidence, and the
 * durable work checkpoint. Every one of those is a tracked file in this repository. So by the time the
 * executor re-derives the candidate to check it against the decision, the candidate has moved — and it
 * moved because the question was asked. `authoriseTechnicalContinuation` then refuses with "the
 * candidate changed after the gatekeeper reviewed it", correctly, about a change nobody made. The
 * whole chain could never commit anything, and the end-to-end proof missed it because its fixture
 * supplies no ledger and no evidence ports: those exist only in production.
 *
 * SO THE SUBTRACTED SET IS CLOSED, EXPLICIT, AND IMPORTED FROM THE MODULES THAT OWN THOSE PATHS —
 * never a directory, never `.projectops/**`, and never anything a caller, a model or a checkpoint can
 * name. Six are exact paths; the seventh — decision evidence, whose filename carries a per-request id
 * — is bounded by the WRITER's own filename shape, so it too admits only what ProjectOS can create. A future rename of one of those records moves the exclusion with it, because
 * the constant is the same one the writer uses.
 *
 * WHAT THIS DOES NOT DO, which is the part that matters. It hides nothing from git and untracks
 * nothing: those records stay tracked evidence and are committed by the ordinary route. It removes
 * them only from the answer to "which bytes would this commit record", which is the one question they
 * cannot honestly be part of — a reviewer cannot review bytes that do not exist until after it has
 * answered. Plans, phase records, authority records, configuration, source, the proof artifact and the
 * worker's own findings and effects are all still inside the candidate, and one changed byte in any of
 * them still moves the digest.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { createHash } from 'node:crypto';
import type { System } from '../system.js';
import { porcelainPaths } from './observation.js';
import {
  GATEKEEPER_DECISIONS_REL,
  GATEKEEPER_LEDGER_LOCK_REL,
  GATEKEEPER_LEDGER_REL,
  GATEKEEPER_THREAD_REL,
} from './gatekeeperConfig.js';
import { WORK_RECORD_REL } from './workRecord.js';
import {
  CANDIDATE_IDENTITY_SCHEMA_VERSION,
  type CandidateEntry,
  type CandidateIdentity,
} from '@projectos/core';

/** The mode git records for an ordinary file it has just started tracking. */
const DEFAULT_FILE_MODE = '100644';

/**
 * The records ProjectOS writes BECAUSE it asked, named by the modules that own them.
 *
 * Exact paths, not patterns. Each is here for one reason and one only: asking the gatekeeper a
 * question changes its bytes, so it cannot also be part of the answer to which bytes the question was
 * about. Nothing here carries source, configuration, a plan, a phase record, authority, or the
 * worker's own assertions.
 */
const ASKING_RECORD_PATHS: readonly string[] = [
  // The spend ledger, plus the two files its exclusive write leaves beside it.
  GATEKEEPER_LEDGER_REL,
  `${GATEKEEPER_LEDGER_REL}.tmp`,
  GATEKEEPER_LEDGER_LOCK_REL,
  `${GATEKEEPER_LEDGER_LOCK_REL}.leaked`,
  // Thread continuity: which provider response this run follows.
  GATEKEEPER_THREAD_REL,
  // The durable work checkpoint, rewritten at every reported state — including the one reported
  // immediately before the call goes out.
  WORK_RECORD_REL,
];

/**
 * The only filename the decision-evidence writer can produce.
 *
 * `gatekeeperDecisionEvidenceRelPath` refuses any request id outside this charset before it becomes a
 * path, so a file this pattern does not match is a file that writer did not create. Matching the
 * WRITER's own shape rather than merely "a .json in that directory" is what keeps the excluded set
 * closed: `anything-i-want.json` is not a decision record and stays inside the candidate.
 */
const DECISION_EVIDENCE_FILENAME = /^[A-Za-z0-9_-]{4,128}\.json$/;

/**
 * Is this path one of the records the asking itself creates?
 *
 * Six exact paths, plus decision evidence — which cannot be an exact path because the request id is
 * derived per request. That one is matched at exactly one level below its own directory AND against
 * the writer's own filename shape, so it is bounded by what ProjectOS can actually write rather than
 * by where a file happens to sit. A nested path, a different extension, or a name the writer could
 * never have produced all stay inside the candidate.
 */
function isAskingRecord(path: string): boolean {
  if (ASKING_RECORD_PATHS.includes(path)) return true;
  const prefix = `${GATEKEEPER_DECISIONS_REL}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return !rest.includes('/') && DECISION_EVIDENCE_FILENAME.test(rest);
}

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

  // SUBTRACTED HERE, ONCE, WHERE THE BOUNDARY IS FORMED. Doing it later would mean the digest and
  // the entry list could disagree about what the candidate is.
  const paths = [...new Set(porcelainPaths(status.out))].filter((p) => !isAskingRecord(p)).sort();
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

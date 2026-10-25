/**
 * WAITING FOR MURAD TO COMMIT THE EXACT BUNDLE HE WAS SHOWN.
 *
 * WHAT THIS RECORD IS FOR, AND THE ONE THING IT ADDS. `checkClosureDecision` already refuses an
 * uncommitted decision, and `decisionIsCommitted` already establishes committedness from git. What
 * neither can answer is whether the bytes that were COMMITTED are the bytes that were PRESENTED: a
 * record written, shown to the owner, then edited before the commit would satisfy every existing
 * check while saying something the owner never read. Nothing in the repository remembers what was
 * presented, so this record does — each path, and the digest of its exact bytes.
 *
 * AND IT IS THE WHOLE BUNDLE, NOT THE DECISION ALONE. The owner's commit was always two governed
 * files: the decision, and the gatekeeper ledger entry the paid call necessarily wrote after the
 * evidence subject. Binding only the first meant the ask could truthfully say "commit these two
 * exactly" while ProjectOS would afterwards verify one of them — so an older ledger, a ledger with an
 * extra entry, or a ledger from another run could enter the repository inside a commit this route
 * then treats as the owner's act. Every entry is digested at presentation and compared against the
 * COMMITTED BLOB at resume; any mismatch refuses, and nothing is silently refreshed.
 *
 * IT IS NOT AUTHORITY, AND CANNOT BECOME AUTHORITY. Nothing here grants, permits or satisfies
 * anything. It is a NARROWING record: every check it enables can only refuse a closure that would
 * otherwise have proceeded. Deleting it does not unlock a closure — `closureDecisionProblems` and G4
 * still have to pass — it only removes ProjectOS's ability to notice that the presented decision and
 * the committed one differ, which is why it is written before the owner is asked and never after.
 *
 * WHY THE DIGEST IS TAKEN OVER CR-STRIPPED BYTES. `git show` returns what the object store holds, and
 * this repository's own broker-verification does the same stripping for the same reason: a carriage
 * return is a line-ending artefact of the platform, not a change to the decision. A CR-only
 * difference is therefore NOT detected, and that is stated rather than glossed — every content byte
 * is. Inside a JSON string a literal CR is not representable (it is escaped as `\r`, two characters
 * that survive stripping), so nothing the authority actually said can hide in the difference.
 *
 * WHERE IT LIVES. `.projectops/closure/waits/<phaseId>.json`, which is already inside the
 * `.projectops/closure/` closure-tail prefix — so writing one does not make the closure evidence
 * stale under G4-12. That was checked against `CLOSURE_TAIL_PATHS`, not assumed.
 *
 * Created in PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A.
 */
import { createHash } from 'node:crypto';
import { join, projectopsDir } from './context.js';
import type { System } from './system.js';
import { closureDecisionPath, closureDecisionRelPath } from './closureGate.js';
import type { ClosureDecisionRecord, GatekeeperProvenance } from '@projectos/core';

/**
 * `1.1.0` because the record gained `bundle`, and a `1.0.0` wait cannot be read as one.
 *
 * A 1.0.0 record names only the decision, so treating it as a bundle of one would silently accept a
 * commit whose ledger half was never checked — the exact gap this version exists to close. The reader
 * refuses an unrecognised version outright, which is the correct behaviour here: an old wait is
 * re-asked, not reinterpreted.
 */
export const CLOSURE_WAIT_SCHEMA_VERSION = '1.1.0';

/** A phase id narrow enough to become a filename without traversing, hiding or colliding. */
const SAFE_PHASE_ID = /^[A-Za-z0-9_-]{4,128}$/;

/** The digest form every presented byte-identity takes. */
const SHA256 = /^sha256:[0-9a-f]{64}$/;

/** A commit id, as git writes it. */
const HEX40 = /^[0-9a-f]{40}$/;

export function isSafeClosurePhaseId(phaseId: string): boolean {
  return SAFE_PHASE_ID.test(phaseId);
}

/** Repo-relative path of a closure wait. `null` when the phase id could not safely become one. */
export function closureWaitRelPath(phaseId: string): string | null {
  return isSafeClosurePhaseId(phaseId) ? `.projectops/closure/waits/${phaseId}.json` : null;
}

export function closureWaitPath(root: string, phaseId: string): string | null {
  return isSafeClosurePhaseId(phaseId)
    ? join(projectopsDir(root), 'closure', 'waits', `${phaseId}.json`)
    : null;
}

/**
 * One governed file in the closure bundle, with the exact bytes that were presented for it.
 *
 * Added in the FINAL ROUTE-A PRE-COMMIT AMENDMENT.
 */
export interface ClosureBundleEntry {
  /** Repo-relative, so it reads the same in the ask and in `git show`. */
  readonly path: string;
  readonly sha256: string;
}

/**
 * What ProjectOS is waiting for, and what it will accept.
 *
 * Every field is a FACT ABOUT THE ASK, not a permission.
 *
 * `bundle` IS THE LOAD-BEARING ONE, AND IT USED TO BE ONE FILE. The owner's commit was always two
 * governed files — the decision, and the ledger entry the paid call necessarily wrote after the
 * evidence subject — and only the first was byte-bound. So the second could be anything at all by the
 * time it was committed: an older ledger, a ledger with an extra entry, a ledger from another run. It
 * is not authority, but it IS governed state entering the repository inside a commit ProjectOS then
 * treats as the owner's act, and "we checked one of the two files we asked for" is not a binding.
 * Every entry is now digested at presentation and compared against the COMMITTED blob at resume.
 *
 * `decisionPath`/`decisionSha256` remain, and are the first entry of `bundle`. They are kept because
 * the decision is the one file with a distinguished role — it is the thing being decided, the thing
 * `checkClosureDecision` reads, and the one the ask must point at by name. The bundle says what the
 * commit must contain; these say which of it is the decision.
 */
export interface ClosureWaitRecord {
  readonly schemaVersion: string;
  readonly projectId: string;
  readonly phaseId: string;
  /** Where the owner must commit from. Repo-relative, so it reads the same in the ask and in git. */
  readonly decisionPath: string;
  /** The digest of the exact bytes written and presented. */
  readonly decisionSha256: string;
  /**
   * EVERY governed file the owner is asked to commit, decision first, each with its presented bytes.
   *
   * It is exhaustive by construction: `closure request` refuses to create a wait while any governed
   * path outside this set is dirty, so there is nothing the owner could be asked to commit that this
   * list does not name.
   */
  readonly bundle: readonly ClosureBundleEntry[];
  /**
   * The repository head at the moment the ask was made.
   *
   * IT ANSWERS THE QUESTION THE DIGESTS CANNOT. Verifying each bundle entry proves the two named files
   * are the ones the owner was shown; it proves nothing about what ELSE their commit carried. Several
   * governed directories are closure-tail paths, so a file dropped into one of them during the wait
   * would be invisible to the bundle AND waved through by G4-12. Recording the head lets resume bound
   * everything the commit introduced to exactly the bundle. Raised as HIGH by the ECC security review
   * of this amendment.
   */
  readonly headAtRequest: string;
  readonly decisionId: string;
  readonly decidedBy: string;
  readonly decision: string;
  readonly evidenceSubjectHead: string;
  /** The closure request this answer came from, so the wait names its own provenance. */
  readonly requestId: string;
  readonly requestDigest: string;
  readonly requestedAt: string;
  /**
   * How the closure decision was obtained, as the ROUTE that received it stated — the evidence class,
   * never authority. Carried into the closing history note. Absent on waits written before hybrid
   * routing, which read as unrecorded rather than as either class.
   */
  readonly provenance?: GatekeeperProvenance;
  readonly hostAttestationId?: string;
  /** `WAITING_OWNER` until a closure consumes it, then `CLOSED`. Never authority; only truthfulness. */
  readonly state: 'WAITING_OWNER' | 'CLOSED';
  readonly resolvedAt?: string;
}

/** The canonical bytes of a decision record. One serialisation, so one digest. */
export function closureDecisionBytes(record: ClosureDecisionRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** The digest of decision bytes, over the CR-stripped form. See the header. */
export function closureDecisionSha256(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes.split('\r').join(''), 'utf8').digest('hex')}`;
}

/**
 * Write the decision the owner is being asked to commit, and report exactly what was written.
 *
 * IT REFUSES TO OVERWRITE A DIFFERENT DECISION. A decision file already on disk whose bytes differ is
 * a second answer to one question, and silently replacing it would destroy the record of the first
 * while the owner may already have been shown it. Identical bytes are reported as already written,
 * because re-asking the same question must be idempotent and must not look like a new decision.
 */
export type DecisionWriteOutcome =
  | { readonly kind: 'written' | 'already-written'; readonly relPath: string; readonly sha256: string }
  | { readonly kind: 'conflict'; readonly relPath: string; readonly detail: string };

export function writeClosureDecisionForOwner(
  sys: System,
  root: string,
  phaseId: string,
  record: ClosureDecisionRecord,
): DecisionWriteOutcome {
  const relPath = closureDecisionRelPath(phaseId);
  const path = closureDecisionPath(root, phaseId);
  const bytes = closureDecisionBytes(record);
  const sha256 = closureDecisionSha256(bytes);

  const existing = sys.readText(path);
  if (existing !== null) {
    if (closureDecisionSha256(existing) === sha256) return { kind: 'already-written', relPath, sha256 };
    return {
      kind: 'conflict',
      relPath,
      detail:
        `a different closure decision already exists at ${relPath}. Two answers to one closure question ` +
        'cannot both be the decision, and this route will not overwrite the first. Resolve it by hand.',
    };
  }
  sys.writeText(path, bytes);
  return { kind: 'written', relPath, sha256 };
}

export function writeClosureWait(sys: System, root: string, wait: ClosureWaitRecord): boolean {
  const path = closureWaitPath(root, wait.phaseId);
  if (path === null) return false;
  sys.writeText(path, `${JSON.stringify(wait, null, 2)}\n`);
  return true;
}

export type ClosureWaitReadResult =
  | { readonly ok: true; readonly value: ClosureWaitRecord | null }
  | { readonly ok: false; readonly problem: string };

/**
 * Read the wait for a phase.
 *
 * A MALFORMED WAIT IS NOT AN ABSENT ONE. Treating unreadable as absent would silently discard the
 * only record of which bytes were presented, and the next resume would then accept whatever happened
 * to be committed. The same rule `readWorkRecord` and `readSession` had to learn.
 */
export function readClosureWait(sys: System, root: string, phaseId: string): ClosureWaitReadResult {
  const path = closureWaitPath(root, phaseId);
  if (path === null) return { ok: false, problem: `phase '${phaseId}' does not make a safe closure-wait record name` };
  const raw = sys.readText(path);
  if (raw === null) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: `the closure wait at ${closureWaitRelPath(phaseId)} is not readable JSON` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problem: `the closure wait at ${closureWaitRelPath(phaseId)} is not an object` };
  }
  const r = parsed as Record<string, unknown>;
  if (r['schemaVersion'] !== CLOSURE_WAIT_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        `the closure wait declares schemaVersion ${JSON.stringify(r['schemaVersion'])}, and this runtime ` +
        `writes ${CLOSURE_WAIT_SCHEMA_VERSION}`,
    };
  }
  if (r['state'] !== 'WAITING_OWNER' && r['state'] !== 'CLOSED') {
    return { ok: false, problem: `the closure wait declares an unrecognised state ${JSON.stringify(r['state'])}` };
  }
  // THE BUNDLE IS CHECKED FOR SHAPE HERE, not just for presence. A wait whose bundle is malformed
  // cannot say what the owner was asked to commit, and a wait that cannot say that must be refused
  // rather than read as "the decision only" — which is precisely the narrower binding this version
  // replaced.
  const bundle = r['bundle'];
  if (!Array.isArray(bundle) || bundle.length === 0) {
    return { ok: false, problem: `the closure wait at ${closureWaitRelPath(phaseId)} names no closure bundle` };
  }
  for (const entry of bundle) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, problem: `the closure wait bundle contains an entry that is not an object` };
    }
    const b = entry as Record<string, unknown>;
    if (typeof b['path'] !== 'string' || b['path'].trim() === '') {
      return { ok: false, problem: 'the closure wait bundle contains an entry with no path' };
    }
    if (typeof b['sha256'] !== 'string' || !SHA256.test(b['sha256'])) {
      return { ok: false, problem: `the closure wait bundle entry '${String(b['path'])}' has no valid digest` };
    }
  }
  if (typeof r['headAtRequest'] !== 'string' || !HEX40.test(r['headAtRequest'])) {
    return {
      ok: false,
      problem: `the closure wait at ${closureWaitRelPath(phaseId)} names no valid head for the moment of the ask`,
    };
  }
  return { ok: true, value: parsed as ClosureWaitRecord };
}

/** What a wait must match. Established by the runtime, never read from the record. */
export interface ClosureWaitExpectations {
  readonly projectId: string;
  readonly phaseId: string;
}

/**
 * Why this wait cannot be acted on, or `[]` when it can. Pure — no I/O.
 *
 * Identity only. Whether the DECISION is usable is `checkClosureDecision`'s question and G4's, and
 * this must never grow into a second opinion about it.
 */
export function closureWaitProblems(
  wait: ClosureWaitRecord | null,
  expect: ClosureWaitExpectations,
): readonly string[] {
  if (wait === null) {
    return [
      `no closure wait is recorded for '${expect.phaseId}', so ProjectOS never presented a decision for ` +
        'this phase and has nothing to compare a commit against',
    ];
  }
  const e: string[] = [];
  if (wait.projectId !== expect.projectId) {
    e.push(`the closure wait belongs to project '${wait.projectId}', not '${expect.projectId}'`);
  }
  if (wait.phaseId !== expect.phaseId) {
    e.push(`the closure wait is for phase '${wait.phaseId}', not '${expect.phaseId}'`);
  }
  if (wait.decisionPath !== closureDecisionRelPath(expect.phaseId)) {
    e.push(
      `the closure wait names decision path '${wait.decisionPath}', not the canonical ` +
        `'${closureDecisionRelPath(expect.phaseId)}'`,
    );
  }
  if (typeof wait.decisionSha256 !== 'string' || !SHA256.test(wait.decisionSha256)) {
    e.push('the closure wait names no valid digest of the decision that was presented');
  }
  if (typeof wait.headAtRequest !== 'string' || !HEX40.test(wait.headAtRequest)) {
    e.push('the closure wait names no valid head for the moment the ask was made, so what the owner\'s commit introduced cannot be bounded');
  }

  // THE BUNDLE MUST BE A BUNDLE, AND THE DECISION MUST BE IN IT. A bundle whose first entry is not
  // the decision, or which repeats a path, or whose decision entry disagrees with `decisionSha256`,
  // describes two different asks — and the resume would then have to choose which one the owner was
  // shown, which is a guess.
  const bundle = Array.isArray(wait.bundle) ? wait.bundle : [];
  if (bundle.length === 0) {
    e.push('the closure wait names no closure bundle, so what the owner was asked to commit is unknown');
  } else {
    const first = bundle[0];
    if (first === undefined || first.path !== wait.decisionPath) {
      e.push(
        `the closure bundle does not open with the decision: it names '${String(first?.path)}' where the ` +
          `decision is '${wait.decisionPath}'`,
      );
    } else if (first.sha256 !== wait.decisionSha256) {
      e.push('the closure bundle disagrees with the wait about the decision bytes that were presented');
    }
    const seen = new Set<string>();
    for (const entry of bundle) {
      if (seen.has(entry.path)) {
        e.push(`the closure bundle names '${entry.path}' more than once; one path, one presented digest`);
      }
      seen.add(entry.path);
      if (!SHA256.test(entry.sha256)) {
        e.push(`the closure bundle entry '${entry.path}' names no valid digest`);
      }
      // A bundle path is a governed record path. Anything traversing, absolute or outside
      // `.projectops/` is not something this route ever asked the owner to commit.
      if (entry.path.includes('..') || !entry.path.startsWith('.projectops/')) {
        e.push(`the closure bundle names '${entry.path}', which is not a governed record path`);
      }
    }
  }

  if (wait.state === 'CLOSED') {
    e.push(`the closure wait was already resolved at ${String(wait.resolvedAt ?? 'an unrecorded time')}`);
  }
  return e;
}

/** What git says about one bundle entry. */
export interface BundleEntryObservation {
  readonly path: string;
  readonly presentedSha256: string;
  /** The digest of the COMMITTED blob, or null when the path is in no commit. */
  readonly committedSha256: string | null;
  readonly matches: boolean;
}

/** What git says about the bundle the owner was asked to commit. */
export interface OwnerCommitObservation {
  /** True only when a decision for this phase exists in a commit. */
  readonly committed: boolean;
  /** The digest of the COMMITTED decision bytes, or null when there are none. */
  readonly committedSha256: string | null;
  /**
   * True only when EVERY bundle entry's committed blob is the byte-identical presented one AND the
   * identity that committed them satisfies the plan's owner.
   *
   * THE IDENTITY HALF IS NAMED HERE ON PURPOSE. An earlier version of this comment described only the
   * bytes, which made the field read as weaker than it is — and a caller reasoning from the comment
   * would have added an identity check of its own, giving two answers to one question. Raised as LOW
   * by the ECC code review of this amendment.
   */
  readonly matchesPresented: boolean;
  /** Every entry, whether it matched or not — an operator reading a refusal needs the whole picture. */
  readonly bundle: readonly BundleEntryObservation[];
  /**
   * Who git says made that commit, as `author name <author email>`, or null when it could not be
   * established. Reported whether or not it was accepted, because an operator reading a refusal needs
   * to know which identity was seen.
   */
  readonly committedBy: string | null;
  readonly problems: readonly string[];
}

/**
 * Names that can never be the owner committing.
 *
 * THE SAME PREDICATE `closureDecision.ts` APPLIES TO A DECIDER, applied to a committer. It is a
 * duplicate and the cost is recorded rather than dressed up: two lists can drift, and the tests
 * assert they agree. It is duplicated because that one is private to a pure module that must not
 * learn about git.
 */
function isImplementerName(name: string): boolean {
  const stripped = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const s of ['claude', 'anthropic', 'implementer', 'assistant', 'copilot']) {
    if (stripped.includes(s)) return true;
  }
  return ['ai', 'bot', 'agent', 'llm', 'model'].includes(name.trim().toLowerCase());
}

/**
 * Why the identity that made this commit may not be the owner's, or `[]`.
 *
 * WHAT THIS DOES AND DOES NOT PROVE, stated plainly because the difference is the whole finding.
 * It proves the commit was made under the GIT IDENTITY the approved plan names as owner, and that
 * the identity is not the implementer's. It does NOT prove a person: a git name is configuration,
 * anyone with the checkout can set it, and there is no signature requirement in this programme. That
 * is `tamperProof: false` restated for one more field.
 *
 * WHY IT IS STILL WORTH HAVING. Before it, `decisionIsCommitted` asked only whether A commit existed
 * — so the concrete scenario the ECC security review raised (an implementer's ordinary
 * `git add -A && git commit` sweep picking the decision up incidentally) satisfied the owner gate
 * with nobody having decided anything. Requiring the plan's own owner identity, and refusing an
 * implementer-shaped one outright, makes that sweep visible instead of silent, and does it by
 * comparing against a RECORDED value rather than an invented one — the same rule every other
 * identity in this programme is judged by.
 *
 * The residual — that a git identity is not a person — is carried to the owner, not papered over:
 * closing it needs a committed owner git identity or a signature requirement, which is a governance
 * decision and not this module's to take.
 */
export function ownerCommitIdentityProblems(
  identity: { readonly name: string; readonly email: string } | null,
  expectedOwner: string,
): readonly string[] {
  if (identity === null) {
    return ['git would not say who committed the closure decision, and an unattributable commit is not the owner\'s'];
  }
  if (expectedOwner.trim() === '') {
    return ['the active approved plan records no owner, so no commit can be shown to be the owner\'s'];
  }
  const e: string[] = [];
  if (isImplementerName(identity.name) || isImplementerName(identity.email)) {
    e.push(
      `the closure decision was committed by ${identity.name} <${identity.email}>, which is the ` +
        'implementer — the implementer can never satisfy the owner\'s commit gate, by any route',
    );
  } else if (identity.name !== expectedOwner) {
    e.push(
      `the closure decision was committed by ${identity.name} <${identity.email}>, and the active ` +
        `approved plan records the owner as '${expectedOwner}'. Either the commit was not the owner's, ` +
        'or the checkout\'s git identity does not match the plan; both are resolved by a person, not here.',
    );
  }
  return e;
}

/**
 * Observe, from the repository alone, whether the owner committed the exact decision.
 *
 * FROM THE GIT OBJECT, NOT THE WORKING TREE. Reading the file would digest bytes git never saw — and
 * a tracked symlink is committed once as a link target while `readFileSync` follows it, so the
 * content could then be rewritten freely and stay invisible to `git diff`, `git log` and
 * `git status`. Reading the object makes "what was checked" and "what was committed" the same bytes
 * by construction. The same reasoning `readCommittedDecision` records, applied to the byte digest.
 *
 * ANY GIT FAILURE IS "NOT COMMITTED". An unverifiable commit is not a commit.
 *
 * IT DOES NOT ASK WHETHER THE DECISION IS GOOD. `closureDecisionProblems` and G4 do that, afterwards
 * and independently; this only answers whether the owner acted on the exact bytes they were shown.
 */
export function observeOwnerCommit(
  sys: System,
  root: string,
  wait: ClosureWaitRecord,
  expectedOwner: string,
): OwnerCommitObservation {
  const rel = closureDecisionRelPath(wait.phaseId);
  const identity = committerOf(sys, root, rel);
  const committedBy = identity === null ? null : `${identity.name} <${identity.email}>`;

  // EVERY ENTRY, FROM THE GIT OBJECT. Reading the working tree would digest bytes git never saw, and
  // a tracked symlink is committed once as a link target while a filesystem read follows it — so the
  // content could be rewritten afterwards and stay invisible to `git diff`, `git log` and
  // `git status`. Reading the blob makes "what was checked" and "what was committed" the same bytes
  // by construction, and it is why a working-tree correction can never substitute for a wrong blob.
  const observations: BundleEntryObservation[] = [];
  const problems: string[] = [];
  for (const entry of wait.bundle) {
    const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${entry.path}`]);
    if (shown.code !== 0 || shown.stdout.length === 0) {
      observations.push({ path: entry.path, presentedSha256: entry.sha256, committedSha256: null, matches: false });
      problems.push(
        `${entry.path} is not in a commit. The closure bundle is the two governed files this run asked ` +
          "for, and an uncommitted one has not passed the owner commit gate — the only thing that makes " +
          "a forged record a visible diff under this programme's tamperProof:false model.",
      );
      continue;
    }
    const committed = closureDecisionSha256(shown.stdout);
    const matches = committed === entry.sha256;
    observations.push({ path: entry.path, presentedSha256: entry.sha256, committedSha256: committed, matches });
    if (!matches) {
      problems.push(
        `the committed ${entry.path} is NOT the file that was presented for owner action.`,
        `  presented: ${entry.sha256}`,
        `  committed: ${committed}`,
      );
    }
  }

  const decision = observations.find((o) => o.path === wait.decisionPath) ?? null;
  const committed = decision !== null && decision.committedSha256 !== null;
  const allMatch = observations.length > 0 && observations.every((o) => o.matches);
  if (!allMatch && problems.length > 0) {
    problems.push(
      'the closure bundle changed between being shown and being committed, so what the owner committed ' +
        'is not what this run asked them to commit; nothing is closed on it, and nothing is silently ' +
        'refreshed',
    );
  }

  // AND NOTHING ELSE CAME WITH THEM.
  //
  // The per-entry check above proves the two named files are the ones the owner was shown. It says
  // nothing about what ELSE their commit carried — and several governed directories, `.projectops/
  // closure/` among them, are closure-tail paths that G4-12 deliberately treats as non-substantive.
  // So a file written into one of them AFTER the bundle snapshot and BEFORE the owner's commit was
  // invisible to both checks and rode in unexamined; the owner's own broad `git add` is exactly how it
  // would happen. Bounding everything introduced since the ask to the bundle closes that, and it is
  // the only check that can: the bundle is a set of files, and this is the set of files that moved.
  const bounding = allMatch ? introducedBeyondBundle(sys, root, wait) : [];
  const identityProblems = allMatch && bounding.length === 0 ? ownerCommitIdentityProblems(identity, expectedOwner) : [];

  return {
    committed,
    committedSha256: decision === null ? null : decision.committedSha256,
    matchesPresented: allMatch && bounding.length === 0 && identityProblems.length === 0,
    bundle: observations,
    committedBy,
    problems: [...problems, ...bounding, ...identityProblems],
  };
}

/**
 * Paths the repository gained since the ask that are not in the bundle, or `[]`.
 *
 * IT COMPARES A SET OF FILES WITH A SET OF FILES, which is the only form of this question that can be
 * answered. `git diff --name-only <headAtRequest>..HEAD` is everything the owner's commit — or
 * commits — introduced; the bundle is everything they were asked to introduce. Anything in the first
 * and not the second entered the repository inside a commit this route would otherwise treat as
 * exactly the reviewed bundle.
 *
 * FAILS CLOSED IN BOTH DIRECTIONS. If git cannot answer, or if the recorded head is not an ancestor of
 * HEAD (history rewritten, or a different branch), that is a refusal rather than an empty list — an
 * unbounded commit is not a bounded one.
 */
function introducedBeyondBundle(sys: System, root: string, wait: ClosureWaitRecord): readonly string[] {
  const ancestor = sys.exec('git', ['-C', root, 'merge-base', '--is-ancestor', wait.headAtRequest, 'HEAD']);
  if (ancestor.code !== 0) {
    return [
      `the head this ask was made against (${wait.headAtRequest.slice(0, 7)}) is not an ancestor of the ` +
        'current head, so what the owner\'s commit introduced cannot be bounded to the bundle',
    ];
  }
  const diff = sys.exec('git', ['-C', root, 'diff', '--name-only', `${wait.headAtRequest}..HEAD`]);
  if (diff.code !== 0) {
    return ['git would not say what changed since the ask, so the commit cannot be bounded to the bundle'];
  }
  const expected = new Set(wait.bundle.map((b) => b.path));
  const extra = diff.stdout
    .split(String.fromCharCode(10))
    .map((l) => l.split(String.fromCharCode(13)).join('').trim())
    .filter((l) => l !== '' && !expected.has(l));
  if (extra.length === 0) return [];
  return [
    `the owner's commit introduced ${extra.length} path(s) that were not in the bundle they were shown:`,
    ...extra.slice(0, 10).map((path) => `  ${path}`),
    ...(extra.length > 10 ? [`  … and ${extra.length - 10} more`] : []),
    'the closure bundle is the whole of what was asked for; anything else in the same commit was never ' +
      'presented, never digested, and is not closed on',
  ];
}

/**
 * The identity of the last commit that touched a path, as git reports it.
 *
 * THE AUTHOR AND THE COMMITTER ARE BOTH READ, because `git commit --author` sets one without the
 * other and checking either alone leaves the other free. Any git failure yields null, which the
 * caller treats as unattributable.
 *
 * A NUL SEPARATOR IS SAFE HERE and is nowhere near a source file: `%x00` is a git format directive,
 * the value is parsed and discarded, and no byte of it is written to disk. The lesson recorded in
 * `gatekeeperDecision.ts` is about NUL inside COMMITTED SOURCE, which turns the file binary to git.
 */
function committerOf(sys: System, root: string, rel: string): { name: string; email: string } | null {
  const shown = sys.exec('git', ['-C', root, 'log', '-1', '--format=%an%x00%ae%x00%cn%x00%ce', '--', rel]);
  if (shown.code !== 0) return null;
  const parts = shown.stdout.trim().split(String.fromCharCode(0));
  if (parts.length < 4) return null;
  const authorName = parts[0] ?? '';
  const authorEmail = parts[1] ?? '';
  const committerName = parts[2] ?? '';
  const committerEmail = parts[3] ?? '';
  if (authorName === '' || committerName === '') return null;
  // WHEN THE TWO DISAGREE, THE COMMITTER IS THE ONE THAT MUST SATISFY THE GATE: the author is a
  // label the committer chose, and the committer is the identity that actually ran the command.
  if (authorName !== committerName || authorEmail !== committerEmail) {
    return { name: committerName, email: committerEmail };
  }
  return { name: authorName, email: authorEmail };
}

/** Mark a wait resolved, so a satisfied wait cannot describe an outstanding one. Writes only truth. */
export function resolveClosureWait(sys: System, root: string, wait: ClosureWaitRecord, at: string): void {
  writeClosureWait(sys, root, { ...wait, state: 'CLOSED', resolvedAt: at });
}

/**
 * Reading an owner's degraded-mode risk acceptance from the only place it counts: the git object
 * store.
 *
 * WHAT WAS MISSING, AND WHY IT MATTERED. `checkDegradedModeGrant` has always refused a grant whose
 * `readFromCommittedTree` is not `true` — but that flag was supplied by the CALLER, and nothing in
 * the repository ever produced it from git. Every existing call site is a test, a rehearsal or the
 * proof script, and each hand-writes `readFromCommittedTree: true` on a literal object. So the one
 * artefact that lets work proceed UNREVIEWED had a complete contract and no committed-read path:
 * the guarantee existed on paper and nothing implemented it. That is the gap acceptance criterion 7
 * names by the word "durable", and this file is the smallest thing that closes it.
 *
 * THE FLAG IS NO LONGER A PARAMETER A CALLER CHOOSES. `loadDegradedModeGrant` returns the bytes and
 * the flag together, derived from the same read, so "these are committed bytes" cannot be asserted
 * about bytes that are not. A caller can still lie to the pure checker directly — it is pure, that
 * is its value — but no caller has to, and the honest route is now the easy one.
 *
 * MODELLED CLOSELY ON `ownerGateReceipts.ts`, deliberately. That file already solved the same three
 * problems for a different record: the committed/dirty pair of questions, reading the object rather
 * than the file, and a flat filename. Its own header records that being a second copy of
 * `closureGate.ts`'s pair is a real cost; this is a third, and the cost is the same one. Generalising
 * all three into one committed-record reader is the right fix and is outside this step's boundary,
 * so the debt is recorded here rather than dressed up.
 *
 * THE FLAT FILENAME IS NOT A STYLE CHOICE — same reason as the gate receipt. This project's
 * `.gitignore` excludes `secret*` and `*token*`; a nested layout invites a path that git silently
 * ignores, so the owner commits, sees nothing tracked, and the runtime refuses with no visible
 * cause. The chosen form was checked against the real `.gitignore` with `git check-ignore`, not
 * assumed — but ONLY as a literal filename, which is a weaker statement than it first appears: the
 * ids interpolated into it are not constrained to avoid the words those rules match, and
 * `secrets-handling` is a real owner gate in this project. So the check is also made at runtime, on
 * the uncommitted path, by `grantPathIsIgnored` — see there.
 *
 * ALL GIT INVOCATIONS USE `-C root`, because the ambient-cwd style has failed closed under the
 * packaged daemon, where the process's working directory is not the governed checkout.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for acceptance criteria 7 and 11.
 */
import { join } from 'node:path';
import type { System } from '../system.js';
import type { DegradedModeGrant } from '@projectos/core';

/**
 * Identifiers that may become a filename.
 *
 * Narrow on purpose: both are interpolated into a path, so anything that could traverse, hide or
 * collide is refused rather than sanitised. A phase id and a grant id are short identifiers issued
 * by ProjectOS, so nothing legitimate is excluded.
 */
const SAFE_PHASE_ID = /^[A-Za-z0-9_-]{4,128}$/;
const SAFE_GRANT_ID = /^[A-Za-z0-9_-]{4,128}$/;

export function isSafeGrantId(grantId: string): boolean {
  return SAFE_GRANT_ID.test(grantId);
}

/**
 * Repo-relative path of a degraded-mode grant. `null` when either part could not safely become a
 * filename.
 *
 * Grants live beside the other owner authority records rather than with the gate receipts: a risk
 * acceptance is an authority the owner issues, not an answer to a gate ProjectOS asked.
 */
export function degradedGrantRelPath(phaseId: string, grantId: string): string | null {
  if (!SAFE_PHASE_ID.test(phaseId) || !SAFE_GRANT_ID.test(grantId)) return null;
  return `.projectops/authority/${phaseId}.degraded-grant.${grantId}.json`;
}

/** Absolute path of a degraded-mode grant in a given checkout. */
export function degradedGrantPath(root: string, phaseId: string, grantId: string): string | null {
  const rel = degradedGrantRelPath(phaseId, grantId);
  return rel === null ? null : join(root, ...rel.split('/'));
}

/**
 * Is this grant committed, and unmodified since?
 *
 * Two questions, both necessary. `git log` proves it was committed at all; `git diff HEAD` catches a
 * grant that WAS committed and has since been edited in the working tree — without which the
 * committed version would launder an uncommitted change, and the owner would be held to a sentence
 * they never wrote. Any git failure is `false`: an unverifiable grant is not a grant.
 */
export function grantIsCommitted(sys: System, root: string, phaseId: string, grantId: string): boolean {
  const rel = degradedGrantRelPath(phaseId, grantId);
  if (rel === null) return false;
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return false;
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0) return false;
  return dirty.stdout.trim().length === 0;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The grant AS COMMITTED — read from the git object rather than from the working tree.
 *
 * Reading the file would validate bytes git never saw. A tracked symlink is committed once as a link
 * target while a file read follows it, so the content could then be rewritten freely and stay
 * invisible to `git diff`, `git log` and `git status` — and the boundary this record rests on, "a
 * forged risk acceptance is a visible diff at the owner's commit gate", would be gone. Reading the
 * object makes what is validated and what is committed the same bytes by construction.
 */
export function readCommittedGrant(
  sys: System,
  root: string,
  phaseId: string,
  grantId: string,
): Record<string, unknown> | null {
  const rel = degradedGrantRelPath(phaseId, grantId);
  if (rel === null) return null;
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim().length === 0) return null;
  return parseObject(shown.stdout);
}

/**
 * Is git configured to ignore this grant's path?
 *
 * ASKED BECAUSE THE ID SPACE IS WIDER THAN THE FILENAME I CHECKED. The flat filename was verified
 * against the real `.gitignore` — but only as a literal, and the ids interpolated into it are not
 * constrained to avoid the words those rules match. This repository ignores `secret*` and `*token*`,
 * and `secrets-handling` is a real owner gate here, so a phase called `SECRETS-HANDLING-…` or a
 * grant id containing `TOKEN` produces a basename git silently drops — on Windows, where
 * `core.ignorecase` defaults to true, regardless of case.
 *
 * The consequence is not a bypass: the owner commits, git stores nothing, `grantIsCommitted` is
 * false and the work is refused. It is worse than a bypass in one narrow sense — it is a refusal
 * with no visible cause, which is exactly the failure this file's flat-filename choice exists to
 * avoid. Asking git turns "not committed" into "cannot be committed, and here is why".
 *
 * Only consulted on the uncommitted path, so a healthy run never pays for it. A git failure is
 * `false`: an unanswerable question must not become an accusation.
 */
export function grantPathIsIgnored(sys: System, root: string, phaseId: string, grantId: string): boolean {
  const rel = degradedGrantRelPath(phaseId, grantId);
  if (rel === null) return false;
  // `check-ignore -q` exits 0 when the path IS ignored, 1 when it is not, and >1 on error.
  const checked = sys.exec('git', ['-C', root, 'check-ignore', '-q', '--', rel]);
  return checked.code === 0;
}

/** A grant and the provenance of the bytes it was read from. The two always travel together. */
export interface LoadedDegradedGrant {
  /**
   * The record, or `null`.
   *
   * NEVER holds working-tree bytes. This field is committed bytes or nothing, so a caller that
   * checks only `grant !== null` still cannot proceed on something the owner never committed.
   */
  readonly grant: DegradedModeGrant | null;
  /** True exactly when `grant` is non-null; kept because the pure checker takes it as an input. */
  readonly readFromCommittedTree: boolean;
  /**
   * DIAGNOSTIC ONLY — an uncommitted grant found on disk. Never authority, under any circumstances.
   *
   * It exists so a refusal can say the true thing to an owner looking straight at the file they
   * wrote: it exists, it is not committed, and it therefore authorises nothing. Deliberately a
   * separate field from `grant` rather than the same one with a flag beside it, because a flag is
   * something a caller can forget and a field name is not.
   */
  readonly uncommittedGrantOnDisk: DegradedModeGrant | null;
  /** True when git is configured to ignore this path, which is why nothing could be committed. */
  readonly pathIsGitIgnored: boolean;
}

const NOTHING: LoadedDegradedGrant = {
  grant: null,
  readFromCommittedTree: false,
  uncommittedGrantOnDisk: null,
  pathIsGitIgnored: false,
};

/**
 * Load a grant together with the truth about where its bytes came from.
 *
 * This is the function production code should call, and the reason it exists is that the alternative
 * — read the grant here, decide `readFromCommittedTree` over there — is exactly the shape that let
 * the flag be asserted rather than established. Here one read answers both, so they cannot disagree.
 *
 * `grant` IS COMMITTED BYTES OR NOTHING. An earlier version returned the working-tree copy in the
 * same field with the flag set false, so that a refusal could name the real cause. That put the
 * whole guarantee on every future caller remembering to consult a boolean — and the exemplar this
 * file follows, `readCommittedReceipts`, is stricter than that for a LESS authority-adjacent record.
 * The legible message is still available, from a field whose name cannot be mistaken for authority.
 */
export function loadDegradedModeGrant(
  sys: System,
  root: string,
  phaseId: string,
  grantId: string,
): LoadedDegradedGrant {
  const rel = degradedGrantRelPath(phaseId, grantId);
  if (rel === null) return NOTHING;

  if (grantIsCommitted(sys, root, phaseId, grantId)) {
    const committed = readCommittedGrant(sys, root, phaseId, grantId);
    // A committed path whose object will not parse is not a grant, and must not fall back to the
    // working tree: that fallback is precisely how unparseable-but-committed becomes "read the nice
    // clean copy on disk instead".
    if (committed !== null) {
      return {
        grant: committed as DegradedModeGrant,
        readFromCommittedTree: true,
        uncommittedGrantOnDisk: null,
        pathIsGitIgnored: false,
      };
    }
  }

  const abs = degradedGrantPath(root, phaseId, grantId);
  const raw = abs === null ? null : sys.readText(abs);
  return {
    grant: null,
    readFromCommittedTree: false,
    uncommittedGrantOnDisk: (raw === null ? null : parseObject(raw)) as DegradedModeGrant | null,
    pathIsGitIgnored: grantPathIsIgnored(sys, root, phaseId, grantId),
  };
}

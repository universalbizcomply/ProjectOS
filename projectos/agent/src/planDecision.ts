/**
 * The owner's decision on a proposed plan — the one thing ProjectOS could check but never create.
 *
 * WHAT WAS MISSING. `checkPlanApprovalDecision` has always judged a plan-approval decision against
 * expectations the runtime establishes for itself, and `approvePlan` consumes one. Nothing in the
 * product ever WROTE one. A discovery pass confirmed it exhaustively: `planDecisionPath` had two call
 * sites, one to read and one to stamp `consumedAt`. So the only way a decision could exist was for a
 * person to hand-author JSON with the right project, repository, branch, base commit, plan digest and
 * decider — and every one of those is a field the runtime can derive and the owner cannot be expected
 * to. The owner-facing consequence was exactly what the pilot saw: a proposal, an accurate
 * "No decision yet", and no control anywhere that could change it.
 *
 * WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT REFUSES TO ACCEPT.
 *
 * The caller supplies THREE things: which draft, approve or reject, and an optional note. Everything
 * that carries authority — the project, the repository, the branch, the base commit, the plan digest,
 * who is entitled to decide, the decision id, the time, the path written — is DERIVED here from
 * committed records and from the repository itself. There is deliberately no parameter for any of
 * them. A caller that could supply `decidedBy` could name the authority whose name confers the power,
 * which is a filter on a string rather than a control over anything; this codebase has refused that
 * shape twice already (`phase.close` identity, the operation broker's self-asserted capability), and
 * refuses it a third time here.
 *
 * THE DECIDER COMES FROM `resolveExpectedDecider`, WHICH IS THE FUNCTION `approvePlan` USES.
 * Not a copy of it. A second implementation of "who may approve" would produce decisions that look
 * right and are refused at activation, and the failure would read as a governance problem rather than
 * as the duplication it actually was.
 *
 * WRITING IS NOT APPROVING. A decision has no effect until it is COMMITTED — `approvePlan` reads it
 * with `git show HEAD:./…` and refuses an uncommitted one explicitly. Under this programme's
 * `tamperProof: false` model the commit IS the boundary: a forged or mistaken decision is a visible
 * diff in the owner's own history. `makeDecisionDurable` below performs exactly that one commit and
 * nothing else.
 *
 * IT GRANTS NOTHING BY ITSELF. A written decision cannot start a phase, activate a plan, or authorise
 * an action. `approvePlan` still recomputes the plan material, still re-checks the digest, the
 * binding, the delegation, the decider and plan readiness, and still refuses everything it refused
 * before. This adds a way to record an owner's answer; it changes nothing about what that answer has
 * to survive.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import { buildProposal, loadDiscoveryEngine, type DraftRecord, type Proposal } from './planIntake.js';
import {
  FILENAME_ID,
  PLAN_APPROVAL_DECISION_SCHEMA_VERSION,
  PROJECT_CONFIG_REL,
  authorityOnlyAdvance,
  loadGovernanceEngine,
  planDecisionPath,
  planDecisionsDir,
  readCommittedJson,
  resolveExpectedDecider,
  resolveRecordedOwner,
  revalidateAuthoredDraft,
} from './planApproval.js';

/** The two answers an owner may give. There is no third, and no default. */
export const PLAN_DECISIONS = ['approve', 'reject'] as const;
export type PlanDecision = (typeof PLAN_DECISIONS)[number];

export type DecisionRefusal =
  | 'NO_CONFIG'
  | 'NO_DRAFT'
  | 'UNSAFE_TARGET_PATH'
  | 'PROPOSAL_FAILED'
  | 'DRAFT_SUPERSEDED'
  | 'DRAFT_STALE'
  | 'DRAFT_TAMPERED'
  | 'PROJECT_IDENTITY_MISMATCH'
  | 'NO_ACTIVE_PLAN'
  | 'GENESIS_INVALID'
  | 'DELEGATION_INVALID'
  | 'IMPLEMENTER_CANNOT_DECIDE'
  | 'DECISION_EXISTS';

export interface DecisionRefused {
  readonly ok: false;
  readonly code: DecisionRefusal;
  readonly problems: readonly string[];
}

export interface DecisionWritten {
  readonly ok: true;
  readonly decisionId: string;
  readonly decision: PlanDecision;
  /** Project-relative, which is what the commit and every refusal message name. */
  readonly relPath: string;
  readonly absPath: string;
  readonly planDigest: string;
  readonly decidedBy: string;
  readonly baseHead: string;
  readonly branch: string;
}

export type DecisionResult = DecisionWritten | DecisionRefused;

function refuse(code: DecisionRefusal, problems: readonly string[]): DecisionRefused {
  return { ok: false, code, problems };
}

function readJson(sys: System, path: string): Record<string, unknown> | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The id of one decision, derived from what it decides.
 *
 * DERIVED, NOT ALLOCATED — the same reasoning `plan activate` uses for the record it names, and
 * `deriveRequestId` for a gatekeeper question. A timestamp or a counter would produce a new id for
 * the same answer after a restart, and a second file recording the same decision is a second answer
 * for a reader to choose between.
 *
 * THE VERDICT IS PART OF THE IDENTITY. An approval and a rejection of the same material are different
 * decisions and must never derive the same filename, or recording one would overwrite the other.
 * (`writePlanApprovalDecision` refuses a second decision for a draft outright, so the two can never
 * both exist — but the identity would be wrong even if it did not, and a name that is only correct
 * because of a check somewhere else is a name waiting to be wrong.)
 */
export function derivePlanDecisionId(input: {
  readonly projectId: string;
  readonly draftId: string;
  readonly planDigest: string;
  readonly decision: PlanDecision;
}): string {
  const canonical = JSON.stringify([input.projectId, input.draftId, input.planDigest, input.decision]);
  return `PLANDEC-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)}`;
}

/**
 * The proposal this draft stands for, resolved exactly as `approvePlan` resolves it.
 *
 * TWO ORIGINS, TWO ROUTES, AND THE ROUTE IS CHOSEN BY A FIELD THE DIGEST BINDS. Objective-led
 * material cannot be re-derived — asking the author again produces different words — so it is READ,
 * validated against the same contract it was written under, and re-digested. Corpus-led material is
 * RECOMPUTED from the repository, because it can be, and recomputing is both a staleness check and a
 * tamper check.
 *
 * The decision must be stamped with the digest activation will compute, or it is a decision about
 * material that no longer exists. That is why this asks the same question the same way rather than
 * reading `draft.planDigest` and hoping.
 */
function proposalForDraft(
  sys: System,
  root: string,
  draft: DraftRecord,
  draftId: string,
): { readonly ok: true; readonly proposal: Proposal } | DecisionRefused {
  const engine = loadDiscoveryEngine();
  if (draft.origin === 'authored') {
    // NO AUTHORITY ADVANCE IS ALLOWED HERE, and that is not an omission. This runs BEFORE the decision
    // is written, so there is no decision commit to sit between the reviewed HEAD and now: the draft
    // must be bound to HEAD exactly. Passing an allowance would mean accepting a repository that had
    // already moved for reasons this step cannot see.
    const revalidated = revalidateAuthoredDraft(sys, root, engine, draft);
    if (!revalidated.ok) {
      return refuse(revalidated.code as DecisionRefusal, revalidated.problems);
    }
    return { ok: true, proposal: revalidated.proposal };
  }
  const rebuilt = buildProposal(sys, root, engine);
  if (!rebuilt.ok) return refuse('PROPOSAL_FAILED', [`${rebuilt.code}: ${rebuilt.detail}`]);
  if (typeof draft.planDigest !== 'string') {
    return refuse('DRAFT_SUPERSEDED', [
      `draft '${draftId}' records no plan digest — it predates the approval mechanism. Regenerate it.`,
    ]);
  }
  if (draft.planDigest !== rebuilt.planDigest) {
    return refuse('DRAFT_SUPERSEDED', [
      `the stored draft proposes plan material ${draft.planDigest.slice(7, 19)}, but this repository now ` +
        `proposes ${rebuilt.planDigest.slice(7, 19)}. There is nothing here to decide on — regenerate the draft.`,
    ]);
  }
  return { ok: true, proposal: rebuilt };
}

/** Every decision already recorded for this draft, whatever it decided. */
function existingDecisionFor(sys: System, root: string, draftId: string): string | null {
  for (const name of sys.listDir(planDecisionsDir(root))) {
    if (!name.endsWith('.json')) continue;
    const record = readJson(sys, join(planDecisionsDir(root), name));
    if (record !== null && record['draftId'] === draftId) return name.replace(/\.json$/, '');
  }
  return null;
}

export interface WriteDecisionOptions {
  readonly draftId: string;
  readonly decision: PlanDecision;
  /** The owner's own words, optional. Data — it decides nothing and is never parsed. */
  readonly note?: string;
}

/**
 * Record the owner's decision on one proposal.
 *
 * Writes the record and returns where it is. It does NOT commit it — see `makeDecisionDurable`, which
 * is a separate step because it is a separate act: writing is ProjectOS transcribing an answer, and
 * committing is that answer entering the history the whole authority model rests on.
 */
export function writePlanApprovalDecision(sys: System, root: string, opts: WriteDecisionOptions): DecisionResult {
  if (!FILENAME_ID.test(opts.draftId)) {
    return refuse('UNSAFE_TARGET_PATH', [
      `the draft id '${opts.draftId}' is not a plain identifier (letters, digits, underscore and hyphen only)`,
    ]);
  }
  if (!(PLAN_DECISIONS as readonly string[]).includes(opts.decision)) {
    return refuse('UNSAFE_TARGET_PATH', [`'${String(opts.decision)}' is not a decision; it is approve or reject`]);
  }

  const config = readJson(sys, join(projectopsDir(root), 'project-config.json'));
  if (config === null) return refuse('NO_CONFIG', ['no readable .projectops/project-config.json']);

  const draft = readJson(sys, join(projectopsDir(root), 'drafts', `${opts.draftId}.json`)) as DraftRecord | null;
  if (draft === null) {
    return refuse('NO_DRAFT', [`no draft '${opts.draftId}' — there is nothing to decide on`]);
  }

  // ONE DECISION PER PROPOSAL. Checked before anything is derived, because the answer is the same
  // whatever the repository says and the operator needs the specific reason rather than a digest one.
  //
  // A REJECTION IS AS FINAL AS AN APPROVAL. Overwriting one would erase the record of what the owner
  // actually said; writing a second alongside it would leave two answers for one proposal and let
  // whichever a reader found first decide. An owner who wants a different plan changes the objective,
  // which is a different proposal and a decision of its own — and the rejected draft stays on record
  // as the evidence it is.
  const already = existingDecisionFor(sys, root, opts.draftId);
  if (already !== null) {
    return refuse('DECISION_EXISTS', [
      `a decision (${already}) has already been recorded for this proposal, and a decision is not revisable`,
      'to propose something different, submit a new objective — the existing proposal and its decision stay on record',
    ]);
  }

  const resolved = proposalForDraft(sys, root, draft, opts.draftId);
  if (!resolved.ok) return resolved;
  const proposal = resolved.proposal;

  // PROJECT IDENTITY IS A TRUST ANCHOR, so it comes from the commit gate rather than from a working
  // copy the proposal could have changed. Same check, same reason, as `approvePlan`.
  const committedIdentity = readCommittedJson(sys, root, PROJECT_CONFIG_REL);
  const trustedProjectId =
    typeof committedIdentity?.['projectId'] === 'string' ? (committedIdentity['projectId'] as string).trim() : '';
  if (trustedProjectId !== '' && trustedProjectId !== proposal.projectId) {
    return refuse('PROJECT_IDENTITY_MISMATCH', [
      `the committed ${PROJECT_CONFIG_REL} identifies this project as ${JSON.stringify(trustedProjectId)}, but this ` +
        `proposal is for ${JSON.stringify(proposal.projectId)}`,
    ]);
  }

  const owned = resolveRecordedOwner(sys, root, config, proposal.projectId, 'committed');
  if (!owned.ok) return refuse(owned.code as DecisionRefusal, owned.problems);

  // THE PROGRAMME IN FORCE, read from the governance the approval will inherit — never invented and
  // never accepted from a caller. A first plan has no predecessor and therefore no programme, and a
  // delegation scoped to a programme correctly does not apply to it.
  const programmeId =
    typeof owned.activePlan['programmeId'] === 'string' ? (owned.activePlan['programmeId'] as string).trim() : '';

  const decided = resolveExpectedDecider(sys, root, {
    projectId: proposal.projectId,
    recordedOwner: owned.recordedOwner,
    programmeId,
  });
  if (!decided.ok) return refuse('DELEGATION_INVALID', decided.problems);

  // THE IMPLEMENTER CAN NEVER DECIDE, on any route. `approvePlan` refuses such a decision at
  // activation; refusing to WRITE one means the record never exists to be mistaken for authority in
  // the meantime — in a report, in a projection, or by a person reading the directory.
  const { engine: governance } = loadGovernanceEngine();
  if (governance.isImplementerIdentity(decided.expectedDecider)) {
    return refuse('IMPLEMENTER_CANNOT_DECIDE', [
      `the resolved plan-approval authority for this project is '${decided.expectedDecider}', which is an ` +
        'implementer identity — the implementer can never approve a plan, so no decision was recorded',
    ]);
  }

  const decisionId = derivePlanDecisionId({
    projectId: proposal.projectId,
    draftId: opts.draftId,
    planDigest: proposal.planDigest,
    decision: opts.decision,
  });
  const absPath = planDecisionPath(root, decisionId);
  const relPath = `.projectops/plan-decisions/${decisionId}.json`;
  if (sys.exists(absPath)) {
    return refuse('DECISION_EXISTS', [`a record already exists at ${relPath}; it is not this command's to replace`]);
  }
  // AND NOTHING ON THE WAY THERE MAY BE A LINK. `exists()` follows links, so a dangling symlink at the
  // derived path reads as absent and the owner's decision would be written wherever it points.
  const linked = linkOnPath(absPath, planDecisionsDir(root));
  if (linked !== null) return refuse('UNSAFE_TARGET_PATH', [`${relPath}: ${linked}`]);

  const record: Record<string, unknown> = {
    schemaVersion: PLAN_APPROVAL_DECISION_SCHEMA_VERSION,
    decisionId,
    decision: opts.decision,
    projectId: proposal.projectId,
    repository: proposal.repository,
    branch: proposal.branch,
    baseHead: proposal.baseHead,
    draftId: opts.draftId,
    planDigest: proposal.planDigest,
    decidedBy: decided.expectedDecider,
    decidedAt: sys.now(),
    ...(opts.note === undefined || opts.note.trim() === '' ? {} : { note: opts.note.trim() }),
    // NOT A CLAIM ABOUT WHO PRESSED THE BUTTON. It says how this record came to exist, so a reader can
    // tell a transcribed decision from a hand-authored one. What makes it the owner's decision is the
    // commit, and this field asserts nothing about that.
    recordedBy: 'projectos plan decide',
  };

  sys.writeText(absPath, `${JSON.stringify(record, null, 2)}\n`);

  return {
    ok: true,
    decisionId,
    decision: opts.decision,
    relPath,
    absPath,
    planDigest: proposal.planDigest,
    decidedBy: decided.expectedDecider,
    baseHead: proposal.baseHead,
    branch: proposal.branch,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Durability — the narrowest commit this repository can make.
 * --------------------------------------------------------------------------------------------- */

export type DurabilityRefusal =
  | 'NOT_A_REPOSITORY'
  | 'NOTHING_TO_COMMIT'
  | 'UNSAFE_TARGET_PATH'
  | 'HOOKS_NOT_ISOLATED'
  | 'COMMIT_FAILED'
  | 'NOT_AUTHORITY_ONLY';

export type DurabilityResult =
  | { readonly ok: true; readonly commit: string; readonly previousHead: string }
  | { readonly ok: false; readonly code: DurabilityRefusal; readonly problems: readonly string[] };

/** A decision record path, and nothing that could be anything else. */
const DECISION_REL = /^\.projectops\/plan-decisions\/[A-Za-z0-9_-]{8,128}\.json$/;

/**
 * Is anything on the way to this path a symlink?
 *
 * WHY IT IS NOT ENOUGH THAT THE PATH IS DERIVED. `decisionId` is a SHA-256 slice and cannot traverse
 * anywhere — that is settled by `FILENAME_ID`. What it does not settle is what is ALREADY AT the
 * derived path: `exists()` follows links, so a DANGLING symlink planted at
 * `.projectops/plan-decisions/<id>.json` reads as absent, and the write then lands wherever it points.
 * A symlinked parent directory does the same thing one level up. Both are ordinary file writes in the
 * governed checkout, which is exactly the capability a bounded worker legitimately has.
 *
 * `lstatSync` because it is the only call that answers what the entry ITSELF is rather than what it
 * leads to — the same reason `checkoutShapeProblem` in the trusted broker uses it on `.git`.
 */
function linkOnPath(target: string, parent: string): string | null {
  for (const [label, candidate] of [
    ['the plan-decisions directory', parent],
    ['the decision record path', target],
  ] as const) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) return `${label} is a link, so a write there would not land where it says`;
    } catch {
      // Absent is fine, and is the normal case for the record itself.
    }
  }
  return null;
}

/**
 * A directory git will find no hooks in — created fresh, used once, removed.
 *
 * THE DEFECT THIS CLOSES, FOUND BY ADVERSARIAL REVIEW OF THIS PHASE. `git commit` runs whatever is in
 * the checkout's `.git/hooks/`. Hooks are NOT committed content and no protected-action gate covers
 * them: writing `.git/hooks/post-commit` is an ordinary file write, which is precisely what a bounded
 * worker is allowed to do. So an implementer could plant a hook, wait for the owner to press Approve,
 * and have arbitrary code run with the OWNER'S privileges — a confused deputy that turns the one
 * owner-attended action in the product into an escalation path, and defeats the entire authority chain
 * this file exists to build. `authorityOnlyAdvance` verifies AFTER the commit, so it runs after the
 * hook and cannot prevent it.
 *
 * THIS IS NOT `--no-verify`, AND THE DIFFERENCE MATTERS. That flag skips `pre-commit` and `commit-msg`
 * and leaves `post-commit` running, so it does not close this at all; it also reads as "bypass the
 * project's checks", which is the opposite of the intent. Repointing `core.hooksPath` at a directory
 * that has never existed until this call removes the governed checkout's hooks from consideration
 * entirely, for this one invocation, without disabling anything for anyone else. Ordinary development
 * commits in this repository still run every hook they always did.
 *
 * FRESHLY CREATED, NOT A FIXED PATH. A constant location could be pre-populated by the same writer
 * this defends against. `mkdtemp` hands back a name that did not exist a moment ago.
 *
 * `null` when the directory cannot be made — and the caller REFUSES rather than committing with the
 * checkout's hooks live. Failing closed here costs a retry; failing open costs the owner's account.
 */
function hookFreeDirectory(): string | null {
  try {
    return mkdtempSync(join(tmpdir(), 'projectos-no-hooks-'));
  } catch {
    return null;
  }
}


/**
 * Commit ONE decision record, and refuse to be anything more general than that.
 *
 * THIS IS NOT A COMMIT CAPABILITY. `commit` is in `ALWAYS_OWNER_ONLY`, ProjectOS has never exposed a
 * governed commit or push operation, and this does not become one. It takes NO message from a caller,
 * NO path from a caller, and no set of paths at all: it is given a decision id, it derives the single
 * path that id can name, and it refuses anything that does not match `DECISION_REL`. There is no
 * argument that widens it, so there is nothing here for a later caller to point somewhere else.
 *
 * `git commit -- <path>` IS THE WHOLE MECHANISM, and the choice matters. It commits the working-tree
 * content of exactly those paths on top of HEAD and leaves the index otherwise untouched, so unrelated
 * staged work is neither included nor disturbed — it is still staged afterwards, exactly as it was.
 * `git add .` and `git commit -a` would each sweep up whatever happened to be in the tree, which is
 * how an owner pressing Approve ends up committing an implementer's work-in-progress under their own
 * name. Neither appears anywhere in this file.
 *
 * IT VERIFIES WHAT IT MADE. A commit is checked afterwards against the same rule `approvePlan` will
 * apply: one commit, one parent, one added path. If the result is not authority-only the commit is
 * REPORTED rather than undone — this function does not reset, because a reset is destructive and a
 * surprising commit is a thing the owner should see rather than a thing a program should silently
 * erase.
 *
 * IT NEVER PUSHES. Nothing here contacts a remote.
 */
export function makeDecisionDurable(sys: System, root: string, decisionId: string): DurabilityResult {
  if (!FILENAME_ID.test(decisionId)) {
    return { ok: false, code: 'UNSAFE_TARGET_PATH', problems: [`'${decisionId}' is not a plain identifier`] };
  }
  const rel = `.projectops/plan-decisions/${decisionId}.json`;
  if (!DECISION_REL.test(rel)) {
    return { ok: false, code: 'UNSAFE_TARGET_PATH', problems: [`'${rel}' is not a decision record path`] };
  }
  // ASKED BEFORE "DOES IT EXIST", because `exists()` follows links: a dangling symlink at the derived
  // path answers "absent", and the honest refusal is that somebody put a link there — not that the
  // record is missing. A less precise refusal is still fail-closed and still useless to the operator.
  const linked = linkOnPath(planDecisionPath(root, decisionId), planDecisionsDir(root));
  if (linked !== null) {
    return { ok: false, code: 'UNSAFE_TARGET_PATH', problems: [`${rel}: ${linked}`] };
  }
  if (!sys.exists(planDecisionPath(root, decisionId))) {
    return { ok: false, code: 'NOTHING_TO_COMMIT', problems: [`there is no record at ${rel} to record`] };
  }

  const before = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  if (before.code !== 0 || before.stdout.trim() === '') {
    return { ok: false, code: 'NOT_A_REPOSITORY', problems: ['this checkout has no readable HEAD'] };
  }
  const previousHead = before.stdout.trim();

  // THE GOVERNED CHECKOUT'S HOOKS DO NOT RUN ON THE OWNER'S APPROVAL. See `hookFreeDirectory`.
  const hooks = hookFreeDirectory();
  if (hooks === null) {
    return {
      ok: false,
      code: 'HOOKS_NOT_ISOLATED',
      problems: [
        'this decision could not be recorded without exposing the owner to whatever hooks the checkout carries',
        'nothing was committed; the decision is on disk and does not yet count',
      ],
    };
  }
  // `-c` is a git-level option and must precede the subcommand, exactly as `-C` does.
  const git = (...args: string[]): readonly string[] => ['-C', root, '-c', `core.hooksPath=${hooks}`, ...args];

  let commit: string;
  try {
    // THE ONE PATH, NAMED TWICE AND NEVER GLOBBED. `--` separates it from anything git could read as a
    // revision, and `add` is scoped to it so an untracked record becomes committable without touching
    // the index for anything else.
    const staged = sys.exec('git', git('add', '--', rel));
    if (staged.code !== 0) {
      return { ok: false, code: 'COMMIT_FAILED', problems: [`the decision record could not be prepared: ${staged.stderr.trim()}`] };
    }
    const committed = sys.exec(
      'git',
      git('commit', '-m', `chore(projectops): record plan decision ${decisionId}`, '--', rel),
    );
    if (committed.code !== 0) {
      // THE INDEX IS PUT BACK, FOR THIS PATH ONLY. `add` succeeded or the commit could not have been
      // attempted, so a failure here leaves the record staged — and the operator's next ordinary
      // commit would sweep in a decision that never became durable. `reset -- <path>` restores that
      // one index entry and touches neither the working tree nor anything else that was staged.
      sys.exec('git', ['-C', root, 'reset', '--quiet', '--', rel]);
      return {
        ok: false,
        code: 'COMMIT_FAILED',
        problems: [
          'the decision could not be made durable, so it does not count yet',
          (committed.stderr.trim() || committed.stdout.trim()).slice(0, 400),
        ],
      };
    }
    const after = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
    if (after.code !== 0 || after.stdout.trim() === '') {
      return { ok: false, code: 'COMMIT_FAILED', problems: ['the repository would not say what it committed'] };
    }
    commit = after.stdout.trim();
  } finally {
    try {
      rmSync(hooks, { recursive: true, force: true });
    } catch {
      // A temporary directory that outlives the call is residue, not a failure; the commit stands.
    }
  }

  // THE SAME RULE ACTIVATION WILL APPLY, APPLIED HERE FIRST. If this is not an authority-only advance
  // then activation will refuse the draft as stale, and finding that out now — while the owner is
  // still looking at the screen — is the difference between a clear message and a mystery.
  const advance = authorityOnlyAdvance(sys, root, previousHead, commit, [rel]);
  if (!advance.ok) {
    return {
      ok: false,
      code: 'NOT_AUTHORITY_ONLY',
      problems: [
        `the decision was committed as ${commit.slice(0, 12)}, but that commit is not authority-only`,
        ...advance.reasons,
        'nothing was undone; inspect the commit before activating',
      ],
    };
  }

  return { ok: true, commit, previousHead };
}

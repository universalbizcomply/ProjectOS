/**
 * Carrying out an authorised technical continuation — and nothing else, ever.
 *
 * THIS IS THE EXECUTOR, AND IT DECIDES NOTHING. `authoriseTechnicalContinuation` in core decides, on
 * facts this module gathers from git and from committed records. What is here is the small, closed
 * set of things ProjectOS is physically able to do, plus the checks that can only be made at the
 * moment of doing them. The one other mutation it carries — committing ProjectOS's OWN records
 * (`commitOwnRecords`, PROJECTOS-FINISH-MULTIPROJECT1A) — decides nothing either: it applies the same
 * owner-only rule over an exact, caller-fixed set of record paths, and is described where it is defined.
 *
 * EVERY COMMIT THIS MODULE MAKES IS AUTHORED `ProjectOS implementer`, never the checkout's identity: an
 * implementer-shaped identity is refused outright by the owner-commit check (`closureWait.ts`), so a
 * closure decision ProjectOS committed — by any route — can never pass for the owner's.
 *
 * WHY A SWITCH AND NOT A COMMAND. The obvious shape for this — a decision naming a command and a
 * runtime running it — is the shape that ends with a model choosing `--force`. There is no parameter
 * anywhere in this module through which a command, an argument, a flag, a branch name, a remote or a
 * refspec can arrive from a gatekeeper's text, a worker's output, a checkpoint or a stored record.
 * Every argument below is a literal or a value ProjectOS derived from git and the approved plan. The
 * model approves an action CLASS; the parameters are the runtime's own.
 *
 * WHAT IS DELIBERATELY ABSENT: `--force`, `--force-with-lease`, `--amend`, `reset --hard`, `rebase`,
 * arbitrary refspecs, tags, releases, ref deletion, and any path by which a shell is involved at all.
 * Not one of them is guarded against — they are simply not expressible, which is the difference
 * between a rule and a boundary.
 *
 * THE ORDER IS THE SAFETY ARGUMENT:
 *   1. Authorise, on facts already gathered. No git side effect has happened yet.
 *   2. Reconcile with the remote. `fetch` is the last moment a stale view can be caught.
 *   3. RE-DERIVE THE CANDIDATE and compare it again. Everything before this took time, and the
 *      implementer can write to this checkout while it passes.
 *   4. Only then act, with hard-coded arguments.
 *
 * NOT LIVE-AUTHORITATIVE YET, AND THAT IS INTENTIONAL — but for a different reason than it was a
 * revision ago, and the difference matters. The CONSTITUTIONAL obstacle is gone: under the owner's
 * "APPROVE B6 CONDITIONAL TECHNICAL FLOOR", `commit` and `push` yield to a proven technical
 * delegation. The PLAN's obstacle remains: the active plan declares both among its own
 * `requiredOwnerGates`, and a phase may always be stricter than the constitution, so
 * `enforcedOwnerOnlyActions` still returns them and this executor still refuses. Amending that plan
 * is the owner's next act, not this phase's. `refusesUnderCurrentPlan` reports both halves, and tests
 * assert both, so the day either changes it is a visible change rather than a discovery.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import type { System } from '../system.js';
import { computeCandidateIdentity, describeCandidateDrift } from './candidateIdentity.js';
import { classifyOwnerGates } from './brief.js';
import { resolveClosureCommitDelegation, resolveTechnicalDelegation } from './gatekeeperConfig.js';
import type { GovernedContext } from '../governedContext.js';
import {
  TECHNICAL_ACTIONS,
  TECHNICAL_CONTINUATION_SCOPE,
  authoriseTechnicalContinuation,
  enforcedOwnerOnlyActions,
  technicalDelegationCondition,
  type AuthorisedContinuation,
  type CandidateIdentity,
  type CheckedTechnicalDecision,
  type TechnicalAction,
  type TechnicalDelegationState,
} from '@projectos/core';

/**
 * The operational parameters an action needs, every one of them from governed context.
 *
 * THERE IS NO `args`, NO `flags` AND NO `command` FIELD, and there must never be one. A caller that
 * needed to pass a git argument would be a caller that had decided something this module exists to
 * decide.
 */
export interface ContinuationContext {
  readonly root: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly programmeId: string;
  /** The branch the governed context says this work belongs on. */
  readonly expectedBranch: string;
  /** The remote name from the governed configuration. Never a model's word. */
  readonly expectedRemote: string;
  /**
   * The branch an ff-only integration would advance, when the governed configuration names one.
   *
   * NULL IS THE NORMAL CASE and it is a refusal, not a default. There is no configured integration
   * target in ProjectOS today, and inventing one — `main`, say — from the absence of a setting is
   * how an integration lands somewhere nobody chose.
   */
  readonly integrationTargetBranch: string | null;
}

export interface ContinuationRequest {
  /** The action the gatekeeper approved. Checked against the closed vocabulary before use. */
  readonly action: string;
  readonly context: ContinuationContext;
  readonly decision: CheckedTechnicalDecision;
  readonly delegation: TechnicalDelegationState;
  /** The phase's declared owner gates. The constitutional floor is added here, not by the caller. */
  readonly phaseOwnerGates: readonly string[];
  readonly at: string;
}

export type ContinuationOutcome =
  | {
      readonly kind: 'REFUSED';
      readonly reasons: readonly string[];
      /** True when nothing at all was run — no fetch, no write, no network. */
      readonly nothingAttempted: boolean;
    }
  | {
      readonly kind: 'DONE';
      readonly action: TechnicalAction;
      /** What actually happened, for the record. Never a claim the runtime did not verify. */
      readonly result: string;
      /** HEAD after the action. */
      readonly head: string;
      readonly lines: readonly string[];
    };

function refuse(reasons: readonly string[], nothingAttempted = true): ContinuationOutcome {
  return { kind: 'REFUSED', reasons, nothingAttempted };
}

function git(sys: System, root: string, args: readonly string[]): { ok: boolean; out: string; err: string } {
  const r = sys.exec('git', ['-C', root, ...args]);
  return { ok: r.code === 0, out: r.stdout.trim(), err: (r.stderr || '').trim() };
}

/**
 * Would this action be refused as owner-only, given these phase gates and this delegation?
 *
 * THE HONEST ANSWER TO "IS THIS LIVE YET", and it is now a question with two arguments rather than
 * one. With no delegation it reports the default floor, which still holds `commit` and `push`. With a
 * PROVEN delegation it reports what the owner's conditional decision actually permits — and for the
 * ACTIVE ProjectOS plan the answer is still `true`, because that plan declares `commit` and `push`
 * among its own `requiredOwnerGates` and a phase may always be stricter than the constitution.
 *
 * That distinction is the whole state of B6: the constitutional obstacle is gone, the plan's is not,
 * and the plan is amended by the owner and not by this phase. Asserted in tests both ways, so the day
 * either half changes it is a visible change rather than a discovery.
 */
export function refusesUnderCurrentPlan(
  action: string,
  phaseOwnerGates: readonly string[],
  delegation?: TechnicalDelegationState,
): boolean {
  const condition = delegation === undefined ? null : technicalDelegationCondition(delegation);
  return enforcedOwnerOnlyActions(phaseOwnerGates, condition).map(String).includes(String(action));
}

/** The identity every ProjectOS commit carries: never the owner's, and refused as the owner's. */
/** The identity every ProjectOS commit carries. The owner-commit check refuses it unless the owner granted `closure-decision-commit`. */
export const PROJECTOS_COMMIT_NAME = 'ProjectOS implementer';
export const PROJECTOS_COMMIT_EMAIL = 'projectos-implementer@projectos.invalid';
const PROJECTOS_COMMIT_IDENTITY: readonly string[] = ['-c', `user.name=${PROJECTOS_COMMIT_NAME}`, '-c', `user.email=${PROJECTOS_COMMIT_EMAIL}`];

/**
 * Perform exactly the technical continuation that is authorised, or refuse and do nothing.
 *
 * Every refusal path leaves the checkout exactly as it found it. The only work-mutating commands this
 * module can issue are the three in the switch, and each is reached only past the full conjunction
 * plus a second candidate re-derivation. (`commitOwnRecords` commits records, never work.)
 */
export function runTechnicalContinuation(sys: System, request: ContinuationRequest): ContinuationOutcome {
  const { context } = request;
  const lines: string[] = [];

  // THE OWNER-ONLY SET IS THE PHASE'S PLUS THE CONSTITUTIONAL FLOOR, derived here rather than
  // received, for the same reason the live gatekeeper turn derives it: a caller must not be able to
  // narrow the protected set by passing a short list.
  //
  // THE CONDITION IS MINTED FROM THIS REQUEST'S OWN DELEGATION, not accepted as an argument. If that
  // delegation is invalid or carries the wrong scope, `technicalDelegationCondition` returns null and
  // the full floor applies — so an unproven delegation is exactly as restrictive as no delegation.
  // Even with a valid one, `phaseOwnerGates` is still added, so a phase that declares `commit` as its
  // own owner gate keeps it owner-only: the plan may be stricter than the constitution, never laxer.
  const ownerOnlyActions = enforcedOwnerOnlyActions(
    request.phaseOwnerGates,
    technicalDelegationCondition(request.delegation),
  );

  // 1. THE WORLD, AS GIT REPORTS IT RIGHT NOW.
  const branch = git(sys, context.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(sys, context.root, ['rev-parse', 'HEAD']);
  if (!branch.ok || !head.ok || !/^[0-9a-f]{40}$/.test(head.out)) {
    return refuse([
      'this checkout would not say what branch it is on or where HEAD is, so no technical action may be taken',
      ...(head.err === '' ? [] : [`  ${head.err}`]),
    ]);
  }
  const candidate = computeCandidateIdentity(sys, context.root);
  if (!candidate.ok) return refuse(['the candidate could not be named, so nothing may be committed', ...candidate.problems]);

  // 2. AUTHORISE. Pure, and every reason is returned rather than the first.
  const verdict = authoriseTechnicalContinuation({
    action: request.action,
    context: {
      projectId: context.projectId,
      phaseId: context.phaseId,
      programmeId: context.programmeId,
      root: context.root,
      currentBranch: branch.out,
      expectedBranch: context.expectedBranch,
      currentHead: head.out,
      currentCandidate: candidate.identity,
    },
    decision: request.decision,
    delegation: request.delegation,
    ownerOnlyActions,
  });
  if (verdict.authorised === false) {
    // A DRIFT REFUSAL SAYS WHAT DRIFTED. The verdict has already decided on the digests alone; this
    // only spares an operator from comparing hex by eye.
    const drift =
      request.decision.reviewedCandidateDigest !== candidate.identity.digest && Array.isArray(request.decision.reviewedEntries)
        ? describeCandidateDrift(request.decision.reviewedEntries, candidate.identity.entries)
        : [];
    return refuse([...verdict.reasons, ...drift.map((d) => `  ${d}`)]);
  }
  lines.push(`authorised '${verdict.grant.action}' for ${context.projectId}/${context.phaseId} at ${head.out.slice(0, 7)}`);

  return executeAuthorisedContinuation(sys, verdict.grant, request, {
    candidate: candidate.identity,
    head: head.out,
    lines,
  });
}

/** What the executor was authorised against, so it can prove the world has not moved since. */
export interface ExecutionFacts {
  /** The candidate as it stood when the grant was minted. */
  readonly candidate: CandidateIdentity;
  /** HEAD as it stood when the grant was minted. */
  readonly head: string;
  readonly lines: readonly string[];
}

/**
 * Everything that happens AFTER authorisation: reconcile, re-derive, then dispatch.
 *
 * SEPARATE FROM `runTechnicalContinuation` FOR ONE REASON, and it is a testing reason stated plainly
 * rather than dressed up. `commit` and `push` are in `ALWAYS_OWNER_ONLY`, so the production path — which
 * derives that floor itself — cannot reach either of them today, and every line below would otherwise
 * ship unexercised, waiting for the day a governance change made it live. A test can obtain a real
 * grant by calling the pure authoriser with an owner-only set of its own choosing; production cannot,
 * because `runTechnicalContinuation` derives that set and there is no argument for it.
 *
 * The `AuthorisedContinuation` brand is what keeps the split honest. Its symbol is private to core, so
 * this signature cannot be satisfied by an object anybody wrote — the same device `ClosureGrant` uses,
 * so that accepting one is proof the decision was made in the module entitled to make it.
 *
 * THE CHECKS HERE ARE THE ONES THAT CAN ONLY BE MADE NOW. Authorisation reasoned about facts gathered
 * a moment ago; between then and the first mutating command there is a network round trip, and the
 * implementer can write to this checkout throughout it. `val-projectos-technical-continuation1a` pins
 * that `runTechnicalContinuation` is the only production caller.
 */
export function executeAuthorisedContinuation(
  sys: System,
  grant: AuthorisedContinuation,
  request: ContinuationRequest,
  facts: ExecutionFacts,
): ContinuationOutcome {
  const { context } = request;
  const upstream = `${context.expectedRemote}/${context.expectedBranch}`;

  // 1. RECONCILE WITH THE REMOTE, for every action. A commit taken against a base the remote has
  //    already moved past is a commit that will not push, and finding that out afterwards means the
  //    repository has changed for a step that cannot complete.
  const fetched = git(sys, context.root, ['fetch', '--quiet', context.expectedRemote]);
  if (!fetched.ok) {
    return refuse([
      `the remote '${context.expectedRemote}' could not be reached, so the base could not be reconciled before acting`,
      ...(fetched.err === '' ? [] : [`  ${fetched.err}`]),
    ]);
  }
  const remoteHead = git(sys, context.root, ['rev-parse', upstream]);
  if (!remoteHead.ok) {
    return refuse([`'${upstream}' could not be read after fetching, so remote movement cannot be judged`]);
  }
  // THE REMOTE MUST NOT BE AHEAD. Equal is the ordinary case before a commit and behind is the
  // ordinary case after one; ahead means somebody else moved it and this decision predates that.
  const behind = git(sys, context.root, ['rev-list', '--count', `HEAD..${upstream}`]);
  if (!behind.ok) return refuse([`the relationship between HEAD and '${upstream}' could not be established`]);
  if (behind.out !== '0') {
    return refuse([
      `'${upstream}' has moved on by ${behind.out} commit(s) since this decision was taken`,
      'this is a safe stop: nothing is merged, rebased or resolved automatically',
      'reconcile the branch, then obtain a fresh gatekeeper decision for the reconciled state',
    ]);
  }

  // 2. RE-DERIVE THE CANDIDATE, AFTER THE NETWORK CALL. A candidate verified before a fetch and
  //    committed after one has an unchecked window in the middle, and the implementer can write to
  //    this checkout during it.
  const again = computeCandidateIdentity(sys, context.root);
  if (!again.ok) return refuse(['the candidate could not be re-derived immediately before acting', ...again.problems]);
  if (again.identity.digest !== facts.candidate.digest) {
    return refuse([
      'the candidate changed while this action was being authorised, so nothing was done',
      ...describeCandidateDrift(facts.candidate.entries, again.identity.entries).map((d) => `  ${d}`),
    ]);
  }

  // 3. THE CLOSED DISPATCHER. No default case reaches an action.
  switch (grant.action) {
    case 'commit':
      return doCommit(sys, request, facts.candidate, facts.lines);
    case 'push':
      return doPush(sys, request, facts.head, upstream, facts.lines);
    case 'ff-only-integration':
      return doFastForward(sys, request, facts.head, facts.lines);
    default:
      // Unreachable while the vocabulary and this switch agree; refuses if they ever do not.
      return refuse([`no executor exists for '${String((grant as { action: string }).action)}'`]);
  }
}

/**
 * Stage exactly the reviewed candidate and commit it.
 *
 * THE BOUNDARY IS THE CANDIDATE'S OWN PATH LIST, passed after `--` so git cannot read any of it as a
 * revision, and staged path by path. There is no `git add .` and no `git add -A` over the worktree:
 * the set of paths is the set the identity was taken over, so what is staged and what was reviewed
 * are the same list by construction rather than by care.
 */
function doCommit(
  sys: System,
  request: ContinuationRequest,
  candidate: CandidateIdentity,
  lines: readonly string[],
): ContinuationOutcome {
  const { root } = request.context;
  const paths = candidate.entries.map((e) => e.path);
  if (paths.length === 0) {
    return refuse(['the candidate is empty — there is nothing to commit, and an empty commit is not a continuation']);
  }

  // `--all` is NOT used. It would sweep in anything that became dirty since the identity was taken,
  // which is precisely the drift the identity exists to detect.
  const staged = sys.exec('git', ['-C', root, 'add', '--', ...paths]);
  if (staged.code !== 0) {
    return refuse([`the reviewed candidate could not be staged: ${(staged.stderr || '').trim()}`], false);
  }

  // THE MESSAGE IS PROJECTOS'S OWN, BUILT FROM GOVERNED IDENTIFIERS ONLY.
  //
  // No model text reaches it. A gatekeeper's prose in a commit message would be arbitrary text
  // becoming part of a governed record, and — passed as an argument — text a shell would never see
  // but a reader would trust. Every field below is an identifier ProjectOS established: the phase, the
  // decision that authorised the action, and the digest of the bytes that were reviewed. That is also
  // exactly what a later audit needs to tie a commit back to the answer that permitted it.
  const message =
    `chore(${request.context.phaseId}): technical continuation\n\n` +
    `Authorised by gatekeeper decision ${request.decision.decisionId}.\n` +
    `Reviewed candidate ${candidate.digest}.\n` +
    `Base ${request.decision.subjectCommit}.\n`;

  const committed = sys.exec('git', [...PROJECTOS_COMMIT_IDENTITY, '-C', root, 'commit', '-m', message, '--', ...paths]);
  if (committed.code !== 0) {
    // PUT THE INDEX BACK, FOR THESE PATHS ONLY. `add` succeeded or the commit could not have been
    // attempted, so a failure here leaves the candidate staged and the next ordinary commit would
    // sweep it in. Same remedy `planDecision.ts` applies for the same reason.
    sys.exec('git', ['-C', root, 'reset', '--quiet', '--', ...paths]);
    return refuse(
      [
        'the continuation could not be committed, and the index was restored for those paths',
        ((committed.stderr || '').trim() || committed.stdout.trim()).slice(0, 400),
      ],
      false,
    );
  }

  const after = git(sys, root, ['rev-parse', 'HEAD']);
  if (!after.ok || !/^[0-9a-f]{40}$/.test(after.out)) {
    return refuse(['the repository would not say what it committed'], false);
  }
  return {
    kind: 'DONE',
    action: 'commit',
    result: `committed ${paths.length} path(s) as ${after.out.slice(0, 7)}`,
    head: after.out,
    lines: [...lines, `committed ${after.out.slice(0, 7)} over ${paths.length} reviewed path(s)`],
  };
}

/**
 * An ORDINARY push of the governed branch to the governed remote.
 *
 * The refspec is built from the runtime's own branch name on both sides, so there is no form of this
 * call that can address another ref. `--force`, `--force-with-lease`, `--tags`, `--delete` and a
 * caller-supplied refspec are not omitted by policy; there is nowhere to put them.
 */
function doPush(
  sys: System,
  request: ContinuationRequest,
  expectedLocalHead: string,
  upstream: string,
  lines: readonly string[],
): ContinuationOutcome {
  const { root, expectedRemote, expectedBranch } = request.context;

  // The commit being pushed must be the one this decision is about. A push that carries a commit
  // nobody authorised is the same problem as an unauthorised commit, one step later.
  const head = git(sys, root, ['rev-parse', 'HEAD']);
  if (!head.ok || head.out !== expectedLocalHead) {
    return refuse([`HEAD moved between authorisation and push (${expectedLocalHead.slice(0, 7)} -> ${head.out.slice(0, 7)})`]);
  }

  const pushed = sys.exec('git', ['-C', root, 'push', expectedRemote, `${expectedBranch}:${expectedBranch}`]);
  if (pushed.code !== 0) {
    // A REJECTION IS A SAFE STOP, NOT A PROBLEM TO SOLVE. Nothing is retried, forced or reconciled.
    return refuse(
      [
        `the push of '${expectedBranch}' to '${expectedRemote}' was rejected, and nothing further was attempted`,
        ((pushed.stderr || '').trim() || pushed.stdout.trim()).slice(0, 400),
        'a rejected ordinary push is resolved by reconciling the branch and asking again — never by forcing',
      ],
      false,
    );
  }

  // PROVE IT LANDED, rather than reporting the exit code as the outcome.
  const remote = git(sys, root, ['rev-parse', upstream]);
  if (!remote.ok || remote.out !== head.out) {
    return refuse(
      [`the push reported success but '${upstream}' is not at ${head.out.slice(0, 7)}`],
      false,
    );
  }
  return {
    kind: 'DONE',
    action: 'push',
    result: `${expectedBranch} pushed to ${expectedRemote}; local and ${upstream} both at ${head.out.slice(0, 7)}`,
    head: head.out,
    lines: [...lines, `pushed ${head.out.slice(0, 7)}; local = ${upstream}, 0/0`],
  };
}

/**
 * Advance a configured integration branch, fast-forward only.
 *
 * REFUSES FOR WANT OF A PARAMETER, AND SAYS SO. ProjectOS has no governed integration target today.
 * The branch names could only have come from the gatekeeper's text or from a new configuration file
 * invented here, and both are exactly what section 13 forbids — so this implements the refusal
 * boundary and names the missing source. When a governed target exists, the body below is already the
 * whole operation: `merge --ff-only` and nothing else.
 */
function doFastForward(
  sys: System,
  request: ContinuationRequest,
  sourceSha: string,
  lines: readonly string[],
): ContinuationOutcome {
  const { root, integrationTargetBranch, expectedRemote, expectedBranch } = request.context;
  if (integrationTargetBranch === null || integrationTargetBranch.trim() === '') {
    return refuse([
      'no governed integration target branch is configured for this project, so there is no trusted ' +
        'answer to "integrate into what"',
      'a branch name taken from a gatekeeper decision, a report or a checkpoint is not a governed ' +
        'parameter, and none is accepted here',
      'record an integration target in the governed project configuration, then ask again',
    ]);
  }
  if (integrationTargetBranch === expectedBranch) {
    return refuse([`the integration target '${integrationTargetBranch}' is the branch the work is already on`]);
  }

  // THE GRAPH MUST ALREADY BE A FAST FORWARD, established before anything is attempted. `merge
  // --ff-only` would refuse a divergent graph too, but asking first means the refusal names the real
  // condition instead of quoting git at an operator.
  const target = git(sys, root, ['rev-parse', `${expectedRemote}/${integrationTargetBranch}`]);
  if (!target.ok) {
    return refuse([`'${expectedRemote}/${integrationTargetBranch}' could not be read after fetching`]);
  }
  const ancestor = sys.exec('git', ['-C', root, 'merge-base', '--is-ancestor', target.out, sourceSha]);
  if (ancestor.code !== 0) {
    return refuse([
      `'${integrationTargetBranch}' is not an ancestor of ${sourceSha.slice(0, 7)}, so this is not a fast forward`,
      'nothing is merged, rebased or resolved automatically; this is a safe stop',
    ]);
  }

  const merged = sys.exec('git', [
    '-C',
    root,
    'merge',
    '--ff-only',
    '--no-edit',
    `${expectedRemote}/${integrationTargetBranch}`,
  ]);
  if (merged.code !== 0) {
    return refuse(
      [
        `the fast-forward integration of '${integrationTargetBranch}' did not complete`,
        ((merged.stderr || '').trim() || merged.stdout.trim()).slice(0, 400),
      ],
      false,
    );
  }
  const after = git(sys, root, ['rev-parse', 'HEAD']);
  return {
    kind: 'DONE',
    action: 'ff-only-integration',
    result: `fast-forwarded onto ${integrationTargetBranch} at ${after.out.slice(0, 7)}`,
    head: after.out,
    lines: [...lines, `fast-forward only; no merge commit, no rebase, no conflict resolution`],
  };
}

/** The scope a technical continuation requires, re-exported so a caller need not reach into core. */
export { TECHNICAL_CONTINUATION_SCOPE };

/* ---------------------------------------------------------------------------------------------- *
 * ProjectOS's own records — PROJECTOS-FINISH-MULTIPROJECT1A.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The owner gates a plan phase declares, classified exactly as the brief classifies them. A list that
 * cannot be read is carried as prose, which reserves every technical action — never read as "no gates".
 */
export function ownerGatesOfPlanPhase(raw: unknown): readonly string[] {
  if (raw === undefined) return classifyOwnerGates([]);
  const read = Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];
  const malformed = !Array.isArray(raw) || read.length !== raw.length;
  return classifyOwnerGates(malformed ? [...read, 'the declared owner gates could not be read'] : read);
}

/**
 * `closure-decision` (the delegate's decision and its ledger entry) and `post-close` (the records that
 * persist a close) exist only under the owner's `closure-decision-commit` grant — PROJECTOS-FINISH-
 * ZERO-TOUCH-CLOSURE1A.
 */
export type OwnRecordsKind = 'run-records' | 'closure-tail' | 'closure-decision' | 'post-close';

/** The kinds that carry a closure decision, and so need the owner's grant on top of commit and push. */
const CLOSURE_COMMIT_KINDS: readonly OwnRecordsKind[] = ['closure-decision', 'post-close'];

const KIND_LABEL: Readonly<Record<OwnRecordsKind, { readonly subject: string; readonly counted: string; readonly refusal: string }>> = {
  'run-records': { subject: "the run's own records", counted: 'run record(s)', refusal: "the run's own records" },
  'closure-tail': { subject: 'closure records', counted: 'closure record(s)', refusal: 'the closure records' },
  'closure-decision': { subject: 'the closure decision', counted: 'closure decision file(s)', refusal: 'the closure bundle' },
  'post-close': { subject: 'persist the close', counted: 'post-close record(s)', refusal: 'the records that persist the close' },
};

export interface OwnRecordsCommitRequest {
  readonly root: string;
  readonly phaseId: string;
  readonly kind: OwnRecordsKind;
  readonly expectedBranch: string;
  readonly expectedRemote: string;
  /** Whether one dirty path is a record this commit may carry. Decided by the caller's fixed list. */
  readonly isOwnRecord: (path: string) => boolean;
  readonly delegation: TechnicalDelegationState;
  /** The phase's declared owner gates, classified. The constitutional floor is added here. */
  readonly phaseOwnerGates: readonly string[];
  /** The owner's `closure-decision-commit` grant, judged from the committed delegation. Required for the closure kinds. */
  readonly closureCommit?: { readonly granted: boolean; readonly problems: readonly string[] };
}

export type OwnRecordsOutcome =
  /** The phase or the constitution keeps commit or push with the owner: nothing was attempted. */
  | { readonly kind: 'RESERVED'; readonly reasons: readonly string[] }
  /** Nothing is dirty: there is nothing to commit. */
  | { readonly kind: 'NOTHING' }
  | { readonly kind: 'REFUSED'; readonly reasons: readonly string[]; readonly nothingAttempted: boolean }
  | { readonly kind: 'DONE'; readonly head: string; readonly paths: readonly string[]; readonly lines: readonly string[] };

/**
 * COMMIT AND PUSH PROJECTOS'S OWN RECORDS — the run's records after an approved technical continuation,
 * or the three closure-tail records `closure prepare` generates — and nothing else, ever.
 *
 * WHY IT EXISTS. After the loop's technical-continuation commit the run still writes its own records
 * (the phase record, the work record, the gate decision), and `closure prepare` writes three more.
 * Each set needed an owner commit and push that reviewed nothing: the records describe the run, they
 * are not the work. Under a delegation that already lets ProjectOS commit and push the reviewed work,
 * committing its own records is the same authority over less.
 *
 * WHAT IT WILL NOT DO. Commit anything when the phase's owner gates — or the constitutional floor, with
 * no proven technical delegation — reserve `commit` or `push` (then it does nothing and says so).
 * Commit when ANY dirty path is not one of the caller's records (it refuses, nothing attempted). Carry a
 * commit that is not already on the remote: HEAD must equal its upstream before, so the push carries
 * exactly this records commit. Commit the CLOSURE DECISION without the owner's grant: a decision is
 * valid only once the owner commits it (`checkClosureDecision`), and a decision ProjectOS committed
 * itself would satisfy that check while destroying the property it exists for — unless the owner has
 * granted `closure-decision-commit` in the committed delegation, which is the `closure-decision` and
 * `post-close` kinds and nothing else (PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A).
 *
 * Every argument is a literal or a value derived from git and governed context, as in the rest of this
 * module; there is no `--force`, no `--all` and no refspec from outside.
 */
export function commitOwnRecords(sys: System, request: OwnRecordsCommitRequest): OwnRecordsOutcome {
  const { root, expectedBranch, expectedRemote } = request;
  const ownerOnly = enforcedOwnerOnlyActions(request.phaseOwnerGates, technicalDelegationCondition(request.delegation)).map(String);
  const reserved = ['commit', 'push'].filter((a) => ownerOnly.includes(a));
  if (reserved.length > 0) {
    return { kind: 'RESERVED', reasons: [`${reserved.join(' and ')} stay with the owner for ${request.phaseId}, so ProjectOS commits none of its records`] };
  }
  // A CLOSURE DECISION NEEDS THE OWNER'S OWN GRANT on top of commit and push: without it the decision
  // counts only once the owner commits it, and ProjectOS committing it would destroy that property.
  if (CLOSURE_COMMIT_KINDS.includes(request.kind) && request.closureCommit?.granted !== true) {
    return {
      kind: 'RESERVED',
      reasons: [
        `this project's committed delegation does not grant 'closure-decision-commit', so the closure decision for ${request.phaseId} stays the owner's to commit`,
        ...(request.closureCommit?.problems ?? []).map((p) => `  ${p}`),
      ],
    };
  }
  const label = KIND_LABEL[request.kind];
  const refuseNow = (reasons: readonly string[]): OwnRecordsOutcome => ({ kind: 'REFUSED', reasons, nothingAttempted: true });

  const branch = git(sys, root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(sys, root, ['rev-parse', 'HEAD']);
  if (!branch.ok || !head.ok || !/^[0-9a-f]{40}$/.test(head.out)) return refuseNow(['the checkout would not say what branch it is on or where HEAD is']);
  if (branch.out !== expectedBranch) return refuseNow([`the checkout is on '${branch.out}', not '${expectedBranch}'`]);

  const status = sys.exec('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']);
  if (status.code !== 0 || status.failure !== undefined) return refuseNow(['git could not say what is uncommitted']);
  const lines = status.stdout.split(/\r?\n/).filter((l) => l.length > 3);
  // A RENAME OR A QUOTED PATH IS NOT ONE OF OUR RECORDS: the runtime writes plain files in place.
  const odd = lines.filter((l) => l.includes(' -> ') || l.slice(3).startsWith('"'));
  if (odd.length > 0) return refuseNow(['the uncommitted changes include a rename or an unusual path name, which no ProjectOS record is', ...odd.map((l) => `  ${l}`)]);
  const dirty = lines.map((l) => l.slice(3).trim());
  if (dirty.length === 0) return { kind: 'NOTHING' };
  // A DIRECTORY ENTRY (`?? dir/`) IS NEVER A RECORD: it is a nested repository git will not list.
  const foreign = dirty.filter((p) => p.endsWith('/') || !request.isOwnRecord(p));
  if (foreign.length > 0) {
    return refuseNow([`the checkout holds uncommitted changes that are not ${label.refusal}, so ProjectOS commits nothing`, ...foreign.map((p) => `  ${p}`)]);
  }

  // THE REMOTE ALREADY HAS EVERYTHING BUT THESE RECORDS: not behind, and not ahead. The remote ref is
  // named in full, so a local branch or tag of the same short name cannot stand in for it.
  const upstream = `refs/remotes/${expectedRemote}/${expectedBranch}`;
  const fetched = git(sys, root, ['fetch', '--quiet', expectedRemote]);
  if (!fetched.ok) return refuseNow([`the remote '${expectedRemote}' could not be reached`]);
  const counts = git(sys, root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
  const m = /^(\d+)\s+(\d+)$/.exec(counts.out);
  if (!counts.ok || m === null) return refuseNow([`the relationship between HEAD and '${upstream}' could not be established`]);
  if (m[1] !== '0' || m[2] !== '0') {
    return refuseNow([`HEAD is ${m[1]} ahead and ${m[2]} behind '${upstream}'; ProjectOS commits its records only on a pushed, reconciled head`]);
  }

  // LITERAL PATHSPECS: a record path is a file name, never a pattern git would expand.
  const staged = sys.exec('git', ['--literal-pathspecs', '-C', root, 'add', '--', ...dirty]);
  if (staged.code !== 0) {
    sys.exec('git', ['--literal-pathspecs', '-C', root, 'reset', '--quiet', '--', ...dirty]);
    return { kind: 'REFUSED', reasons: [`the records could not be staged, and the index was restored: ${(staged.stderr || '').trim().slice(0, 400)}`], nothingAttempted: false };
  }
  const message =
    `chore(${request.phaseId}): ${label.subject}\n\n` +
    (CLOSURE_COMMIT_KINDS.includes(request.kind)
      ? "Committed by ProjectOS under the owner's closure-decision-commit grant: the closure delegate's decision\nand the records around it, byte for byte as written; ProjectOS decided nothing.\n"
      : 'Committed by ProjectOS under the technical delegation: records it wrote, not work.\n') +
    `Base ${head.out}.\n`;
  const committed = sys.exec('git', [...PROJECTOS_COMMIT_IDENTITY, '--literal-pathspecs', '-C', root, 'commit', '-m', message, '--', ...dirty]);
  if (committed.code !== 0) {
    sys.exec('git', ['--literal-pathspecs', '-C', root, 'reset', '--quiet', '--', ...dirty]);
    return {
      kind: 'REFUSED',
      reasons: ['the records could not be committed, and the index was restored for those paths', ((committed.stderr || '').trim() || committed.stdout.trim()).slice(0, 400)],
      nothingAttempted: false,
    };
  }
  const after = git(sys, root, ['rev-parse', 'HEAD']);
  if (!after.ok || !/^[0-9a-f]{40}$/.test(after.out)) return { kind: 'REFUSED', reasons: ['the repository would not say what it committed'], nothingAttempted: false };
  // THE PUSH CARRIES EXACTLY THIS COMMIT: its parent is the head that was checked against the remote.
  const parent = git(sys, root, ['rev-parse', 'HEAD~1']);
  if (!parent.ok || parent.out !== head.out) {
    return { kind: 'REFUSED', reasons: [`committed locally as ${after.out.slice(0, 7)}, NOT pushed: its parent is not the head that was checked against the remote`], nothingAttempted: false };
  }
  const pushed = sys.exec('git', ['-C', root, 'push', expectedRemote, `${expectedBranch}:${expectedBranch}`]);
  if (pushed.code !== 0) {
    return {
      kind: 'REFUSED',
      reasons: [
        `committed locally as ${after.out.slice(0, 7)}, NOT pushed: the ordinary push was rejected, and nothing was forced`,
        ((pushed.stderr || '').trim() || pushed.stdout.trim()).slice(0, 400),
        `push it with \`git push ${expectedRemote} ${expectedBranch}\`, then run \`projectos continue\``,
      ],
      nothingAttempted: false,
    };
  }
  const remote = git(sys, root, ['rev-parse', upstream]);
  if (!remote.ok || remote.out !== after.out) {
    return { kind: 'REFUSED', reasons: [`the push reported success but '${upstream}' is not at ${after.out.slice(0, 7)}`], nothingAttempted: false };
  }
  return {
    kind: 'DONE',
    head: after.out,
    paths: dirty,
    lines: [`committed and pushed ${dirty.length} ${label.counted} as ${after.out.slice(0, 7)}; local = ${upstream}`],
  };
}

/**
 * THE ACTIONS THIS RUNTIME CAN ACTUALLY PERFORM RIGHT NOW.
 *
 * A reviewer was offered `ff-only-integration` while no integration target is configured, so the
 * action could only ever have been refused by the executor — and the governing constraint for that
 * plan prohibited merge outright. The reviewer refused to authorise anything until the scope was
 * reconciled, which was the correct answer to an incoherent question: the request had named
 * something the runtime cannot do.
 *
 * OFFERING IS A CLAIM. Asking "may I do these?" asserts they are things that could be done. This
 * removes the ones that could not, so the question is answerable as asked.
 */
export function performableTechnicalActions(
  integrationTargetBranch: string | null,
): readonly string[] {
  const configured = typeof integrationTargetBranch === 'string' && integrationTargetBranch.trim() !== '';
  return configured
    ? TECHNICAL_ACTIONS
    : TECHNICAL_ACTIONS.filter((a) => a !== 'ff-only-integration');
}

/**
 * The governed way to commit ProjectOS's own records: every parameter derived here from the approved
 * plan, the committed delegation and git — the branch the plan names, the phase's declared owner gates,
 * the delegation for the plan's programme — and only the record classifier from the caller.
 */
export function commitOwnRecordsFor(
  sys: System,
  root: string,
  context: GovernedContext,
  phaseId: string,
  kind: OwnRecordsKind,
  isOwnRecord: (path: string) => boolean,
): OwnRecordsOutcome {
  const phases = Array.isArray(context.plan['phases']) ? (context.plan['phases'] as unknown[]) : [];
  const phase = phases.find((ph) => typeof ph === 'object' && ph !== null && (ph as Record<string, unknown>)['phaseId'] === phaseId) as
    | Record<string, unknown>
    | undefined;
  if (phase === undefined) return { kind: 'REFUSED', reasons: [`${phaseId} is not a phase of the active approved plan`], nothingAttempted: true };
  const repository = (context.plan['repository'] as Record<string, unknown> | undefined) ?? {};
  const expectedBranch = typeof repository['planSourceBranch'] === 'string' ? repository['planSourceBranch'] : '';
  if (expectedBranch === '') return { kind: 'REFUSED', reasons: ['the approved plan names no branch for this work'], nothingAttempted: true };
  const programme = typeof context.plan['programmeId'] === 'string' ? (context.plan['programmeId'] as string).trim() : '';
  return commitOwnRecords(sys, {
    root,
    phaseId,
    kind,
    expectedBranch,
    expectedRemote: 'origin',
    isOwnRecord,
    delegation: resolveTechnicalDelegation(sys, root, programme),
    phaseOwnerGates: ownerGatesOfPlanPhase(phase['requiredOwnerGates']),
    ...(CLOSURE_COMMIT_KINDS.includes(kind) ? { closureCommit: resolveClosureCommitDelegation(sys, root, programme) } : {}),
  });
}

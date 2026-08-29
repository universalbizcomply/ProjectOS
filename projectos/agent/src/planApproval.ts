/**
 * Exact plan approval: how one specific generated draft — and nothing else — becomes an approved
 * post-V3 plan with execution authority.
 *
 * WHAT WAS MISSING. `plan draft` could produce a proposal and `phase` could refuse to start work
 * without an approved plan, but there was no way to get from one to the other. The only approved plan
 * this repository has is the closed V3 plan, so a new objective could be proposed and then went
 * nowhere. This is the join, and it is deliberately the smallest one that is safe.
 *
 * THE AUTHORITY CHAIN, and why each link is not circular:
 *
 *   1. the project's ACTIVE owner-approved plan records who the owner is;
 *   2. a COMMITTED delegation record, written by that owner, says who else may approve a plan for
 *      this project — it exists as a separate artefact BEFORE any plan it authorises, so the plan
 *      never confers the authority that created it;
 *   3. a COMMITTED decision by exactly that authority approves one draft by id AND by plan digest;
 *   4. ProjectOS recomputes the proposal from the repository as it is now, and the digest must still
 *      match — an approval of different plan material is not an approval of this one;
 *   5. only then is a new plan record written, and its readiness is recomputed from scratch by the
 *      existing evaluator rather than asserted.
 *
 * WHAT THIS CANNOT PROMISE. ProjectOS is `MANUAL_GOVERNANCE_APPROVAL` with `tamperProof: false`
 * throughout. There is no signature: anything that can write a file can write these two. The boundary
 * is not "the implementer cannot produce these bytes" — that would be a lie — it is the same standard
 * every other governance fact in this programme is held to:
 *
 *   - the delegation and the decision must EXIST as distinct, reviewable artefacts, each bound to one
 *     project, one draft and one digest;
 *   - both must be COMMITTED, so a forged one is a visible diff at the owner's commit/push gate
 *     rather than an invisible flag in an argv;
 *   - and no other route reaches PLAN READY: not a filename, not prose saying "approved", not
 *     submitting an objective, not generating a draft, and not the implementer.
 *
 * Created in the post-V3 operational recovery programme (Stage 2).
 */
import { CLOSURE_SCOPES, DELEGABLE_SCOPES, type DelegableScope } from '@projectos/core';
import { governanceEngines } from './governanceEngines.js';
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import {
  buildProposal,
  checkDraftBinding,
  isRefused,
  loadDiscoveryEngine,
  OBJECTIVES_REL,
  planMaterial,
  readProjectFacts,
  type DraftRecord,
  type Proposal,
} from './planIntake.js';
import { validateAuthoredMaterial } from './planAuthoring.js';

export const PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION = '1.0.0';
export const PLAN_APPROVAL_DECISION_SCHEMA_VERSION = '1.0.0';
export const PLAN_GENESIS_SCHEMA_VERSION = '1.0.0';

/**
 * The first-plan genesis record, project-root-relative.
 *
 * Held as a constant because the refusal text has to name it: an operator told only that "no owner
 * could be established" cannot act, and this is the one file that fixes it.
 */
export const PLAN_GENESIS_REL = '.projectops/authority/plan-genesis.json';

/**
 * The governed project configuration, project-root-relative.
 *
 * Read from the COMMITTED blob for one decision only — whether this project is eligible for
 * first-plan bootstrap. See the precedence block in `approvePlan`.
 */
export const PROJECT_CONFIG_REL = '.projectops/project-config.json';

/** The one scope a plan-approval delegation may carry. Closure is delegated separately, below. */
export const PLAN_APPROVAL_SCOPE = 'plan-approval';

/**
 * The scopes a delegation record may carry. Re-exported from the core vocabulary rather than
 * restated here: this file used to keep its own copy of the closure scopes, and two lists that must
 * agree but are edited separately is how a scope ends up legal at one boundary and refused at
 * another. None of these is authority to ACT.
 */
export { CLOSURE_SCOPES, DELEGABLE_SCOPES, GATEKEEPER_REVIEW_SCOPE } from '@projectos/core';

const HEX40 = /^[0-9a-f]{40}$/;
const ID_SHAPE = /^[A-Za-z0-9_.:-]{8,128}$/;
const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/;

/** Every field is untrusted until checked against something the runtime established for itself. */
export interface PlanApprovalDelegationRecord {
  readonly schemaVersion?: unknown;
  readonly delegationId?: unknown;
  readonly projectId?: unknown;
  readonly delegatedBy?: unknown;
  readonly delegatedTo?: unknown;
  readonly delegatedScope?: unknown;
  readonly delegationDate?: unknown;
  readonly excludesProtectedActions?: unknown;
  readonly programmeScope?: unknown;
  readonly notes?: unknown;
}

/**
 * The record that answers ONE question: who is the owner, before any plan exists to record one?
 *
 * It is deliberately the smallest authority record in this file. It approves nothing, delegates
 * nothing and authorises nothing — it supplies `recordedOwner` for a project's FIRST approval, and
 * only when no active plan is declared at all. Every later approval reads the owner from the active
 * approved plan, exactly as before.
 */
export interface PlanGenesisRecord {
  readonly schemaVersion?: unknown;
  readonly genesisId?: unknown;
  readonly projectId?: unknown;
  /** The complete initial governance, in the plan schema's own field names. */
  readonly governance?: unknown;
}

/**
 * The governance a first plan must carry, named and typed exactly as the plan schema requires.
 *
 * Deliberately NOT a second schema framework: these are the same field names the plan itself uses,
 * checked here so a genesis record that could never produce a schema-valid plan is refused while the
 * operator can still act on it, rather than surfacing later as an opaque PLAN_SCHEMA_INVALID.
 *
 * `noApiPolicy` is deliberately not listed: `materialisePlan` always emits a boolean for it, so the
 * plan schema is satisfied either way and a check here would be dead. It still has to be RIGHT,
 * though — the PLAN READY evaluator refuses a plan whose `noApiPolicy` is not `true`, so in practice
 * a usable genesis record carries it. That refusal is the evaluator's to make, not this function's,
 * and bootstrapping a project must not bootstrap it past the safety floor every other plan meets.
 */
const GENESIS_GOVERNANCE_TEXT: readonly string[] = ['owner', 'gatekeeper', 'implementer', 'closureAuthority'];
const GENESIS_GOVERNANCE_LISTS: readonly string[] = ['allowedActions', 'forbiddenActions', 'ownerOnlyActions'];

export interface PlanApprovalDecisionRecord {
  readonly schemaVersion?: unknown;
  readonly decisionId?: unknown;
  readonly decision?: unknown;
  readonly projectId?: unknown;
  readonly repository?: unknown;
  readonly branch?: unknown;
  readonly baseHead?: unknown;
  readonly draftId?: unknown;
  readonly planDigest?: unknown;
  readonly decidedBy?: unknown;
  readonly decidedAt?: unknown;
  readonly note?: unknown;
  /** Written back when a plan is materialised from it. A decision that carries this is spent. */
  readonly consumedAt?: unknown;
}

export interface DelegationExpectations {
  readonly projectId: string;
  /** The owner, read from the project's ACTIVE approved plan — never from the record being judged. */
  readonly recordedOwner: string;
  readonly isCommitted: boolean;
}

export interface DecisionExpectations {
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly draftId: string;
  /** Recomputed from the repository as it is now, not read from the draft file. */
  readonly planDigest: string;
  /**
   * Who may take this decision. Whoever an APPLICABLE committed delegation names — matching this
   * project, this programme and the plan-approval scope — and otherwise the recorded owner, because
   * where no delegation applies the authority never moved. Never the record's claim about itself.
   */
  readonly expectedDecider: string;
  readonly isCommitted: boolean;
  /** Does the commit the decision names exist in this repository? */
  readonly baseHeadExists: boolean;
}

interface GovernanceEngine {
  isImplementerIdentity(name: unknown): boolean;
  evaluatePlanReady(plan: unknown): { readonly ready: boolean; readonly reasons: readonly string[] };
  validateAgainstSchema(obj: unknown, schema: unknown): readonly string[];
}

/** Composed by the entrypoint, never resolved from the target root — same rule as `governedContext`. */
export function loadGovernanceEngine(): { engine: GovernanceEngine; schema: unknown } {
  const { governance, planSchema } = governanceEngines();
  return { engine: governance, schema: planSchema };
}

export function loadCurrentStateSchema(): unknown {
  return governanceEngines().currentStateSchema;
}

export function authorityDir(root: string): string {
  return join(projectopsDir(root), 'authority');
}

export function planApprovalDelegationPath(root: string): string {
  return join(authorityDir(root), 'plan-approval-delegation.json');
}

export function closureDelegationPath(root: string): string {
  return join(authorityDir(root), 'closure-delegation.json');
}

export function planGenesisPath(root: string): string {
  return join(authorityDir(root), 'plan-genesis.json');
}

export function planDecisionsDir(root: string): string {
  return join(projectopsDir(root), 'plan-decisions');
}

export function planDecisionPath(root: string, decisionId: string): string {
  return join(planDecisionsDir(root), `${decisionId}.json`);
}

function strOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** The `X.Y` shape every plan version must have — the same one the governance engine enforces. */
const PLAN_VERSION = /^([0-9]+)\.([0-9]+)$/;

/**
 * What version a newly approved plan carries, and which version it replaces.
 *
 * THIS USED TO BE A CONSTANT AND A NULL. Every approved plan was written as `planVersion: '1.0'` with
 * `supersedesPlanVersion: null`, so a plan that replaced another said nothing about what it replaced
 * — and the succession chain the schema requires, the governance engine validates and the Control
 * Centre renders was permanently empty.
 *
 * THE TWO HAVE TO MOVE TOGETHER. Recording the outgoing version while leaving the new one at `1.0`
 * produces `1.0 supersedes 1.0`, which `checkVersionRecord` refuses outright as "plan version
 * supersedes itself". A successor is only meaningful if it is a different version, so the successor
 * takes the next minor.
 *
 * GENESIS IS UNCHANGED: a first plan replaces nothing, so it stays `1.0` and supersedes `null`.
 *
 * AN UNREADABLE OUTGOING VERSION IS A REFUSAL, NOT A FRESH START. Falling back to `1.0`/`null` would
 * make a succession indistinguishable from a first plan: the replacement would claim this project had
 * never had a plan, and the predecessor it actually replaced would vanish from the record. So this
 * returns null and the caller refuses the approval — a plan whose predecessor cannot be named is not
 * one ProjectOS is willing to write.
 *
 * X AND Y ARE INTEGERS, NOT A DECIMAL. `1.9` succeeds to `1.10`, which is why the parts are handled
 * separately rather than by arithmetic on the string as a number.
 */
function planVersionSuccession(
  governanceSource: GovernanceSource,
  activePlan: Record<string, unknown>,
): { readonly planVersion: string; readonly supersedesPlanVersion: string | null } | null {
  if (governanceSource === 'genesis') return { planVersion: '1.0', supersedesPlanVersion: null };
  const outgoing = strOf(activePlan['planVersion']);
  const m = outgoing === null ? null : PLAN_VERSION.exec(outgoing);
  if (m === null) return null;
  return { planVersion: `${m[1]}.${Number(m[2]) + 1}`, supersedesPlanVersion: outgoing };
}

/**
 * Why this record is not a usable plan-approval delegation, or `[]` when it is. Pure — no I/O.
 * Returns every reason rather than the first, so one refusal shows the whole gap.
 */
export function checkPlanApprovalDelegation(
  record: PlanApprovalDelegationRecord | null,
  expect: DelegationExpectations & { readonly programmeId: string },
): readonly string[] {
  if (record === null) {
    return [
      `no committed plan-approval delegation exists for '${expect.projectId}'. Only the owner ` +
        `'${expect.recordedOwner}' can approve a plan for this project unless the owner has recorded a delegation.`,
    ];
  }
  const { engine } = loadGovernanceEngine();
  const e: string[] = [];
  if (record.schemaVersion !== PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION) {
    e.push(`delegation schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION}"`);
  }
  if (strOf(record.delegationId) === null || !ID_SHAPE.test(String(record.delegationId))) {
    e.push('delegation has no usable delegationId');
  }
  if (record.projectId !== expect.projectId) {
    e.push(`delegation is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  // PROGRAMME SCOPE IS AUTHORITY, NOT A LABEL. The field was recorded from the beginning and read by
  // nobody, so a delegation granted for one programme silently carried into the next one — which is
  // how a retired programme's delegation came to sit in front of a new programme's approval. The
  // closure delegation has always enforced its own programme scope; this makes plan approval agree.
  if (record.programmeScope !== expect.programmeId) {
    e.push(
      `delegation is scoped to programme ${JSON.stringify(record.programmeScope)}, not '${expect.programmeId}'`,
    );
  }
  // The delegator is the owner the ACTIVE APPROVED PLAN records. A record that names its own
  // delegator would be granting itself the authority to grant authority.
  if (record.delegatedBy !== expect.recordedOwner) {
    e.push(
      `delegation claims to come from ${JSON.stringify(record.delegatedBy)}, who is not this project's ` +
        `recorded owner '${expect.recordedOwner}'`,
    );
  }
  const to = strOf(record.delegatedTo);
  if (to === null) e.push('delegation names no delegatedTo');
  else if (engine.isImplementerIdentity(to)) e.push(`delegation names the implementer (${to}) — the implementer can never approve a plan`);
  else if (to === expect.recordedOwner) e.push('delegation delegates to the owner, which delegates nothing');
  const scope = Array.isArray(record.delegatedScope) ? record.delegatedScope : null;
  if (scope === null || !scope.includes(PLAN_APPROVAL_SCOPE)) {
    e.push(`delegation does not carry the '${PLAN_APPROVAL_SCOPE}' scope`);
  } else {
    for (const s of scope) if (s !== PLAN_APPROVAL_SCOPE) e.push(`delegation carries a scope this record may not grant: ${JSON.stringify(s)}`);
  }
  if (record.excludesProtectedActions !== true) {
    e.push('delegation must state excludesProtectedActions: true — approving a plan never carries protected-action authority');
  }
  if (strOf(record.delegationDate) === null) e.push('delegation records no delegationDate');
  if (!expect.isCommitted) {
    e.push(
      'the delegation is not committed. An uncommitted delegation has not passed the owner commit gate, which is the ' +
        "only thing that makes a forged one a visible diff under this programme's tamperProof:false model",
    );
  }
  return e;
}

/**
 * Why this record is not a usable first-plan genesis, or `[]` when it is. Pure — no I/O.
 *
 * IT ESTABLISHES AN IDENTITY, NOT A PERMISSION. Genesis supplies `recordedOwner` and nothing else:
 * the plan-approval delegation is still required, still read from the committed blob, and still
 * decides who may actually approve. A project with a perfect genesis record and no delegation is
 * refused exactly as it was before this record existed — which is the point, because a record that
 * both named the owner and granted approval would be a self-signed approval.
 *
 * THE OWNER MAY NOT BE THE IMPLEMENTER. Without this, the implementer writes one small file, becomes
 * the recorded owner, then delegates plan approval to itself — the whole authority chain unwound at
 * its root. The delegation's own implementer exclusion cannot catch it, because that check compares
 * against `recordedOwner`, which would by then be the implementer.
 */
export function checkPlanGenesis(record: PlanGenesisRecord | null, expect: { readonly projectId: string }): readonly string[] {
  if (record === null) {
    return [
      `this project declares no active plan and has no committed ${PLAN_GENESIS_REL}. A project ` +
        'approving its FIRST plan needs one: it records who the owner is, before any plan exists to ' +
        'record it. Every later approval reads the owner from the active approved plan instead.',
    ];
  }
  const { engine } = loadGovernanceEngine();
  const e: string[] = [];
  if (record.schemaVersion !== PLAN_GENESIS_SCHEMA_VERSION) {
    e.push(`genesis schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${PLAN_GENESIS_SCHEMA_VERSION}"`);
  }
  if (strOf(record.genesisId) === null || !ID_SHAPE.test(String(record.genesisId))) {
    e.push('genesis has no usable genesisId');
  }
  // Authority does not cross project boundaries. A genesis copied from another repository names a
  // real owner and would otherwise pass.
  if (record.projectId !== expect.projectId) {
    e.push(`genesis is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  // THE COMPLETE INITIAL GOVERNANCE, checked to the same requirements the plan schema will apply.
  // A first plan has no predecessor to inherit governance from, so this record is the only source —
  // which is why it must be complete here rather than half-supplied and patched with defaults.
  const governance = typeof record.governance === 'object' && record.governance !== null && !Array.isArray(record.governance)
    ? (record.governance as Record<string, unknown>)
    : null;
  if (governance === null) {
    e.push('genesis carries no governance object — a first plan has no predecessor to inherit governance from');
    return e;
  }
  for (const field of GENESIS_GOVERNANCE_TEXT) {
    if (strOf(governance[field]) === null) e.push(`genesis governance.${field} is missing or empty`);
  }
  for (const field of GENESIS_GOVERNANCE_LISTS) {
    const list = governance[field];
    if (!Array.isArray(list) || list.length === 0 || !list.every((v) => strOf(v) !== null)) {
      e.push(`genesis governance.${field} must be a non-empty list of non-empty strings`);
    }
  }
  const owner = strOf(governance['owner']);
  if (owner !== null && engine.isImplementerIdentity(owner)) {
    e.push(`genesis names the implementer (${owner}) as owner — the implementer can never be the owner authority`);
  }
  return e;
}

/** The genesis record's governance, once `checkPlanGenesis` has accepted it. */
function genesisGovernance(record: PlanGenesisRecord): Record<string, unknown> {
  return record.governance as Record<string, unknown>;
}

/**
 * Why this record is not a usable delegation, or `[]` when it is.
 *
 * Separate from the plan-approval delegation on purpose. Approving a plan and closing a phase are
 * different authorities, and a record that could grant both would be a way to widen one by editing
 * the other. Same trust basis as everything else here: it must be committed, and it grants no
 * protected effect.
 *
 * ONE VALIDATOR, EVERY BOUNDARY. This record is read at more than one place — plan approval, and the
 * gatekeeper resolving who may decide a review — and every one of them calls THIS function. It used
 * to be otherwise: the gatekeeper's resolver accepted the record on a programme match and a non-empty
 * `delegatedTo` alone, so bytes this function rejected outright still named the decider, and whether
 * a record was ever judged at all depended on the order things happened in. `requiredScope` is what
 * lets a consumer say which capability it is about to exercise, without any consumer needing its own
 * idea of what a valid record looks like.
 */
export function checkClosureDelegationRecord(
  record: PlanApprovalDelegationRecord | null,
  expect: DelegationExpectations & {
    readonly programmeId: string;
    /** The capability the caller is about to exercise. The record must carry it. */
    readonly requiredScope?: DelegableScope;
  },
): readonly string[] {
  if (record === null) {
    // Absent is legitimate for plan approval — closure then stays where it already is. It is NOT
    // legitimate for a caller that needs a specific capability: nothing grants it.
    return expect.requiredScope === undefined
      ? []
      : [`no delegation record exists, so nothing grants '${expect.requiredScope}' for programme '${expect.programmeId}'`];
  }
  const { engine } = loadGovernanceEngine();
  const e: string[] = [];
  if (record.schemaVersion !== PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION) {
    e.push(`delegation schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION}"`);
  }
  if (strOf(record.delegationId) === null || !ID_SHAPE.test(String(record.delegationId))) {
    e.push('delegation has no usable delegationId');
  }
  if (record.projectId !== expect.projectId) {
    e.push(`delegation is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.programmeScope !== expect.programmeId) {
    e.push(`delegation is scoped to programme ${JSON.stringify(record.programmeScope)}, not '${expect.programmeId}'`);
  }
  if (record.delegatedBy !== expect.recordedOwner) {
    e.push(`delegation claims to come from ${JSON.stringify(record.delegatedBy)}, who is not this project's recorded owner '${expect.recordedOwner}'`);
  }
  const to = strOf(record.delegatedTo);
  if (to === null) e.push('delegation names no delegatedTo');
  else if (engine.isImplementerIdentity(to)) e.push(`delegation names the implementer (${to}) — the implementer can never hold delegated authority over its own work`);
  const scope = Array.isArray(record.delegatedScope) ? record.delegatedScope : null;
  if (scope === null || scope.length === 0) e.push('delegation carries no scope');
  else for (const s of scope) if (!(DELEGABLE_SCOPES as readonly string[]).includes(String(s))) e.push(`delegation carries a scope it may not grant: ${JSON.stringify(s)}`);
  // WHAT THE CALLER IS ABOUT TO DO WITH IT. Checked here so no consumer has to interpret the scope
  // list itself — the place where the closure scopes and the review scope would drift apart again.
  if (expect.requiredScope !== undefined && !(scope ?? []).map(String).includes(expect.requiredScope)) {
    e.push(
      `delegation carries [${(scope ?? []).map(String).join(', ')}], which does not cover ` +
        `'${expect.requiredScope}' — the capability being exercised`,
    );
  }
  if (record.excludesProtectedActions !== true) {
    e.push('delegation must state excludesProtectedActions: true — delegating a capability never carries protected-action authority');
  }
  if (strOf(record.delegationDate) === null) e.push('delegation records no delegationDate');
  if (!expect.isCommitted) e.push('the delegation is not committed, so it has not passed the owner commit gate');
  return e;
}

/** Why this record is not a usable plan-approval decision, or `[]` when it is. Pure — no I/O. */
export function checkPlanApprovalDecision(
  record: PlanApprovalDecisionRecord | null,
  expect: DecisionExpectations,
): readonly string[] {
  if (record === null) {
    return [
      `no committed plan-approval decision exists for draft '${expect.draftId}'. A draft is a proposal; ` +
        `'${expect.expectedDecider}' must record a decision, and it must be committed.`,
    ];
  }
  const { engine } = loadGovernanceEngine();
  const e: string[] = [];
  if (record.schemaVersion !== PLAN_APPROVAL_DECISION_SCHEMA_VERSION) {
    e.push(`decision schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${PLAN_APPROVAL_DECISION_SCHEMA_VERSION}"`);
  }
  if (strOf(record.decisionId) === null || !ID_SHAPE.test(String(record.decisionId))) {
    e.push('decision has no usable decisionId');
  }
  if (record.decision !== 'approve') {
    e.push(`the record does not decide to approve (decision=${JSON.stringify(record.decision)})`);
  }
  if (record.consumedAt !== undefined && record.consumedAt !== null) {
    e.push(`decision was already consumed at ${String(record.consumedAt)} and cannot be replayed`);
  }
  if (record.projectId !== expect.projectId) {
    e.push(`decision is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.repository !== expect.repository) {
    e.push(`decision is for repository ${JSON.stringify(record.repository)}, not '${expect.repository}'`);
  }
  if (record.branch !== expect.branch) {
    e.push(`decision was taken on branch ${JSON.stringify(record.branch)}, this checkout is on '${expect.branch}'`);
  }
  if (record.draftId !== expect.draftId) {
    e.push(`decision approves draft ${JSON.stringify(record.draftId)}, not '${expect.draftId}'`);
  }
  // THE CURRENTNESS TEST. `expect.planDigest` was recomputed from the repository moments ago, so a
  // mismatch means the plan material the authority approved is not the plan material that exists now.
  if (typeof record.planDigest !== 'string' || !DIGEST_SHAPE.test(record.planDigest)) {
    e.push('decision names no valid plan digest');
  } else if (record.planDigest !== expect.planDigest) {
    e.push(
      `decision approved plan material ${record.planDigest.slice(7, 19)}, but the repository now proposes ` +
        `${expect.planDigest.slice(7, 19)} — an approval of different plan material is not an approval of this one`,
    );
  }
  // The decider is the delegation's, never the record's claim about itself.
  if (record.decidedBy !== expect.expectedDecider) {
    e.push(`decision was taken by ${JSON.stringify(record.decidedBy)}, who is not the recorded plan-approval authority '${expect.expectedDecider}'`);
  } else if (engine.isImplementerIdentity(record.decidedBy)) {
    e.push('decision was taken by the implementer — the implementer can never approve a plan');
  }
  if (strOf(record.decidedAt) === null) e.push('decision records no decidedAt');
  if (typeof record.baseHead !== 'string' || !HEX40.test(record.baseHead)) {
    e.push('decision names no valid base commit');
  } else if (!expect.baseHeadExists) {
    e.push(`decision names commit ${record.baseHead.slice(0, 7)}, which does not exist in this repository`);
  }
  if (!expect.isCommitted) {
    e.push(
      'the decision is not committed. An uncommitted decision has not passed the owner commit gate, which is the ' +
        "only thing that makes a forged one a visible diff under this programme's tamperProof:false model",
    );
  }
  return e;
}

/* ------------------------------------------------------------------------------------------------
 * Materialising the plan.
 *
 * Every field is taken from something already recorded: the proposal the engine produced from the
 * owner's declared planning sources, the project config, the project's active approved plan (for the
 * governance the owner has already approved for this project), and the decision itself. Nothing is
 * defaulted. A plan record is the thing execution authority is derived from, so a field invented here
 * to satisfy a schema would be a fabricated fact about what the owner agreed to.
 * --------------------------------------------------------------------------------------------- */

/** Where a plan's governance came from. A first plan has no predecessor to carry it forward from. */
export type GovernanceSource = 'active-plan' | 'genesis';

export interface MaterialiseInputs {
  readonly proposal: Proposal;
  readonly config: Record<string, unknown>;
  /**
   * The source of already-approved governance: the project's active approved plan, or — for a FIRST
   * plan, which has no predecessor — the governance snapshot from the committed genesis record.
   */
  readonly activePlan: Record<string, unknown>;
  /**
   * Which of the two it was. The approval evidence states this in words, so it must not be inferred:
   * a first plan claiming governance was "carried forward" would be describing a predecessor that
   * never existed.
   */
  readonly governanceSource?: GovernanceSource;
  readonly decision: PlanApprovalDecisionRecord;
  /** The applicable delegation, or `null` when the owner approved directly. */
  readonly delegation: PlanApprovalDelegationRecord | null;
  /**
   * The owner's closure delegation for THIS programme, when one is recorded. Absent means closure
   * stays exactly where the project's active plan already puts it — carried forward, not invented.
   */
  readonly closureDelegation?: PlanApprovalDelegationRecord | null;
  readonly planId: string;
  readonly programmeId: string;
  readonly now: string;
}

export type MaterialiseResult =
  | { readonly ok: true; readonly plan: Record<string, unknown> }
  | { readonly ok: false; readonly problems: readonly string[] };

function arrOfStrings(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

function sourced(value: unknown, field: string, problems: string[]): string {
  const s = strOf(value);
  if (s === null || s === 'NEEDS SOURCE' || s === 'UNKNOWN') {
    problems.push(`${field} is not sourced from the planning corpus — the plan document must state it`);
    return '';
  }
  return s;
}

export function materialisePlan(input: MaterialiseInputs): MaterialiseResult {
  const problems: string[] = [];
  const d = input.proposal.imported.draft;
  const gov = (input.activePlan['governance'] as Record<string, unknown> | undefined) ?? {};
  const succession = planVersionSuccession(input.governanceSource ?? 'active-plan', input.activePlan);
  if (succession === null) {
    problems.push(
      `the active plan records a version of ${JSON.stringify(input.activePlan['planVersion'])}, which is not the ` +
        'X.Y form a plan version takes, so the plan this approval would replace cannot be named. A successor ' +
        'that cannot say what it supersedes would be indistinguishable from a first plan. Repair the active ' +
        "plan's version before approving a replacement.",
    );
  }

  const businessVision = sourced(d['businessVision'], 'businessVision', problems);
  const definitionOfComplete = sourced(d['definitionOfComplete'], 'definitionOfComplete', problems);
  const successStandard = sourced(d['successStandard'], 'successStandard', problems);
  const approvedScope = arrOfStrings(d['approvedScopeCandidates']);
  const excludedScope = arrOfStrings(d['excludedScopeCandidates']);
  if (approvedScope.length === 0) problems.push('the plan document declares no approved scope');
  if (excludedScope.length === 0) problems.push('the plan document declares no excluded scope');

  const environments = (Array.isArray(d['environmentCandidates']) ? d['environmentCandidates'] : [])
    .filter((e): e is { environmentId: string; productionFreeze: boolean } =>
      typeof e === 'object' && e !== null && typeof (e as { environmentId?: unknown }).environmentId === 'string')
    .map((e) => ({ environmentId: e.environmentId, productionFreeze: e.productionFreeze === true }));
  if (environments.length === 0) problems.push('the plan document declares no environments');

  // Source documents: the planning sources that actually shaped the draft, with the checksums the
  // engine recorded for them. Not a claim — the provenance entries are the evidence.
  const provenance = Array.isArray(d['provenance']) ? (d['provenance'] as Record<string, unknown>[]) : [];
  const byPath = new Map<string, string>();
  for (const p of provenance) {
    const path = strOf(p['sourcePath']);
    const sum = strOf(p['sourceChecksum']);
    if (path !== null && sum !== null) byPath.set(path, sum);
  }
  // The AUTHORITATIVE source document is the one that supplied the definition of complete — the
  // document this plan's substance actually came from, established from the engine's own provenance
  // rather than chosen here.
  const authoritativeDoc = strOf(provenance.find((p) => p['field'] === 'definitionOfComplete')?.['sourcePath']);
  const sourceDocuments = [...byPath.entries()].map(([documentPath, sourceDocumentChecksum]) => ({
    documentPath,
    sourceDocumentType: documentPath.endsWith('.json') ? ('requirements' as const) : ('human-readable-plan' as const),
    sourceDocumentChecksum,
    authoritative: documentPath === authoritativeDoc,
    superseded: false,
  }));
  if (sourceDocuments.length === 0) problems.push('no planning source carries a recorded checksum to cite as a source document');
  if (authoritativeDoc === null || !byPath.has(authoritativeDoc)) {
    problems.push('no planning source can be cited as the authoritative source document for this plan');
  }

  const candidates = Array.isArray(d['phaseCandidates']) ? (d['phaseCandidates'] as Record<string, unknown>[]) : [];
  if (candidates.length === 0) problems.push('the proposal contains no phases');
  const phases = candidates.map((c) => {
    const id = strOf(c['phaseId']) ?? '?';
    const description = strOf(c['purpose']);
    const acceptance = arrOfStrings(c['acceptanceCriteria']);
    const risk = strOf(c['riskLevel']);
    const autonomy = strOf(c['autonomyLevel']);
    const proof = c['requiredBrowserProof'];
    if (description === null || description === 'NEEDS OWNER DECISION') problems.push(`phase ${id} has no sourced purpose`);
    if (acceptance.length === 0) problems.push(`phase ${id} has no acceptance criteria`);
    if (risk === null) problems.push(`phase ${id} does not state a risk level`);
    if (autonomy === null) problems.push(`phase ${id} does not state an autonomy level`);
    if (typeof proof !== 'boolean') problems.push(`phase ${id} does not state whether browser proof is required`);
    // SCOPE IS PROJECTED. It was omitted, so every activated plan dropped the approved scope and the
    // only machine-readable record of what a phase may touch disappeared at the moment of approval.
    // Worse, the activated plan then SHADOWED its own source document in discovery - it declares the
    // phase with high confidence and no scope - so the scope could never be recovered by regenerating.
    // Carrying it here is what makes the approval digest bind the scope the owner actually approved.
    // Carried, never enforced here. Requiring a sourced scope would refuse every plan whose draft
    // predates this projection, which is a migration decision and not this correction's business.
    const scope = strOf(c['scope']);
    return {
      phaseId: id,
      description: description ?? '',
      scope: scope ?? '',
      dependsOn: arrOfStrings(c['dependencies']),
      acceptanceCriteria: acceptance,
      riskLevel: risk ?? '',
      autonomyLevel: autonomy ?? '',
      requiredValidators: arrOfStrings(c['expectedValidators']),
      requiredReviews: arrOfStrings(c['requiredReviews']),
      requiredBrowserProof: proof === true,
      requiredOwnerGates: arrOfStrings(c['ownerGates']),
    };
  });

  const secrets = (input.config['secretsPolicy'] as Record<string, unknown> | undefined) ?? {};
  const decidedAt = strOf(input.decision.decidedAt) ?? input.now;

  // CLOSURE AUTHORITY. Where the owner has recorded a closure delegation for this programme, the new
  // plan states THAT — with this programme named in it — rather than inheriting a delegation whose
  // own notes describe the previous programme. Where the owner has recorded none, the active plan's
  // arrangement is carried forward unchanged, because an approval of a draft is not the moment to
  // invent who may close.
  // A DELEGATION IS ONLY A CLOSURE DELEGATION IF IT DELEGATES CLOSURE.
  //
  // One record file carries whatever the owner delegated, and the vocabulary now includes a scope
  // that has nothing to do with closing anything. Materialising such a record here would write it
  // into `governance.closureDelegation` and hand `closureAuthority` to its delegate — granting, as a
  // side effect of approving a plan, exactly the authority the narrow scope exists to avoid granting.
  // `decideClosureAuthority` would still refuse the close, because it checks the scope list covers
  // the closure being attempted; this keeps the claim from being made in the first place.
  const cdRaw = input.closureDelegation ?? null;
  // `delegatedScope` is typed `unknown` because every field of that record is untrusted until checked.
  // `approvePlan` always runs `checkClosureDelegationRecord` first, so a non-array cannot reach here
  // today — but this function is exported, documented as pure, and contracted to RETURN problems
  // rather than throw. Guarding costs nothing and keeps that contract true for a future caller.
  const cdScope = cdRaw !== null && Array.isArray(cdRaw.delegatedScope) ? (cdRaw.delegatedScope as readonly unknown[]) : [];
  const closureScope = cdScope.map(String).filter((s) => (CLOSURE_SCOPES as readonly string[]).includes(s));
  const cd = cdRaw !== null && closureScope.length > 0 ? cdRaw : null;
  const closureFromRecord = cd === null
    ? null
    : {
        delegatedBy: String(cd.delegatedBy),
        delegatedTo: String(cd.delegatedTo),
        delegationDate: String(cd.delegationDate),
        // ONLY THE CLOSURE SCOPES. The plan schema's `closureDelegation.delegatedScope` is
        // closure-only by definition — "Closure only. Protected actions are not delegable through
        // this field." A record may legitimately carry `gatekeeper-review-decisions` alongside a
        // closure scope, and copying that through would make the plan fail its own schema. It is
        // pruned rather than admitted: this field describes what closure was delegated, and the
        // review capability is not closure. Widening the schema to hold it would put a capability in
        // a governed record that nothing reads it from.
        delegatedScope: closureScope,
        projectScope: input.proposal.projectId,
        excludesProtectedActions: true,
        notes:
          `Recorded by owner ${String(cd.delegatedBy)} for programme '${input.programmeId}' in ` +
          `${String(cd.delegationId)}. Closure only: it is not authority to act, and it excludes every ` +
          `protected effect, which stays with the owner.`,
      };
  const closureDelegation = closureFromRecord ?? gov['closureDelegation'];
  const closureAuthority = closureFromRecord !== null ? closureFromRecord.delegatedTo : (strOf(gov['closureAuthority']) ?? '');

  const plan: Record<string, unknown> = {
    schemaVersion: strOf(input.activePlan['schemaVersion']) ?? '1.0.0',
    projectId: input.proposal.projectId,
    projectName: strOf(input.config['projectName']) ?? input.proposal.projectId,
    programmeId: input.programmeId,
    planId: input.planId,
    // Genesis stays 1.0; a successor takes the next minor so it can name what it replaced. See
    // `planVersionSuccession`.
    planVersion: succession?.planVersion ?? '1.0',
    planStatus: 'PLAN READY',

    businessVision,
    definitionOfComplete,
    approvedScope,
    excludedScope,
    successStandard,

    repository: {
      repositoryPath: strOf(input.config['localPath']) ?? '',
      expectedRemote: input.proposal.repository,
      protectedBranches: arrOfStrings(input.config['protectedBranches']),
      baselineCommit: input.proposal.baseHead,
      // Null until the commit that persists this plan exists. Never fabricated in advance.
      planPersistenceCommit: null,
      planSourceBranch: input.proposal.branch,
    },

    sourceDocuments,
    phases,
    environments,
    // Reference names only, and legitimately empty: this programme uses no configured provider.
    providers: [],

    governance: {
      // Carried forward from the project's ACTIVE OWNER-APPROVED plan. These are not new decisions;
      // re-deciding who the owner is, or which actions are forbidden, is not something an approval of
      // a draft may do.
      owner: strOf(gov['owner']) ?? '',
      gatekeeper: strOf(gov['gatekeeper']) ?? '',
      implementer: strOf(gov['implementer']) ?? '',
      allowedActions: arrOfStrings(gov['allowedActions']),
      forbiddenActions: arrOfStrings(gov['forbiddenActions']),
      ownerOnlyActions: arrOfStrings(gov['ownerOnlyActions']),
      closureAuthority,
      ...(closureDelegation !== undefined ? { closureDelegation } : {}),
      noApiPolicy: gov['noApiPolicy'] === true,
    },

    approval: {
      approvalStatus: 'approved',
      approvedBy: strOf(input.decision.decidedBy) ?? '',
      approvalDate: decidedAt,
      approvalEvidenceReference:
        `Plan-approval decision ${String(input.decision.decisionId)} by ${String(input.decision.decidedBy)}, ` +
        `taken against draft ${String(input.decision.draftId)} with plan digest ${String(input.decision.planDigest)} ` +
        `at commit ${String(input.decision.baseHead)} on branch ${input.proposal.branch}. ` +
        (input.delegation === null
          ? `The authority to take it is the owner's own: no plan-approval delegation applies to this project and ` +
            `programme, so approval never moved away from the recorded owner and the decision above is the owner's. `
          : `The authority to take it is delegation ${String(input.delegation.delegationId)}, recorded by owner ` +
            `${String(input.delegation.delegatedBy)} on ${String(input.delegation.delegationDate)} and scoped to ` +
            `'${PLAN_APPROVAL_SCOPE}' for programme '${String(input.delegation.programmeScope)}' in this project only, ` +
            `excluding every protected action. `) +
        `ProjectOS re-ran discovery against the repository before writing this ` +
        `record and the recomputed plan digest still matched the approved one. MANUAL_GOVERNANCE_APPROVAL with ` +
        `tamperProof false — a human governance approval bound by the owner's commit gate, NOT a cryptographic one. ` +
        (input.governanceSource === 'genesis'
          ? `Governance is the initial snapshot recorded in the committed first-plan genesis authority record, this ` +
            `project having had no previously approved plan to carry it forward from; `
          : `Governance is carried forward unchanged from the project's active owner-approved plan; `) +
        `this approval created no new authority, changed no protected-action rule, and did not modify any ` +
        `existing plan record.`,
      // The version this plan replaces, or null for a first plan. Derived with the new version in one
      // place, because a record that supersedes its own version is refused by the governance engine.
      supersedesPlanVersion: succession?.supersedesPlanVersion ?? null,
      approvalBinding: 'MANUAL_GOVERNANCE_APPROVAL',
      tamperProof: false,
      // The AUTHORITY is the owner's either way. When the owner named a delegate, the delegation
      // record is what makes that statement checkable rather than a claim; when no delegation
      // applies, the owner approved in person and there is no delegation to record. `null` says that
      // honestly instead of fabricating a self-delegation, which is refused elsewhere as delegating
      // nothing.
      approvalAuthority: 'owner',
      // The schema makes this OPTIONAL and required only when `approvedBy` is not the recorded owner.
      // Owner-direct approval is exactly that case inverted, so the key is OMITTED rather than set to
      // null: there is no delegation to describe, and saying so by absence keeps the record honest.
      ...(input.delegation === null
        ? {}
        : {
            approvalDelegation: {
              delegatedBy: String(input.delegation.delegatedBy),
              delegatedTo: String(input.delegation.delegatedTo),
              delegationDate: String(input.delegation.delegationDate),
              delegatedScope: [PLAN_APPROVAL_SCOPE],
              projectScope: input.proposal.projectId,
              excludesProtectedActions: true,
            },
          }),
      secureApprovalEvidence: null,
    },

    staleness: {
      lastVerifiedCommit: input.proposal.baseHead,
      lastVerifiedDate: input.now,
      stalenessStatus: 'fresh',
      stalenessReasons: [],
      materialPlanInputs: [
        { inputId: 'plan-digest', fingerprint: input.proposal.planDigest },
        ...sourceDocuments.map((s) => ({ inputId: s.documentPath, fingerprint: s.sourceDocumentChecksum })),
      ],
    },

    security: {
      secretPolicy: strOf(secrets['notes']) ?? 'No raw secret values are stored in plan memory, current state, sessions, reports or prompts.',
      rawSecretValuesForbidden: true,
      sensitiveDataForbidden: true,
      redactionRequired: true,
    },
  };

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, plan };
}

/* ------------------------------------------------------------------------------------------------
 * The command-facing operation.
 * --------------------------------------------------------------------------------------------- */

/**
 * Revalidate a PERSISTED objective-led proposal, without re-authoring it.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `buildProposal`. A corpus-led draft can be re-derived: run
 * discovery again and the same repository yields the same material, so recomputing is both a
 * staleness check and a tamper check at once. An authored draft cannot be re-derived — re-asking the
 * model would produce different words, so the material approved and the material activated would not
 * be the same plan. The exact material reviewed must be the exact material activated, which means it
 * has to be READ.
 *
 * READ IS NOT TRUSTED. A persisted proposal is a file, and a file is not evidence of its own
 * validity. So it is read, validated against the same plan material contract it was written under,
 * re-digested, and the digest compared with the one the decision was taken against. Every mismatch
 * fails closed. No model is called here.
 */

/**
 * Is the move from `fromHead` to `toHead` nothing but ONE commit recording ONE authority record?
 *
 * WHY THIS HAS TO EXIST AT ALL. A decision counts only when COMMITTED — that is the whole
 * `tamperProof: false` argument, and nothing here weakens it. But committing the decision MOVES HEAD,
 * and an objective-led draft is bound to the HEAD it was authored at. So the owner pressing Approve
 * would, by the act of recording their approval, make the very proposal they approved stale. The
 * chicken-and-egg is real, it is created by two rules that are each correct, and this is the smallest
 * thing that resolves it.
 *
 * WHAT IT ACCEPTS, AND NOTHING ELSE:
 *   - exactly ONE commit between the two, and it IS `toHead`;
 *   - exactly ONE parent, and that parent IS `fromHead` (so: not a merge, not a rebase, not a squash);
 *   - the entire diff between them is the allowed decision path or paths, and every one of them was
 *     ADDED rather than modified or deleted.
 *
 * Everything else is still stale. A commit that also touched a source file, a plan record, an
 * objective, another governance record, or the same decision path by MODIFYING it, fails here — and
 * the draft is then reported stale exactly as before. This is a keyhole, not a door: it does not
 * relax `checkDraftBinding`, which is shared with `plan show` and unchanged, and it does not let an
 * arbitrary commit slip between review and activation.
 *
 * ADDED, NOT MODIFIED, IS LOAD-BEARING. Allowing `M` would let a committed decision be rewritten in a
 * commit this function then blesses — which is the one edit that could re-point an approval at
 * different material while looking like the authority-only transition.
 */
export function authorityOnlyAdvance(
  sys: System,
  root: string,
  fromHead: string,
  toHead: string,
  allowedPaths: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] } {
  if (fromHead === toHead) return { ok: true };
  if (!HEX40.test(fromHead) || !HEX40.test(toHead)) {
    return { ok: false, reasons: ['the commits being compared are not both commit ids'] };
  }
  if (allowedPaths.length === 0) {
    return { ok: false, reasons: ['no authority record was named, so no advance can be authority-only'] };
  }

  // `--ancestry-path` so a commit that merely happens to be in the range without descending from
  // `fromHead` cannot make the range look like one step.
  const listed = sys.exec('git', ['-C', root, 'rev-list', '--ancestry-path', `${fromHead}..${toHead}`]);
  if (listed.code !== 0) {
    return { ok: false, reasons: [`the repository could not compare ${fromHead.slice(0, 12)} with ${toHead.slice(0, 12)}`] };
  }
  const commits = listed.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (commits.length !== 1) {
    return {
      ok: false,
      reasons: [
        `${commits.length} commit(s) separate the reviewed proposal from the repository as it is now; ` +
          'only a single authority-only commit is accepted between review and activation',
      ],
    };
  }
  if (commits[0] !== toHead) {
    return { ok: false, reasons: ['the single commit found is not the one the repository is at'] };
  }

  // ONE PARENT, AND IT IS THE ONE REVIEWED. `rev-list --parents -n 1` prints `<commit> <parent>…`,
  // so two fields means exactly one parent — a merge has three or more and a root commit has one.
  const parented = sys.exec('git', ['-C', root, 'rev-list', '--parents', '-n', '1', toHead]);
  const fields = parented.code === 0 ? parented.stdout.trim().split(/\s+/).filter((f) => f !== '') : [];
  if (fields.length !== 2) {
    return { ok: false, reasons: ['the commit recording the decision is a merge or has no single parent'] };
  }
  if (fields[1] !== fromHead) {
    return {
      ok: false,
      reasons: [`the commit recording the decision does not sit directly on ${fromHead.slice(0, 12)}`],
    };
  }

  const diffed = sys.exec('git', ['-C', root, 'diff', '--name-status', fromHead, toHead]);
  if (diffed.code !== 0) {
    return { ok: false, reasons: ['the repository could not describe what that commit changed'] };
  }
  const changes = diffed.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.split('\t'));
  if (changes.length === 0) {
    return { ok: false, reasons: ['the commit recording the decision changed nothing'] };
  }
  const allowed = allowedPaths.map((a) => a.replace(/\\/g, '/'));
  for (const [status, changed] of changes) {
    const path = (changed ?? '').replace(/\\/g, '/');
    if (status !== 'A') {
      return {
        ok: false,
        reasons: [`'${path}' was ${status === 'M' ? 'modified' : `changed (${status})`} rather than added`],
      };
    }
    if (!allowed.includes(path)) {
      return {
        ok: false,
        reasons: [
          `the commit between the reviewed proposal and now also changed '${path}', which is not the ` +
            'decision record; only an authority-only commit may sit there',
        ],
      };
    }
  }
  return { ok: true };
}

export function revalidateAuthoredDraft(
  sys: System,
  root: string,
  engine: ReturnType<typeof loadDiscoveryEngine>,
  draft: DraftRecord,
  /**
   * Decision records whose own commit may sit between the reviewed HEAD and this one.
   *
   * Empty (the default) means the draft must be bound to HEAD exactly, which is what every caller
   * except plan activation wants. See `authorityOnlyAdvance` for why activation is different and for
   * how narrow the exception is.
   */
  allowAuthorityAdvanceFor: readonly string[] = [],
): { readonly ok: true; readonly proposal: Proposal } | ApprovalRefused {
  const facts = readProjectFacts(sys, root);
  if (isRefused(facts)) {
    return { ok: false, code: 'PROPOSAL_FAILED', problems: [`${facts.code}: ${facts.detail}`] };
  }
  const { projectId, repository, branch, baseHead } = facts;

  // (1) THE MATERIAL AS PERSISTED.
  const material = draft.draft;
  if (typeof material !== 'object' || material === null || Array.isArray(material)) {
    return { ok: false, code: 'DRAFT_TAMPERED', problems: ['the persisted draft carries no plan material object'] };
  }

  // (2) VALIDATE against the existing contract before anything is computed from it.
  const problems = validateAuthoredMaterial(material);
  if (problems.length > 0) {
    return {
      ok: false,
      code: 'DRAFT_TAMPERED',
      problems: [
        'the persisted authored material no longer satisfies the plan material contract',
        ...problems,
      ],
    };
  }

  // (3)+(4) RECOMPUTE THE DIGEST OVER WHAT IS ON DISK, and require it to be what was decided.
  if (typeof draft.planDigest !== 'string' || draft.planDigest === '') {
    return {
      ok: false,
      code: 'DRAFT_SUPERSEDED',
      problems: ['the draft records no plan digest — regenerate it'],
    };
  }
  const ownerDecisions = Array.isArray(draft.ownerDecisionsRequired) ? draft.ownerDecisionsRequired : [];
  const planningCorpus = draft.planningCorpus ?? { totalDiscovered: 0, counts: {}, currentPlanningSources: [] };
  const recomputed = engine.sha256(
    planMaterial({
      origin: 'authored',
      planStatus: draft.planStatus,
      projectId: draft.projectId,
      repository: draft.repository,
      draft: material,
      ownerDecisionsRequired: ownerDecisions,
      planningCorpus,
    }),
  );
  if (recomputed !== draft.planDigest) {
    return {
      ok: false,
      code: 'DRAFT_TAMPERED',
      problems: [
        `the persisted plan material digests to ${recomputed.slice(7, 19)}, but the draft records ` +
          `${draft.planDigest.slice(7, 19)}. The material on disk is not the material that was reviewed.`,
      ],
    };
  }

  // (5) BINDING. The corpus-led route gets staleness for free by re-deriving; this route has to ask.
  // THE ONE ALLOWANCE, AND IT IS APPLIED TO THE HEAD ONLY.
  //
  // `checkDraftBinding` answers three questions at once — project, repository, HEAD — and only the
  // last of them is affected by the owner recording their decision. So the draft's own base head is
  // offered as the expectation when, and only when, the repository has moved from it by exactly one
  // authority-only commit. Project and repository are still compared against the real thing, and a
  // draft that is stale for any other reason is still stale.
  const advance =
    allowAuthorityAdvanceFor.length === 0
      ? { ok: false as const, reasons: [] }
      : authorityOnlyAdvance(sys, root, draft.baseHead, baseHead, allowAuthorityAdvanceFor);
  const binding = checkDraftBinding(draft, {
    projectId,
    repository,
    head: advance.ok ? draft.baseHead : baseHead,
  });
  if (binding.length > 0) return { ok: false, code: 'DRAFT_STALE', problems: binding };

  // (5b) THE CITATION IS RE-VERIFIED AGAINST THE FILE IT NAMES.
  //
  // AFTER the binding check, deliberately: a draft carried to another checkout cites a document
  // that does not exist there, and reporting that as tampering would name the wrong problem.
  //
  // Digesting the provenance stops it being edited undetected, but it does not make the citation
  // TRUE: the draft and its objective record are two separate writes, so a crash between them — or
  // any later edit to the objective — leaves a checksum that no longer describes the document the
  // plan says it came from. `materialisePlan` copies that checksum into the activated plan's
  // `sourceDocuments` and `staleness.materialPlanInputs` without re-hashing anything, so this is the
  // only place the claim can be turned back into evidence.
  const provenance = Array.isArray(material['provenance']) ? (material['provenance'] as unknown[]) : [];
  if (provenance.length === 0) {
    return { ok: false, code: 'DRAFT_TAMPERED', problems: ['the persisted authored material cites no source document'] };
  }
  for (const raw of provenance) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, code: 'DRAFT_TAMPERED', problems: ['a provenance entry is not an object'] };
    }
    const entry = raw as Record<string, unknown>;
    const cited = typeof entry['sourcePath'] === 'string' ? entry['sourcePath'] : '';
    // An authored plan's only legitimate source is the owner's own objective record. Anything else
    // is a citation of a document the author was never shown.
    if (!cited.startsWith(`${OBJECTIVES_REL}/`) || cited.includes('..')) {
      return {
        ok: false,
        code: 'DRAFT_TAMPERED',
        problems: [`the authored material cites ${JSON.stringify(cited)}, which is not this project's objective record`],
      };
    }
    const text = sys.readText(join(root, ...cited.split('/')));
    if (text === null) {
      return { ok: false, code: 'DRAFT_TAMPERED', problems: [`the cited source document '${cited}' is not readable`] };
    }
    const actual = engine.sha256(text);
    if (entry['sourceChecksum'] !== actual) {
      return {
        ok: false,
        code: 'DRAFT_TAMPERED',
        problems: [
          `the authored material cites '${cited}' at a checksum that document no longer digests to ` +
            `(recorded ${String(entry['sourceChecksum']).slice(7, 19)}, actual ${actual.slice(7, 19)})`,
        ],
      };
    }
  }


  // (6) is the caller's: authority, decision and delegation are unchanged and run below.
  // (7) materialise EXACTLY this proposal — same shape the corpus-led route produces.
  return {
    ok: true,
    proposal: {
      ok: true,
      origin: 'authored',
      projectId,
      repository,
      branch,
      baseHead,
      planDigest: draft.planDigest,
      status: draft.planStatus,
      imported: {
        duplicates: [],
        conflicts: [],
        draft: material,
        status: draft.planStatus,
        provenanceErrors: [],
        planningCorpus,
      },
      found: { root, sources: [], skipped: [], truncated: false },
      ownerDecisionsRequired: ownerDecisions,
      planningCorpus,
    },
  };
}

export type ApprovalRefusal =
  | 'NO_CONFIG'
  | 'UNSAFE_TARGET_PATH'
  | 'WOULD_OVERWRITE_ACTIVE_PLAN'
  | 'NO_DRAFT'
  | 'PROPOSAL_FAILED'
  | 'NO_ACTIVE_PLAN'
  | 'GENESIS_INVALID'
  | 'PROJECT_IDENTITY_MISMATCH'
  | 'DELEGATION_INVALID'
  | 'DECISION_INVALID'
  | 'DRAFT_SUPERSEDED'
  /** Persisted authored material no longer matches the digest it was reviewed and decided under. */
  | 'DRAFT_TAMPERED'
  /** Persisted authored material no longer describes this project, repository or commit. */
  | 'DRAFT_STALE'
  | 'PLAN_INCOMPLETE'
  | 'PLAN_SCHEMA_INVALID'
  | 'PLAN_NOT_READY';

export interface ApprovalRefused {
  readonly ok: false;
  readonly code: ApprovalRefusal;
  readonly problems: readonly string[];
}

export interface ApprovalAccepted {
  readonly ok: true;
  readonly planPath: string;
  readonly statePath: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly decisionId: string;
  readonly phaseCount: number;
}

export type ApprovalResult = ApprovalAccepted | ApprovalRefused;

export interface ApproveOptions {
  readonly draftId: string;
  readonly decisionId: string;
  /** Where the new plan and its current state are written, project-root-relative. */
  readonly planRelPath: string;
  readonly stateRelPath: string;
  readonly planId: string;
  readonly programmeId: string;
  /**
   * Set when this approval STARTS a programme rather than continuing the one in force.
   *
   * Starting a programme is the owner's act, so no delegation applies to it: a delegate was given
   * authority over a named programme, never over the creation of new ones. Without this, naming a
   * programme would decide which delegation applies — which is how a retired delegation could be
   * revived by pointing an approval at the programme it happened to name.
   */
  readonly startsNewProgramme?: boolean;
}

/**
 * Ids that become FILENAMES. This is a security boundary, not a formatting nicety: both ids arrive
 * from the command line and are joined onto a path, so anything path-shaped would let a caller read
 * a record from outside the project — and, for the decision, write the consumption marker there.
 * `.` and `:` are excluded even though they are legal in a record id, because `..` and a Windows
 * drive letter are exactly the shapes that escape.
 *
 * EXPORTED so a caller that DERIVES a path from one of these ids can apply the same test before it
 * builds that path. `plan activate` does exactly that: it interpolates the draft id into a record
 * filename, which happens before `approvePlan` gets a chance to check anything. A second, separately
 * written pattern there would be the classic way these two drift apart.
 */
export const FILENAME_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Read a record FROM THE COMMITTED BLOB at HEAD, never from the working tree.
 *
 * "Is it committed?" and "what does it say?" have to be the same question. Checking that a path
 * exists at HEAD and then reading the working-tree file answers them separately, so an innocuous
 * record could be committed while a different one sat on disk — and the second is the one that would
 * be believed. `git show` also returns the blob as stored, so a checkout's line-ending conversion
 * cannot change what was reviewed. Null means "not committed, or unreadable", which fails closed.
 */
export function readCommittedJson(sys: System, root: string, relPath: string): Record<string, unknown> | null {
  // `-C root` AND `./`. This ran with NEITHER: the repository answering was whichever one the ambient
  // working directory happened to sit in, and the path resolved against the top of that repository
  // rather than against the governed root. Both are the failure modes this codebase has already paid
  // to learn once, on the read that establishes plan-approval authority.
  const r = sys.exec('git', ['-C', root, 'show', `HEAD:./${relPath}`]);
  if (r.code !== 0) return null;
  return parseObject(r.stdout);
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readJson(sys: System, path: string): Record<string, unknown> | null {
  return parseObject(sys.readText(path));
}

/**
 * The refusal an operator actually needs when a record is sitting right there but is not committed.
 * Without this the message is the accurate but baffling "no committed record exists" while the file
 * is plainly on disk.
 */
function uncommittedButPresent(sys: System, root: string, rel: string, label: string): readonly string[] | null {
  if (!sys.exists(join(root, rel))) return null;
  return [
    `${rel} exists in the working tree but is not committed, so it does not count. An uncommitted ` +
      `${label} has not passed the owner commit gate, which is the only thing that makes a forged one a ` +
      `visible diff under this programme's tamperProof:false model. Commit it and try again.`,
  ];
}

/** Who the owner is, and the governance a new plan inherits — with the source that supplied it. */
export type OwnerResolution =
  | {
      readonly ok: true;
      readonly recordedOwner: string;
      readonly activePlan: Record<string, unknown>;
      readonly governanceSource: GovernanceSource;
    }
  | { readonly ok: false; readonly code: 'NO_ACTIVE_PLAN' | 'GENESIS_INVALID'; readonly problems: readonly string[] };

/**
 * Establish who this project's recorded owner is.
 *
 * Extracted from `approvePlan` so that everything judging a delegation asks the SAME question of the
 * SAME sources. A delegation is checked against `delegatedBy === recordedOwner`, so a consumer with
 * its own notion of the owner is a consumer that can be satisfied by a record the approval path would
 * refuse — which is precisely the defect this extraction exists to make impossible.
 */
export function resolveRecordedOwner(
  sys: System,
  root: string,
  config: Record<string, unknown>,
  projectId: string,
  /**
   * Where the ACTIVE PLAN — the thing that says who the owner is — may be read from.
   *
   * `'working-tree'` is what plan approval has always done, and changing it is not this correction's
   * business: an approval is a single owner-attended act whose whole output is then committed.
   *
   * `'committed'` exists for repeated, unattended reads. There, a plan file on disk is not evidence
   * of anything: whoever can write it can name the owner, and the owner a delegation is checked
   * against is the anchor of the entire check. This is the fix for C11-W2-F1's second half — a
   * validated record judged against a forgeable expectation is not validated.
   */
  planTrust: 'working-tree' | 'committed' = 'working-tree',
): OwnerResolution {
  // WHO THE OWNER IS. Two sources, in STRICT precedence — and the distinction between them is the
  // whole security of this block.
  //
  // A DECLARED active plan is authoritative and MUST resolve. If `planMemory.planPath` is declared
  // but the plan behind it is missing, unreadable or records no owner, that is a DAMAGED GOVERNED
  // PROJECT — never a new one. It fails closed here and genesis is NOT consulted. A fallback would
  // mean deleting one file downgrades an established project to bootstrap state, where a fresh owner
  // identity could be introduced against a plan nobody can read; the attacker would not need to
  // forge an owner, only to break a path.
  //
  // Only the total ABSENCE of a declaration can be a genuine first plan.
  const planMemory = config['planMemory'] as Record<string, unknown> | undefined;
  const declaredPlan = planMemory?.['planPath'];
  const declaresActivePlan = declaredPlan !== undefined && declaredPlan !== null;

  // The governance the NEW plan inherits. For an established project that is the active plan itself.
  // For a first plan there is no approved governance yet except one fact — who the owner is — so the
  // genesis record seeds exactly that field and nothing else. Everything the plan still needs comes
  // from the draft and is judged by the plan evaluator, unchanged.
  let activePlan: Record<string, unknown>;
  let recordedOwner: string | null;
  /** Which of the two sources the approval evidence must name. Succession unless proven otherwise. */
  let governanceSource: GovernanceSource = 'active-plan';
  if (declaresActivePlan) {
    // C11-W2-F5. WHICH PLAN IS THE TRUST ANCHOR IS ITSELF A TRUSTED FACT.
    //
    // Reading the plan's BYTES from HEAD closes nothing on its own while the PATH that selects them
    // still comes from the working copy: history holds other plan records, and a working-tree edit
    // could point `planMemory.planPath` at whichever committed one names a convenient owner. So when
    // the committed configuration declares an active plan, the working copy must declare the same
    // one. Where the committed configuration declares none, this is silent — that case is the genesis
    // branch below, whose anchor is the committed genesis record instead.
    if (planTrust === 'committed') {
      const committedDeclaration = (readCommittedJson(sys, root, PROJECT_CONFIG_REL)?.['planMemory'] as
        | Record<string, unknown>
        | undefined)?.['planPath'];
      if (
        typeof committedDeclaration === 'string' &&
        committedDeclaration.replace(/\\/g, '/') !== String(declaredPlan).replace(/\\/g, '/')
      ) {
        return {
          ok: false,
          code: 'NO_ACTIVE_PLAN',
          problems: [
            `the committed ${PROJECT_CONFIG_REL} declares the active plan at ${JSON.stringify(committedDeclaration)}, ` +
              `but the working copy declares ${JSON.stringify(declaredPlan)}. The plan that says who the owner is ` +
              'decides who may approve the next one, so which plan that is cannot be re-pointed by an edit ' +
              'nobody has reviewed. Commit the change, or restore it.',
          ],
        };
      }
    }
    const declared =
      typeof declaredPlan !== 'string'
        ? null
        : planTrust === 'committed'
          ? readCommittedJson(sys, root, declaredPlan)
          : readJson(sys, join(root, declaredPlan));
    recordedOwner = strOf((declared?.['governance'] as Record<string, unknown> | undefined)?.['owner']);
    if (declared === null || recordedOwner === null) {
      return {
        ok: false,
        code: 'NO_ACTIVE_PLAN',
        problems: [
          `this project declares an active plan at ${JSON.stringify(declaredPlan)}, but it could not be read ` +
            (planTrust === 'committed' ? 'FROM THE COMMITTED TREE ' : '') +
            'or records no owner, so there is nothing against which to check who may approve a new one. ' +
            'Repair the declared plan: a damaged plan is not a new project, and the first-plan genesis ' +
            'record deliberately does not apply here.' +
            (planTrust === 'committed'
              ? ' An uncommitted plan has not passed the owner commit gate, and cannot say who the owner is.'
              : ''),
        ],
      };
    }
    activePlan = declared;
  } else {
    // NO WORKING-TREE DECLARATION — but that alone must not open the bootstrap door.
    //
    // `project-config.json` is read from the working tree everywhere else in this function, and the
    // implementer can write it. If the bootstrap decision rested on that copy alone, deleting
    // `planMemory` from it would make an established project eligible for genesis again, and a stale
    // genesis record would then re-supply an owner the project has since moved on from. So the
    // ELIGIBILITY question is asked of the COMMITTED configuration, which only the owner's commit
    // gate can change. The succession path above still reads the working tree, as it always has.
    const committedConfig = readCommittedJson(sys, root, PROJECT_CONFIG_REL);
    const committedDeclared = (committedConfig?.['planMemory'] as Record<string, unknown> | undefined)?.['planPath'];
    if (committedDeclared !== undefined && committedDeclared !== null) {
      return {
        ok: false,
        code: 'NO_ACTIVE_PLAN',
        problems: [
          `the committed ${PROJECT_CONFIG_REL} declares an active plan at ${JSON.stringify(committedDeclared)}, but the ` +
            'working copy no longer does. A project that has been governed by a plan is not a first-plan project, ' +
            'so genesis does not apply. Restore planMemory in the working configuration, or repair the plan it names.',
        ],
      };
    }

    const genesis = readCommittedJson(sys, root, PLAN_GENESIS_REL);
    const uncommitted = genesis === null ? uncommittedButPresent(sys, root, PLAN_GENESIS_REL, 'genesis record') : null;
    if (uncommitted !== null) return { ok: false, code: 'GENESIS_INVALID', problems: uncommitted };
    if (genesis === null) return { ok: false, code: 'NO_ACTIVE_PLAN', problems: checkPlanGenesis(null, { projectId: projectId }) };
    const genesisProblems = checkPlanGenesis(genesis, { projectId: projectId });
    if (genesisProblems.length > 0) return { ok: false, code: 'GENESIS_INVALID', problems: genesisProblems };
    // Narrowing only. `checkPlanGenesis` has already refused an absent or blank owner.
    // THE COMPLETE INITIAL GOVERNANCE SNAPSHOT, passed through as the record states it. Nothing is
    // fabricated and no field is defaulted: `checkPlanGenesis` has already refused any record that
    // could not produce a schema-valid plan.
    const governance = genesisGovernance(genesis);
    recordedOwner = strOf(governance['owner']);
    if (recordedOwner === null) return { ok: false, code: 'GENESIS_INVALID', problems: ['genesis governance.owner is missing or empty'] };
    activePlan = { governance };
    governanceSource = 'genesis';
  }
  return { ok: true, recordedOwner, activePlan, governanceSource };
}



export type DeciderResolution =
  | {
      readonly ok: true;
      readonly expectedDecider: string;
      readonly source: 'delegation' | 'owner';
      /**
       * The APPLICABLE delegation, or null when authority stayed with the owner.
       *
       * Returned rather than re-read because `materialisePlan` records which delegation an approval
       * was taken under, and a second read could answer differently from the one that decided.
       */
      readonly delegation: PlanApprovalDelegationRecord | null;
    }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Who may take a plan-approval decision for this project, right now.
 *
 * EXTRACTED SO THE WRITER AND THE CHECKER CANNOT DISAGREE. `approvePlan` judges a decision against
 * the decider it resolves; `writePlanApprovalDecision` has to STAMP that same decider, or every
 * decision it writes is refused at activation for naming the wrong authority. Two copies of this
 * reasoning would be two answers waiting to diverge — and the failure would look like a governance
 * problem rather than the duplication it actually was. One function, both callers.
 *
 * WHY IT IS TWO QUESTIONS RATHER THAN ONE.
 *
 * A delegation APPLIES only to the project and programme it names, carrying the plan-approval scope.
 * Anything else is somebody else's delegation and must not stand in front of this approval. When none
 * applies, authority has not moved anywhere: it stays with the recorded owner, who may approve
 * directly. The refusal text has always said exactly that — "Only the owner … can approve a plan for
 * this project unless the owner has recorded a delegation" — while no code path let the owner do it,
 * so a project whose delegation named a finished programme could not be approved by anyone at all.
 * Delegating to the owner is refused elsewhere as delegating nothing, so a synthetic self-delegation
 * was never the answer either.
 *
 * This cannot escalate. The owner is already the highest plan-approval authority, and the decision
 * still has to be signed by that exact identity and committed through the owner's own commit gate.
 * The implementer is refused as decider by every caller, on every route.
 */
export function resolveExpectedDecider(
  sys: System,
  root: string,
  expect: {
    readonly projectId: string;
    readonly recordedOwner: string;
    readonly programmeId: string;
    readonly startsNewProgramme?: boolean;
  },
): DeciderResolution {
  const delegationRel = `.projectops/authority/plan-approval-delegation.json`;
  const delegation = readCommittedJson(sys, root, delegationRel);

  const applies =
    expect.startsNewProgramme !== true &&
    delegation !== null &&
    delegation['projectId'] === expect.projectId &&
    delegation['programmeScope'] === expect.programmeId &&
    Array.isArray(delegation['delegatedScope']) &&
    (delegation['delegatedScope'] as readonly unknown[]).includes(PLAN_APPROVAL_SCOPE);

  if (applies) {
    // An applicable delegation is judged in full. A malformed one for THIS programme is an error, not
    // a quiet fall-through to owner approval, because the owner meant it to be used.
    const problems = checkPlanApprovalDelegation(delegation, {
      projectId: expect.projectId,
      recordedOwner: expect.recordedOwner,
      isCommitted: true,
      programmeId: expect.programmeId,
    });
    if (problems.length > 0) return { ok: false, problems };
    return {
      ok: true,
      expectedDecider: String((delegation as PlanApprovalDelegationRecord).delegatedTo),
      source: 'delegation',
      delegation: delegation as PlanApprovalDelegationRecord,
    };
  }

  // An uncommitted delegation still refuses rather than silently becoming owner approval, so an
  // operator who wrote one and forgot the commit gate is told that, instead of being asked for a
  // signature they did not expect to give.
  if (delegation === null) {
    const uncommitted = uncommittedButPresent(sys, root, delegationRel, 'delegation');
    if (uncommitted !== null) return { ok: false, problems: uncommitted };
  }
  return { ok: true, expectedDecider: expect.recordedOwner, source: 'owner', delegation: null };
}

/**
 * Approve one draft and activate the plan it proposes. The only route in this codebase by which a
 * record with `planStatus: PLAN READY` comes into existence.
 */
export function approvePlan(sys: System, root: string, opts: ApproveOptions): ApprovalResult {
  // Before either id touches a path. See FILENAME_ID.
  for (const [label, id] of [['draft', opts.draftId], ['decision', opts.decisionId]] as const) {
    if (!FILENAME_ID.test(id)) {
      return {
        ok: false,
        code: 'UNSAFE_TARGET_PATH',
        problems: [`the ${label} id '${id}' is not a plain identifier (letters, digits, underscore and hyphen only)`],
      };
    }
  }

  const config = readJson(sys, join(projectopsDir(root), 'project-config.json'));
  if (config === null) return { ok: false, code: 'NO_CONFIG', problems: ['no readable .projectops/project-config.json'] };

  const draft = readJson(sys, join(projectopsDir(root), 'drafts', `${opts.draftId}.json`)) as DraftRecord | null;
  if (draft === null) {
    return { ok: false, code: 'NO_DRAFT', problems: [`no draft '${opts.draftId}' — generate one with \`plan draft\``] };
  }

  // A SPENT DECISION IS SPENT, and says so first. Checked before anything else reads the repository
  // because activating a plan changes the planning corpus — so a replay would otherwise be refused
  // for having stale plan material, which is true but tells the operator the wrong thing.
  const earlyDecision = readJson(sys, planDecisionPath(root, opts.decisionId));
  const spentAt = earlyDecision?.['consumedAt'];
  if (spentAt !== undefined && spentAt !== null) {
    return {
      ok: false,
      code: 'DECISION_INVALID',
      problems: [`decision ${opts.decisionId} was already consumed at ${String(spentAt)} and cannot be replayed`],
    };
  }

  // TWO ORIGINS, TWO REVALIDATION ROUTES — and the route is chosen by a field the digest binds, so a
  // relabelled draft cannot pick the weaker one. See `planMaterial`.
  const engine = loadDiscoveryEngine();
  let proposal: Proposal;
  if (draft.origin === 'authored') {
    // Objective-led: read the persisted material, validate it, re-digest it, bind it. No model call.
    // THE DECISION'S OWN COMMIT MAY SIT BETWEEN THE REVIEWED HEAD AND THIS ONE, and nothing else may.
    // A decision counts only when committed, and committing it moves HEAD — so without this the owner
    // would make their own proposal stale by approving it. See `authorityOnlyAdvance`.
    const revalidated = revalidateAuthoredDraft(sys, root, engine, draft, [
      `.projectops/plan-decisions/${opts.decisionId}.json`,
    ]);
    if (!revalidated.ok) return revalidated;
    proposal = revalidated.proposal;
  } else {
    // Corpus-led, unchanged. RECOMPUTE, don't read. The stored draft is a file; what matters is what
    // this repository proposes right now. Everything downstream is checked against the recomputed
    // digest.
    const rebuilt = buildProposal(sys, root, engine);
    if (!rebuilt.ok) return { ok: false, code: 'PROPOSAL_FAILED', problems: [`${rebuilt.code}: ${rebuilt.detail}`] };

    if (typeof draft.planDigest !== 'string') {
      return {
        ok: false,
        code: 'DRAFT_SUPERSEDED',
        problems: [`draft '${opts.draftId}' records no plan digest — it predates the approval mechanism. Regenerate it.`],
      };
    }
    if (draft.planDigest !== rebuilt.planDigest) {
      return {
        ok: false,
        code: 'DRAFT_SUPERSEDED',
        problems: [
          `the stored draft proposes plan material ${draft.planDigest.slice(7, 19)}, but this repository now ` +
            `proposes ${rebuilt.planDigest.slice(7, 19)}. Regenerate the draft and obtain a decision on the new one.`,
        ],
      };
    }
    proposal = rebuilt;
  }

  // C11-W2-F5. THE CANDIDATE MAY NOT REDEFINE WHO IS AUTHORISED TO APPROVE IT.
  //
  // The plan being approved is a CANDIDATE: uncommitted, owner-reviewed, bound by its digest. That is
  // right and unchanged. But the identity used to decide WHO MAY APPROVE IT was read from the same
  // mutable working tree the candidate lives in, so an edit could move the expectation to meet the
  // record — name a different owner, name a different project — and an internally consistent set
  // would then satisfy every check. The forged file is never part of the commit being reviewed, so it
  // evades the one guarantee this module rests on: that a forged authority record is a visible diff.
  //
  // Committed identity, digest-bound candidate.
  const committedIdentity = readCommittedJson(sys, root, PROJECT_CONFIG_REL);
  const trustedProjectId = strOf(committedIdentity?.['projectId']);
  if (trustedProjectId !== null && trustedProjectId !== proposal.projectId) {
    return {
      ok: false,
      code: 'PROJECT_IDENTITY_MISMATCH',
      problems: [
        `the committed ${PROJECT_CONFIG_REL} identifies this project as ${JSON.stringify(trustedProjectId)}, but this ` +
          `approval proposes a plan for ${JSON.stringify(proposal.projectId)}. Project identity is a trust anchor — ` +
          'every delegation, decision and genesis record is bound to it - so it is taken from the commit ' +
          'gate, not from a working copy the candidate could have changed.',
      ],
    };
  }
  const owned = resolveRecordedOwner(sys, root, config, proposal.projectId, 'committed');
  if (!owned.ok) return { ok: false, code: owned.code, problems: owned.problems };
  const { recordedOwner, activePlan, governanceSource } = owned;

  // The plan in force NOW, named by the working configuration. Used below to refuse writing the new
  // record over it, and to carry the retired document forward as a planning source.
  const declaredPlan = (config['planMemory'] as Record<string, unknown> | undefined)?.['planPath'];

  // A NEW plan is a NEW record. Approving a draft may not rewrite the plan the project is governed by
  // today: that record is either a live plan whose approval this decision is not, or — as here — the
  // record of a closed programme, which is history. Either way it is not this command's to edit.
  //
  // Nor may it write over ANY existing file. The target is caller-supplied, so without this the
  // command is a "write arbitrary JSON anywhere inside the repository" primitive wearing a governance
  // hat, and one mistyped flag overwrites a source file.
  const norm = (p: string): string =>
    p.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.').join('/').toLowerCase();
  const declaredState = (config['planMemory'] as Record<string, unknown> | undefined)?.['currentStatePath'];
  for (const [label, rel] of [['plan', opts.planRelPath], ['current state', opts.stateRelPath]] as const) {
    if (!engine.isSafeRepoRelativePath(rel)) {
      return { ok: false, code: 'UNSAFE_TARGET_PATH', problems: [`the ${label} path '${rel}' is not a safe project-relative path`] };
    }
    for (const active of [declaredPlan, declaredState]) {
      if (typeof active === 'string' && norm(rel) === norm(active)) {
        return {
          ok: false,
          code: 'WOULD_OVERWRITE_ACTIVE_PLAN',
          problems: [`refusing to write the ${label} over the currently active plan memory '${active}'`],
        };
      }
    }
    if (sys.exists(join(root, rel))) {
      return {
        ok: false,
        code: 'WOULD_OVERWRITE_ACTIVE_PLAN',
        problems: [`refusing to write the ${label} over the existing file '${rel}' — a new plan is a new record`],
      };
    }
  }

  // Both authority records are read from the committed blob, so what is checked is what was reviewed.
  const decided = resolveExpectedDecider(sys, root, {
    projectId: proposal.projectId,
    recordedOwner,
    programmeId: opts.programmeId,
    startsNewProgramme: opts.startsNewProgramme === true,
  });
  if (!decided.ok) return { ok: false, code: 'DELEGATION_INVALID', problems: decided.problems };
  const expectedDecider = decided.expectedDecider;

  const decisionRel = `.projectops/plan-decisions/${opts.decisionId}.json`;
  const decision = readCommittedJson(sys, root, decisionRel);
  const baseHead = decision?.['baseHead'];
  const uncommittedDecision = decision === null ? uncommittedButPresent(sys, root, decisionRel, 'decision') : null;
  if (uncommittedDecision !== null) return { ok: false, code: 'DECISION_INVALID', problems: uncommittedDecision };
  const decisionProblems = checkPlanApprovalDecision(decision, {
    projectId: proposal.projectId,
    repository: proposal.repository,
    branch: proposal.branch,
    draftId: opts.draftId,
    planDigest: proposal.planDigest,
    expectedDecider,
    isCommitted: decision !== null,
    // Only a well-formed commit id is ever handed to git, so a record cannot aim this at a symbolic
    // ref or anything else that resolves to something it is not.
    baseHeadExists:
      typeof baseHead === 'string' &&
      /^[0-9a-f]{40}$/.test(baseHead) &&
      sys.exec('git', ['cat-file', '-e', `${baseHead}^{commit}`]).code === 0,
  });
  if (decisionProblems.length > 0) return { ok: false, code: 'DECISION_INVALID', problems: decisionProblems };
  // The record must be the one that was asked for, not merely a valid one sitting at that path.
  if (decision !== null && decision['decisionId'] !== opts.decisionId) {
    return {
      ok: false,
      code: 'DECISION_INVALID',
      problems: [`the record at ${decisionRel} calls itself ${JSON.stringify(decision['decisionId'])}, not '${opts.decisionId}'`],
    };
  }

  // Optional, and checked when present. Absent leaves closure exactly where the active plan puts it.
  const closureRel = `.projectops/authority/closure-delegation.json`;
  const closureDelegation = readCommittedJson(sys, root, closureRel);
  const closureProblems =
    (closureDelegation === null ? uncommittedButPresent(sys, root, closureRel, 'closure delegation') : null) ??
    checkClosureDelegationRecord(closureDelegation, {
      projectId: proposal.projectId,
      recordedOwner,
      isCommitted: closureDelegation !== null,
      programmeId: opts.programmeId,
    });
  if (closureProblems.length > 0) return { ok: false, code: 'DELEGATION_INVALID', problems: closureProblems };

  const now = sys.now();
  const materialised = materialisePlan({
    proposal,
    config,
    activePlan,
    decision: decision as PlanApprovalDecisionRecord,
    delegation: decided.delegation,
    closureDelegation,
    governanceSource,
    planId: opts.planId,
    programmeId: opts.programmeId,
    now,
  });
  if (!materialised.ok) return { ok: false, code: 'PLAN_INCOMPLETE', problems: materialised.problems };

  const { engine: gov, schema } = loadGovernanceEngine();
  const schemaErrors = gov.validateAgainstSchema(materialised.plan, schema);
  if (schemaErrors.length > 0) return { ok: false, code: 'PLAN_SCHEMA_INVALID', problems: schemaErrors };

  // READINESS IS RECOMPUTED, never asserted. The record says PLAN READY; that string is worth
  // nothing until the evaluator agrees, and if it does not, nothing is written at all.
  const readiness = gov.evaluatePlanReady(materialised.plan);
  if (!readiness.ready) return { ok: false, code: 'PLAN_NOT_READY', problems: readiness.reasons };

  const phases = materialised.plan['phases'] as { phaseId: string }[];
  // A git fact, not a placeholder. `not-recorded` is not one of the two states a working tree can be
  // in, and the record's own schema says so.
  const porcelain = sys.exec('git', ['status', '--porcelain']);
  const state = {
    schemaVersion: '1.0.0',
    projectId: proposal.projectId,
    activePlanId: opts.planId,
    activePlanVersion: '1.0',
    currentStatus: 'PLAN READY',
    completionMethod: 'phase-closure',
    acceptedPhaseCount: 0,
    totalPhaseCount: phases.length,
    completionPercentage: 0,
    completedPhases: [],
    activePhase: null,
    pendingPhases: phases.map((p) => p.phaseId),
    blockedPhases: [],
    deferredPhases: [],
    acceptedCarryForward: [],
    currentBranch: proposal.branch,
    currentHead: proposal.baseHead,
    currentRemoteHead: null,
    workingTreeStatus: porcelain.code === 0 && porcelain.stdout.trim() === '' ? 'clean' : 'dirty',
    currentRisks: [],
    currentBlockers: [],
    lastEvidenceReference: `plan-approval decision ${opts.decisionId}`,
    nextRecommendedPhase: phases.length > 0 ? phases[0]!.phaseId : null,
    lastUpdated: now,
    // The decision that caused this record. The delegate exercises the owner's authority, but the
    // role that acted is the gatekeeper's, and the enum has no fourth option to hide behind.
    updatedByRole: 'gatekeeper',
  };

  // The current state is a governed record too, and it was being written without anything checking
  // it against its own schema — two fields were outside their enums and nothing noticed.
  //
  // Defence in depth, and honestly unreachable today: every field above is either a constant inside
  // its enum or a value the PLAN schema already rejects first, so no input drives this branch and a
  // mutation that removes it survives. It is kept because the alternative is that the next change to
  // this record's shape writes an invalid governed record silently, which is exactly what happened
  // the first time. Recorded rather than quietly assumed away.
  const stateSchema = loadCurrentStateSchema();
  const stateErrors = gov.validateAgainstSchema(state, stateSchema);
  if (stateErrors.length > 0) return { ok: false, code: 'PLAN_SCHEMA_INVALID', problems: stateErrors.map((e) => `current state: ${e}`) };

  const planPath = join(root, opts.planRelPath);
  const statePath = join(root, opts.stateRelPath);
  sys.writeText(planPath, `${JSON.stringify(materialised.plan, null, 2)}\n`);
  sys.writeText(statePath, `${JSON.stringify(state, null, 2)}\n`);

  // Activation: the project now governs from the new plan. The previous plan record is left exactly
  // as it is — a closed programme's record is history and is never rewritten.
  //
  // The outgoing plan memory is KEPT as a declared planning source. Not tidiness: `planMemory` names
  // one plan and one current state, so simply repointing it would drop the completion evidence that
  // retires the finished programme, and the very next objective would be proposed the closed
  // programme's phases all over again — the exact failure this recovery began with. Declaring them
  // keeps them readable and keeps the retirement provable, and declaring a document confers no
  // authority on it.
  const carried = [
    ...(Array.isArray(config['planSources']) ? (config['planSources'] as unknown[]).filter((x): x is string => typeof x === 'string') : []),
    ...[declaredPlan, declaredState].filter((x): x is string => typeof x === 'string'),
  ];
  const planSources = carried.filter((p, i) => carried.findIndex((q) => norm(q) === norm(p)) === i);
  const nextConfig = {
    ...config,
    planMemory: { planPath: opts.planRelPath, currentStatePath: opts.stateRelPath },
    planSources,
  };
  sys.writeText(join(projectopsDir(root), 'project-config.json'), `${JSON.stringify(nextConfig, null, 2)}\n`);

  // Spend the decision. The marker lives in the decision itself so that resetting any other record
  // cannot un-spend it.
  sys.writeText(
    planDecisionPath(root, opts.decisionId),
    `${JSON.stringify({ ...(decision as Record<string, unknown>), consumedAt: now }, null, 2)}\n`,
  );

  return {
    ok: true,
    planPath,
    statePath,
    planId: opts.planId,
    planDigest: proposal.planDigest,
    decisionId: opts.decisionId,
    phaseCount: phases.length,
  };
}

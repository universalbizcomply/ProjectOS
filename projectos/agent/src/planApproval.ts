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
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import { buildProposal, loadDiscoveryEngine, type DraftRecord, type Proposal } from './planIntake.js';

export const PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION = '1.0.0';
export const PLAN_APPROVAL_DECISION_SCHEMA_VERSION = '1.0.0';

/** The one scope a plan-approval delegation may carry. Closure is delegated separately, below. */
export const PLAN_APPROVAL_SCOPE = 'plan-approval';

/** The only scopes a closure delegation may carry. Neither is authority to ACT. */
export const CLOSURE_SCOPES: readonly string[] = ['phase-closure', 'programme-closure'];

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
  /** Whoever the committed delegation names. Never the record's claim about itself. */
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

/** Resolved from THIS package, never from the target root — same rule as `governedContext`. */
export function loadGovernanceEngine(): { engine: GovernanceEngine; schema: unknown } {
  const require_ = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    engine: require_(resolve(here, '../../validators/plan-governance-engine.cjs')) as GovernanceEngine,
    schema: require_(resolve(here, '../../schemas/project-plan.schema.json')) as unknown,
  };
}

export function loadCurrentStateSchema(): unknown {
  const require_ = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  return require_(resolve(here, '../../schemas/current-project-state.schema.json')) as unknown;
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

export function planDecisionsDir(root: string): string {
  return join(projectopsDir(root), 'plan-decisions');
}

export function planDecisionPath(root: string, decisionId: string): string {
  return join(planDecisionsDir(root), `${decisionId}.json`);
}

function strOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Why this record is not a usable plan-approval delegation, or `[]` when it is. Pure — no I/O.
 * Returns every reason rather than the first, so one refusal shows the whole gap.
 */
export function checkPlanApprovalDelegation(
  record: PlanApprovalDelegationRecord | null,
  expect: DelegationExpectations,
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
 * Why this record is not a usable CLOSURE delegation, or `[]` when it is.
 *
 * Separate from the plan-approval delegation on purpose. Approving a plan and closing a phase are
 * different authorities, and a record that could grant both would be a way to widen one by editing
 * the other. Same trust basis as everything else here: it must be committed, and it grants no
 * protected effect.
 */
export function checkClosureDelegationRecord(
  record: PlanApprovalDelegationRecord | null,
  expect: DelegationExpectations & { readonly programmeId: string },
): readonly string[] {
  if (record === null) return [];    // absent is legitimate — closure then stays where it already is
  const { engine } = loadGovernanceEngine();
  const e: string[] = [];
  if (record.schemaVersion !== PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION) {
    e.push(`closure delegation schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION}"`);
  }
  if (strOf(record.delegationId) === null || !ID_SHAPE.test(String(record.delegationId))) {
    e.push('closure delegation has no usable delegationId');
  }
  if (record.projectId !== expect.projectId) {
    e.push(`closure delegation is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.programmeScope !== expect.programmeId) {
    e.push(`closure delegation is scoped to programme ${JSON.stringify(record.programmeScope)}, not '${expect.programmeId}'`);
  }
  if (record.delegatedBy !== expect.recordedOwner) {
    e.push(`closure delegation claims to come from ${JSON.stringify(record.delegatedBy)}, who is not this project's recorded owner '${expect.recordedOwner}'`);
  }
  const to = strOf(record.delegatedTo);
  if (to === null) e.push('closure delegation names no delegatedTo');
  else if (engine.isImplementerIdentity(to)) e.push(`closure delegation names the implementer (${to}) — the implementer can never close`);
  const scope = Array.isArray(record.delegatedScope) ? record.delegatedScope : null;
  if (scope === null || scope.length === 0) e.push('closure delegation carries no scope');
  else for (const s of scope) if (!CLOSURE_SCOPES.includes(String(s))) e.push(`closure delegation carries a scope it may not grant: ${JSON.stringify(s)}`);
  if (record.excludesProtectedActions !== true) {
    e.push('closure delegation must state excludesProtectedActions: true — closing something never carries protected-action authority');
  }
  if (strOf(record.delegationDate) === null) e.push('closure delegation records no delegationDate');
  if (!expect.isCommitted) e.push('the closure delegation is not committed, so it has not passed the owner commit gate');
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

export interface MaterialiseInputs {
  readonly proposal: Proposal;
  readonly config: Record<string, unknown>;
  /** The project's current active approved plan — the source of already-approved governance. */
  readonly activePlan: Record<string, unknown>;
  readonly decision: PlanApprovalDecisionRecord;
  readonly delegation: PlanApprovalDelegationRecord;
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
    return {
      phaseId: id,
      description: description ?? '',
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
  const cd = input.closureDelegation ?? null;
  const closureFromRecord = cd === null
    ? null
    : {
        delegatedBy: String(cd.delegatedBy),
        delegatedTo: String(cd.delegatedTo),
        delegationDate: String(cd.delegationDate),
        delegatedScope: (cd.delegatedScope as readonly string[]).slice(),
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
    planVersion: '1.0',
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
        `at commit ${String(input.decision.baseHead)} on branch ${input.proposal.branch}. The authority to take it is ` +
        `delegation ${String(input.delegation.delegationId)}, recorded by owner ${String(input.delegation.delegatedBy)} ` +
        `on ${String(input.delegation.delegationDate)} and scoped to '${PLAN_APPROVAL_SCOPE}' for this project only, ` +
        `excluding every protected action. ProjectOS re-ran discovery against the repository before writing this ` +
        `record and the recomputed plan digest still matched the approved one. MANUAL_GOVERNANCE_APPROVAL with ` +
        `tamperProof false — a human governance approval bound by the owner's commit gate, NOT a cryptographic one. ` +
        `Governance is carried forward unchanged from the project's active owner-approved plan; this approval ` +
        `created no new authority, changed no protected-action rule, and did not modify any existing plan record.`,
      supersedesPlanVersion: null,
      approvalBinding: 'MANUAL_GOVERNANCE_APPROVAL',
      tamperProof: false,
      // The AUTHORITY is the owner's; the decider is the delegate the owner named. The delegation
      // record is what makes that statement checkable rather than a claim.
      approvalAuthority: 'owner',
      approvalDelegation: {
        delegatedBy: String(input.delegation.delegatedBy),
        delegatedTo: String(input.delegation.delegatedTo),
        delegationDate: String(input.delegation.delegationDate),
        delegatedScope: [PLAN_APPROVAL_SCOPE],
        projectScope: input.proposal.projectId,
        excludesProtectedActions: true,
      },
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

export type ApprovalRefusal =
  | 'NO_CONFIG'
  | 'UNSAFE_TARGET_PATH'
  | 'WOULD_OVERWRITE_ACTIVE_PLAN'
  | 'NO_DRAFT'
  | 'PROPOSAL_FAILED'
  | 'NO_ACTIVE_PLAN'
  | 'DELEGATION_INVALID'
  | 'DECISION_INVALID'
  | 'DRAFT_SUPERSEDED'
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
}

/**
 * Ids that become FILENAMES. This is a security boundary, not a formatting nicety: both ids arrive
 * from the command line and are joined onto a path, so anything path-shaped would let a caller read
 * a record from outside the project — and, for the decision, write the consumption marker there.
 * `.` and `:` are excluded even though they are legal in a record id, because `..` and a Windows
 * drive letter are exactly the shapes that escape.
 */
const FILENAME_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Read a record FROM THE COMMITTED BLOB at HEAD, never from the working tree.
 *
 * "Is it committed?" and "what does it say?" have to be the same question. Checking that a path
 * exists at HEAD and then reading the working-tree file answers them separately, so an innocuous
 * record could be committed while a different one sat on disk — and the second is the one that would
 * be believed. `git show` also returns the blob as stored, so a checkout's line-ending conversion
 * cannot change what was reviewed. Null means "not committed, or unreadable", which fails closed.
 */
function readCommittedJson(sys: System, relPath: string): Record<string, unknown> | null {
  const r = sys.exec('git', ['show', `HEAD:${relPath}`]);
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

  // RECOMPUTE, don't read. The stored draft is a file; what matters is what this repository proposes
  // right now. Everything downstream is checked against the recomputed digest.
  const engine = loadDiscoveryEngine();
  const proposal = buildProposal(sys, root, engine);
  if (!proposal.ok) return { ok: false, code: 'PROPOSAL_FAILED', problems: [`${proposal.code}: ${proposal.detail}`] };

  if (typeof draft.planDigest !== 'string') {
    return {
      ok: false,
      code: 'DRAFT_SUPERSEDED',
      problems: [`draft '${opts.draftId}' records no plan digest — it predates the approval mechanism. Regenerate it.`],
    };
  }
  if (draft.planDigest !== proposal.planDigest) {
    return {
      ok: false,
      code: 'DRAFT_SUPERSEDED',
      problems: [
        `the stored draft proposes plan material ${draft.planDigest.slice(7, 19)}, but this repository now ` +
          `proposes ${proposal.planDigest.slice(7, 19)}. Regenerate the draft and obtain a decision on the new one.`,
      ],
    };
  }

  // The active approved plan is the only place the owner's identity is recorded by owner authority.
  const declaredPlan = (config['planMemory'] as Record<string, unknown> | undefined)?.['planPath'];
  const activePlan = typeof declaredPlan === 'string' ? readJson(sys, join(root, declaredPlan)) : null;
  const recordedOwner = strOf((activePlan?.['governance'] as Record<string, unknown> | undefined)?.['owner']);
  if (activePlan === null || recordedOwner === null) {
    return {
      ok: false,
      code: 'NO_ACTIVE_PLAN',
      problems: [
        'this project has no active approved plan recording an owner, so there is nothing against which to check ' +
          'who may approve a new one',
      ],
    };
  }

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
  const delegationRel = `.projectops/authority/plan-approval-delegation.json`;
  const delegation = readCommittedJson(sys, delegationRel);
  const delegationProblems =
    (delegation === null ? uncommittedButPresent(sys, root, delegationRel, 'delegation') : null) ??
    checkPlanApprovalDelegation(delegation, {
      projectId: proposal.projectId,
      recordedOwner,
      isCommitted: delegation !== null,
    });
  if (delegationProblems.length > 0) return { ok: false, code: 'DELEGATION_INVALID', problems: delegationProblems };
  const expectedDecider = String((delegation as PlanApprovalDelegationRecord).delegatedTo);

  const decisionRel = `.projectops/plan-decisions/${opts.decisionId}.json`;
  const decision = readCommittedJson(sys, decisionRel);
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
  const closureDelegation = readCommittedJson(sys, closureRel);
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
    delegation: delegation as PlanApprovalDelegationRecord,
    closureDelegation,
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

/**
 * Governed project context: the single gate every governed PHASE mutation passes through.
 *
 * Before ProjectOS creates or advances a phase against a project, it must know that the project in
 * front of it is the project the approved plan is for. Location is not identity: the CLI is
 * cwd-rooted, so it will happily read whatever `.projectops` it is standing in. That stops you
 * addressing another project's state by accident; it does NOT stop a plan for project A governing
 * work in project B, because nothing compared the two.
 *
 * Found by PROJECTOS-V3-POLYGO-PILOT1A (Phase 16). `evaluatePlanReady` does not check project
 * identity either — a schema-valid plan naming a different project evaluates READY — so neither
 * layer caught it. This is where the comparison belongs: once, on the way into governed execution.
 *
 * REUSE, NOT REIMPLEMENTATION. Schema validation and readiness are the existing engines in
 * `projectos/validators/plan-governance-engine.cjs`, resolved relative to THIS package's own
 * location, never to the caller's cwd — so the same engines apply when the CLI drives an external
 * project. No JSON parsing, schema logic, readiness logic or identity logic is duplicated here.
 */
import { randomBytes } from 'node:crypto';
import { governanceEngines } from './governanceEngines.js';
import type { System } from './system.js';
import { join, projectopsDir, configPath, type CommandContext } from './context.js';
import {
  admitEnvelope,
  mintCrossing,
  mintEnvelope,
  parseProjectConfig,
  isGenuineClosure,
  recordExecution,
  type ActionRegistry,
  type CrossingRequest,
  type EnvelopeAdmission,
  type EnvelopeGrantPort,
  type EnvelopeRecorder,
  type EnvelopeResult,
  type ProjectConfig,
  type ClosureDecisionRecord,
  type ClosureAuthorityExpectations,
  type Role,
  type TaskEnvelope,
  type TenantBinding,
  type TenantRegistry,
} from '@projectos/core';
import { loadPhase, listPhaseIds } from './phaseStore.js';
import {
  NO_GRANT,
  claimIdempotencyKey,
  envelopeRecorder,
  readCommittedActionRegistry,
  readCommittedTenantRegistry,
  receiptRefusal,
  resolveCheckout,
  type TenantRefusal,
  type TenantSource,
} from './installation/tenantRegistry.js';
import { nodeProjectosRuntime } from './nodeRuntimeRoot.js';
// A CYCLE, AND A SAFE ONE: `platformStop.ts` imports `loadGovernedContext`, and this imports where the
// stop's verified state directory is. Both are only ever CALLED, never read at load time.
import { platformStopDirOf } from './loop/platformStop.js';

/** Plan location when the config declares none. Unchanged default — existing installs are untouched. */
export const DEFAULT_PLAN_RELPATH = '.projectops/plan.json';

/** Why a governed context was refused. Deterministic — callers and tests match on the code. */
export type GovernedContextRefusal =
  | 'NO_CONFIG'
  | 'MALFORMED_CONFIG'
  | 'INVALID_CONFIG'
  | 'INVALID_PLAN_MEMORY_PATH'
  | 'NO_PLAN'
  | 'MALFORMED_PLAN'
  | 'PLAN_SCHEMA_INVALID'
  | 'WRONG_PROJECT'
  | 'PLAN_NOT_READY';

export interface GovernedContext {
  readonly config: ProjectConfig;
  readonly plan: Record<string, unknown>;
  readonly projectId: string;
  /** The plan file this context was actually governed from — default or config-declared. */
  readonly planPath: string;
  /** Config-declared current-state record, when one is declared. Null otherwise. */
  readonly currentStatePath: string | null;
}

export type GovernedContextResult =
  | { readonly ok: true; readonly context: GovernedContext }
  | { readonly ok: false; readonly code: GovernedContextRefusal; readonly detail: string };

/** The engine + schema live beside this package inside the ProjectOS repository, not in the target
 *  project. Resolved from this module's own URL so the target root cannot redirect them. */
interface PlanEngine {
  validateAgainstSchema(obj: unknown, schema: unknown): readonly string[];
  evaluatePlanReady(plan: unknown): { readonly ready: boolean; readonly reasons: readonly string[] };
  isSafeRepoRelativePath(p: unknown): boolean;
}

function loadEngine(): { engine: PlanEngine; schema: unknown } {
  const { governance, planSchema } = governanceEngines();
  return { engine: governance, schema: planSchema };
}

function readJson(sys: System, path: string): { ok: true; value: unknown } | { ok: false } {
  const text = sys.readText(path);
  if (text === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Load and verify the governed context for `root`. Returns a refusal — it never throws and never
 * mutates anything, so a caller that checks the result before acting cannot produce a side effect
 * from an invalid context.
 *
 * Order matters: identity is compared BEFORE readiness, so a plan for the wrong project is refused
 * as WRONG_PROJECT rather than being let through on the strength of being internally valid.
 */
/**
 * Resolve a config-declared, project-root-relative path. Anything that could address a file outside
 * the project — absolute, drive-qualified, rooted or containing `..` — is refused, so a config can
 * never point governance at another project's plan. The safety predicate is the engine's, reused.
 *
 * The check is LEXICAL. A symlink planted inside the project could still resolve outside it, and
 * that is not detected here: `System` exposes no realpath, and the pre-existing default
 * `.projectops/plan.json` has carried exactly the same exposure since it was introduced. Planting
 * the symlink already requires local write access to the repository, so this is defence-in-depth,
 * not the boundary itself — recorded rather than silently assumed away. Raised as M1 by the
 * bootstrap security review and carried to PROJECTOS-V3-RELIABILITY-HARDENING1A.
 */
function resolveWithinRoot(
  engine: PlanEngine,
  root: string,
  rel: string,
  field: string,
): { ok: true; path: string } | { ok: false; detail: string } {
  if (!engine.isSafeRepoRelativePath(rel)) {
    return { ok: false, detail: `${field} '${rel}' is not a safe project-relative path (absolute, drive-qualified, rooted or traversing paths are refused)` };
  }
  return { ok: true, path: join(root, rel) };
}

export function loadGovernedContext(sys: System, root: string): GovernedContextResult {
  const cfgPath = configPath(root);
  const cfgRaw = sys.readText(cfgPath);
  if (cfgRaw === null) return { ok: false, code: 'NO_CONFIG', detail: `No config at ${cfgPath}` };
  const cfgJson = readJson(sys, cfgPath);
  if (!cfgJson.ok) return { ok: false, code: 'MALFORMED_CONFIG', detail: `${cfgPath}: invalid JSON` };
  const cfg = parseProjectConfig(cfgJson.value);
  if (!cfg.ok) return { ok: false, code: 'INVALID_CONFIG', detail: cfg.error };

  const { engine, schema } = loadEngine();

  // Plan location: the default unless this project declares its own. Declaring one is how a project
  // whose approved plan already lives under version control (ProjectOS itself) is governed from that
  // single record instead of a second copy under .projectops.
  const declaredPlan = cfg.value.planMemory?.planPath;
  let pPath = join(root, DEFAULT_PLAN_RELPATH);
  if (declaredPlan !== undefined) {
    const r = resolveWithinRoot(engine, root, declaredPlan, 'planMemory.planPath');
    if (!r.ok) return { ok: false, code: 'INVALID_PLAN_MEMORY_PATH', detail: r.detail };
    pPath = r.path;
  }

  let statePath: string | null = null;
  const declaredState = cfg.value.planMemory?.currentStatePath;
  if (declaredState !== undefined) {
    const r = resolveWithinRoot(engine, root, declaredState, 'planMemory.currentStatePath');
    if (!r.ok) return { ok: false, code: 'INVALID_PLAN_MEMORY_PATH', detail: r.detail };
    statePath = r.path;
  }

  const planRaw = sys.readText(pPath);
  if (planRaw === null) {
    return {
      ok: false,
      code: 'NO_PLAN',
      detail: `No approved plan at ${pPath}. Governed phase work requires plan memory; run plan discovery/import and obtain owner approval first.`,
    };
  }
  const planJson = readJson(sys, pPath);
  if (!planJson.ok) return { ok: false, code: 'MALFORMED_PLAN', detail: `${pPath}: invalid JSON` };
  const plan = planJson.value as Record<string, unknown>;

  const schemaErrors = engine.validateAgainstSchema(plan, schema);
  if (schemaErrors.length > 0) {
    return { ok: false, code: 'PLAN_SCHEMA_INVALID', detail: schemaErrors.slice(0, 3).join('; ') };
  }

  // Identity before readiness. A plan can be perfectly valid and perfectly ready FOR ANOTHER
  // PROJECT; that is exactly the case this gate exists to refuse.
  const planProject = plan['projectId'];
  if (planProject !== cfg.value.projectId) {
    return {
      ok: false,
      code: 'WRONG_PROJECT',
      detail: `project identity mismatch: plan is for '${String(planProject)}', this project is '${cfg.value.projectId}'`,
    };
  }

  // The stored planStatus string is never trusted. Readiness is recomputed by the real evaluator.
  const readiness = engine.evaluatePlanReady(plan);
  if (!readiness.ready) {
    return {
      ok: false,
      code: 'PLAN_NOT_READY',
      detail: `plan is not READY (${readiness.reasons.length} unmet): ${readiness.reasons.slice(0, 3).join('; ')}`,
    };
  }

  return {
    ok: true,
    context: {
      config: cfg.value,
      plan,
      projectId: cfg.value.projectId,
      planPath: pPath,
      currentStatePath: statePath,
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Approved-phase membership and dependency enforcement.
 *
 * A governed context proves WHICH project and THAT its plan is ready. It does not prove that the
 * phase being started is a phase the owner approved, nor that the work it depends on is done. Those
 * are separate facts and must be established before a phase record exists — a refusal issued after
 * the record was written is not a gate.
 * ---------------------------------------------------------------------------------------------- */

export type PhaseAuthorisationRefusal = 'PHASE_NOT_AUTHORISED' | 'DEPENDENCY_NOT_SATISFIED';

/**
 * A phase as the ACTIVE APPROVED PLAN describes it. `description` is the owner-approved statement of
 * what the phase is for, and it is returned to callers because the alternative — resolving the plan
 * phase here to authorise it and then letting the caller invent its own content — is how
 * `"objective": "<objective>"` reached a durable governed record.
 */
export interface AuthorisedPlanPhase {
  readonly phaseId: string;
  readonly description?: string;
  readonly dependsOn?: readonly string[];
  readonly requiredValidators?: readonly string[];
}

export type PhaseAuthorisationResult =
  | { readonly ok: true; readonly planPhase: AuthorisedPlanPhase }
  | { readonly ok: false; readonly code: PhaseAuthorisationRefusal; readonly detail: string };

type PlanPhase = AuthorisedPlanPhase;

function planPhases(plan: Record<string, unknown>): readonly PlanPhase[] {
  const raw = plan['phases'];
  return Array.isArray(raw) ? (raw as readonly PlanPhase[]) : [];
}

/**
 * Does a durable phase record show a real, owner-gated closure — not merely the word "closed"?
 *
 * The status field alone is a claim. `transitionPhase` refuses a move to `closed` from any role but
 * owner, so a genuine record ALWAYS carries a final history entry `-> closed by owner`; a record
 * hand-written to say `closed` normally does not. Requiring the history means dependency evidence
 * has to match the lifecycle the engine actually enforces, instead of a string anyone can type.
 *
 * This is not tamper-proofing and is not claimed as such: anything that can write the record can
 * also write a plausible history entry. ProjectOS's governance is `MANUAL_GOVERNANCE_APPROVAL` with
 * `tamperProof: false` throughout — the real backstop for a forged record is the owner commit/push
 * gate, where the forgery is a visible diff. Raised by the bootstrap security review as H1.
 */
function isOwnerClosed(
  p: { readonly phaseId?: string; readonly status: string; readonly history?: readonly { readonly to: string; readonly by: string }[] },
  decision: ClosureDecisionRecord | null,
  expect: ClosureAuthorityExpectations,
): boolean {
  return isGenuineClosure(p as never, decision, expect);
}


/**
 * Phases this project records as COMPLETE, from the sources the architecture already treats as
 * authoritative — no second completion ledger is introduced:
 *
 *  1. durable phase records the runtime itself wrote, closed BY THE OWNER (see `isOwnerClosed`);
 *     `closed_as_blocked` is deliberately excluded, because blocked is not done;
 *  2. the project's current-state record, when the config declares one. ProjectOS's own numbered
 *     phases were closed by owner/gatekeeper decision long before this runtime existed, so their
 *     only durable record is current-state; refusing to read it would make the roadmap unstartable.
 *
 * A declared-but-unreadable current-state contributes nothing, which fails CLOSED: dependencies
 * simply go unsatisfied, and the caller reports why.
 */
function completedPhases(
  sys: System,
  root: string,
  context: GovernedContext,
): { readonly ids: ReadonlySet<string>; readonly stateProblem: string | null } {
  const ids = new Set<string>();
  // The authority the ACTIVE PLAN records, read once. A closure is judged against the plan's own
  // owner and delegate, never against whatever the phase record says about itself.
  const gov = (context.plan['governance'] as Record<string, unknown> | undefined) ?? {};
  const del = gov['closureDelegation'] as Record<string, unknown> | undefined;
  const expectBase = {
    projectId: context.projectId,
    owner: typeof gov['owner'] === 'string' ? gov['owner'] : '',
    delegate: del !== undefined && typeof del['delegatedTo'] === 'string' ? del['delegatedTo'] : null,
  };
  for (const id of listPhaseIds(sys, root)) {
    const p = loadPhase(sys, root, id);
    if (p === null) continue;
    // The DECISION that authorised the closure, from its one canonical location. A closure that
    // cannot produce it is not evidence of anything, however the record describes itself.
    const decision = readJson(sys, join(projectopsDir(root), 'closure', 'decisions', `${p.phaseId}.json`));
    if (isOwnerClosed(p, decision.ok ? (decision.value as ClosureDecisionRecord) : null, { ...expectBase, phaseId: p.phaseId })) {
      ids.add(p.phaseId);
    }
  }

  let stateProblem: string | null = null;
  if (context.currentStatePath !== null) {
    const parsed = readJson(sys, context.currentStatePath);
    if (!parsed.ok) {
      stateProblem = `declared current-state at ${context.currentStatePath} is missing or not valid JSON`;
    } else {
      const done = (parsed.value as Record<string, unknown>)['completedPhases'];
      if (!Array.isArray(done)) {
        stateProblem = `declared current-state at ${context.currentStatePath} has no completedPhases array`;
      } else {
        for (const id of done) if (typeof id === 'string') ids.add(id);
      }
    }
  }
  return { ids, stateProblem };
}

/**
 * The completion set, exposed for callers that must reason about the WHOLE plan rather than one
 * phase — the execution loop's phase selection, above all.
 *
 * It is deliberately the same function `authorisePhase` uses. A loop that decided completeness its
 * own way would be a second completion ledger disagreeing with the gate that admits phases, and the
 * first symptom would be a loop starting a phase the gate then refuses.
 */
export function completedPhaseIds(
  sys: System,
  root: string,
  context: GovernedContext,
): { readonly ids: ReadonlySet<string>; readonly stateProblem: string | null } {
  return completedPhases(sys, root, context);
}

/**
 * The phases of the active approved plan, in the order the plan declares them. Exposed for the same
 * reason as `completedPhaseIds`: the loop must not re-parse the plan its own way.
 */
export function approvedPlanPhases(context: GovernedContext): readonly AuthorisedPlanPhase[] {
  return planPhases(context.plan);
}

/**
 * Prove that `phaseId` is a phase of the ACTIVE APPROVED PLAN and that every phase it depends on is
 * recorded complete. Call it before any state is written. It never mutates and never throws.
 *
 * Scope note: this gates phase CREATION. It deliberately does not re-adjudicate phases that already
 * exist — re-litigating an accepted historical closure (ProjectOS's own Phase 13, closed ahead of
 * Phase 12 under the recorded later-authority exception) is not this gate's job.
 */
export function authorisePhase(
  sys: System,
  root: string,
  context: GovernedContext,
  phaseId: string,
): PhaseAuthorisationResult {
  const phases = planPhases(context.plan);
  const target = phases.find((p) => p.phaseId === phaseId);
  if (target === undefined) {
    return {
      ok: false,
      code: 'PHASE_NOT_AUTHORISED',
      detail: `phase '${phaseId}' is not in the approved plan (${context.planPath}, ${phases.length} approved phase(s)). Only an owner-approved phase can be started.`,
    };
  }

  const deps = Array.isArray(target.dependsOn) ? target.dependsOn : [];
  if (deps.length === 0) return { ok: true, planPhase: target };

  const { ids, stateProblem } = completedPhases(sys, root, context);
  const unmet = deps.filter((d) => !ids.has(d));
  if (unmet.length > 0) {
    const why = stateProblem === null ? '' : ` (${stateProblem})`;
    return {
      ok: false,
      code: 'DEPENDENCY_NOT_SATISFIED',
      detail: `phase '${phaseId}' depends on ${deps.length} phase(s); ${unmet.length} not recorded complete: ${unmet.join(', ')}${why}`,
    };
  }
  return { ok: true, planPhase: target };
}

/** Render a phase-authorisation refusal for the CLI, in the same shape as a context refusal. */
export function authorisationRefusalLines(
  r: Extract<PhaseAuthorisationResult, { ok: false }>,
): readonly string[] {
  return [`REFUSED (${r.code}): ${r.detail}`];
}

/** Render a refusal for the CLI. Kept here so every command refuses in the same words. */
export function refusalLines(r: Extract<GovernedContextResult, { ok: false }>): readonly string[] {
  return [`REFUSED (${r.code}): ${r.detail}`];
}

/* -------------------------------------------------------------------------------------------------
 * THE TENANT (PROJECTOS-TENANT-PRINCIPAL1A, ADR-T1).
 *
 * `loadGovernedContext` proves which project and that its plan is ready. This proves whose work it is,
 * and it is a separate question: a project with no ready plan still has a tenant, and a project that
 * is not in the registry may have a perfectly ready plan.
 *
 * DERIVED, NEVER SUPPLIED (R2). Everything below reads the committed installation records, the
 * project's own id, and git. No function here takes a tenant, reads a flag, or reads an environment
 * variable by name, and a cloud login reaches none of it.
 *
 * MINTED WHERE A TENANT CAN BE CROSSED, THROUGH THE CORE'S DOOR. `run-start`, `project-selection` and
 * `bridge-read` are minted and admitted here with a real recorder. `principal` and `actor` are stated by
 * this code: a run is the implementer's, a read is the advisor's, and the actor is the kernel itself,
 * because at a boundary no worker has started. `--as` is never read.
 *
 * THE ADMITTED RUN STAYS, FOR THIS PROCESS. `mintCrossing` needs a live admitted envelope, and the door's
 * mark lives in memory, so the entry refusal keeps what it admitted against the context it was given.
 * `admittedRunEnvelopeOf` reads it and `mintRunCrossing` is the one route from it to a crossing.
 *
 * WHAT THIS STILL DOES NOT DO. `run-start` gets no execution line, because `commands/run.ts` holds one
 * entry refusal and no more (delta Zone 3). Its budget is zero, so `mintCrossing` would refuse a paid
 * crossing from it. The checkout is whichever one the process stands in: the tenant is derived, but which
 * work is bound is decided by where the process started. And the admitted run does not survive the
 * process. All three are binding on CREDENTIALS1A, in this phase's evidence.
 * ---------------------------------------------------------------------------------------------- */

/** Stated by the kernel. At a boundary no worker has started, so the kernel is what is acting. */
const KERNEL_ACTOR = Object.freeze({ agent: 'projectos-kernel', provider: 'projectos', model: 'none' });

/** Every root envelope expires. A long governed run, and the moment around a read. */
export const RUN_ENVELOPE_WINDOW_MS = 12 * 60 * 60_000;
export const READ_ENVELOPE_WINDOW_MS = 5 * 60_000;

/**
 * Which installation answers for this context.
 *
 * THE INSTALLATION'S OWN LOCATION, NOT THE PROJECT'S. A governed project cannot choose its tenant
 * registry, so the root comes from the running code's own module path, and the state directory is the
 * platform stop's, which the operating system must agree with: one environment variable cannot point
 * this at a forged receipt. `tenantInstallRoot` follows `platformStopInstallRoot`: reachable only from
 * inside this process, set by tests and by the packaged sidecar's bound system root.
 */
export function tenantSourceOf(ctx: object): TenantSource {
  const named = (ctx as { readonly tenantInstallRoot?: unknown }).tenantInstallRoot;
  return {
    installRoot: typeof named === 'string' && named.trim() !== '' ? named : nodeProjectosRuntime().installRoot,
    stateDir: platformStopDirOf(ctx),
  };
}

export interface InstallationRegistries {
  readonly ok: true;
  readonly registry: TenantRegistry;
  readonly actions: ActionRegistry;
  readonly blob: string;
  readonly commit: string;
}

export interface DerivedTenant extends InstallationRegistries {
  readonly binding: TenantBinding;
}

export type TenantDerivation = DerivedTenant | TenantRefusal;

/** Both committed registries, each judged whole, before anything is matched. */
export function readInstallationRegistries(sys: System, installRoot: string): InstallationRegistries | TenantRefusal {
  const tenants = readCommittedTenantRegistry(sys, installRoot);
  if (!tenants.ok) return tenants;
  const actions = readCommittedActionRegistry(sys, installRoot);
  if (!actions.ok) return actions;
  return { ok: true, registry: tenants.registry, actions: actions.actions, blob: tenants.blob, commit: tenants.commit };
}

/** This checkout, against registries already judged whole. The owner receipt is not asked here. */
export function bindCheckout(sys: System, root: string, projectId: string, registries: InstallationRegistries): TenantDerivation {
  const resolved = resolveCheckout(sys, registries.registry, root, projectId);
  return resolved.ok ? { ...registries, binding: resolved.binding } : { ok: false, code: resolved.code, reasons: resolved.reasons };
}

/** The whole derivation, in order: the file, then the owner, then the match. */
export function deriveTenant(sys: System, root: string, projectId: string, source: TenantSource): TenantDerivation {
  const registries = readInstallationRegistries(sys, source.installRoot);
  if (!registries.ok) return registries;
  const unconfirmed = receiptRefusal(sys, source, registries.blob);
  if (unconfirmed !== null) return unconfirmed;
  return bindCheckout(sys, root, projectId, registries);
}

/** The project's own id, from its own file: a claim until `deriveTenant` agrees. `null` when there is none. */
export function declaredProjectId(sys: System, root: string): string | null {
  const parsed = readJson(sys, configPath(root));
  if (!parsed.ok) return null;
  const config = parseProjectConfig(parsed.value);
  return config.ok ? config.value.projectId : null;
}

/** `deriveTenant` for the project standing at `root`. No plan is needed: a tenant is not a readiness. */
export function deriveProjectTenant(sys: System, root: string, source: TenantSource): TenantDerivation {
  const projectId = declaredProjectId(sys, root);
  if (projectId === null) {
    return { ok: false, code: 'TENANT_UNKNOWN', reasons: [`${root} has no readable project configuration, so it names no project`] };
  }
  return deriveTenant(sys, root, projectId, source);
}

/** Render a tenant refusal. Every command refuses in the same words. */
export function tenantRefusalLines(r: TenantRefusal): readonly string[] {
  const [first, ...rest] = r.reasons;
  return [`REFUSED (${r.code}): ${first ?? 'no tenant can be derived'}`, ...rest.map((reason) => `  ${reason}`)];
}

/** R4 for a refusal with no envelope: the door writes the line. `false` means it was not written. */
export function recordTenantRefusal(sys: System, stateDir: string | null, r: TenantRefusal): boolean {
  const reasons = r.reasons.map((reason) => `${r.code}: ${reason}`);
  const door = admitEnvelope({ ok: false, rule: 'R2', reasons }, sys.now(), envelopeRecorder(sys, stateDir), NO_GRANT);
  return !door.admitted && door.recorded;
}

/** What is shown when a refusal could not be written down. The operation is stopped either way. */
export const REFUSAL_NOT_RECORDED_LINE = '  REFUSAL_NOT_RECORDED: no line in the installation state says this happened; the operation is stopped';

/** A record's lock left by a process that died holds every later line, and only a person may clear it. */
const RECORD_LOCK_HINT = '  if no other ProjectOS process is running, a .jsonl.lock file in the installation state was left by one that died and must be removed';

function recordedRefusalLines(sys: System, source: TenantSource, r: TenantRefusal): readonly string[] {
  const recorded = recordTenantRefusal(sys, source.stateDir, r);
  return recorded ? tenantRefusalLines(r) : [...tenantRefusalLines(r), REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT];
}

/** What the door refused, in the CLI's words. An admission that could not be written has its own name. */
export function admissionRefusalLines(admission: Extract<EnvelopeAdmission, { admitted: false }>): readonly string[] {
  const code = admission.rule === 'R4' ? 'ENVELOPE_NOT_RECORDED' : `ENVELOPE_${admission.rule}`;
  const [first, ...rest] = admission.reasons;
  return [
    `REFUSED (${code}): ${first ?? 'the door refused this'}`,
    ...rest.map((reason) => `  ${reason}`),
    ...(admission.recorded ? [] : [REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT]),
  ];
}

function newEnvelopeId(): string {
  return `ENV-${randomBytes(12).toString('hex')}`;
}

/** `''` for a clock that cannot be read, which the envelope then refuses under R1. */
function instantAfter(now: string, windowMs: number): string {
  const at = Date.parse(now);
  return Number.isNaN(at) ? '' : new Date(at + windowMs).toISOString();
}

/** The commit this checkout stands on: what a boundary acts on. `''` refuses under R1. */
export function checkoutSubject(sys: System, root: string): string {
  const head = sys.exec('git', ['-C', root, 'rev-parse', '--verify', 'HEAD']);
  return head.code === 0 ? head.stdout.trim() : '';
}

export interface BoundaryRequest {
  readonly action: string;
  readonly principal: Role;
  readonly subjectHash: string;
  readonly scope: readonly string[];
  readonly windowMs: number;
  readonly intentScope: string;
}

/** Mint through the core and pass the door, with the durable recorder. Nothing else admits a crossing. */
export function admitBoundary(
  sys: System,
  stateDir: string | null,
  derived: DerivedTenant,
  request: BoundaryRequest,
  grant: EnvelopeGrantPort = NO_GRANT,
  recorder: EnvelopeRecorder = envelopeRecorder(sys, stateDir),
): EnvelopeAdmission {
  const now = sys.now();
  const minted = mintEnvelope(
    { binding: derived.binding, registry: derived.actions, principal: request.principal, actor: KERNEL_ACTOR, envelopeId: newEnvelopeId() },
    {
      action: request.action,
      subjectHash: request.subjectHash,
      scope: request.scope,
      budget: 0,
      expiry: instantAfter(now, request.windowMs),
      intentScope: request.intentScope,
    },
  );
  return admitEnvelope(minted, now, recorder, grant);
}

/** What each context's entry refusal admitted. The door's mark is in memory, so this is too. */
const ADMITTED_RUNS = new WeakMap<object, { readonly envelope: TaskEnvelope; readonly derived: DerivedTenant }>();

/** The run this context admitted, or `null`. A dry run, a refused run and another context hold none. */
export function admittedRunEnvelopeOf(ctx: CommandContext): TaskEnvelope | null {
  return ADMITTED_RUNS.get(ctx)?.envelope ?? null;
}

/** A boundary crossing tied to this context's admitted run. It still has to pass the door. */
export function mintRunCrossing(ctx: CommandContext, request: CrossingRequest): EnvelopeResult {
  const admitted = ADMITTED_RUNS.get(ctx);
  if (admitted === undefined) return { ok: false, rule: 'RUN_LINK', reasons: ['this context admitted no run, so it can link nothing'] };
  const { envelope, derived } = admitted;
  return mintCrossing(
    { binding: derived.binding, registry: derived.actions, principal: envelope.principal, actor: KERNEL_ACTOR, envelopeId: newEnvelopeId() },
    request,
    envelope,
    ctx.sys.now(),
  );
}

/**
 * The one refusal at the top of `projectos run`, or `null`.
 *
 * A DRY RUN WRITES NOTHING, so it derives and refuses and mints nothing: it is not a run starting.
 * `--execute` is. Its envelope is recorded at admission, and the idempotency key counts the attempt.
 * The same key means the same HEAD, and a run that did its work moved HEAD, so a repeat here is a retry.
 */
export function runStartTenantRefusal(ctx: CommandContext, execute: boolean): readonly string[] | null {
  const { sys, root } = ctx;
  ADMITTED_RUNS.delete(ctx);
  const source = tenantSourceOf(ctx);
  const derived = deriveProjectTenant(sys, root, source);
  if (!derived.ok) return execute ? recordedRefusalLines(sys, source, derived) : tenantRefusalLines(derived);
  if (!execute) return null;
  const admission = admitBoundary(sys, source.stateDir, derived, {
    action: 'run-start',
    principal: 'implementer',
    subjectHash: checkoutSubject(sys, root),
    scope: [`project:${derived.binding.projectId}`],
    windowMs: RUN_ENVELOPE_WINDOW_MS,
    intentScope: 'governed-run',
  });
  if (!admission.admitted) return admissionRefusalLines(admission);
  const claim = claimIdempotencyKey(sys, source.stateDir, admission.envelope, sys.now(), { retryUnsettled: true });
  if (claim.kind !== 'first' && claim.kind !== 'retry') {
    const rule = claim.kind === 'duplicate' ? 'ENVELOPE_DUPLICATE' : 'IDEMPOTENCY_UNAVAILABLE';
    const why = claim.kind === 'duplicate' ? `this run already ended as '${claim.earlier.outcome}' at this commit` : claim.why;
    const stopped = recordExecution(admission.envelope, 'refused', rule, sys.now(), envelopeRecorder(sys, source.stateDir));
    return [`REFUSED (${rule}): ${why}`, ...(stopped ? [] : [REFUSAL_NOT_RECORDED_LINE, RECORD_LOCK_HINT])];
  }
  ADMITTED_RUNS.set(ctx, { envelope: admission.envelope, derived });
  return null;
}

/**
 * Selecting a project in the Control Center: a P1 crossing, recorded both ways. The kernel cannot show who
 * is at the surface, so the principal is the advisor, which is what a read needs, and everyone gets the
 * same answer.
 */
export function projectSelectionRefusal(ctx: CommandContext): readonly string[] | null {
  const { sys, root } = ctx;
  const source = tenantSourceOf(ctx);
  const derived = deriveProjectTenant(sys, root, source);
  if (!derived.ok) return recordedRefusalLines(sys, source, derived);
  const admission = admitBoundary(sys, source.stateDir, derived, {
    action: 'project-selection',
    principal: 'advisor',
    subjectHash: checkoutSubject(sys, root),
    scope: [`project:${derived.binding.projectId}`],
    windowMs: READ_ENVELOPE_WINDOW_MS,
    intentScope: 'control-center-selection',
  });
  if (!admission.admitted) return admissionRefusalLines(admission);
  const recorded = recordExecution(admission.envelope, 'allowed', null, sys.now(), envelopeRecorder(sys, source.stateDir));
  return recorded ? null : ['REFUSED (ENVELOPE_NOT_RECORDED): the selection could not be recorded, so it did not happen.'];
}

/** Verbs that cannot act on a project, or must always work. Everything else needs a tenant. */
export const CONTROL_CENTER_VERBS_WITHOUT_TENANT: readonly string[] = ['refresh', 'project.select', 'run.stop'];

/**
 * The Control Center's other verbs, on the project already selected. A remembered selection is restored
 * at start with no `project.select`, so the tenant is asked again here. These verbs are not enveloped
 * yet (ADR-T1 §4); this only refuses a project with no tenant.
 */
export function controlCenterTenantRefusal(ctx: CommandContext, verb: string): readonly string[] | null {
  if (CONTROL_CENTER_VERBS_WITHOUT_TENANT.includes(verb)) return null;
  const source = tenantSourceOf(ctx);
  const derived = deriveProjectTenant(ctx.sys, ctx.root, source);
  return derived.ok ? null : recordedRefusalLines(ctx.sys, source, derived);
}

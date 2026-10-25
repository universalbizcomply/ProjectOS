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
import { governanceEngines } from './governanceEngines.js';
import type { System } from './system.js';
import { join, projectopsDir, configPath } from './context.js';
import {
  parseProjectConfig,
  isGenuineClosure,
  type ProjectConfig,
  type ClosureDecisionRecord,
  type ClosureAuthorityExpectations,
} from '@projectos/core';
import { loadPhase, listPhaseIds } from './phaseStore.js';

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

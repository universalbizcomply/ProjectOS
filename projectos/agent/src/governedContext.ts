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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { System } from './system.js';
import { join, projectopsDir, configPath } from './context.js';
import { parseProjectConfig, type ProjectConfig } from '@projectos/core';

export function planPath(root: string): string {
  return join(projectopsDir(root), 'plan.json');
}

/** Why a governed context was refused. Deterministic — callers and tests match on the code. */
export type GovernedContextRefusal =
  | 'NO_CONFIG'
  | 'MALFORMED_CONFIG'
  | 'INVALID_CONFIG'
  | 'NO_PLAN'
  | 'MALFORMED_PLAN'
  | 'PLAN_SCHEMA_INVALID'
  | 'WRONG_PROJECT'
  | 'PLAN_NOT_READY';

export interface GovernedContext {
  readonly config: ProjectConfig;
  readonly plan: Record<string, unknown>;
  readonly projectId: string;
}

export type GovernedContextResult =
  | { readonly ok: true; readonly context: GovernedContext }
  | { readonly ok: false; readonly code: GovernedContextRefusal; readonly detail: string };

/** The engine + schema live beside this package inside the ProjectOS repository, not in the target
 *  project. Resolved from this module's own URL so the target root cannot redirect them. */
interface PlanEngine {
  validateAgainstSchema(obj: unknown, schema: unknown): readonly string[];
  evaluatePlanReady(plan: unknown): { readonly ready: boolean; readonly reasons: readonly string[] };
}

function loadEngine(): { engine: PlanEngine; schema: unknown } {
  const require_ = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const engine = require_(resolve(here, '../../validators/plan-governance-engine.cjs')) as PlanEngine;
  const schema = require_(resolve(here, '../../schemas/project-plan.schema.json')) as unknown;
  return { engine, schema };
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
export function loadGovernedContext(sys: System, root: string): GovernedContextResult {
  const cfgPath = configPath(root);
  const cfgRaw = sys.readText(cfgPath);
  if (cfgRaw === null) return { ok: false, code: 'NO_CONFIG', detail: `No config at ${cfgPath}` };
  const cfgJson = readJson(sys, cfgPath);
  if (!cfgJson.ok) return { ok: false, code: 'MALFORMED_CONFIG', detail: `${cfgPath}: invalid JSON` };
  const cfg = parseProjectConfig(cfgJson.value);
  if (!cfg.ok) return { ok: false, code: 'INVALID_CONFIG', detail: cfg.error };

  const pPath = planPath(root);
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

  const { engine, schema } = loadEngine();
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

  return { ok: true, context: { config: cfg.value, plan, projectId: cfg.value.projectId } };
}

/** Render a refusal for the CLI. Kept here so every command refuses in the same words. */
export function refusalLines(r: Extract<GovernedContextResult, { ok: false }>): readonly string[] {
  return [`REFUSED (${r.code}): ${r.detail}`];
}

/**
 * Governed context gate — project identity and plan readiness before any governed phase mutation.
 *
 * Found by PROJECTOS-V3-POLYGO-PILOT1A: the CLI is cwd-rooted, so it read whatever `.projectops`
 * it stood in and never compared the plan's project to the config's. `evaluatePlanReady` does not
 * check identity either, so a schema-valid plan naming another project evaluated READY and neither
 * layer refused it.
 *
 * Every negative asserts BOTH the refusal AND that nothing was written — a refusal after mutation
 * would not be a gate.
 */
import { describe, it, expect } from 'vitest';
import { loadGovernedContext } from '../src/governedContext.js';
import { phase } from '../src/commands/phase.js';
import type { System } from '../src/system.js';

const VALID_CONFIG = {
  projectId: 'projectos',
  projectName: 'ProjectOS',
  projectType: 'saas',
  owner: 'Murad',
  repo: 'universalbizcomply/ProjectOS',
  localPath: 'C:/dev/ProjectOS',
  protectedBranches: ['main'],
  productionFreeze: true,
  allowedActions: ['create-local-files'],
  forbiddenActions: ['production-deploy'],
  approvalGates: ['phase-closure'],
  secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
  validators: ['validators/val-*.cjs'],
  evidenceRequirements: ['evidence-pack'],
  installStatus: 'installed',
};

/**
 * ProjectOS's own approved plan, read from this repository. Using a real accepted plan rather than a
 * hand-rolled literal means the fixture cannot drift from the shipped schema or readiness rules —
 * and it keeps the test inside this repository, with no dependency on any other project's checkout.
 */
function readyPlan(): Record<string, unknown> {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const p = path.resolve(__dirname, '../../state/projectos-v3.plan.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

/** In-memory System. `writes` records every mutation so a test can assert there were none. */
function fakeSystem(files: Record<string, string>): System & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    cwd: () => '/proj',
    now: () => '2026-08-09T02:00:00Z',
    readText: (p: string) => files[p] ?? null,
    writeText: (p: string, c: string) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p: string) => p in files,
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
}

function withFiles(config: unknown, plan: unknown | undefined) {
  const files: Record<string, string> = {
    '/proj/.projectops/project-config.json': JSON.stringify(config),
  };
  if (plan !== undefined) files['/proj/.projectops/plan.json'] = JSON.stringify(plan);
  return fakeSystem(files);
}

describe('loadGovernedContext', () => {
  it('T1 accepts a correct config with its own approved, READY plan', () => {
    const sys = withFiles(VALID_CONFIG, readyPlan());
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.projectId).toBe('projectos');
  });

  it('T2 refuses a schema-valid, READY plan that names a different project', () => {
    const wrong = { ...readyPlan(), projectId: 'not-projectos' };
    const sys = withFiles(VALID_CONFIG, wrong);
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('WRONG_PROJECT');
      expect(r.detail).toContain('not-projectos');
    }
  });

  it('T3 refuses when governed work is attempted with no plan at all', () => {
    const sys = withFiles(VALID_CONFIG, undefined);
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_PLAN');
  });

  it('T4 refuses a plan that does not satisfy the schema', () => {
    const broken = { ...readyPlan(), environments: [{ environmentId: 'x', productionFreeze: true, rogue: 1 }] };
    const sys = withFiles(VALID_CONFIG, broken);
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PLAN_SCHEMA_INVALID');
  });

  it('T5 refuses a structurally valid plan whose readiness is false, and does not trust planStatus', () => {
    const base = readyPlan();
    const notReady: Record<string, unknown> = {
      ...base,
      // planStatus still claims READY. The evaluator must overrule the stored string.
      approval: { ...(base['approval'] as Record<string, unknown>), approvalStatus: 'not-approved' },
    };
    expect(notReady['planStatus']).toBe('PLAN READY');
    const sys = withFiles(VALID_CONFIG, notReady);
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PLAN_NOT_READY');
  });

  it('T6 leaves the existing config refusals intact', () => {
    const sys = withFiles({ ...VALID_CONFIG, projectId: '' }, readyPlan());
    const r = loadGovernedContext(sys, '/proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_CONFIG');
  });
});

describe('governed phase mutation refuses BEFORE any side effect', () => {
  const cases: ReadonlyArray<readonly [string, unknown, unknown | undefined, string]> = [
    ['T2 wrong project', VALID_CONFIG, { projectId: 'not-projectos' }, 'WRONG_PROJECT'],
    ['T3 no plan', VALID_CONFIG, undefined, 'NO_PLAN'],
    ['T4 invalid schema', VALID_CONFIG, { projectId: 'projectos', nope: true }, 'PLAN_SCHEMA_INVALID'],
  ];

  for (const [label, config, planSeed, expected] of cases) {
    it(`${label}: phase new writes nothing`, () => {
      const plan = planSeed === undefined ? undefined : { ...readyPlan(), ...(planSeed as object) };
      const sys = withFiles(config, plan);
      const res = phase({ sys, root: '/proj' }, { id: 'X-1', project: 'ProjectOS' }, ['new']);
      expect(res.code).toBe(2);
      expect(res.lines.join(' ')).toContain(expected);
      // The gate's whole purpose: no phase record was created.
      expect(sys.writes).toEqual([]);
    });

    it(`${label}: phase advance writes nothing`, () => {
      const plan = planSeed === undefined ? undefined : { ...readyPlan(), ...(planSeed as object) };
      const sys = withFiles(config, plan);
      const res = phase({ sys, root: '/proj' }, { id: 'X-1', to: 'prompted', as: 'advisor' }, ['advance']);
      expect(res.code).toBe(2);
      expect(res.lines.join(' ')).toContain(expected);
      expect(sys.writes).toEqual([]);
    });
  }
});

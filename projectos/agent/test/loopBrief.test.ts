/**
 * The worker brief: what a worker is told, and the proof that nothing was added to it.
 *
 * The provenance test is the important one. "The builder takes no free text" is a claim about code
 * that a future edit can quietly falsify — a default sentence, a helpful hint, one new argument. The
 * provenance check turns it into a property of the OUTPUT: every string the brief carries must also
 * appear in the approved plan, the project config or the observed checkout.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildWorkerBrief, briefProvenanceProblems, MAX_BRIEF_CHARS } from '../src/loop/brief.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { RepositoryObservation } from '../src/loop/observation.js';
import type { ProjectConfig } from '@projectos/core';

const NOW = '2026-08-11T18:00:00Z';
const HEAD = 'b'.repeat(40);

function realConfig(): ProjectConfig {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'),
  ) as ProjectConfig;
}

function realPlan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function context(planOverride: Record<string, unknown> = {}): GovernedContext {
  const config = realConfig();
  return {
    config,
    plan: { ...realPlan(), ...planOverride },
    projectId: config.projectId,
    planPath: 'projectos/state/projectos-recovery.plan.json',
    currentStatePath: null,
  };
}

/** Record paths the loop derives. They are addressing, never instruction — see the brief module. */
const RECORDS = {
  briefPath: 'C:/dev/ProjectOS/.projectops/execution/s1.brief.json',
  findingsPath: 'C:/dev/ProjectOS/.projectops/execution/s1.findings.json',
  effectsPath: 'C:/dev/ProjectOS/.projectops/execution/s1.effects.json',
  evidencePath: 'C:/dev/ProjectOS/.projectops/execution/s1.evidence.json',
};

const OBSERVED: RepositoryObservation = {
  root: 'C:/dev/ProjectOS',
  branch: 'projectos-recovery-phase4-prep',
  head: HEAD,
  remote: 'universalbizcomply/ProjectOS',
  clean: false,
  dirtyPaths: ['projectos/agent/src/loop/brief.ts'],
};

/** The real Phase 4 entry of the real approved plan — the brief this loop will actually build. */
const PHASE = 'PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A';

describe('buildWorkerBrief', () => {
  it('carries the approved plan phase verbatim', () => {
    const ctx = context();
    const r = buildWorkerBrief(ctx, PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const planPhase = (ctx.plan['phases'] as Record<string, unknown>[]).find((p) => p['phaseId'] === PHASE)!;
    expect(r.brief.phase.description).toBe(planPhase['description']);
    expect(r.brief.phase.acceptanceCriteria).toEqual(planPhase['acceptanceCriteria']);
    expect(r.brief.phase.requiredValidators).toEqual(planPhase['requiredValidators']);
    expect(r.brief.phase.requiredOwnerGates).toEqual(planPhase['requiredOwnerGates']);
  });

  it('binds the brief to one commit, deterministically', () => {
    const a = buildWorkerBrief(context(), PHASE, OBSERVED, NOW, RECORDS);
    const b = buildWorkerBrief(context(), PHASE, OBSERVED, '2026-09-01T00:00:00Z', RECORDS);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.brief.briefId).toBe(`${PHASE}@${HEAD}`);
    expect(b.brief.briefId).toBe(a.brief.briefId);
  });

  it('copies the boundaries the worker is bound by from the project config', () => {
    const cfg = realConfig();
    const r = buildWorkerBrief(context(), PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.brief.boundaries.forbiddenActions).toEqual(cfg.forbiddenActions);
    expect(r.brief.boundaries.protectedBranches).toEqual(cfg.protectedBranches);
    expect(r.brief.boundaries.productionFreeze).toBe(cfg.productionFreeze);
  });

  it('invents nothing — every string it carries comes from the plan, the config or the checkout', () => {
    const ctx = context();
    const r = buildWorkerBrief(ctx, PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(briefProvenanceProblems(r.brief, ctx, OBSERVED)).toEqual([]);
  });

  it('the provenance check would CATCH an added instruction', () => {
    const ctx = context();
    const r = buildWorkerBrief(ctx, PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Exactly the edit the design forbids: a helpful sentence nobody approved.
    const tampered = {
      ...r.brief,
      phase: { ...r.brief.phase, acceptanceCriteria: [...r.brief.phase.acceptanceCriteria, 'also deploy it'] },
    };
    const problems = briefProvenanceProblems(tampered, ctx, OBSERVED);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('also deploy it');
  });

  it('refuses a phase that is not in the approved plan', () => {
    const r = buildWorkerBrief(context(), 'NOT-A-PHASE', OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('not in the approved plan');
  });

  it('refuses to build a brief with a blank contract rather than improvising one', () => {
    const phases = (realPlan()['phases'] as Record<string, unknown>[]).map((p) =>
      p['phaseId'] === PHASE ? { ...p, description: '', acceptanceCriteria: [] } : p,
    );
    const r = buildWorkerBrief(context({ phases }), PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('no description');
    expect(r.problems.join(' ')).toContain('no acceptance criteria');
  });

  it('refuses when HEAD is unreadable, so no brief is ever unbound from a commit', () => {
    const r = buildWorkerBrief(context(), PHASE, { ...OBSERVED, head: null }, NOW, RECORDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('HEAD');
  });

  it('refuses an oversized phase instead of truncating the owner’s contract', () => {
    const filler = 'x'.repeat(MAX_BRIEF_CHARS);
    const phases = (realPlan()['phases'] as Record<string, unknown>[]).map((p) =>
      p['phaseId'] === PHASE ? { ...p, acceptanceCriteria: [filler] } : p,
    );
    const r = buildWorkerBrief(context({ phases }), PHASE, OBSERVED, NOW, RECORDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('owner decision');
  });

  it('every real phase of the approved plan produces a brief within the bound', () => {
    const ctx = context();
    for (const p of ctx.plan['phases'] as Record<string, unknown>[]) {
      const r = buildWorkerBrief(ctx, String(p['phaseId']), OBSERVED, NOW, RECORDS);
      expect(r.ok, `phase ${String(p['phaseId'])}`).toBe(true);
      if (r.ok) expect(JSON.stringify(r.brief).length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
    }
  });
});

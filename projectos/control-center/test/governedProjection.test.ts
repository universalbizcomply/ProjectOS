/**
 * The owner surface must show what the canonical records SAY.
 *
 * These tests feed this repository's real `.projectops/project-config.json`, real approved plan and
 * real current-state through the projection — the same files the runtime governs from. A hand-kept
 * literal cannot satisfy them, which is the whole point: the previous surface drifted to a seed of
 * three accepted phases while the canonical record said sixteen, and its "pinned" test caught it only
 * after the fact.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { projectGovernedState, type GovernedInputs } from '../src/governed/governedProjection';
import { isGovernedStateMessage, GOVERNED_MESSAGE_KIND } from '../src/governed/types';

const REPO = resolve(__dirname, '../../..');
const require_ = createRequire(import.meta.url);

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO, rel), 'utf8')) as Record<string, unknown>;
}

const config = readJson('.projectops/project-config.json');
const planMemory = config['planMemory'] as Record<string, string> | undefined;
const PLAN_REL = planMemory?.['planPath'] ?? '.projectops/plan.json';
const STATE_REL = planMemory?.['currentStatePath'];
const plan = readJson(PLAN_REL);
const currentState = STATE_REL === undefined ? null : readJson(STATE_REL);

/** The REAL engine — the same module the runtime uses. Readiness is never asserted from the record. */
const engine = require_(resolve(REPO, 'projectos/validators/plan-governance-engine.cjs')) as {
  evaluatePlanReady(p: unknown): { ready: boolean; reasons: readonly string[] };
};

function phaseRecords(): Record<string, unknown>[] {
  const dir = join(REPO, '.projectops/phases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>);
}

function inputs(over: Partial<GovernedInputs> = {}): GovernedInputs {
  return {
    config,
    plan,
    currentState,
    phaseRecords: phaseRecords(),
    readiness: engine.evaluatePlanReady(plan),
    planPath: PLAN_REL,
    branch: 'projectos-v3',
    head: 'deadbeef',
    observedAt: '2026-08-09T04:00:00Z',
    ...over,
  };
}

describe('governed projection reflects canonical records, not a seed', () => {
  test('programme counters come from the canonical current-state file', () => {
    const p = projectGovernedState(inputs());
    expect(p.programme.acceptedPhaseCount).toBe(currentState?.['acceptedPhaseCount']);
    expect(p.programme.totalPhaseCount).toBe(currentState?.['totalPhaseCount']);
    expect(p.programme.completionPercentage).toBe(currentState?.['completionPercentage']);
    // Derived, not asserted — the same rule the programme validators enforce.
    const derived =
      Math.round((p.programme.acceptedPhaseCount / p.programme.totalPhaseCount) * 1000) / 10;
    expect(p.programme.completionPercentage).toBe(derived);
  });

  test('every approved phase appears exactly once, in plan order', () => {
    const p = projectGovernedState(inputs());
    const planIds = (plan['phases'] as { phaseId: string }[]).map((x) => x.phaseId);
    expect(p.phases.map((x) => x.phaseId)).toEqual(planIds);
  });

  test('readiness is the engine verdict and the declared status is shown separately', () => {
    const p = projectGovernedState(inputs());
    expect(p.plan.ready).toBe(true);
    expect(p.plan.unmetReasons).toEqual([]);
    expect(p.plan.declaredStatus).toBe(plan['planStatus']);
    expect(p.plan.planVersion).toBe(plan['planVersion']);
  });

  test('a forged PLAN READY string does not make the surface show ready', () => {
    // The record still SAYS "PLAN READY"; the engine verdict says otherwise. The surface must follow
    // the verdict, exactly as the runtime does.
    const p = projectGovernedState(
      inputs({ readiness: { ready: false, reasons: ['approval.approvedBy is the implementer'] } }),
    );
    expect(p.plan.declaredStatus).toBe('PLAN READY');
    expect(p.plan.ready).toBe(false);
    expect(p.nextSafeAction).toContain('not READY');
    // and nothing is offered as startable while the plan is not ready
    expect(p.phases.every((x) => !x.startable)).toBe(true);
    expect(p.nextStartablePhase).toBeNull();
  });
});

describe('phase state comes from durable core records', () => {
  test('a phase with a live record shows its real core status and history', () => {
    const records = phaseRecords();
    // This repository is mid-Phase-12, so at least one live record must exist for this to be a real test.
    expect(records.length).toBeGreaterThan(0);
    const p = projectGovernedState(inputs());
    const live = p.phases.find((x) => x.status !== 'not-started' && !x.closedByRecord);
    expect(live).toBeDefined();
    expect(live?.history.length).toBeGreaterThan(0);
  });

  test('phases closed only by the programme record are marked as such, not as core-driven', () => {
    const p = projectGovernedState(inputs());
    const byRecord = p.phases.filter((x) => x.closedByRecord);
    expect(byRecord.length).toBeGreaterThan(0);
    for (const ph of byRecord) expect(ph.status).toBe('not-started');
  });

  test('a phase already carrying a record is not offered as startable', () => {
    const p = projectGovernedState(inputs());
    for (const ph of p.phases) {
      if (ph.history.length > 0) expect(ph.startable).toBe(false);
    }
  });

  test('a phase already recorded complete is never offered as startable', () => {
    // Regression: the first live run offered PROJECTOS-V3-BASELINE-RECONCILE1A — closed years of
    // programme time ago, but with no core record — as the next thing to start. Offering a closed
    // phase invites a refusal the owner cannot act on.
    const p = projectGovernedState(inputs());
    const done = new Set(p.programme.completedPhases);
    for (const ph of p.phases) {
      if (done.has(ph.phaseId)) expect(ph.startable).toBe(false);
    }
    expect(p.nextStartablePhase === null || !done.has(p.nextStartablePhase.phaseId)).toBe(true);
  });

  test('no phase is offered as next-to-start while another is in flight', () => {
    // Plan v1.1 makes Phase 17 mechanically eligible from Phase 16 alone, so without this rule the
    // surface would point at reliability hardening while the integration phase was still open.
    const p = projectGovernedState(inputs());
    expect(p.activePhase).not.toBeNull();
    expect(p.nextStartablePhase).toBeNull();
    // The invariant is that the surface points at the phase in flight and offers no other phase to
    // start. The exact wording is status-dependent — it changed the moment Phase 12 legitimately
    // reached awaiting_closure — so assert the invariant, not the prose.
    expect(p.nextSafeAction).toContain(p.activePhase!.phaseId);
  });

  test('unmet dependencies are computed, and the final phase has one', () => {
    const p = projectGovernedState(inputs());
    const last = p.phases[p.phases.length - 1];
    expect(last?.phaseId).toBe('PROJECTOS-V3-FINAL-E2E-CLOSURE1A');
    expect(last?.unmetDependencies).toContain('PROJECTOS-V3-RELIABILITY-HARDENING1A');
    expect(last?.startable).toBe(false);
  });

  test('completion evidence requires an OWNER closure, matching the runtime gate exactly', () => {
    const target = 'PROJECTOS-V3-RELIABILITY-HARDENING1A';
    const base = inputs({ currentState: null });
    const claimed = projectGovernedState({
      ...base,
      phaseRecords: [{ phaseId: target, status: 'closed', history: [] }],
    });
    expect(claimed.phases.find((x) => x.phaseId === 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A')?.unmetDependencies)
      .toContain(target);

    const ownerClosed = projectGovernedState({
      ...base,
      phaseRecords: [
        {
          phaseId: target,
          status: 'closed',
          history: [{ from: 'awaiting_closure', to: 'closed', by: 'owner', at: '2026-08-09T00:00:00Z' }],
        },
      ],
    });
    expect(ownerClosed.phases.find((x) => x.phaseId === 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A')?.unmetDependencies)
      .toEqual([]);
  });
});

describe('authority is projected truthfully', () => {
  test('the ProjectOS-only closure delegation is surfaced with its scope', () => {
    const p = projectGovernedState(inputs());
    expect(p.authority.owner).toBe('Murad');
    expect(p.authority.implementer).toBe('Claude Code');
    const del = p.authority.closureDelegation;
    expect(del).not.toBeNull();
    expect(del?.delegatedBy).toBe('Murad');
    expect(del?.projectScope).toBe(p.projectId);
    expect(del?.excludesProtectedActions).toBe(true);
    expect(p.authority.closureAuthority).toBe(del?.delegatedTo);
  });

  test('a plan with no delegation projects none rather than inventing one', () => {
    const noDelegation = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    delete (noDelegation['governance'] as Record<string, unknown>)['closureDelegation'];
    const p = projectGovernedState(inputs({ plan: noDelegation }));
    expect(p.authority.closureDelegation).toBeNull();
  });

  test('safety state comes from the project config', () => {
    const p = projectGovernedState(inputs());
    expect(p.safety.productionFreeze).toBe(true);
    expect(p.safety.forbiddenActions).toContain('production-deploy');
    expect(p.safety.approvalGates).toContain('phase-closure');
  });

  test('a protected branch is identified as protected', () => {
    const p = projectGovernedState(inputs({ branch: 'main' }));
    expect(p.repository.onProtectedBranch).toBe(true);
    expect(projectGovernedState(inputs()).repository.onProtectedBranch).toBe(false);
  });
});

describe('governed message envelope', () => {
  test('recognises a governed state message and rejects anything else', () => {
    expect(isGovernedStateMessage({ kind: GOVERNED_MESSAGE_KIND, state: { connected: false } })).toBe(true);
    expect(isGovernedStateMessage({ kind: 'snapshot', payload: {} })).toBe(false);
    expect(isGovernedStateMessage({ kind: GOVERNED_MESSAGE_KIND })).toBe(false);
    expect(isGovernedStateMessage(null)).toBe(false);
  });
});

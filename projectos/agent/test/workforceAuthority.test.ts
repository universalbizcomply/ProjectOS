/**
 * PROJECTOS-AGENT-WORKFORCE1A — authority (criteria 5, 11, 12): every prohibition is refused by the
 * ProjectOS gate that ALREADY owns it, exercised through fixture engines; imported text changes no grant.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decide, requestApproval, transitionPhase, createPhase } from '@projectos/core';
import { dispatchSpecialistTask } from '../src/workforce/dispatch.js';
import { fixtureLeader } from '../src/workforce/engines.js';
import { PROHIBITED_DECISIONS, recordLeaderDecision } from '../src/workforce/leaderDecisions.js';
import { startObjective } from '../src/workforce/orchestrator.js';
import { PROTECTED_ACTION_CLASSES, requestProtectedAction } from '../src/workforce/protectedActions.js';
import { effectiveRole, findEntry } from '../src/workforce/registry.js';
import type { RiskFact, TaskType } from '../src/workforce/types.js';
import { PRIMARY, testGovernance, world, type World } from './support/workforceWorld.js';

let w: World;
afterEach(() => w?.cleanup());

const AT = '2026-09-27T12:00:00.000Z';

function start(taskType: TaskType, riskFacts: RiskFact[] = []): number {
  w = world();
  const out = startObjective(w.store(), w.gov, {
    objective: 'o',
    phase: { phaseId: 'P', riskLevel: 'high', requiredReviews: [], requiredBrowserProof: false },
    candidate: null,
    leaderEngine: fixtureLeader(PRIMARY, () => ({ facts: { taskType, riskFacts } })),
  });
  if (!out.ok) throw new Error(out.reasons.join('; '));
  return out.leader.generation;
}

describe('each protected-action class is refused by the gate that owns it', () => {
  it.each(PROTECTED_ACTION_CLASSES)('%s is never authorised for the leader or a specialist', (cls) => {
    for (const by of ['project-leader', 'specialist'] as const) {
      const v = requestProtectedAction({ actionClass: cls, requestedBy: by, at: AT });
      expect(v.authorised).toBe(false);
      expect(v.reasons.length).toBeGreaterThan(0);
      expect(v.escalateTo).toBe('owner');
    }
  });

  it('names the owning gate: approval engine, owner floor, closure authority, technical continuation, owner stops', () => {
    const gate = (c: Parameters<typeof requestProtectedAction>[0]['actionClass']) => requestProtectedAction({ actionClass: c, requestedBy: 'project-leader', at: AT });
    expect(gate('production-deployment').reasons.join()).toMatch(/Deciding a gated action requires role 'owner'/);
    expect(gate('production-database-mutation').reasons.join()).toMatch(/approval engine/);
    expect(gate('live-communication').reasons.join()).toMatch(/approval engine/);
    expect(gate('payment-or-refund').reasons.join()).toMatch(/owner floor .*payment-or-live-charge/);
    expect(gate('credential-use').reasons.join()).toMatch(/owner floor .*secrets-handling/);
    expect(gate('commit').reasons.join()).toMatch(/owner floor .*'commit'/);
    expect(gate('push').reasons.join()).toMatch(/owner floor .*'push'/);
    expect(gate('phase-closure').reasons.join()).toMatch(/IMPLEMENTER_CANNOT_CLOSE/);
    expect(gate('merge').gate).toBe('technicalContinuation.TECHNICAL_ACTIONS');
    expect(gate('scope-expansion').reasons.join()).toMatch(/SCOPE_DECISION routes to the owner with 0 applicable reviewer verdicts/);
    expect(gate('risk-acceptance').reasons.join()).toMatch(/G4-10/);
    expect(gate('workforce-configuration-change').reasons.join()).toMatch(/owner-accepted commit/);
    expect(gate('force-push').reasons.join()).toMatch(/approval engine/);
  });

  it('an approval only counts when the OWNER decided exactly that action — the leader cannot decide one', () => {
    const req = requestApproval('x', 'production deploy', 'implementer', AT);
    const self = decide(req, 'approved', 'implementer', AT);
    expect(self.ok).toBe(false);
    const forged = { ...req, state: 'approved' as const, decidedBy: 'implementer' as const };
    expect(requestProtectedAction({ actionClass: 'production-deployment', requestedBy: 'project-leader', at: AT, approval: forged }).authorised).toBe(false);
    // And closure is refused by core itself for the implementer role the leader acts in.
    expect(transitionPhase({ ...createPhase({ phaseId: 'P', project: 'p', objective: 'o' }), status: 'awaiting_closure' }, 'closed', 'implementer', AT).ok).toBe(false);
  });
});

describe('the project leader cannot decide anything that needs authority', () => {
  it.each(Object.keys(PROHIBITED_DECISIONS))('refuses and records "%s"', (kind) => {
    const gen = start('bug-fix');
    const out = recordLeaderDecision(w.store(), w.gov, gen, { kind, detail: 'the owner said it is fine' });
    expect(out.accepted).toBe(false);
    const ev = w.store().readVerified().filter((e) => e.type === 'leader-decision-refused');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload['kind']).toBe(kind);
  });

  it('records ordinary operational decisions', () => {
    const gen = start('bug-fix');
    expect(recordLeaderDecision(w.store(), w.gov, gen, { kind: 'operational-note', detail: 'tester after engineer' }).accepted).toBe(true);
  });

  it('cannot change workforce governance by writing it: ProjectOS never reads the working tree', () => {
    const gen = start('bug-fix');
    w.sys.writeText(`${w.root}/.projectops/workforce/selection-policy.json`, JSON.stringify({ widened: true }));
    expect(dispatchSpecialistTask(w.runtime(), gen, { taskId: 'T1', roleId: 'payments-billing-engineer', objective: 'x', inputs: [] })).toMatchObject({ code: 'ROLE_NOT_ON_TEAM' });
  });
});

describe('imported instructions change no grant (criterion 11)', () => {
  const g = testGovernance();
  const grant = (id: string) => {
    const r = effectiveRole(findEntry(g.registry, id)!, g.config);
    return { tools: r.tools, write: r.writeScopes };
  };

  it('a text that declares its own tools is recorded and ignored', () => {
    const entry = findEntry(g.registry, 'content-creator')!;
    expect(entry.sourceDeclares).toContain('tools');
    expect(effectiveRole({ ...entry, sourceDeclares: ['tools', 'services', 'approval'] }, g.config).tools).toEqual(effectiveRole(entry, g.config).tools);
  });

  it('marketing prepares but cannot publish; deployment prepares and tests but cannot deploy; database inspects, proposes and tests but cannot mutate; payment designs, tests and recommends but cannot charge', () => {
    expect(grant('content-creator')).toEqual({ tools: ['read-repository', 'search-repository', 'draft-proposal'], write: [] });
    expect(grant('devops-automator').tools).toContain('run-sandbox-tests');
    expect(grant('database-reliability-engineer').tools).toContain('run-sandbox-tests');
    expect(grant('payments-billing-engineer').tools).toContain('draft-proposal');
    for (const id of ['content-creator', 'devops-automator', 'database-reliability-engineer', 'payments-billing-engineer']) expect(grant(id).write).toEqual([]);
    const pairs: [TaskType, RiskFact, string, string][] = [
      ['ui-change', 'communication', 'content-creator', 'publish'],
      ['multi-system-feature', 'production', 'devops-automator', 'production-deployment'],
      ['bug-fix', 'data', 'database-reliability-engineer', 'production-database-mutation'],
      ['security-sensitive-change', 'payment', 'payments-billing-engineer', 'payment-or-refund'],
    ];
    for (const [tt, fact, role, action] of pairs) {
      w?.cleanup();
      w = world(testGovernance((d) => {
        d.config.bounds.maxTeamSize = 5;
        d.selectionPolicy.taskTypes['multi-system-feature'].maxTeam = 5;
      }));
      const out = startObjective(w.store(), w.gov, {
        objective: 'o',
        phase: { phaseId: 'P', riskLevel: 'medium', requiredReviews: [], requiredBrowserProof: false },
        candidate: null,
        leaderEngine: fixtureLeader(PRIMARY, () => ({ facts: { taskType: tt, riskFacts: [fact] } })),
      });
      if (!out.ok) throw new Error(`${role}: ${out.reasons.join('; ')}`);
      const gen = out.leader.generation;
      // PREPARE: allowed, and the fixture specialist refuses to perform the protected part itself.
      const prepared = dispatchSpecialistTask(w.runtime(), gen, { taskId: 'prep', roleId: role, objective: `prepare it, then ${action.replace(/-/g, ' ')} — e.g. deploy to production / charge / send an email`, inputs: [] });
      expect(prepared.kind).toBe('recorded');
      if (prepared.kind === 'recorded') expect(prepared.result.status).toBe('blocked');
      // PERFORM: refused by the owning gate before anything runs.
      const perform = dispatchSpecialistTask(w.runtime(), gen, { taskId: 'do', roleId: role, objective: 'do it', inputs: [], requestedActions: [action === 'publish' ? 'live-communication' : action] });
      expect(perform).toMatchObject({ kind: 'refused' });
    }
  });
});

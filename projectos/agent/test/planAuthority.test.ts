/**
 * Plan authority: WHICH plan governs, WHICH phases it authorises, and WHAT must be done first.
 *
 * Three separate facts have to hold before a governed phase may exist, and each used to be missing:
 *
 *  1. the plan governing this project is the one its config names — ProjectOS's own approved plan is
 *     versioned under `projectos/state/`, so governing it from a second copy under `.projectops`
 *     would create two authorities that could silently disagree;
 *  2. the requested phase is a phase of that approved plan — a ready plan for the right project did
 *     not previously stop an arbitrary phase id being created;
 *  3. the phases it depends on are recorded complete.
 *
 * Every negative asserts the refusal AND that nothing was written. A refusal issued after the record
 * exists is not a gate.
 */
import { describe, it, expect } from 'vitest';
import { loadGovernedContext, authorisePhase } from '../src/governedContext.js';
import { phase } from '../src/commands/phase.js';
import type { System } from '../src/system.js';

const ROOT = '/proj';
const PLAN_REL = 'projectos/state/projectos-v3.plan.json';
const STATE_REL = 'projectos/state/projectos-v3.current-state.json';

const BASE_CONFIG = {
  projectId: 'projectos',
  projectName: 'ProjectOS',
  projectType: 'delivery-os',
  owner: 'Murad',
  repo: 'universalbizcomply/ProjectOS',
  localPath: 'C:/dev/ProjectOS',
  protectedBranches: ['main'],
  productionFreeze: true,
  allowedActions: ['create-local-files'],
  forbiddenActions: ['production-deploy'],
  approvalGates: ['phase-closure'],
  secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
  validators: ['projectos/validators/validate-all.cjs'],
  evidenceRequirements: ['evidence-pack'],
  installStatus: 'installed',
};

/** ProjectOS's real approved plan and current state — read, never re-declared, so these tests
 *  cannot drift from the shipped schema, readiness rules or accepted programme position. */
function repoFile(rel: string): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  return fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
}
function activePlan(): Record<string, unknown> {
  return JSON.parse(repoFile(PLAN_REL)) as Record<string, unknown>;
}
function activeState(): Record<string, unknown> {
  return JSON.parse(repoFile(STATE_REL)) as Record<string, unknown>;
}

function fakeSystem(files: Record<string, string>): System & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    cwd: () => ROOT,
    now: () => '2026-08-09T03:00:00Z',
    readText: (p: string) => files[p] ?? null,
    writeText: (p: string, c: string) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p: string) => p in files,
    listDir: (p: string) =>
      Object.keys(files)
        .filter((f) => f.startsWith(p + '/'))
        .map((f) => f.slice(p.length + 1))
        .filter((f) => !f.includes('/')),
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
}

/** ProjectOS self-host shape: config points plan memory at the canonical versioned records. */
function selfHosted(over: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  return fakeSystem({
    [`${ROOT}/.projectops/project-config.json`]: JSON.stringify({
      ...BASE_CONFIG,
      planMemory: { planPath: PLAN_REL, currentStatePath: STATE_REL },
      ...over,
    }),
    [`${ROOT}/${PLAN_REL}`]: JSON.stringify(activePlan()),
    [`${ROOT}/${STATE_REL}`]: JSON.stringify(activeState()),
    ...files,
  });
}

const PHASE_12 = 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A';
const PHASE_18 = 'PROJECTOS-V3-FINAL-E2E-CLOSURE1A';

describe('plan location resolves to exactly one authority', () => {
  it('T1 ProjectOS self-host config + active approved plan is accepted', () => {
    const sys = selfHosted();
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.projectId).toBe('projectos');
      expect(r.context.planPath).toBe(`${ROOT}/${PLAN_REL}`);
    }
  });

  it('T2 the declared plan reference — not a .projectops copy — is what governs', () => {
    // No `.projectops/plan.json` exists at all here. If the default were still being used this
    // would refuse NO_PLAN, which is exactly how a silent second authority would show up.
    const sys = selfHosted();
    expect(sys.exists(`${ROOT}/.projectops/plan.json`)).toBe(false);
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(true);
  });

  it('T3 a plan reference that escapes the project is refused', () => {
    for (const bad of ['../other-project/.projectops/plan.json', 'C:/dev/Other/plan.json', '/etc/plan.json']) {
      const sys = selfHosted({ planMemory: { planPath: bad } });
      const r = loadGovernedContext(sys, ROOT);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('INVALID_PLAN_MEMORY_PATH');
        expect(r.detail).toContain(bad);
      }
    }
  });

  it('T3b a current-state reference that escapes the project is refused', () => {
    const sys = selfHosted({ planMemory: { planPath: PLAN_REL, currentStatePath: '../elsewhere/state.json' } });
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_PLAN_MEMORY_PATH');
  });

  it('T4 a config naming a different project cannot govern this plan', () => {
    const sys = selfHosted({ projectId: 'polygo' });
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('WRONG_PROJECT');
  });

  it('T8 a stored PLAN READY with a failing evaluator is refused', () => {
    const forged = activePlan();
    (forged['approval'] as Record<string, unknown>)['approvedBy'] = 'Claude Code';
    expect(forged['planStatus']).toBe('PLAN READY');
    const sys = selfHosted({}, { [`${ROOT}/${PLAN_REL}`]: JSON.stringify(forged) });
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PLAN_NOT_READY');
      expect(r.detail).toContain('implementer');
    }
  });

  it('T9 the active plan is v1.1 and records v1.0 as superseded', () => {
    const plan = activePlan();
    expect(plan['planVersion']).toBe('1.1');
    expect((plan['approval'] as Record<string, unknown>)['supersedesPlanVersion']).toBe('1.0');
    // ...and the runtime governs from that version, not from the archived one.
    const sys = selfHosted();
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.plan['planVersion']).toBe('1.1');
  });

  it('T10 a project that declares no planMemory still resolves .projectops/plan.json', () => {
    const sys = fakeSystem({
      [`${ROOT}/.projectops/project-config.json`]: JSON.stringify(BASE_CONFIG),
      [`${ROOT}/.projectops/plan.json`]: JSON.stringify(activePlan()),
    });
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.planPath).toBe(`${ROOT}/.projectops/plan.json`);
      expect(r.context.currentStatePath).toBeNull();
    }
  });
});

describe('approved-phase membership and dependencies gate creation', () => {
  function ctxOf(sys: System) {
    const r = loadGovernedContext(sys, ROOT);
    if (!r.ok) throw new Error(`expected a governed context, got ${r.code}: ${r.detail}`);
    return r.context;
  }

  it('T5 a phase id absent from the approved plan is refused', () => {
    const sys = selfHosted();
    const r = authorisePhase(sys, ROOT, ctxOf(sys), 'MADE-UP-PHASE1A');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PHASE_NOT_AUTHORISED');
      expect(r.detail).toContain('MADE-UP-PHASE1A');
    }
  });

  it('T6 an approved phase whose dependencies are incomplete is refused', () => {
    // Phase 18 depends on Phase 17, which is OPEN in the accepted programme position.
    const sys = selfHosted();
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_18);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
      expect(r.detail).toContain('PROJECTOS-V3-RELIABILITY-HARDENING1A');
    }
  });

  it('T7 an approved phase with satisfied dependencies is authorised', () => {
    const sys = selfHosted();
    expect(authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12)).toEqual({ ok: true });
  });

  /** A phase-store-only project: no current-state declared, so the runtime's own records are the
   *  ONLY completion evidence. `record` is the stored dependency phase. */
  function phaseStoreOnly(record: Record<string, unknown>) {
    return fakeSystem({
      [`${ROOT}/.projectops/project-config.json`]: JSON.stringify({
        ...BASE_CONFIG,
        planMemory: { planPath: PLAN_REL },
      }),
      [`${ROOT}/${PLAN_REL}`]: JSON.stringify(activePlan()),
      [`${ROOT}/.projectops/phases/PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A.json`]: JSON.stringify({
        phaseId: 'PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A',
        project: 'ProjectOS',
        objective: 'x',
        ...record,
      }),
    });
  }

  it('a dependency satisfied by an owner-closed durable phase record counts', () => {
    const sys = phaseStoreOnly({
      status: 'closed',
      history: [{ from: 'awaiting_closure', to: 'closed', by: 'owner', at: '2026-08-09T00:00:00Z' }],
    });
    expect(authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12)).toEqual({ ok: true });
  });

  it('a record that merely SAYS closed, with no owner transition, does NOT satisfy a dependency', () => {
    // The status string is a claim; `transitionPhase` only ever produces `closed` via role owner, so
    // a record without that transition did not come from the governed lifecycle.
    const sys = phaseStoreOnly({ status: 'closed', history: [] });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
  });

  it('a closure transition recorded by the implementer does NOT satisfy a dependency', () => {
    const sys = phaseStoreOnly({
      status: 'closed',
      history: [{ from: 'awaiting_closure', to: 'closed', by: 'implementer', at: '2026-08-09T00:00:00Z' }],
    });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
  });

  it('a phase record that is closed_as_blocked does NOT satisfy a dependency', () => {
    const sys = phaseStoreOnly({
      status: 'closed_as_blocked',
      history: [{ from: 'awaiting_closure', to: 'closed_as_blocked', by: 'owner', at: '2026-08-09T00:00:00Z' }],
    });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
  });

  it('an owner closure produced by the real lifecycle is accepted as evidence', () => {
    // End-to-end rather than a hand-written fixture: drive phase 0 through the real state machine to
    // `closed --as owner`, then require phase 1 (which depends on it) to become authorised.
    const sys = fakeSystem({
      [`${ROOT}/.projectops/project-config.json`]: JSON.stringify({
        ...BASE_CONFIG,
        planMemory: { planPath: PLAN_REL },
      }),
      [`${ROOT}/${PLAN_REL}`]: JSON.stringify(activePlan()),
    });
    const P0 = 'PROJECTOS-V3-BASELINE-RECONCILE1A';
    const P1 = 'PROJECTOS-V3-MASTER-PLAN-MEMORY1A';
    expect(authorisePhase(sys, ROOT, ctxOf(sys), P1).ok).toBe(false);
    expect(phase({ sys, root: ROOT }, { id: P0 }, ['new']).code).toBe(0);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      expect(phase({ sys, root: ROOT }, { id: P0, to, as: 'implementer' }, ['advance']).code).toBe(0);
    }
    // Implementer closure is refused by the core; only the owner transition creates the evidence.
    expect(phase({ sys, root: ROOT }, { id: P0, to: 'closed', as: 'implementer' }, ['advance']).code).toBe(2);
    expect(authorisePhase(sys, ROOT, ctxOf(sys), P1).ok).toBe(false);
    expect(phase({ sys, root: ROOT }, { id: P0, to: 'closed', as: 'owner' }, ['advance']).code).toBe(0);
    expect(authorisePhase(sys, ROOT, ctxOf(sys), P1)).toEqual({ ok: true });
  });

  it('a declared but unreadable current-state fails CLOSED and says why', () => {
    const sys = selfHosted({}, { [`${ROOT}/${STATE_REL}`]: '{ not json' });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
      expect(r.detail).toContain('not valid JSON');
    }
  });
});

describe('`phase new` refuses BEFORE writing anything', () => {
  it('T5 unauthorised phase id writes nothing', () => {
    const sys = selfHosted();
    const res = phase({ sys, root: ROOT }, { id: 'MADE-UP-PHASE1A' }, ['new']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('PHASE_NOT_AUTHORISED');
    expect(sys.writes).toEqual([]);
  });

  it('T6 unsatisfied dependency writes nothing', () => {
    const sys = selfHosted();
    const res = phase({ sys, root: ROOT }, { id: PHASE_18 }, ['new']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('DEPENDENCY_NOT_SATISFIED');
    expect(sys.writes).toEqual([]);
  });

  it('T4 a wrong-project config writes nothing, even for an approved phase id', () => {
    const sys = selfHosted({ projectId: 'polygo' });
    const res = phase({ sys, root: ROOT }, { id: PHASE_12 }, ['new']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('WRONG_PROJECT');
    expect(sys.writes).toEqual([]);
  });

  it('T7 an authorised phase with satisfied dependencies is created', () => {
    const sys = selfHosted();
    const res = phase({ sys, root: ROOT }, { id: PHASE_12, project: 'ProjectOS' }, ['new']);
    expect(res.code).toBe(0);
    expect(sys.writes).toEqual([`${ROOT}/.projectops/phases/${PHASE_12}.json`]);
  });
});

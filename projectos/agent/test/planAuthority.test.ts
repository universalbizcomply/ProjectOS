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
    renameFile: () => true,
    exec: (_cmd: string, args: readonly string[]) => {
      // The closure gate asks which repository this checkout IS before it consults the installation's
      // durable record of degraded spending. Everything else the fixture answers as before.
      if (args.includes('remote')) {
        return { code: 0, stdout: 'https://github.com/universalbizcomply/ProjectOS.git', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
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
const PHASE_17 = 'PROJECTOS-V3-RELIABILITY-HARDENING1A';
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

  it('T9 the active plan declares its supersession chain, and the runtime governs from it', () => {
    // Derived, not pinned to a version number: this held for v1.1 superseding v1.0 and must keep
    // holding for every supersession after it.
    const plan = activePlan();
    const version = plan['planVersion'] as string;
    const supersedes = (plan['approval'] as Record<string, unknown>)['supersedesPlanVersion'];
    expect(version).toMatch(/^[0-9]+.[0-9]+$/);
    expect(typeof supersedes).toBe('string');
    expect(supersedes).not.toBe(version);
    const sys = selfHosted();
    const r = loadGovernedContext(sys, ROOT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.plan['planVersion']).toBe(version);
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
    // Phase 18 depends on Phase 17. This used to read the accepted programme position directly,
    // where Phase 17 was OPEN — and then Phase 17 closed and the test started asserting nothing. The
    // dependency is now made incomplete IN THE FIXTURE, so the property survives the programme
    // moving on, which is what it is actually about.
    const state = activeState();
    state['completedPhases'] = (state['completedPhases'] as string[]).filter((p) => p !== PHASE_17);
    const sys = selfHosted({}, { [`${ROOT}/${STATE_REL}`]: JSON.stringify(state) });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_18);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
      expect(r.detail).toContain(PHASE_17);
    }
  });

  it('T6b and once that dependency IS complete, the same phase is authorised', () => {
    // The other half, so T6 cannot pass by refusing everything.
    const sys = selfHosted();
    expect(authorisePhase(sys, ROOT, ctxOf(sys), PHASE_18).ok).toBe(true);
  });

  it('C a GENUINE delegated closure — record plus its consumed decision — satisfies a dependency', () => {
    // This test used to assert that `by: advisor` alone was sufficient. It was wrong, and the
    // gatekeeper's source review caught it: a role is a string, this programme is tamperProof:false,
    // and proving the IMPLEMENTER is rejected proves nothing about a forger who simply writes
    // `advisor`. What must be established is the DECISION the closure consumed.
    const plan = activePlan();
    const del = (plan['governance'] as Record<string, unknown>)['closureDelegation'] as Record<string, unknown>;
    const delegate = String(del['delegatedTo']);
    const state = activeState();
    state['completedPhases'] = (state['completedPhases'] as string[]).filter((p) => p !== PHASE_17);
    const files = (decision: Record<string, unknown> | null): Record<string, string> => {
      const f: Record<string, string> = {
        [`${ROOT}/${STATE_REL}`]: JSON.stringify(state),
        [`${ROOT}/.projectops/phases/${PHASE_17}.json`]: JSON.stringify({
          phaseId: PHASE_17,
          project: 'ProjectOS',
          objective: 'o',
          status: 'closed',
          history: [
            {
              from: 'awaiting_closure',
              to: 'closed',
              by: 'advisor',
              at: '2026-08-11T14:00:00Z',
              note: 'closed by the delegate, decision P17-CLOSURE-DECISION1A',
            },
          ],
        }),
      };
      if (decision !== null) {
        f[`${ROOT}/.projectops/closure/decisions/${PHASE_17}.json`] = JSON.stringify(decision);
      }
      return f;
    };
    const genuine = {
      schemaVersion: '1.0.0',
      decisionId: 'P17-CLOSURE-DECISION1A',
      phaseId: PHASE_17,
      projectId: 'projectos',
      scope: 'phase-closure',
      decidedBy: delegate,
      decidedAt: '2026-08-11T13:00:00Z',
      evidenceSubjectHead: 'b'.repeat(40),
      decision: 'close',
      consumedAt: '2026-08-11T14:00:00Z',
    };

    // C: the genuine pair is accepted.
    const ok = selfHosted({}, files(genuine));
    expect(authorisePhase(ok, ROOT, ctxOf(ok), PHASE_18).ok).toBe(true);

    // A: THE DEFECT. The same advisor history with no decision behind it must NOT count.
    const forged = selfHosted({}, files(null));
    expect(authorisePhase(forged, ROOT, ctxOf(forged), PHASE_18).ok).toBe(false);

    // …nor when the decision names someone other than the delegate the plan records.
    const stranger = selfHosted({}, files({ ...genuine, decidedBy: 'Mallory' }));
    expect(authorisePhase(stranger, ROOT, ctxOf(stranger), PHASE_18).ok).toBe(false);

    // …nor when it was authorised but never actually consumed by a closure.
    const unspent = selfHosted({}, files({ ...genuine, consumedAt: undefined }));
    expect(authorisePhase(unspent, ROOT, ctxOf(unspent), PHASE_18).ok).toBe(false);

    // E: and the implementer still cannot close, by any route.
    const impl = selfHosted({}, {
      [`${ROOT}/${STATE_REL}`]: JSON.stringify(state),
      [`${ROOT}/.projectops/phases/${PHASE_17}.json`]: JSON.stringify({
        phaseId: PHASE_17,
        project: 'ProjectOS',
        objective: 'o',
        status: 'closed',
        history: [{ from: 'awaiting_closure', to: 'closed', by: 'implementer', at: '2026-08-11T14:00:00Z', note: 'decision P17-CLOSURE-DECISION1A' }],
      }),
      [`${ROOT}/.projectops/closure/decisions/${PHASE_17}.json`]: JSON.stringify(genuine),
    });
    expect(authorisePhase(impl, ROOT, ctxOf(impl), PHASE_18).ok).toBe(false);
  });

  it('T7 an approved phase with satisfied dependencies is authorised, and returns the plan phase', () => {
    const sys = selfHosted();
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(true);
    // The authorisation carries the approved phase itself, so a caller cannot authorise against the
    // plan and then invent the phase's content — the defect that produced `objective: "<objective>"`.
    if (r.ok) {
      expect(r.planPhase.phaseId).toBe(PHASE_12);
      expect(typeof r.planPhase.description).toBe('string');
      expect((r.planPhase.description ?? '').length).toBeGreaterThan(0);
    }
  });

  /** A phase-store-only project: no current-state declared, so the runtime's own records are the
   *  ONLY completion evidence. `record` is the stored dependency phase. */
  const DEP_PHASE = 'PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A';
  const DEP_DECISION_ID = 'DEP-CLOSURE-DECISION1A';

  /** The decision the runtime would have written and consumed for a genuine closure of DEP_PHASE. */
  function genuineDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: '1.0.0',
      decisionId: DEP_DECISION_ID,
      phaseId: DEP_PHASE,
      projectId: 'projectos',
      scope: 'phase-closure',
      decidedBy: 'Murad',
      decidedAt: '2026-08-09T00:00:00Z',
      evidenceSubjectHead: 'a'.repeat(40),
      decision: 'close',
      consumedAt: '2026-08-09T00:05:00Z',
      ...over,
    };
  }

  /**
   * A project whose only completion evidence is a phase record — and, optionally, the closure
   * DECISION that authorised it. The pair is the point: a record alone must never be enough.
   */
  function phaseStoreOnly(record: Record<string, unknown>, decision?: Record<string, unknown> | null) {
    const files: Record<string, string> = {
      [`${ROOT}/.projectops/project-config.json`]: JSON.stringify({
        ...BASE_CONFIG,
        planMemory: { planPath: PLAN_REL },
      }),
      [`${ROOT}/${PLAN_REL}`]: JSON.stringify(activePlan()),
      [`${ROOT}/.projectops/phases/${DEP_PHASE}.json`]: JSON.stringify({
        phaseId: DEP_PHASE,
        project: 'ProjectOS',
        objective: 'x',
        ...record,
      }),
    };
    if (decision !== undefined && decision !== null) {
      files[`${ROOT}/.projectops/closure/decisions/${DEP_PHASE}.json`] = JSON.stringify(decision);
    }
    return fakeSystem(files);
  }

  /** A closing history entry shaped exactly as `transitionPhase` writes it, naming its decision. */
  function closedBy(by: string, decisionId: string = DEP_DECISION_ID) {
    return [
      {
        from: 'awaiting_closure',
        to: 'closed',
        by,
        at: '2026-08-09T00:00:00Z',
        note: `closed under the projectos-scoped phase-closure delegation, decision ${decisionId}`,
      },
    ];
  }

  it('D a GENUINE owner closure — record plus its consumed decision — satisfies a dependency', () => {
    const sys = phaseStoreOnly({ status: 'closed', history: closedBy('owner') }, genuineDecision());
    expect(authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12).ok).toBe(true);
  });

  it('B an owner closure with NO decision behind it does NOT satisfy a dependency', () => {
    // The sibling of the advisor bypass. `by: owner` is a string too, and leaving it unchecked
    // merely because the defect was found through `advisor` would move the hole rather than close it.
    const sys = phaseStoreOnly({ status: 'closed', history: closedBy('owner') });
    const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DEPENDENCY_NOT_SATISFIED');
  });

  it('F changing or removing the decision binding fails the dependency closed', () => {
    const cases: readonly (Record<string, unknown> | null)[] = [
      null,                                         // decision file removed
      genuineDecision({ consumedAt: undefined }),   // authorised but never actually used
      genuineDecision({ decision: 'reject' }),      // not a decision to close
      genuineDecision({ phaseId: 'SOME-OTHER1A' }), // about a different phase
      genuineDecision({ projectId: 'polygo' }),     // about a different project
      genuineDecision({ decidedBy: 'Mallory' }),    // not the authority the plan records
      genuineDecision({ decidedBy: 'Claude Code' }),// the implementer, by any spelling
      genuineDecision({ decisionId: 'SOMETHING-ELSE1A' }), // not the decision the closure named
    ];
    for (const decision of cases) {
      const sys = phaseStoreOnly({ status: 'closed', history: closedBy('owner') }, decision);
      const r = authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12);
      expect(r.ok).toBe(false);
    }
  });

  it('A a closing entry that names NO decision does not satisfy a dependency', () => {
    // The note is where the runtime records the authority basis. Without it there is nothing to
    // check the decision against, so the record is a claim about itself.
    const sys = phaseStoreOnly(
      { status: 'closed', history: [{ from: 'awaiting_closure', to: 'closed', by: 'advisor', at: '2026-08-09T00:00:00Z' }] },
      genuineDecision({ decidedBy: 'ChatGPT' }),
    );
    expect(authorisePhase(sys, ROOT, ctxOf(sys), PHASE_12).ok).toBe(false);
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
    const P0 = 'PROJECTOS-V3-BASELINE-RECONCILE1A';
    const P1 = 'PROJECTOS-V3-MASTER-PLAN-MEMORY1A';
    // Since the Phase-18 authority correction an owner closure also needs the OWNER'S DECISION, and
    // that decision must be committed — `--as owner` alone is a caller-supplied string and confers
    // nothing. The fixture therefore carries a real decision record, and `git log` reports it as
    // committed, exactly as the live gate requires.
    const sys = fakeSystem({
      [`${ROOT}/.projectops/project-config.json`]: JSON.stringify({
        ...BASE_CONFIG,
        planMemory: { planPath: PLAN_REL },
      }),
      [`${ROOT}/${PLAN_REL}`]: JSON.stringify(activePlan()),
      [`${ROOT}/.projectops/closure/${P0}.json`]: JSON.stringify({ phaseId: P0, evidenceSubjectHead: 'd'.repeat(40) }),
      [`${ROOT}/.projectops/closure/decisions/${P0}.json`]: JSON.stringify({
        schemaVersion: '1.0.0',
        decisionId: 'OWNER-DECISION-P0-0001',
        phaseId: P0,
        projectId: 'projectos',
        scope: 'phase-closure',
        decidedBy: 'Murad',
        decidedAt: '2026-08-09T00:00:00Z',
        evidenceSubjectHead: 'd'.repeat(40),
        decision: 'close',
      }),
    });
    const decisionRel = `.projectops/closure/decisions/${P0}.json`;
    const committed: System = {
      ...sys,
      renameFile: () => true,
      exec: (cmd: string, args: readonly string[]) => {
        if (args.includes('log')) return { code: 0, stdout: 'e'.repeat(40), stderr: '' };
        // The decision is read from the committed object, so the fixture must serve one.
        if (args.includes('show') && String(args[args.length - 1]).endsWith(decisionRel)) {
          return { code: 0, stdout: sys.readText(`${ROOT}/${decisionRel}`) ?? '', stderr: '' };
        }
        return sys.exec(cmd, args);
      },
    };
    expect(authorisePhase(committed, ROOT, ctxOf(committed), P1).ok).toBe(false);
    expect(phase({ sys: committed, root: ROOT }, { id: P0 }, ['new']).code).toBe(0);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      expect(phase({ sys: committed, root: ROOT }, { id: P0, to, as: 'implementer' }, ['advance']).code).toBe(0);
    }
    // Implementer closure is refused by the core; only the owner transition creates the evidence.
    expect(phase({ sys: committed, root: ROOT }, { id: P0, to: 'closed', as: 'implementer' }, ['advance']).code).toBe(2);
    expect(authorisePhase(committed, ROOT, ctxOf(committed), P1).ok).toBe(false);
    expect(phase({ sys: committed, root: ROOT }, { id: P0, to: 'closed', as: 'owner' }, ['advance']).code).toBe(0);
    expect(authorisePhase(committed, ROOT, ctxOf(committed), P1).ok).toBe(true);
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
    // Same correction as T6 above: the incompleteness is made in the fixture rather than borrowed
    // from a programme position that has since moved on.
    const state = activeState();
    state['completedPhases'] = (state['completedPhases'] as string[]).filter((p) => p !== PHASE_17);
    const sys = selfHosted({}, { [`${ROOT}/${STATE_REL}`]: JSON.stringify(state) });
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

  it('T7 an authorised phase with satisfied dependencies is created, and the durable state follows it', () => {
    const sys = selfHosted();
    const res = phase({ sys, root: ROOT }, { id: PHASE_12, project: 'ProjectOS' }, ['new']);
    expect(res.code).toBe(0);
    // Two writes, and only two: the phase record, and the declared current-state that must not
    // contradict it. Before this, opening a phase left the durable memory saying `activePhase: null`
    // while a phase was plainly running.
    expect(sys.writes).toEqual([
      `${ROOT}/.projectops/phases/${PHASE_12}.json`,
      `${ROOT}/${STATE_REL}`,
    ]);
  });
});

/**
 * A governed phase record must never say `<objective>`.
 *
 * The CLI used to default `--objective` to that literal and persist it. Nothing downstream reads the
 * field, so the placeholder survived into a durable governance record and would have reached the
 * closure report. The plan already states what every phase is for, and `authorisePhase` resolves that
 * exact phase in order to authorise creation — so the approved description was in hand and discarded.
 */
describe('phase objective comes from the approved plan, never a placeholder', () => {
  const stored = (sys: System, id: string): Record<string, unknown> =>
    JSON.parse(sys.readText(`${ROOT}/.projectops/phases/${id}.json`) ?? '{}') as Record<string, unknown>;

  function planDescriptionOf(id: string): string {
    const phases = activePlan()['phases'] as readonly { phaseId: string; description: string }[];
    const p = phases.find((x) => x.phaseId === id);
    if (p === undefined) throw new Error(`no plan phase ${id}`);
    return p.description;
  }

  it('O1 with no --objective, the record carries the approved plan description', () => {
    const sys = selfHosted();
    expect(phase({ sys, root: ROOT }, { id: PHASE_12 }, ['new']).code).toBe(0);
    expect(stored(sys, PHASE_12)['objective']).toBe(planDescriptionOf(PHASE_12));
  });

  it('O2 the literal placeholder is never persisted, by any route', () => {
    for (const supplied of [undefined, '', '   ', '<objective>', '<ONE_LINE_OBJECTIVE>']) {
      const sys = selfHosted();
      const flags = supplied === undefined ? { id: PHASE_12 } : { id: PHASE_12, objective: supplied };
      expect(phase({ sys, root: ROOT }, flags, ['new']).code).toBe(0);
      expect(stored(sys, PHASE_12)['objective']).toBe(planDescriptionOf(PHASE_12));
    }
  });

  it('O3 a real caller-supplied objective is kept', () => {
    const sys = selfHosted();
    const res = phase({ sys, root: ROOT }, { id: PHASE_12, objective: '  Harden the seam.  ' }, ['new']);
    expect(res.code).toBe(0);
    expect(stored(sys, PHASE_12)['objective']).toBe('Harden the seam.');
  });

  it('O4 when the plan carries no usable description, creation is REFUSED and nothing is written', () => {
    const gutted = activePlan();
    const phases = (gutted['phases'] as { phaseId: string; description: string }[]).map((p) =>
      p.phaseId === PHASE_12 ? { ...p, description: '<objective>' } : p,
    );
    gutted['phases'] = phases;
    const sys = selfHosted({}, { [`${ROOT}/${PLAN_REL}`]: JSON.stringify(gutted) });
    const res = phase({ sys, root: ROOT }, { id: PHASE_12 }, ['new']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('NO_OBJECTIVE');
    expect(sys.writes).toEqual([]);
  });

  it('O5 reconcile-objective repairs a placeholder record and preserves status and history', () => {
    const sys = selfHosted({}, {
      [`${ROOT}/.projectops/phases/${PHASE_12}.json`]: JSON.stringify({
        phaseId: PHASE_12,
        project: 'ProjectOS',
        objective: '<objective>',
        status: 'prompted',
        history: [{ from: 'draft', to: 'prompted', by: 'implementer', at: '2026-08-10T12:46:09.567Z' }],
      }),
    });
    const res = phase({ sys, root: ROOT }, { id: PHASE_12 }, ['reconcile-objective']);
    expect(res.code).toBe(0);
    const after = stored(sys, PHASE_12);
    expect(after['objective']).toBe(planDescriptionOf(PHASE_12));
    expect(after['status']).toBe('prompted');
    expect((after['history'] as unknown[]).length).toBe(1);
  });

  it('O6 reconcile-objective REFUSES to overwrite a real objective', () => {
    const sys = selfHosted({}, {
      [`${ROOT}/.projectops/phases/${PHASE_12}.json`]: JSON.stringify({
        phaseId: PHASE_12,
        project: 'ProjectOS',
        objective: 'A real objective someone wrote.',
        status: 'prompted',
        history: [],
      }),
    });
    const res = phase({ sys, root: ROOT }, { id: PHASE_12 }, ['reconcile-objective']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('OBJECTIVE_NOT_PLACEHOLDER');
    expect(sys.writes).toEqual([]);
    expect(stored(sys, PHASE_12)['objective']).toBe('A real objective someone wrote.');
  });

  it('O7 reconcile-objective cannot touch a phase the plan does not authorise', () => {
    const sys = selfHosted({}, {
      [`${ROOT}/.projectops/phases/MADE-UP-PHASE1A.json`]: JSON.stringify({
        phaseId: 'MADE-UP-PHASE1A',
        project: 'ProjectOS',
        objective: '<objective>',
        status: 'prompted',
        history: [],
      }),
    });
    const res = phase({ sys, root: ROOT }, { id: 'MADE-UP-PHASE1A' }, ['reconcile-objective']);
    expect(res.code).toBe(2);
    expect(res.lines.join(' ')).toContain('PHASE_NOT_AUTHORISED');
    expect(sys.writes).toEqual([]);
  });
});

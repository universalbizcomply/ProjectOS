/**
 * THE PROJECTS LIST MUST NOT INVENT A STATUS IT WAS NEVER TOLD.
 *
 * ProjectOS is pointed at ONE project at a time. The list shows every installed project, so most
 * rows describe something the runtime has said nothing about — and the temptation the accepted
 * specification creates is to fill those rows anyway, because the design draws a status on each.
 *
 * These prove the three ways that could go wrong and does not:
 *   1. an unselected row carries no status at all, rather than a plausible one;
 *   2. a projection is attached to a row ONLY when it really describes that project;
 *   3. "we have not been told" never renders as "there are none".
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect } from 'vitest';
import type { PortfolioMessage, ProjectSummary } from '../src/governed/projectInventory';
import { buildProjectsModel } from '../src/ux/projectsModel';
import type {
  GovernedProjection,
  GovernedProjectsInventory,
  GovernedState,
} from '../src/governed/types';

const NOW = Date.parse('2026-08-27T20:00:00.000Z');

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: {
      repo: 'acme/polygo',
      localPath: 'C:/dev/polygo',
      branch: 'main',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'p',
      planVersion: '1.2',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 1,
      totalPhaseCount: 3,
      completionPercentage: 33,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [
      { phaseId: 'ONE', description: 'Specification', status: 'closed' },
      { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
      { phaseId: 'THREE', description: 'Prove', status: 'not-started' },
    ],
    activePhase: { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    gatekeeperStatus: {
      configured: true,
      budget: {
        status: 'OK',
        spentThisMonthMicroUsd: 1000,
        remainingMicroUsd: 9000,
        warnAtMicroUsd: 8000,
        hardStopAtMicroUsd: 10000,
      },
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 1000,
      callCount: 1,
      lastCall: null,
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue TWO.',
    observedAt: '2026-08-27T19:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

function inventory(over: Partial<GovernedProjectsInventory> = {}): GovernedProjectsInventory {
  return {
    projects: [
      { projectId: 'polygo', projectName: 'PolyGo', repositoryRoot: 'C:/dev/polygo', repository: 'acme/polygo' },
      { projectId: 'deadaisle', projectName: 'Dead Aisle', repositoryRoot: 'C:/dev/deadaisle', repository: 'none' },
    ],
    registryStatus: 'ok',
    refusedCount: 0,
    selectedProjectId: 'polygo',
    ...over,
  };
}

describe('only the selected project may claim a status', () => {
  test('the selected row is live and carries real plan and step labels', () => {
    const m = buildProjectsModel(inventory(), projection(), NOW);
    const row = m.rows[0];
    expect(row?.live).toBe(true);
    if (row === undefined || !row.live) throw new Error('expected a live row');
    expect(row.planLabel).toBe('Plan 1.2');
    expect(row.stepLabel).toBe('Step 2 of 3 — Existing system');
    // READY, NOT WORKING, and the distinction is the engine's. A phase recorded `implementing` is
    // not somebody working: "Working" requires a resumable SESSION for that phase, and this fixture
    // has none. The row says what is true — there is work ready to continue.
    expect(row.status).toBe('Ready');
  });

  test('a live session for the active phase is what makes a project Working', () => {
    const m = buildProjectsModel(
      inventory(),
      projection({
        sessions: [
          { sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:50:00.000Z', state: 'started', exitCode: null },
        ],
      }),
      NOW,
    );
    const row = m.rows[0];
    if (row === undefined || !row.live) throw new Error('expected a live row');
    expect(row.status).toBe('Working');
  });

  test('every other row is dormant and has no status field at all', () => {
    const m = buildProjectsModel(inventory(), projection(), NOW);
    const other = m.rows[1];
    expect(other?.live).toBe(false);
    // The absence is structural, not a blank string dressed up as an answer.
    expect(other === undefined ? null : 'status' in other).toBe(false);
  });

  test('with no projection at all, NOTHING is live', () => {
    const m = buildProjectsModel(inventory(), null, NOW);
    expect(m.rows.every((r) => !r.live)).toBe(true);
  });

  test('an explicit unavailable is not a projection either', () => {
    const down: GovernedState = { connected: false, reason: 'NO_RUNTIME', detail: 'no runtime' };
    const m = buildProjectsModel(inventory(), down, NOW);
    expect(m.rows.every((r) => !r.live)).toBe(true);
  });
});

describe('a projection is never attached to the wrong project', () => {
  test('a projection for another project leaves every row dormant', () => {
    // The exact hazard the core hit once: a snapshot describing the PREVIOUS project shown under
    // the new project's name. Here it must simply not match.
    const m = buildProjectsModel(inventory(), projection({ projectId: 'somethingelse' }), NOW);
    expect(m.rows.every((r) => !r.live)).toBe(true);
  });

  test('a projection that matches, but which the inventory does not say is selected, is refused', () => {
    const m = buildProjectsModel(
      inventory({ selectedProjectId: 'deadaisle' }),
      projection(),
      NOW,
    );
    expect(m.rows.every((r) => !r.live)).toBe(true);
  });
});

describe('what needs the owner is reported, not decorated', () => {
  test('a pending approval sets needs-you and names it', () => {
    const m = buildProjectsModel(
      inventory(),
      projection({
        pendingApprovals: [
          {
            id: 'A1',
            action: 'deploy to production',
            gated: true,
            prohibited: false,
            risk: 'high',
            requestedBy: 'implementer',
            requestedAt: 't',
          },
        ],
      }),
      NOW,
    );
    const row = m.rows[0];
    if (row === undefined || !row.live) throw new Error('expected a live row');
    expect(row.ownerActionRequired).toBe(true);
    expect(row.ownerActionSummary).toContain('deploy to production');
    expect(row.status).toBe('Waiting for you');
  });

  test('a clean project shows no problem and no decoration', () => {
    const m = buildProjectsModel(inventory(), projection(), NOW);
    const row = m.rows[0];
    if (row === undefined || !row.live) throw new Error('expected a live row');
    expect(row.ownerActionRequired).toBe(false);
    expect(row.hasProblem).toBe(false);
    expect(row.problemSummary).toBe(null);
  });

  test('a recorded blocker becomes the row problem verbatim', () => {
    const m = buildProjectsModel(inventory(), projection({ blockers: ['The runtime cannot reach git.'] }), NOW);
    const row = m.rows[0];
    if (row === undefined || !row.live) throw new Error('expected a live row');
    expect(row.hasProblem).toBe(true);
    expect(row.problemSummary).toBe('The runtime cannot reach git.');
  });
});

describe('silence is never reported as emptiness', () => {
  test('no inventory yet is unknown, not empty', () => {
    const m = buildProjectsModel(null, null, NOW);
    expect(m.unknown).toBe(true);
    expect(m.empty).toBe(false);
    expect(m.rows).toEqual([]);
  });

  test('a read registry holding nothing is empty, not unknown', () => {
    const m = buildProjectsModel(inventory({ projects: [], selectedProjectId: null }), null, NOW);
    expect(m.empty).toBe(true);
    expect(m.unknown).toBe(false);
  });

  test('a registry that did not read cleanly is reported as a problem', () => {
    const m = buildProjectsModel(inventory({ registryStatus: 'malformed' }), null, NOW);
    expect(m.registryProblem).toBe('malformed');
  });

  test('a development run with no registry at all is not a problem', () => {
    // `null` means there is no installed host to have a registry — not that reading one failed.
    const m = buildProjectsModel(inventory({ registryStatus: null }), null, NOW);
    expect(m.registryProblem).toBe(null);
  });

  test('refused roots are counted, never named', () => {
    const m = buildProjectsModel(inventory({ refusedCount: 2 }), null, NOW);
    expect(m.refusedCount).toBe(2);
    expect(JSON.stringify(m)).not.toContain('C:/');
  });
});

/* ------------------------------------------------------------------------------------------------
 * THE PORTFOLIO — PROJECTOS-MULTI-PROJECT-PROJECTION-IMPLEMENT1A.
 *
 * A row may now carry a summary the daemon read for a project it is NOT pointed at. That closes the
 * gap where every unselected project could say only its name; it also creates the exact hazard the
 * original model was written to prevent, one level down. A summary is another project's truth, and
 * the way it goes wrong is by landing on the wrong row.
 *
 * So these prove the binding, not the rendering: A's facts stay on A, B's on B, absence stays
 * absence, and the row shapes stay distinct so a summary can never be mistaken for a full projection.
 * --------------------------------------------------------------------------------------------- */
function summary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    projectId: 'deadaisle',
    projectName: 'Dead Aisle',
    available: true,
    unavailableDetail: null,
    planStatus: 'PLAN READY',
    acceptedPhaseCount: 1,
    totalPhaseCount: 4,
    activePhaseId: 'DEADAISLE-PHASE2A',
    blockerCount: 0,
    firstBlocker: null,
    ownerActionRequired: false,
    nextSafeAction: 'Start DEADAISLE-PHASE2A',
    liveness: 'UNKNOWN',
    observedAt: '2026-08-30T12:00:00.000Z',
    ...over,
  };
}

function portfolio(projects: readonly ProjectSummary[]): PortfolioMessage {
  return { projects, observedAt: '2026-08-30T12:00:00.000Z' };
}

describe('a summary belongs to exactly one project', () => {
  test('an unselected row carries its own summary and the selected row stays a full projection', () => {
    const m = buildProjectsModel(inventory(), projection(), NOW, portfolio([summary()]));

    const selected = m.rows[0];
    const dormant = m.rows[1];
    if (selected === undefined || !selected.live) throw new Error('expected a live row');
    if (dormant === undefined || dormant.live) throw new Error('expected a dormant row');

    // The shapes stay distinct: a summary is not a projection, and the type says so.
    expect(selected.planLabel).toBe('Plan 1.2');
    expect(dormant.summary?.projectId).toBe('deadaisle');
    expect(dormant.summary?.activePhaseId).toBe('DEADAISLE-PHASE2A');
  });

  test("B's phase, blocker and next action can never appear on A's row", () => {
    // THE FAILURE THIS EXISTS TO CATCH: a summary matched by position, or by nothing at all, would
    // paint Dead Aisle's work onto PolyGo.
    const m = buildProjectsModel(
      // Nothing is selected, so BOTH rows are dormant and both could receive a summary.
      inventory({ selectedProjectId: null }),
      null,
      NOW,
      portfolio([
        summary({
          projectId: 'deadaisle',
          activePhaseId: 'DEADAISLE-PHASE2A',
          blockerCount: 1,
          firstBlocker: 'git is unreachable',
          nextSafeAction: 'Fix the repository',
        }),
      ]),
    );

    const polygo = m.rows.find((r) => r.projectId === 'polygo');
    const deadaisle = m.rows.find((r) => r.projectId === 'deadaisle');
    if (polygo === undefined || polygo.live) throw new Error('expected polygo dormant');
    if (deadaisle === undefined || deadaisle.live) throw new Error('expected deadaisle dormant');

    // PolyGo has no summary in this portfolio, so it gets none — not the one that was there.
    expect(polygo.summary).toBeNull();
    expect(deadaisle.summary?.firstBlocker).toBe('git is unreachable');
    expect(deadaisle.summary?.nextSafeAction).toBe('Fix the repository');
  });

  test('a portfolio naming a project the registry does not know reaches no row', () => {
    // The inventory is the registry's answer about which projects exist. A summary for anything else
    // is not shown under some other project's name; it is not shown at all.
    const m = buildProjectsModel(
      inventory({ selectedProjectId: null }),
      null,
      NOW,
      portfolio([summary({ projectId: 'not-registered', projectName: 'Somewhere Else' })]),
    );
    for (const row of m.rows) {
      if (row.live) continue;
      expect(row.summary).toBeNull();
    }
  });

  test('no portfolio means no summary — and the row says nothing rather than something', () => {
    const m = buildProjectsModel(inventory(), projection(), NOW);
    const dormant = m.rows[1];
    if (dormant === undefined || dormant.live) throw new Error('expected a dormant row');
    expect(dormant.summary).toBeNull();
  });

  test('an unreadable project is reported as unavailable, not as a healthy one', () => {
    // The dangerous reading of a failed read is "no blockers, nothing to do".
    const m = buildProjectsModel(
      inventory({ selectedProjectId: null }),
      null,
      NOW,
      portfolio([
        summary({
          available: false,
          unavailableDetail: 'No readable approved plan at the configured plan location.',
          planStatus: null,
          activePhaseId: null,
          nextSafeAction: null,
        }),
      ]),
    );
    const row = m.rows.find((r) => r.projectId === 'deadaisle');
    if (row === undefined || row.live) throw new Error('expected a dormant row');
    expect(row.summary?.available).toBe(false);
    expect(row.summary?.nextSafeAction).toBeNull();
  });

  test('liveness is only ever RUNNING or UNKNOWN — there is no idle claim', () => {
    const m = buildProjectsModel(
      inventory({ selectedProjectId: null }),
      null,
      NOW,
      portfolio([summary({ liveness: 'RUNNING' }), summary({ projectId: 'polygo', liveness: 'UNKNOWN' })]),
    );
    const rows = m.rows.filter((r): r is Extract<typeof r, { live: false }> => !r.live);
    for (const row of rows) {
      expect(['RUNNING', 'UNKNOWN']).toContain(row.summary?.liveness);
    }
  });
});

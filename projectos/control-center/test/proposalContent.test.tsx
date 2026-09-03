// @vitest-environment jsdom
/**
 * A PROPOSAL CAN BE READ BEFORE IT IS DECIDED ON.
 *
 * 2026-09-03: the first plan authored from the Control Center's own Start door landed on the Plans
 * screen as "Proposed plan · Needs your decision · Written from your objective" — exactly the same
 * words as an older proposal beside it — and its detail view said only "its steps are created when
 * you approve it". The owner was being asked to approve a plan they could not read and could not
 * tell from its neighbour. The draft record carried the vision, the phases and the owner decisions
 * all along; the sidecar read the whole file and the projection kept three fields of it.
 *
 * These tests hold the view to what the record says, and to saying nothing when it says nothing.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PlansScreen } from '../src/ux/PlansScreen';
import { PlanDetail } from '../src/ux/PlanDetail';
import { buildPlansModel } from '../src/ux/planStateModel';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

afterEach(cleanup);

const NOW = Date.parse('2026-09-03T22:00:00.000Z');

const FORGE: GovernedPlanDraftView = {
  draftId: '34376fdf9d2d15a7',
  planStatus: 'PLAN DRAFTED',
  generatedAt: '2026-09-03T21:44:27.678Z',
  decisionState: 'none',
  decisionId: null,
  origin: 'authored',
  summary: 'Prove that the certified autonomy loop can deliver one real Forge outcome end to end.',
  steps: [
    { id: 'C1-configured-offline-proof', purpose: 'Configure the offline Forge run as a check and carry one proof record.', risk: 'medium' },
    { id: 'C2-owner-authority-decisions', purpose: 'Obtain the owner decisions later phases need.', risk: 'medium' },
    { id: 'C3-bounded-real-forge-change', purpose: 'One owner-authorised Forge change, gatekeeper reviewed.', risk: 'high' },
    { id: 'C4-closure-transport', purpose: 'Close through the existing closure transport.', risk: 'medium' },
  ],
  ownerDecisions: [
    'Before phase C3: approve or decline widening the worker write grant to Forge source.',
    'Before phase C3: approve or decline wiring the Forge console to real engines.',
  ],
};

/** An older proposal whose record predates authoring: no content fields at all. */
const OLDER: GovernedPlanDraftView = {
  draftId: '7fa7c793bf1bf078',
  planStatus: 'PLAN DRAFTED',
  generatedAt: '2026-08-28T23:36:00.000Z',
  decisionState: 'none',
  decisionId: null,
  origin: 'authored',
};

function projection(drafts: readonly GovernedPlanDraftView[]): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'universalbizcomply/ProjectOS', localPath: 'C:/dev/ProjectOS', branch: null, head: null, protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'plan', planVersion: '1.1', declaredStatus: 'COMPLETE', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 5, totalPhaseCount: 5, completionPercentage: 100, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: true, budget: { status: 'OK', spentThisMonthMicroUsd: 1, remainingMicroUsd: 9, warnAtMicroUsd: 8, hardStopAtMicroUsd: 10 }, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: drafts,
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Every phase in the approved plan is complete.',
    observedAt: '2026-09-03T21:59:00.000Z',
  } as GovernedProjection;
}

describe('the row model carries what the proposal says, and only when it says it', () => {
  test('content fields pass through for a proposal that has them', () => {
    const row = buildPlansModel(projection([FORGE])).rows.find((r) => r.id === FORGE.draftId)!;
    expect(row.summary).toBe(FORGE.summary);
    expect(row.steps).toHaveLength(4);
    expect(row.ownerDecisions).toHaveLength(2);
  });

  test('a record without content renders exactly as before — no invented fields', () => {
    const row = buildPlansModel(projection([OLDER])).rows.find((r) => r.id === OLDER.draftId)!;
    expect(row).not.toHaveProperty('summary');
    expect(row).not.toHaveProperty('steps');
    expect(row).not.toHaveProperty('ownerDecisions');
  });
});

describe('two proposals on the Plans screen are never twins', () => {
  test('the row shows the vision and counts steps and decisions', () => {
    render(<PlansScreen state={projection([FORGE, OLDER])} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('one real Forge outcome');
    expect(body).toContain('4 steps');
    expect(body).toContain('2 decisions it will ask you for');
    // The older one still says what it always said, and nothing more.
    expect((body.match(/Written from your objective\./g) ?? []).length).toBe(2);
  });
});

describe('the detail view lets the owner read the proposal before deciding', () => {
  test('vision, steps with risk, and the decisions it will ask for are all shown', () => {
    render(<PlanDetail state={projection([FORGE])} now={NOW} planId={FORGE.draftId} onBack={() => {}} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('What it sets out to do');
    expect(body).toContain('one real Forge outcome');
    expect(body).toContain('C1-configured-offline-proof');
    expect(body).toContain('C3-bounded-real-forge-change');
    expect(body).toContain('high risk');
    expect(body).toContain('Decisions it will ask you for');
    expect(body).toContain('widening the worker write grant');
    // And it still says what approval does and does not do.
    expect(body).toContain('Nothing runs until you also press Start this plan');
    expect(screen.getByRole('button', { name: 'Approve & Start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve only' })).toBeTruthy();
  });

  test('a proposal without content keeps the honest empty line', () => {
    render(<PlanDetail state={projection([OLDER])} now={NOW} planId={OLDER.draftId} onBack={() => {}} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('This is a proposal. Its steps are created when you approve it and start it.');
    expect(body).not.toContain('What it sets out to do');
  });
});

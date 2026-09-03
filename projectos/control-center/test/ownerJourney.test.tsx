// @vitest-environment jsdom
/**
 * THE OWNER JOURNEY, SHORTENED WITHOUT WEAKENING ANYTHING.
 *
 * 2026-09-03: the owner approved a plan on the Plans tab, could not find how to start it, and when he
 * did, the loop stopped BLOCKED with `ownerRequired: true` while the Overview still said "Ready" and
 * offered "Start something new" — the checkpoint that knew had no reader on the owner surface.
 *
 * Three things are held here:
 *  1. the loop's checkpoint is projected and becomes a plain-English blocking item on the Overview;
 *  2. a proposal waiting for a decision is the Overview's next action, not a second objective form;
 *  3. "Approve & Start" orchestrates the SAME three governed verbs in order, waits for the runtime's
 *     own records between them, and stops at the first refusal — it invents no authority.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PlansScreen } from '../src/ux/PlansScreen';
import { buildPlansModel } from '../src/ux/planStateModel';
import { buildHomeModel, plainStop } from '../src/owner/homeModel';
import { buildContinueWorking } from '../src/owner/continueWorkingModel';
import { projectGovernedState } from '../src/governed/governedProjection';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection, GovernedPlanDraftView, GovernedWorkView } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-03T23:00:00.000Z');

const DRAFT: GovernedPlanDraftView = {
  draftId: 'spd1',
  planStatus: 'PLAN DRAFTED',
  generatedAt: '2026-09-03T22:21:21.098Z',
  decisionState: 'none',
  decisionId: null,
  origin: 'authored',
  summary: 'Make routine governed ProjectOS changes complete in seconds or minutes.',
  steps: [{ id: 'validation-cache', purpose: 'Cache.', risk: 'high' }],
  ownerDecisions: [],
};

const BLOCKED: GovernedWorkView = {
  phaseId: 'validation-cache',
  state: 'BLOCKED',
  stopCode: 'CORRECTION_EXHAUSTED',
  stopDetail: '6 required check(s) failing: … the worker holds no write authority over the failing target',
  ownerRequired: true,
  sessionId: 'validation-cache-007d5b192748-5d9e3ba3',
  updatedAt: '2026-09-03T22:32:09.633Z',
};

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
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
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Every phase in the approved plan is complete.',
    observedAt: '2026-09-03T22:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

describe('the loop checkpoint reaches the owner', () => {
  test('a BLOCKED, owner-required checkpoint is a blocking item in plain words, with the loop\'s words underneath', () => {
    const home = buildHomeModel(projection({ work: BLOCKED }));
    const item = home.ownerActions.find((a) => a.id === 'work:validation-cache');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('blocking');
    expect(item!.title).toContain('could not finish "validation-cache" on its own');
    expect(item!.detail).toContain('needs a decision from you');
    expect(item!.detail).toContain('holds no write authority');
    // And the Overview's primary becomes "Action needed", never "Start something new".
    const next = buildContinueWorking(projection({ work: BLOCKED }), home.ownerActions, NOW);
    expect(next.status).toBe('Waiting for you');
    expect(next.primary.heading).toBe('Action needed');
  });

  test('a completed or non-owner checkpoint raises nothing', () => {
    expect(buildHomeModel(projection({ work: { ...BLOCKED, ownerRequired: false } })).ownerActions).toEqual([]);
    expect(buildHomeModel(projection({ work: { ...BLOCKED, state: 'COMPLETE' } })).ownerActions).toEqual([]);
    expect(buildHomeModel(projection({ work: null })).ownerActions).toEqual([]);
  });

  test('an unknown stop code is reported truthfully, not invented', () => {
    const p = plainStop({ ...BLOCKED, stopCode: 'SOMETHING_NEW', stopDetail: 'x happened' });
    expect(p.title).toContain('stopped on "validation-cache" and needs you');
    expect(p.detail).toBe('SOMETHING_NEW: x happened');
  });

  test('the projection carries the checkpoint, bounded, and null when there is none', () => {
    const inputs = (workRecord: Record<string, unknown> | null) => ({
      config: { projectId: 'projectos', projectName: 'ProjectOS', repo: 'r', localPath: 'C:/x', protectedBranches: [] },
      plan: { planId: 'p', planVersion: '1.0', planStatus: 'PLAN READY', phases: [] },
      currentState: null,
      phaseRecords: [],
      readiness: { ready: true, reasons: [] },
      planPath: 'plan.json',
      branch: null,
      head: null,
      observedAt: '2026-09-03T22:59:00.000Z',
      workRecord,
    });
    const withWork = projectGovernedState(inputs({ phaseId: 'validation-cache', state: 'BLOCKED', lastStopCode: 'CORRECTION_EXHAUSTED', lastStopDetail: 'd'.repeat(2000), ownerRequired: true, sessionId: 's1', updatedAt: 't' }) as never);
    expect(withWork.connected).toBe(true);
    if (withWork.connected) {
      expect(withWork.work?.phaseId).toBe('validation-cache');
      expect(withWork.work?.ownerRequired).toBe(true);
      expect(withWork.work?.stopDetail!.length).toBeLessThanOrEqual(600);
    }
    const without = projectGovernedState(inputs(null) as never);
    if (without.connected) expect(without.work).toBeNull();
  });
});

describe('a waiting proposal is the next action', () => {
  test('with nothing in play and an undecided proposal, the Overview offers to review it on Plans', () => {
    const state = projection({ planDrafts: [DRAFT] });
    const next = buildContinueWorking(state, buildHomeModel(state).ownerActions, NOW);
    expect(next.primary.kind).toBe('review');
    expect(next.primary.target).toBe('plans');
    expect(next.primary.heading).toBe('A plan is waiting for your decision');
    expect(next.primary.detail).toContain('seconds or minutes');
  });

  test('with no proposal the Overview still offers to start something new', () => {
    const state = projection();
    const next = buildContinueWorking(state, buildHomeModel(state).ownerActions, NOW);
    expect(next.primary.kind).toBe('start');
  });
});

describe('Approve & Start orchestrates the existing verbs, in order, and stops at a refusal', () => {
  const approvedView = (): GovernedProjection =>
    projection({ planDrafts: [{ ...DRAFT, decisionState: 'approved', decisionId: 'PLANDEC-1' }] });
  const activeView = (): GovernedProjection =>
    projection({
      planDrafts: [{ ...DRAFT, decisionState: 'consumed', decisionId: 'PLANDEC-1' }],
      plan: { planId: 'plan-spd1', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'p.json', supersedes: null },
      nextStartablePhase: { phaseId: 'validation-cache', description: 'Cache', status: 'not-started', dependsOn: [], unmetDependencies: [], startable: true, requiredOwnerGates: [], requiredBrowserProof: false, history: [], closedByRecord: false },
    });

  test('the row offers Approve & Start, Approve only, and Reject', () => {
    const row = buildPlansModel(projection({ planDrafts: [DRAFT] })).rows.find((r) => r.id === 'spd1')!;
    expect(row.actions.map((a) => a.id)).toEqual(['open', 'approve-start', 'approve', 'reject']);
    // The orchestrated action carries the SAME arguments as a plain approve - nothing extra.
    expect(row.actions.find((a) => a.id === 'approve-start')!.args).toEqual({ draftId: 'spd1', decision: 'approve' });
  });

  test('the confirmation says exactly what pressing it does', () => {
    render(<PlansScreen state={projection({ planDrafts: [DRAFT] })} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Start' }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('Approve this plan and let ProjectOS start?');
    expect(body).toContain('record your approval, make this the active plan, and begin the first step');
    expect(body).toContain('stops to ask you before anything protected');
    expect(body).toContain('Each of the three steps is recorded on its own');
  });

  test('decide, then activate once the runtime shows the decision, then start once the plan is ready', async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb, args) => {
      calls.push(verb);
      if (verb === 'plan.decide') {
        expect(args).toEqual({ draftId: 'spd1', decision: 'approve' });
        return { ok: true, lines: ['Decision PLANDEC-1 recorded and committed.'] };
      }
      if (verb === 'plan.activate') {
        expect(args).toEqual({ draftId: 'spd1', decisionId: 'PLANDEC-1' });
        return { ok: true, lines: ['Plan plan-spd1 activated.'] };
      }
      if (verb === 'run.start') return { ok: true, lines: ['Governed run started.'] };
      throw new Error('unexpected verb ' + verb);
    });
    const { rerender } = render(<PlansScreen state={projection({ planDrafts: [DRAFT] })} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve & Start' }));
    await waitFor(() => expect(calls).toEqual(['plan.decide']));
    // The runtime re-emits state showing the committed decision; only then may activation be asked for.
    rerender(<PlansScreen state={approvedView()} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    await waitFor(() => expect(calls).toEqual(['plan.decide', 'plan.activate']), { timeout: 5_000 });
    rerender(<PlansScreen state={activeView()} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    await waitFor(() => expect(calls).toEqual(['plan.decide', 'plan.activate', 'run.start']), { timeout: 5_000 });
    await waitFor(() => expect(document.body.textContent).toContain('ProjectOS is working.'));
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test('a refused decision stops everything: no activation, no run', async () => {
    const calls: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      calls.push(verb);
      return { ok: false, lines: ['REFUSED (DECISION_REPLAY): this draft was already decided.'] };
    });
    render(<PlansScreen state={projection({ planDrafts: [DRAFT] })} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve & Start' }));
    await waitFor(() => expect(document.body.textContent).toContain('REFUSED (DECISION_REPLAY)'));
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toEqual(['plan.decide']);
  });

  test('an approval that already committed (DECISION_EXISTS) is read back and carried on, not reported as failure', async () => {
    const calls: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      calls.push(verb);
      if (verb === 'plan.decide') return { ok: false, lines: ['REFUSED (DECISION_EXISTS): a decision for this draft is already recorded.'] };
      if (verb === 'plan.activate') return { ok: true, lines: ['Plan activated.'] };
      return { ok: true, lines: ['Governed run started.'] };
    });
    const { rerender } = render(<PlansScreen state={projection({ planDrafts: [DRAFT] })} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve & Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve & Start' }));
    await waitFor(() => expect(calls).toEqual(['plan.decide']));
    rerender(<PlansScreen state={approvedView()} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    await waitFor(() => expect(calls).toEqual(['plan.decide', 'plan.activate']), { timeout: 5_000 });
    rerender(<PlansScreen state={activeView()} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    await waitFor(() => expect(calls).toEqual(['plan.decide', 'plan.activate', 'run.start']), { timeout: 5_000 });
  });

  test('a secret-shaped stop detail is withheld from the Overview', () => {
    const inputs = {
      config: { projectId: 'projectos', projectName: 'ProjectOS', repo: 'r', localPath: 'C:/x', protectedBranches: [] },
      plan: { planId: 'p', planVersion: '1.0', planStatus: 'PLAN READY', phases: [] },
      currentState: null, phaseRecords: [], readiness: { ready: true, reasons: [] }, planPath: 'plan.json', branch: null, head: null,
      observedAt: 't',
      workRecord: { phaseId: 'x', state: 'BLOCKED', lastStopCode: 'WORKER_REFUSED', lastStopDetail: 'stderr: api_key=abcdefghijklmnop1234 rejected', ownerRequired: true, sessionId: 's', updatedAt: 't' },
    };
    const p = projectGovernedState(inputs as never);
    if (p.connected) expect(p.work?.stopDetail).toContain('withheld');
  });

  test('"Approve only" still records the decision and starts nothing', async () => {
    const calls: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      calls.push(verb);
      return { ok: true, lines: ['Decision recorded.'] };
    });
    render(<PlansScreen state={projection({ planDrafts: [DRAFT] })} now={NOW} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve' }));
    await waitFor(() => expect(document.body.textContent).toContain('Decision recorded.'));
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toEqual(['plan.decide']);
  });
});

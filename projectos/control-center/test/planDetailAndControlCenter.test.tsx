// @vitest-environment jsdom
/**
 * STAGE 4 AND STAGE 5, DRIVEN AS THE OWNER WOULD.
 *
 * PLAN DETAIL must distinguish what is done, what is happening and what is still to come — from the
 * phases themselves, in order — and must show evidence only where evidence exists.
 *
 * THE CONTROL CENTER must keep what was said across a remount, refuse what ProjectOS cannot do, and
 * dispatch a committed decision exactly once and only after a second question.
 *
 * NO PROVIDER CALL: every dispatch is intercepted, and nothing here resolves to `plan.draft`.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PlanDetail } from '../src/ux/PlanDetail';
import { ControlCenter, type ControlCenterEntry } from '../src/ux/ControlCenter';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-08-27T20:00:00.000Z');

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 1, totalPhaseCount: 3, completionPercentage: 33, completedPhases: [], pendingPhases: [] },
    phases: [
      { phaseId: 'ONE', description: 'Specification', status: 'closed', dependsOn: [], unmetDependencies: [], startable: false, requiredOwnerGates: [], requiredBrowserProof: false, history: [{ from: 'draft', to: 'closed', by: 'owner', at: '2026-08-26T10:00:00.000Z' }], closedByRecord: false },
      { phaseId: 'TWO', description: 'Existing system', status: 'implementing', dependsOn: ['ONE'], unmetDependencies: [], startable: true, requiredOwnerGates: [], requiredBrowserProof: false, history: [], closedByRecord: false },
      { phaseId: 'THREE', description: 'Prove', status: 'not-started', dependsOn: ['TWO'], unmetDependencies: ['TWO'], startable: false, requiredOwnerGates: ['productionDeployGate'], requiredBrowserProof: false, history: [], closedByRecord: false },
    ],
    activePhase: { phaseId: 'TWO', description: 'Existing system', status: 'implementing', dependsOn: [], unmetDependencies: [], startable: true, requiredOwnerGates: [], requiredBrowserProof: false, history: [], closedByRecord: false },
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
    nextSafeAction: 'Continue TWO.',
    observedAt: '2026-08-27T19:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

describe('plan detail shows the real phases, in order, with real states', () => {
  test('completed, current and future are distinguished, and the plan order is kept', () => {
    render(<PlanDetail state={projection()} now={NOW} onBack={() => {}} />);
    const names = Array.from(document.querySelectorAll('.ux-stepname')).map((n) => n.textContent);
    expect(names).toEqual(['Specification', 'Existing system', 'Prove']);
    const states = Array.from(document.querySelectorAll('.ux-stepstate')).map((n) => n.textContent);
    expect(states).toEqual(['Done', 'Now', 'Next']);
  });

  test('a step waiting on an earlier one says which, and is not called blocked', () => {
    render(<PlanDetail state={projection()} now={NOW} onBack={() => {}} />);
    expect(screen.getByText(/Waiting for TWO to finish first/)).toBeTruthy();
  });

  test('a step that will ask the owner announces it BEFORE it runs', () => {
    render(<PlanDetail state={projection()} now={NOW} onBack={() => {}} />);
    expect(screen.getByText(/asks you before it does anything protected/)).toBeTruthy();
  });

  test('evidence is offered per step, and an empty record says it is empty', () => {
    render(<PlanDetail state={projection()} now={NOW} onBack={() => {}} />);
    expect(screen.getAllByText('Evidence').length).toBe(3);
    expect(screen.getAllByText('Nothing has been recorded against this step yet.').length).toBe(2);
  });

  test('recorded transitions are shown as the evidence they are', () => {
    render(<PlanDetail state={projection()} now={NOW} onBack={() => {}} />);
    expect(screen.getByText(/draft → closed · owner/)).toBeTruthy();
  });

  test('no active plan is stated, not drawn as an empty shell', () => {
    render(
      <PlanDetail
        state={projection({ plan: { planId: '', planVersion: '', declaredStatus: '', ready: false, unmetReasons: [], planPath: '', supersedes: null } })}
        now={NOW}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('There is no active plan')).toBeTruthy();
  });

  test('a blocked plan is offered no run control at all', () => {
    render(<PlanDetail state={projection({ blockers: ['git is unreachable'] })} now={NOW} onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: /Start|Resume|Pause/ })).toBe(null);
    expect(screen.getByText('git is unreachable')).toBeTruthy();
  });
});

function renderCC(state: GovernedProjection | null, entries: readonly ControlCenterEntry[] = []) {
  // The shell owns the transcript in real use; here a closure stands in for it, and applies the
  // functional update exactly as React would.
  let held: readonly ControlCenterEntry[] = entries;
  const setEntries = (update: (p: readonly ControlCenterEntry[]) => readonly ControlCenterEntry[]) => {
    held = update(held);
  };
  const view = render(
    <ControlCenter
      state={state}
      now={NOW}
      entries={held}
      setEntries={setEntries}
      onNavigate={() => {}}
      onStartObjective={() => {}}
      objectiveOpen={false}
      objectivePanel={null}
    />,
  );
  return { view, get entries() { return held; } };
}

describe('the control center says what it cannot do', () => {
  test('an upload request is refused in the transcript, and dispatches nothing', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    const cc = renderCC(projection());
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'use this uploaded document' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(cc.entries.length).toBeGreaterThan(1));
    expect(JSON.stringify(cc.entries)).toContain('cannot take files');
    expect(spy).not.toHaveBeenCalled();
  });

  test('upload and voice controls are present, disabled, and say why', () => {
    renderCC(projection());
    const attach = screen.getByRole('button', { name: /Attach a file/ }) as HTMLButtonElement;
    const talk = screen.getByRole('button', { name: /Talk to ProjectOS/ }) as HTMLButtonElement;
    expect(attach.disabled).toBe(true);
    expect(talk.disabled).toBe(true);
    expect(attach.title).toContain('cannot take files');
  });
});

describe('a committed decision asks first and dispatches once', () => {
  const draft = { draftId: 'D1', planStatus: 'PROPOSAL', generatedAt: 't', decisionState: 'none', decisionId: null, origin: 'authored' } as GovernedPlanDraftView;

  test('typing approve asks a second question and dispatches nothing yet', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['recorded'] });
    renderCC(projection({ planDrafts: [draft] }));
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'approve this plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText(/Approve this plan\?/)).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();
  });

  test('confirming dispatches plan.decide once, with the draft and the verdict', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['recorded'] });
    renderCC(projection({ planDrafts: [draft] }));
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'approve this plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => screen.getByRole('button', { name: 'Yes, go ahead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, go ahead' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toBe('plan.decide');
    expect(spy.mock.calls[0]![2]).toEqual({ draftId: 'D1', decision: 'approve' });
  });

  test('Escape cancels the question and dispatches nothing', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    renderCC(projection({ planDrafts: [draft] }));
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'approve this plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => screen.getByRole('button', { name: 'Yes, go ahead' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Yes, go ahead' })).toBe(null));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('what was said survives losing the runtime', () => {
  test('the transcript is rendered from the state the SHELL holds, so a remount keeps it', () => {
    const said: readonly ControlCenterEntry[] = [
      { id: 'a', who: 'owner', lines: ['why is this blocked?'], failed: false },
      { id: 'b', who: 'projectos', lines: ['git is unreachable'], failed: false },
    ];
    // First with a live projection…
    const first = render(
      <ControlCenter state={projection()} now={NOW} entries={said} setEntries={() => {}} onNavigate={() => {}} onStartObjective={() => {}} objectiveOpen={false} objectivePanel={null} />,
    );
    expect(screen.getByText('git is unreachable')).toBeTruthy();
    first.unmount();

    // …then remounted with NO projection at all, as a heartbeat lapse would leave it.
    render(
      <ControlCenter state={null} now={NOW} entries={said} setEntries={() => {}} onNavigate={() => {}} onStartObjective={() => {}} objectiveOpen={false} objectivePanel={null} />,
    );
    expect(screen.getByText('git is unreachable')).toBeTruthy();
    expect(screen.getByText('why is this blocked?')).toBeTruthy();
    expect(screen.getByText('No project is reporting yet')).toBeTruthy();
  });

  test('with no projection, commands are refused rather than dispatched', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    const cc = renderCC(null);
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'continue this plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(cc.entries.length).toBeGreaterThan(1));
    expect(spy).not.toHaveBeenCalled();
  });

  test('an empty transcript offers examples rather than a blank box', () => {
    renderCC(projection());
    expect(screen.getByText('Continue this plan')).toBeTruthy();
  });
});

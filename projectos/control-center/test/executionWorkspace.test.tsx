// @vitest-environment jsdom
/**
 * THE EXECUTION WORKSPACE'S INTERACTIONS — the ones a pure-model test cannot see.
 *
 * A review found two defects here that only a rendered test catches: an Approve button that fired
 * `approval.decide` on `pendingApprovals[0]` with no confirmation (permanently answering a request
 * the owner may not have been reading), and a Direction box whose confirmation told the owner to
 * "ask again", which re-parsed the same words into the same unconfirmed intent so nothing could
 * ever be sent. Both are pinned here.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ExecutionWorkspace } from '../src/ux/ExecutionWorkspace';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection, GovernedPhaseView } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-04T11:00:00.000Z');

function phase(over: Partial<GovernedPhaseView> = {}): GovernedPhaseView {
  return {
    phaseId: 'validation-cache',
    description: 'Deliver safe validation caching.',
    status: 'not-started',
    dependsOn: [],
    unmetDependencies: [],
    startable: true,
    requiredOwnerGates: [],
    requiredBrowserProof: false,
    acceptanceCriteria: [],
    requiredValidators: ['validate-no-secrets'],
    requiredReviews: [],
    riskLevel: 'high',
    autonomyLevel: 'gated-execution',
    history: [],
    closedByRecord: false,
    ...over,
  };
}

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'r', localPath: 'C:/dev/ProjectOS', branch: null, head: null, protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'p', planVersion: '1.3', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'p.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 4, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [phase()],
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
    nextSafeAction: '',
    observedAt: '2026-09-04T11:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

/** An undecided proposal: the simplest real command this box can resolve, and it confirms. */
const DRAFT = {
  draftId: 'd1',
  planStatus: 'PLAN DRAFTED',
  generatedAt: 't',
  decisionState: 'none' as const,
  decisionId: null,
  origin: 'authored',
  summary: 'A proposal.',
  steps: [],
  ownerDecisions: [],
};

const HELD = {
  phaseId: 'validation-cache',
  state: 'BLOCKED',
  stopCode: 'CONTINUATION_READY',
  stopDetail: 'every required check passed',
  ownerRequired: true,
  sessionId: null,
  updatedAt: 't',
};

function draw(state: GovernedProjection, spies: Partial<{ nav: (t: string) => void; obj: () => void; ev: () => void }> = {}) {
  return render(
    <ExecutionWorkspace
      state={state}
      liveRun={null}
      now={NOW}
      onOpenEvidence={spies.ev ?? (() => {})}
      onNavigate={(t) => spies.nav?.(t)}
      onStartObjective={() => spies.obj?.()}
    />,
  );
}

describe('an owner gate never decides an approval this screen chose', () => {
  test('a held gate with approvals waiting offers NO approve button of its own', () => {
    const send = vi.spyOn(governedClient, 'requestGovernedCommand');
    draw(
      projection({
        work: HELD as never,
        pendingApprovals: [
          { id: 'APR-1', action: 'commit', gated: true, prohibited: false, risk: 'low', requestedBy: 'loop', requestedAt: 't' },
          { id: 'APR-2', action: 'production-deploy', gated: true, prohibited: false, risk: 'high', requestedBy: 'loop', requestedAt: 't' },
        ],
      }),
    );
    // The gate states the situation; it does not present a decision of its own.
    expect(document.body.textContent).toContain('2 requests are waiting for your decision');
    // Both requests are named by the inbox, so the owner sees WHICH is which.
    expect(document.body.textContent).toContain('commit');
    expect(document.body.textContent).toContain('production-deploy');
    // Nothing was dispatched merely by rendering.
    expect(send).not.toHaveBeenCalled();
  });

  test('a held gate with nothing to answer says so plainly', () => {
    draw(projection({ work: HELD as never }));
    expect(document.body.textContent).toContain('no request for this screen to answer');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull();
  });
});

describe('Direction asks a second question, then actually sends', () => {
  test('a consequential sentence is held until it is confirmed, then dispatched once', async () => {
    const sent: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      sent.push(verb);
      return { ok: true, lines: ['Decision recorded.'] };
    });
    draw(projection({ planDrafts: [DRAFT] as never }));
    const box = screen.getByLabelText('Tell ProjectOS what you want');
    fireEvent.change(box, { target: { value: 'approve the plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // Nothing yet: the question is asked first.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, do it' })).toBeTruthy());
    expect(sent).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, do it' }));
    await waitFor(() => expect(sent).toEqual(['plan.decide']));
    await waitFor(() => expect(document.body.textContent).toContain('Decision recorded.'));
  });

  test('cancelling the second question sends nothing', async () => {
    const sent: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      sent.push(verb);
      return { ok: true, lines: ['x'] };
    });
    draw(projection({ planDrafts: [DRAFT] as never }));
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'approve the plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Yes, do it' })).toBeNull();
  });

  test('a question answered by what is already known dispatches nothing', async () => {
    const send = vi.spyOn(governedClient, 'requestGovernedCommand');
    draw(projection());
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'why is this blocked?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await new Promise((r) => setTimeout(r, 200));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the screen does what it says it is doing', () => {
  test('an instruction to go somewhere actually navigates', async () => {
    const nav = vi.fn();
    draw(projection(), { nav });
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'show me what happened' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(nav).toHaveBeenCalledWith('activity'));
  });

  test('unresolved high findings for the current step are shown on it', () => {
    draw(
      projection({
        nextStartablePhase: phase(),
        evidence: {
          phaseId: 'validation-cache',
          sessionId: 's1',
          collectedAt: 't',
          checks: [],
          reviewsRecorded: [],
          findings: [
            { id: 'SEC-9', severity: 'HIGH', summary: 'A real unresolved problem.', resolved: false },
            { id: 'SEC-7', severity: 'HIGH', summary: 'Already dealt with.', resolved: true },
          ],
          changedFileCount: 1,
        },
      }),
    );
    expect(document.body.textContent).toContain('A real unresolved problem.');
    expect(document.body.textContent).not.toContain('Already dealt with.');
  });
});

/**
 * THE CONVENTION IS NOT THE CONTROL.
 *
 * Every command `resolveIntent` produces today carries its own confirmation question. That is a
 * convention held in another file, and a convention is exactly what failed the first time this
 * screen acted on the owner's behalf. These pin both halves: the resolver's promise, and the
 * screen's own refusal to dispatch anything from free text without asking.
 */
describe('no command reaches the runtime from free text unasked', () => {
  test('every command the resolver can produce carries a confirmation', async () => {
    const { resolveIntent } = await import('../src/ux/controlCenterModel');
    const withEverything = projection({
      planDrafts: [DRAFT] as never,
      sessions: [{ sessionId: 's1', phaseId: 'validation-cache', startedAt: 't', state: 'started', workerId: 'w' }] as never,
      activePhase: phase({ status: 'in-progress' }),
    });
    const sentences = ['approve the plan', 'reject the plan', 'stop', 'pause', 'continue', 'resume', 'start the work', 'halt'];
    for (const text of sentences) {
      const intent = resolveIntent(text, withEverything);
      if (intent.kind !== 'command') continue;
      expect(intent.confirm, `"${text}" produced ${intent.verb} with no confirmation`).not.toBeNull();
    }
  });

  test('a command with no confirmation of its own is still asked about', async () => {
    const sent: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      sent.push(verb);
      return { ok: true, lines: ['done'] };
    });
    const model = await import('../src/ux/controlCenterModel');
    vi.spyOn(model, 'resolveIntent').mockReturnValue({
      kind: 'command',
      verb: 'run.start',
      args: {},
      say: 'Starting.',
      confirm: null,
    } as never);

    draw(projection());
    fireEvent.change(screen.getByLabelText('Tell ProjectOS what you want'), { target: { value: 'anything at all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, do it' })).toBeTruthy());
    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain('Send "run.start" to ProjectOS?');
  });
});

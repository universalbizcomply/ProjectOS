// @vitest-environment jsdom
/**
 * Session resume selection — Product Completion item 6.
 *
 * `run.resume` existed end-to-end in the governed command channel (sidecar spawn, arg spec, CLI
 * mapping) with no UI ever calling it: an owner would have had to already know a session id to type
 * into a box that did not exist. This exercises the real surface: a resumable session (one whose
 * worker exited but the phase did not finish) offers a select + Resume button that dispatches
 * `run.resume` with the real phaseId and sessionId, and the control is absent when there is nothing
 * to resume.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { GovernedActions } from '../src/owner/GovernedActions.js';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import * as governedClient from '../src/governed/governedClient.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import type { GovernedProjection, GovernedSessionView } from '../src/governed/types';

function renderActions(state: GovernedProjection) {
  const client = new DaemonClient(createFakeTransport(), createFakeScheduler());
  return render(
    <DaemonProvider client={client}>
      <GovernedActions state={state} />
    </DaemonProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projection(sessions: readonly GovernedSessionView[]): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: {
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      branch: 'main',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'plan',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'plan.json',
      supersedes: null,
    },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: {
      phaseId: 'PHASE1A',
      description: '',
      status: 'implementing',
      dependsOn: [],
      unmetDependencies: [],
      startable: false,
      requiredOwnerGates: [],
      requiredBrowserProof: false,
      history: [],
      closedByRecord: false,
    },
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-25T09:00:00.000Z',
    sessions,
  } as GovernedProjection;
}

describe('resuming a session', () => {
  test('no resume control appears when there is nothing to resume', () => {
    renderActions(projection([]));
    expect(screen.queryByLabelText('Or resume a session that stopped')).toBeNull();
  });

  test('a session written as "started" IS offered — the runtime decides resumability, not this filter', () => {
    // REBASELINED after running against the real records: not one of this project's fourteen
    // sessions was ever written as `exited`, so a state-based filter matched nothing and the resume
    // control never appeared. The runner does not consult state either; it validates the named
    // session itself and refuses in its own words.
    renderActions(
      projection([
        { sessionId: 'S1', phaseId: 'PHASE1A', workerId: 'w', kind: 'claude', startedAt: '2026-08-25T08:00:00Z', state: 'started', exitCode: null },
      ]),
    );
    expect(screen.getByLabelText('Or resume a session that stopped')).toBeTruthy();
  });

  test('a session for a DIFFERENT phase is not offered here', () => {
    renderActions(
      projection([
        { sessionId: 'S1', phaseId: 'SOME-OTHER-PHASE', workerId: 'w', kind: 'claude', startedAt: '2026-08-25T08:00:00Z', state: 'exited', exitCode: 1 },
      ]),
    );
    expect(screen.queryByLabelText('Or resume a session that stopped')).toBeNull();
  });

  test('defaults to the first resumable session in the (already newest-first) list', () => {
    // governedProjection's sessionsOf sorts newest-first before this ever reaches the component;
    // this fixture supplies that same order rather than re-deriving the sort here.
    renderActions(
      projection([
        { sessionId: 'S-NEW', phaseId: 'PHASE1A', workerId: 'w', kind: 'claude', startedAt: '2026-08-25T08:00:00Z', state: 'exited', exitCode: 1 },
        { sessionId: 'S-OLD', phaseId: 'PHASE1A', workerId: 'w', kind: 'claude', startedAt: '2026-08-25T07:00:00Z', state: 'exited', exitCode: 1 },
      ]),
    );
    const select = screen.getByLabelText('Or resume a session that stopped') as HTMLSelectElement;
    expect(select.value).toBe('S-NEW');
  });

  test('clicking Resume dispatches run.resume with the real phaseId and sessionId, nothing else', async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['resumed'] });
    renderActions(
      projection([
        { sessionId: 'S1', phaseId: 'PHASE1A', workerId: 'w', kind: 'claude', startedAt: '2026-08-25T08:00:00Z', state: 'exited', exitCode: 1 },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: '▶ Resume' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, verb, args] = spy.mock.calls[0]!;
    expect(verb).toBe('run.resume');
    expect(args).toEqual({ phaseId: 'PHASE1A', sessionId: 'S1' });
  });
});

// @vitest-environment jsdom
/**
 * Owner Chat is genuinely actionable for the narrow set of actions ownerChatActions.ts recognises —
 * driven through the mounted component, not just the pure matcher unit tests in
 * ownerChatActions.test.ts. A real click must dispatch the real governed command and show the
 * runtime's own words back, exactly like every other governed surface in this app.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { OwnerChat } from '../src/owner/OwnerChat.js';
import * as governedClient from '../src/governed/governedClient.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'x/x', localPath: 'C:/x', branch: 'main', head: 'a'.repeat(40), protectedBranches: ['main'], onProtectedBranch: false },
    plan: { planId: 'p', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude Code', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-25T09:00:00Z',
    ...over,
  } as GovernedProjection;
}

function mount() {
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, createFakeScheduler());
  render(
    <DaemonProvider client={client}>
      <OwnerChat />
    </DaemonProvider>,
  );
  client.start();
  return { transport };
}

function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('Owner Chat offers a real action button for a recognised, unambiguous request', () => {
  test('typing a start request against a startable live phase offers a real Start button', () => {
    const { transport } = mount();
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ activePhase: { phaseId: 'PHASE1A', status: 'not-started', startable: true } }),
      }),
    );
    ask('please start the phase');
    expect(screen.getByRole('button', { name: '▶ Start governed execution for PHASE1A' })).toBeTruthy();
  });

  test('clicking it dispatches run.start for real and shows the runtime\'s own reply', async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['Started PHASE1A.'] });
    const { transport } = mount();
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ activePhase: { phaseId: 'PHASE1A', status: 'not-started', startable: true } }),
      }),
    );
    ask('please start the phase');
    fireEvent.click(screen.getByRole('button', { name: '▶ Start governed execution for PHASE1A' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, verb, args] = spy.mock.calls[0]!;
    expect(verb).toBe('run.start');
    expect(args).toEqual({ phaseId: 'PHASE1A' });
    expect(await screen.findByText('Started PHASE1A.')).toBeTruthy();
    // The button retires once the real command has been dispatched — it is not offered twice.
    expect(screen.queryByRole('button', { name: /Start governed execution/ })).toBeNull();
  });

  test('no button appears for an ordinary status question', () => {
    const { transport } = mount();
    act(() => transport.emit({ kind: 'governed', state: projection() }));
    ask('what is the plan status?');
    expect(screen.queryByRole('button', { name: /^▶/ })).toBeNull();
  });

  test('nothing is dispatched merely by asking — only a click sends anything', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand');
    const { transport } = mount();
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ activePhase: { phaseId: 'PHASE1A', status: 'not-started', startable: true } }),
      }),
    );
    ask('please start the phase');
    expect(spy).not.toHaveBeenCalled();
  });
});

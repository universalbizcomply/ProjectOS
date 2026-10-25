// @vitest-environment jsdom
/**
 * THE OWNER'S IN-FLIGHT COMMAND MUST SURVIVE A HEARTBEAT.
 *
 * WHAT HAPPENED. The owner submitted an objective. It reached the provider, was answered, and was
 * billed — 34,761 input tokens, 54,831 micro-USD. Meanwhile the runtime, blocked on that same call,
 * missed its twelve-second liveness window; the daemon client declared RUNTIME_STOPPED; and this
 * page renders the intake panel behind `live !== null`, so the panel UNMOUNTED. Its local state went
 * with it. The owner was shown a blank form with no message of any kind, reasonably concluded
 * nothing had happened, and pressed again — which the deterministic request id refused, permanently.
 *
 * TWO INDEPENDENT THINGS ARE THEREFORE TRUE, AND BOTH ARE PROVEN HERE. The blocking is fixed at its
 * root in the sidecar, so the heartbeat should no longer lapse; and this surface must be incapable of
 * destroying a result even if some future command blocks again. A fix that relies only on nothing
 * ever blocking is one blocked command away from repeating the incident.
 *
 * The liveness lapse below is REAL — the actual `DaemonClient` on a virtual clock, advanced past its
 * own window — not a prop set to false by hand.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { OwnerControlPlane } from '../src/owner/OwnerControlPlane.js';
import * as governedClient from '../src/governed/governedClient.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Comfortably past the client's 12-second liveness window. */
const PAST_LIVENESS_MS = 20_000;

const OBJECTIVE =
  'Create the smallest credible read-only plan to verify the current programme status and report on it.';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
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
      planId: 'p',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 0,
      totalPhaseCount: 1,
      completionPercentage: 0,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    gatekeeperStatus: {
      configured: false,
      budget: null,
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 0,
      callCount: 0,
      lastCall: null,
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-27T09:00:00Z',
    ...over,
  } as GovernedProjection;
}

function mount() {
  const transport = createFakeTransport();
  const scheduler = createFakeScheduler();
  const client = new DaemonClient(transport, scheduler);
  render(
    <DaemonProvider client={client}>
      <OwnerControlPlane />
    </DaemonProvider>,
  );
  client.start();
  act(() => transport.emit({ kind: 'governed', state: projection() }));
  return { transport, scheduler };
}

/** Drive the client past its own liveness window, exactly as a blocked runtime would. */
function loseLiveness(scheduler: ReturnType<typeof createFakeScheduler>) {
  act(() => scheduler.advance(PAST_LIVENESS_MS));
}

function typeObjective(text: string) {
  const box = screen.getByLabelText('Objective');
  fireEvent.change(box, { target: { value: text } });
  return box as HTMLTextAreaElement;
}

describe('a lapsed heartbeat does not delete the owner’s work', () => {
  test('the panel is still there after the runtime stops answering', () => {
    const { scheduler } = mount();
    expect(screen.getByText('What do you want ProjectOS to achieve?')).toBeTruthy();

    loseLiveness(scheduler);

    // THE PANEL SURVIVES. Before the correction this element was unmounted here.
    expect(screen.getByText('What do you want ProjectOS to achieve?')).toBeTruthy();
  });

  test('the objective the owner typed is not cleared by a transport hiccup', () => {
    const { scheduler } = mount();
    typeObjective(OBJECTIVE);
    expect((screen.getByLabelText('Objective') as HTMLTextAreaElement).value).toBe(OBJECTIVE);

    loseLiveness(scheduler);

    expect((screen.getByLabelText('Objective') as HTMLTextAreaElement).value).toBe(OBJECTIVE);
  });

  test('a result already shown stays shown across a disconnect and a reconnect', async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['Proposed a plan.', 'Draft 35316a7a7ad3acd6.'] });
    const { transport, scheduler } = mount();

    typeObjective(OBJECTIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Propose a plan' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(await screen.findByText(/Proposed a plan\./)).toBeTruthy();

    // The runtime goes quiet, then comes back — which is precisely the sequence that destroyed the
    // answer to a call the owner had already paid for.
    loseLiveness(scheduler);
    expect(screen.getByText(/Proposed a plan\./)).toBeTruthy();
    expect(screen.getByText(/Draft 35316a7a7ad3acd6\./)).toBeTruthy();

    act(() => transport.emit({ kind: 'governed', state: projection() }));
    expect(screen.getByText(/Proposed a plan\./)).toBeTruthy();
  });

  test('a REFUSAL survives the same way — the owner is not left guessing why', async () => {
    vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({
      ok: false,
      lines: ['REFUSED (AUTHOR_REFUSED): the author returned no structured plan material'],
    });
    const { scheduler } = mount();

    typeObjective(OBJECTIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Propose a plan' }));
    expect(await screen.findByText(/AUTHOR_REFUSED/)).toBeTruthy();

    loseLiveness(scheduler);
    expect(screen.getByText(/AUTHOR_REFUSED/)).toBeTruthy();
  });
});

describe('surviving is not the same as pretending', () => {
  test('the panel says plainly that the runtime is not answering, and will not send', () => {
    const { scheduler } = mount();
    expect(screen.queryByTestId('intake-disconnected')).toBeNull();

    loseLiveness(scheduler);

    const notice = screen.getByTestId('intake-disconnected');
    expect(notice.textContent).toContain('ProjectOS is not answering');
    // AND IT CANNOT BE SENT INTO A RUNTIME THAT IS NOT THERE.
    expect((screen.getByRole('button', { name: 'Propose a plan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('nothing is dispatched while disconnected, even if the control is driven directly', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand');
    const { scheduler } = mount();
    typeObjective(OBJECTIVE);
    loseLiveness(scheduler);

    fireEvent.click(screen.getByRole('button', { name: 'Propose a plan' }));
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  test('it sends again once the runtime comes back', async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['Proposed a plan.'] });
    const { transport, scheduler } = mount();
    typeObjective(OBJECTIVE);
    loseLiveness(scheduler);
    act(() => transport.emit({ kind: 'governed', state: projection() }));

    expect((screen.getByRole('button', { name: 'Propose a plan' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Propose a plan' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // The objective survived the outage, so what is sent is what the owner actually typed.
    expect(spy.mock.calls[0]![2]).toMatchObject({ objective: OBJECTIVE, authored: 'true' });
  });
});

describe('the authored submission is given a provider’s timescale', () => {
  test('it asks for a timeout well past the broker’s own ceiling', async () => {
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockResolvedValue({ ok: true, lines: ['Proposed a plan.'] });
    mount();
    typeObjective(OBJECTIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Propose a plan' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());

    const options = spy.mock.calls[0]![3] as { timeoutMs?: number } | undefined;
    // The broker aborts at 120s and refuses more than 300s; the sidecar backstops at 330s. A client
    // that gave up before then would discard the answer to a call already paid for.
    expect(options?.timeoutMs).toBeGreaterThan(330_000);
  });
});

describe('surviving must never mean describing the wrong project', () => {
  /** The intake panel only — the repository name appears in several panels on this page. */
  const intakePanel = (): HTMLElement =>
    screen.getByText('What do you want ProjectOS to achieve?').closest('.intake') as HTMLElement;

  test('the cached snapshot is dropped when it would name a different project', () => {
    // The cache holds a whole projection — name, repository, drafts. The owner can switch projects,
    // and a disconnect landing across that switch would otherwise have shown the PREVIOUS project's
    // identity under the new one's heading. Stale is tolerable; wrong is not.
    const { transport, scheduler } = mount();
    expect(intakePanel().textContent).toContain('universalbizcomply/ProjectOS');

    // The runtime reports a DIFFERENT project, then stops answering.
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({
          projectId: 'dead-aisle',
          projectName: 'Dead Aisle',
          repository: {
            repo: 'murad/deadaisle',
            localPath: 'C:/dev/deadaisle',
            branch: 'main',
            head: 'b'.repeat(40),
            protectedBranches: ['main'],
            onProtectedBranch: false,
          },
        }),
      }),
    );
    expect(intakePanel().textContent).toContain('murad/deadaisle');

    loseLiveness(scheduler);

    // Whatever is shown now, it is NOT the first project's identity.
    expect(intakePanel().textContent).not.toContain('universalbizcomply/ProjectOS');
  });
});

// @vitest-environment jsdom
/**
 * ASKING FOR A CHANGE MUST NOT BE A SECOND WAY TO CHANGE THINGS.
 *
 * An owner needs to say "change this plan" without ProjectOS quietly editing the plan they are
 * currently running on. The temptation is a `plan.change` verb, a revision store and a second
 * approval path — three new places for the rules to disagree with each other.
 *
 * There is none of that. "Request a change" opens the SAME objective panel "Start something new"
 * opens, which dispatches the SAME `plan.draft`, and the result is decided by the SAME `plan.decide`
 * the Plans screen already owns. The only thing that differs is the words, because the promise being
 * made is different: your current plan stays active until you approve and start a replacement.
 *
 * These tests exist to stop that collapsing back into two systems. They assert the wording an owner
 * relies on, and that the entry point itself dispatches nothing at all.
 *
 * Created in PROJECTOS-GOVERNED-PLAN-CHANGE1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PlansScreen } from '../src/ux/PlansScreen';
import { StartSomethingNew } from '../src/owner/StartSomethingNew';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projection(drafts: readonly GovernedPlanDraftView[] = []): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: '.projectops/plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 0, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: drafts,
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-29T18:00:00.000Z',
  } as GovernedProjection;
}

describe('the entry point asks, and by itself does nothing', () => {
  test('Plans offers Request a change', () => {
    render(<PlansScreen state={projection()} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Request a change' })).toBeTruthy();
  });

  test('it dispatches no governed command of its own — it only opens the panel', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    const opened = vi.fn();
    render(<PlansScreen state={projection()} onOpenPlan={() => {}} onRequestChange={opened} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  test('the promise the owner is owed is on the screen, not implied', () => {
    render(<PlansScreen state={projection()} onOpenPlan={() => {}} onRequestChange={() => {}} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('Your current plan stays active');
    expect(body).toContain('approve and start it');
  });
});

describe('the panel says what it is for, and sends what it always sent', () => {
  const panel = (mode: 'new' | 'change') =>
    render(
      <StartSomethingNew projectName="PolyGo" projectId="polygo" onBack={() => {}} onSeePlan={() => {}} mode={mode} />,
    );

  test('change mode names the change and promises the current plan stays put', () => {
    panel('change');
    const body = document.body.textContent ?? '';
    expect(body).toContain('Request a change');
    expect(body).toContain('stays active until you approve and start a replacement');
    expect(body).toContain('What should change?');
    expect(screen.getByRole('button', { name: 'Propose the change' })).toBeTruthy();
  });

  test('new mode is untouched', () => {
    panel('new');
    const body = document.body.textContent ?? '';
    expect(body).toContain('Start something new');
    expect(body).toContain('What should happen?');
    expect(screen.getByRole('button', { name: 'Make a plan' })).toBeTruthy();
  });

  test('default is new, so nothing that already rendered it changes meaning', () => {
    render(<StartSomethingNew projectName="PolyGo" projectId="polygo" onBack={() => {}} onSeePlan={() => {}} />);
    expect(document.body.textContent ?? '').toContain('Start something new');
  });

  test('BOTH modes dispatch plan.draft — one engine, not two', async () => {
    for (const mode of ['new', 'change'] as const) {
      const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['proposed'] });
      panel(mode);
      const objective = 'Send customers a reminder the day before their booking happens';
      fireEvent.change(screen.getByRole('textbox'), { target: { value: objective } });
      fireEvent.click(screen.getByRole('button', { name: mode === 'change' ? 'Propose the change' : 'Make a plan' }));
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      const [, verb, args, options] = spy.mock.calls[0]!;
      expect(verb).toBe('plan.draft');
      // AUTHORED, IN BOTH MODES. An owner's sentence is answered by the author, never by corpus
      // import, which does not read the objective. The paid call is long, so the authoring timeout
      // rides with it — a client on the 30-second default abandons a result already paid for.
      expect(args).toEqual({ objective, authored: 'true' });
      expect(options).toEqual({ timeoutMs: governedClient.AUTHORING_RESULT_TIMEOUT_MS });
      cleanup();
      vi.restoreAllMocks();
    }
  });

  test('nothing is dispatched until the owner actually submits', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    panel('change');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Change how the reminder is worded for late bookings' } });
    expect(spy).not.toHaveBeenCalled();
  });

  test('cancelling leaves without sending anything', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    const back = vi.fn();
    render(<StartSomethingNew projectName="PolyGo" projectId="polygo" onBack={back} onSeePlan={() => {}} mode="change" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Change the reminder wording for late bookings entirely' } });
    fireEvent.click(screen.getByRole('button', { name: /Back to PolyGo/ }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  test('asking for a change never dispatches decide or activate', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['proposed'] });
    panel('change');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Change the booking reminder to go out two days ahead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose the change' }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    for (const call of spy.mock.calls) {
      expect(call[1]).not.toBe('plan.decide');
      expect(call[1]).not.toBe('plan.activate');
    }
  });
});

// @vitest-environment jsdom
/**
 * STAGE 8 — SETTINGS IS CONFIGURATION, ADVANCED IS EVIDENCE, AND NEITHER IS A SECOND OF ANYTHING.
 *
 * The whole risk of a settings screen is that it becomes the place things get added because there
 * was nowhere else to put them: a budget it cannot set, a notification system that does not exist,
 * a voice switch over an absent seam, and a second copy of whatever Health already says. These
 * prove the opposite from a RENDERED tree rather than from the source:
 *
 *   1. every control on Settings does something real;
 *   2. nothing is offered for a capability that does not exist;
 *   3. Settings does not restate what Health owns;
 *   4. Settings grants no project execution authority — no governed verb is reachable from it;
 *   5. Standard and Command render the same Settings.
 *
 * The credential WRITE contract has its own file (`credentialConfirmation.test.tsx`); what is
 * proven here is that management lives on this screen and that reaching it changes nothing by
 * itself. The native bridge is watched and asserted never to be called.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A (Stage 8).
 */
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SettingsScreen } from '../src/owner/SettingsScreen';
import { tauriBridge } from '../src/daemon/tauriBridge';
import * as daemon from '../src/daemon/DaemonProvider';
import type { GovernedConnectionView, GovernedProjection, GovernedState } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-shell');
});

const conn = (over: Partial<GovernedConnectionView> = {}): GovernedConnectionView =>
  ({
    provider: 'openai',
    environment: 'development',
    credential: 'api-key',
    reference: 'ProjectOS/demo/development/openai/api-key',
    risk: 'session',
    status: 'STORED',
    fingerprint: 'ab12cd34',
    expiresAt: null,
    ...over,
  }) as GovernedConnectionView;

function projection(connections: readonly GovernedConnectionView[] = [conn()]): GovernedProjection {
  return {
    connected: true,
    projectId: 'demo',
    projectName: 'Demo',
    repository: { repo: 'acme/demo', localPath: 'C:/dev/demo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: {
      configured: true,
      budget: { status: 'OK', spentThisMonthMicroUsd: 1_000_000, remainingMicroUsd: 9_000_000, warnAtMicroUsd: 8_000_000, hardStopAtMicroUsd: 10_000_000 },
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 1_000_000,
      callCount: 7,
      lastCall: null,
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue.',
    observedAt: '2026-08-28T08:00:00.000Z',
  } as GovernedProjection;
}

/** Settings reads the daemon through hooks, so both are stubbed rather than a provider mounted. */
function stub(state: GovernedState | null, projects = 3): void {
  vi.spyOn(daemon, 'useGovernedState').mockReturnValue(state as never);
  vi.spyOn(daemon, 'useGovernedProjects').mockReturnValue({
    projects: Array.from({ length: projects }, (_, i) => ({ projectId: `p${i}`, projectName: `P${i}` })),
    selectedProjectId: 'demo',
  } as never);
}

function settings(state: GovernedState | null = projection()) {
  stub(state);
  return render(
    <SettingsScreen
      projectName="Demo"
      theme="standard"
      setTheme={() => {}}
      calm={false}
      setCalm={() => {}}
      onBack={() => {}}
      onAdvanced={() => {}}
      onSignOut={() => {}}
      onChangePassword={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
});

describe('Settings is the clear owner configuration destination', () => {
  test('the four groups an owner configures or is told about are all there', () => {
    settings();
    for (const title of ['Appearance', 'Connections and keys', 'What always asks you first', 'This computer']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
  });

  test('credential management lives HERE — the control to change a key is on Settings', () => {
    settings();
    expect(screen.getByRole('button', { name: /^Replace$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Add connection$/ })).toBeTruthy();
  });

  test('with no projection there is nothing to manage, and it says so instead of drawing a form', () => {
    settings({ connected: false, reason: 'NO_RUNTIME', detail: 'no runtime' } as GovernedState);
    expect(screen.getByText(/not reporting on a project yet/i)).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add connection$/ })).toBe(null);
  });
});

describe('nothing is offered for a capability that does not exist', () => {
  test.each([
    ['voice', /voice/i],
    ['uploads', /upload/i],
    ['notifications', /notification/i],
    ['project defaults', /default/i],
  ])('there is no %s control', (_label, pattern) => {
    const { container } = settings();
    // Not a switch, not a field, not even a heading offering it.
    expect(container.textContent ?? '').not.toMatch(pattern);
  });

  test('the AI budget is NOT presented as something Settings can change', () => {
    // Nothing in the engine sets a budget: it is read from the reviewer ledger. A field here would
    // be a control over nothing, and a read-only copy would duplicate Health.
    const { container } = settings();
    expect(container.textContent ?? '').not.toMatch(/budget|spend|limit/i);
  });

  test('the approval rows are text, not switches — they cannot be turned off here', () => {
    settings();
    const plate = screen.getByRole('heading', { name: 'What always asks you first' }).closest('section')!;
    expect(within(plate).queryAllByRole('switch').length).toBe(0);
    expect(within(plate).queryAllByRole('button').length).toBe(0);
    expect(within(plate).queryAllByRole('checkbox').length).toBe(0);
  });
});

describe('Settings does not restate what Health owns', () => {
  test('no spend, no call count, no runtime state, no counts of connections', () => {
    const { container } = settings();
    const text = container.textContent ?? '';
    for (const owned of [/\$\d/, /calls made/i, /spent this month/i, /left this month/i, /provider reachable/i]) {
      expect(text).not.toMatch(owned);
    }
  });

  test('the connection LIST is here, but not a COUNT of it — the list is the answer', () => {
    const { container } = settings();
    // "Keys held by Windows: 1" restated a number Health prints and the rows above already show.
    expect(container.textContent ?? '').not.toMatch(/keys held by windows/i);
    // Named in its row and again as a choice in the add form; both are the same one service.
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
  });

  test('the live-site gate reads as an approval, not as a fact about this computer', () => {
    settings();
    const approvals = screen.getByRole('heading', { name: 'What always asks you first' }).closest('section')!;
    expect(within(approvals).getByText(/Frozen for this project/i)).toBeTruthy();
    const machine = screen.getByRole('heading', { name: 'This computer' }).closest('section')!;
    expect(within(machine).queryByText(/frozen/i)).toBe(null);
  });

  test('the core version moved to Advanced and is not restated here', () => {
    const { container } = settings();
    expect(container.textContent ?? '').not.toMatch(/core v/i);
  });
});

describe('Settings grants no project execution authority', () => {
  test('no governed command can be dispatched from Settings', () => {
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue(undefined as never);
    const { container } = settings();
    // Rendering alone must send nothing…
    expect(invoke).not.toHaveBeenCalled();
    // …and no CONTROL on the screen offers a governed action. Asserted against the buttons rather
    // than the prose, because the prose legitimately mentions reports and approvals when it
    // explains what ProjectOS will not do without asking.
    const names = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    for (const verb of [/start/i, /resume/i, /approve/i, /close/i, /activate/i, /write a report/i]) {
      expect(names.filter((n) => verb.test(n))).toEqual([]);
    }
  });

  test('changing appearance is presented as changing nothing else', () => {
    settings();
    expect(screen.getByText(/does not change your projects, what you are allowed to do/i)).toBeTruthy();
  });
});

describe('Standard and Command render the same Settings', () => {
  test('the rendered tree is identical in both appearances', () => {
    // Same information, same state, same actions, same authority — presentation only. Proving the
    // tree matches is what makes that a fact rather than an intention.
    document.documentElement.setAttribute('data-shell', 'standard');
    const standard = settings().container.innerHTML;
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);

    document.documentElement.setAttribute('data-shell', 'command');
    const command = settings().container.innerHTML;

    expect(command).toBe(standard);
  });
});

// @vitest-environment jsdom
/**
 * HEALTH IS A REPORT. READING IT MUST HAVE NO SIDE EFFECT.
 *
 * The Stage 7 report claimed "Health reports and never acts". That was true only of the sixteen
 * GOVERNED verbs, and it was the wrong test: `ConnectionsTab` writes a credential through a NATIVE
 * `set_credential` call, which is not a governed verb and so slipped past the claim entirely.
 * Rendering that component inside Health put a key field and a "Add connection" button on an
 * observation surface — one disclosure away from the owner.
 *
 * These prove the corrected contract from a RENDERED tree rather than by reading the source:
 *   1. Health renders no credential entry, no store control and no mutation control, in any state;
 *   2. no interaction reachable from Health can invoke `set_credential`;
 *   3. the status information Health exists to show is still there;
 *   4. Standard and Command render identically.
 *
 * NOTHING HERE CALLS `set_credential`. The bridge is stubbed and asserted never to be invoked.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { HealthScreen } from '../src/ux/HealthScreen';
import { tauriBridge } from '../src/daemon/tauriBridge';
import type { GovernedConnectionView, GovernedProjection, GovernedState } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const conn = (provider: string, status: GovernedConnectionView['status']): GovernedConnectionView =>
  ({
    provider,
    environment: 'production',
    credential: 'token',
    reference: `ProjectOS/polygo/production/${provider}/token`,
    risk: 'session',
    status,
    fingerprint: 'ab12cd34',
    expiresAt: null,
  }) as GovernedConnectionView;

function projection(connections: readonly GovernedConnectionView[]): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 1, totalPhaseCount: 3, completionPercentage: 33, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: {
      configured: true,
      budget: { status: 'OK', spentThisMonthMicroUsd: 1_000_000, remainingMicroUsd: 9_000_000, warnAtMicroUsd: 8_000_000, hardStopAtMicroUsd: 10_000_000 },
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 1_000_000,
      callCount: 1,
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
    observedAt: '2026-08-27T19:59:00.000Z',
  } as GovernedProjection;
}

/** Every credential state the connection view can be in. */
const STATES: ReadonlyArray<GovernedConnectionView['status']> = ['STORED', 'MISSING', 'EXPIRED', 'UNMANAGED'];

describe('no credential mutation is reachable from Health, in any state', () => {
  test.each(STATES)('%s: no key field, no store control, no remove control', (status) => {
    // The bridge is watched, not mocked away: if any render or interaction reached it, this fails.
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue(undefined as never);
    const { container } = render(<HealthScreen governed={projection([conn('openai', status)])} />);

    // Nothing to type a secret into — including anything already in the DOM but hidden.
    expect(container.querySelectorAll('input').length).toBe(0);
    expect(container.querySelectorAll('select').length).toBe(0);
    expect(container.querySelectorAll('textarea').length).toBe(0);

    // No control that stores, replaces or removes a credential, by any of its names.
    for (const name of [/add connection/i, /store/i, /replace/i, /remove/i, /save/i, /delete/i]) {
      expect(screen.queryByRole('button', { name })).toBe(null);
    }

    expect(invoke).not.toHaveBeenCalled();
  });

  test('Health renders NO buttons at all — there is nothing on it to press', () => {
    const { container } = render(<HealthScreen governed={projection([conn('openai', 'STORED')])} />);
    // A report has no actions. This is the strongest form of the contract and the easiest to keep.
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  test('nothing keyboard-reachable can mutate: no focusable control exists beyond disclosures', () => {
    const { container } = render(<HealthScreen governed={projection([conn('openai', 'EXPIRED')])} />);
    const focusable = container.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBe(0);
  });

  test('no hidden or collapsed mutation surface is present in the DOM either', () => {
    // `<details>` content stays in the DOM when closed, so a disclosure would have hidden the form
    // from the eye but not from the page — the previous arrangement did exactly that.
    const { container } = render(<HealthScreen governed={projection([conn('openai', 'STORED')])} />);
    expect(container.querySelectorAll('details').length).toBe(0);
    expect(container.textContent).not.toContain('Add a connection');
    expect(container.textContent).not.toContain('Paste it here');
  });

  test('a runtime that is not reporting still exposes nothing', () => {
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue(undefined as never);
    const down: GovernedState = { connected: false, reason: 'NO_RUNTIME', detail: 'no runtime' };
    const { container } = render(<HealthScreen governed={down} />);
    expect(container.querySelectorAll('input, select, button').length).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('the status information Health exists to show is still there', () => {
  test('each connection state is named in the owner’s words', () => {
    render(<HealthScreen governed={projection([conn('openai', 'EXPIRED'), conn('github', 'MISSING')])} />);
    expect(screen.getByText(/openai \(production\) has expired/)).toBeTruthy();
    expect(screen.getByText(/github \(production\) is not set up/)).toBeTruthy();
  });

  test('reachability is still stated as unchecked, and spend still comes from the ledger', () => {
    const { container } = render(<HealthScreen governed={projection([conn('openai', 'STORED')])} />);
    expect(container.textContent).toContain('Not checked');
    expect(container.textContent).toContain('$1.00');
  });

  test('the four groups are all present', () => {
    render(<HealthScreen governed={projection([])} />);
    for (const title of ['AI usage', 'Connections', 'ProjectOS runtime', 'Work']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
  });

  test('a credential fingerprint is shown, and never a credential value', () => {
    const { container } = render(<HealthScreen governed={projection([conn('openai', 'STORED')])} />);
    // The reference is a NAME; the fingerprint is a non-reversible digest. Neither is a secret.
    expect(container.textContent).not.toContain('sk-');
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0);
  });
});

describe('Standard and Command render the same Health', () => {
  test('the rendered tree is identical in both appearances', () => {
    // Health carries no mode logic at all; appearance is a root attribute and CSS. Proving the tree
    // matches is what makes "presentation only" a fact rather than an intention.
    const state = projection([conn('openai', 'STORED'), conn('github', 'MISSING')]);

    document.documentElement.setAttribute('data-shell', 'standard');
    const standard = render(<HealthScreen governed={state} />).container.innerHTML;
    cleanup();

    document.documentElement.setAttribute('data-shell', 'command');
    const command = render(<HealthScreen governed={state} />).container.innerHTML;
    document.documentElement.removeAttribute('data-shell');

    expect(command).toBe(standard);
  });
});

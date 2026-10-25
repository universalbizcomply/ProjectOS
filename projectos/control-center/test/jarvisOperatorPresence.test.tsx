// @vitest-environment jsdom
/**
 * THE OPERATOR IS THE APPEARANCE. THE LINK IS A CLAIM. THEY ARE NOT THE SAME THING.
 *
 * The Control Center rendered the hologram only when a governed projection existed:
 *
 *     {state !== null && <OperatorAside … />}
 *
 * On the desktop that is almost always true, so it looked correct for the whole of the UX
 * programme. On any page WITHOUT a local runtime — every hosted one — it meant the entire JARVIS
 * identity collapsed: the head, the eyes, the mouth, the plinth, the scan, the rings and the beam
 * all disappeared at once, and Command appearance became a dark palette with teal accents. Measured
 * on the real hosted build, 2 of 11 identity elements survived.
 *
 * Presence belongs to the APPEARANCE, which CSS already gates — `.os-operator` is `display: none`
 * outside Command, so Standard needs nothing from this and gets nothing.
 *
 * What the runtime decides is the WORDS and the INTENSITY. `LINK STABLE` used to be hardcoded; the
 * moment the hologram was allowed to render without a projection that string would have become a
 * lie on every hosted page, which is the one thing this product may never do. So the link is now a
 * derived, checkable claim.
 *
 * jsdom has no layout and no CSS, so these prove the CONTRACT — what is rendered and what it says.
 * That the Command-only gating and the dormant treatment actually paint is proven in the browser.
 *
 * Created in PROJECTOS-CONTROL-CENTER-INTEGRATION1A (JARVIS visual restoration).
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ControlCenter } from '../src/ux/ControlCenter';
import { OperatorAside } from '../src/owner/Hologram';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projection(): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 1, totalPhaseCount: 3, completionPercentage: 33, completedPhases: [], pendingPhases: [] },
    phases: [], activePhase: null, nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [], planDrafts: [], sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [], risks: [], nextSafeAction: 'Continue.',
    observedAt: '2026-08-28T09:00:00.000Z',
  } as GovernedProjection;
}

function centre(state: GovernedProjection | null) {
  return render(
    <ControlCenter
      state={state}
      now={Date.parse('2026-08-28T09:00:00.000Z')}
      onNavigate={() => {}}
      onStartObjective={() => {}}
      objectiveOpen={false}
      objectivePanel={null}
      entries={[]}
      setEntries={() => {}}
    />,
  );
}

/** Every layer the accepted JARVIS operator is made of. */
const IDENTITY: readonly string[] = [
  '.os-operator', '.os-holo', '.os-holo-inner', '.os-holowrap',
  '.os-holowrap img.flicker', '.os-holowrap .os-eyes', '.os-holowrap .os-mouth',
  '.os-holo .scanlines', '.os-holo .beam', '.os-holo .rings', '.os-holo .base',
];

describe('the operator is rendered whether or not ProjectOS is reporting', () => {
  test.each([['with a projection', true], ['with NO projection', false]])(
    'every identity layer is rendered %s',
    (_label, live) => {
      const { container } = centre(live ? projection() : null);
      const missing = IDENTITY.filter((sel) => container.querySelector(sel) === null);
      expect(missing).toEqual([]);
    },
  );

  test('the head, eyes and mouth are the accepted assets — not a redesign', () => {
    const { container } = centre(null);
    expect(container.querySelector('img.flicker')?.getAttribute('src')).toBe('/operator/operator-head.png');
    expect(container.querySelector('.os-eyes')?.getAttribute('src')).toBe('/operator/operator-eyes.png');
    expect(container.querySelector('.os-mouth')?.getAttribute('src')).toBe('/operator/operator-mouth.png');
  });

  test('the head keeps its alt text; the decorative layers stay hidden from assistive tech', () => {
    const { container } = centre(null);
    expect(container.querySelector('img.flicker')?.getAttribute('alt')).toBe('Holographic projection of the owner');
    for (const sel of ['.os-eyes', '.os-mouth', '.os-holo .scanlines', '.os-holo .beam', '.os-holo .rings', '.os-holo .base']) {
      expect(container.querySelector(sel)?.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('the LINK is a claim, and it is only made when it is true', () => {
  test('with a projection it reads LINK STABLE', () => {
    centre(projection());
    expect(screen.getByText('LINK STABLE')).toBeTruthy();
    expect(screen.queryByText('NO LINK')).toBe(null);
  });

  test('without a projection it reads NO LINK and says why', () => {
    centre(null);
    expect(screen.getByText('NO LINK')).toBeTruthy();
    expect(screen.queryByText('LINK STABLE')).toBe(null);
    expect(screen.getByText('local runtime unavailable')).toBeTruthy();
  });

  test('no false connectivity word appears anywhere while there is no projection', () => {
    // The exact claims this product must never make when they are not true.
    const { container } = centre(null);
    const text = container.textContent ?? '';
    for (const lie of [/LINK STABLE/, /\bCONNECTED\b/i, /\bHOST ONLINE\b/i, /\bEXECUTING\b/i]) {
      expect(text).not.toMatch(lie);
    }
  });

  test('the operator is marked dormant without a projection, and energised with one', () => {
    // The attributes the dormant styling hangs off. Presence never changes; intensity does.
    const dark = centre(null).container;
    expect(dark.querySelector('.os-operator')?.getAttribute('data-linked')).toBe('0');
    expect(dark.querySelector('.os-holo')?.getAttribute('data-dormant')).toBe('1');
    cleanup();
    const lit = centre(projection()).container;
    expect(lit.querySelector('.os-operator')?.getAttribute('data-linked')).toBe('1');
    expect(lit.querySelector('.os-holo')?.getAttribute('data-dormant')).toBe('0');
  });

  test('the label states dormancy rather than inventing activity', () => {
    centre(null);
    expect(screen.getByText('dormant')).toBeTruthy();
  });
});

describe('the component cannot claim a link it was not given', () => {
  test.each([[true, 'LINK STABLE'], [false, 'NO LINK']])(
    'linked=%s renders %s',
    (linked, expected) => {
      render(<OperatorAside speaking={false} linked={linked as boolean} label="x" readout="y" />);
      expect(screen.getByText(expected as string)).toBeTruthy();
    },
  );
});

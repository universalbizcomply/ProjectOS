// @vitest-environment jsdom
/**
 * Safety & Providers must not assert a safety state the runtime contradicts.
 *
 * The badges were built from `OWNER_MODELS` unconditionally — the offline snapshot, whose safety
 * block is the hardcoded literal `productionFrozen: true, providerContacted: false,
 * secretCapabilityUsed: false, apiUsed: false`. That reads as reassurance and cannot be falsified by
 * anything the runtime reports, which is the worst possible property for a SAFETY display: a live
 * projection saying production is not frozen would still have rendered "Production frozen".
 *
 * Same defect and same constant as the Owner Chat one, on a surface where being wrong matters more.
 * Scope is deliberately the badges only: the approval queue and provider-guard sections still come
 * from GOVERNED_CHAINS, because no canonical live source for them exists yet and inventing one would
 * be a fabrication rather than a fix.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { SafetyProviders } from '../src/owner/SafetyProviders.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => cleanup());

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: {
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      branch: 'projectos-post-v3-selfhost-pilot1a',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'projectos-operational-recovery-plan',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'projectos/state/projectos-recovery.plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 4,
      totalPhaseCount: 6,
      completionPercentage: 66.7,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [],
    activePhase: { phaseId: 'PROJECTOS-RECOVERY-INSTALLED-APP1A', status: 'implementing' },
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-13T09:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

function mount() {
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, createFakeScheduler());
  render(
    <DaemonProvider client={client}>
      <SafetyProviders />
    </DaemonProvider>,
  );
  client.start();
  return { transport };
}

/** The rendered safety badges, as text. */
function badges(): string {
  const panel = screen.getByRole('heading', { name: 'Safety state' }).closest('.ocp-panel');
  return panel?.textContent ?? '';
}

describe('Safety & Providers safety badges follow live governed truth', () => {
  test('a runtime reporting production NOT frozen is not overridden by the reassuring snapshot', () => {
    const { transport } = mount();
    // The snapshot hardcodes productionFrozen: true. This is the case that matters — the badge is
    // only worth rendering if it can say the alarming thing when the runtime says it.
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ safety: { productionFreeze: false, forbiddenActions: [], approvalGates: [] } as never }),
      }),
    );
    expect(badges()).toContain('Production LIVE');
    expect(badges()).not.toContain('Production frozen');
  });

  test('a frozen runtime still reads frozen', () => {
    const { transport } = mount();
    act(() => transport.emit({ kind: 'governed', state: projection() }));
    expect(badges()).toContain('Production frozen');
  });

  test('with no runtime it falls back to the recorded position rather than rendering nothing', () => {
    mount();
    expect(badges()).toContain('Production frozen');
  });

  test('a dead runtime stops being treated as live', () => {
    const { transport } = mount();
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ safety: { productionFreeze: false, forbiddenActions: [], approvalGates: [] } as never }),
      }),
    );
    expect(badges()).toContain('Production LIVE');
    act(() => transport.emit({ kind: 'closed' }));
    // Back to the recorded position. A live claim must not outlive the connection that made it.
    expect(badges()).toContain('Production frozen');
  });

  test('live safety is not shown beside another project\'s chain', () => {
    const { transport } = mount();
    act(() =>
      transport.emit({
        kind: 'governed',
        state: projection({ safety: { productionFreeze: false, forbiddenActions: [], approvalGates: [] } as never }),
      }),
    );
    expect(badges()).toContain('Production LIVE');

    // REBASELINED by PROJECTOS-PHASE6-SECTION-C. The page no longer chooses its own project — the
    // authoritative selection does — so the property is driven the way it actually occurs in the
    // product: the owner selects a project the runtime is not reporting on. The invariant is
    // unchanged and slightly stronger, because the page cannot avoid it by refusing to switch.
    act(() =>
      transport.emit({
        kind: 'governed-projects',
        inventory: {
          projects: [
            {
              projectId: 'acme-store',
              projectName: 'Acme Store',
              repositoryRoot: 'C:\\dev\\Acme',
              repository: 'acme/store',
            },
          ],
          registryStatus: 'ok',
          refusedCount: 0,
          selectedProjectId: 'acme-store',
        },
      }),
    );
    expect(badges()).not.toContain('Production LIVE');
  });

  /** And it has no selector of its own to switch with. */
  test('there is no project selector on this page', () => {
    mount();
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByTestId('selected-project-identity-pending')).not.toBeNull();
  });
});

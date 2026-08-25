// @vitest-environment jsdom
/**
 * Owner Chat must answer from the SAME source Owner Control renders from.
 *
 * THE DEFECT THESE EXIST TO PREVENT, observed live in the installed application. Owner Control had
 * been taught to prefer the live runtime projection; Owner Chat still read `OWNER_MODELS`
 * unconditionally, which is the offline fallback describing the CLOSED ProjectOS V3 programme. At
 * the same moment, on the same screen, against the same running daemon:
 *
 *   Owner Control : projectos-operational-recovery-plan · working phase …INSTALLED-APP1A ·
 *                   Live · IN EXECUTION · 4 of 6 phases accepted · 66.7%
 *   Owner Chat    : "ProjectOS V3 · between phases" · "Plan status is COMPLETE" ·
 *                   "19 of 19 phases accepted · 100%" ·
 *                   "Start the ProjectOS runtime to see live governed state"
 *
 * An owner reading the chat would believe the programme was finished and the runtime was not even
 * running. That is the precise failure ProjectOS exists to make impossible, so the last test here
 * pins the two surfaces to each other rather than to a literal.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { OwnerChat } from '../src/owner/OwnerChat.js';
import { OwnerControlPlane } from '../src/owner/OwnerControlPlane.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import { answerOwnerQuestion } from '../src/owner/ownerChatModel.js';
import { PROJECTOS_V3 } from '../src/owner/ownerSnapshot.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => cleanup());

/** The live position at the time the defect was observed: mid-programme, with a phase running. */
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
      pendingPhases: ['PROJECTOS-RECOVERY-EXTERNAL-PROJECT1A'],
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
    nextSafeAction: 'PROJECTOS-RECOVERY-INSTALLED-APP1A is implementing. Continue that phase.',
    observedAt: '2026-08-13T09:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

function mount(node: React.ReactElement) {
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, createFakeScheduler());
  render(<DaemonProvider client={client}>{node}</DaemonProvider>);
  client.start();
  return { transport };
}

function goLive(transport: ReturnType<typeof createFakeTransport>, over: Partial<GovernedProjection> = {}) {
  act(() => transport.emit({ kind: 'governed', state: projection(over) }));
}

function ask(question: string) {
  fireEvent.click(screen.getByRole('button', { name: question }));
}

/** Everything ProjectOS has said, as one string. */
function log(): string {
  return screen.getByRole('log').textContent ?? '';
}

describe('Owner Chat answers from live governed state, not the recorded fallback', () => {
  test('the greeting names the live plan and the running phase', () => {
    const { transport } = mount(<OwnerChat />);
    goLive(transport);

    const text = log();
    expect(text).toContain('projectos-operational-recovery-plan');
    expect(text).toContain('working phase PROJECTOS-RECOVERY-INSTALLED-APP1A');
    // The exact claims the defect produced.
    expect(text).not.toContain('ProjectOS V3');
    expect(text).not.toContain('between phases');
  });

  test('progress is the live count, and names the phase actually running', () => {
    const { transport } = mount(<OwnerChat />);
    goLive(transport);
    ask('How far along are we?');

    const text = log();
    expect(text).toContain('4 of 6');
    expect(text).toContain('66.7');
    expect(text).toContain('Currently on PROJECTOS-RECOVERY-INSTALLED-APP1A.');
    expect(text).not.toContain('19 of 19');
    expect(text).not.toContain('100%');
  });

  test('plan status is the live status, not COMPLETE', () => {
    const { transport } = mount(<OwnerChat />);
    goLive(transport);
    ask('What is the plan status?');
    expect(log()).not.toContain('COMPLETE');
  });

  test('the next safe action is the runtime\'s, not "start the runtime"', () => {
    const { transport } = mount(<OwnerChat />);
    goLive(transport);
    ask('What is the next safe action?');

    const text = log();
    expect(text).toContain('PROJECTOS-RECOVERY-INSTALLED-APP1A is implementing.');
    // Telling the owner to start a runtime that is demonstrably connected is the worst single line
    // the defect produced: it invites them to "fix" a system that is working.
    expect(text).not.toContain('Start the ProjectOS runtime');
    expect(text).not.toContain('last recorded position');
  });

  test('answers given before the runtime connected are not left standing beside live ones', () => {
    const { transport } = mount(<OwnerChat />);
    // The daemon connects asynchronously, so this is the ordinary path: the owner can ask before
    // the first projection arrives.
    ask('How far along are we?');
    expect(log()).toContain('19 of 19');

    goLive(transport);

    const text = log();
    expect(text).not.toContain('19 of 19');
    expect(text).toContain('projectos-operational-recovery-plan');
  });

  /**
      * REBASELINED by PROJECTOS-PHASE6-SECTION-C. This panel used to carry its own project
      * `<select>` over a static fixture list, hidden while a runtime was live. The owner decided
      * that Owner Control holds the ONE interactive selector, so the property is now stronger: this
      * page has NO project selector at any time, and instead STATES which project it is about.
      */
  test('there is no project selector here at all, live or offline', () => {
    const { transport } = mount(<OwnerChat />);
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryByTestId('selected-project-identity-pending')).not.toBeNull();
    goLive(transport);
    expect(screen.queryByLabelText('Select project')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  test('a disconnected runtime falls back rather than asserting stale live state', () => {
    const { transport } = mount(<OwnerChat />);
    goLive(transport);
    expect(log()).toContain('projectos-operational-recovery-plan');
    act(() => transport.emit({ kind: 'closed' }));
    // Back to the RECORDED position — asserted on what the panel says, not on the presence of a
    // control. The recorded V3 programme is complete; the live recovery plan is not.
    ask('How far along are we?');
    expect(log()).toContain('19 of 19');
  });
});

describe('Owner Chat and Owner Control cannot contradict each other', () => {
  test('both surfaces report the same completion from one projection', () => {
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, createFakeScheduler());
    render(
      <DaemonProvider client={client}>
        <OwnerControlPlane />
        <OwnerChat />
      </DaemonProvider>,
    );
    client.start();
    act(() => transport.emit({ kind: 'governed', state: projection() }));

    ask('How far along are we?');

    // Pinned to each other, not to a literal: if the projection changes, both must move together.
    const control = screen.getByTestId('ocp-source').closest('section');
    const controlText = control?.textContent ?? '';
    const chatText = log();
    for (const claim of ['4 of 6', 'PROJECTOS-RECOVERY-INSTALLED-APP1A']) {
      expect(controlText, `Owner Control should state ${claim}`).toContain(claim);
      expect(chatText, `Owner Chat should state ${claim}`).toContain(claim);
    }
    expect(within(control as HTMLElement).queryByText(/19 of 19/)).toBeNull();
  });
});

describe('a missing next phase never renders as a sentence with a hole in it', () => {
  // The empty string comes from the RECORDED fallback (`ownerSnapshot` stores '' for "no next
  // phase"), not from a live projection — `ownerModelFromGoverned` maps a missing phase to null,
  // which the old `??` already handled. Testing this through live state therefore proves nothing:
  // the pre-fix code passes it too. Drive the offline path, which is where '' actually occurs.
  test('the recorded fallback reads "to be decided", not "Next up is ."', () => {
    mount(<OwnerChat />);
    // Confirms the OFFLINE path by what the panel is showing — no runtime has reported, so no
    // project is selected. (It used to confirm this by the presence of a selector that no longer
    // exists; the fixture selectors were removed in PROJECTOS-PHASE6-SECTION-C.)
    expect(screen.queryByTestId('selected-project-identity-pending')).not.toBeNull();
    ask('How far along are we?');

    const text = log();
    expect(text).toContain('Next up is to be decided.');
    expect(text).not.toContain('Next up is .');
  });

  test('directly, on the exported responder, against the model that stores the empty string', () => {
    const answer = answerOwnerQuestion(PROJECTOS_V3, 'How far along are we?').answer;
    expect(PROJECTOS_V3.nextRecommendedPhase).toBe(''); // pin the precondition
    expect(answer).toContain('Next up is to be decided.');
    expect(answer).not.toMatch(/Next up is \.\s*$/);
  });
});

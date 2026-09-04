// @vitest-environment jsdom
/**
 * "THERE ARE NO VISUAL OF ITEMS BEING WORKED" — the owner, 2026-09-04, watching a screen that said
 * "Working · Continue where you left off · Last worked on 10 hours ago" over a run that had started
 * three minutes earlier, and whose only button would have asked for a SECOND run of the same plan.
 *
 * Two claims are held here:
 *  1. "Working" is a claim about the present tense, so it requires the live process the sidecar
 *     tracks. A session record alone means work was INTERRUPTED, and says so.
 *  2. While a run is live the screen shows the work — the step, how long, and the runtime's own
 *     output — and asks the owner for nothing.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { WorkingNow, elapsedPhrase } from '../src/ux/WorkingNow';
import { buildContinueWorking } from '../src/owner/continueWorkingModel';
import { stateFromStatus } from '../src/owner/workspaceModel';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection } from '../src/governed/types';
import type { GovernedRunState } from '../src/daemon/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-04T08:30:00.000Z');

const RUN: GovernedRunState = {
  root: 'C:/dev/ProjectOS',
  active: true,
  phaseId: 'validation-cache',
  resumed: false,
  startedAt: '2026-09-04T08:24:00.000Z',
  lastExitCode: null,
  lines: [
    { stream: 'stdout', line: 'Prior work: projectos/validation-cache WAITING_AI' },
    { stream: 'stdout', line: 'Worker claude-local dispatched.' },
  ],
};

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'r', localPath: 'C:/dev/ProjectOS', branch: null, head: null, protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'p', planVersion: '1.3', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'p.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 4, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: { phaseId: 'validation-cache', description: 'Cache', status: 'not-started', dependsOn: [], unmetDependencies: [], startable: true, requiredOwnerGates: [], requiredBrowserProof: false, history: [], closedByRecord: false },
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: true, budget: { status: 'OK', spentThisMonthMicroUsd: 1, remainingMicroUsd: 9, warnAtMicroUsd: 8, hardStopAtMicroUsd: 10 }, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [{ sessionId: 's1', phaseId: 'validation-cache', startedAt: '2026-09-03T22:24:37.056Z', state: 'started', workerId: 'claude-local' }],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-09-04T08:30:00.000Z',
    ...over,
  } as GovernedProjection;
}

describe('"Working" needs a live process behind it', () => {
  test('a session record with NO live run reads as interrupted, and says nothing is running', () => {
    const next = buildContinueWorking(projection(), [], NOW, null);
    expect(next.status).toBe('Interrupted');
    expect(next.primary.heading).toBe('Work stopped before it finished');
    expect(next.primary.detail).toContain('Nothing is running now');
    // And it still offers to resume, because resuming is the right action for interrupted work.
    expect(next.primary.kind).toBe('resume');
    expect(next.primary.sessionId).toBe('s1');
  });

  test('a live run reads as Working and offers nothing to press', () => {
    const next = buildContinueWorking(projection(), [], NOW, { active: true });
    expect(next.status).toBe('Working');
    expect(next.primary.kind).toBe('working');
    expect(next.primary.heading).toBe('ProjectOS is working');
    // Starting something new while it works would be a second run of the same plan.
    expect(next.canStartSomethingNew).toBe(false);
  });

  test('an inactive run object is not a live run', () => {
    const next = buildContinueWorking(projection(), [], NOW, { active: false });
    expect(next.status).toBe('Interrupted');
  });

  test('a blocking owner action still outranks a live run', () => {
    const next = buildContinueWorking(projection(), [{ title: 'Approve the deploy', severity: 'blocking' }], NOW, { active: true });
    expect(next.status).toBe('Waiting for you');
  });

  test('the status word maps to a visual state, and Interrupted is not Working', () => {
    expect(stateFromStatus('Working', false, false)).toBe('working');
    expect(stateFromStatus('Interrupted', false, false)).toBe('paused');
  });
});

describe('the card shows the work, and asks for nothing', () => {
  test('it names the step, how long it has been going, and says no action is needed', () => {
    render(<WorkingNow run={RUN} stepPurpose="Deliver safe, local repository-scoped validation caching." stepNumber={1} stepCount={4} now={NOW} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('ProjectOS is working');
    expect(body).toContain('Deliver safe, local repository-scoped validation caching.');
    expect(body).toContain('Step 1 of 4');
    expect(body).toContain('Running for 6 minutes');
    expect(body).toContain('You do not need to do anything');
  });

  test('it shows the runtime\'s own lines, newest last, and never invents progress', () => {
    render(<WorkingNow run={RUN} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('Worker claude-local dispatched.');
    // No percentage, no estimate, no "nearly done" — nothing the runtime did not say.
    expect(body).not.toMatch(/\d+\s?%/);
    expect(body.toLowerCase()).not.toContain('almost');
  });

  test('control characters and bidi overrides in output never reach the screen', () => {
    const hostile: GovernedRunState = {
      ...RUN,
      lines: [{ stream: 'stderr', line: 'safe\u202Ereversed\u0007 tail' }],
    };
    render(<WorkingNow run={hostile} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('safereversed tail');
    expect(body).not.toContain('\u202E');
    expect(body).not.toContain('\u0007');
  });

  test('a very long line is bounded rather than allowed to run away', () => {
    const long: GovernedRunState = { ...RUN, lines: [{ stream: 'stdout', line: 'x'.repeat(5000) }] };
    render(<WorkingNow run={long} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    const shown = (document.body.textContent ?? '').match(/x+/)?.[0] ?? '';
    expect(shown.length).toBeLessThanOrEqual(300);
  });

  test('Stop asks the runtime to stop the run, once, and shows its answer verbatim', async () => {
    const calls: string[] = [];
    vi.spyOn(governedClient, 'requestGovernedCommand').mockImplementation(async (_b, verb) => {
      calls.push(verb);
      return { ok: true, lines: ['Governed run stopped.'] };
    });
    render(<WorkingNow run={RUN} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(document.body.textContent).toContain('Governed run stopped.'));
    expect(calls).toEqual(['run.stop']);
  });

  test('elapsed time is said the way a person would say it', () => {
    expect(elapsedPhrase('2026-09-04T08:29:40.000Z', NOW)).toBe('less than a minute');
    expect(elapsedPhrase('2026-09-04T08:29:00.000Z', NOW)).toBe('1 minute');
    expect(elapsedPhrase('2026-09-04T07:30:00.000Z', NOW)).toBe('1 hour');
    expect(elapsedPhrase(null, NOW)).toBe('just now');
    expect(elapsedPhrase('not a date', NOW)).toBe('just now');
  });
});

/**
 * A DIFFERENT RUN IS A DIFFERENT CARD. Without a key tied to the run, switching between two projects
 * that are both working reuses the same component instance: a Stop still in flight would leave the
 * new card disabled and print the first project's answer onto the second one's screen.
 */
describe('the card belongs to its own run', () => {
  test('astral characters survive the length cap intact', () => {
    const emoji = '🙂'.repeat(400);
    const run: GovernedRunState = { ...RUN, lines: [{ stream: 'stdout', line: emoji }] };
    render(<WorkingNow run={run} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    const shown = document.body.textContent ?? '';
    // No lone surrogate: every kept character is a whole one.
    expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(shown).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(shown).toContain('…');
  });

  test('C1 control characters are stripped too', () => {
    const run: GovernedRunState = { ...RUN, lines: [{ stream: 'stderr', line: 'a\u0085b\u009fc' }] };
    render(<WorkingNow run={run} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    expect(document.body.textContent ?? '').toContain('abc');
  });

  test('with no step sentence the heading stays plain, never a raw phase id', () => {
    render(<WorkingNow run={RUN} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    const heading = screen.getByRole('heading', { level: 2 }).textContent ?? '';
    expect(heading).toBe('Working through the approved plan');
    expect(heading).not.toContain('validation-cache');
  });

  test('the card is not itself a live region — only its log is', () => {
    const { container } = render(<WorkingNow run={RUN} stepPurpose={null} stepNumber={null} stepCount={null} now={NOW} />);
    expect(container.querySelector('section[aria-live]')).toBeNull();
    expect(container.querySelector('[role="log"]')).not.toBeNull();
  });
});

describe('a finished-but-unreviewed stop reads plainly', () => {
  test('CONTINUATION_READY says the work is done and waiting for the reviewer', async () => {
    const { plainStop } = await import('../src/owner/homeModel');
    const p = plainStop({
      phaseId: 'validation-cache',
      state: 'BLOCKED',
      stopCode: 'CONTINUATION_READY',
      stopDetail: 'every required check passed',
      ownerRequired: true,
      sessionId: null,
      updatedAt: 't',
    });
    expect(p.title).toBe('"validation-cache" is finished and waiting for the reviewer');
    expect(p.detail).toContain('passed every required check');
    expect(p.detail).toContain('will not commit its own work');
    expect(p.detail).toContain('every required check passed');
  });
});

/**
 * WORK THAT HAPPENED BUT HAS NOT MOVED A PHASE IS STILL WORK.
 *
 * A newly activated plan has no phase history, so for the whole of its first step the owner's
 * "Recently" list said "Nothing has been recorded for this project yet" while a worker was running,
 * checks were passing and a reviewer was being paid — all of which the runtime had recorded.
 */
describe('the activity feed reports what the runtime recorded', () => {
  test('a running session appears even when no phase has advanced', async () => {
    const { recordedItems } = await import('../src/owner/workspaceModel');
    const state = projection({
      phases: [{ phaseId: 'validation-cache', description: 'Deliver caching.', status: 'not-started', dependsOn: [], unmetDependencies: [], startable: true, requiredOwnerGates: [], requiredBrowserProof: false, acceptanceCriteria: [], requiredValidators: [], requiredReviews: [], riskLevel: '', autonomyLevel: '', history: [], closedByRecord: false }] as never,
      sessions: [{ sessionId: 's1', phaseId: 'validation-cache', workerId: 'claude-local', kind: 'run', startedAt: '2026-09-04T09:00:00.000Z', state: 'started', exitCode: null }] as never,
    });
    const rows = recordedItems(state);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('Deliver caching.');
    expect(rows[0]!.outcome).toBe('Started');
  });

  test('a finished session says so, and a failed one says why', async () => {
    const { recordedItems } = await import('../src/owner/workspaceModel');
    const mk = (state: string, exitCode: number | null) =>
      recordedItems(
        projection({
          sessions: [{ sessionId: 's', phaseId: 'p', workerId: 'w', kind: 'run', startedAt: 't', state, exitCode }] as never,
        }),
      )[0]!;
    expect(mk('exited', 0).outcome).toBe('Finished');
    expect(mk('exited', 3).outcome).toBe('Stopped (exit 3)');
    expect(mk('rejoined', null).outcome).toBe('Picked up again');
  });

  test('a phase that HAS advanced still reports its transitions', async () => {
    const { recordedItems } = await import('../src/owner/workspaceModel');
    const rows = recordedItems(
      projection({
        sessions: [],
        phases: [{ phaseId: 'p', description: 'A step.', status: 'closed', dependsOn: [], unmetDependencies: [], startable: false, requiredOwnerGates: [], requiredBrowserProof: false, acceptanceCriteria: [], requiredValidators: [], requiredReviews: [], riskLevel: '', autonomyLevel: '', history: [{ from: 'in_progress', to: 'closed', by: 'ChatGPT', at: '2026-09-04T10:00:00.000Z' }], closedByRecord: false }] as never,
      }),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe('A step.');
  });
});

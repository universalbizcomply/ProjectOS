/**
 * The one obvious next action, and the order it is decided in.
 *
 * Getting this order wrong is not cosmetic. Offering "Continue" while a decision is pending invites
 * an action the runtime will refuse; offering it into a blocked phase spends a real worker run to
 * learn something already known. The order is the safety property, so it is what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { buildContinueWorking, resumableSession } from '../src/owner/continueWorkingModel';
import type { GovernedProjection, GovernedSessionView } from '../src/governed/types';

const NOW = Date.parse('2026-08-26T15:00:00.000Z');

function session(over: Partial<GovernedSessionView> = {}): GovernedSessionView {
  return {
    sessionId: 'PHASE1A-abc-123',
    phaseId: 'PHASE1A',
    workerId: 'claude-local',
    kind: 'claude-code-cli',
    startedAt: '2026-08-26T14:30:00.000Z',
    state: 'started',
    exitCode: 0,
    ...over,
  };
}

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    projectName: 'Demo',
    activePhase: { phaseId: 'PHASE1A' },
    nextStartablePhase: null,
    sessions: [],
    blockers: [],
    nextSafeAction: 'Continue PHASE1A.',
    ...over,
  } as unknown as GovernedProjection;
}

describe('buildContinueWorking — what gets offered, and in what order', () => {
  it('an owner decision outranks everything, including resumable work', () => {
    const m = buildContinueWorking(
      projection({ sessions: [session()] }),
      [{ title: 'Approve the push', severity: 'blocking' }],
      NOW,
    );
    expect(m.status).toBe('Waiting for you');
    expect(m.primary.kind).toBe('review');
    expect(m.primary.detail).toContain('Approve the push');
    // Offering "start something new" here would invite work the runtime is about to refuse.
    expect(m.canStartSomethingNew).toBe(false);
  });

  it('a blocker outranks resuming, so a real worker run is not spent learning it', () => {
    const m = buildContinueWorking(
      projection({ sessions: [session()], blockers: ['The plan is stale.'] }),
      [],
      NOW,
    );
    expect(m.status).toBe('Blocked');
    expect(m.primary.kind).toBe('review');
    expect(m.primary.detail).toContain('stale');
  });

  it('offers to resume work that already started, and knows the session itself', () => {
    const m = buildContinueWorking(projection({ sessions: [session()] }), [], NOW);
    expect(m.status).toBe('Working');
    expect(m.primary.kind).toBe('resume');
    expect(m.primary.label).toBe('Continue');
    expect(m.primary.heading).toBe('Continue where you left off');
    // The owner is never asked for this; it is supplied.
    expect(m.primary.sessionId).toBe('PHASE1A-abc-123');
  });

  it('says when the work last happened the way a person would say it', () => {
    const m = buildContinueWorking(projection({ sessions: [session()] }), [], NOW);
    expect(m.primary.detail).toBe('Last worked on 30 minutes ago.');
  });

  it('offers to continue a phase that has never run, quoting the runtime', () => {
    const m = buildContinueWorking(projection(), [], NOW);
    expect(m.status).toBe('Ready');
    expect(m.primary.kind).toBe('continue');
    expect(m.primary.detail).toBe('Continue PHASE1A.');
  });

  it('asks what to do when nothing is in play', () => {
    const m = buildContinueWorking(
      projection({ activePhase: null, nextStartablePhase: null }),
      [],
      NOW,
    );
    expect(m.primary.kind).toBe('start');
    expect(m.primary.heading).toBe('Start something new');
    expect(m.phaseId).toBeNull();
  });

  it('never surfaces an identifier in anything the owner reads', () => {
    const m = buildContinueWorking(projection({ sessions: [session()] }), [], NOW);
    const shown = `${m.primary.heading} ${m.primary.detail} ${m.primary.label} ${m.status}`;
    expect(shown).not.toContain('PHASE1A-abc-123');
    expect(shown).not.toMatch(/[0-9a-f]{7,}/);
  });
});

describe('resumableSession — the newest session of the phase in play', () => {
  it('picks the most recent, not the first found', () => {
    const older = session({ sessionId: 'old', startedAt: '2026-08-25T10:00:00.000Z' });
    const newer = session({ sessionId: 'new', startedAt: '2026-08-26T14:30:00.000Z' });
    expect(resumableSession([older, newer], 'PHASE1A')?.sessionId).toBe('new');
    expect(resumableSession([newer, older], 'PHASE1A')?.sessionId).toBe('new');
  });

  it('ignores sessions belonging to another phase', () => {
    expect(resumableSession([session({ phaseId: 'OTHER' })], 'PHASE1A')).toBeNull();
  });

  it('does NOT require an exited state — no real session ever wrote one', () => {
    // An earlier version filtered on `state === 'exited'`. The runner never writes it, so the
    // resume offer never appeared once in practice. This pins that the filter is phase-only.
    expect(resumableSession([session({ state: 'started' })], 'PHASE1A')).not.toBeNull();
    expect(resumableSession([session({ state: 'rejoined' })], 'PHASE1A')).not.toBeNull();
  });

  it('has nothing to resume when no phase is in play', () => {
    expect(resumableSession([session()], null)).toBeNull();
  });
});

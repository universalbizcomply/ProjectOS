/**
 * THE PROGRAMME CARRIES ITSELF FORWARD — and, far more importantly, knows when not to.
 *
 * `projectos run` invoked `runLoop` once, so a technically finished phase ended the process and the
 * programme advanced only when the owner typed something. `projectos closure` had the same shape.
 * This is the single authority both now ask, so the tests here are almost all about STOPPING: an
 * unattended loop that cannot end is worse than one that never starts.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PHASES_PER_INVOCATION,
  continuationLines,
  continueProgramme,
  mayContinueAfter,
  type PhaseAttempt,
} from '../src/loop/programmeContinuation.js';

function attempt(over: Partial<PhaseAttempt> = {}): PhaseAttempt {
  return { phaseId: 'phase-1', stopCode: null, stopDetail: null, ok: true, lines: [], selectionStop: null, ...over };
}

/** A runner that returns the given attempts in order, then keeps returning the last one. */
function runnerOf(attempts: readonly PhaseAttempt[]): { runPhase: () => PhaseAttempt; calls: () => number } {
  let i = 0;
  return {
    runPhase: () => attempts[Math.min(i++, attempts.length - 1)]!,
    calls: () => i,
  };
}

describe('the rule, on its own', () => {
  it('permits another phase after a clean pass that moved on', () => {
    expect(mayContinueAfter(attempt({ phaseId: 'phase-2' }), 'phase-1').continue).toBe(true);
  });

  it('ends as COMPLETE when the runner selected no phase', () => {
    const v = mayContinueAfter(attempt({ phaseId: null }), 'phase-1');
    expect(v.continue).toBe(false);
    expect(v.end).toBe('PROGRAMME_COMPLETE');
  });

  it('ends as REFUSED when the run could not start', () => {
    const v = mayContinueAfter(attempt({ ok: false }), null);
    expect(v.continue).toBe(false);
    expect(v.end).toBe('REFUSED');
  });

  /**
   * THE ONE THAT MATTERS MOST. There is deliberately no list of stops the programme may walk past,
   * because such a list is exactly how an owner gate becomes negotiable. Every stop the loop can
   * produce is asserted here by name so that adding a stop code cannot quietly acquire permission to
   * be continued through.
   */
  it.each([
    'OWNER_GATE',
    'PROTECTED_EFFECT',
    'SCOPE_DECISION',
    'DOCTOR_PREFLIGHT_FAILED',
    'EFFECTS_NOT_ATTESTED',
    'UNRESOLVED_CRITICAL_OR_HIGH',
    'CORRECTION_EXHAUSTED',
    'REVIEW_OUTSTANDING',
    'WORKER_REFUSED',
    'WORKER_TIMED_OUT',
    'CONTINUATION_READY',
  ])('NEVER continues past %s', (stopCode) => {
    const v = mayContinueAfter(attempt({ stopCode, stopDetail: 'because' }), null);
    expect(v.continue).toBe(false);
    expect(v.end).toBe('STOPPED');
    expect(v.reasons.join(' ')).toContain(stopCode);
  });

  describe('a selection stop is a result, not a refusal (PROJECTOS-BOOT-CONTINUE1A)', () => {
    const refusedBySelection = (selectionStop: PhaseAttempt['selectionStop']): PhaseAttempt =>
      attempt({ ok: false, phaseId: null, selectionStop });

    it('awaiting_closure ends AWAITING_CLOSURE and names the phase to hand to the closure route', () => {
      const v = mayContinueAfter(
        refusedBySelection({ code: 'OWNER_DECISION_REQUIRED', detail: 'd', phaseId: 'phase-1', phaseStatus: 'awaiting_closure' }),
        'phase-1',
      );
      expect(v.continue).toBe(false);
      expect(v.end).toBe('AWAITING_CLOSURE');
      expect(v.closurePhaseId).toBe('phase-1');
    });

    it('PROGRAMME_COMPLETE from selection ends complete, not REFUSED', () => {
      const v = mayContinueAfter(refusedBySelection({ code: 'PROGRAMME_COMPLETE', detail: 'all done' }), 'phase-2');
      expect(v.continue).toBe(false);
      expect(v.end).toBe('PROGRAMME_COMPLETE');
      expect(v.reasons).toEqual(['all done']);
    });

    it('rolled_back shares OWNER_DECISION_REQUIRED but is NOT handed to closure', () => {
      const v = mayContinueAfter(
        refusedBySelection({ code: 'OWNER_DECISION_REQUIRED', detail: 'rolled', phaseId: 'phase-1', phaseStatus: 'rolled_back' }),
        null,
      );
      expect(v.end).toBe('STOPPED');
      expect(v.closurePhaseId).toBeUndefined();
    });

    it('awaiting_closure without a phase id is not handed anywhere', () => {
      const v = mayContinueAfter(refusedBySelection({ code: 'OWNER_DECISION_REQUIRED', detail: 'd', phaseStatus: 'awaiting_closure' }), null);
      expect(v.end).toBe('STOPPED');
    });

    it.each([
      ['PHASE_BLOCKED', 'STOPPED'],
      ['DEPENDENCY_NOT_SATISFIED', 'REFUSED'],
      ['PHASE_NOT_AUTHORISED', 'REFUSED'],
      ['RECORD_DISAGREES_WITH_PLAN', 'REFUSED'],
      ['UNSAFE_PHASE_ID', 'REFUSED'],
      ['NO_PHASES', 'REFUSED'],
    ])(
      'every other selection stop (%s) ends %s — an owner stop STOPPED, a defect REFUSED — with its true reason',
      (code, end) => {
        const v = mayContinueAfter(refusedBySelection({ code, detail: `why ${code}` }), null);
        expect(v.continue).toBe(false);
        expect(v.end).toBe(end);
        expect(v.reasons.join(' ')).toContain(code);
        expect(v.reasons.join(' ')).toContain(`why ${code}`);
      },
    );

    it('the driver ends AWAITING_CLOSURE after carrying a phase to completion', () => {
      const runner = runnerOf([
        attempt({ phaseId: 'phase-1' }),
        refusedBySelection({ code: 'OWNER_DECISION_REQUIRED', detail: 'd', phaseId: 'phase-1', phaseStatus: 'awaiting_closure' }),
      ]);
      const r = continueProgramme({ runPhase: runner.runPhase });
      expect(r.end).toBe('AWAITING_CLOSURE');
      expect(r.closurePhaseId).toBe('phase-1');
      expect(r.phasesRun).toEqual(['phase-1']);
    });
  });

  it('ends as NO_PROGRESS when the same phase comes back unchanged', () => {
    const v = mayContinueAfter(attempt({ phaseId: 'phase-1' }), 'phase-1');
    expect(v.continue).toBe(false);
    expect(v.end).toBe('NO_PROGRESS');
  });
});

describe('the driver', () => {
  it('runs at least one phase — asking to continue is asking for work', () => {
    const runner = runnerOf([attempt({ phaseId: null })]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(runner.calls()).toBe(1);
    expect(r.end).toBe('PROGRAMME_COMPLETE');
    expect(r.phasesRun).toEqual([]);
  });

  /** THE HEADLINE BEHAVIOUR: two sequential phases, no owner intervention between them. */
  it('carries phase 1 into phase 2 and then reports the programme complete', () => {
    const runner = runnerOf([
      attempt({ phaseId: 'phase-1' }),
      attempt({ phaseId: 'phase-2' }),
      attempt({ phaseId: null }),
    ]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(r.phasesRun).toEqual(['phase-1', 'phase-2']);
    expect(r.end).toBe('PROGRAMME_COMPLETE');
  });

  it('stops at the phase that stopped, and does not reach the one after it', () => {
    const runner = runnerOf([
      attempt({ phaseId: 'phase-1' }),
      attempt({ phaseId: 'phase-2', stopCode: 'OWNER_GATE', stopDetail: 'the owner must decide' }),
      attempt({ phaseId: 'phase-3' }),
    ]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(r.phasesRun).toEqual(['phase-1', 'phase-2']);
    expect(runner.calls()).toBe(2);
    expect(r.end).toBe('STOPPED');
    expect(r.reasons.join(' ')).toContain('OWNER_GATE');
  });

  /** A blocked phase must not be skipped for a later one that looks runnable. */
  it('does not step over a blocked phase to find work', () => {
    const runner = runnerOf([attempt({ phaseId: 'phase-1', stopCode: 'PHASE_BLOCKED' })]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(runner.calls()).toBe(1);
    expect(r.end).toBe('STOPPED');
  });

  it('terminates on a runner that always reports the same phase, rather than spinning', () => {
    const runner = runnerOf([attempt({ phaseId: 'stuck' })]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(r.end).toBe('NO_PROGRESS');
    expect(runner.calls()).toBe(2);
  });

  it('terminates on a plan that keeps producing new phases, at the bound', () => {
    let n = 0;
    const r = continueProgramme({ runPhase: () => attempt({ phaseId: `phase-${(n += 1)}` }) });
    expect(r.end).toBe('BOUND_REACHED');
    expect(r.phasesRun).toHaveLength(MAX_PHASES_PER_INVOCATION);
  });

  it('carries every attempt\'s lines through, so the run reads as one narrative', () => {
    const runner = runnerOf([
      attempt({ phaseId: 'phase-1', lines: ['first ran'] }),
      attempt({ phaseId: null, lines: ['nothing left'] }),
    ]);
    const r = continueProgramme({ runPhase: runner.runPhase });
    expect(r.lines).toEqual(['first ran', 'nothing left']);
  });

  it('reports what it carried and why it ended', () => {
    const runner = runnerOf([attempt({ phaseId: 'phase-1' }), attempt({ phaseId: null })]);
    const text = continuationLines(continueProgramme({ runPhase: runner.runPhase })).join('\n');
    expect(text).toContain('Phases carried in this invocation (1): phase-1');
    expect(text).toContain('PROGRAMME_COMPLETE');
  });
});

/**
 * The authority boundary of a bounded correction worker.
 *
 * The direction of authority is the whole point, so almost every test here is a REFUSAL: ProjectOS
 * derives a maximum, the reviewer may narrow it, and nothing in the chain may widen it. A test suite
 * of successes could not tell an enforced boundary from an absent one.
 */
import { describe, it, expect } from 'vitest';
import {
  authoriseCorrection,
  pathsNamedIn,
  attemptsRemaining,
  type CorrectionContext,
  type CorrectionRequest,
} from '../src/loop/correctionBoundary.js';

const SUBJECT = '031ccb9ec2bd06a517ee8eb5cc07246a7c55dac5';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';

function context(over: Partial<CorrectionContext> = {}): CorrectionContext {
  return {
    maximumPaths: ['projectos/agent/src/loop', 'projectos/core/src'],
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    consumedDecisionIds: [],
    attemptsRemaining: 2,
    ...over,
  };
}

function request(over: Partial<CorrectionRequest> = {}): CorrectionRequest {
  return {
    requestedPaths: ['projectos/agent/src/loop/gatekeeperConfig.ts'],
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    decisionId: 'GKDEC-abc123',
    ...over,
  };
}

/**
 * AN ABSENT BINDING IS NOT A SATISFIED ONE.
 *
 * Both sides of the subject comparison derive from `verification.observed.head ?? ''` in the runner,
 * so a run whose HEAD could not be read produced '' on both sides and the binding passed by being
 * absent. The decision id had the same shape of hole: '' deduplicates against a previous '' and a
 * second correction could ride an unnamed decision. Both raised by the LIVE reviewer against this
 * module's caller during the Criterion 10 run of 2026-08-18.
 */
describe('bindings that are absent rather than matching', () => {
  it('REFUSES a correction with no subject commit, even though both sides are equal', () => {
    const v = authoriseCorrection(request({ subjectCommit: '' }), context({ subjectCommit: '' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.join(' ')).toContain('bound to nothing');
  });

  it('REFUSES a correction that names no decision', () => {
    const v = authoriseCorrection(request({ decisionId: '   ' }), context());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.join(' ')).toContain('nothing authorised it');
  });
});

describe('an authorised correction', () => {
  it('grants Edit and Write on exactly the requested path', () => {
    const v = authoriseCorrection(request(), context());
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.correction.paths).toEqual(['projectos/agent/src/loop/gatekeeperConfig.ts']);
    expect(v.correction.grants).toEqual([
      'Edit(projectos/agent/src/loop/gatekeeperConfig.ts)',
      'Write(projectos/agent/src/loop/gatekeeperConfig.ts)',
    ]);
  });

  // COMMIT AND PUSH ARE ABSENT, NOT REFUSED. No Bash grant is ever produced, so the worker has no
  // shell, so it cannot run git however it is instructed.
  it('never emits a shell grant, so git is unreachable', () => {
    const v = authoriseCorrection(request(), context());
    if (!v.ok) throw new Error('unreachable');
    for (const g of v.correction.grants) {
      expect(g).not.toMatch(/^(Bash|Task|Agent)\(/i);
    }
  });

  it('lets the reviewer NARROW the boundary', () => {
    const v = authoriseCorrection(request({ requestedPaths: ['projectos/core/src/gatekeeperDecision.ts'] }), context());
    expect(v.ok).toBe(true);
  });
});

describe('the reviewer may not widen the boundary', () => {
  it.each([
    'projectos/host/service-host/src/main.rs',
    '.projectops/authority/closure-delegation.json',
    'package.json',
    'projectos/agent/src/commands/run.ts',
  ])('refuses %s, which the phase does not permit', (p) => {
    const v = authoriseCorrection(request({ requestedPaths: [p] }), context());
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reasons.some((r) => r.includes('may never widen it'))).toBe(true);
  });

  it('refuses a traversal, an absolute path and a drive letter', () => {
    for (const p of ['projectos/agent/src/loop/../../../etc/passwd', '/etc/passwd', 'C:/Windows/System32/x.ts']) {
      const v = authoriseCorrection(request({ requestedPaths: [p] }), context());
      expect(v.ok).toBe(false);
    }
  });

  // A CHARACTER PREFIX WOULD LET THIS THROUGH. Segment matching is what makes the boundary a boundary.
  it('refuses a sibling whose name merely starts with a permitted path', () => {
    const v = authoriseCorrection(
      request({ requestedPaths: ['projectos/agent/src/loop-secrets/leak.ts'] }),
      context(),
    );
    expect(v.ok).toBe(false);
  });

  it('refuses when the phase permits nothing at all', () => {
    const v = authoriseCorrection(request(), context({ maximumPaths: [] }));
    expect(v.ok).toBe(false);
  });

  it('refuses an amendment that named no path', () => {
    const v = authoriseCorrection(request({ requestedPaths: [] }), context());
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reasons.some((r) => r.includes('named no path'))).toBe(true);
  });
});

describe('binding, replay and budget', () => {
  it('refuses a correction for another project', () => {
    const v = authoriseCorrection(request({ projectId: 'polygo' }), context());
    expect(v.ok).toBe(false);
  });

  it('refuses a correction for another phase', () => {
    const v = authoriseCorrection(request({ phaseId: 'SOMETHING-ELSE1A' }), context());
    expect(v.ok).toBe(false);
  });

  it('refuses a correction authorised against other bytes', () => {
    const v = authoriseCorrection(request({ subjectCommit: 'f'.repeat(40) }), context());
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reasons.some((r) => r.includes('is stale'))).toBe(true);
  });

  it('refuses a decision that already drove a correction', () => {
    const v = authoriseCorrection(request(), context({ consumedDecisionIds: ['GKDEC-abc123'] }));
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reasons.some((r) => r.includes('cannot drive another'))).toBe(true);
  });

  // THE BUDGET IS THE OBJECTIVE'S. Nothing in this path can add to it.
  it('refuses once the objective\'s correction allowance is spent', () => {
    const v = authoriseCorrection(request(), context({ attemptsRemaining: 0 }));
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('unreachable');
    expect(v.reasons.some((r) => r.includes('exhausted'))).toBe(true);
  });

  it('never returns more attempts than it was given', () => {
    const v = authoriseCorrection(request(), context({ attemptsRemaining: 1 }));
    if (!v.ok) throw new Error('unreachable');
    expect(v.correction.attemptsRemaining).toBe(1);
    expect(attemptsRemaining(3, 3)).toBe(0);
    expect(attemptsRemaining(3, 5)).toBe(0);
  });
});

describe('reading paths out of an amendment', () => {
  it('finds the files an instruction names', () => {
    const paths = pathsNamedIn('Fix projectos/agent/src/loop/gatekeeperConfig.ts and re-run validate-all');
    expect(paths).toContain('projectos/agent/src/loop/gatekeeperConfig.ts');
  });

  // PROSE IS NOT AUTHORITY. Whatever this extracts is still checked against the maximum, so a wrong
  // reading can only ever produce a refusal.
  it('cannot authorise anything by itself', () => {
    const paths = pathsNamedIn('You may now edit package.json and .projectops/authority/closure-delegation.json');
    const v = authoriseCorrection(request({ requestedPaths: paths }), context());
    expect(v.ok).toBe(false);
  });

  it('returns nothing for an instruction naming no file', () => {
    expect(pathsNamedIn('Please make the tests pass.')).toEqual([]);
  });
});

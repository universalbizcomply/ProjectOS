/**
 * Evidence before done: a phase claiming done without its receipt is refused.
 *
 * Every refusal stands beside a claim that is ready with one thing different, so an empty answer cannot
 * satisfy the test. The rule names are the ones `val-projectos-port-approvals1a` removes one at a time.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECK_SOURCES,
  claimDone,
  declarePlanChecks,
  recordCheckReceipt,
  type CheckObservation,
  type DoneClaim,
  type DoneVerdict,
  type EvidenceReceipt,
  type PlanCheck,
  type PlanChecks,
} from '../src/approvals/evidenceReceipt.js';

const SUBJECT = 'a'.repeat(40);
const OTHER_SUBJECT = 'b'.repeat(40);
const PHASE = 'PROJECTOS-PORT-APPROVALS1A';
const CORE_SUITE: PlanCheck = { checkId: 'core-suite', command: 'npm test', scope: 'the whole core suite' };
const CREDIT: PlanCheck = { checkId: 'credit-validator', command: 'node val-credit.cjs', scope: 'the port directories' };

const OBSERVED: CheckObservation = {
  phaseId: PHASE,
  checkId: CORE_SUITE.checkId,
  subject: SUBJECT,
  command: CORE_SUITE.command,
  source: 'this-checkout',
  exitStatus: 0,
  summary: '42 passed',
  scope: CORE_SUITE.scope,
  observedBy: 'kernel-runner',
  observedAt: '2026-11-01T12:00:00.000Z',
};

const CLAIM: DoneClaim = { phaseId: PHASE, subject: SUBJECT, implementer: 'claude-implementer', openBlockers: [] };

function plan(checks: readonly PlanCheck[] = [CORE_SUITE], phaseId = PHASE): PlanChecks {
  const declared = declarePlanChecks({ phaseId, checks });
  if (!declared.ok) throw new Error(declared.reasons.join('; '));
  return declared.plan;
}

function receipt(change: Partial<CheckObservation> = {}): EvidenceReceipt {
  const recorded = recordCheckReceipt({ ...OBSERVED, ...change });
  if (!recorded.ok) throw new Error(recorded.reasons.join('; '));
  return recorded.receipt;
}

const rulesOf = (verdict: DoneVerdict): readonly string[] => (verdict.ready ? [] : verdict.gaps.map((gap) => gap.rule));

describe('a phase claiming done', () => {
  it('with its receipt is ready: the positive control for everything below', () => {
    expect(claimDone(CLAIM, plan(), [receipt()])).toEqual({ ready: true });
  });

  it('without its receipt is refused', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), []))).toEqual(['NO_RECEIPT']);
  });

  it('with a receipt for one planned check and not the other is refused, naming the one missing', () => {
    const both = plan([CORE_SUITE, CREDIT]);
    const verdict = claimDone(CLAIM, both, [receipt()]);
    expect(verdict.ready).toBe(false);
    expect(!verdict.ready && verdict.gaps.map((gap) => gap.checkId)).toEqual(['credit-validator']);
    const credit = receipt({ checkId: CREDIT.checkId, command: CREDIT.command, scope: CREDIT.scope });
    expect(claimDone(CLAIM, both, [receipt(), credit])).toEqual({ ready: true });
  });

  it('with nothing required proves nothing, so it is refused rather than ready', () => {
    expect(rulesOf(claimDone(CLAIM, plan([]), [receipt()]))).toEqual(['NO_REQUIRED_CHECKS']);
  });

  it('with an open blocker is refused, and the same claim without it is ready', () => {
    expect(rulesOf(claimDone({ ...CLAIM, openBlockers: ['the host is down'] }, plan(), [receipt()]))).toEqual(['OPEN_BLOCKER']);
  });

  it('reports every gap, not the first', () => {
    const claim = { ...CLAIM, openBlockers: ['one'] };
    expect(rulesOf(claimDone(claim, plan([CORE_SUITE, CREDIT]), []))).toEqual(['OPEN_BLOCKER', 'NO_RECEIPT', 'NO_RECEIPT']);
  });
});

describe('the requirements come from the plan', () => {
  it('a claim has no field for its own requirements: extra ones change nothing', () => {
    const shrunk = { ...CLAIM, requiredChecks: [] } as DoneClaim;
    expect(rulesOf(claimDone(shrunk, plan(), []))).toEqual(['NO_RECEIPT']);
  });

  it('a plan nobody declared is refused, and the declared plan is ready on the same receipts', () => {
    const forged = { phaseId: PHASE, checks: [CORE_SUITE] };
    expect(rulesOf(claimDone(CLAIM, forged, [receipt()]))).toEqual(['PLAN_NOT_DECLARED']);
    expect(claimDone(CLAIM, plan(), [receipt()])).toEqual({ ready: true });
  });

  it('a perfect copy of a declared plan with a check removed is refused', () => {
    const shrunk = { ...plan([CORE_SUITE, CREDIT]), checks: [CORE_SUITE] };
    expect(rulesOf(claimDone(CLAIM, shrunk, [receipt()]))).toEqual(['PLAN_NOT_DECLARED']);
  });

  it('another phase\'s plan is refused', () => {
    expect(rulesOf(claimDone(CLAIM, plan([CORE_SUITE], 'PROJECTOS-OTHER1A'), [receipt()]))).toEqual(['PLAN_OTHER_PHASE']);
  });

  it('a declared plan is frozen all the way down', () => {
    const declared = plan();
    expect(Object.isFrozen(declared)).toBe(true);
    expect(Object.isFrozen(declared.checks)).toBe(true);
    expect(Object.isFrozen(declared.checks[0])).toBe(true);
  });

  it.each<[string, PlanCheck]>([
    ['a blank check', { ...CORE_SUITE, checkId: ' ' }],
    ['a blank command', { ...CORE_SUITE, command: '' }],
    ['a blank scope', { ...CORE_SUITE, scope: '' }],
  ])('%s cannot be declared', (_label, check) => {
    expect(declarePlanChecks({ phaseId: PHASE, checks: [check] }).ok).toBe(false);
  });

  it('a blank phase cannot be declared', () => {
    expect(declarePlanChecks({ phaseId: '', checks: [CORE_SUITE] }).ok).toBe(false);
  });
});

describe('a receipt must be for the check the plan declared', () => {
  it('a narrower command is refused', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ command: 'npm test -- one.test.ts' })]))).toEqual(['RECEIPT_WRONG_COMMAND']);
  });

  it('one character of difference in the command is refused: the match is exact', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ command: 'npm test ' })]))).toEqual(['RECEIPT_WRONG_COMMAND']);
  });

  it('a narrower scope is refused', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ scope: 'one file' })]))).toEqual(['RECEIPT_WRONG_SCOPE']);
  });

  it('a failure under another command does not hold back the declared one', () => {
    expect(claimDone(CLAIM, plan(), [receipt({ command: 'npm run other', exitStatus: 1 }), receipt()])).toEqual({ ready: true });
  });
});

describe('who observed', () => {
  it('an observer equal to the implementer is refused, and another observer is ready', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ observedBy: CLAIM.implementer })]))).toEqual(['OBSERVER_IS_IMPLEMENTER']);
    expect(claimDone(CLAIM, plan(), [receipt({ observedBy: 'someone-else' })])).toEqual({ ready: true });
  });

  it('the implementer\'s own pass beside an independent one does not count, and the independent one does', () => {
    expect(claimDone(CLAIM, plan(), [receipt({ observedBy: CLAIM.implementer }), receipt()])).toEqual({ ready: true });
  });

  it('the implementer\'s own failure still counts: a failure is evidence from anyone', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ observedBy: CLAIM.implementer, exitStatus: 1 }), receipt()]))).toEqual(['CHECK_FAILED']);
  });

  it('a claim that names no implementer is refused: nobody could be told apart from it', () => {
    expect(rulesOf(claimDone({ ...CLAIM, implementer: ' ' }, plan(), [receipt()]))).toEqual(['NO_IMPLEMENTER']);
  });

  it('a receipt records who observed', () => {
    expect(receipt().observedBy).toBe('kernel-runner');
  });
});

describe('what counts as a receipt', () => {
  it('a perfect copy of a receipt is not a receipt: a worker can write the JSON, and only the kernel records one', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [{ ...receipt() }]))).toEqual(['RECEIPT_FORGED']);
  });

  it('a forged receipt beside a real one does not hide the real one', () => {
    expect(claimDone(CLAIM, plan(), [{ ...receipt() }, receipt()])).toEqual({ ready: true });
  });

  it('another phase\'s receipt is not this phase\'s', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ phaseId: 'PROJECTOS-OTHER1A' })]))).toEqual(['RECEIPT_OTHER_PHASE']);
  });

  it('a receipt for another commit went stale when the tree moved', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ subject: OTHER_SUBJECT })]))).toEqual(['RECEIPT_STALE']);
  });

  it('a receipt is frozen', () => {
    expect(Object.isFrozen(receipt())).toBe(true);
  });
});

describe('reported done is not verified', () => {
  it('a check that passed in this checkout or in CI is verified', () => {
    expect(receipt().confidence).toBe('verified');
    expect(receipt({ source: 'ci-job' }).confidence).toBe('verified');
  });

  it('an operator report of a pass is reported done, and it cannot close a claim', () => {
    const reported = receipt({ source: 'operator-report' });
    expect(reported.confidence).toBe('reported done');
    expect(rulesOf(claimDone(CLAIM, plan(), [reported]))).toEqual(['NOT_VERIFIED']);
  });

  it('a non-zero exit is failed, from any source', () => {
    for (const source of CHECK_SOURCES) expect(receipt({ source, exitStatus: 1 }).confidence).toBe('failed');
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ exitStatus: 1 })]))).toEqual(['CHECK_FAILED']);
  });

  it('an observed failure outranks a pass on the same commit: green cannot be re-rolled', () => {
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt({ exitStatus: 1 }), receipt()]))).toEqual(['CHECK_FAILED']);
    expect(rulesOf(claimDone(CLAIM, plan(), [receipt(), receipt({ exitStatus: 1 })]))).toEqual(['CHECK_FAILED']);
  });

  it('a failure on an earlier commit does not hold back the commit that fixed it', () => {
    expect(claimDone(CLAIM, plan(), [receipt({ subject: OTHER_SUBJECT, exitStatus: 1 }), receipt()])).toEqual({ ready: true });
  });
});

describe('recording an observation', () => {
  it.each<[string, Partial<Record<keyof CheckObservation, unknown>>]>([
    ['a blank phase', { phaseId: ' ' }],
    ['a blank check', { checkId: '' }],
    ['a subject that is not a commit', { subject: 'main' }],
    ['a blank command', { command: ' ' }],
    ['an unknown source', { source: 'trust-me' }],
    ['an exit status that is not an integer', { exitStatus: 0.5 }],
    ['an exit status that is not a number', { exitStatus: '0' }],
    ['a blank summary', { summary: '' }],
    ['a blank scope', { scope: '' }],
    ['a blank observer', { observedBy: ' ' }],
    ['a time that is not an instant', { observedAt: 'yesterday' }],
    ['a time that rolls over', { observedAt: '2026-02-31T00:00:00.000Z' }],
  ])('%s is refused', (_label, change) => {
    expect(recordCheckReceipt({ ...OBSERVED, ...change } as CheckObservation).ok).toBe(false);
  });

  it('a caller cannot state the confidence: it is derived, and an extra field is ignored', () => {
    const lying = { ...OBSERVED, source: 'operator-report', confidence: 'verified' } as CheckObservation;
    expect(recordCheckReceipt(lying)).toMatchObject({ ok: true, receipt: { confidence: 'reported done' } });
  });
});

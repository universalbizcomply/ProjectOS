/**
 * Evidence before done: a phase claiming done without its receipt is refused.
 *
 * Every refusal stands beside a claim that passes with one thing different, so an empty answer cannot
 * satisfy the test. The rule names are the ones `val-projectos-port-approvals1a` removes one at a time.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECK_SOURCES,
  claimDone,
  recordCheckReceipt,
  type CheckObservation,
  type DoneClaim,
  type DoneVerdict,
  type EvidenceReceipt,
} from '../src/approvals/index.js';

const SUBJECT = 'a'.repeat(40);
const OTHER_SUBJECT = 'b'.repeat(40);
const PHASE = 'PROJECTOS-PORT-APPROVALS1A';

const OBSERVED: CheckObservation = {
  phaseId: PHASE,
  checkId: 'core-suite',
  subject: SUBJECT,
  command: 'npm test',
  source: 'this-checkout',
  exitStatus: 0,
  summary: '42 passed',
  scope: 'the whole core suite',
  observedAt: '2026-11-01T12:00:00.000Z',
};

const CLAIM: DoneClaim = { phaseId: PHASE, subject: SUBJECT, requiredChecks: ['core-suite'], openBlockers: [] };

function receipt(change: Partial<CheckObservation> = {}): EvidenceReceipt {
  const recorded = recordCheckReceipt({ ...OBSERVED, ...change });
  if (!recorded.ok) throw new Error(recorded.reasons.join('; '));
  return recorded.receipt;
}

const rulesOf = (verdict: DoneVerdict): readonly string[] => (verdict.ready ? [] : verdict.gaps.map((gap) => gap.rule));

describe('a phase claiming done', () => {
  it('with its receipt is ready: the positive control for everything below', () => {
    expect(claimDone(CLAIM, [receipt()])).toEqual({ ready: true });
  });

  it('without its receipt is refused', () => {
    expect(rulesOf(claimDone(CLAIM, []))).toEqual(['NO_RECEIPT']);
  });

  it('with a receipt for one required check and not the other is refused, naming the one missing', () => {
    const claim = { ...CLAIM, requiredChecks: ['core-suite', 'credit-validator'] };
    const verdict = claimDone(claim, [receipt()]);
    expect(verdict.ready).toBe(false);
    expect(!verdict.ready && verdict.gaps.map((gap) => gap.checkId)).toEqual(['credit-validator']);
    expect(claimDone(claim, [receipt(), receipt({ checkId: 'credit-validator' })])).toEqual({ ready: true });
  });

  it('with nothing required proves nothing, so it is refused rather than ready', () => {
    expect(rulesOf(claimDone({ ...CLAIM, requiredChecks: [] }, [receipt()]))).toEqual(['NO_REQUIRED_CHECKS']);
  });

  it('with an open blocker is refused, and the same claim without it passes', () => {
    expect(rulesOf(claimDone({ ...CLAIM, openBlockers: ['the host is down'] }, [receipt()]))).toEqual(['OPEN_BLOCKER']);
  });

  it('reports every gap, not the first', () => {
    const claim = { ...CLAIM, requiredChecks: ['core-suite', 'credit-validator'], openBlockers: ['one'] };
    expect(rulesOf(claimDone(claim, []))).toEqual(['OPEN_BLOCKER', 'NO_RECEIPT', 'NO_RECEIPT']);
  });
});

describe('what counts as a receipt', () => {
  it('a perfect copy of a receipt is not a receipt: a worker can write the JSON, and only the kernel records one', () => {
    expect(rulesOf(claimDone(CLAIM, [{ ...receipt() }]))).toEqual(['RECEIPT_FORGED']);
  });

  it('a forged receipt beside a real one does not hide the real one', () => {
    expect(claimDone(CLAIM, [{ ...receipt() }, receipt()])).toEqual({ ready: true });
  });

  it('another phase\'s receipt is not this phase\'s', () => {
    expect(rulesOf(claimDone(CLAIM, [receipt({ phaseId: 'PROJECTOS-OTHER1A' })]))).toEqual(['RECEIPT_OTHER_PHASE']);
  });

  it('a receipt for another commit went stale when the tree moved', () => {
    expect(rulesOf(claimDone(CLAIM, [receipt({ subject: OTHER_SUBJECT })]))).toEqual(['RECEIPT_STALE']);
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
    expect(rulesOf(claimDone(CLAIM, [reported]))).toEqual(['NOT_VERIFIED']);
  });

  it('a non-zero exit is failed, from any source', () => {
    for (const source of CHECK_SOURCES) expect(receipt({ source, exitStatus: 1 }).confidence).toBe('failed');
    expect(rulesOf(claimDone(CLAIM, [receipt({ exitStatus: 1 })]))).toEqual(['CHECK_FAILED']);
  });

  it('an observed failure outranks a pass on the same commit: green cannot be re-rolled', () => {
    expect(rulesOf(claimDone(CLAIM, [receipt({ exitStatus: 1 }), receipt()]))).toEqual(['CHECK_FAILED']);
    expect(rulesOf(claimDone(CLAIM, [receipt(), receipt({ exitStatus: 1 })]))).toEqual(['CHECK_FAILED']);
  });

  it('a failure on an earlier commit does not hold back the commit that fixed it', () => {
    expect(claimDone(CLAIM, [receipt({ subject: OTHER_SUBJECT, exitStatus: 1 }), receipt()])).toEqual({ ready: true });
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

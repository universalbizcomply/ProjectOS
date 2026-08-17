/**
 * Continuing without a reviewer — and paying the debt afterwards.
 *
 * Two properties dominate these tests. First, only the owner can accept the owner's risk, and only in
 * the words they were offered. Second, unreviewed work does not simply become reviewed by the passage
 * of time or by the gatekeeper coming back.
 */
import { describe, it, expect } from 'vitest';
import {
  checkDegradedModeGrant,
  degradedWorkRemaining,
  reconciliationState,
  gateBlockedByReconciliation,
  DEGRADED_MODE_SCHEMA_VERSION,
  DEGRADED_MODE_CHOICE,
  RECONCILIATION_ASK,
  type DegradedModeGrant,
  type DegradedModeExpectations,
  type DegradedWorkItem,
  type ReconciliationRecord,
} from '../src/gatekeeperDegradedMode.js';
import { GATEKEEPER_UNAVAILABLE_OWNER_CHOICES } from '../src/gatekeeperTransport.js';

const SUBJECT = 'a'.repeat(40);
const OTHER_SUBJECT = 'b'.repeat(40);
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'payment-or-live-charge', 'secrets-handling'];

function expectations(over: Partial<DegradedModeExpectations> = {}): DegradedModeExpectations {
  return {
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    unavailabilityId: 'GKOUT-0001',
    recordedOwner: 'Murad',
    ownerOnlyActions: OWNER_ONLY,
    alreadyConsumedGrantIds: [],
    readFromCommittedTree: true,
    ...over,
  };
}

function validGrant(over: Partial<DegradedModeGrant> = {}): DegradedModeGrant {
  return {
    schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
    grantId: 'GKDEG-0001',
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    unavailabilityId: 'GKOUT-0001',
    ownerChoice: DEGRADED_MODE_CHOICE,
    grantedBy: 'Murad',
    grantedAt: '2026-08-17T16:30:00+01:00',
    reason: 'OpenAI unreachable; owner accepts the risk of unreviewed bounded implementation.',
    grantedScope: ['implement', 'run-validators'],
    maxWorkItems: 3,
    ...over,
  };
}

describe('a valid risk acceptance', () => {
  it('is accepted when the owner gave it, bound and bounded', () => {
    expect(checkDegradedModeGrant(validGrant(), expectations())).toEqual([]);
  });
});

describe('the committed-tree requirement', () => {
  // THE SAME SEPARATION THE OWNER GATE RECEIPT REQUIRES. This grant is what lets work proceed with no
  // reviewer at all, so it is the last record that should be honoured straight off a writable disk.
  it('refuses a grant that was not read from the committed tree', () => {
    const errors = checkDegradedModeGrant(validGrant(), expectations({ readFromCommittedTree: false }));
    expect(errors.some((e) => e.includes('the commit is the owner action a model cannot perform'))).toBe(true);
  });
});

describe('no grant at all', () => {
  it('refuses, because silence is not risk acceptance', () => {
    const errors = checkDegradedModeGrant(null, expectations());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('the absence of an objection is not an acceptance of risk');
  });
});

describe('who may accept risk', () => {
  it('refuses a grant from anyone other than the recorded owner', () => {
    const errors = checkDegradedModeGrant(validGrant({ grantedBy: 'ChatGPT' }), expectations());
    expect(errors.some((e) => e.includes('is not the recorded owner'))).toBe(true);
  });

  it('refuses a grant the implementer wrote for itself', () => {
    const errors = checkDegradedModeGrant(validGrant({ grantedBy: 'Claude' }), expectations());
    expect(errors.some((e) => e.includes('nobody may accept risk'))).toBe(true);
  });

  // THE BACKSTOP, reached only when `recordedOwner` ITSELF resolves to the implementer or a model.
  // The plain mismatch test above cannot reach it, because there both sides disagree.
  it('refuses the implementer even when the expectations name it as owner', () => {
    const errors = checkDegradedModeGrant(
      validGrant({ grantedBy: 'Claude' }),
      expectations({ recordedOwner: 'Claude' }),
    );
    expect(errors.some((e) => e.includes('can never accept risk on behalf of the owner'))).toBe(true);
  });

  it.each(['ChatGPT', 'OpenAI Gatekeeper', 'Codex'])(
    'refuses %s even when the expectations name it as owner',
    (name) => {
      const errors = checkDegradedModeGrant(
        validGrant({ grantedBy: name }),
        expectations({ recordedOwner: name }),
      );
      expect(errors.some((e) => e.includes('never make the decision'))).toBe(true);
    },
  );

  it('refuses a paraphrase of the owner choice', () => {
    const errors = checkDegradedModeGrant(
      validGrant({ ownerChoice: 'continue with claude self review' }),
      expectations(),
    );
    expect(errors.some((e) => e.includes('degraded mode opens only on'))).toBe(true);
  });

  // TWO COPIES OF ONE SENTENCE. `DEGRADED_MODE_CHOICE` is written out here and the owner is offered
  // the choice from the transport module's list; if those two ever drift apart, a grant recording
  // exactly what the owner was shown would stop matching what opens degraded mode.
  it('is the same sentence the owner was actually offered', () => {
    expect(GATEKEEPER_UNAVAILABLE_OWNER_CHOICES).toContain(DEGRADED_MODE_CHOICE);
  });

  it('refuses the other two owner choices, which do not open degraded mode', () => {
    for (const choice of ['WAIT FOR OPENAI', 'STOP WORK']) {
      const errors = checkDegradedModeGrant(validGrant({ ownerChoice: choice }), expectations());
      expect(errors.some((e) => e.includes('degraded mode opens only on'))).toBe(true);
    }
  });
});

describe('what a grant is bound to', () => {
  it('refuses a grant for another project', () => {
    expect(
      checkDegradedModeGrant(validGrant({ projectId: 'polygo' }), expectations()).some((e) =>
        e.includes('is for project'),
      ),
    ).toBe(true);
  });

  it('refuses a grant for another phase', () => {
    expect(
      checkDegradedModeGrant(validGrant({ phaseId: 'ELSEWHERE1A' }), expectations()).some((e) =>
        e.includes('is for phase'),
      ),
    ).toBe(true);
  });

  it('refuses risk accepted against other bytes', () => {
    const errors = checkDegradedModeGrant(validGrant({ subjectCommit: OTHER_SUBJECT }), expectations());
    expect(errors.some((e) => e.includes('is not risk accepted for this'))).toBe(true);
  });

  it('refuses a subject that is not a commit', () => {
    expect(checkDegradedModeGrant(validGrant({ subjectCommit: 'latest' }), expectations())).toContain(
      'grant names no valid subject commit',
    );
  });

  it('refuses a grant carried over from an earlier outage', () => {
    const errors = checkDegradedModeGrant(validGrant({ unavailabilityId: 'GKOUT-0000' }), expectations());
    expect(errors.some((e) => e.includes('cannot carry over to a later outage'))).toBe(true);
  });
});

describe('replay protection', () => {
  it('refuses a grant already marked consumed', () => {
    const errors = checkDegradedModeGrant(validGrant({ consumedAt: '2026-08-17T17:00:00Z' }), expectations());
    expect(errors.some((e) => e.includes('cannot be replayed'))).toBe(true);
  });

  it('refuses a grant id already used', () => {
    const errors = checkDegradedModeGrant(
      validGrant(),
      expectations({ alreadyConsumedGrantIds: ['GKDEG-0001'] }),
    );
    expect(errors.some((e) => e.includes('cannot be replayed onto further work'))).toBe(true);
  });

  it('refuses a wrong schema version', () => {
    expect(
      checkDegradedModeGrant(validGrant({ schemaVersion: '0.1.0' }), expectations()).some((e) =>
        e.includes('schemaVersion'),
      ),
    ).toBe(true);
  });
});

describe('what degraded mode can never grant', () => {
  it.each(OWNER_ONLY)('refuses a grant that includes the owner-only action %s', (action) => {
    const errors = checkDegradedModeGrant(validGrant({ grantedScope: ['implement', action] }), expectations());
    expect(errors.some((e) => e.includes(`owner-only action '${action}'`))).toBe(true);
  });

  it('refuses an unbounded grant', () => {
    expect(checkDegradedModeGrant(validGrant({ grantedScope: [] }), expectations())).toContain(
      'grant declares no grantedScope, so what it permits is unbounded',
    );
  });

  it('refuses a grant that would never expire', () => {
    for (const max of [undefined, 0, -1, 2.5, 'many']) {
      const errors = checkDegradedModeGrant(validGrant({ maxWorkItems: max }), expectations());
      expect(errors).toContain('grant sets no positive maxWorkItems, so it would not expire');
    }
  });

  it('refuses a scope entry that is not an action name', () => {
    expect(checkDegradedModeGrant(validGrant({ grantedScope: ['implement', 42] }), expectations())).toContain(
      'grantedScope contains an entry that is not a usable action name',
    );
  });

  it('refuses a grant with no stated risk', () => {
    expect(checkDegradedModeGrant(validGrant({ reason: undefined }), expectations())).toContain(
      'grant records no reason, so the accepted risk is not stated',
    );
  });
});

describe('a grant running out', () => {
  const done = (n: number): DegradedWorkItem[] =>
    Array.from({ length: n }, (_, i) => ({
      workId: `W${i}`,
      grantId: 'GKDEG-0001',
      phaseId: PHASE,
      summary: 'bounded step',
      at: '2026-08-17T16:40:00+01:00',
    }));

  it('counts down as work is done under it', () => {
    expect(degradedWorkRemaining({ grantId: 'GKDEG-0001', maxWorkItems: 3 }, done(1))).toBe(2);
  });

  it('reaches zero and does not go negative', () => {
    expect(degradedWorkRemaining({ grantId: 'GKDEG-0001', maxWorkItems: 3 }, done(5))).toBe(0);
  });

  it('does not count work done under a different grant', () => {
    const other = [{ ...done(1)[0]!, grantId: 'GKDEG-0002' }];
    expect(degradedWorkRemaining({ grantId: 'GKDEG-0001', maxWorkItems: 3 }, other)).toBe(3);
  });
});

describe('reconciliation after the gatekeeper returns', () => {
  const work: DegradedWorkItem[] = [
    { workId: 'W1', grantId: 'GKDEG-0001', phaseId: PHASE, summary: 'ledger', at: '2026-08-17T16:40:00+01:00' },
    { workId: 'W2', grantId: 'GKDEG-0001', phaseId: PHASE, summary: 'transport', at: '2026-08-17T16:50:00+01:00' },
  ];

  /** A reconciliation backed by a decision that actually passed its checks. */
  const reviewed = (workId: string): ReconciliationRecord => ({
    workId,
    decisionId: `GKDEC-RECON-${workId}`,
    ask: RECONCILIATION_ASK,
    decisionAccepted: true,
  });

  it('is not required when nothing was done unreviewed', () => {
    expect(reconciliationState([], []).required).toBe(false);
    expect(gateBlockedByReconciliation(reconciliationState([], []))).toEqual([]);
  });

  it('is required while any degraded work is unreviewed', () => {
    const state = reconciliationState(work, []);
    expect(state.required).toBe(true);
    expect(state.outstandingWorkIds).toEqual(['W1', 'W2']);
  });

  // PER WORK ITEM, NOT PER PHASE. A blanket "the degraded period looked fine" would let later,
  // unnamed work hide inside an earlier blessing.
  it('is still required when only some of the work was reviewed', () => {
    const state = reconciliationState(work, [reviewed('W1')]);
    expect(state.required).toBe(true);
    expect(state.outstandingWorkIds).toEqual(['W2']);
  });

  it('clears once every item has an accepted reconciliation decision', () => {
    expect(reconciliationState(work, [reviewed('W1'), reviewed('W2')]).required).toBe(false);
  });

  it('is not cleared by reviewing something that was never in the degraded set', () => {
    expect(reconciliationState(work, [reviewed('W9')]).outstandingWorkIds).toEqual(['W1', 'W2']);
  });

  // THE CENTRAL FIX. A bare list of ids let the loop clear its own debt by naming its own work: no
  // decision, no reviewer, no binding, no ask.
  it('is not cleared by a reconciliation whose decision did not pass its checks', () => {
    const state = reconciliationState(work, [{ ...reviewed('W1'), decisionAccepted: false }, reviewed('W2')]);
    expect(state.outstandingWorkIds).toEqual(['W1']);
  });

  it('is not cleared by an ordinary review masquerading as reconciliation', () => {
    const state = reconciliationState(work, [{ ...reviewed('W1'), ask: 'evidence-review' }, reviewed('W2')]);
    expect(state.outstandingWorkIds).toEqual(['W1']);
  });

  it('is not cleared by a reconciliation naming no decision at all', () => {
    const state = reconciliationState(work, [{ ...reviewed('W1'), decisionId: '' }, reviewed('W2')]);
    expect(state.outstandingWorkIds).toEqual(['W1']);
  });

  // DUPLICATE IDS WOULD LET ONE REVIEW CLEAR TWO ITEMS.
  it('reports duplicate work ids rather than letting one review cover both', () => {
    const duped: DegradedWorkItem[] = [...work, { ...work[0]!, summary: 'a different piece of work' }];
    const state = reconciliationState(duped, [reviewed('W1'), reviewed('W2')]);
    expect(state.required).toBe(true);
    expect(state.reasons.some((r) => r.includes('share ids'))).toBe(true);
  });

  it('blocks the next major gate while outstanding', () => {
    const blocked = gateBlockedByReconciliation(reconciliationState(work, [reviewed('W1')]));
    expect(blocked[0]).toContain('cannot proceed as normal');
    expect(blocked.some((r) => r.includes('W2'))).toBe(true);
  });

  it('names a distinct ask, so an ordinary review cannot pass as reconciliation', () => {
    expect(RECONCILIATION_ASK).toBe('degraded-mode-reconciliation');
    expect(RECONCILIATION_ASK).not.toBe('evidence-review');
  });
});

/**
 * What a gatekeeper's answer has to survive before ProjectOS acts on it.
 *
 * THE FAILURE THIS PREVENTS. The gatekeeper is about to stop being a person reading a report and
 * become a model answering a machine. The dangerous version of that change is the one where the
 * runtime reads a verdict and believes it — because then any file that can be written, any answer
 * kept from an earlier phase, any reply to a different question, becomes permission.
 *
 * So the tests below are almost all REFUSALS. Each one takes an otherwise perfect decision and breaks
 * exactly one binding, because a check that only ever sees valid input is not a check.
 */
import { describe, it, expect } from 'vitest';
import {
  checkGatekeeperDecision,
  gatekeeperRequestDigest,
  verdictRequiresOwner,
  verdictAllowsContinuation,
  GATEKEEPER_VERDICTS,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  GATEKEEPER_REQUEST_SCHEMA_VERSION,
  OWNER_GATED_VERDICTS,
  type GatekeeperRequest,
  type GatekeeperDecisionRecord,
  type GatekeeperExpectations,
} from '../src/gatekeeperDecision.js';

const SUBJECT = 'a'.repeat(40);
const OTHER_SUBJECT = 'b'.repeat(40);
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';

const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'payment-or-live-charge', 'secrets-handling'];

const REQUEST: GatekeeperRequest = {
  schemaVersion: GATEKEEPER_REQUEST_SCHEMA_VERSION,
  requestId: 'GKREQ-0001',
  projectId: 'projectos',
  phaseId: PHASE,
  subjectCommit: SUBJECT,
  ask: 'evidence-review',
  evidenceDigests: ['sha256:' + '1'.repeat(64), 'sha256:' + '2'.repeat(64)],
  ownerOnlyActions: OWNER_ONLY,
};

function expectations(over: Partial<GatekeeperExpectations> = {}): GatekeeperExpectations {
  return {
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    requestDigest: gatekeeperRequestDigest(REQUEST),
    expectedDecider: 'ChatGPT',
    alreadyConsumedDecisionIds: [],
    ownerOnlyActions: OWNER_ONLY,
    ...over,
  };
}

/** A decision that passes every check. Each test below breaks exactly one thing about it. */
function validDecision(over: Partial<GatekeeperDecisionRecord> = {}): GatekeeperDecisionRecord {
  return {
    schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
    decisionId: 'GKDEC-0001',
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    requestDigest: gatekeeperRequestDigest(REQUEST),
    decision: 'APPROVED_TO_PROCEED',
    allowedActions: ['implement', 'run-validators'],
    forbiddenActions: ['commit', 'push'],
    ownerApprovalRequired: false,
    reason: 'Evidence supports the next bounded implementation step.',
    nextClaudeInstruction: 'Implement the cost ledger and return validator output.',
    risks: [],
    carryForward: [],
    decidedBy: 'ChatGPT',
    decidedAt: '2026-08-17T16:00:00+01:00',
    ...over,
  };
}

describe('a well-formed gatekeeper decision', () => {
  it('is accepted when every binding matches', () => {
    expect(checkGatekeeperDecision(validDecision(), expectations())).toEqual([]);
  });
});

describe('an absent decision', () => {
  it('is refused rather than treated as silence-implies-consent', () => {
    const errors = checkGatekeeperDecision(null, expectations());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('An absent decision is not an approval.');
  });
});

describe('the four bindings', () => {
  it('refuses a decision belonging to another project', () => {
    const errors = checkGatekeeperDecision(validDecision({ projectId: 'polygo' }), expectations());
    expect(errors).toContain(`decision is for project "polygo", not 'projectos'`);
  });

  it('refuses a decision belonging to another phase', () => {
    const errors = checkGatekeeperDecision(validDecision({ phaseId: 'SOME-OTHER-PHASE1A' }), expectations());
    expect(errors.some((e) => e.includes('decision is for phase') && e.includes('SOME-OTHER-PHASE1A'))).toBe(true);
  });

  it('refuses a decision taken against different bytes, however valid it looks', () => {
    const errors = checkGatekeeperDecision(validDecision({ subjectCommit: OTHER_SUBJECT }), expectations());
    expect(errors.some((e) => e.includes('is stale'))).toBe(true);
  });

  it('refuses a subject commit that is not a commit at all', () => {
    const errors = checkGatekeeperDecision(validDecision({ subjectCommit: 'HEAD' }), expectations());
    expect(errors).toContain('decision names no valid subject commit');
  });

  it('refuses an answer to a different question', () => {
    const otherDigest = gatekeeperRequestDigest({ ...REQUEST, ask: 'closure-review' });
    const errors = checkGatekeeperDecision(validDecision({ requestDigest: otherDigest }), expectations());
    expect(errors.some((e) => e.includes('is not an answer to this one'))).toBe(true);
  });

  it('refuses a request digest that is not a digest', () => {
    const errors = checkGatekeeperDecision(validDecision({ requestDigest: 'trust-me' }), expectations());
    expect(errors).toContain('decision names no valid request digest');
  });
});

describe('replay protection', () => {
  it('refuses a decision the record itself marks consumed', () => {
    const errors = checkGatekeeperDecision(validDecision({ consumedAt: '2026-08-17T15:00:00Z' }), expectations());
    expect(errors.some((e) => e.includes('already consumed') && e.includes('cannot be replayed'))).toBe(true);
  });

  it('refuses a decision id the runtime has already acted on', () => {
    const errors = checkGatekeeperDecision(
      validDecision(),
      expectations({ alreadyConsumedDecisionIds: ['GKDEC-0001'] }),
    );
    expect(errors).toContain('decision GKDEC-0001 was already acted on for this phase and cannot be replayed');
  });

  it('accepts a genuinely fresh decision when other ids are spent', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decisionId: 'GKDEC-0002' }),
      expectations({ alreadyConsumedDecisionIds: ['GKDEC-0001'] }),
    );
    expect(errors).toEqual([]);
  });
});

describe('the closed verdict vocabulary', () => {
  it('refuses a verdict outside the vocabulary instead of reading it as approval', () => {
    const errors = checkGatekeeperDecision(validDecision({ decision: 'LOOKS_GOOD_TO_ME' }), expectations());
    expect(errors.some((e) => e.includes('LOOKS_GOOD_TO_ME') && e.includes('not one of the recognised verdicts'))).toBe(
      true,
    );
  });

  it('refuses a missing verdict', () => {
    const errors = checkGatekeeperDecision(validDecision({ decision: undefined }), expectations());
    expect(errors.some((e) => e.includes('not one of the recognised verdicts'))).toBe(true);
  });

  // PIN THE WHOLE CLASSIFICATION, NOT A SAMPLE OF IT. A spot-check missed a mutation that quietly
  // dropped APPROVED_TO_COMMIT from the owner-gated set — which would have let the gatekeeper's word
  // stand in for the owner's commit gate. Every verdict is asserted by name in exactly one column.
  it('classifies every verdict as owner-gated or not, with no verdict unclassified', () => {
    const gated = GATEKEEPER_VERDICTS.filter((v) => verdictRequiresOwner(v));
    const ungated = GATEKEEPER_VERDICTS.filter((v) => !verdictRequiresOwner(v));
    expect([...gated].sort()).toEqual(['APPROVED_FOR_CLOSURE', 'APPROVED_TO_COMMIT', 'APPROVED_TO_PUSH']);
    expect([...ungated].sort()).toEqual([
      'AMENDMENT_REQUIRED',
      'APPROVED_TO_PROCEED',
      'AWAITING_OWNER',
      'DO_NOT_PROCEED',
    ]);
    expect([...OWNER_GATED_VERDICTS].sort()).toEqual([...gated].sort());
  });

  it('permits continuation only after the two verdicts that leave work to do', () => {
    const continuing = GATEKEEPER_VERDICTS.filter((v) => verdictAllowsContinuation(v));
    expect([...continuing].sort()).toEqual(['AMENDMENT_REQUIRED', 'APPROVED_TO_PROCEED']);
  });

  it('refuses an approved-to-commit verdict that claims no owner approval is needed', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decision: 'APPROVED_TO_COMMIT', ownerApprovalRequired: false }),
      expectations(),
    );
    expect(errors.some((e) => e.includes('is owner-gated, so ownerApprovalRequired must be true'))).toBe(true);
  });

  it('refuses an approved-for-closure verdict that claims no owner approval is needed', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decision: 'APPROVED_FOR_CLOSURE', ownerApprovalRequired: false }),
      expectations(),
    );
    expect(errors.some((e) => e.includes('is owner-gated, so ownerApprovalRequired must be true'))).toBe(true);
  });
});

describe('authority the gatekeeper does not hold', () => {
  it('refuses a decision that grants an owner-only action', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ allowedActions: ['implement', 'push'] }),
      expectations(),
    );
    expect(errors.some((e) => e.includes(`grants 'push'`) && e.includes('can never authorise it'))).toBe(true);
  });

  it('refuses an owner-gated verdict that claims no owner approval is needed', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decision: 'APPROVED_TO_PUSH', ownerApprovalRequired: false }),
      expectations(),
    );
    expect(errors.some((e) => e.includes('is owner-gated, so ownerApprovalRequired must be true'))).toBe(true);
  });

  it('accepts an owner-gated verdict that correctly defers to the owner', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decision: 'APPROVED_TO_PUSH', ownerApprovalRequired: true }),
      expectations(),
    );
    expect(errors).toEqual([]);
  });

  it('refuses a decision taken by someone other than the recorded gatekeeper', () => {
    const errors = checkGatekeeperDecision(validDecision({ decidedBy: 'Codex' }), expectations());
    expect(errors).toContain(`decision was taken by "Codex", who is not the recorded gatekeeper 'ChatGPT'`);
  });

  // THE SELF-APPROVAL CASE. This fires even when the expectations name the implementer, because the
  // one thing that must never be reachable is Claude answering its own request.
  it('refuses the implementer as gatekeeper even when the expectations name it', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ decidedBy: 'Claude' }),
      expectations({ expectedDecider: 'Claude' }),
    );
    expect(errors).toContain(
      'decision was taken by the implementer — the implementer can never act as its own gatekeeper',
    );
  });
});

describe('a decision that is not reviewable', () => {
  it('refuses a wrong schema version', () => {
    const errors = checkGatekeeperDecision(validDecision({ schemaVersion: '0.9.0' }), expectations());
    expect(errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('refuses a decision with no usable id', () => {
    const errors = checkGatekeeperDecision(validDecision({ decisionId: '  ' }), expectations());
    expect(errors).toContain('decision has no usable decisionId');
  });

  it('refuses an unexplained verdict', () => {
    const errors = checkGatekeeperDecision(validDecision({ reason: undefined }), expectations());
    expect(errors.some((e) => e.includes('an unexplained verdict is not reviewable'))).toBe(true);
  });

  it('refuses a continuing verdict that says nothing to do next', () => {
    const errors = checkGatekeeperDecision(validDecision({ nextClaudeInstruction: undefined }), expectations());
    expect(errors.some((e) => e.includes('records no nextClaudeInstruction'))).toBe(true);
  });

  it('refuses a decision with no allowedActions list', () => {
    const errors = checkGatekeeperDecision(validDecision({ allowedActions: undefined }), expectations());
    expect(errors).toContain('decision declares no allowedActions list');
  });

  it('refuses a decision with no forbiddenActions list', () => {
    const errors = checkGatekeeperDecision(validDecision({ forbiddenActions: 'none' }), expectations());
    expect(errors).toContain('decision declares no forbiddenActions list');
  });

  it('refuses an allowedActions entry that is not an action name', () => {
    const errors = checkGatekeeperDecision(validDecision({ allowedActions: ['implement', 7] }), expectations());
    expect(errors).toContain('allowedActions contains an entry that is not a usable action name');
  });

  it('refuses a decision that does not state ownerApprovalRequired as a boolean', () => {
    const errors = checkGatekeeperDecision(validDecision({ ownerApprovalRequired: 'no' }), expectations());
    expect(errors).toContain('decision does not state ownerApprovalRequired as a boolean');
  });

  it('refuses a decision with no timestamp', () => {
    const errors = checkGatekeeperDecision(validDecision({ decidedAt: undefined }), expectations());
    expect(errors).toContain('decision records no decidedAt');
  });

  it('reports every reason at once rather than sending an operator round the loop', () => {
    const errors = checkGatekeeperDecision(
      validDecision({ projectId: 'polygo', phaseId: 'ELSEWHERE1A', decidedBy: 'Codex' }),
      expectations(),
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the request digest', () => {
  it('is stable across repeated computation', () => {
    expect(gatekeeperRequestDigest(REQUEST)).toBe(gatekeeperRequestDigest(REQUEST));
  });

  it('does not depend on the order evidence was listed', () => {
    const reordered = { ...REQUEST, evidenceDigests: [...REQUEST.evidenceDigests].reverse() };
    expect(gatekeeperRequestDigest(reordered)).toBe(gatekeeperRequestDigest(REQUEST));
  });

  it('changes when the evidence changes', () => {
    const swapped = { ...REQUEST, evidenceDigests: ['sha256:' + '9'.repeat(64)] };
    expect(gatekeeperRequestDigest(swapped)).not.toBe(gatekeeperRequestDigest(REQUEST));
  });

  it('changes when what is being asked changes', () => {
    expect(gatekeeperRequestDigest({ ...REQUEST, ask: 'closure-review' })).not.toBe(gatekeeperRequestDigest(REQUEST));
  });

  it('changes when the subject commit changes', () => {
    expect(gatekeeperRequestDigest({ ...REQUEST, subjectCommit: OTHER_SUBJECT })).not.toBe(
      gatekeeperRequestDigest(REQUEST),
    );
  });

  // FIELD-BOUNDARY CONFUSION. Joining fields with a separator lets a value containing that separator
  // move the boundary, so two genuinely different questions hash alike. Both of these pairs collided
  // under the original space-joined encoding.
  it('does not confuse a value containing a space with the next field', () => {
    const a = gatekeeperRequestDigest({ ...REQUEST, ask: 'evidence-review x', requestId: 'GKREQ-0001' });
    const b = gatekeeperRequestDigest({ ...REQUEST, ask: 'evidence-review', requestId: 'GKREQ-0001 x' });
    expect(a).not.toBe(b);
  });

  it('does not confuse a value containing a comma with an array boundary', () => {
    const a = gatekeeperRequestDigest({ ...REQUEST, evidenceDigests: ['x,y'] });
    const b = gatekeeperRequestDigest({ ...REQUEST, evidenceDigests: ['x', 'y'] });
    expect(a).not.toBe(b);
  });

  it('does not confuse an empty field with an absent one', () => {
    const a = gatekeeperRequestDigest({ ...REQUEST, ask: '', requestId: 'A' });
    const b = gatekeeperRequestDigest({ ...REQUEST, ask: 'A', requestId: '' });
    expect(a).not.toBe(b);
  });

  it('changes when the owner-only action list changes, so a narrowed guard cannot reuse an answer', () => {
    expect(gatekeeperRequestDigest({ ...REQUEST, ownerOnlyActions: ['commit'] })).not.toBe(
      gatekeeperRequestDigest(REQUEST),
    );
  });
});

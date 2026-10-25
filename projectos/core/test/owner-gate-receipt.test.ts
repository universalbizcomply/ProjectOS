/**
 * The owner answering a gate — and every way something that is not the owner cannot.
 *
 * The ruling being tested: a delegated gatekeeper decision may carry the gatekeeper's name, but an
 * owner gate has no delegated form, and a model may transport what the owner says without ever being
 * recorded as having said it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkOwnerGateReceipt,
  ownerGateState,
  unsatisfiedOwnerGates,
  gateInstanceId,
  OWNER_GATE_RECEIPT_SCHEMA_VERSION,
  OWNER_GATE_SCOPE,
  OWNER_GATE_CHOICES,
  type OwnerGateReceipt,
  type OwnerGateExpectations,
} from '../src/ownerGateReceipt.js';
import { PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT } from '../src/gatekeeperBridge.js';

const HEAD = '0965059aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_HEAD = 'b'.repeat(40);
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const GATES = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

function expectations(over: Partial<OwnerGateExpectations> = {}): OwnerGateExpectations {
  return {
    projectId: 'projectos',
    phaseId: PHASE,
    requiredOwnerGates: GATES,
    evidenceSubjectHead: HEAD,
    planOwner: 'Murad',
    readFromCommittedTree: true,
    alreadyConsumedDecisionIds: [],
    ...over,
  };
}

function receipt(over: Partial<OwnerGateReceipt> = {}): OwnerGateReceipt {
  return {
    schemaVersion: OWNER_GATE_RECEIPT_SCHEMA_VERSION,
    decisionId: 'PROJECTOS-GATEKEEPER-LOOP1A-COMMIT-RECEIPT1A',
    projectId: 'projectos',
    phaseId: PHASE,
    gateName: 'commit',
    gateInstanceId: gateInstanceId(PHASE, 'commit', HEAD),
    evidenceSubjectHead: HEAD,
    ownerChoice: 'APPROVE',
    decidedBy: 'Murad',
    decidedAt: '2026-08-17T21:00:00+01:00',
    scope: OWNER_GATE_SCOPE,
    note: 'Owner approved the commit gate.',
    ...over,
  };
}

describe('a valid owner receipt', () => {
  it('answers the gate it names', () => {
    expect(checkOwnerGateReceipt(receipt(), expectations())).toEqual([]);
    expect(ownerGateState(receipt(), expectations()).state).toBe('APPROVED');
  });

  it('records a refusal as a refusal, not as an absence', () => {
    const state = ownerGateState(receipt({ ownerChoice: 'REFUSE' }), expectations());
    expect(state.state).toBe('REFUSED');
    expect(state.problems).toEqual([]);
  });
});

describe('the committed-tree requirement', () => {
  // THE WHOLE SEPARATION. Without this, a receipt is just a file, and a file is writable by exactly
  // the things this contract exists to hold at arm's length.
  it('refuses a receipt that was not read from the committed tree', () => {
    const errors = checkOwnerGateReceipt(receipt(), expectations({ readFromCommittedTree: false }));
    expect(errors.some((e) => e.includes('the commit is the owner action a model cannot perform'))).toBe(true);
  });

  it('refuses an absent receipt without treating silence as assent', () => {
    const errors = checkOwnerGateReceipt(null, expectations());
    expect(errors[0]).toContain('not answered by the absence of an objection');
  });
});

describe('owner provenance', () => {
  it('refuses a receipt from anyone but the plan\'s owner', () => {
    const errors = checkOwnerGateReceipt(receipt({ decidedBy: 'ChatGPT' }), expectations());
    expect(errors.some((e) => e.includes('an owner gate has no delegated form'))).toBe(true);
  });

  it.each(['ChatGPT', 'OpenAI Gatekeeper', 'GPT-5.6 Terra', 'Codex'])(
    'refuses %s even if the plan somehow named it as owner',
    (name) => {
      const errors = checkOwnerGateReceipt(receipt({ decidedBy: name }), expectations({ planOwner: name }));
      expect(errors.some((e) => e.includes('may never be recorded as having said it'))).toBe(true);
    },
  );

  it('refuses the implementer even if the plan somehow named it as owner', () => {
    const errors = checkOwnerGateReceipt(receipt({ decidedBy: 'Claude' }), expectations({ planOwner: 'Claude' }));
    expect(errors.some((e) => e.includes('can never hold owner authority'))).toBe(true);
  });

  it('refuses a receipt with no decidedBy', () => {
    expect(checkOwnerGateReceipt(receipt({ decidedBy: undefined }), expectations())).toContain(
      'receipt records no decidedBy',
    );
  });

  // THE FIELD NAME IS LOAD-BEARING: it is already refused by the bridge, so a bridge request carrying
  // an owner's answer is rejected by machinery that exists rather than by machinery to be written.
  it('uses a choice field the bridge already refuses to assert', () => {
    expect(PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT).toContain('ownerChoice');
    expect(PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT).toContain('decidedBy');
  });
});

describe('what the receipt is bound to', () => {
  it('refuses another project', () => {
    expect(
      checkOwnerGateReceipt(receipt({ projectId: 'polygo' }), expectations()).some((e) => e.includes('is for project')),
    ).toBe(true);
  });

  it('refuses another phase', () => {
    expect(
      checkOwnerGateReceipt(receipt({ phaseId: 'ELSEWHERE1A' }), expectations()).some((e) => e.includes('is for phase')),
    ).toBe(true);
  });

  it('refuses a gate the approved plan does not require', () => {
    const errors = checkOwnerGateReceipt(receipt({ gateName: 'deploy-to-production' }), expectations());
    expect(errors.some((e) => e.includes('the approved plan does not require'))).toBe(true);
  });

  it('refuses approval given against other evidence', () => {
    const errors = checkOwnerGateReceipt(
      receipt({ evidenceSubjectHead: OTHER_HEAD, gateInstanceId: gateInstanceId(PHASE, 'commit', OTHER_HEAD) }),
      expectations(),
    );
    expect(errors.some((e) => e.includes('approval of other evidence is not approval of this'))).toBe(true);
  });

  it('refuses a subject that is not a commit', () => {
    expect(checkOwnerGateReceipt(receipt({ evidenceSubjectHead: 'HEAD' }), expectations())).toContain(
      'receipt names no valid evidence subject commit',
    );
  });

  // RECOMPUTED, NOT TRUSTED. A receipt can claim any instance id it likes; only the derived one counts.
  it('refuses a gate instance id that does not match the gate it would answer', () => {
    const errors = checkOwnerGateReceipt(receipt({ gateInstanceId: 'anything-i-like' }), expectations());
    expect(errors.some((e) => e.includes('does not match the gate it would answer'))).toBe(true);
  });

  it('derives a different id at a different commit, so yesterday\'s approval is not today\'s', () => {
    expect(gateInstanceId(PHASE, 'commit', HEAD)).not.toBe(gateInstanceId(PHASE, 'commit', OTHER_HEAD));
    expect(gateInstanceId(PHASE, 'commit', HEAD)).not.toBe(gateInstanceId(PHASE, 'push', HEAD));
  });
});

describe('the closed answer set', () => {
  it.each(OWNER_GATE_CHOICES)('accepts %s', (choice) => {
    expect(checkOwnerGateReceipt(receipt({ ownerChoice: choice }), expectations())).toEqual([]);
  });

  it.each(['approve', 'YES', 'OK', 'Approved', '', undefined])('refuses %s', (choice) => {
    const errors = checkOwnerGateReceipt(receipt({ ownerChoice: choice }), expectations());
    expect(errors.some((e) => e.includes('a gate is answered with one of'))).toBe(true);
  });

  it('offers exactly approve and refuse', () => {
    expect(OWNER_GATE_CHOICES).toEqual(['APPROVE', 'REFUSE']);
  });
});

describe('replay', () => {
  it('refuses a receipt already marked consumed', () => {
    const errors = checkOwnerGateReceipt(receipt({ consumedAt: '2026-08-17T22:00:00Z' }), expectations());
    expect(errors.some((e) => e.includes('cannot be replayed'))).toBe(true);
  });

  it('refuses a receipt id already acted on', () => {
    const errors = checkOwnerGateReceipt(
      receipt(),
      expectations({ alreadyConsumedDecisionIds: ['PROJECTOS-GATEKEEPER-LOOP1A-COMMIT-RECEIPT1A'] }),
    );
    expect(errors.some((e) => e.includes('cannot answer a second gate'))).toBe(true);
  });

  it('refuses a wrong schema version or scope', () => {
    expect(checkOwnerGateReceipt(receipt({ schemaVersion: '0.1.0' }), expectations()).length).toBeGreaterThan(0);
    expect(checkOwnerGateReceipt(receipt({ scope: 'everything' }), expectations()).length).toBeGreaterThan(0);
  });

  it('refuses an unusable decisionId', () => {
    for (const id of [undefined, '', 'x', 'has spaces']) {
      expect(checkOwnerGateReceipt(receipt({ decisionId: id }), expectations())).toContain(
        'receipt has no usable decisionId',
      );
    }
  });
});

describe('a malformed approval is not a refusal', () => {
  // Different facts. Reporting an unreadable approval as a refusal would tell the owner they said no
  // when they said something the runtime could not read.
  it('leaves the gate unanswered rather than refused', () => {
    const state = ownerGateState(receipt({ decidedBy: 'ChatGPT' }), expectations());
    expect(state.state).toBe('UNANSWERED');
    expect(state.problems.length).toBeGreaterThan(0);
  });
});

describe('which gates are outstanding', () => {
  const valid = (gate: string): OwnerGateReceipt =>
    receipt({ gateName: gate, gateInstanceId: gateInstanceId(PHASE, gate, HEAD), decisionId: `RECEIPT-${gate}` });

  it('reports every gate outstanding when nothing has been answered', () => {
    expect(unsatisfiedOwnerGates(new Map(), expectations())).toEqual(GATES);
  });

  it('clears only the gates that are genuinely answered', () => {
    const receipts = new Map<string, OwnerGateReceipt | null>([
      ['commit', valid('commit')],
      ['push', valid('push')],
    ]);
    expect(unsatisfiedOwnerGates(receipts, expectations())).toEqual([
      'phase-closure',
      'secrets-handling',
      'payment-or-live-charge',
    ]);
  });

  it('does not let a receipt for one gate answer another', () => {
    const receipts = new Map<string, OwnerGateReceipt | null>([['push', valid('commit')]]);
    expect(unsatisfiedOwnerGates(receipts, expectations())).toContain('push');
  });

  it('treats a refusal as not satisfying the gate', () => {
    const receipts = new Map<string, OwnerGateReceipt | null>([
      ['commit', { ...valid('commit'), ownerChoice: 'REFUSE' }],
    ]);
    expect(unsatisfiedOwnerGates(receipts, expectations())).toContain('commit');
  });

  it('clears everything only when every gate is approved', () => {
    const receipts = new Map<string, OwnerGateReceipt | null>(GATES.map((g) => [g, valid(g)]));
    expect(unsatisfiedOwnerGates(receipts, expectations())).toEqual([]);
  });
});

/**
 * Hybrid gatekeeper routing — the mode vocabulary, the provenance each mode produces, and what a Host
 * attestation must agree with before it vouches for a decision.
 *
 * Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GATEKEEPER_MODE,
  GATEKEEPER_MODES,
  GATEKEEPER_PROVENANCES,
  HOST_VERDICT_FOR,
  checkHostAttestation,
  hostCorrelationFor,
  isGatekeeperMode,
  provenanceClaimsIn,
  provenanceOfMode,
  type HostAttestationSummary,
} from '../src/gatekeeperMode.js';
import { GATEKEEPER_VERDICTS, verdictRequiresOwner, type GatekeeperDecisionRecord } from '../src/gatekeeperDecision.js';
import { CLOSURE_RESPONSE_DECISIONS, HOST_VERDICT_FOR_CLOSURE, checkHostClosureAttestation } from '../src/closureTransport.js';

const REQUEST_ID = 'GKREQ-0123456789abcdef01234567';

const RECORD: GatekeeperDecisionRecord = {
  decision: 'APPROVED_TO_PROCEED',
  allowedActions: ['commit', 'push'],
  ownerApprovalRequired: false,
};

function attestation(over: Partial<Record<keyof HostAttestationSummary, unknown>> = {}): HostAttestationSummary {
  return {
    schemaVersion: 1,
    attestationId: 'a'.repeat(64),
    requestCorrelation: hostCorrelationFor(REQUEST_ID),
    providerResponseId: 'resp_1',
    provider: 'fake-provider',
    model: 'fake-model',
    verdict: 'ApprovedToProceed',
    allowedActions: ['push', 'commit'],
    ownerApprovalRequired: false,
    costMicroUsd: 1234,
    attestedAtEpochS: 1_788_000_000,
    ...over,
  };
}

describe('the two gatekeeper modes', () => {
  it('are exactly interactive and unattended, and a project with no configuration is interactive', () => {
    expect([...GATEKEEPER_MODES]).toEqual(['interactive', 'unattended']);
    expect(DEFAULT_GATEKEEPER_MODE).toBe('interactive');
  });

  it.each(['Interactive', 'UNATTENDED', 'auto', 'hybrid', '', null, undefined, 1])('refuses %j as a mode', (value) => {
    expect(isGatekeeperMode(value)).toBe(false);
  });

  it('gives each mode its own provenance, and never the same one', () => {
    expect(provenanceOfMode('interactive')).toBe('InteractiveGatekeeperDecision');
    expect(provenanceOfMode('unattended')).toBe('HostIndependentProviderAttestation');
  });

  // PROJECTOS-KERNEL-FOLLOWUP1A (D9): the broker is a route's class, never a mode's.
  it('names the installation broker as an evidence class of its own, which no mode produces', () => {
    expect([...GATEKEEPER_PROVENANCES]).toEqual([
      'InteractiveGatekeeperDecision',
      'HostIndependentProviderAttestation',
      'InstallationBrokerProviderAnswer',
    ]);
    expect(GATEKEEPER_MODES.map(provenanceOfMode)).not.toContain('InstallationBrokerProviderAnswer');
  });
});

describe('the Host verdict each gatekeeper verdict must travel with', () => {
  it('covers every verdict, and maps every owner-gated verdict to OwnerApprovalRequired', () => {
    for (const verdict of GATEKEEPER_VERDICTS) {
      expect(HOST_VERDICT_FOR[verdict]).toBeDefined();
      if (verdictRequiresOwner(verdict)) expect(HOST_VERDICT_FOR[verdict]).toBe('OwnerApprovalRequired');
    }
    const approving = GATEKEEPER_VERDICTS.filter((v) => HOST_VERDICT_FOR[v] === 'ApprovedToProceed');
    expect(approving).toEqual(['APPROVED_TO_PROCEED']);
  });
});

describe('the Host correlation', () => {
  it('is derived, deterministic, 16 bytes of hex, and distinct per request', () => {
    expect(hostCorrelationFor(REQUEST_ID)).toMatch(/^[0-9a-f]{32}$/);
    expect(hostCorrelationFor(REQUEST_ID)).toBe(hostCorrelationFor(REQUEST_ID));
    expect(hostCorrelationFor(REQUEST_ID)).not.toBe(hostCorrelationFor('GKREQ-0123456789abcdef01234568'));
  });
});

describe('checkHostAttestation', () => {
  const check = (a: HostAttestationSummary | null, record: GatekeeperDecisionRecord = RECORD) =>
    checkHostAttestation(a, { requestId: REQUEST_ID, record });

  it('accepts an attestation that answers this request and agrees with the decision', () => {
    expect(check(attestation())).toEqual([]);
  });

  it('refuses a decision with no attestation at all', () => {
    expect(check(null).join('\n')).toContain('no Host attestation accompanied this decision');
  });

  it('refuses an attestation for a different request', () => {
    expect(check(attestation({ requestCorrelation: hostCorrelationFor('GKREQ-ffffffffffffffffffffffff') })).join('\n'))
      .toContain('answers a different request');
  });

  it('refuses an attestation whose verdict disagrees with the decision', () => {
    expect(check(attestation({ verdict: 'ChangesRequired' })).join('\n')).toContain('does not match the decision');
    expect(check(attestation({ verdict: 'Approve' })).join('\n')).toContain('no recognised verdict');
  });

  it('refuses an attestation permitting different actions, and ignores order', () => {
    expect(check(attestation({ allowedActions: ['commit'] })).join('\n')).toContain('permits different actions');
    expect(check(attestation({ allowedActions: ['commit', 'push'] }))).toEqual([]);
  });

  it('refuses disagreement about owner approval', () => {
    expect(check(attestation({ ownerApprovalRequired: true })).join('\n')).toContain('whether the owner must still approve');
  });

  it.each([undefined, null, -1, 1.5, '1234'])('refuses an unknown cost (%j), never reading it as free', (cost) => {
    expect(check(attestation({ costMicroUsd: cost })).join('\n')).toContain('states no known cost');
  });

  // PROJECTOS-HOST-REVIEW-PATH1B. AN ADMITTED AMOUNT IS NOT A PROVIDER COST. Revision 2 states what the
  // Host admitted against the budget, under its own name, and nothing about what a provider billed.
  const revision2 = (over: Partial<Record<keyof HostAttestationSummary, unknown>> = {}): HostAttestationSummary =>
    attestation({ schemaVersion: 2, costMicroUsd: undefined, admittedCostMicroUsd: 1234, ...over });

  it('accepts a revision 2 attestation that states the admitted amount and no cost', () => {
    expect(check(revision2())).toEqual([]);
  });

  it.each([undefined, null, -1, 1.5, '1234'])('refuses a revision 2 attestation with no usable admitted amount (%j)', (amount) => {
    expect(check(revision2({ admittedCostMicroUsd: amount })).join('\n')).toContain('states no admitted amount');
  });

  it.each([0, 1234, null, '1234'])('refuses a revision 2 attestation that claims a provider cost (%j)', (cost) => {
    expect(check(revision2({ costMicroUsd: cost })).join('\n')).toContain('revision 2 claims a provider cost');
  });

  it('does not let the admitted amount stand in for a revision 1 cost, or the reverse', () => {
    // Revision 1 keeps its schema: a known cost, and no revision 2 field.
    expect(check(attestation({ costMicroUsd: undefined, admittedCostMicroUsd: 1234 })).join('\n')).toContain('states no known cost');
    expect(check(attestation({ admittedCostMicroUsd: 1234 })).join('\n')).toContain('that field belongs to revision 2');
    // Revision 2 with only the revision 1 field states no admitted amount AND claims a cost.
    const swapped = check(attestation({ schemaVersion: 2 })).join('\n');
    expect(swapped).toContain('states no admitted amount');
    expect(swapped).toContain('revision 2 claims a provider cost');
  });

  it('refuses a malformed attestation identity, schema, provider or time', () => {
    expect(check(attestation({ attestationId: 'xyz' })).join('\n')).toContain('no usable attestationId');
    // Revisions 1 and 2 share the summary shape this check reads (2 adds the evidence binding, enforced
    // by the Host record reader). Anything else - a future revision, a string, nothing - is refused.
    for (const unknown of [0, 3, '1', '2', null, undefined]) {
      expect(check(attestation({ schemaVersion: unknown })).join('\n')).toContain('not a revision this agent knows');
    }
    expect(check(attestation({ schemaVersion: 2 })).join('\n')).not.toContain('schemaVersion');
    expect(check(attestation({ provider: '' })).join('\n')).toContain('does not name the provider');
    expect(check(attestation({ providerResponseId: '' })).join('\n')).toContain('names no provider response');
    expect(check(attestation({ attestedAtEpochS: 0 })).join('\n')).toContain('no attestation time');
  });
});

describe('provenanceClaimsIn', () => {
  it('finds every provenance-claiming field, whatever its case', () => {
    expect(provenanceClaimsIn({ decision: 'X', provenance: 'HostIndependentProviderAttestation' })).toEqual(['provenance']);
    expect(provenanceClaimsIn({ HostAttestation: {}, ATTESTATIONID: 'a' })).toEqual(['HostAttestation', 'ATTESTATIONID']);
  });

  it('finds nothing in an ordinary decision', () => {
    expect(provenanceClaimsIn({ decision: 'APPROVED_TO_PROCEED', decidedBy: 'ChatGPT' })).toEqual([]);
    expect(provenanceClaimsIn(null)).toEqual([]);
  });
});

describe('checkHostClosureAttestation (created in PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A)', () => {
  const closing = { decision: 'close' };
  const closeAttestation = (over: Partial<Record<keyof HostAttestationSummary, unknown>> = {}) =>
    attestation({ verdict: 'OwnerApprovalRequired', allowedActions: [], ownerApprovalRequired: true, ...over });

  it('maps every closure answer to a Host verdict, and "close" never to an approval to proceed', () => {
    for (const d of CLOSURE_RESPONSE_DECISIONS) expect(HOST_VERDICT_FOR_CLOSURE[d]).toBeDefined();
    expect(HOST_VERDICT_FOR_CLOSURE.close).toBe('OwnerApprovalRequired');
    expect(HOST_VERDICT_FOR_CLOSURE['do-not-close']).toBe('ChangesRequired');
  });

  it('accepts an attestation bound to this request that agrees with the closure answer', () => {
    expect(checkHostClosureAttestation(closeAttestation(), { requestId: REQUEST_ID, record: closing })).toEqual([]);
  });

  it.each([
    ['no attestation at all', null, 'no Host attestation'],
    ['another request', closeAttestation({ requestCorrelation: hostCorrelationFor('CLREQ-000000000000000000000000') }), 'different request'],
    ['a different verdict', closeAttestation({ verdict: 'ChangesRequired' }), 'does not match the decision'],
    ['permitted actions', closeAttestation({ allowedActions: ['push'] }), 'permits different actions'],
    ['no owner approval still to come', closeAttestation({ ownerApprovalRequired: false }), 'whether the owner must still approve'],
    ['an unknown cost', closeAttestation({ costMicroUsd: undefined }), 'no known cost'],
  ])('refuses %s', (_label, a, expected) => {
    const problems = checkHostClosureAttestation(a as HostAttestationSummary | null, { requestId: REQUEST_ID, record: closing });
    expect(problems.join(' ')).toContain(expected);
  });

  it('refuses a technical verdict wearing a closure answer', () => {
    const problems = checkHostClosureAttestation(closeAttestation(), { requestId: REQUEST_ID, record: { decision: 'APPROVED_FOR_CLOSURE' } });
    expect(problems.join(' ')).toContain('does not match the decision');
  });
});

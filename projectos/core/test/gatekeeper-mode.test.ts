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
  HOST_VERDICT_FOR,
  checkHostAttestation,
  hostCorrelationFor,
  isGatekeeperMode,
  provenanceClaimsIn,
  provenanceOfMode,
  type HostAttestationSummary,
} from '../src/gatekeeperMode.js';
import { GATEKEEPER_VERDICTS, verdictRequiresOwner, type GatekeeperDecisionRecord } from '../src/gatekeeperDecision.js';

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

  it('refuses a malformed attestation identity, schema, provider or time', () => {
    expect(check(attestation({ attestationId: 'xyz' })).join('\n')).toContain('no usable attestationId');
    expect(check(attestation({ schemaVersion: 2 })).join('\n')).toContain('schemaVersion is not 1');
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

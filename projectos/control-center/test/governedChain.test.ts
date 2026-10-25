import { describe, it, expect } from 'vitest';
import { chainFor, decisionTone, statusTone, GOVERNED_CHAINS } from '../src/owner/governedChain';

describe('governedChain', () => {
  it('maps guard decisions to tones', () => {
    expect(decisionTone('ALLOW')).toBe('ok');
    expect(decisionTone('OWNER_GATED')).toBe('warn');
    expect(decisionTone('REFUSED')).toBe('crit');
  });

  it('maps approval statuses to tones', () => {
    expect(statusTone('approved')).toBe('ok');
    expect(statusTone('rejected')).toBe('crit');
    expect(statusTone('returned')).toBe('warn');
    expect(statusTone('pending')).toBe('mut');
  });

  it('returns the ProjectOS chain by default for an unknown project', () => {
    expect(chainFor('does-not-exist').projectId).toBe('projectos');
  });

  it('exposes a chain per snapshot project with well-formed shapes', () => {
    for (const c of GOVERNED_CHAINS) {
      expect(typeof c.projectId).toBe('string');
      for (const d of c.providerDecisions) {
        expect(['ALLOW', 'OWNER_GATED', 'REFUSED']).toContain(d.decision);
      }
      for (const a of c.approvalItems) {
        expect(['pending', 'approved', 'returned', 'rejected']).toContain(a.status);
      }
    }
  });

  it('never marks a prohibited provider action as ALLOW', () => {
    for (const c of GOVERNED_CHAINS) {
      for (const d of c.providerDecisions) {
        if (d.reason === 'prohibited-action') expect(d.decision).toBe('REFUSED');
      }
    }
  });

  it('the synthetic Acme chain has pending approval items', () => {
    const acme = chainFor('acme-app');
    expect(acme.approvalItems.some((i) => i.status === 'pending')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { FORGE_RUNS, forgeRunForCommand, budgetPercent, verifyTone, isVerified } from '../src/forge/forgeModel';

describe('forgeModel', () => {
  it('routes a shop command to the shop run and a booking command to booking', () => {
    expect(forgeRunForCommand('an online store with a cart and orders').commandId).toBe('shop');
    expect(forgeRunForCommand('a booking app for a salon').commandId).toBe('booking');
    expect(forgeRunForCommand('').commandId).toBe('booking'); // default
  });

  it('computes budget percent bounded to 100', () => {
    expect(budgetPercent(42000, 100000)).toBe(42);
    expect(budgetPercent(200000, 100000)).toBe(100);
    expect(budgetPercent(1, 0)).toBe(0);
  });

  it('maps verify pass/fail to a tone', () => {
    expect(verifyTone(true)).toBe('ok');
    expect(verifyTone(false)).toBe('crit');
  });

  it('isVerified requires build+unit+wired all passing (anti-Potemkin)', () => {
    const booking = FORGE_RUNS.find((r) => r.commandId === 'booking')!;
    const shop = FORGE_RUNS.find((r) => r.commandId === 'shop')!;
    expect(isVerified(booking)).toBe(true);            // all pass
    expect(isVerified(shop)).toBe(false);              // wired fails → not verified even though it builds/renders
  });

  it('the shop run refuses a metered AI API and never wires it', () => {
    const shop = FORGE_RUNS.find((r) => r.commandId === 'shop')!;
    expect(shop.refused).toContain('ai-api');
    expect(shop.integrations.some((i) => i.id === 'ai-api')).toBe(false);
  });

  it('every run flags owner-gated integrations and seeds owner-only actions', () => {
    for (const r of FORGE_RUNS) {
      expect(r.ownerActions.length).toBeGreaterThan(0);
      expect(r.scaffoldFiles).toContain('.projectops/config.json');
      expect(r.safety.productionFrozen).toBe(true);
      expect(r.safety.apiUsed).toBe(false);
    }
  });
});

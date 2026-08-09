import { describe, it, expect } from 'vitest';
import {
  buildOwnerControlView,
  completionPercent,
  whereYouAre,
  type OwnerControlModel,
} from '../src/owner/ownerModel';
import { PROJECTOS_V3, DEMO_ACME, OWNER_MODELS } from '../src/owner/ownerSnapshot';

describe('completionPercent', () => {
  it('rounds accepted/total to 1 dp (matches the ProjectOS method)', () => {
    expect(completionPercent(3, 19)).toBe(15.8);
    expect(completionPercent(2, 19)).toBe(10.5);
    expect(completionPercent(0, 4)).toBe(0);
    expect(completionPercent(1, 2)).toBe(50);
  });
  it('is 0 when total is non-positive (never divides by zero)', () => {
    expect(completionPercent(1, 0)).toBe(0);
  });
});

describe('whereYouAre', () => {
  it('names the active phase when one is active', () => {
    expect(whereYouAre(DEMO_ACME)).toContain('working phase ACME-P1A');
  });
  it('points to the next phase when between phases', () => {
    // Derived from the model, not restated: the recorded snapshot's next phase is pinned to the
    // canonical record by ownerSnapshot.test, so repeating the literal here would only duplicate it.
    expect(whereYouAre(PROJECTOS_V3)).toContain(`next is ${PROJECTOS_V3.nextRecommendedPhase}`);
  });
});

describe('buildOwnerControlView', () => {
  it('derives an IN EXECUTION view with green status and no decisions', () => {
    const v = buildOwnerControlView(PROJECTOS_V3);
    expect(v.planStatus).toBe('IN EXECUTION');
    expect(v.statusTone).toBe('ok');
    const pct = completionPercent(PROJECTOS_V3.acceptedPhaseCount, PROJECTOS_V3.totalPhaseCount);
    expect(v.completionPercent).toBe(pct);
    expect(v.completionLabel).toBe(
      `${PROJECTOS_V3.acceptedPhaseCount} of ${PROJECTOS_V3.totalPhaseCount} phases accepted · ${pct}%`,
    );
    expect(v.hasDecisions).toBe(false);
    expect(v.decisionsRequired).toHaveLength(0);
    // The recorded snapshot surfaces the real canonical blockers. Derived from the model rather
    // than pinned to a count, so recording a further real blocker is not a test failure.
    expect(v.blockers).toEqual(PROJECTOS_V3.blockers);
    expect(v.blockers.length).toBeGreaterThan(0);
    expect(v.restrictedActions).toContain('Approve plan');
  });

  it('derives an AWAITING OWNER APPROVAL view with decisions and a blocker', () => {
    const v = buildOwnerControlView(DEMO_ACME);
    expect(v.statusTone).toBe('warn');
    expect(v.hasDecisions).toBe(true);
    expect(v.decisionsRequired.length).toBeGreaterThanOrEqual(2);
    expect(v.blockers.length).toBeGreaterThanOrEqual(1);
  });

  it('flags blocked statuses as critical', () => {
    const blocked: OwnerControlModel = { ...DEMO_ACME, planStatus: 'PLAN CONFLICT' };
    expect(buildOwnerControlView(blocked).statusTone).toBe('crit');
  });

  it('renders safety badges: production frozen + no provider/secret/API is all-clear', () => {
    const v = buildOwnerControlView(PROJECTOS_V3);
    const labels = v.safetyBadges.map((b) => b.label);
    expect(labels).toContain('Production frozen');
    expect(labels).toContain('No provider contacted');
    expect(labels).toContain('No AI API used');
    expect(v.safetyBadges.every((b) => b.tone === 'ok')).toBe(true);
  });

  it('marks production LIVE and AI API used as critical safety badges', () => {
    const unsafe: OwnerControlModel = {
      ...PROJECTOS_V3,
      safety: { productionFrozen: false, providerContacted: true, secretCapabilityUsed: true, apiUsed: true },
    };
    const badges = buildOwnerControlView(unsafe).safetyBadges;
    expect(badges.find((b) => b.label === 'Production LIVE')?.tone).toBe('crit');
    expect(badges.find((b) => b.label === 'AI API used')?.tone).toBe('crit');
  });

  it('is deterministic — identical model yields identical view', () => {
    expect(JSON.stringify(buildOwnerControlView(PROJECTOS_V3))).toBe(
      JSON.stringify(buildOwnerControlView(PROJECTOS_V3)),
    );
  });

  it('every snapshot model builds a view whose completion never exceeds 100', () => {
    for (const m of OWNER_MODELS) {
      const v = buildOwnerControlView(m);
      expect(v.completionPercent).toBeGreaterThanOrEqual(0);
      expect(v.completionPercent).toBeLessThanOrEqual(100);
    }
  });
});

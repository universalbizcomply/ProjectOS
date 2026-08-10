import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROJECTOS_V3 } from '../src/owner/ownerSnapshot.js';

/**
 * Regression guard for the whole-system UX audit (defect §3): the ProjectOS owner-control seed
 * used by the browser preview MUST stay aligned to the canonical current-state file, so the owner
 * surface never shows a stale plan status, a stale "next" phase, or hides real blockers.
 * The Tauri desktop build reads live state; this pins the offline seed to the same source of truth.
 */
const canonical = JSON.parse(
  readFileSync(new URL('../../state/projectos-v3.current-state.json', import.meta.url), 'utf8'),
) as {
  currentStatus: string;
  acceptedPhaseCount: number;
  totalPhaseCount: number;
  completedPhases: readonly string[];
  currentBlockers: readonly string[];
};

const CURRENT_STATUS_ENUM = JSON.parse(
  readFileSync(new URL('../../schemas/current-project-state.schema.json', import.meta.url), 'utf8'),
).properties.currentStatus.enum as readonly string[];

describe('ProjectOS owner-control seed is aligned to canonical current-state', () => {
  test('phase counts match the canonical state file exactly', () => {
    expect(PROJECTOS_V3.acceptedPhaseCount).toBe(canonical.acceptedPhaseCount);
    expect(PROJECTOS_V3.totalPhaseCount).toBe(canonical.totalPhaseCount);
  });

  test('plan status equals the canonical current status', () => {
    expect(PROJECTOS_V3.planStatus).toBe(canonical.currentStatus);
  });

  test('plan status is a value the canonical schema enum permits', () => {
    expect(CURRENT_STATUS_ENUM).toContain(PROJECTOS_V3.planStatus);
  });

  test('the "next" phase does not point at an already-completed phase', () => {
    if (PROJECTOS_V3.nextRecommendedPhase !== null) {
      expect(canonical.completedPhases).not.toContain(PROJECTOS_V3.nextRecommendedPhase);
    }
  });

  test('real canonical blockers are surfaced to the owner', () => {
    if (canonical.currentBlockers.length > 0) {
      expect(PROJECTOS_V3.blockers.length).toBeGreaterThan(0);
    }
  });

  test('next safe action does not carry the stale "Continue Phase 3" instruction', () => {
    expect(PROJECTOS_V3.nextSafeAction).not.toMatch(/continue phase 3/i);
  });

  test('the seed may claim ProjectOS V3 is complete ONLY because the canonical record says so', () => {
    // This guard used to assert the seed must NOT read COMPLETE, because the programme was open and
    // a premature completion claim was the risk. ProjectOS V3 is now genuinely CLOSED by the owner's
    // approval and the gatekeeper's decision, so the guard is INVERTED rather than deleted: the seed
    // is permitted to say COMPLETE, and only while the canonical record independently says the same
    // and every numbered phase is accepted. Flip the seed alone and this still fails.
    expect(canonical.currentStatus).toBe('COMPLETE');
    expect(canonical.acceptedPhaseCount).toBe(canonical.totalPhaseCount);
    expect(PROJECTOS_V3.planStatus).toBe(canonical.currentStatus);
    expect(PROJECTOS_V3.acceptedPhaseCount).toBe(canonical.acceptedPhaseCount);
  });
});

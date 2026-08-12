/**
 * THE GOVERNANCE ENGINES ARE COMPOSED ONCE, BY THE ENTRYPOINT.
 *
 * The previous increment moved engine resolution out of each consumer and into a process-global
 * registry that an entrypoint fills. That is a smaller attack surface than four independent
 * filesystem lookups, but it is only smaller if the registry cannot be re-filled: a governed project
 * that could call `setGovernanceEngines` with substitutes would be choosing the code that governs
 * it, which is precisely what resolving-from-own-location existed to prevent.
 *
 * These prove the composition holds. The packaged daemon composes at module initialisation, before
 * any governed project input can reach it, and a later call with a different unit is REFUSED rather
 * than accepted last-writer-wins.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged root + installation identity).
 */
import { describe, expect, it } from 'vitest';

import {
  governanceEngines,
  governanceEnginesInstalled,
  setGovernanceEngines,
  type GovernanceEngines,
} from '../src/governanceEngines.js';

describe('governance engine composition', () => {
  it('is already composed by the entrypoint before any test body runs', () => {
    // `test/setup.ts` is the test composition root, exactly as `bin/projectos.js` is the CLI's and
    // `sidecar/host.mjs` is the daemon's. Nothing in a test had to ask for it.
    expect(governanceEnginesInstalled()).toBe(true);
    expect(typeof governanceEngines().governance.evaluatePlanReady).toBe('function');
  });

  it('REFUSES a substitute set once composed', () => {
    const substitute = {
      governance: {
        validateAgainstSchema: () => [],
        // A substitute that declares every plan ready — the shape of an actual attack, not a typo.
        evaluatePlanReady: () => ({ ready: true, reasons: [] }),
        isSafeRepoRelativePath: () => true,
        isImplementerIdentity: () => false,
      },
      discovery: {},
      planSchema: {},
      currentStateSchema: {},
    } as unknown as GovernanceEngines;

    expect(() => setGovernanceEngines(substitute)).toThrow(/GOVERNANCE_ENGINES_ALREADY_SET/);
  });

  it('still returns the canonical engines after the refused substitution', () => {
    // The refusal must leave the registry untouched. A guard that throws AFTER assigning would be
    // worse than no guard: it would look safe and behave as last-writer-wins.
    const engines = governanceEngines();
    expect(engines.governance.evaluatePlanReady({})).toHaveProperty('ready', false);
  });

  it('accepts the identical unit again, so a re-imported entrypoint is harmless', () => {
    const current = governanceEngines();
    expect(() => setGovernanceEngines(current)).not.toThrow();
    expect(governanceEngines()).toBe(current);
  });
});

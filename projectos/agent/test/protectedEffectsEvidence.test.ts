/**
 * THE PROTECTED-EFFECTS CLOSURE PREDICATE FAILS CLOSED, ON THE PHASE'S OWN RUNS — PROJECTOS-BOOT-CONTINUE1A.
 *
 * G4-11 used to read a fixed V3 session file and answered "no effect" when it was absent. It now reads
 * every RUNNER-written run of the phase — bound to the runner's session record — each of which records
 * the sha256 of the worker's effects attestation as collected, and believes an attestation only while
 * it still hashes to that value. Every case that cannot be established answers "occurred".
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { latestRunEvidence, protectedEffectOccurred } from '../src/closureGate.js';
import type { System } from '../src/system.js';

const ROOT = '/proj';
const PHASE = 'PROJECTOS-DEMO1A';
const EXEC = `${ROOT}/.projectops/execution`;
const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const CLEAN = JSON.stringify({
  productionTouched: false,
  deploymentOccurred: false,
  databaseMutationOccurred: false,
  externalSendOccurred: false,
  paymentOccurred: false,
  rawSecretStored: false,
});

function sys(files: Record<string, string>): System {
  return {
    readText: (p: string) => files[p] ?? null,
    exists: (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(p + '/')),
    listDir: (p: string) =>
      Object.keys(files)
        .filter((f) => f.startsWith(p + '/'))
        .map((f) => f.slice(p.length + 1))
        .filter((f) => !f.includes('/')),
  } as unknown as System;
}

/** A complete run as the runner leaves it: session record, evidence, and the worker's attestation. */
function run(
  session: string,
  effectsBody: string | null,
  effectsSha256: string | null | undefined,
  collectedAt = '2026-10-19T10:00:00Z',
): Record<string, string> {
  return {
    [`${EXEC}/${session}.session.json`]: JSON.stringify({ sessionId: session, phaseId: PHASE }),
    [`${EXEC}/${session}.evidence.json`]: JSON.stringify({
      phaseId: PHASE,
      sessionId: session,
      collectedAt,
      ...(effectsSha256 === undefined ? {} : { effectsSha256 }),
    }),
    ...(effectsBody === null ? {} : { [`${EXEC}/${session}.effects.json`]: effectsBody }),
  };
}

describe('protectedEffectOccurred (G4-11)', () => {
  it('PASS only when the runner-recorded digest matches a clean attestation', () => {
    expect(protectedEffectOccurred(sys(run('s1', CLEAN, sha(CLEAN))), ROOT, PHASE)).toBe(false);
  });

  it('FAIL CLOSED: no runner evidence for the phase', () => {
    expect(protectedEffectOccurred(sys({ [`${EXEC}/s1.effects.json`]: CLEAN }), ROOT, PHASE)).toBe(true);
    expect(protectedEffectOccurred(sys({}), ROOT, PHASE)).toBe(true);
  });

  it('FAIL CLOSED: evidence that recorded no digest (older record or no attestation)', () => {
    for (const recorded of [undefined, null, 'not-a-digest']) {
      expect(protectedEffectOccurred(sys(run('s1', CLEAN, recorded as string | null | undefined)), ROOT, PHASE)).toBe(true);
    }
  });

  it('FAIL CLOSED: the attestation was rewritten after the runner collected it', () => {
    const dirty = JSON.stringify({ ...JSON.parse(CLEAN), paymentOccurred: true });
    const rewritten = JSON.stringify({ ...JSON.parse(CLEAN), note: 'edited later' });
    // Recorded the dirty attestation, then the worker "cleaned" it: refused, not believed.
    expect(protectedEffectOccurred(sys(run('s1', CLEAN, sha(dirty))), ROOT, PHASE)).toBe(true);
    expect(protectedEffectOccurred(sys(run('s1', rewritten, sha(CLEAN))), ROOT, PHASE)).toBe(true);
  });

  it('FAIL CLOSED: a protected effect true, missing, or the attestation not an object', () => {
    for (const body of [
      JSON.stringify({ ...JSON.parse(CLEAN), productionTouched: true }),
      JSON.stringify({ productionTouched: false }),
      '[]',
      'not json',
    ]) {
      expect(protectedEffectOccurred(sys(run('s1', body, sha(body))), ROOT, PHASE)).toBe(true);
    }
  });

  it('EVERY run counts: an earlier run that attested an effect is not hidden by a later clean one', () => {
    const dirty = JSON.stringify({ ...JSON.parse(CLEAN), externalSendOccurred: true });
    const files = {
      ...run('old', dirty, sha(dirty), '2026-10-19T09:00:00Z'),
      ...run('new', CLEAN, sha(CLEAN), '2026-10-19T11:00:00Z'),
    };
    expect(protectedEffectOccurred(sys(files), ROOT, PHASE)).toBe(true);
    // Two clean runs pass; another phase's run is not read at all.
    const other = JSON.stringify({ ...JSON.parse(CLEAN), paymentOccurred: true });
    expect(
      protectedEffectOccurred(
        sys({
          ...run('old', CLEAN, sha(CLEAN), '2026-10-19T09:00:00Z'),
          ...run('new', CLEAN, sha(CLEAN), '2026-10-19T11:00:00Z'),
          [`${EXEC}/other.session.json`]: JSON.stringify({ sessionId: 'other', phaseId: 'OTHER1A' }),
          [`${EXEC}/other.evidence.json`]: JSON.stringify({ phaseId: 'OTHER1A', sessionId: 'other', collectedAt: '2026-10-19T12:00:00Z', effectsSha256: sha(other) }),
          [`${EXEC}/other.effects.json`]: other,
        }),
        ROOT,
        PHASE,
      ),
    ).toBe(false);
  });

  it('a PLANTED evidence record is not a run: unbound to a runner session, it cannot outvote a dirty run', () => {
    const dirty = JSON.stringify({ ...JSON.parse(CLEAN), paymentOccurred: true });
    const planted = {
      // Named unlike its own session id, or with no session record at all: ignored either way.
      [`${EXEC}/forged.evidence.json`]: JSON.stringify({ phaseId: PHASE, sessionId: 'real', collectedAt: '9999-01-01T00:00:00Z', effectsSha256: sha(CLEAN) }),
      [`${EXEC}/ghost.evidence.json`]: JSON.stringify({ phaseId: PHASE, sessionId: 'ghost', collectedAt: '9999-01-01T00:00:00Z', effectsSha256: sha(CLEAN) }),
      [`${EXEC}/ghost.effects.json`]: CLEAN,
    };
    expect(protectedEffectOccurred(sys({ ...run('real', dirty, sha(dirty)), ...planted }), ROOT, PHASE)).toBe(true);
    // And with no real run, planted records alone are no run at all: occurred.
    expect(protectedEffectOccurred(sys(planted), ROOT, PHASE)).toBe(true);
  });

  it('the latest run is the latest BOUND run: a planted, mis-named later record is never "the run" closure is prepared from', () => {
    const files = {
      ...run('real', CLEAN, sha(CLEAN), '2026-10-19T10:00:00Z'),
      // Claims the real session, under a name of its own, with a later collectedAt and forged facts.
      [`${EXEC}/forged.evidence.json`]: JSON.stringify({
        phaseId: PHASE,
        sessionId: 'real',
        collectedAt: '9999-01-01T00:00:00Z',
        effectsSha256: sha(CLEAN),
        changedFiles: ['projectos/core/src/anything.ts'],
      }),
    };
    const latest = latestRunEvidence(sys(files), ROOT, PHASE);
    expect(latest?.['collectedAt']).toBe('2026-10-19T10:00:00Z');
    expect(latest?.['changedFiles']).toBeUndefined();
  });

  it('FAIL CLOSED, never a throw: an unsafe session id in an evidence record', () => {
    const files = {
      [`${EXEC}/x.evidence.json`]: JSON.stringify({ phaseId: PHASE, sessionId: '../../etc/x', collectedAt: '2026-10-19T10:00:00Z', effectsSha256: sha(CLEAN) }),
    };
    expect(() => protectedEffectOccurred(sys(files), ROOT, PHASE)).not.toThrow();
    expect(protectedEffectOccurred(sys(files), ROOT, PHASE)).toBe(true);
  });
});

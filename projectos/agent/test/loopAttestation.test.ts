/**
 * The effects attestation, and what counts as one.
 *
 * `{}` used to certify a run. That is the same fail-open as reading an ABSENT record as innocence,
 * wearing a different hat: a worker that answered none of the six questions was treated as having
 * answered "no" to all of them. Every case below is a way of not answering.
 *
 * This is an attestation under the project's manual-governance model, not a proof. Anything that can
 * write the file can write `false` into it; the backstop is the owner commit gate, where the claim
 * is a visible diff. Nothing here is tamper-proof and nothing here claims to be.
 *
 * Added by the PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A source review (HIGH).
 */
import { describe, it, expect } from 'vitest';
import { readEffects, effectsPath } from '../src/loop/session.js';
import { attestationProblems, protectedEffects, PROTECTED_EFFECT_FIELDS } from '../src/loop/outcome.js';
import type { System } from '../src/system.js';

const ROOT = '/proj';
const SESSION = 'PHASE-abc123';

/** All six stated false: the only shape that certifies. */
function allFalse(): Record<string, boolean> {
  return Object.fromEntries(PROTECTED_EFFECT_FIELDS.map((f) => [f, false]));
}

function sysWith(body: string | null): System {
  const files: Record<string, string> = {};
  if (body !== null) files[effectsPath(ROOT, SESSION)] = body;
  return {
    cwd: () => ROOT,
    now: () => '2026-08-11T20:00:00Z',
    readText: (p) => files[p] ?? null,
    writeText: () => undefined,
    exists: (p) => p in files,
    listDir: () => [],
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
}

function read(value: unknown) {
  return readEffects(sysWith(JSON.stringify(value)), ROOT, SESSION);
}

describe('readEffects — what counts as an attestation', () => {
  it('accepts all six fields stated false', () => {
    const r = read(allFalse());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(protectedEffects(r.value)).toEqual([]);
  });

  it('rejects the empty object — answering nothing is not answering no', () => {
    const r = read({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const f of PROTECTED_EFFECT_FIELDS) expect(r.problem).toContain(f);
  });

  it('rejects an attestation missing one field, naming the one it missed', () => {
    const { paymentOccurred: _omitted, ...rest } = allFalse();
    const r = read(rest);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain('does not state paymentOccurred');
    expect(r.problem).not.toContain('does not state productionTouched');
  });

  it('rejects the string "false" — it reads like a denial and is truthy', () => {
    const r = read({ ...allFalse(), deploymentOccurred: 'false' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain('deploymentOccurred');
    expect(r.problem).toContain('not a boolean');
  });

  it('rejects a null value', () => {
    const r = read({ ...allFalse(), rawSecretStored: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain('rawSecretStored');
    expect(r.problem).toContain('not a boolean');
  });

  it('rejects a number, including 0', () => {
    const r = read({ ...allFalse(), externalSendOccurred: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain('not a boolean');
  });

  it('accepts a complete attestation with one effect true, and names it', () => {
    const r = read({ ...allFalse(), databaseMutationOccurred: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(protectedEffects(r.value)).toEqual(['databaseMutationOccurred']);
  });

  it('names every effect a run admits to', () => {
    const r = read({ ...allFalse(), productionTouched: true, paymentOccurred: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(protectedEffects(r.value)).toEqual(['productionTouched', 'paymentOccurred']);
  });

  it('an absent record is null — the not-attested case, judged at certification', () => {
    const r = readEffects(sysWith(null), ROOT, SESSION);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
  });

  it('malformed JSON is a problem, never an absence and never an innocence', () => {
    const r = readEffects(sysWith('{ not json'), ROOT, SESSION);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain('not valid JSON');
  });

  it('rejects an array and a bare value', () => {
    for (const bad of [[], 'attested', 42, null]) {
      const r = read(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('attestationProblems', () => {
  it('is empty only for a complete boolean record', () => {
    expect(attestationProblems(allFalse())).toEqual([]);
    expect(attestationProblems({ ...allFalse(), paymentOccurred: true })).toEqual([]);
  });

  it('covers exactly the six fields the closure gate recognises', () => {
    expect([...PROTECTED_EFFECT_FIELDS]).toEqual([
      'productionTouched',
      'deploymentOccurred',
      'databaseMutationOccurred',
      'externalSendOccurred',
      'paymentOccurred',
      'rawSecretStored',
    ]);
  });
});

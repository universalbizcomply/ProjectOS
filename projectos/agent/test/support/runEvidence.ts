/**
 * The records a governed run of a phase leaves behind, for closure fixtures — PROJECTOS-BOOT-CONTINUE1A.
 *
 * The protected-effects closure predicate (G4-11) now reads the phase's own RUNNER evidence, which
 * records the sha256 of the worker's effects attestation as collected, and fails closed without it.
 * A fixture that models a phase reaching closure through a governed run therefore carries what such a
 * run really leaves: runner evidence for the phase and a clean attestation that still matches it.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLEAN_EFFECTS = JSON.stringify({
  productionTouched: false,
  deploymentOccurred: false,
  databaseMutationOccurred: false,
  externalSendOccurred: false,
  paymentOccurred: false,
  rawSecretStored: false,
});

export function writeCleanRunEvidence(root: string, phaseId: string, collectedAt = '2026-09-02T19:00:00.000Z'): void {
  const dir = join(root, '.projectops', 'execution');
  mkdirSync(dir, { recursive: true });
  const sessionId = `${phaseId}-fixture-run`;
  writeFileSync(join(dir, `${sessionId}.effects.json`), CLEAN_EFFECTS);
  // THE RUNNER'S SESSION RECORD, which binds the evidence to a run the runner started.
  writeFileSync(
    join(dir, `${sessionId}.session.json`),
    JSON.stringify({ sessionId, phaseId, workerId: 'fixture', kind: 'fixture', state: 'exited', startedAt: collectedAt }),
  );
  writeFileSync(
    join(dir, `${sessionId}.evidence.json`),
    JSON.stringify({
      schemaVersion: '1.0.0',
      sessionId,
      phaseId,
      collectedAt,
      effectsSha256: createHash('sha256').update(CLEAN_EFFECTS, 'utf8').digest('hex'),
    }),
  );
}

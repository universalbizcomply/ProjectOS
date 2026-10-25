/**
 * A test world for the governed workforce (PROJECTOS-AGENT-WORKFORCE1A).
 *
 * It starts from the COMMITTED governance documents in `.projectops/workforce/` and changes exactly one
 * thing: every registry entry's source digest becomes the digest of a FIXTURE instruction text, because
 * the real instruction texts are never read by tests (they live in the owner-acquired quarantined
 * cache). Everything else — pin, counts, restrictive defaults, configuration, policies, eligibility — is
 * the committed data, validated by the same `validateGovernance` production uses.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeSystem, type System } from '../../src/system.js';
import { sha256Hex } from '../../src/workforce/canonical.js';
import type { InstructionSource, WorkforceRuntime } from '../../src/workforce/dispatch.js';
import { fixtureSpecialist, type FixtureBehaviour, type SpecialistEngine } from '../../src/workforce/engines.js';
import { WorkforceStore } from '../../src/workforce/eventStore.js';
import { validateGovernance } from '../../src/workforce/governance.js';
import { catalogueDigest, registryFiles } from '../../src/workforce/registry.js';
import type { RegistryDocument, WorkforceGovernance } from '../../src/workforce/types.js';

export const REPO_ROOT = resolve(process.cwd(), '..', '..');
export const PRIMARY = 'fixture:deterministic-primary';
export const SECONDARY = 'fixture:deterministic-secondary';

export function committedDocs(): { config: any; registry: any; selectionPolicy: any; modelPolicy: any } {
  const read = (n: string): any => JSON.parse(readFileSync(join(REPO_ROOT, '.projectops', 'workforce', n), 'utf8'));
  return {
    config: read('workforce-config.json'),
    registry: read('registry.json'),
    selectionPolicy: read('selection-policy.json'),
    modelPolicy: read('model-policy.json'),
  };
}

export const fixtureText = (roleId: string): string => `Fixture expertise for ${roleId}. Specialise in careful analysis.\n`;

export function withFixtureDigests(registry: RegistryDocument): RegistryDocument {
  const entries = registry.entries.map((e) => ({ ...e, source: { ...e.source, digest: sha256Hex(fixtureText(e.id)) } }));
  return { ...registry, entries, catalogue: { ...registry.catalogue, catalogueDigest: catalogueDigest(registryFiles(entries)) } };
}

type Docs = ReturnType<typeof committedDocs>;

/** Committed governance with fixture digests, optionally edited; validated exactly as production validates. */
export function testGovernance(edit: (d: Docs) => void = () => {}): WorkforceGovernance {
  const d = committedDocs();
  d.registry = withFixtureDigests(d.registry);
  edit(d);
  const g = validateGovernance('a'.repeat(40), 'proj-alpha', d.config, d.registry, d.selectionPolicy, d.modelPolicy);
  if (!g.ok) throw new Error(`test governance invalid: ${g.problems.join('; ')}`);
  return g.value;
}

export interface Clock {
  value: string;
  advance(ms: number): void;
}

export function clock(start = '2026-09-27T12:00:00.000Z'): Clock {
  const c: Clock = {
    value: start,
    advance(ms: number) {
      c.value = new Date(Date.parse(c.value) + ms).toISOString();
    },
  };
  return c;
}

export interface World {
  readonly root: string;
  readonly sys: System;
  readonly clock: Clock;
  readonly gov: WorkforceGovernance;
  store(): WorkforceStore;
  runtime(engines?: ReadonlyMap<string, SpecialistEngine>, instructions?: InstructionSource): WorkforceRuntime;
  cleanup(): void;
}

export const fixtureInstructions: InstructionSource = {
  read: (entry) => ({ ok: true, bytes: Buffer.from(fixtureText(entry.id), 'utf8') }),
};

export function engines(primary: FixtureBehaviour = 'competent', secondary: FixtureBehaviour = 'competent'): Map<string, SpecialistEngine> {
  return new Map([
    [PRIMARY, fixtureSpecialist(PRIMARY, primary)],
    [SECONDARY, fixtureSpecialist(SECONDARY, secondary)],
  ]);
}

export function world(gov: WorkforceGovernance = testGovernance(), projectId = 'proj-alpha'): World {
  const root = mkdtempSync(join(tmpdir(), 'projectos-workforce-'));
  const c = clock();
  const sys: System = { ...nodeSystem, cwd: () => root, now: () => c.value };
  const w: World = {
    root,
    sys,
    clock: c,
    gov,
    store: () => new WorkforceStore(sys, root, projectId, gov.config.projection.maxEvents),
    runtime: (eng = engines(), instructions = fixtureInstructions) => ({ store: w.store(), gov, engines: eng, instructions }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  return w;
}

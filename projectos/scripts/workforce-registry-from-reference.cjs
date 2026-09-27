#!/usr/bin/env node
/**
 * Build `.projectops/workforce/registry.json` (PROJECTOS-AGENT-WORKFORCE1A) from the governed local
 * reference of the pinned specialist catalogue: its generated metadata table (`catalog.tsv`) and its
 * manifest of per-file SHA-256 digests (`manifest.json`). NO INSTRUCTION TEXT IS READ â€” only the
 * metadata the reference tooling already derived from the upstream front matter, and the digests.
 *
 * Every entry gets the MOST RESTRICTIVE default for every field that is not derived from the source.
 * Eligibility input: configured roles are fixture-eligible on the fixture models the evaluation pipeline
 * was run on (standard tier: both fixture models; high tier: the primary only), which
 * `agent/test/workforceEvaluation.test.ts` reproduces by re-running the pipeline; the reference's
 * restricted agents are registered `restricted`; every other agent is registered `ineligible`.
 *
 * Usage: node workforce-registry-from-reference.cjs --manifest <m> --catalog <c> --config <workforce-config.json> --out <registry.json>
 */
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

const manifest = JSON.parse(fs.readFileSync(arg('manifest'), 'utf8'));
const config = JSON.parse(fs.readFileSync(arg('config'), 'utf8'));
const pin = config.catalogue;
if (manifest.commit !== pin.commit) throw new Error(`reference is at ${manifest.commit}, not the pinned ${pin.commit}`);

const rows = fs
  .readFileSync(arg('catalog'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('id\t'))
  .map((l) => l.split('\t'));
const FIXTURE_PRIMARY = 'fixture:deterministic-primary';
const FIXTURE_SECONDARY = 'fixture:deterministic-secondary';
const BASIS_EVALUATED =
  'fixture evaluation pipeline projectos.workforce-evaluation.v1 (six checks, fixture engines only; reproduced by agent/test/workforceEvaluation.test.ts). Fixture eligibility only: live eligibility is an owner activation input.';

const entries = [];
for (const r of rows) {
  const [id, division, trust, name, , , , , flags, absPath, specialty] = r;
  const norm = absPath.replace(/\\/g, '/');
  const at = norm.indexOf(`/${division}/`);
  if (at < 0) throw new Error(`${id}: cannot locate ${division}/ in its reference path`);
  const rel = norm.slice(at + 1);
  const digest = manifest.files[rel];
  if (typeof digest !== 'string') throw new Error(`${id}: ${rel} has no digest in the manifest`);
  const configured = config.roles[id];
  let eligibility;
  if (trust === 'RED') eligibility = { status: 'restricted', models: [], basis: 'restricted by the reference classification (core purpose is an unauthorised side effect); never selectable' };
  else if (configured !== undefined) {
    const models = configured.riskTier === 'high' ? [FIXTURE_PRIMARY] : [FIXTURE_PRIMARY, FIXTURE_SECONDARY];
    eligibility = { status: 'fixture-eligible', models, basis: BASIS_EVALUATED };
  } else eligibility = { status: 'ineligible', models: [], basis: 'not configured and not evaluated' };
  entries.push({
    id,
    name,
    version: 1,
    source: { repository: pin.upstream, commit: pin.commit, path: rel, digest },
    division,
    specialties: specialty && specialty !== '-' ? [specialty] : [],
    sourceDeclares: flags === '-' ? [] : flags.split(',').map((f) => f.replace(/^declares-/, '')),
    applicablePhaseTypes: [],
    capabilities: [],
    tools: { allowed: [], forbidden: ['*'] },
    scopes: { read: [], write: [] },
    requiredInputs: [],
    outputSchema: 'projectos.specialist-result.v1',
    evidenceRequirements: [],
    costClass: 'high',
    modelPreferences: { primary: null, fallbacks: [] },
    parallelSafe: false,
    roles: { implementation: false, review: false },
    protectedActionPolicy: 'refuse-all',
    riskTier: 'high',
    eligibility,
  });
}
entries.sort((a, b) => (a.source.path < b.source.path ? -1 : a.source.path > b.source.path ? 1 : 0));

const lines = entries.map((e) => `${e.source.path}\t${e.source.digest}\n`).join('');
const divisions = new Set(entries.map((e) => e.division));
if (entries.length !== pin.expectedAgents) throw new Error(`${entries.length} agents, pinned ${pin.expectedAgents}`);
if (divisions.size !== pin.expectedDivisions) throw new Error(`${divisions.size} divisions, pinned ${pin.expectedDivisions}`);
if (Object.keys(manifest.files).length !== entries.length) throw new Error('the manifest and the metadata table disagree on the agent count');
for (const id of Object.keys(config.roles)) if (!entries.some((e) => e.id === id)) throw new Error(`configured role ${id} is not in the catalogue`);

const registry = {
  schemaVersion: 1,
  registryVersion: '1',
  catalogue: {
    repository: pin.upstream,
    commit: pin.commit,
    catalogueDigest: crypto.createHash('sha256').update(lines, 'utf8').digest('hex'),
    licence: {
      spdx: pin.licence,
      notice:
        'MIT-licensed third-party material. The upstream licence text and any notice are copied verbatim into the quarantined snapshot by the governed acquisition and preserved with the imported material.',
    },
    divisionCount: divisions.size,
    agentCount: entries.length,
    derivedAt: manifest.built_at,
    derivedFrom: 'governed local reference manifest at the pinned commit (metadata table and per-file sha256; no instruction text read)',
  },
  entries,
};
fs.writeFileSync(arg('out'), JSON.stringify(registry, null, 1) + '\n', 'utf8');
console.log(`registry: ${entries.length} agents, ${divisions.size} divisions, catalogue ${registry.catalogue.catalogueDigest}`);

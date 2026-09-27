/**
 * PROJECTOS-AGENT-WORKFORCE1A — governance documents, registry and the owner-accepted read rule.
 * Criteria: registry provenance and count equality (7, 8), restrictive defaults (10), governance-owned
 * data read only from owner-accepted committed state (5, 33), catalogue update detection (26).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSystem } from '../src/system.js';
import { GOVERNANCE_FILES, loadWorkforceGovernance, ownerAcceptedCommit, validateGovernance } from '../src/workforce/governance.js';
import { catalogueDigest, detectCatalogueChange, effectiveRole, findEntry, registryFiles, validateRegistryEntry } from '../src/workforce/registry.js';
import { committedDocs, REPO_ROOT, testGovernance } from './support/workforceWorld.js';

const PIN = 'ad9264e309bd5e5422c04784372d7841b1e5d604';

describe('the committed workforce governance', () => {
  it('validates as committed: pin, 279 agents, 18 divisions, catalogue digest, cross references', () => {
    const d = committedDocs();
    const g = validateGovernance('a'.repeat(40), 'projectos', d.config, d.registry, d.selectionPolicy, d.modelPolicy);
    expect(g.ok ? [] : g.problems).toEqual([]);
    expect(d.config.catalogue.commit).toBe(PIN);
    expect(d.config.catalogue.expectedAgents).toBe(279);
    expect(d.config.catalogue.expectedDivisions).toBe(18);
    expect(d.registry.entries).toHaveLength(279);
    expect(new Set(d.registry.entries.map((e: any) => e.division)).size).toBe(18);
    expect(d.registry.catalogue.licence.spdx).toBe('MIT');
    expect(d.registry.catalogue.licence.notice.length).toBeGreaterThan(0);
  });

  it('records every agent’s source repository, commit, path and digest, and omits none (restricted included)', () => {
    const d = committedDocs();
    for (const e of d.registry.entries) {
      expect(e.source.repository).toBe(d.config.catalogue.upstream);
      expect(e.source.commit).toBe(PIN);
      expect(e.source.path.startsWith(`${e.division}/`)).toBe(true);
      expect(e.source.digest).toMatch(/^[0-9a-f]{64}$/);
    }
    const restricted = d.registry.entries.filter((e: any) => e.eligibility.status === 'restricted');
    expect(restricted.map((e: any) => e.id).sort()).toEqual([
      'accounts-payable-agent',
      'ai-data-remediation-engineer',
      'carousel-growth-engine',
      'chief-of-staff',
      'multi-platform-publisher',
      'report-distribution-agent',
    ]);
    expect(catalogueDigest(registryFiles(d.registry.entries))).toBe(d.registry.catalogue.catalogueDigest);
  });

  it('gives every unconfigured agent no tools, no scope, no model and no eligibility', () => {
    const g = testGovernance();
    const configured = new Set(Object.keys(g.config.roles));
    for (const entry of g.registry.entries) {
      expect(validateRegistryEntry(entry)).toEqual([]);
      const role = effectiveRole(entry, g.config);
      if (configured.has(entry.id)) continue;
      expect(role.tools).toEqual([]);
      expect(role.writeScopes).toEqual([]);
      expect(role.readScopes).toEqual([]);
      expect(role.modelPreference).toBeNull();
      expect(entry.eligibility.status === 'ineligible' || entry.eligibility.status === 'restricted').toBe(true);
    }
    // Configured roles still hold no write scope: nothing in this phase writes.
    for (const id of configured) expect(effectiveRole(findEntry(g.registry, id)!, g.config).writeScopes).toEqual([]);
  });

  it('refuses a registry entry that carries anything wider than the restrictive defaults', () => {
    const entry = committedDocs().registry.entries[0];
    for (const widen of [
      (e: any) => (e.tools = { allowed: ['read-repository'], forbidden: [] }),
      (e: any) => (e.scopes = { read: ['**'], write: [] }),
      (e: any) => (e.modelPreferences = { primary: 'fixture:deterministic-primary', fallbacks: [] }),
      (e: any) => (e.costClass = 'low'),
      (e: any) => (e.protectedActionPolicy = 'allow'),
      (e: any) => (e.eligibility = { status: 'eligible', models: [], basis: '' }),
    ]) {
      const e = JSON.parse(JSON.stringify(entry));
      widen(e);
      expect(validateRegistryEntry(e).length).toBeGreaterThan(0);
    }
  });

  it('refuses when the commit, the agent count or the division count differs from the owner pin', () => {
    const d = committedDocs();
    const check = (edit: (x: any) => void): string[] => {
      const x = JSON.parse(JSON.stringify(d));
      edit(x);
      const g = validateGovernance('a'.repeat(40), 'projectos', x.config, x.registry, x.selectionPolicy, x.modelPolicy);
      return g.ok ? [] : [...g.problems];
    };
    expect(check((x) => (x.config.catalogue.commit = 'b'.repeat(40))).join()).toMatch(/not the pinned commit/);
    expect(check((x) => (x.config.catalogue.expectedAgents = 280)).join()).toMatch(/the owner pinned 280/);
    expect(check((x) => (x.config.catalogue.expectedDivisions = 17)).join()).toMatch(/the owner pinned 17/);
    expect(check((x) => x.registry.entries.pop()).join()).toMatch(/holds 278 agents/);
    expect(check((x) => (x.config.catalogue.commit = 'main')).join()).toMatch(/40-hex commit/);
    expect(check((x) => (x.registry.entries[3].source.digest = '0'.repeat(64))).join()).toMatch(/catalogueDigest does not match/);
  });

  it('refuses governance that would activate live execution or reference an unknown model', () => {
    const d = committedDocs();
    const x = JSON.parse(JSON.stringify(d));
    x.modelPolicy.liveExecutionActivated = true;
    x.modelPolicy.preferences['policy:leader'].primary = 'provider:real-model';
    const g = validateGovernance('a'.repeat(40), 'projectos', x.config, x.registry, x.selectionPolicy, x.modelPolicy);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.problems.join()).toMatch(/activation input/);
  });
});

describe('catalogue update detection (detect and report only)', () => {
  it('reports added, changed and removed agents against the pin and never reaches the registry', () => {
    const files = registryFiles(committedDocs().registry.entries);
    const paths = Object.keys(files);
    const candidate: Record<string, string> = { ...files, 'engineering/engineering-new-agent.md': 'c'.repeat(64), [paths[0]!]: 'd'.repeat(64) };
    delete candidate[paths[1]!];
    const change = detectCatalogueChange({ commit: PIN, files }, { commit: 'e'.repeat(40), files: candidate });
    expect(change.added).toEqual(['engineering/engineering-new-agent.md']);
    expect(change.changed).toEqual([paths[0]]);
    expect(change.removed).toEqual([paths[1]]);
    expect(change.unchanged).toBe(277);
    expect(change.reachesRegistry).toBe(false);
    expect(change.requiredBeforeImport).toEqual(['discovery', 'difference', 'security check', 'contract check', 'evaluation', 'owner-approved import']);
  });
});

describe('governance is read only from the owner-accepted commit', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'core.hooksPath=NUL', '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

  function repoWithUpstream(): { work: string } {
    const base = mkdtempSync(join(tmpdir(), 'projectos-wfgov-'));
    dirs.push(base);
    const remote = join(base, 'remote.git');
    const work = join(base, 'work');
    git(base, 'init', '--bare', '-q', remote);
    git(base, 'init', '-q', '-b', 'main', work);
    mkdirSync(join(work, '.projectops', 'workforce'), { recursive: true });
    for (const f of Object.values(GOVERNANCE_FILES)) writeFileSync(join(work, f), readFileSync(join(REPO_ROOT, f)));
    writeFileSync(join(work, '.projectops', 'project-config.json'), JSON.stringify({ projectId: 'accepted-project' }));
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'governance');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', '-q', '-u', 'origin', 'main');
    return { work };
  }

  it('loads from the upstream commit and ignores the working tree', () => {
    const { work } = repoWithUpstream();
    const cfgPath = join(work, GOVERNANCE_FILES.config);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.bounds.maxTeamSize = 99;
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const g = loadWorkforceGovernance(nodeSystem, work);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.value.config.bounds.maxTeamSize).toBe(4);
      expect(g.value.acceptedCommit).toBe(git(work, 'rev-parse', 'origin/main'));
    }
  });

  it('ignores an unpushed local commit: HEAD is not owner-accepted', () => {
    const { work } = repoWithUpstream();
    const cfgPath = join(work, GOVERNANCE_FILES.config);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.ceilings.maxCallsPerExecution = 100000;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    git(work, 'commit', '-q', '-am', 'leader widens its own ceiling');
    const g = loadWorkforceGovernance(nodeSystem, work);
    expect(g.ok && g.value.config.ceilings.maxCallsPerExecution).toBe(40);
  });

  it('names the project from the ACCEPTED project config, never the working tree', () => {
    const { work } = repoWithUpstream();
    writeFileSync(join(work, '.projectops', 'project-config.json'), JSON.stringify({ projectId: 'renamed-to-reset-the-leader' }));
    const g = loadWorkforceGovernance(nodeSystem, work);
    expect(g.ok && g.value.projectId).toBe('accepted-project');
  });

  it('refuses an upstream that is a LOCAL branch: an unpushed commit never poses as owner-accepted', () => {
    const { work } = repoWithUpstream();
    git(work, 'checkout', '-q', '-b', 'forged');
    const cfgPath = join(work, GOVERNANCE_FILES.config);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.ceilings.maxCallsPerExecution = 100000;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    git(work, 'commit', '-q', '-am', 'widened');
    git(work, 'checkout', '-q', '-b', 'worker');
    git(work, 'branch', '-q', '--set-upstream-to=forged');
    const g = loadWorkforceGovernance(nodeSystem, work);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.problems.join()).toMatch(/no remote-tracking upstream/);
  });

  it('refuses a local-candidate commit even at the upstream, and a branch with no upstream', () => {
    const { work } = repoWithUpstream();
    git(work, 'commit', '-q', '--allow-empty', '-m', 'candidate\n\nProjectOS-Local-Candidate: PHASE');
    git(work, 'push', '-q');
    const refused = ownerAcceptedCommit(nodeSystem, work);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join()).toMatch(/unreviewed local candidate/);
    git(work, 'checkout', '-q', '-b', 'no-upstream');
    const none = loadWorkforceGovernance(nodeSystem, work);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.problems.join()).toMatch(/no remote-tracking upstream/);
  });
});

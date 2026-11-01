import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRemoteUrl } from '../src/discovery.js';
import {
  isDerivedBinding,
  isReservedProjectId,
  linkedWorktreesFromPorcelain,
  parseTenantRegistry,
  registeredRootOf,
  resolveTenant,
  type CheckoutFacts,
  type TenantBinding,
  type TenantRegistry,
  type TenantRegistryResult,
} from '../src/tenant.js';

const committedPath = fileURLToPath(new URL('../../security/tenant-registry.json', import.meta.url));
const committed = (): Record<string, unknown> => JSON.parse(readFileSync(committedPath, 'utf8')) as Record<string, unknown>;

type Project = Record<string, unknown>;
const projectsOf = (raw: Record<string, unknown>): Project[] => raw['projects'] as Project[];

/** The committed file with one project entry changed: everything else stays good. */
function withProject(index: number, change: Project): Record<string, unknown> {
  const raw = committed();
  const projects = projectsOf(raw).map((entry, at) => (at === index ? { ...entry, ...change } : entry));
  return { ...raw, projects };
}

function withExtraProject(entry: Project): Record<string, unknown> {
  const raw = committed();
  return { ...raw, projects: [...projectsOf(raw), entry] };
}

const NEW_PROJECT: Project = {
  projectId: 'another',
  repository: 'github.com/example/another',
  governedRoot: 'C:/dev/Another',
  tenant: 'owner-personal',
  domain: 'develop',
};

function codes(result: TenantRegistryResult): readonly string[] {
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

function registry(): TenantRegistry {
  const parsed = parseTenantRegistry(committed());
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const AT_POLYGO: CheckoutFacts = {
  projectId: 'polygo',
  repository: 'github.com/polygonia-apres/polygo',
  root: 'C:/dev/Polygo/polygo',
  linkedWorktreesOfRegisteredRoot: [],
};

const AT_AGENCY: CheckoutFacts = {
  projectId: 'seo-agency',
  repository: '127.0.0.1:47900/SEOAgency-remote/seo-agency',
  root: 'C:/dev/SEOAgency',
  linkedWorktreesOfRegisteredRoot: [],
};

describe('the committed tenant registry', () => {
  it('passes whole-file validation', () => {
    expect(codes(parseTenantRegistry(committed()))).toEqual([]);
  });

  it('binds exactly the projects the owner decided, to the tenants the owner decided (D2)', () => {
    const bindings = registry().projects.map(({ projectId, tenant, domain }) => [projectId, tenant, domain]);
    expect(bindings).toEqual([
      ['projectos', 'owner-personal', 'develop'],
      ['polygo', 'owner-personal', 'develop'],
      ['seo-agency', 'agency-business', 'business'],
    ]);
  });

  it('canonicalises each repository with the rule the allowlist uses, parseRemoteUrl', () => {
    const origins: Readonly<Record<string, string>> = {
      projectos: 'https://github.com/universalbizcomply/ProjectOS.git',
      polygo: 'https://github.com/polygonia-apres/polygo.git',
      'seo-agency': 'http://127.0.0.1:47900/SEOAgency-remote/seo-agency.git',
    };
    for (const entry of registry().projects) {
      const ref = parseRemoteUrl(origins[entry.projectId] as string);
      expect(ref).not.toBeNull();
      expect(`${ref?.host}/${ref?.slug}`).toBe(entry.repository);
    }
  });
});

describe('whole-file validation', () => {
  it('a valid addition is accepted: the positive control for every refusal below', () => {
    expect(codes(parseTenantRegistry(withExtraProject(NEW_PROJECT)))).toEqual([]);
  });

  it.each([
    ['repository', { repository: 'github.com/example/*' }],
    ['governedRoot', { governedRoot: 'C:/dev/*' }],
    ['governedRoot with ?', { governedRoot: 'C:/dev/Proj?ct' }],
    ['projectId', { projectId: '*' }],
    ['tenant', { tenant: '*' }],
    ['domain', { domain: '*' }],
  ])('a wildcard %s refuses the whole file, by name', (_name, change) => {
    const result = parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, ...change }));
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('TENANT_REGISTRY_WILDCARD');
  });

  it('a wildcard tenantId refuses the whole file, by name', () => {
    const raw = committed();
    const tenants = [...(raw['tenants'] as unknown[]), { tenantId: '*', name: 'Everyone' }];
    expect(codes(parseTenantRegistry({ ...raw, tenants }))).toContain('TENANT_REGISTRY_WILDCARD');
  });

  it('a wildcard path is caught ONLY by the wildcard rule: its shape is otherwise legal', () => {
    expect(codes(parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, governedRoot: 'C:/dev/*' })))).toEqual(['TENANT_REGISTRY_WILDCARD']);
    expect(codes(parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, repository: 'github.com/example/*' })))).toEqual(['TENANT_REGISTRY_WILDCARD']);
  });

  it.each([
    ['the same project id', { projectId: 'polygo' }],
    ['the same project id in another case', { projectId: 'POLYGO' }],
    ['the same repository', { repository: 'github.com/polygonia-apres/polygo' }],
    ['the same repository in another case', { repository: 'GitHub.com/Polygonia-Apres/polygo' }],
    ['the same root', { governedRoot: 'C:/dev/Polygo/polygo' }],
    ['the same root in another case', { governedRoot: 'c:/DEV/polygo/POLYGO' }],
  ])('%s refuses the whole file, by name', (_name, change) => {
    const result = parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, ...change }));
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['TENANT_REGISTRY_DUPLICATE']);
  });

  it('a duplicate tenant id refuses the whole file', () => {
    const raw = committed();
    const tenants = [...(raw['tenants'] as unknown[]), { tenantId: 'owner-personal', name: 'Again' }];
    expect(codes(parseTenantRegistry({ ...raw, tenants }))).toEqual(['TENANT_REGISTRY_DUPLICATE']);
  });

  it.each([
    ['a tenant id of the wrong shape', { tenantId: 'Owner Personal', name: 'Someone' }],
    ['a tenant with no id', { name: 'Someone' }],
    ['a tenant with no name', { tenantId: 'third-party' }],
    ['a tenant with a blank name', { tenantId: 'third-party', name: ' ' }],
    ['a tenant with an unknown field', { tenantId: 'third-party', name: 'Someone', sharesWith: ['owner-personal'] }],
    ['a tenant line that is not an object', 'third-party'],
  ])('refuses %s', (_name, entry) => {
    const raw = committed();
    const tenants = [...(raw['tenants'] as unknown[]), entry];
    expect(codes(parseTenantRegistry({ ...raw, tenants }))).toEqual(['TENANT_REGISTRY_INVALID']);
  });

  it('a project line that is not an object refuses the whole file', () => {
    expect(codes(parseTenantRegistry(withExtraProject('polygo' as unknown as Project)))).toEqual(['TENANT_REGISTRY_INVALID']);
  });

  it('one bad line refuses the good lines too: nothing in the file can be resolved', () => {
    const result = parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, repository: '*' }));
    expect(result.ok).toBe(false);
    expect('registry' in result).toBe(false);
  });

  it('a project id using the reserved tenant prefix is refused, in any case', () => {
    expect(codes(parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, projectId: 'tenant.agency-business' })))).toEqual(['TENANT_REGISTRY_RESERVED_ID']);
    expect(codes(parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, projectId: 'TENANT.Agency' })))).toEqual(['TENANT_REGISTRY_RESERVED_ID']);
    expect(isReservedProjectId('tenant.x')).toBe(true);
    expect(isReservedProjectId('tenantish')).toBe(false);
  });

  it.each([
    ['a tenant the file does not declare', { tenant: 'nobody' }],
    ['an unknown domain', { domain: 'marketing' }],
    ['a relative root', { governedRoot: 'dev/Another' }],
    ['a root with backslashes', { governedRoot: 'C:\\dev\\Another' }],
    ['a parent segment that re-spells another root', { governedRoot: 'C:/dev/Another/../Polygo/polygo' }],
    ['a trailing dot Windows would trim', { governedRoot: 'C:/dev/Polygo/polygo.' }],
    ['a repository that is not canonical', { repository: 'https://github.com/example/another.git' }],
    ['an unknown field', { aliases: ['polygo'] }],
    ['a missing tenant', { tenant: undefined }],
  ])('refuses %s', (_name, change) => {
    const entry = JSON.parse(JSON.stringify({ ...NEW_PROJECT, ...change })) as Project;
    expect(codes(parseTenantRegistry(withExtraProject(entry)))).toEqual(['TENANT_REGISTRY_INVALID']);
  });

  it('a path with a space is legal: real project folders have them', () => {
    expect(codes(parseTenantRegistry(withExtraProject({ ...NEW_PROJECT, governedRoot: 'C:/dev/BizComply V2' })))).toEqual([]);
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['a wrong schema version', { ...committed(), schemaVersion: '2.0.0' }],
    ['a wrong policy', { ...committed(), policy: 'allowlist' }],
    ['no projects', { ...committed(), projects: [] }],
    ['no tenants', { ...committed(), tenants: [] }],
    ['an unknown top-level field', { ...committed(), fallbackTenant: 'owner-personal' }],
  ])('refuses %s', (_name, raw) => {
    expect(parseTenantRegistry(raw).ok).toBe(false);
  });

  it.each(['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'])('a record with no %s is refused, as the schema says', (field) => {
    const { [field]: _removed, ...rest } = committed();
    expect(codes(parseTenantRegistry(rest))).toEqual(['TENANT_REGISTRY_INVALID']);
    expect(codes(parseTenantRegistry({ ...committed(), [field]: ' ' }))).toEqual(['TENANT_REGISTRY_INVALID']);
  });
});

describe('resolveTenant', () => {
  it('derives each tenant from the registry: two real tenants, two real answers', () => {
    const own = resolveTenant(registry(), AT_POLYGO);
    const agency = resolveTenant(registry(), AT_AGENCY);
    expect(own.ok && [own.binding.tenant, own.binding.domain, own.binding.via]).toEqual(['owner-personal', 'develop', 'governed-root']);
    expect(agency.ok && [agency.binding.tenant, agency.binding.domain]).toEqual(['agency-business', 'business']);
  });

  it('refuses an unlisted project by name, and never defaults to the owner', () => {
    const result = resolveTenant(registry(), { ...AT_POLYGO, projectId: 'unlisted' });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_UNKNOWN' });
    expect(result.ok ? '' : result.reasons.join(' ')).toContain("'unlisted'");
  });

  it('a project id claimed from the wrong repository is a mismatch, not the claimed tenant', () => {
    const result = resolveTenant(registry(), { ...AT_POLYGO, projectId: 'seo-agency' });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('a checkout with no readable origin is a mismatch', () => {
    expect(resolveTenant(registry(), { ...AT_POLYGO, repository: null })).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('the right repository at the wrong root is a mismatch: a copy elsewhere is a different project', () => {
    expect(resolveTenant(registry(), { ...AT_POLYGO, root: 'C:/Users/somebody/polygo' })).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('compares paths the way Windows resolves them', () => {
    const result = resolveTenant(registry(), { ...AT_POLYGO, root: 'c:\\dev\\polygo\\POLYGO\\' });
    expect(result.ok && result.binding.via).toBe('governed-root');
  });

  it('refuses a registry that did not come from parseTenantRegistry', () => {
    const copy = { ...registry() };
    expect(resolveTenant(copy, AT_POLYGO)).toMatchObject({ ok: false, code: 'TENANT_REGISTRY_INVALID' });
  });

  it('names the root the kernel must ask, and null for an unlisted project', () => {
    expect(registeredRootOf(registry(), 'polygo')).toBe('C:/dev/Polygo/polygo');
    expect(registeredRootOf(registry(), 'unlisted')).toBeNull();
  });
});

describe('the linked-worktree rule (ADR-T1 §5)', () => {
  const LINKED = 'C:/dev/Polygo-worktrees/feature';

  it('a worktree the registered root lists takes its tenant and domain', () => {
    const result = resolveTenant(registry(), { ...AT_POLYGO, root: LINKED, linkedWorktreesOfRegisteredRoot: [LINKED] });
    expect(result.ok && [result.binding.tenant, result.binding.via, result.binding.governedRoot]).toEqual(['owner-personal', 'linked-worktree', 'C:/dev/Polygo/polygo']);
  });

  it('a directory the registered root does not list is refused, whatever the directory says', () => {
    const result = resolveTenant(registry(), { ...AT_POLYGO, root: LINKED, linkedWorktreesOfRegisteredRoot: ['C:/dev/Polygo-worktrees/other'] });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('a worktree of one project cannot take another project id', () => {
    const result = resolveTenant(registry(), { ...AT_AGENCY, repository: AT_POLYGO.repository, root: LINKED, linkedWorktreesOfRegisteredRoot: [LINKED] });
    expect(result).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });

  it('parses the listing git prints, skipping the main tree and anything prunable', () => {
    const porcelain = [
      'worktree C:/dev/Polygo/polygo',
      'HEAD 6e6db526085b00f673d9b8eb8830f9c2dd048a7f',
      'branch refs/heads/main',
      '',
      'worktree C:/dev/Polygo-worktrees/feature',
      'HEAD f2d2ec92340f30125a072041f9821f7901a9564b',
      'branch refs/heads/feature',
      '',
      'worktree C:/dev/Polygo-worktrees/gone',
      'HEAD ff58a3b3a5f88f99e5e9bfc044761b2589dbc6d4',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
      '',
    ].join('\n');
    expect(linkedWorktreesFromPorcelain(porcelain)).toEqual(['C:/dev/Polygo-worktrees/feature']);
    expect(linkedWorktreesFromPorcelain(porcelain.split('\n').join('\r\n'))).toEqual(['C:/dev/Polygo-worktrees/feature']);
    expect(linkedWorktreesFromPorcelain('')).toEqual([]);
  });
});

describe('the binding brand', () => {
  it('only resolveTenant produces a derived binding', () => {
    const result = resolveTenant(registry(), AT_AGENCY);
    expect(result.ok && isDerivedBinding(result.binding)).toBe(true);
  });

  it('a structurally perfect copy is not one', () => {
    const result = resolveTenant(registry(), AT_AGENCY);
    const copy = { ...(result as { binding: TenantBinding }).binding };
    expect(isDerivedBinding(copy)).toBe(false);
    expect(isDerivedBinding(null)).toBe(false);
    expect(isDerivedBinding('agency-business')).toBe(false);
  });

  it('a binding cannot be edited after it is derived', () => {
    const result = resolveTenant(registry(), AT_POLYGO);
    expect(result.ok && Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(registry().projects)).toBe(true);
  });
});

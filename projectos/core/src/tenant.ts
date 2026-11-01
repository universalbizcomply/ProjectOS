/**
 * The tenant boundary's pure rules: whose data and authority a piece of governed work runs under.
 *
 * TENANT IS NOT DOMAIN. A tenant says WHOSE data and authority; a domain says WHICH product area
 * (Develop, Business, Personal, Phone). A project has exactly one of each, and one tenant can hold
 * several domains. See `docs/adr/ADR-T1-tenant-boundary.md`.
 *
 * THE TENANT IS DERIVED, NEVER SUPPLIED (ADR-K1 R2). The only way to obtain a `TenantBinding` is
 * `resolveTenant`, given a registry that passed whole-file validation and facts the kernel read from
 * git. The binding is branded by a `WeakSet` private to this module, the same shape as the vault's
 * `liveGrants`, so a hand-written `{ tenant: 'agency-business' }` is refused at run time as well as by
 * the compiler. Worker text, argv and environment variables have no way in.
 *
 * THE WHOLE FILE, OR NOTHING. `parseTenantRegistry` judges every entry before anything can match. A
 * duplicate or a wildcard anywhere refuses the entire registry, including projects whose own entries
 * are perfect: a registry that contradicts itself has no trustworthy line in it, and a reader that
 * stops at the first match would never see the contradiction further down.
 *
 * LINKED WORKTREES (ADR-T1 §5). A governed run may use a linked worktree, so the tenant must resolve
 * there, or every such run is refused. A worktree's own `.git` file is rewritable from inside it, so
 * its claim about its primary counts for nothing. The fact the rule accepts is the list git gives when
 * asked FROM THE REGISTERED ROOT. This grants tenant identity only: the installation allowlist still
 * refuses a linked worktree for anything that spends a credential, and this module does not change that.
 *
 * NO I/O. The kernel reads the committed bytes and asks git; this module judges what it is handed.
 */

export const TENANT_REGISTRY_SCHEMA_VERSION = '1.0.0';
export const TENANT_REGISTRY_POLICY = 'tenant-registry';

export const DOMAINS = ['develop', 'business', 'personal', 'phone'] as const;
export type Domain = (typeof DOMAINS)[number];

/**
 * The reserved credential project segment for tenant-class credentials: `tenant.<tenantId>`.
 *
 * Windows credential target names may compare case-insensitively, so the reservation does too: a
 * project called `Tenant.agency-business` would otherwise share a name with that tenant's secrets.
 */
export const TENANT_CREDENTIAL_PREFIX = 'tenant.';

/**
 * Tenant ids. At most 57 characters, so `tenant.<tenantId>` still fits the 64-character credential
 * reference segment.
 */
const TENANT_ID = /^[a-z][a-z0-9-]{1,56}$/;
/** A project id is a credential reference segment, so it has that segment's shape. */
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** `host/owner/name`, as `parseRemoteUrl` canonicalises it. The host may carry a port. */
const REPOSITORY = /^[^\s/]+\/[^\s/]+\/\S+$/;
/** An absolute drive path with forward slashes. Spaces are real (`C:/dev/BizComply V2`). */
const GOVERNED_ROOT = /^[A-Za-z]:\/[^\\]*$/;
/** `.`, `..`, or a segment Windows would silently trim: each is a second spelling of another root. */
const GOVERNED_ROOT_ALIAS = /[. ](\/|$)/;
/** `*` and `?` mean "more than one thing", which a binding may never mean. */
const WILDCARD = /[*?]/;

/** A record that cannot say who authorised it, and why it is trusted, is not one. */
const PROSE_FIELDS = ['note', 'authority', 'authorisedBy', 'provenance', 'trustBasis'];
const HEADER_FIELDS = ['schemaVersion', 'policy', ...PROSE_FIELDS, 'tenants', 'projects'];
const TENANT_FIELDS = ['tenantId', 'name', 'note'];
const PROJECT_FIELDS = ['projectId', 'repository', 'governedRoot', 'tenant', 'domain', 'note'];
/** The values that decide a match. Prose fields are free text and are not scanned. */
const BINDING_FIELDS = ['projectId', 'repository', 'governedRoot', 'tenant', 'domain'] as const;

export type TenantRegistryCode =
  | 'TENANT_REGISTRY_INVALID'
  | 'TENANT_REGISTRY_WILDCARD'
  | 'TENANT_REGISTRY_DUPLICATE'
  | 'TENANT_REGISTRY_RESERVED_ID';

export interface TenantRegistryProblem {
  readonly code: TenantRegistryCode;
  readonly message: string;
}

export interface TenantEntry {
  readonly tenantId: string;
  readonly name: string;
}

export interface TenantProjectEntry {
  readonly projectId: string;
  readonly repository: string;
  readonly governedRoot: string;
  readonly tenant: string;
  readonly domain: Domain;
}

export interface TenantRegistry {
  readonly tenants: readonly TenantEntry[];
  readonly projects: readonly TenantProjectEntry[];
}

export type TenantRegistryResult =
  | { readonly ok: true; readonly registry: TenantRegistry }
  | { readonly ok: false; readonly problems: readonly TenantRegistryProblem[] };

/** Registries that passed whole-file validation. Nothing else can be resolved against. */
const LIVE_REGISTRIES = new WeakSet<object>();
/** Bindings `resolveTenant` produced. Nothing else can mint an envelope. */
const LIVE_BINDINGS = new WeakSet<object>();

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function invalid(message: string): TenantRegistryProblem {
  return { code: 'TENANT_REGISTRY_INVALID', message };
}

function unknownFieldProblems(record: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): readonly TenantRegistryProblem[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => invalid(`${label} carries an unknown field '${key}'`));
}

/** Is this project id one a credential reference would read as a tenant-class segment? */
export function isReservedProjectId(projectId: string): boolean {
  return projectId.toLowerCase().startsWith(TENANT_CREDENTIAL_PREFIX);
}

/** Canonical path key: separators normalised, case-insensitive, no trailing slash, as Windows resolves it. */
function rootKey(path: string): string {
  return path.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase();
}

function headerProblems(root: Readonly<Record<string, unknown>>): readonly TenantRegistryProblem[] {
  const problems: TenantRegistryProblem[] = [
    ...unknownFieldProblems(root, HEADER_FIELDS, 'the tenant registry'),
    ...PROSE_FIELDS.filter((field) => typeof root[field] !== 'string' || root[field].trim() === '').map((field) => invalid(`the tenant registry has no ${field}`)),
  ];
  if (root['schemaVersion'] !== TENANT_REGISTRY_SCHEMA_VERSION) {
    problems.push(invalid(`the tenant registry has schemaVersion ${JSON.stringify(root['schemaVersion'])}, expected "${TENANT_REGISTRY_SCHEMA_VERSION}"`));
  }
  if (root['policy'] !== TENANT_REGISTRY_POLICY) {
    problems.push(invalid(`the tenant registry has policy ${JSON.stringify(root['policy'])}, expected "${TENANT_REGISTRY_POLICY}"`));
  }
  return problems;
}

function tenantProblems(entry: unknown, index: number): readonly TenantRegistryProblem[] {
  const label = `tenants[${index}]`;
  const record = asRecord(entry);
  if (record === null) return [invalid(`${label} is not an object`)];
  const id = record['tenantId'];
  const problems: TenantRegistryProblem[] = [...unknownFieldProblems(record, TENANT_FIELDS, label)];
  if (typeof id === 'string' && WILDCARD.test(id)) {
    problems.push({ code: 'TENANT_REGISTRY_WILDCARD', message: `${label} has a wildcard tenantId` });
  } else if (typeof id !== 'string' || !TENANT_ID.test(id)) {
    problems.push(invalid(`${label} has no valid tenantId`));
  }
  if (typeof record['name'] !== 'string' || record['name'].trim() === '') {
    problems.push(invalid(`${label} has no name`));
  }
  return problems;
}

/** One field of one project entry, assuming it holds no wildcard. `null` when it is sound. */
function bindingFieldProblem(field: (typeof BINDING_FIELDS)[number], value: string, tenantIds: ReadonlySet<string>): string | null {
  switch (field) {
    case 'projectId':
      return PROJECT_ID.test(value) ? null : 'is not a valid project id';
    case 'repository':
      return REPOSITORY.test(value) ? null : 'is not a canonical host/owner/name repository';
    case 'governedRoot':
      return GOVERNED_ROOT.test(value) && !GOVERNED_ROOT_ALIAS.test(value) ? null : 'is not one canonical absolute forward-slash path';
    case 'tenant':
      return tenantIds.has(value) ? null : 'names a tenant this registry does not declare';
    case 'domain':
      return (DOMAINS as readonly string[]).includes(value) ? null : 'names an unknown domain';
  }
}

function projectProblems(entry: unknown, index: number, tenantIds: ReadonlySet<string>): readonly TenantRegistryProblem[] {
  const label = `projects[${index}]`;
  const record = asRecord(entry);
  if (record === null) return [invalid(`${label} is not an object`)];
  const problems: TenantRegistryProblem[] = [...unknownFieldProblems(record, PROJECT_FIELDS, label)];
  for (const field of BINDING_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || value === '') {
      problems.push(invalid(`${label} has no ${field}`));
      continue;
    }
    if (WILDCARD.test(value)) {
      problems.push({ code: 'TENANT_REGISTRY_WILDCARD', message: `${label} has a wildcard ${field}` });
      continue;
    }
    const problem = bindingFieldProblem(field, value, tenantIds);
    if (problem !== null) problems.push(invalid(`${label}.${field} ${problem}`));
  }
  const projectId = record['projectId'];
  if (typeof projectId === 'string' && isReservedProjectId(projectId)) {
    problems.push({
      code: 'TENANT_REGISTRY_RESERVED_ID',
      message: `${label} uses the project id '${projectId}', and '${TENANT_CREDENTIAL_PREFIX}' is reserved for tenant-class credentials`,
    });
  }
  return problems;
}

/**
 * Two lines naming the same project, the same repository or the same root.
 *
 * ALL THREE, BECAUSE A PROJECT HAS ONE TENANT. Comparing project ids alone would let one repository
 * be listed twice under two names and two tenants, and the tenant would then depend on which name
 * the checkout chose to call itself, in a file it can write.
 */
function duplicateProblems(entries: readonly unknown[]): readonly TenantRegistryProblem[] {
  const keys: readonly (readonly [(typeof BINDING_FIELDS)[number], (value: string) => string])[] = [
    ['projectId', (value) => value.toLowerCase()],
    ['repository', (value) => value.toLowerCase()],
    ['governedRoot', rootKey],
  ];
  return keys.flatMap(([field, keyOf]) => {
    const values = entries.flatMap((entry) => {
      const value = asRecord(entry)?.[field];
      return typeof value === 'string' ? [keyOf(value)] : [];
    });
    return values
      .filter((value, index) => values.indexOf(value) !== index)
      .map((value) => ({ code: 'TENANT_REGISTRY_DUPLICATE' as const, message: `more than one project entry has the ${field} '${value}'` }));
  });
}

/**
 * Judge the whole file. Every problem in it is reported, and any problem refuses all of it.
 *
 * The caller hands over parsed JSON from committed bytes; nothing here reads a file. The registry
 * returned is the only value `resolveTenant` will accept.
 */
export function parseTenantRegistry(raw: unknown): TenantRegistryResult {
  const root = asRecord(raw);
  if (root === null) return { ok: false, problems: [invalid('the tenant registry is not an object')] };
  const tenants = Array.isArray(root['tenants']) ? (root['tenants'] as readonly unknown[]) : null;
  const projects = Array.isArray(root['projects']) ? (root['projects'] as readonly unknown[]) : null;
  const tenantIds = (tenants ?? []).flatMap((entry) => {
    const id = asRecord(entry)?.['tenantId'];
    return typeof id === 'string' ? [id] : [];
  });
  const problems: readonly TenantRegistryProblem[] = [
    ...headerProblems(root),
    ...(tenants === null || tenants.length === 0 ? [invalid('the tenant registry declares no tenants list')] : []),
    ...(projects === null || projects.length === 0 ? [invalid('the tenant registry declares no projects list')] : []),
    ...(tenants ?? []).flatMap((entry, index) => tenantProblems(entry, index)),
    ...tenantIds
      .filter((id, index) => tenantIds.indexOf(id) !== index)
      .map((id) => ({ code: 'TENANT_REGISTRY_DUPLICATE' as const, message: `more than one tenant entry has the tenantId '${id}'` })),
    ...(projects ?? []).flatMap((entry, index) => projectProblems(entry, index, new Set(tenantIds))),
    ...duplicateProblems(projects ?? []),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const registry: TenantRegistry = Object.freeze({
    tenants: Object.freeze((tenants as readonly TenantEntry[]).map(({ tenantId, name }) => Object.freeze({ tenantId, name }))),
    projects: Object.freeze(
      (projects as readonly TenantProjectEntry[]).map(({ projectId, repository, governedRoot, tenant, domain }) =>
        Object.freeze({ projectId, repository, governedRoot, tenant, domain }),
      ),
    ),
  });
  LIVE_REGISTRIES.add(registry);
  return { ok: true, registry };
}

/**
 * The linked worktrees git lists, from `git -C <registered root> worktree list --porcelain`.
 *
 * ASK THE REGISTERED ROOT, NOT THE CHECKOUT. Run from inside a checkout this would repeat what that
 * checkout's own `.git` file says; run from the root the registry names, it reports what that
 * repository actually attached. The first record is the main working tree, which is the registered
 * root itself and is not a linked worktree. A `prunable` record has lost its directory, and something
 * new sitting at that path has not been attached by anyone.
 */
export function linkedWorktreesFromPorcelain(porcelain: string): readonly string[] {
  const records = porcelain
    .split(/\r?\n\r?\n/)
    .map((record) => record.split(/\r?\n/).filter((line) => line !== ''))
    .filter((lines) => lines.length > 0);
  return records.slice(1).flatMap((lines) => {
    const head = lines[0] ?? '';
    if (!head.startsWith('worktree ')) return [];
    return lines.some((line) => line === 'prunable' || line.startsWith('prunable ')) ? [] : [head.slice('worktree '.length)];
  });
}

/** What the kernel read about the checkout it is about to work in. Nothing here is taken from a worker. */
export interface CheckoutFacts {
  /** The project id the governed context loaded. A claim, until the repository and root agree. */
  readonly projectId: string;
  /** `host/owner/name` from `origin`, through `parseRemoteUrl`. `null` when there is no readable origin. */
  readonly repository: string | null;
  /** The checkout's absolute root. */
  readonly root: string;
  /**
   * `linkedWorktreesFromPorcelain` of the listing taken at the REGISTERED root for this project id.
   * Empty for an ordinary checkout. Never derived from the checkout being judged.
   */
  readonly linkedWorktreesOfRegisteredRoot: readonly string[];
}

export interface TenantBinding extends TenantProjectEntry {
  readonly via: 'governed-root' | 'linked-worktree';
}

export type TenantResolutionCode = 'TENANT_UNKNOWN' | 'TENANT_MISMATCH' | 'TENANT_REGISTRY_INVALID';

export type TenantResolution =
  | { readonly ok: true; readonly binding: TenantBinding }
  | { readonly ok: false; readonly code: TenantResolutionCode; readonly reasons: readonly string[] };

/** Where the kernel asks git for linked worktrees: the root the registry names, or `null` if unlisted. */
export function registeredRootOf(registry: TenantRegistry, projectId: string): string | null {
  return registry.projects.find((entry) => entry.projectId === projectId)?.governedRoot ?? null;
}

function checkoutRoute(entry: TenantProjectEntry, checkout: CheckoutFacts): TenantBinding['via'] | null {
  if (rootKey(entry.governedRoot) === rootKey(checkout.root)) return 'governed-root';
  const attached = checkout.linkedWorktreesOfRegisteredRoot.some((path) => rootKey(path) === rootKey(checkout.root));
  return attached ? 'linked-worktree' : null;
}

/**
 * The tenant and domain of this checkout, or a refusal by name.
 *
 * An unlisted project is `TENANT_UNKNOWN`; it never falls back to a default tenant, because the
 * default would be the owner's and the mistake would be invisible. A listed project at the wrong
 * repository or root is `TENANT_MISMATCH`: the id is a string in a file the project writes, and a
 * copy elsewhere is a different project however it describes itself.
 */
export function resolveTenant(registry: TenantRegistry, checkout: CheckoutFacts): TenantResolution {
  if (!LIVE_REGISTRIES.has(registry)) {
    return { ok: false, code: 'TENANT_REGISTRY_INVALID', reasons: ['this registry did not pass whole-file validation'] };
  }
  const entry = registry.projects.find((candidate) => candidate.projectId === checkout.projectId);
  if (entry === undefined) {
    return { ok: false, code: 'TENANT_UNKNOWN', reasons: [`project '${checkout.projectId}' is not in the tenant registry`] };
  }
  if (checkout.repository === null || checkout.repository.toLowerCase() !== entry.repository.toLowerCase()) {
    return {
      ok: false,
      code: 'TENANT_MISMATCH',
      reasons: [`project '${entry.projectId}' is registered at ${entry.repository}, and this checkout is ${checkout.repository ?? 'of no readable repository'}`],
    };
  }
  const via = checkoutRoute(entry, checkout);
  if (via === null) {
    return {
      ok: false,
      code: 'TENANT_MISMATCH',
      reasons: [`project '${entry.projectId}' is registered at ${entry.governedRoot}, and ${checkout.root} is not that root or a worktree it lists`],
    };
  }
  const binding: TenantBinding = Object.freeze({ ...entry, via });
  LIVE_BINDINGS.add(binding);
  return { ok: true, binding };
}

/** Did `resolveTenant` produce this value? A structurally perfect copy did not. */
export function isDerivedBinding(value: unknown): value is TenantBinding {
  return typeof value === 'object' && value !== null && LIVE_BINDINGS.has(value);
}

/** The shapes the envelope rules share with the registry. */
export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID.test(value);
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID.test(value);
}

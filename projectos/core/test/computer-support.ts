import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  compileExecPolicy,
  prepareExecCommand,
  type ExecPolicy,
  type ExecutableResolverPort,
  type PreparedExec,
} from '../src/computer/index.js';
import { parseTenantRegistry, resolveTenant, type TenantBinding } from '../src/tenant.js';

const securityPath = (name: string): string => fileURLToPath(new URL(`../../security/${name}`, import.meta.url));
const json = (name: string): { actions: Record<string, unknown>[] } => JSON.parse(readFileSync(securityPath(name), 'utf8')) as { actions: Record<string, unknown>[] };

/** The committed action registry, parsed the way the kernel parses it. It lists no computer action, so each reads as P5. */
export function committedRegistry(): ActionRegistry {
  const parsed = parseActionRegistry(json('action-registry.json'));
  if (!parsed.ok) throw new Error('the committed action registry does not parse');
  return parsed.registry;
}

/** The committed registry plus rows a later phase would add. A test that cannot parse its own registry throws. */
export function registryWith(rows: Readonly<Record<string, 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6'>>): ActionRegistry {
  const raw = json('action-registry.json');
  const extra = Object.entries(rows).map(([id, actionClass]) => ({ id, governanceAction: null, ownerOnlyAction: null, class: actionClass, environment: 'local' }));
  const parsed = parseActionRegistry({ ...raw, actions: [...raw.actions, ...extra] });
  if (!parsed.ok) throw new Error(`the test registry does not parse: ${parsed.problems.map((p) => p.message).join('; ')}`);
  return parsed.registry;
}

function bindingOf(projectId: string, repository: string, root: string): TenantBinding {
  const parsed = parseTenantRegistry(json('tenant-registry.json'));
  if (!parsed.ok) throw new Error('the committed tenant registry does not parse');
  const resolved = resolveTenant(parsed.registry, { projectId, repository, root, worktrees: null });
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

/** tenant `owner-personal`, project `polygo`. */
export const polygo = (): TenantBinding => bindingOf('polygo', 'github.com/polygonia-apres/polygo', 'C:/dev/Polygo/polygo');
/** tenant `owner-personal`, project `projectos`: the same tenant as `polygo`, another project. */
export const projectos = (): TenantBinding => bindingOf('projectos', 'github.com/universalbizcomply/ProjectOS', 'C:/dev/ProjectOS');
/** tenant `agency-business`. */
export const agency = (): TenantBinding => bindingOf('seo-agency', '127.0.0.1:47900/SEOAgency-remote/seo-agency', 'C:/dev/SEOAgency');

export const NOW = Date.parse('2026-11-14T12:00:00.000Z');
export const MINUTE = 60_000;

/** A clock the test moves by hand. */
export function movingClock(start = NOW): { readonly clock: () => number; readonly set: (ms: number) => void; readonly advance: (ms: number) => void } {
  let now = start;
  return { clock: () => now, set: (ms) => (now = ms), advance: (ms) => (now += ms) };
}

/** A resolver that finds each name in a table and nothing else. */
export function resolverOf(table: Readonly<Record<string, string>>): ExecutableResolverPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: (raw) => {
      calls.push(raw);
      const found = table[raw];
      return found === undefined ? null : { resolvedRealPath: found };
    },
  };
}

export const GIT = '/usr/bin/git';
export const REPO = '/work/polygo';
export const TABLE: Readonly<Record<string, string>> = { git: GIT, [GIT]: GIT, ls: '/bin/ls', cat: '/bin/cat', sh: '/bin/sh' };

export interface RequestChange {
  readonly [key: string]: unknown;
}

export const request = (change: RequestChange = {}): Record<string, unknown> => ({
  argv: ['git', 'status'],
  cwd: REPO,
  envNames: [],
  timeoutMs: 30_000,
  maxOutputBytes: 65_536,
  ...change,
});

/** A command the reader prepared. A test that cannot prepare its control has found a bug, so it throws. */
/** The agent a command is prepared for comes from the caller's identity, never from the request. */
export function preparedFor(binding: TenantBinding, agentId: string, change: RequestChange = {}, resolver: ExecutableResolverPort = resolverOf(TABLE)): PreparedExec {
  const result = prepareExecCommand(binding, request(change), resolver, agentId);
  if (!result.ok) throw new Error(`the control command was refused: ${result.code}: ${result.detail}`);
  return result.prepared;
}

/** The same, for the agent `worker`, or the agent a test names with `agentId`. */
export function preparedOf(binding: TenantBinding, change: RequestChange = {}, resolver: ExecutableResolverPort = resolverOf(TABLE)): PreparedExec {
  const { agentId, ...rest } = change;
  return preparedFor(binding, typeof agentId === 'string' ? agentId : 'worker', rest, resolver);
}

export const AGENT = 'worker';

/** The owner's decision as the owner was shown it: it carries the hash of the command. */
export function decisionFor(prepared: PreparedExec, decisionId = 'EXECDEC-0123456789abcdef', change: Record<string, unknown> = {}): Record<string, unknown> {
  return { decisionId, decidedBy: 'owner', decision: 'allow-once', hash: prepared.hash, ...change };
}

/** A verifier that answers exactly true for every claim. A test that wants refusal passes another. */
export const verifyAll = (): boolean => true;

/** The committed registry with the exec action registered at a class that runs unattended, and a policy that allows git. */
export const unattendedRegistry = (): ActionRegistry => registryWith({ 'exec-command': 'P3' });


/** A compiled exec policy that allows `git` from any argument list, run under `/work`. A refused policy is a bug in the test. */
export function execPolicyOf(mode: 'deny' | 'allowlist' | 'ask-on-miss' | 'ask-always' = 'allowlist', extra: Record<string, unknown> = {}): ExecPolicy {
  const result = compileExecPolicy({ mode, allowlist: [{ pattern: GIT, anyArgs: true, cwdPrefixes: ['/work'], ...extra }] });
  if (!result.ok) throw new Error(`the control exec policy was refused: ${result.code}: ${result.detail}`);
  return result.policy;
}

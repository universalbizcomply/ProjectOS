// Origin: original ProjectOS code
/**
 * The broker's provider registry and price table, loaded from committed bytes only.
 *
 * THIS FILE READS NOTHING. It is handed a `CommittedRead`, which answers a repository path with the text at HEAD
 * and the commit it was read at, or null. A working-tree read has no commit to give, so it is refused: the price
 * table and the provider list cannot be edited in place and trusted. The path is judged first, so a caller cannot
 * pick other bytes with `..` or an absolute path. No credential is read, and the registry refuses a record that
 * carries one.
 */

import { COMMIT_SHA, createProviderRegistry, parseCommittedPricing, type PricingTable, type ProviderRegistry } from '@projectos/core';

export interface CommittedRead {
  (path: string): { readonly text: string; readonly commit: string } | null;
}

export interface BrokerConfigParams {
  readonly read: CommittedRead;
  readonly pricingPath: string;
  readonly registryPath: string;
}

export type BrokerConfigLoad =
  | { readonly ok: true; readonly registry: ProviderRegistry; readonly pricing: PricingTable }
  | { readonly ok: false; readonly problems: readonly string[] };

const CONFIG_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;
const REGISTRY_SCHEMA = 1;

const pathProblem = (path: string): string | null =>
  typeof path === 'string' && CONFIG_PATH.test(path) && !path.split('/').some((segment) => segment === '.' || segment === '..')
    ? null
    : `${JSON.stringify(path)} is not a repository path to a .json file`;

function committedText(read: CommittedRead, path: string): { text: string; commit: string } | string {
  const bad = pathProblem(path);
  if (bad !== null) return bad;
  const found = read(path);
  if (found === null || found === undefined) return `${path} has no committed copy`;
  return typeof found.commit === 'string' && COMMIT_SHA.test(found.commit) && typeof found.text === 'string' ? { text: found.text, commit: found.commit } : `${path} was not read at a commit`;
}

function registryOf(text: string): { registry: ProviderRegistry } | string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return ['the provider registry text is not JSON'];
  }
  const row = parsed as { schema?: unknown; providers?: unknown } | null;
  if (typeof row !== 'object' || row === null || row.schema !== REGISTRY_SCHEMA || !Array.isArray(row.providers)) {
    return [`the provider registry is not schema ${REGISTRY_SCHEMA} with a providers list`];
  }
  const made = createProviderRegistry(row.providers);
  return made.ok ? { registry: made.registry } : [...made.problems];
}

export function loadCommittedBrokerConfig(params: BrokerConfigParams): BrokerConfigLoad {
  const pricingText = committedText(params.read, params.pricingPath);
  const registryText = committedText(params.read, params.registryPath);
  const problems = [pricingText, registryText].filter((found): found is string => typeof found === 'string');
  if (typeof pricingText === 'string' || typeof registryText === 'string') return { ok: false, problems };
  const registry = registryOf(registryText.text);
  const pricing = parseCommittedPricing(pricingText);
  if (Array.isArray(registry)) problems.push(...registry);
  if (!pricing.ok) problems.push(...pricing.problems);
  if (Array.isArray(registry) || !pricing.ok) return { ok: false, problems };
  return { ok: true, registry: registry.registry, pricing: pricing.table };
}

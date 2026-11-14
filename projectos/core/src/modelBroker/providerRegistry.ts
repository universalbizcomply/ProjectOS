// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/provider_registry.py; agent/provider_base.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; a mutable global map with locks, scopes, generations, snapshot and restore became one frozen registry built once from committed records; a same-name registration overwrote the old one and is now refused; a provider is a record of data, so the picker metadata and availability probe are cut; a record carrying a credential field is refused, and no xAI or Grok provider is accepted
// Notice: full licence text in THIRD_PARTY_NOTICES

import { PROVIDER_KINDS, endpointProblem, type ProviderKind } from './endpoints.js';
import { MODEL_APIS, type ModelApi } from './transportTypes.js';

export interface ProviderRecord {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly api: ModelApi;
  readonly baseUrl?: string;
  /** A reference to a credential, never the credential. Resolving it is the credential router's work. */
  readonly credentialRef?: string;
}

export interface ProviderRegistry {
  readonly size: number;
  has(name: string): boolean;
  get(name: string): ProviderRecord | undefined;
  /** Every provider, sorted by name. */
  list(): readonly ProviderRecord[];
}

export type RegistryParse = { readonly ok: true; readonly registry: ProviderRegistry } | { readonly ok: false; readonly problems: readonly string[] };

const RECORD_KEYS = new Set(['name', 'kind', 'api', 'baseUrl', 'credentialRef']);
/** Lowercase, no spaces, hyphens allowed: the identity rule of the upstream provider base. */
const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CREDENTIAL_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LONG_ALNUM_RUN = /[A-Za-z0-9]{24}/;
const KEY_PREFIX = /^(?:sk-|ghp_|gho_|xox[abp]-|AKIA)/;
const NOT_PORTED = /(?:^|[^a-z0-9])(?:xai|x-ai|x\.ai)(?![a-z0-9])|(?:^|[^a-z0-9])grok/i;

/** Whether a provider or model name is an xAI or Grok one, which this plan does not port. */
export const isNotPortedName = (value: unknown): boolean => typeof value === 'string' && NOT_PORTED.test(value);

/** The upstream registry's key rule: names are compared stripped and lower-cased. */
export const providerKeyOf = (name: string): string => name.trim().toLowerCase();

function recordProblems(raw: unknown, at: string): { record: ProviderRecord | null; problems: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { record: null, problems: [`${at} is not a record`] };
  const row = raw as Record<string, unknown>;
  const problems = Object.keys(row).filter((key) => !RECORD_KEYS.has(key)).map((key) => `${at} carries ${JSON.stringify(key)}, which a provider record does not hold`);
  const { name, kind, api, baseUrl, credentialRef } = row;
  if (typeof name !== 'string' || !PROVIDER_NAME.test(name)) problems.push(`${at} has no usable name: lower case, no spaces`);
  if (!PROVIDER_KINDS.includes(kind as ProviderKind)) problems.push(`${at} has an unknown kind`);
  if (!MODEL_APIS.includes(api as ModelApi)) problems.push(`${at} names an api this broker does not speak`);
  if (credentialRef !== undefined && (typeof credentialRef !== 'string' || !CREDENTIAL_REF.test(credentialRef) || LONG_ALNUM_RUN.test(credentialRef) || KEY_PREFIX.test(credentialRef))) {
    problems.push(`${at} has a credentialRef that is not a reference`);
  }
  if ([name, baseUrl, credentialRef].some((value) => typeof value === 'string' && NOT_PORTED.test(value))) problems.push(`${at} names an xAI or Grok provider, which is not ported`);
  if (PROVIDER_KINDS.includes(kind as ProviderKind)) {
    const endpoint = endpointProblem({ kind: kind as ProviderKind, baseUrl });
    if (endpoint !== null) problems.push(`${at}: ${endpoint}`);
  }
  if (problems.length > 0) return { record: null, problems };
  const record: ProviderRecord = {
    name: name as string,
    kind: kind as ProviderKind,
    api: api as ModelApi,
    ...(baseUrl === undefined ? {} : { baseUrl: baseUrl as string }),
    ...(credentialRef === undefined ? {} : { credentialRef: credentialRef as string }),
  };
  return { record: Object.freeze(record), problems };
}

/** Build the one registry. It is frozen: nothing is registered afterwards, so a fallback cannot leave it. */
export function createProviderRegistry(records: readonly unknown[]): RegistryParse {
  const byKey = new Map<string, ProviderRecord>();
  const problems: string[] = [];
  records.forEach((raw, index) => {
    const made = recordProblems(raw, `providers[${index}]`);
    problems.push(...made.problems);
    if (made.record === null) return;
    const key = providerKeyOf(made.record.name);
    if (byKey.has(key)) problems.push(`providers[${index}] registers ${key} a second time`);
    byKey.set(key, made.record);
  });
  if (problems.length > 0) return { ok: false, problems };
  const sorted = Object.freeze([...byKey.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  const registry: ProviderRegistry = Object.freeze({
    size: byKey.size,
    has: (name: string) => typeof name === 'string' && byKey.has(providerKeyOf(name)),
    get: (name: string) => (typeof name === 'string' ? byKey.get(providerKeyOf(name)) : undefined),
    list: () => sorted,
  });
  return { ok: true, registry };
}

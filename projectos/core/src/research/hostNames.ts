// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/url_safety.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the metadata host names are kept and joined by the internal and local suffixes, the wildcard-DNS services and the single-label rule, which are ours; every trailing dot is dropped, where upstream dropped one
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Host NAMES a research request may never name, judged before anything is resolved.
 *
 * A name that only looks public can still reach this machine or its network: `localhost.`, `foo.localhost`,
 * `printer.local`, `metadata.google.internal`, and `127.0.0.1.nip.io`, which a wildcard-DNS service answers with the
 * address written in the name. A single-label name such as `intranet` resolves through the machine's search domain
 * and never means a public site. These are refused by name. What a public-looking name resolves to is judged
 * separately, on its addresses, in `ssrfGuard.ts`.
 *
 * Pure. The name is expected as the URL parser left it: lower-case, punycode, no brackets.
 */

/** Cloud metadata host names. Always refused, whatever DNS says. */
const METADATA_NAMES: readonly string[] = ['metadata.google.internal', 'metadata.goog', 'instance-data'];

/** Names that mean this machine or its network by convention. */
const INTERNAL_SUFFIXES: readonly string[] = ['localhost', 'local', 'internal', 'localdomain', 'lan', 'home.arpa', 'intranet', 'corp', 'home', 'in-addr.arpa', 'ip6.arpa'];

/** Wildcard-DNS services: any name under them resolves to the address written in it, so they reach anything. */
const WILDCARD_DNS_SUFFIXES: readonly string[] = ['nip.io', 'sslip.io', 'xip.io', 'lvh.me', 'localtest.me', 'vcap.me', 'lacolhost.com', 'traefik.me'];

export type HostNameReason =
  | 'invalid-host-name'
  | 'single-label-host'
  | 'blocked-host-name'
  | 'internal-host-name'
  | 'wildcard-dns-host'
  | 'metadata-host-name';

const NAME_CHARS = /^[a-z0-9._-]+$/;
const hasSuffix = (host: string, suffix: string): boolean => host === suffix || host.endsWith(`.${suffix}`);

/** Lower-case, with every trailing dot dropped, so `localhost.` and `localhost..` are `localhost`. */
export function normalizeHostName(host: string): string {
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 46) end -= 1;
  return host.slice(0, end).toLowerCase();
}

/** Why this name may not be fetched, or null. Judges the name only, never what it resolves to. */
export function hostNameProblem(host: string): HostNameReason | null {
  if (host === '' || host.length > 253 || !NAME_CHARS.test(host)) return 'invalid-host-name';
  const labels = host.split('.');
  if (labels.some((label) => label === '' || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return 'invalid-host-name';
  if (METADATA_NAMES.some((name) => hasSuffix(host, name))) return 'metadata-host-name';
  if (host === 'localhost') return 'blocked-host-name';
  if (WILDCARD_DNS_SUFFIXES.some((suffix) => hasSuffix(host, suffix))) return 'wildcard-dns-host';
  if (INTERNAL_SUFFIXES.some((suffix) => hasSuffix(host, suffix))) return 'internal-host-name';
  if (labels.length < 2) return 'single-label-host';
  // A name that ends in digits is a malformed address, not a site: `1.2.3.4.5` is not something to resolve.
  if (/^\d+$/.test(labels[labels.length - 1] as string)) return 'invalid-host-name';
  return null;
}

/** The metadata floor on its own: the names refused even for an operator's self-hosted endpoint. */
export function isMetadataName(host: string): boolean {
  return METADATA_NAMES.some((name) => hasSuffix(host, name));
}

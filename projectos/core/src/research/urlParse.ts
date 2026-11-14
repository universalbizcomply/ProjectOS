// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/url_safety.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript onto the WHATWG URL parser, so the host judged is the host a browser dials; userinfo, a backslash, whitespace, a control character and a percent-encoded host are refused where upstream refused only some; the credential-named query check is kept and the lists are shared with the rest of the guard; a canonical form is added, so two spellings of one target are one key
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * One URL, read one way (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * TWO PARSERS CAN READ ONE STRING TWO WAYS. A WHATWG client ends the authority at a backslash, decodes a
 * percent-encoded host and accepts `http:\\host`, while another parser does none of that, so
 * `http://127.0.0.1:8080\@1.1.1.1` is `1.1.1.1` to one and loopback to the other. Such a string is refused rather
 * than guessed at: control characters, whitespace, a backslash, userinfo and a percent sign in the authority never
 * reach the parser. What is left is parsed by the WHATWG parser, which turns `2130706433`, `0177.0.0.1`, `0x7f.1`,
 * `127.1`, X into `127.0.0.1`, lower-cases and punycodes the name, and drops a
 * default port. The guard judges THAT host.
 *
 * ONE TARGET, ONE KEY. `canonical` drops the fragment and the default port and keeps the rest, so two spellings of
 * one page are one cache key and one policy answer.
 *
 * Pure. `URL` is the parser global: no I/O.
 */

import type { UrlRefusalReason } from './refusal.js';
import { normalizeHostName } from './hostNames.js';

export const MAX_URL_CHARS = 2048;

export interface ParsedWebUrl {
  readonly scheme: 'http' | 'https';
  /** Lower-case, punycode, no trailing dot. An IPv6 literal keeps its brackets. */
  readonly host: string;
  readonly hostKind: 'name' | 'ipv4' | 'ipv6';
  readonly port: number;
  /** `scheme://host[:port]/path?query`, no fragment, no userinfo. The one spelling of this target. */
  readonly canonical: string;
}

export type UrlParse = { readonly ok: true; readonly url: ParsedWebUrl } | { readonly ok: false; readonly reason: UrlRefusalReason };

/** Credential-named query parameters. Narrow on purpose: `code`, `key` and `session` are page facets and stay out. */
const SENSITIVE_QUERY_NAMES: ReadonlySet<string> = new Set([
  'access_token', 'api_key', 'apikey', 'auth_token', 'authorization', 'awsaccesskeyid', 'client_secret', 'credential', 'credentials', 'jwt', 'password', 'passwd', 'secret',
  'session_id', 'signature', 'token', 'x_amz_security_token', 'x_amz_signature', 'x-amz-security-token', 'x-amz-signature',
]);

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\x00-\x20\x7f-\x9f\\]/;

function schemeProblem(input: string): UrlRefusalReason | null {
  const scheme = SCHEME.exec(input);
  if (scheme === null) return 'invalid-url';
  if (!/^https?$/i.test(scheme[1] as string)) return 'not-http-scheme';
  return /^https?:\/\//i.test(input) ? null : 'ambiguous-authority';
}

function authorityOf(input: string): string {
  const rest = input.slice(input.indexOf('//') + 2);
  const end = rest.search(/[/?#]/);
  return end < 0 ? rest : rest.slice(0, end);
}

function hasSensitiveQuery(url: URL): boolean {
  for (const [key, value] of url.searchParams) {
    if (value !== '' && SENSITIVE_QUERY_NAMES.has(key.toLowerCase())) return true;
  }
  return false;
}

/** Parse one absolute http(s) URL, or say why not. `allowedPorts` is null for no port rule. */
export function parseWebUrl(input: unknown, allowedPorts: readonly number[] | null): UrlParse {
  if (typeof input !== 'string' || input === '' || input.length > MAX_URL_CHARS) return { ok: false, reason: 'invalid-url' };
  if (FORBIDDEN_CHARS.test(input)) return { ok: false, reason: 'ambiguous-authority' };
  const scheme = schemeProblem(input);
  if (scheme !== null) return { ok: false, reason: scheme };
  const authority = authorityOf(input);
  if (authority.includes('@')) return { ok: false, reason: 'userinfo-in-url' };
  if (authority.includes('%')) return { ok: false, reason: 'ambiguous-authority' };
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'userinfo-in-url' };
  const kind = parsed.protocol === 'https:' ? 'https' : parsed.protocol === 'http:' ? 'http' : null;
  if (kind === null) return { ok: false, reason: 'not-http-scheme' };
  const hostText = parsed.hostname.startsWith('[') ? parsed.hostname.toLowerCase() : normalizeHostName(parsed.hostname);
  if (hostText === '') return { ok: false, reason: 'invalid-url' };
  const defaultPort = kind === 'https' ? 443 : 80;
  const port = parsed.port === '' ? defaultPort : Number(parsed.port);
  if (allowedPorts !== null && !allowedPorts.includes(port)) return { ok: false, reason: 'blocked-port' };
  if (hasSensitiveQuery(parsed)) return { ok: false, reason: 'credential-in-query' };
  const hostKind = hostText.startsWith('[') ? 'ipv6' : /^\d+\.\d+\.\d+\.\d+$/.test(hostText) ? 'ipv4' : 'name';
  const canonical = `${kind}://${hostText}${port === defaultPort ? '' : `:${port}`}${parsed.pathname}${parsed.search}`;
  return { ok: true, url: { scheme: kind, host: hostText, hostKind, port, canonical } };
}

/** The absolute address a Location header names, as a string the parser judges again. Null when it cannot be one. */
export function resolveRedirectTarget(base: ParsedWebUrl, location: unknown): string | null {
  if (typeof location !== 'string' || location === '' || location.length > MAX_URL_CHARS || FORBIDDEN_CHARS.test(location)) return null;
  try {
    return new URL(location, base.canonical).href;
  } catch {
    return null;
  }
}

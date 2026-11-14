// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/website_policy.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the policy is a value handed in, with no config file, no shared-file reads and no cache; a malformed policy is refused whole, where upstream failed open; a decision carries a machine-readable reason and the rule that matched; rules are judged in punycode, as the guard sees hosts; a policy not made here is refused
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED (review round 1): an allow-list mode is added, so a policy can confine research to named hosts, and the mode is part of the digest
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The website blocklist (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * A rule is a bare host (it blocks that host and every subdomain) or `*.example.com` (every subdomain, not the
 * parent). A rule written as a URL is cut to its host, and a leading `www.` is dropped, as upstream does, so
 * `www.example.com` blocks the whole domain: the broader reading is the safe one.
 *
 * FAIL CLOSED. Upstream warned and let everything through when its config was malformed, so a typo in the blocklist
 * switched the blocklist off. Here one bad rule refuses the whole policy, `enabled` must be exactly `true` or
 * `false`, and a policy object that this file did not make is refused at the door, so a hand-made `{ enabled: false }`
 * cannot stand in for a policy.
 *
 * TWO MODES. `block` (the default) refuses the listed hosts. `allow` allows only them, and is what a run uses when the
 * owner wants research confined to named sites; it also decides what the research loop may fetch that no search result or
 * question named (see `urlProvenance.ts`).
 *
 * A DECISION IS A VALUE. It says allowed, or not, with a closed reason, the host judged and the rule and source that
 * matched. Pure: no file, no clock.
 */

import { sha256Hex } from '../execution/evidence.js';

export interface WebsiteRule {
  readonly pattern: string;
  readonly source: string;
}

export type WebsiteMode = 'block' | 'allow';

export interface WebsitePolicy {
  readonly enabled: boolean;
  /** `block`: the listed hosts are refused. `allow`: only the listed hosts are allowed. */
  readonly mode: WebsiteMode;
  readonly rules: readonly WebsiteRule[];
  /** Covers everything the policy decides on, so two spellings of one policy have one digest. */
  readonly digest: string;
}

export type WebsiteDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'website-policy'; readonly host: string; readonly rule: string; readonly source: string }
  | { readonly allowed: false; readonly reason: 'unknown-policy' };

export type WebsitePolicyResult = { readonly ok: true; readonly policy: WebsitePolicy } | { readonly ok: false; readonly problems: readonly string[] };

export const MAX_WEBSITE_RULES = 5000;
const MAX_RULE_CHARS = 253;
const MADE_HERE = new WeakSet<object>();

const BARE_HOST = /^[a-z0-9._-]+$/;

/** A rule reduced to a lower-case punycode host or `*.host`. Null for a blank or a comment. A string for a rule that cannot be read. */
function normalizeRule(rule: unknown): { readonly pattern: string } | null | string {
  if (typeof rule !== 'string') return 'a rule is not text';
  let value = rule.trim().toLowerCase();
  if (value === '' || value.startsWith('#')) return null;
  if (value.length > MAX_RULE_CHARS) return 'a rule is longer than a host can be';
  if (value.includes('://')) {
    try {
      value = new URL(value).host;
    } catch {
      return 'a rule that looks like a URL does not parse';
    }
  }
  value = (value.split('/')[0] as string).trim();
  while (value.endsWith('.')) value = value.slice(0, -1);
  if (value.startsWith('www.')) value = value.slice(4);
  const wildcard = value.startsWith('*.');
  const host = wildcard ? value.slice(2) : value;
  let ascii: string;
  try {
    ascii = new URL(`http://${host}/`).hostname;
  } catch {
    return 'a rule is not a host name';
  }
  if (ascii === '' || !BARE_HOST.test(ascii)) return 'a rule is not a host name';
  return { pattern: wildcard ? `*.${ascii}` : ascii };
}

/** Judge a policy before anything uses it. `domains` are rules; `source` says where they came from, for the decision. */
export function createWebsitePolicy(input: unknown, source = 'config'): WebsitePolicyResult {
  const row = input as { enabled?: unknown; domains?: unknown; mode?: unknown } | null;
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return { ok: false, problems: ['the website policy is not an object'] };
  const problems: string[] = [];
  if (typeof row.enabled !== 'boolean') problems.push('enabled must be true or false');
  if (row.mode !== undefined && row.mode !== 'block' && row.mode !== 'allow') problems.push('mode must be block or allow');
  if (!Array.isArray(row.domains)) problems.push('domains must be a list');
  else if (row.domains.length > MAX_WEBSITE_RULES) problems.push(`there are more than ${MAX_WEBSITE_RULES} rules`);
  if (typeof source !== 'string' || source === '' || source.length > 200) problems.push('the source must be a short text');
  const rules: WebsiteRule[] = [];
  if (Array.isArray(row.domains) && row.domains.length <= MAX_WEBSITE_RULES) {
    for (const entry of row.domains) {
      const rule = normalizeRule(entry);
      if (typeof rule === 'string') problems.push(rule);
      else if (rule !== null && !rules.some((held) => held.pattern === rule.pattern)) rules.push({ pattern: rule.pattern, source });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const enabled = row.enabled === true;
  const mode: WebsiteMode = row.mode === 'allow' ? 'allow' : 'block';
  const digest = sha256Hex(JSON.stringify({ enabled, mode, rules: rules.map((rule) => rule.pattern).sort() }));
  const policy: WebsitePolicy = Object.freeze({ enabled, mode, rules: Object.freeze(rules), digest });
  MADE_HERE.add(policy);
  return { ok: true, policy };
}

const matches = (host: string, pattern: string): boolean =>
  pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern || host.endsWith(`.${pattern}`);

/** The decision for one host, as the guard spells it (lower-case, punycode, no trailing dot). */
export function judgeWebsite(policy: WebsitePolicy, host: string): WebsiteDecision {
  if (typeof policy !== 'object' || policy === null || !MADE_HERE.has(policy)) return { allowed: false, reason: 'unknown-policy' };
  if (policy.enabled !== true) return { allowed: true };
  const hit = policy.rules.find((rule) => matches(host, rule.pattern));
  if (policy.mode === 'allow') return hit === undefined ? { allowed: false, reason: 'website-policy', host, rule: 'not-on-allow-list', source: 'allow-list' } : { allowed: true };
  return hit === undefined ? { allowed: true } : { allowed: false, reason: 'website-policy', host, rule: hit.pattern, source: hit.source };
}

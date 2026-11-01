// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/threat_patterns.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; text past the scan limit is refused instead of dropped; every Unicode format character counts as invisible; patterns for the upstream home directory renamed, one added for .projectops
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The threat scan: injection, promptware and exfiltration patterns, as data, with no I/O.
 *
 * Each pattern has a scope, and scopes are cumulative: `all` everywhere, `context` adds promptware and
 * role hijack, `strict` adds the aggressive checks for writes a person can resolve. Memory always scans
 * `strict`.
 *
 * WHAT THE TRANSLATION HAD TO CHANGE. Python's `\w` is Unicode-aware and JavaScript's is ASCII, so a
 * literal `\w` here would let `ignore tüm previous instructions` through a filler written for any
 * script. `WORD` restores the upstream meaning, and the patterns compile with `iu`, because without `u`
 * JavaScript's case-insensitive match does not fold the way Python's does. JavaScript's `\b` stays
 * ASCII even with `u`; next to a non-ASCII letter it matches more often than Python's, which is the
 * safe direction for a scanner.
 *
 * WHAT A CLEAN RESULT MEANS. Nothing: a pattern list cannot prove text is safe. A hit means refuse. A
 * miss means only that no listed pattern matched, so memory stays fenced as untrusted after it passes.
 * NFKC folds full-width variants and does not fold cross-script look-alikes such as Cyrillic `а`.
 */

export const THREAT_SCOPES = ['all', 'context', 'strict'] as const;
export type ThreatScope = (typeof THREAT_SCOPES)[number];

/** Past this, the scan refuses rather than reads. Upstream dropped the tail and passed it unread. */
export const MAX_SCAN_CHARS = 65_536;
export const OVERSIZE_FINDING = 'oversize_unscanned';

const WORD = String.raw`[\p{L}\p{N}_]`;
/** Bounded filler between key attack words. An unbounded repeat backtracks badly. */
const FILLER = String.raw`(?:${WORD}+\s+){0,8}`;
/** An environment reference ending in a secret-like suffix. */
const SECRET_VAR = String.raw`\$\{?${WORD}*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b`;
/** The verb that opens every "modify agent configuration" pattern. */
const MODIFY = String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}`;

const PATTERNS: readonly (readonly [source: string, id: string, scope: ThreatScope])[] = [
  // Classic prompt injection, everywhere.
  [String.raw`ignore\s+${FILLER}(previous|all|above|prior)\s+${FILLER}instructions`, 'prompt_injection', 'all'],
  [String.raw`system\s+prompt\s+override`, 'sys_prompt_override', 'all'],
  [String.raw`disregard\s+${FILLER}(your|all|any)\s+${FILLER}(instructions|rules|guidelines)`, 'disregard_rules', 'all'],
  [String.raw`act\s+as\s+(if|though)\s+${FILLER}you\s+${FILLER}(have\s+no|don't\s+have)\s+${FILLER}(restrictions|limits|rules)`, 'bypass_restrictions', 'all'],
  [String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, 'html_comment_injection', 'all'],
  [String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, 'hidden_div', 'all'],
  [String.raw`translate\s+[^\n]{0,512}\s+into\s+${WORD}+(?:[\s-]+${WORD}+){0,2}\s+and\s+(execute|run|eval)\b`, 'translate_execute', 'all'],
  [String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, 'deception_hide', 'all'],

  // Role-play and identity hijack.
  [String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`, 'role_hijack', 'context'],
  [String.raw`pretend\s+${FILLER}(you\s+are|to\s+be)\s+`, 'role_pretend', 'context'],
  [String.raw`output\s+${FILLER}(system|initial)\s+prompt`, 'leak_system_prompt', 'context'],
  [String.raw`(respond|answer|reply)\s+without\s+${FILLER}(restrictions|limitations|filters|safety)`, 'remove_filters', 'context'],
  [String.raw`you\s+have\s+been\s+${FILLER}(updated|upgraded|patched)\s+to`, 'fake_update', 'context'],
  [String.raw`\bname\s+yourself\s+${WORD}+`, 'identity_override', 'context'],

  // Command-and-control promptware.
  [String.raw`register\s+(as\s+)?a?\s*node`, 'c2_node_registration', 'context'],
  [String.raw`(heartbeat|beacon|check[\s\-]?in)\s+(to|with)\s+`, 'c2_heartbeat', 'context'],
  [String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`, 'c2_task_pull', 'context'],
  [String.raw`connect\s+to\s+the\s+network\b`, 'c2_network_connect', 'context'],
  [String.raw`you\s+must\s+(?:${WORD}+\s+){0,3}(register|connect|report|beacon)\b`, 'forced_action', 'context'],
  [String.raw`only\s+use\s+one[\s\-]?liners?\b`, 'anti_forensic_oneliner', 'context'],
  [String.raw`never\s+${FILLER}(?:create|write)\s+${FILLER}(?:script|file)\s+${FILLER}disk`, 'anti_forensic_disk', 'context'],
  [String.raw`unset\s+${WORD}*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC|PROJECTOS)${WORD}*`, 'env_var_unset_agent', 'context'],

  // Known offensive frameworks.
  [String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`, 'known_c2_framework', 'context'],
  [String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, 'c2_explicit', 'context'],
  [String.raw`\bcommand\s+and\s+control\b`, 'c2_explicit_long', 'context'],

  // Exfiltration.
  [String.raw`curl\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_curl', 'all'],
  [String.raw`wget\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_wget', 'all'],
  [String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, 'read_secrets', 'all'],
  [String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`, 'send_to_url', 'strict'],
  [String.raw`(include|output|print|share)\s+${FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`, 'context_exfil', 'strict'],

  // Persistence.
  [String.raw`authorized_keys`, 'ssh_backdoor', 'strict'],
  [
    String.raw`(?:\b(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)\b|\bopen\s*\(|>>?)[^\n]{0,512}(?:\$HOME/\.ssh|~/\.ssh)`,
    'ssh_access',
    'strict',
  ],
  [String.raw`(?:\$HOME|~)/\.(?:hermes|projectops)/\.env`, 'agent_home_env', 'strict'],
  [String.raw`${MODIFY}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`, 'agent_config_mod', 'strict'],
  [String.raw`${MODIFY}\.hermes/(config\.yaml|SOUL\.md)`, 'agent_home_config_mod', 'strict'],
  [String.raw`${MODIFY}\.projectops/`, 'governance_record_mod', 'strict'],

  // A hardcoded secret. The lookahead skips a value that is itself an environment-variable NAME,
  // case-sensitively: `SHOUTY_SNAKE` says where a credential lives, and does not embed one.
  [
    String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'](?!(?-i:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["'])[A-Za-z0-9+/=_-]{20,}`,
    'hardcoded_secret',
    'strict',
  ],
];

const SCOPES_INCLUDING: Readonly<Record<ThreatScope, readonly ThreatScope[]>> = {
  all: ['all', 'context', 'strict'],
  context: ['context', 'strict'],
  strict: ['strict'],
};

const COMPILED: Readonly<Record<ThreatScope, readonly (readonly [RegExp, string])[]>> = {
  all: compileFor('all'),
  context: compileFor('context'),
  strict: compileFor('strict'),
};

/** Scopes are cumulative: a scan at `strict` runs every pattern, and at `all` only the `all` ones. */
function compileFor(scope: ThreatScope): readonly (readonly [RegExp, string])[] {
  return PATTERNS.filter(([, , own]) => SCOPES_INCLUDING[own].includes(scope)).map(
    ([source, id]) => [new RegExp(source, 'iu'), id] as const,
  );
}

export const THREAT_PATTERN_IDS: readonly string[] = PATTERNS.map(([, id]) => id);

/** Every Unicode format character: zero-width, bidirectional, soft hyphen and the tag block. */
const INVISIBLE = /\p{Cf}/gu;

function invisibleFindings(content: string): readonly string[] {
  const found = new Set(content.match(INVISIBLE) ?? []);
  return [...found]
    .map((character) => (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'))
    .sort()
    .map((hex) => `invisible_unicode_U+${hex}`);
}

/**
 * The matched pattern ids in `content`, and `invisible_unicode_U+XXXX` for each invisible codepoint.
 *
 * Invisibles are checked on the raw text, because NFKC can remove them. Patterns run on the folded text.
 */
export function scanForThreats(content: string, scope: ThreatScope = 'context'): readonly string[] {
  if (content === '') return [];
  const patterns = COMPILED[scope];
  if (patterns === undefined) throw new Error(`scanForThreats: unknown scope '${String(scope)}'`);
  if (content.length > MAX_SCAN_CHARS) return [OVERSIZE_FINDING];
  const folded = content.normalize('NFKC');
  return [...invisibleFindings(content), ...patterns.filter(([regex]) => regex.test(folded)).map(([, id]) => id)];
}

export interface ThreatFinding {
  readonly pattern: string;
  readonly message: string;
}

/** The first threat in `content`, named, or null. */
export function firstThreat(content: string, scope: ThreatScope = 'strict'): ThreatFinding | null {
  const pattern = scanForThreats(content, scope)[0];
  if (pattern === undefined) return null;
  if (pattern === OVERSIZE_FINDING) {
    return { pattern, message: `Blocked: content is longer than the ${MAX_SCAN_CHARS} characters the scan reads.` };
  }
  if (pattern.startsWith('invisible_unicode_')) {
    const codepoint = pattern.slice('invisible_unicode_'.length);
    return { pattern, message: `Blocked: content contains invisible unicode character ${codepoint} (possible injection).` };
  }
  return { pattern, message: `Blocked: content matches threat pattern '${pattern}'.` };
}

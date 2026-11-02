// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/redact.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: translated from Python to TypeScript; a short list of the prefix, assignment, header, key-block and JWT patterns only, leaving out every passage upstream marks as ported from elsewhere; a quoted value is taken whole; hidden characters are removed before redaction, so one cannot split a secret past it
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: configured values, JSON fields and passwords in any URL added for the summariser; the assignment and header patterns no longer judge a draft
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * What must not reach a summariser, or survive into a summary.
 *
 * A summary replays into every later turn and goes to whichever model writes it, so a key that reaches one has
 * reached that model and every prompt after it. This is a pattern list: a credential of no known shape passes,
 * and the agent's own vocabulary is still run by whoever wires this in.
 *
 * TWO LISTS, FOR TWO COSTS. Redacting a turn for the summariser costs a value it did not need, so that pass is
 * broad. Refusing a summary costs the compaction, and `PASS=12` or `TOKEN_LIMIT=4096` is honest text, so a draft
 * is held only to the shapes that are a credential on their face: a known prefix, a key block, a JWT. Pure.
 */
import { foldMemoryLines } from '../memory/store.js';

const REDACTED = '[REDACTED]';
const SECRET_PREFIXES = [
  String.raw`sk-[A-Za-z0-9_-](?:\.?[A-Za-z0-9_-]){9,}`,
  String.raw`ghp_[A-Za-z0-9]{10,}`,
  String.raw`github_pat_[A-Za-z0-9_]{10,}`,
  String.raw`gh[ousr]_[A-Za-z0-9]{10,}`,
  String.raw`xapp-\d+-[A-Za-z0-9-]{10,}`,
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,
  String.raw`AIza[A-Za-z0-9_-]{30,}`,
  String.raw`AKIA[A-Z0-9]{16}`,
  String.raw`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}`,
  String.raw`SG\.[A-Za-z0-9_-]{10,}`,
  String.raw`hf_[A-Za-z0-9]{10,}`,
  String.raw`npm_[A-Za-z0-9]{10,}`,
  String.raw`pypi-[A-Za-z0-9_-]{10,}`,
];
const PREFIXED = new RegExp(`(?<![A-Za-z0-9_-])(?:${SECRET_PREFIXES.join('|')})`, 'g');
const SECRET_NAMES = 'API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PW|CREDENTIAL|AUTH';
const ASSIGNED = new RegExp(String.raw`(?<![A-Z0-9_])((?:[A-Z0-9_]{0,50}_)?(?:${SECRET_NAMES})(?:_[A-Z0-9_]{0,50})?\s*=\s*)(?:"[^"\n]*"|'[^'\n]*'|\S+)`, 'g');
const CONFIGURED = /(?<![A-Za-z])((?:password|passwd|pwd|passphrase|secret|credential|token|api[ _.-]?key)(?:[_.-][A-Za-z0-9_.-]*)?\s*:\s*)(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi;
const JSON_FIELD = /("[A-Za-z0-9_.-]*(?:api_?key|token|secret|password|passwd|credential)[A-Za-z0-9_.-]*"\s*:\s*)"(?:[^"\\\n]|\\.)*"/gi;
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;
const AUTH_HEADER = /((?:Proxy-)?Authorization:\s*)([A-Za-z][\w.+-]*\s+)?[^\s"']+/gi;
const PRIVATE_KEY = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;
const JWT = /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g;
/** Everything memory calls invisible, and a broken surrogate. A newline and a tab are ordinary text. */
const HIDDEN = /(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/gu;

/** The shapes that are a credential on their face. */
function redactShapes(text: string): string {
  return text.replace(PRIVATE_KEY, REDACTED).replace(JWT, REDACTED).replace(PREFIXED, REDACTED);
}

export function redactSecrets(text: string): string {
  return redactShapes(text)
    .replace(AUTH_HEADER, `$1$2${REDACTED}`)
    .replace(ASSIGNED, `$1${REDACTED}`)
    .replace(JSON_FIELD, `$1"${REDACTED}"`)
    .replace(CONFIGURED, `$1${REDACTED}`)
    .replace(URL_PASSWORD, `$1${REDACTED}@`);
}

/** What a draft is held to. The broader patterns are for input only. */
export function holdsSecretShape(text: string): boolean {
  return redactShapes(text) !== text;
}

/** A turn as a summariser may read it. */
export function cleanForSummariser(text: string): string {
  return redactSecrets(foldMemoryLines(text).replace(HIDDEN, ''));
}

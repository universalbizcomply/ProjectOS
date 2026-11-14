// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/cronjob_prompt_scan.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the shared threat scan runs first, so invisible characters, comments and oversize text are refused as they are for memory; the repeated filler in the injection patterns is bounded; Unicode word characters restored; the GitHub Authorization-header exemption and the assembled-prompt scan were not ported, because nothing here loads a skill, and refusing more is the safe side
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: the command-shaped patterns are judged a line at a time with simple tests joined by "and", where upstream nests two bounded repeats in one expression, so the work is linear in the prompt; the prompt is capped at the record's limit before any scan; PowerShell environment variables, Get-Content and type of an environment file, and a download piped into a shell were added; common Cyrillic and Greek lookalike letters are folded to Latin before matching
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The routine prompt scan: what a routine's prompt may not say, checked when the record is read.
 *
 * A routine runs with nobody watching, so its prompt is read once, by a person, when the record is made, and then
 * runs on its own for as long as the schedule lasts. A prompt that matches is refused when the record is read. Upstream
 * also scans at run time; here an admitted record is frozen and cannot change after it is read, and the wiring that
 * reads a record from a file has to admit it again, which scans again.
 *
 * THREE SCANS, IN THIS ORDER. The shared threat scan (invisible characters, comments, oversize text, injection,
 * exfiltration); the same scan again over the prompt with lookalike letters folded to Latin, so `ignоre` written with a
 * Cyrillic `о` is the directive it looks like; then the command-shaped patterns upstream keeps for cron prompts, with
 * the PowerShell, pipe-to-shell and command-substitution shapes added. A directive-shaped prompt has no business containing `cat ~/.env` or
 * `rm -rf /`: there it is a smoking gun, not prose. Several of these overlap the shared scan; they stay, as data, so a
 * change to one list never silently narrows the other.
 *
 * BOUNDED WORK. The prompt is capped before any scan, and each command-shaped rule is a few simple tests over one line,
 * never a long expression with two bounded repeats nested in it, so a hostile prompt costs time in proportion to its
 * length. The folding map is explicit and still small; it is not a confusables database, and a lookalike it does not list
 * passes.
 *
 * WHAT A CLEAN RESULT MEANS. Nothing but that no listed pattern matched. A pattern list cannot prove a prompt is safe,
 * so an unattended run stays held to P2 and below by `admitUnattendedAction` whatever its prompt says.
 *
 * Pure: no I/O.
 */
import { OVERSIZE_FINDING, firstThreat } from '../memory/threatScan.js';

export interface RoutinePromptFinding {
  readonly pattern: string;
  readonly message: string;
}

/** The longest routine prompt. A record's prompt is held to the same length, so the two cannot drift. */
export const MAX_ROUTINE_PROMPT_CHARS = 8000;

const WORD = String.raw`[\p{L}\p{N}_]`;
/** Bounded filler between key words. Upstream's unbounded repeat backtracks badly in JavaScript. */
const FILLER = String.raw`(?:${WORD}+\s+){0,8}`;
/** An environment reference ending in a secret-like word, in the shell or the PowerShell way. */
const SECRET_VAR = String.raw`\$(?:env:)?\{?${WORD}{0,64}(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`;

type Rule = readonly [id: string, tests: readonly RegExp[]];

const re = (source: string): RegExp => new RegExp(source, 'iu');
const CURL = re(String.raw`\bcurl\s`);
const WGET = re(String.raw`\bwget\s`);

/**
 * The command-shaped patterns. A rule matches when every test matches somewhere in the same line, which is looser
 * than upstream's ordered expression and only ever refuses more.
 */
const RULES: readonly Rule[] = [
  ['prompt_injection', [re(String.raw`ignore\s+${FILLER}(?:previous|all|above|prior)\s+${FILLER}instructions`)]],
  ['deception_hide', [re(String.raw`do\s+not\s+tell\s+the\s+user`)]],
  ['sys_prompt_override', [re(String.raw`system\s+prompt\s+override`)]],
  ['disregard_rules', [re(String.raw`disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)`)]],
  ['read_secrets', [re(String.raw`\bcat\s`), re(String.raw`(?:\.env|credentials|\.netrc|\.pgpass|id_rsa|id_ed25519|id_ecdsa)`)]],
  ['read_secrets_powershell', [re(String.raw`\b(?:get-content|gc|type)\s+\S{0,260}\.env\b`)]],
  ['ssh_backdoor', [re('authorized_keys')]],
  ['sudoers_mod', [re(String.raw`/etc/sudoers|visudo`)]],
  ['destructive_root_rm', [re(String.raw`rm\s+-rf\s+/`)]],
  ['exfil_curl_url', [CURL, re(String.raw`https?://[^\s"'\x60]{0,2048}${SECRET_VAR}`)]],
  ['exfil_wget_url', [WGET, re(String.raw`https?://[^\s"'\x60]{0,2048}${SECRET_VAR}`)]],
  ['exfil_curl_data', [CURL, re(String.raw`(?:^|\s)(?:--data(?:-raw|-binary|-urlencode)?|-d|--form|-F)(?:\s|=)`), re(SECRET_VAR)]],
  ['exfil_wget_post', [WGET, re(String.raw`--post-(?:data|file)=`), re(SECRET_VAR)]],
  ['exfil_curl_auth_header', [CURL, re(String.raw`(?:-H|--header)\s+["']Authorization:\s*(?:Bearer|token)\s+${SECRET_VAR}`)]],
  ['exfil_powershell_request', [re(String.raw`\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b`), re(SECRET_VAR)]],
  ['powershell_eval_environment', [re(String.raw`\b(?:iex|invoke-expression)\b`), re(String.raw`\$env:`)]],
  // One test each, so they are judged over the whole text and a pipe or a substitution may cross a line break.
  [
    'pipe_to_shell',
    [re(String.raw`\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]{0,2048}\|\s*(?:(?:sudo|env)\s+)?(?:(?:ba|z|da|k|c)?sh|iex|invoke-expression)\b`)],
  ],
  [
    'download_into_shell_substitution',
    [re(String.raw`\b(?:(?:ba|z|da|k|c)?sh|eval|source)\s+[^\n]{0,64}(?:\$\(|\x60|<\()\s*(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b`)],
  ],
];

/** Lookalike letters that Latin-script patterns would miss, as [code point, Latin letter]. Explicit, and small. */
const LOOKALIKES: readonly (readonly [string, string])[] = [
  // Cyrillic, lower case
  ['0430', 'a'], ['0435', 'e'], ['043E', 'o'], ['0440', 'p'], ['0441', 'c'], ['0445', 'x'], ['0443', 'y'], ['0456', 'i'],
  ['0458', 'j'], ['0455', 's'], ['0501', 'd'], ['04CF', 'l'], ['051B', 'q'], ['051D', 'w'],
  // Cyrillic, upper case
  ['0410', 'A'], ['0412', 'B'], ['0415', 'E'], ['041A', 'K'], ['041C', 'M'], ['041D', 'H'], ['041E', 'O'], ['0420', 'P'],
  ['0421', 'C'], ['0422', 'T'], ['0425', 'X'], ['0423', 'Y'],
  // Greek, lower case
  ['03B1', 'a'], ['03B5', 'e'], ['03B9', 'i'], ['03BA', 'k'], ['03BD', 'v'], ['03BF', 'o'], ['03C1', 'p'], ['03C4', 't'],
  ['03C5', 'u'], ['03C7', 'x'],
  // Greek, upper case
  ['0391', 'A'], ['0392', 'B'], ['0395', 'E'], ['0396', 'Z'], ['0397', 'H'], ['0399', 'I'], ['039A', 'K'], ['039C', 'M'],
  ['039D', 'N'], ['039F', 'O'], ['03A1', 'P'], ['03A4', 'T'], ['03A5', 'Y'], ['03A7', 'X'],
  // The rest of the common Cyrillic and Greek ones, lower case: h k m n t v y
  ['04BB', 'h'], ['043A', 'k'], ['043C', 'm'], ['043F', 'n'], ['03B7', 'n'], ['0442', 't'], ['0475', 'v'], ['04AF', 'y'],
  // IPA, small-capital and other lookalikes: a c g i j s u y
  ['0251', 'a'], ['03F2', 'c'], ['1D04', 'c'], ['0261', 'g'], ['050D', 'g'], ['0131', 'i'], ['0269', 'i'], ['03F3', 'j'],
  ['A731', 's'], ['1D1C', 'u'], ['028F', 'y'],
  // Upper case: G H I J Q S W
  ['050C', 'G'], ['04BA', 'H'], ['0406', 'I'], ['0408', 'J'], ['051A', 'Q'], ['0405', 'S'], ['051C', 'W'],
];
const LOOKALIKE_MAP: ReadonlyMap<string, string> = new Map(LOOKALIKES.map(([code, latin]) => [String.fromCodePoint(Number.parseInt(code, 16)), latin]));

/** The text with lookalike letters folded to Latin. Exported so the map can be proved letter by letter. */
export function foldLookalikes(text: string): string {
  return Array.from(text, (character) => LOOKALIKE_MAP.get(character) ?? character).join('');
}

const finding = (id: string): RoutinePromptFinding => ({
  pattern: id,
  message: `Blocked: prompt matches threat pattern '${id}'. Routine prompts must not contain injection or exfiltration payloads.`,
});

/** The first thing wrong with a routine's prompt, or null when no pattern matched. */
export function scanRoutinePrompt(prompt: string): RoutinePromptFinding | null {
  if (prompt.length > MAX_ROUTINE_PROMPT_CHARS) {
    return { pattern: OVERSIZE_FINDING, message: `Blocked: prompt is longer than the ${MAX_ROUTINE_PROMPT_CHARS} characters a routine prompt may have.` };
  }
  const shared = firstThreat(prompt, 'strict');
  if (shared !== null) return shared;
  const folded = foldLookalikes(prompt.normalize('NFKC'));
  const foldedShared = firstThreat(folded, 'strict');
  if (foldedShared !== null) return foldedShared;
  const lines = folded.split('\n');
  for (const [id, tests] of RULES) {
    // A rule of one test may span lines, as upstream's expressions do; a rule of several is judged line by line.
    const matched = tests.length === 1 ? tests.every((test) => test.test(folded)) : lines.some((line) => tests.every((test) => test.test(line)));
    if (matched) return finding(id);
  }
  return null;
}

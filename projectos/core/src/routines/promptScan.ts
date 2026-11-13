// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/cronjob_prompt_scan.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the shared threat scan runs first, so invisible characters, comments and oversize text are refused as they are for memory; the repeated filler in the injection patterns is bounded; Unicode word characters restored; the GitHub Authorization-header exemption and the assembled-prompt scan were not ported, because nothing here loads a skill, and refusing more is the safe side
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The routine prompt scan: what a routine's prompt may not say, checked when the record is approved.
 *
 * A routine runs with nobody watching, so its prompt is read once, by the owner, at approval, and then
 * runs on its own for as long as the schedule lasts. A prompt that matches is refused at approval. Upstream
 * also scans at run time; here an admitted record is frozen and cannot change after approval, and the
 * wiring that reads a record from a file has to admit it again, which scans again.
 *
 * TWO SCANS, IN THIS ORDER. The shared threat scan (invisible characters, comments, oversize text,
 * injection, exfiltration) first; then the command-shaped patterns upstream keeps for cron prompts. A
 * directive-shaped prompt has no business containing `cat ~/.env` or `rm -rf /`: there it is a smoking gun,
 * not prose. Several of these patterns overlap the shared scan; they stay, as data, so a change to one list
 * never silently narrows the other.
 *
 * WHAT A CLEAN RESULT MEANS. Nothing but that no listed pattern matched. A pattern list cannot prove a
 * prompt is safe, so an unattended run stays held to P2 and below by `admitUnattendedAction` whatever its
 * prompt says.
 *
 * Pure: no I/O.
 */
import { firstThreat } from '../memory/threatScan.js';

export interface RoutinePromptFinding {
  readonly pattern: string;
  readonly message: string;
}

const WORD = String.raw`[\p{L}\p{N}_]`;
/** Bounded filler between key words. Upstream's unbounded repeat backtracks badly in JavaScript. */
const FILLER = String.raw`(?:${WORD}+\s+){0,8}`;
const SECRET_VAR = String.raw`\$\{?${WORD}*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)${WORD}*\}?`;
const LINE = String.raw`[^\n]{0,2048}`;

/** The command-shaped patterns upstream scans a routine's own prompt for. */
const CRON_PATTERNS: readonly (readonly [source: string, id: string])[] = [
  [String.raw`ignore\s+${FILLER}(?:previous|all|above|prior)\s+${FILLER}instructions`, 'prompt_injection'],
  [String.raw`do\s+not\s+tell\s+the\s+user`, 'deception_hide'],
  [String.raw`system\s+prompt\s+override`, 'sys_prompt_override'],
  [String.raw`disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)`, 'disregard_rules'],
  [String.raw`cat\s+${LINE}(?:\.env|credentials|\.netrc|\.pgpass|id_rsa|id_ed25519|id_ecdsa)`, 'read_secrets'],
  [String.raw`authorized_keys`, 'ssh_backdoor'],
  [String.raw`/etc/sudoers|visudo`, 'sudoers_mod'],
  [String.raw`rm\s+-rf\s+/`, 'destructive_root_rm'],
  [String.raw`curl\s+${LINE}https?://[^\s"'\x60]*${SECRET_VAR}`, 'exfil_curl_url'],
  [String.raw`wget\s+${LINE}https?://[^\s"'\x60]*${SECRET_VAR}`, 'exfil_wget_url'],
  [String.raw`curl\s+${LINE}(?:--data(?:-raw|-binary|-urlencode)?|-d|--form|-F)\s+${LINE}${SECRET_VAR}`, 'exfil_curl_data'],
  [String.raw`wget\s+${LINE}--post-(?:data|file)=${LINE}${SECRET_VAR}`, 'exfil_wget_post'],
  [String.raw`curl\s+${LINE}(?:-H|--header)\s+["']Authorization:\s*(?:Bearer|token)\s+${SECRET_VAR}["']`, 'exfil_curl_auth_header'],
];

const COMPILED: readonly (readonly [RegExp, string])[] = CRON_PATTERNS.map(([source, id]) => [new RegExp(source, 'iu'), id] as const);

/** The first thing wrong with a routine's prompt, or null when no pattern matched. */
export function scanRoutinePrompt(prompt: string): RoutinePromptFinding | null {
  const shared = firstThreat(prompt, 'strict');
  if (shared !== null) return shared;
  const folded = prompt.normalize('NFKC');
  for (const [pattern, id] of COMPILED) {
    if (pattern.test(folded)) {
      return { pattern: id, message: `Blocked: prompt matches threat pattern '${id}'. Routine prompts must not contain injection or exfiltration payloads.` };
    }
  }
  return null;
}

// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-approval-text-sanitize.ts; src/infra/exec-approval-command-display.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the display rule is taken, that the command text an owner is asked about has every invisible or spoofing character written out as an escape and is bounded in length; the request payload types, the preview field, the node and system-run plan branches and the warning prose helpers are cut; the text is built from a prepared command, so it shows the argument list as asked and as launched, each word on its own so a boundary between two words is visible, with the working directory, the environment names and the hash
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The text an owner reads before deciding on a command: exact, escaped and bounded.
 *
 * THE OWNER READS WHAT RUNS. A command shown with a zero-width space, a right-to-left mark, a look-alike space or a control
 * character reads as a different command from the one that runs. So every invisible or spoofing character is written as
 * `\u{HEX}`, every word that holds a space or a quote is shown quoted so the boundary between two words is visible, and text
 * past the cap is cut with a marker. The display carries the hash the decision will be bound to, so what was read and what is
 * bound are the same command.
 *
 * Pure: no I/O.
 */
import type { PreparedExec } from './execCommand.js';
import { isPreparedExec } from './execCommand.js';

export const MAX_DISPLAY_INPUT_CHARS = 256 * 1024;
export const MAX_DISPLAY_OUTPUT_CHARS = 16 * 1024;
export const TRUNCATION_MARKER = '...[truncated]';
export const OVERSIZED_MARKER = '[command exceeds the display size limit; full text suppressed]';

const SPOOFING_POINTS = [0x00a0, 0x1680, 0x115f, 0x1160, 0x3164, 0xffa0, 0x202f, 0x205f, 0x3000];
const SPOOFING_RANGES: readonly (readonly [number, number])[] = [[0x2000, 0x200a]];
const INVISIBLE = new RegExp(
  `[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}${SPOOFING_POINTS.map((point) => String.fromCodePoint(point)).join('')}${SPOOFING_RANGES.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join('')}]`,
  'gu',
);

export interface ExecDisplayText {
  readonly text: string;
  readonly truncated: boolean;
  readonly oversized: boolean;
}

/** Text with every invisible or spoofing character written out, cut to the cap. Source: `sanitizeExecApprovalDisplayTextWithStatus`. */
export function sanitizeExecDisplayText(text: string): ExecDisplayText {
  if (text.length > MAX_DISPLAY_INPUT_CHARS) return { text: OVERSIZED_MARKER, truncated: false, oversized: true };
  const escaped = text.replace(INVISIBLE, (char) => `\\u{${(char.codePointAt(0) ?? 0xfffd).toString(16).toUpperCase()}}`);
  if (escaped.length <= MAX_DISPLAY_OUTPUT_CHARS) return { text: escaped, truncated: false, oversized: false };
  return { text: escaped.slice(0, MAX_DISPLAY_OUTPUT_CHARS) + TRUNCATION_MARKER, truncated: true, oversized: false };
}

/** A word as it is shown: bare when it is plain, in JSON quotes when it holds a space, a quote, a backslash or nothing. */
const shown = (word: string): string => (word !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : JSON.stringify(word));
const lineOf = (words: readonly string[]): string => words.map(shown).join(' ');

export interface ExecDisplay {
  readonly asked: ExecDisplayText;
  readonly runs: ExecDisplayText;
  readonly cwd: ExecDisplayText;
  readonly envNames: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly syntax: readonly string[];
  readonly launchers: readonly string[];
  readonly tenant: string;
  readonly project: string;
  readonly hash: string;
}

/** What to show the owner for one prepared command, or `null` when the value is not one the reader prepared. */
export function describeExecForOwner(prepared: PreparedExec): ExecDisplay | null {
  if (!isPreparedExec(prepared)) return null;
  return Object.freeze({
    asked: sanitizeExecDisplayText(lineOf(prepared.sourceArgv)),
    runs: sanitizeExecDisplayText(lineOf(prepared.argv)),
    cwd: sanitizeExecDisplayText(JSON.stringify(prepared.cwd)),
    envNames: prepared.envNames,
    timeoutMs: prepared.timeoutMs,
    maxOutputBytes: prepared.maxOutputBytes,
    syntax: prepared.features,
    launchers: prepared.wrapperChain,
    tenant: prepared.tenant,
    project: prepared.project,
    hash: prepared.hash,
  });
}

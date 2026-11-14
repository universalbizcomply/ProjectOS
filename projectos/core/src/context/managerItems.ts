// Origin: original ProjectOS code
/**
 * THE GATE EVERY STORED TEXT PASSES BEFORE A WORKER MAY SEE IT (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * STORED TEXT IS DATA, NEVER AUTHORITY. A decision, a plan note, an execution record or a search hit was written by someone, and
 * some of it by a worker. So before any of it reaches the context file it is judged here, the same way `loadMemoryBlock` judges
 * a memory entry: the strict threat scan (which also finds hidden text: invisible characters, comments and link references that
 * render as nothing), and a credential screen. The screen is a PORT, because the agent's vocabulary of credentials lives there;
 * core asks its own list as well, so a shape either one knows is refused. A screen that is missing, throws, or answers anything
 * but exactly `false` refuses: it fails closed.
 *
 * SIZE IS BOUNDED TWICE, BEFORE ANYTHING ELSE RUNS. A text over `MAX_CONTEXT_ITEM_SOURCE_BYTES` is not read at all. What is
 * shown is an excerpt held to `MAX_CONTEXT_ITEM_CHARS` characters AND `MAX_CONTEXT_ITEM_BYTES` bytes, cut between whole code
 * points and marked with how much it is, and the scans read the excerpt, so the cost is set by the cap and not by the text. The
 * hash is of the WHOLE text, so the evidence names exactly what was stored even where only an excerpt was shown.
 *
 * A refusal is a value with a closed code, and it quotes none of the text. Pure.
 */
import { sha256Hex } from '../execution/evidence.js';
import { scanForThreats } from '../memory/threatScan.js';
import { sensitiveContentProblem } from '../search/sensitiveContent.js';

export const MAX_CONTEXT_ITEM_CHARS = 6000;
export const MAX_CONTEXT_ITEM_BYTES = 16_000;
export const MAX_CONTEXT_ITEM_SOURCE_BYTES = 262_144;

export type ContextItemGateCode =
  | 'CONTEXT_ITEM_NOT_TEXT'
  | 'CONTEXT_ITEM_EMPTY'
  | 'CONTEXT_ITEM_TOO_LARGE'
  | 'CONTEXT_ITEM_HIDDEN_TEXT'
  | 'CONTEXT_ITEM_THREAT'
  | 'CONTEXT_ITEM_CREDENTIAL'
  | 'CONTEXT_ITEM_SCREEN_MISSING';

export type ContextItemGate =
  | {
      readonly ok: true;
      /** What may be shown: the whole text, or an excerpt that says it is one. */
      readonly text: string;
      /** `sha256:` and the hash of the WHOLE stored text. */
      readonly contentHash: string;
      /** The UTF-8 size of `text`. */
      readonly bytes: number;
      readonly truncated: boolean;
      /** The length of the whole text in UTF-16 units, so an excerpt can say what it is of. */
      readonly originalChars: number;
    }
  | { readonly ok: false; readonly code: ContextItemGateCode; readonly contentHash: string | null };

/** Findings that mean text a reader would not see, as against text that says something. */
const HIDDEN_FINDINGS = new Set(['html_comment', 'html_comment_injection', 'markdown_comment', 'markdown_reference_comment', 'markdown_reference_title', 'hidden_div']);
const isHiddenFinding = (finding: string): boolean => finding.startsWith('invisible_unicode_') || HIDDEN_FINDINGS.has(finding);

const UTF8 = new TextEncoder();
const byteLength = (text: string): number => UTF8.encode(text).length;

const refuse = (code: ContextItemGateCode, contentHash: string | null = null): ContextItemGate => ({ ok: false, code, contentHash });

/** The longest start of `text` within both caps, cut between code points. */
function excerptOf(text: string): string {
  let used = 0;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const cost = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (used + 1 > MAX_CONTEXT_ITEM_CHARS || bytes + cost > MAX_CONTEXT_ITEM_BYTES) break;
    used += 1;
    bytes += cost;
    end += character.length;
  }
  return text.slice(0, end);
}

/** Exactly `false` from a screen that exists and does not throw; core's own vocabulary is asked as well. */
function holdsCredential(screen: (text: string) => unknown, text: string): boolean {
  try {
    if (screen(text) !== false) return true;
  } catch {
    return true;
  }
  return sensitiveContentProblem(text) !== null;
}

/** Judge one stored text. The whole text is hashed; only the excerpt is scanned, and only the excerpt can be shown. */
export function gateContextItemText(raw: unknown, secretScreen: unknown): ContextItemGate {
  if (typeof raw !== 'string') return refuse('CONTEXT_ITEM_NOT_TEXT');
  // Every UTF-16 unit is at least one byte, so a text longer than the cap is over it without encoding it.
  if (raw.length > MAX_CONTEXT_ITEM_SOURCE_BYTES || byteLength(raw) > MAX_CONTEXT_ITEM_SOURCE_BYTES) return refuse('CONTEXT_ITEM_TOO_LARGE');
  const contentHash = `sha256:${sha256Hex(raw)}`;
  if (raw.trim() === '') return refuse('CONTEXT_ITEM_EMPTY', contentHash);
  if (typeof secretScreen !== 'function') return refuse('CONTEXT_ITEM_SCREEN_MISSING', contentHash);

  const shown = excerptOf(raw);
  const truncated = shown.length < raw.length;
  const findings = scanForThreats(shown, 'strict');
  if (findings.some(isHiddenFinding)) return refuse('CONTEXT_ITEM_HIDDEN_TEXT', contentHash);
  if (findings.length > 0) return refuse('CONTEXT_ITEM_THREAT', contentHash);
  if (holdsCredential(secretScreen as (text: string) => unknown, shown)) return refuse('CONTEXT_ITEM_CREDENTIAL', contentHash);

  const text = truncated ? `${shown}\n[excerpt: the first ${[...shown].length} of ${[...raw].length} characters; the rest stays in the stored file]` : shown;
  return { ok: true, text, contentHash, bytes: byteLength(text), truncated, originalChars: raw.length };
}

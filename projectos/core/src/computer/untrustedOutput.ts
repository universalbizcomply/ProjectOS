// Origin: original ProjectOS code
/**
 * What a computer sends back is data, cleaned, fenced, bounded and labelled.
 *
 * OUTPUT IS DATA, NEVER AN INSTRUCTION. What a command printed, what a screenshot read out of a page and what a page said are
 * written by whoever controls the command, the page or the file, so they are untrusted. They are cleaned of ANSI escape
 * sequences, control characters and hidden or bidirectional characters (so nothing is shown that a person would not see, and
 * nothing is reordered), bounded to a fixed number of characters, labelled `untrusted-data`, and wrapped in a fence whose
 * name is the SHA-256 of the exact text it holds. A body cannot close its own fence, because the fence it would have to write
 * is the hash of text that includes the fence, and there is no fixed point to find.
 *
 * ONLY THE FENCED FORM LEAVES. A caller is handed the framed text and its length, never the bare body, so no caller can use
 * the text without its fence.
 *
 * Pure: no I/O.
 */
import { digestOfText } from './canonicalJson.js';
import { cleanTerminalText } from './hiddenText.js';

export const MAX_FENCED_CHARS = 64 * 1024;
export const OUTPUT_KINDS = ['stdout', 'stderr', 'screenshot-text', 'page-text'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export interface FencedOutput {
  readonly trust: 'untrusted-data';
  readonly kind: OutputKind;
  readonly fence: string;
  readonly truncated: boolean;
  /** The length of the cleaned body, in characters. */
  readonly length: number;
  /** The body between its fence lines, ready to hand to a model as data. */
  readonly framed: string;
}

/** The text, cleaned, cut to the cap and fenced. Anything that is not text is the empty body, not an error that leaks it. */
export function fenceUntrustedOutput(kind: OutputKind, text: unknown): FencedOutput {
  const whole = cleanTerminalText(typeof text === 'string' ? text : '');
  const truncated = whole.length > MAX_FENCED_CHARS;
  const body = truncated ? whole.slice(0, MAX_FENCED_CHARS) : whole;
  const fence = `computer-output:${digestOfText(body)}`;
  return Object.freeze({
    trust: 'untrusted-data',
    kind,
    fence,
    truncated,
    length: body.length,
    framed: `<<${fence} kind=${kind} trust=untrusted-data>>\n${body}\n<</${fence}>>`,
  });
}

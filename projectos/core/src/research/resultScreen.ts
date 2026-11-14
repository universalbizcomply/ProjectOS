// Origin: original ProjectOS code
/**
 * Search results are untrusted text, screened before anyone sees them (PROJECTOS-PORT-RESEARCH1A, fix round).
 *
 * A search provider's titles, snippets and addresses come from the web, and they reach a planner. So each one is
 * judged before it is shown:
 *   - TAG CHARACTERS (U+E0000 to U+E007F) and BIDI CONTROLS (U+202A to U+202E, U+2066 to U+2069) are never in an honest
 *     title, and they hide text from a reader while a model can still read it: the result is DROPPED, with why.
 *   - ZERO-WIDTH and other invisible characters are stripped, so `<|im_<ZWSP>start|>` becomes the token it spells.
 *   - Model special tokens and spoofed boundaries are replaced, as for a page (`sanitizeExternalContentText`).
 *   - `scanForThreats` runs on EVERY title, snippet and address, after the stripping. A hit DROPS the result.
 *
 * What is dropped is recorded as an index and a closed reason, and the pattern ids that fired. The text is never repeated.
 *
 * WHAT THIS CANNOT PROVE. A clean result means no listed pattern matched. Results reach a planner fenced as untrusted, and
 * an address in one is still only offered to the fetch rules (`urlProvenance.ts`), which decide whether it may be fetched.
 */

import { scanForThreats } from '../memory/threatScan.js';
import { sanitizeExternalContentText } from './externalContent.js';
import { stripInvisibleUnicode } from './readableText.js';
import type { SearchResult } from './searchProvider.js';

export type DropReason = 'hidden-characters' | 'threat-scan';

export interface DroppedResult {
  readonly index: number;
  readonly why: DropReason;
  /** The threat pattern ids that fired. Never the text. */
  readonly named: readonly string[];
}

export interface ScreenedResults {
  readonly kept: readonly SearchResult[];
  readonly dropped: readonly DroppedResult[];
}

const range = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
/** Characters that hide text from a reader and not from a model. Built from code points, so no raw control text is in this file. */
const HIDDEN = new RegExp(`[${range(0xe0000, 0xe007f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`, 'u');

const FIELDS = ['title', 'snippet', 'url'] as const;

export function screenSearchResults(results: readonly SearchResult[]): ScreenedResults {
  const kept: SearchResult[] = [];
  const dropped: DroppedResult[] = [];
  results.forEach((result, index) => {
    if (FIELDS.some((field) => HIDDEN.test(result[field]))) {
      dropped.push({ index, why: 'hidden-characters', named: [] });
      return;
    }
    const clean = { title: stripInvisibleUnicode(result.title), snippet: stripInvisibleUnicode(result.snippet), url: stripInvisibleUnicode(result.url) };
    const named = [...new Set(FIELDS.flatMap((field) => scanForThreats(clean[field], 'context')))];
    if (named.length > 0) {
      dropped.push({ index, why: 'threat-scan', named });
      return;
    }
    kept.push({ title: sanitizeExternalContentText(clean.title), snippet: sanitizeExternalContentText(clean.snippet), url: clean.url });
  });
  return { kept, dropped };
}

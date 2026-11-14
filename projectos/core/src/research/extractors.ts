// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/web-fetch/content-extractors.runtime.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: the plugin registry and config are replaced by a list handed in; the first extractor that returns text still wins, but a failing extractor is recorded by id, where upstream swallowed it, and what an extractor returns is judged (text, a bounded length) before it is used; the default extractor is the in-repo tag scanner
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Readable-content extractors, tried in order (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * An extractor is a function, so a real Readability can be plugged in by a later phase without a dependency here.
 * Extraction is best effort across extractors: one that throws does not stop the next, and the failure is reported by
 * id so a broken extractor is visible and not silent. What an extractor returns is data from a page: it must be text,
 * and it is cut to a bounded length before anything else reads it.
 */

import { extractReadableText, type ReadableContent } from './readableText.js';

export const MAX_EXTRACTED_CHARS = 400_000;

export interface WebContentExtractor {
  readonly id: string;
  readonly extract: (request: { readonly html: string; readonly url: string }) => Promise<ReadableContent | null | undefined> | ReadableContent | null | undefined;
}

export const READABLE_TEXT_EXTRACTOR: WebContentExtractor = {
  id: 'readable-text',
  extract: ({ html }) => extractReadableText(html),
};

export interface ExtractionOutcome {
  readonly content: (ReadableContent & { readonly extractor: string }) | null;
  /** The ids of extractors that threw or answered with something that is not text. */
  readonly failed: readonly string[];
}

/** Run the extractors until one returns readable text. */
export async function extractReadableContent(extractors: readonly WebContentExtractor[], request: { readonly html: string; readonly url: string }): Promise<ExtractionOutcome> {
  const failed: string[] = [];
  for (const extractor of extractors) {
    let result: ReadableContent | null | undefined;
    try {
      result = await extractor.extract(request);
    } catch {
      failed.push(extractor.id);
      continue;
    }
    if (result === null || result === undefined) continue;
    if (typeof result.text !== 'string' || (result.title !== undefined && typeof result.title !== 'string')) {
      failed.push(extractor.id);
      continue;
    }
    if (result.text.trim() === '') continue;
    const text = result.text.slice(0, MAX_EXTRACTED_CHARS);
    return { content: { text, ...(result.title === undefined ? {} : { title: result.title.slice(0, 200) }), extractor: extractor.id }, failed };
  }
  return { content: null, failed };
}

// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: packages/memory-host-sdk/src/host/markdown-chunks.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: imports cut to ProjectOS equivalents; embedding input, provenance and the curated-entry splitter cut; chunks are built without mutation and line remapping returns new chunks; chunking version restarted for this index
// Notice: full licence text in THIRD_PARTY_NOTICES

import { sha256Hex } from '../execution/evidence.js';
import { CHARS_PER_TOKEN_ESTIMATE, estimateStringChars, truncateUtf16Safe } from './textBudget.js';

export type MarkdownChunk = {
  readonly startLine: number;
  readonly endLine: number;
  readonly entryStartLine?: number;
  readonly entryEndLine?: number;
  readonly text: string;
  readonly hash: string;
};

// Persisted with index metadata so boundary changes rebuild unchanged files.
export const MARKDOWN_CHUNKING_VERSION = 1;

type CuratedEntryKind = 'entry' | 'section';

function curatedMarkdownEntryKind(line: string): CuratedEntryKind | undefined {
  return line.startsWith('- ') ? 'entry' : /^#{1,6}(?:\s|$)/u.test(line) ? 'section' : undefined;
}

function* curatedMarkdownEntrySpans(lines: readonly string[]) {
  let startLine = 1;
  let kind: CuratedEntryKind = lines[0]?.startsWith('- ') ? 'entry' : 'section';
  for (let index = 1; index < lines.length; index += 1) {
    const nextKind = curatedMarkdownEntryKind(lines[index] ?? '');
    if (nextKind) {
      yield { startLine, endLine: index, kind };
      startLine = index + 1;
      kind = nextKind;
    }
  }
  yield { startLine, endLine: lines.length, kind };
}

/** Takes the trailing slice of text within the weighted char budget, without splitting surrogate pairs. */
function takeTailByEstimatedChars(text: string, budget: number): string {
  let acc = 0;
  let start = text.length;
  while (start > 0) {
    const previous = start - ((text.codePointAt(start - 2) ?? 0) > 0xffff ? 2 : 1);
    acc += estimateStringChars(text.slice(previous, start));
    if (!(acc <= budget)) {
      break;
    }
    start = previous;
  }
  return text.slice(start);
}

/** Incremental text chunking: callers retain only the current chunk and overlap. */
export function createMarkdownChunker(
  chunking: { readonly tokens: number; readonly overlap: number },
  onChunk: (chunk: MarkdownChunk) => void,
) {
  const maxChars = Math.max(32, chunking.tokens * CHARS_PER_TOKEN_ESTIMATE);
  const overlapChars = Math.max(0, chunking.overlap * CHARS_PER_TOKEN_ESTIMATE);

  let current: Array<{ line: string; lineNo: number }> = [];
  let currentChars = 0;
  let pendingLine = '';

  const flush = () => {
    const firstEntry = current[0];
    const lastEntry = current[current.length - 1];
    if (!firstEntry || !lastEntry) {
      return;
    }
    const text = current.map((entry) => entry.line).join('\n');
    onChunk({ startLine: firstEntry.lineNo, endLine: lastEntry.lineNo, text, hash: sha256Hex(text) });
  };

  const carryOverlap = (window: number) => {
    if (window <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) {
        continue;
      }
      const entrySize = estimateStringChars(entry.line) + 1;
      const remaining = window - acc;
      if (entrySize > remaining) {
        // A segment wider than the remaining window keeps only its trailing
        // slice, measured in the same weighted units as the budget.
        const tail = kept.length === 0 ? takeTailByEstimatedChars(entry.line, remaining - 1) : '';
        if (tail.length > 0) {
          kept.unshift({ line: tail, lineNo: entry.lineNo });
          acc += estimateStringChars(tail) + 1;
        }
        break;
      }
      acc += entrySize;
      kept.unshift(entry);
      if (acc >= window) {
        break;
      }
    }
    current = kept;
    currentChars = acc;
  };

  const appendSegment = (segment: string, lineNo: number, chars: number) => {
    const lineSize = chars + 1;
    if (currentChars + lineSize > maxChars && current.length > 0) {
      flush();
      // Carry and the incoming segment share one budget, including line separators.
      carryOverlap(Math.min(overlapChars, Math.max(0, maxChars - lineSize)));
    }
    current.push({ line: segment, lineNo });
    currentChars += lineSize;
  };

  return {
    appendLine(part: string, lineNo: number, endOfLine = true) {
      const line = pendingLine + part;
      pendingLine = '';
      if (line.length === 0 && endOfLine) {
        appendSegment('', lineNo, 0);
      } else {
        for (let start = 0; start < line.length; ) {
          if (!endOfLine && line.length - start <= maxChars) {
            pendingLine = line.slice(start);
            break;
          }
          const coarse = truncateUtf16Safe(line.slice(start), maxChars);
          const coarseChars = estimateStringChars(coarse);
          if (coarseChars > maxChars) {
            // Rare and supplementary ideographs can cost several tokens each.
            // Split by the estimator's units while keeping every code point intact.
            let partStart = 0;
            let partEnd = 0;
            let partChars = 0;
            for (const character of coarse) {
              const chars = estimateStringChars(character);
              if (partChars + chars > maxChars) {
                appendSegment(coarse.slice(partStart, partEnd), lineNo, partChars);
                partStart = partEnd;
                partChars = 0;
              }
              partEnd += character.length;
              partChars += chars;
            }
            appendSegment(coarse.slice(partStart), lineNo, partChars);
          } else {
            appendSegment(coarse, lineNo, coarseChars);
          }
          start += coarse.length;
        }
      }
    },
    flush() {
      flush();
      current = [];
      currentChars = 0;
    },
  };
}

export function chunkMarkdown(
  content: string,
  chunking: { readonly tokens: number; readonly overlap: number; readonly perEntry?: boolean },
): MarkdownChunk[] {
  const lines = content.split('\n');
  const entries = chunking.perEntry
    ? [...curatedMarkdownEntrySpans(lines)]
    : [{ startLine: 1, endLine: lines.length, kind: 'section' as const }];
  return entries.flatMap((entry) => {
    const chunks: MarkdownChunk[] = [];
    const chunker = createMarkdownChunker(chunking, (chunk) => {
      chunks.push(
        entry.kind === 'entry' ? { ...chunk, entryStartLine: entry.startLine, entryEndLine: entry.endLine } : chunk,
      );
    });
    for (let i = entry.startLine - 1; i < entry.endLine; i += 1) {
      chunker.appendLine(lines[i] ?? '', i + 1);
    }
    chunker.flush();
    return chunks;
  });
}

/**
 * Remap chunk startLine/endLine from content-relative positions to original
 * source file positions using a lineMap.  Each entry in lineMap gives the
 * 1-indexed source line for the corresponding 0-indexed content line.
 *
 * This is used for session transcripts, which are flattened into plain text
 * before chunking. Without remapping the stored line numbers would reference
 * positions in the flattened text rather than the original file.
 */
export function remapChunkLines(chunks: readonly MarkdownChunk[], lineMap: readonly number[] | undefined): MarkdownChunk[] {
  if (!lineMap || lineMap.length === 0) {
    return [...chunks];
  }
  return chunks.map((chunk) => ({
    ...chunk,
    // startLine/endLine are 1-indexed; lineMap is 0-indexed by content line
    startLine: lineMap[chunk.startLine - 1] ?? chunk.startLine,
    endLine: lineMap[chunk.endLine - 1] ?? chunk.endLine,
  }));
}

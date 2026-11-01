// Origin: original ProjectOS code
/**
 * A CHUNK RECORD CARRIES ITS OWN CITATION (PROJECTOS-PORT-SEARCH1A).
 *
 * The chunker knows lines. This adds what a citation needs, so a record that cannot be cited is never made and
 * never reaches an index: the project, the file, the line range. A session transcript is flattened before it is
 * chunked, so it brings a `lineMap` with one source line per flattened line. A map of any other length would put a
 * wrong line in a citation, so it is refused rather than padded.
 *
 * THIS IS THE INDEX BOUNDARY. A dot-segment, a credential name or secret content makes no record, whoever handed the
 * source in, and comes back in `skipped` by name.
 *
 * A CITATION CLAIMS ONLY WHAT IS SHOWN. `excerptOf` cuts a long chunk and moves the end of the range to the last row
 * shown. A record keeps the source line of every row, because remapped lines have gaps and a wide line splits.
 *
 * Pure. Whoever calls this read the text.
 */
import { isProjectId } from '../tenant.js';
import { citationPathProblem, SEARCH_SOURCE_KINDS, type SearchSourceKind } from './citation.js';
import { chunkMarkdown, remapChunkLines } from './markdownChunks.js';
import { sensitiveContentProblem, sensitivePathProblem, type SensitiveReason } from './sensitiveContent.js';
import { truncateUtf16Safe } from './textBudget.js';

export interface SearchChunking {
  readonly tokens: number;
  readonly overlap: number;
}

export const DEFAULT_SEARCH_CHUNKING: SearchChunking = { tokens: 400, overlap: 80 };
export const MAX_EXCERPT_CHARS = 700;

export interface SearchSourceText {
  readonly project: string;
  readonly source: SearchSourceKind;
  readonly path: string;
  readonly content: string;
  /** When the source last changed, for temporal decay. */
  readonly mtimeMs?: number;
  readonly lineMap?: readonly number[];
}

export interface SearchChunkRecord {
  readonly project: string;
  readonly source: SearchSourceKind;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
  readonly rowLines: readonly number[];
  readonly mtimeMs: number | null;
}

export interface SkippedSource {
  readonly path: string;
  readonly reason: SensitiveReason;
}

export type ChunkRecordsResult =
  | { readonly ok: true; readonly records: readonly SearchChunkRecord[]; readonly skipped: readonly SkippedSource[] }
  | { readonly ok: false; readonly problem: string };

function sourceProblem(input: SearchSourceText): string | null {
  if (!isProjectId(input.project)) return `'${String(input.project)}' is not a project id`;
  const pathProblem = citationPathProblem(input.path);
  if (pathProblem !== null) return `${JSON.stringify(input.path)}: ${pathProblem}`;
  if (!SEARCH_SOURCE_KINDS.includes(input.source)) return `${input.path}: unknown source '${String(input.source)}'`;
  const lines = input.content.split('\n').length;
  if (input.lineMap !== undefined && input.lineMap.length !== lines) {
    return `${input.path}: the line map has ${input.lineMap.length} lines and the text has ${lines}`;
  }
  return null;
}

export function chunkRecordsOf(input: SearchSourceText, chunking: SearchChunking = DEFAULT_SEARCH_CHUNKING): ChunkRecordsResult {
  const problem = sourceProblem(input);
  if (problem !== null) return { ok: false, problem };
  const sensitive = sensitivePathProblem(input.path) ?? sensitiveContentProblem(input.content);
  if (sensitive !== null) return { ok: true, records: [], skipped: [{ path: input.path, reason: sensitive }] };
  return {
    ok: true,
    skipped: [],
    records: remapChunkLines(chunkMarkdown(input.content, chunking), input.lineMap)
      .filter((chunk) => chunk.text.trim() !== '')
      .map((chunk) => ({
        project: input.project,
        source: input.source,
        path: input.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        hash: chunk.hash,
        rowLines: chunk.rowLines,
        mtimeMs: input.mtimeMs ?? null,
      })),
  };
}

/** The text a reader sees and the last line of it. Rows that do not fit give line 0, which the door refuses. */
export function excerptOf(chunk: { readonly text: string; readonly endLine: number; readonly rowLines: readonly number[] }): {
  readonly snippet: string;
  readonly endLine: number;
} {
  const snippet = truncateUtf16Safe(chunk.text, MAX_EXCERPT_CHARS);
  if (snippet.length === chunk.text.length) return { snippet, endLine: chunk.endLine };
  const shownRows = snippet.replace(/\n+$/, '').split('\n').length;
  return { snippet, endLine: chunk.rowLines[shownRows - 1] ?? 0 };
}

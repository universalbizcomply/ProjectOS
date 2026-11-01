// Origin: original ProjectOS code
/**
 * THE LOCAL SEARCH INDEX (PROJECTOS-PORT-SEARCH1A, C8, C10).
 *
 * On the `node:sqlite` and FTS5 built into Node 24.14.1, so it adds no dependency. Keyword search only.
 *
 * THE INDEX IS DERIVED. Source files are the truth: delete the database, rebuild, and it says the same. So there
 * is no incremental update to drift. `rebuildProject` replaces one project's rows in a single transaction, and a
 * failure leaves the previous index standing.
 *
 * EVERY ROW HAS A PROJECT AND A SEARCH NAMES ONE. Project is a bound parameter on the row, not on the FTS text,
 * so nothing typed into a query or a document can reach it, and there is no search across projects. A later tenant
 * scope binds here. `search_chunks` holds what a citation needs under NOT NULL and CHECK, and `rankCitedResults`
 * judges each row again, because a database file is only as trustworthy as whoever last wrote it.
 *
 * INDEXED TEXT IS UNTRUSTED. It is stored and returned, and nothing here reads meaning from it. It comes back
 * as `untrustedText`, for `renderUntrustedExcerpt`.
 *
 * NO EXTENSIONS, NO EMBEDDINGS, NO PROVIDER. `DatabaseSync` keeps extension loading off. The vector seam is the
 * `vectorCandidates` parameter of `search`, which nothing fills; see `citedSearch.ts` in core.
 *
 * The chunker's version is recorded per project. After a chunking change a project answers `stale` until it is
 * rebuilt, because its line ranges came from different boundaries.
 *
 * `node:sqlite` IS LOADED WHEN AN INDEX OPENS, not on import. Loading it prints an experimental warning, which
 * nothing that does not search should pay for, and the module exists only under its `node:` name, which the test
 * bundler strips from a static import.
 */
import {
  DEFAULT_SEARCH_CHUNKING,
  DEFAULT_SEARCH_MAX_RESULTS,
  MARKDOWN_CHUNKING_VERSION,
  NO_VECTOR_CANDIDATES,
  SEARCH_SOURCE_KINDS,
  bm25RankToScore,
  chunkRecordsOf,
  compileFts5Match,
  isProjectId,
  planKeywordSearch,
  rankCitedResults,
  truncateUtf16Safe,
  type CitedSearchOutcome,
  type KeywordCandidate,
  type MMRConfig,
  type SearchChunkRecord,
  type SearchChunking,
  type SearchSourceKind,
  type SearchSourceText,
  type TemporalDecayConfig,
  type VectorCandidate,
} from '@projectos/core';

const FTS_TOKENIZER = 'unicode61';
const CANDIDATE_MULTIPLIER = 4;
const MAX_CANDIDATES = 200;
const MAX_SNIPPET_CHARS = 700;

const SOURCE_KIND_LIST = SEARCH_SOURCE_KINDS.map((kind) => `'${kind}'`).join(', ');
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS search_projects (
    project TEXT PRIMARY KEY CHECK (length(project) > 0),
    chunking_version INTEGER NOT NULL,
    built_at_ms REAL NOT NULL,
    sources INTEGER NOT NULL,
    chunks INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS search_chunks (
    id INTEGER PRIMARY KEY,
    project TEXT NOT NULL CHECK (length(project) > 0),
    source TEXT NOT NULL CHECK (source IN (${SOURCE_KIND_LIST})),
    path TEXT NOT NULL CHECK (length(path) > 0),
    start_line INTEGER NOT NULL CHECK (start_line >= 1),
    end_line INTEGER NOT NULL CHECK (end_line >= start_line),
    hash TEXT NOT NULL,
    text TEXT NOT NULL,
    mtime_ms REAL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS search_chunks_by_project ON search_chunks (project, path);
  CREATE VIRTUAL TABLE IF NOT EXISTS search_chunks_fts USING fts5(text, tokenize = '${FTS_TOKENIZER}');
`;

export type RebuildResult =
  | { readonly ok: true; readonly project: string; readonly sources: number; readonly chunks: number }
  | { readonly ok: false; readonly problem: string };

export type ProjectIndexStatus = 'current' | 'stale' | 'not-built';

export type SearchRefusalReason = 'invalid-project' | 'not-built' | 'stale';

export type SearchOutcome = ({ readonly ok: true } & CitedSearchOutcome) | { readonly ok: false; readonly reason: SearchRefusalReason };

export interface SearchRequest {
  readonly project: string;
  readonly query: string;
  readonly maxResults?: number;
  readonly minScore?: number;
  readonly matchAny?: boolean;
  /** THE VECTOR SEAM. Unfilled: no embedding exists and no provider is called. */
  readonly vectorCandidates?: readonly VectorCandidate[];
  readonly mmr?: MMRConfig;
  readonly temporalDecay?: TemporalDecayConfig;
  readonly nowMs?: number;
}

export interface SearchIndex {
  readonly rebuildProject: (
    project: string,
    sources: readonly SearchSourceText[],
    options?: { readonly chunking?: SearchChunking; readonly nowMs?: number },
  ) => RebuildResult;
  readonly statusOf: (project: string) => ProjectIndexStatus;
  readonly search: (request: SearchRequest) => SearchOutcome;
  readonly close: () => void;
}

interface ChunkRow {
  readonly id: number;
  readonly project: string;
  readonly source: SearchSourceKind;
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly text: string;
  readonly mtime_ms: number | null;
  readonly rank: number;
}

function recordsOf(project: string, sources: readonly SearchSourceText[], chunking: SearchChunking):
  { readonly ok: true; readonly records: readonly SearchChunkRecord[] } | { readonly ok: false; readonly problem: string } {
  const foreign = sources.find((source) => source.project !== project);
  if (foreign !== undefined) return { ok: false, problem: `${foreign.path} belongs to ${foreign.project}, not ${project}` };
  const built = sources.map((source) => chunkRecordsOf(source, chunking));
  const failed = built.find((result) => !result.ok);
  if (failed !== undefined && !failed.ok) return { ok: false, problem: failed.problem };
  return { ok: true, records: built.flatMap((result) => (result.ok ? result.records : [])) };
}

const candidateOf = (row: ChunkRow): KeywordCandidate => ({
  id: String(row.id),
  project: row.project,
  source: row.source,
  path: row.path,
  startLine: row.start_line,
  endLine: row.end_line,
  snippet: truncateUtf16Safe(row.text, MAX_SNIPPET_CHARS),
  textScore: bm25RankToScore(row.rank),
  mtimeMs: row.mtime_ms,
});

/** Opens or creates the index at `location`; `:memory:` works for a throwaway. The caller closes it. */
export function openSearchIndex(location: string): SearchIndex {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(location);
  db.exec(SCHEMA);

  const deleteFts = db.prepare('DELETE FROM search_chunks_fts WHERE rowid IN (SELECT id FROM search_chunks WHERE project = ?)');
  const deleteChunks = db.prepare('DELETE FROM search_chunks WHERE project = ?');
  const insertChunk = db.prepare(
    'INSERT INTO search_chunks (project, source, path, start_line, end_line, hash, text, mtime_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertFts = db.prepare('INSERT INTO search_chunks_fts (rowid, text) VALUES (?, ?)');
  const recordProject = db.prepare(
    'INSERT OR REPLACE INTO search_projects (project, chunking_version, built_at_ms, sources, chunks) VALUES (?, ?, ?, ?, ?)',
  );
  const projectVersion = db.prepare('SELECT chunking_version FROM search_projects WHERE project = ?');
  const matchChunks = db.prepare(`
    SELECT c.id, c.project, c.source, c.path, c.start_line, c.end_line, c.text, c.mtime_ms, bm25(search_chunks_fts) AS rank
    FROM search_chunks_fts
    JOIN search_chunks AS c ON c.id = search_chunks_fts.rowid
    WHERE search_chunks_fts MATCH ? AND c.project = ?
    ORDER BY rank
    LIMIT ?
  `);

  const statusOf = (project: string): ProjectIndexStatus => {
    const row = projectVersion.get(project) as { chunking_version: number } | undefined;
    if (row === undefined) return 'not-built';
    return row.chunking_version === MARKDOWN_CHUNKING_VERSION ? 'current' : 'stale';
  };

  const writeProject = (project: string, sources: number, records: readonly SearchChunkRecord[], nowMs: number): void => {
    db.exec('BEGIN IMMEDIATE');
    try {
      deleteFts.run(project);
      deleteChunks.run(project);
      for (const record of records) {
        const { lastInsertRowid } = insertChunk.run(
          record.project,
          record.source,
          record.path,
          record.startLine,
          record.endLine,
          record.hash,
          record.text,
          record.mtimeMs,
        );
        insertFts.run(lastInsertRowid, record.text);
      }
      recordProject.run(project, MARKDOWN_CHUNKING_VERSION, nowMs, sources, records.length);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    rebuildProject(project, sources, options) {
      if (!isProjectId(project)) return { ok: false, problem: `'${String(project)}' is not a project id` };
      const built = recordsOf(project, sources, options?.chunking ?? DEFAULT_SEARCH_CHUNKING);
      if (!built.ok) return built;
      writeProject(project, sources.length, built.records, options?.nowMs ?? Date.now());
      return { ok: true, project, sources: sources.length, chunks: built.records.length };
    },

    statusOf,

    search(request) {
      if (!isProjectId(request.project)) return { ok: false, reason: 'invalid-project' };
      const status = statusOf(request.project);
      if (status === 'not-built') return { ok: false, reason: 'not-built' };
      if (status === 'stale') return { ok: false, reason: 'stale' };

      const maxResults = request.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
      const { matchQuery } = planKeywordSearch({
        query: request.query,
        ftsTokenizer: FTS_TOKENIZER,
        canonicalVariants: true,
        matchAny: request.matchAny === true,
      });
      const match = matchQuery === null ? null : compileFts5Match(matchQuery);
      const rows =
        match === null
          ? []
          : (matchChunks.all(match, request.project, Math.min(maxResults * CANDIDATE_MULTIPLIER, MAX_CANDIDATES)) as unknown as readonly ChunkRow[]);

      return {
        ok: true,
        ...rankCitedResults({
          project: request.project,
          keyword: rows.map(candidateOf),
          vectorCandidates: request.vectorCandidates ?? NO_VECTOR_CANDIDATES,
          maxResults,
          nowMs: request.nowMs ?? Date.now(),
          ...(request.minScore === undefined ? {} : { minScore: request.minScore }),
          ...(request.mmr === undefined ? {} : { mmr: request.mmr }),
          ...(request.temporalDecay === undefined ? {} : { temporalDecay: request.temporalDecay }),
        }),
      };
    },

    close() {
      db.close();
    },
  };
}

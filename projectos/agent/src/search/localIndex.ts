// Origin: original ProjectOS code
/**
 * THE LOCAL SEARCH INDEX (PROJECTOS-PORT-SEARCH1A, C8, C10).
 *
 * On the `node:sqlite` and FTS5 built into Node 24.14.1, so it adds no dependency. Keyword search only.
 *
 * THE INDEX IS DERIVED. Source files are the truth: delete the database, rebuild, and it says the same. So there
 * is no incremental update to drift. `rebuildProject` replaces one project's rows in a single transaction, and a
 * failure leaves the previous index standing. A file at another schema version loses its `search_*` tables on open
 * and is rebuilt, and no other table in it is touched.
 *
 * EVERY ROW HAS A PROJECT AND A SEARCH NAMES ONE. Project is a bound parameter on the row, not on the FTS text,
 * so nothing typed into a query or a document can reach it, and there is no search across projects. `search_chunks`
 * holds what a citation needs under NOT NULL and CHECK, and `rankCitedResults` judges each row again, because a
 * database file is only as trustworthy as whoever last wrote it.
 *
 * NOT YET A TENANT BOUNDARY. One FTS table serves every project in the file, so BM25 statistics are shared between
 * them and one project's documents shift another's scores. Tenant binding needs a file per project or per tenant.
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
 * bundler strips from a static import. `Date.now()` is the fallback clock, because this module is not on the
 * System port.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  DEFAULT_SEARCH_CHUNKING,
  DEFAULT_SEARCH_MAX_RESULTS,
  MARKDOWN_CHUNKING_VERSION,
  NO_VECTOR_CANDIDATES,
  SEARCH_SOURCE_KINDS,
  bm25RankToScore,
  chunkRecordsOf,
  compileFts5Match,
  excerptOf,
  isProjectId,
  planKeywordSearch,
  rankCitedResults,
  type CitedSearchOutcome,
  type KeywordCandidate,
  type MMRConfig,
  type SearchChunkRecord,
  type SearchChunking,
  type SearchSourceKind,
  type SearchSourceText,
  type SkippedSource,
  type TemporalDecayConfig,
  type VectorCandidate,
} from '@projectos/core';

export const SEARCH_SCHEMA_VERSION = 1;
export const MAX_SEARCH_RESULTS = 50;
const FTS_TOKENIZER = 'unicode61';
const CANDIDATE_MULTIPLIER = 4;
const MAX_CANDIDATES = 200;

const SEARCH_TABLES = ['search_chunks_fts', 'search_chunks', 'search_projects'];
const SOURCE_KIND_LIST = SEARCH_SOURCE_KINDS.map((kind) => `'${kind}'`).join(', ');
const SCHEMA = `
  CREATE TABLE search_projects (
    project TEXT PRIMARY KEY CHECK (length(project) > 0),
    chunking_version INTEGER NOT NULL,
    built_at_ms REAL NOT NULL,
    sources INTEGER NOT NULL,
    chunks INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE search_chunks (
    id INTEGER PRIMARY KEY,
    project TEXT NOT NULL CHECK (length(project) > 0),
    source TEXT NOT NULL CHECK (source IN (${SOURCE_KIND_LIST})),
    path TEXT NOT NULL CHECK (length(path) > 0),
    start_line INTEGER NOT NULL CHECK (start_line >= 1),
    end_line INTEGER NOT NULL CHECK (end_line >= start_line),
    row_lines TEXT NOT NULL,
    hash TEXT NOT NULL,
    text TEXT NOT NULL,
    mtime_ms REAL
  ) STRICT;
  CREATE INDEX search_chunks_by_project ON search_chunks (project, path);
  CREATE VIRTUAL TABLE search_chunks_fts USING fts5(text, tokenize = '${FTS_TOKENIZER}');
`;

export type RebuildResult =
  | { readonly ok: true; readonly project: string; readonly sources: number; readonly chunks: number; readonly skipped: readonly SkippedSource[] }
  | { readonly ok: false; readonly problem: string };

export type ProjectIndexStatus = 'current' | 'stale' | 'not-built';

export type SearchRefusalReason = 'invalid-project' | 'invalid-max-results' | 'not-built' | 'stale';

export type SearchOutcome = ({ readonly ok: true } & CitedSearchOutcome) | { readonly ok: false; readonly reason: SearchRefusalReason };

export interface SearchRequest {
  readonly project: string;
  readonly query: string;
  /** An integer from 1. Above `MAX_SEARCH_RESULTS` it is held there; anything else is refused. */
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
  readonly row_lines: string;
  readonly text: string;
  readonly mtime_ms: number | null;
  readonly rank: number;
}

interface Statements {
  readonly deleteFts: StatementSync;
  readonly deleteChunks: StatementSync;
  readonly insertChunk: StatementSync;
  readonly insertFts: StatementSync;
  readonly recordProject: StatementSync;
  readonly projectVersion: StatementSync;
  readonly matchChunks: StatementSync;
}

type BuiltRecords =
  | { readonly ok: true; readonly records: readonly SearchChunkRecord[]; readonly skipped: readonly SkippedSource[] }
  | { readonly ok: false; readonly problem: string };

function recordsOf(project: string, sources: readonly SearchSourceText[], chunking: SearchChunking): BuiltRecords {
  const foreign = sources.find((source) => source.project !== project);
  if (foreign !== undefined) return { ok: false, problem: `${foreign.path} belongs to ${foreign.project}, not ${project}` };
  const built = sources.map((source) => chunkRecordsOf(source, chunking));
  const failed = built.find((result) => !result.ok);
  if (failed !== undefined && !failed.ok) return { ok: false, problem: failed.problem };
  return {
    ok: true,
    records: built.flatMap((result) => (result.ok ? result.records : [])),
    skipped: built.flatMap((result) => (result.ok ? result.skipped : [])),
  };
}

/** A row that cannot say which line each row of text came from gets none, and the door refuses it. */
function rowLinesOf(row: ChunkRow): readonly number[] {
  try {
    const parsed: unknown = JSON.parse(row.row_lines);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function candidateOf(row: ChunkRow): KeywordCandidate {
  const { snippet, endLine } = excerptOf({ text: row.text, endLine: row.end_line, rowLines: rowLinesOf(row) });
  return {
    id: String(row.id),
    project: row.project,
    source: row.source,
    path: row.path,
    startLine: row.start_line,
    endLine,
    snippet,
    textScore: bm25RankToScore(row.rank),
    mtimeMs: row.mtime_ms,
  };
}

/** One transaction: at another version the `search_*` tables go, by name, and nothing else does. */
function ensureSchema(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version === SEARCH_SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    SEARCH_TABLES.forEach((table) => db.exec(`DROP TABLE IF EXISTS ${table}`));
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SEARCH_SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function prepareStatements(db: DatabaseSync): Statements {
  return {
    deleteFts: db.prepare('DELETE FROM search_chunks_fts WHERE rowid IN (SELECT id FROM search_chunks WHERE project = ?)'),
    deleteChunks: db.prepare('DELETE FROM search_chunks WHERE project = ?'),
    insertChunk: db.prepare(
      'INSERT INTO search_chunks (project, source, path, start_line, end_line, row_lines, hash, text, mtime_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    insertFts: db.prepare('INSERT INTO search_chunks_fts (rowid, text) VALUES (?, ?)'),
    recordProject: db.prepare(
      'INSERT OR REPLACE INTO search_projects (project, chunking_version, built_at_ms, sources, chunks) VALUES (?, ?, ?, ?, ?)',
    ),
    projectVersion: db.prepare('SELECT chunking_version FROM search_projects WHERE project = ?'),
    matchChunks: db.prepare(`
      SELECT c.id, c.project, c.source, c.path, c.start_line, c.end_line, c.row_lines, c.text, c.mtime_ms, bm25(search_chunks_fts) AS rank
      FROM search_chunks_fts
      JOIN search_chunks AS c ON c.id = search_chunks_fts.rowid
      WHERE search_chunks_fts MATCH ? AND c.project = ?
      ORDER BY rank
      LIMIT ?
    `),
  };
}

function writeProject(db: DatabaseSync, statements: Statements, project: string, sources: number, records: readonly SearchChunkRecord[], nowMs: number): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    statements.deleteFts.run(project);
    statements.deleteChunks.run(project);
    for (const record of records) {
      const { lastInsertRowid } = statements.insertChunk.run(
        record.project,
        record.source,
        record.path,
        record.startLine,
        record.endLine,
        JSON.stringify(record.rowLines),
        record.hash,
        record.text,
        record.mtimeMs,
      );
      statements.insertFts.run(lastInsertRowid, record.text);
    }
    statements.recordProject.run(project, MARKDOWN_CHUNKING_VERSION, nowMs, sources, records.length);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** The cap, or null. Held to `MAX_SEARCH_RESULTS` above, and anything that is not a positive integer is refused. */
function resultCapOf(maxResults: number | undefined): number | null {
  const wanted = maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
  return Number.isSafeInteger(wanted) && wanted >= 1 ? Math.min(wanted, MAX_SEARCH_RESULTS) : null;
}

function indexOver(db: DatabaseSync, statements: Statements): SearchIndex {
  let open = true;

  const statusOf = (project: string): ProjectIndexStatus => {
    const row = statements.projectVersion.get(project) as { chunking_version: number } | undefined;
    if (row === undefined) return 'not-built';
    return row.chunking_version === MARKDOWN_CHUNKING_VERSION ? 'current' : 'stale';
  };

  return {
    rebuildProject(project, sources, options) {
      if (!isProjectId(project)) return { ok: false, problem: `'${String(project)}' is not a project id` };
      const built = recordsOf(project, sources, options?.chunking ?? DEFAULT_SEARCH_CHUNKING);
      if (!built.ok) return built;
      const indexed = new Set(built.records.map((record) => record.path)).size;
      writeProject(db, statements, project, indexed, built.records, options?.nowMs ?? Date.now());
      return { ok: true, project, sources: indexed, chunks: built.records.length, skipped: built.skipped };
    },

    statusOf,

    search(request) {
      if (!isProjectId(request.project)) return { ok: false, reason: 'invalid-project' };
      const maxResults = resultCapOf(request.maxResults);
      if (maxResults === null) return { ok: false, reason: 'invalid-max-results' };
      const status = statusOf(request.project);
      if (status === 'not-built') return { ok: false, reason: 'not-built' };
      if (status === 'stale') return { ok: false, reason: 'stale' };

      const { matchQuery } = planKeywordSearch({ query: request.query, canonicalVariants: true, matchAny: request.matchAny === true });
      const match = matchQuery === null ? null : compileFts5Match(matchQuery);
      const rows =
        match === null
          ? []
          : (statements.matchChunks.all(match, request.project, Math.min(maxResults * CANDIDATE_MULTIPLIER, MAX_CANDIDATES)) as unknown as readonly ChunkRow[]);

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
      if (!open) return;
      open = false;
      db.close();
    },
  };
}

/** Opens or creates the index at `location`; `:memory:` works for a throwaway. The caller closes it. */
export function openSearchIndex(location: string): SearchIndex {
  const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
  const db = new Database(location);
  try {
    ensureSchema(db);
    return indexOver(db, prepareStatements(db));
  } catch (error) {
    db.close();
    throw error;
  }
}

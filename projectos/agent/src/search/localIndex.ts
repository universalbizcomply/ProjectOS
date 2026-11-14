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
 * ONE FILE, ONE TENANT, ONE PROJECT (STORES1A). The FTS table used to serve every project in a file, so BM25 statistics
 * were shared and one project's documents shifted another's scores. An index is now bound to one owner, recorded in the
 * file itself, and `projectIndex.ts` names the file from the pair by a collision-proof encoding. An index asked about
 * another project says so, and a file that belongs to another owner does not open. Rebuilt from the stores, so nothing in
 * it is the only copy.
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
 *
 * THE CLOCK IS INJECTED (STORES1A). There is no `Date.now()` fallback and no time in a request: the build time and the age
 * a temporal decay measures come from the `SearchClock` the caller opened the index with, so a request cannot choose when
 * "now" is. A clock that does not give a finite number is refused, not stored.
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
  citationFreshnessOf,
  compileFts5Match,
  excerptOf,
  isCommitName,
  isProjectId,
  isTenantId,
  planKeywordSearch,
  rankCitedResults,
  type CitedSearchOutcome,
  type KeywordCandidate,
  type MMRConfig,
  type SearchChunkRecord,
  type SearchChunking,
  type SearchIndexOwner,
  type SearchSourceKind,
  type SearchSourceText,
  type SkippedSource,
  type TemporalDecayConfig,
  type VectorCandidate,
} from '@projectos/core';
import type { SearchClock, SearchHead } from './ports.js';

/** 2: the file is bound to one tenant and one project. A version 1 file held many, and is dropped and rebuilt. */
export const SEARCH_SCHEMA_VERSION = 2;
export const MAX_SEARCH_RESULTS = 50;
const FTS_TOKENIZER = 'unicode61';
const CANDIDATE_MULTIPLIER = 4;
const MAX_CANDIDATES = 200;

const SEARCH_TABLES = ['search_chunks_fts', 'search_chunks', 'search_projects', 'search_owner'];
const SOURCE_KIND_LIST = SEARCH_SOURCE_KINDS.map((kind) => `'${kind}'`).join(', ');
const SCHEMA = `
  CREATE TABLE search_owner (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    tenant TEXT NOT NULL CHECK (length(tenant) > 0),
    project TEXT NOT NULL CHECK (length(project) > 0)
  ) STRICT;
  CREATE TABLE search_projects (
    project TEXT PRIMARY KEY CHECK (length(project) > 0),
    chunking_version INTEGER NOT NULL,
    built_at_ms REAL NOT NULL,
    sources INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    built_at_commit TEXT
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

export type SearchRefusalReason = 'invalid-project' | 'wrong-project' | 'invalid-max-results' | 'invalid-clock' | 'not-built' | 'stale';

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
}

export interface SearchIndex {
  readonly rebuildProject: (
    project: string,
    sources: readonly SearchSourceText[],
    options?: { readonly chunking?: SearchChunking },
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
  readonly recordCommit: StatementSync;
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

/**
 * A file made before this phase has no `built_at_commit`. The column is additive and the file is derived, so it is added in place
 * and not by dropping the file: the schema version stays 2, old rows read NULL, and NULL reads as `built-commit-unknown` (stale)
 * until the project is rebuilt.
 */
function addBuildCommitColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(search_projects)').all() as unknown as readonly { readonly name: string }[];
  if (!columns.some((column) => column.name === 'built_at_commit')) db.exec('ALTER TABLE search_projects ADD COLUMN built_at_commit TEXT');
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
    recordCommit: db.prepare('UPDATE search_projects SET built_at_commit = ? WHERE project = ?'),
    projectVersion: db.prepare('SELECT chunking_version, built_at_commit FROM search_projects WHERE project = ?'),
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

/** What an index is opened with. The owner is the one tenant and project the file holds; the clock is the only time. */
export interface SearchIndexDeps {
  readonly owner: SearchIndexOwner;
  readonly clock: SearchClock;
  /**
   * Where HEAD is, asked when the index is built and at every search. Absent, or answering anything but a commit name, every
   * citation is marked stale (`head-unknown`): an index that cannot say where it stands is never silently fresh.
   */
  readonly head?: SearchHead;
}

/** The time, or null when the clock does not give a finite number. */
function timeOf(clock: SearchClock): number | null {
  const now = clock.nowMs();
  return typeof now === 'number' && Number.isFinite(now) ? now : null;
}

/** The commit HEAD is at, or null: a head that is absent, throws or answers anything but a commit name says nothing. */
function headCommitOf(head: SearchHead | undefined): string | null {
  try {
    const commit: unknown = head?.headCommit();
    return isCommitName(commit) ? commit : null;
  } catch {
    return null;
  }
}

/** Record the owner in a new file, and refuse a file that already belongs to another. */
function bindOwner(db: DatabaseSync, owner: SearchIndexOwner): void {
  const held = db.prepare('SELECT tenant, project FROM search_owner WHERE slot = 1').get() as { tenant: string; project: string } | undefined;
  if (held === undefined) {
    db.prepare('INSERT INTO search_owner (slot, tenant, project) VALUES (1, ?, ?)').run(owner.tenant, owner.project);
    return;
  }
  if (held.tenant !== owner.tenant || held.project !== owner.project) throw new Error('this index file belongs to another tenant or project');
}

function indexOver(db: DatabaseSync, statements: Statements, deps: SearchIndexDeps): SearchIndex {
  let open = true;

  const statusOf = (project: string): ProjectIndexStatus => {
    if (project !== deps.owner.project) return 'not-built';
    const row = statements.projectVersion.get(project) as { chunking_version: number; built_at_commit: string | null } | undefined;
    if (row === undefined) return 'not-built';
    return row.chunking_version === MARKDOWN_CHUNKING_VERSION ? 'current' : 'stale';
  };

  return {
    rebuildProject(project, sources, options) {
      if (!isProjectId(project)) return { ok: false, problem: `'${String(project)}' is not a project id` };
      if (project !== deps.owner.project) return { ok: false, problem: `this index holds ${deps.owner.project}, not ${project}` };
      const now = timeOf(deps.clock);
      if (now === null) return { ok: false, problem: 'the clock did not give a time, so nothing was built' };
      const built = recordsOf(project, sources, options?.chunking ?? DEFAULT_SEARCH_CHUNKING);
      if (!built.ok) return built;
      const builtAt = headCommitOf(deps.head);
      const indexed = new Set(built.records.map((record) => record.path)).size;
      writeProject(db, statements, project, indexed, built.records, now);
      // The commit is recorded AFTER the rows. The rebuilt row starts with none, so a rebuild that stops between the two reads as
      // `built-commit-unknown`, which is stale: the failure leans to marking, never to a fresh mark it did not earn.
      statements.recordCommit.run(builtAt, project);
      return { ok: true, project, sources: indexed, chunks: built.records.length, skipped: built.skipped };
    },

    statusOf,

    search(request) {
      if (!isProjectId(request.project)) return { ok: false, reason: 'invalid-project' };
      if (request.project !== deps.owner.project) return { ok: false, reason: 'wrong-project' };
      const maxResults = resultCapOf(request.maxResults);
      if (maxResults === null) return { ok: false, reason: 'invalid-max-results' };
      const now = timeOf(deps.clock);
      if (now === null) return { ok: false, reason: 'invalid-clock' };
      const status = statusOf(request.project);
      if (status === 'not-built') return { ok: false, reason: 'not-built' };
      if (status === 'stale') return { ok: false, reason: 'stale' };
      const builtCommit = (statements.projectVersion.get(request.project) as { built_at_commit: string | null } | undefined)?.built_at_commit ?? null;

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
          nowMs: now,
          freshness: citationFreshnessOf(builtCommit, headCommitOf(deps.head)),
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

/**
 * Opens or creates the index at `location` for one owner; `:memory:` works for a throwaway. The caller closes it. A file that
 * belongs to another tenant or project does not open, and the handle is closed first.
 */
export function openSearchIndex(location: string, deps: SearchIndexDeps): SearchIndex {
  if (!isTenantId(deps.owner.tenant) || !isProjectId(deps.owner.project)) throw new Error('a search index needs a tenant id and a project id');
  const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite');
  const db = new Database(location);
  try {
    ensureSchema(db);
    addBuildCommitColumn(db);
    bindOwner(db, deps.owner);
    return indexOver(db, prepareStatements(db), deps);
  } catch (error) {
    db.close();
    throw error;
  }
}

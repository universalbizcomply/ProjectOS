// Origin: original ProjectOS code
/**
 * The local search index (PROJECTOS-PORT-SEARCH1A). Nothing calls it yet: the context manager (plan 3.4) is its
 * first caller, and that phase wires it into the agent. One file per tenant and project, and a clock and a file system
 * that arrive as ports (PROJECTOS-MEMORY-STORES1A).
 */
export {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  DOCUMENT_EXTENSIONS,
  collectDocumentSources,
  type CollectedDocuments,
  type SkippedDocument,
  type SkippedReason,
} from './documentSources.js';
export {
  MAX_SEARCH_RESULTS,
  SEARCH_SCHEMA_VERSION,
  openSearchIndex,
  type ProjectIndexStatus,
  type RebuildResult,
  type SearchIndex,
  type SearchOutcome,
  type SearchRefusalReason,
  type SearchIndexDeps,
  type SearchRequest,
} from './localIndex.js';
export { openProjectSearchIndex, projectIndexLocation, type ProjectIndexDeps, type ProjectIndexOpening } from './projectIndex.js';
export { MAX_STORE_FILES_PER_DIRECTORY, collectStoreSources, storeClassOfPath } from './storeSources.js';
export {
  MAX_GIT_OUTPUT_BYTES,
  documentFsOver,
  gitRunnerOver,
  searchClockOver,
  searchHeadOver,
  type DocumentFs,
  type DocumentSystem,
  type EntryKind,
  type EntryProbe,
  type EntryStat,
  type GitRunResult,
  type GitRunner,
  type GitSystem,
  type SearchClock,
  type SearchHead,
} from './ports.js';
export { nodeEnsureDirectory, nodeEntryProbe } from './nodeHost.js';

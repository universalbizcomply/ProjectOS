// Origin: original ProjectOS code
/**
 * The local search index (PROJECTOS-PORT-SEARCH1A). Nothing calls it yet: the context manager (plan 3.4) is its
 * first caller, and that phase wires it into the agent.
 */
export {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DOCUMENT_EXTENSIONS,
  collectDocumentSources,
  type CollectedDocuments,
  type SkippedDocument,
  type SkippedReason,
} from './documentSources.js';
export {
  openSearchIndex,
  type ProjectIndexStatus,
  type RebuildResult,
  type SearchIndex,
  type SearchOutcome,
  type SearchRefusalReason,
  type SearchRequest,
} from './localIndex.js';

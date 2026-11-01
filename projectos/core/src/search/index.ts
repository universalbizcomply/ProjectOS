// Origin: original ProjectOS code
/**
 * Cited search, pure (PROJECTOS-PORT-SEARCH1A, C8, C10). Ported files carry their own credit, and `THIRD_PARTY_NOTICES`
 * holds the licences. No file here reads, writes or calls out.
 */
export { MARKDOWN_CHUNKING_VERSION, chunkMarkdown, createMarkdownChunker, remapChunkLines, type MarkdownChunk } from './markdownChunks.js';
export { bm25RankToScore, buildMatchQueryFromTerms, planKeywordSearch, tokenizeFtsQuery, type TextQuery } from './keywordQuery.js';
export { compileFts5Match } from './ftsMatch.js';
export { applyMMRToHybridResults, type MMRConfig } from './mmr.js';
export { applyTemporalDecayToHybridResults, sourceTimeKey, type TemporalDecayConfig } from './temporalDecay.js';
export { prepareSimilarityText, preparedTextSimilarity, type PreparedSimilarityText } from './lexer.js';
export { CHARS_PER_TOKEN_ESTIMATE, estimateStringChars, truncateUtf16Safe } from './textBudget.js';
export {
  mergeHybridResults,
  selectHybridSearchResults,
  type HybridCandidate,
  type HybridKeywordResult,
  type HybridSearchResult,
  type HybridVectorResult,
  type RankedHybridResult,
} from './hybrid.js';
export {
  SEARCH_SOURCE_KINDS,
  admitCitedAnswer,
  admitSearchResult,
  citationPathProblem,
  type AnswerAdmission,
  type AnswerRefusalReason,
  type CitationRefusal,
  type CitationRefusalReason,
  type CitedAnswer,
  type CitedSearchHit,
  type SearchCitation,
  type SearchResultAdmission,
  type SearchSourceKind,
} from './citation.js';
export {
  DEFAULT_SEARCH_CHUNKING,
  MAX_EXCERPT_CHARS,
  chunkRecordsOf,
  excerptOf,
  type ChunkRecordsResult,
  type SearchChunkRecord,
  type SearchChunking,
  type SearchSourceText,
  type SkippedSource,
} from './chunkRecords.js';
export {
  DEFAULT_SEARCH_MAX_RESULTS,
  DEFAULT_SEARCH_MMR,
  DEFAULT_SEARCH_TEMPORAL_DECAY,
  NO_VECTOR_CANDIDATES,
  rankCitedResults,
  type CitedSearchOutcome,
  type KeywordCandidate,
  type VectorCandidate,
} from './citedSearch.js';
export { UNTRUSTED_EXCERPT_NOTICE, renderUntrustedExcerpt } from './untrustedExcerpt.js';
export { sensitiveContentProblem, sensitivePathProblem, type SensitiveReason } from './sensitiveContent.js';

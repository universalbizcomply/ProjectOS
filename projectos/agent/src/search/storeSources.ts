// Origin: original ProjectOS code
/**
 * WHAT A PROJECT'S INDEX IS REBUILT FROM (PROJECTOS-MEMORY-STORES1A).
 *
 * The index is derived, so it is rebuilt from the stores the project already keeps and holds no text that exists nowhere else:
 *
 *   plan memory        `.projectops/plan-*.json` and `.projectops/current-state-*.json`   indexed as `memory`
 *   execution records  `.projectops/execution/*.json`, other than findings              indexed as `sessions`
 *   findings           `.projectops/execution/*.findings.json`                           indexed as `sessions`
 *
 * A citation names the real file and its real lines. The text of a worker-written record (a findings record is the worker's
 * own) is untrusted data when it comes back, as every indexed text is: it is stored and returned, never read for meaning, and
 * it does not rank above a committed decision. Ranking by provenance is plan 3.3's.
 *
 * A LINK IS NOT FOLLOWED, A SECRET IS NOT INDEXED, AND WHAT IS LEFT OUT IS SAID. A path the stat cannot read, a link, a file
 * over the size cap, a binary file and a record holding a credential shape come back in `skipped` by path and reason, with
 * none of the text. The same caps as the document walk apply, and the index checks the secret shapes again at its boundary.
 *
 * A link is refused at `.projectops` and at `.projectops/execution` as well as at a record, and a secret is looked for in the text
 * and in the text with its escapes undone. It reads through a `DocumentFs`, and writes nothing.
 */
import { sensitiveContentProblem, type SearchSourceKind, type SearchSourceText } from '@projectos/core';
import type { DocumentFs } from './ports.js';
import { DEFAULT_MAX_DOCUMENT_BYTES, DEFAULT_MAX_TOTAL_BYTES, type CollectedDocuments, type SkippedDocument } from './documentSources.js';

const STORE_DIRECTORY = '.projectops';
const EXECUTION_DIRECTORY = 'execution';
const PLAN_MEMORY_NAME = /^(?:plan|current-state)-[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const EXECUTION_RECORD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const FINDINGS_SUFFIX = '.findings.json';
/** A project's records are a few hundred files. A directory with far more is reported, not walked without end. */
export const MAX_STORE_FILES_PER_DIRECTORY = 5_000;

type Found = SearchSourceText | SkippedDocument;

interface Listing {
  readonly directory: string;
  readonly source: SearchSourceKind;
  readonly accepts: (name: string) => boolean;
}

const LISTINGS: readonly Listing[] = [
  { directory: STORE_DIRECTORY, source: 'memory', accepts: (name) => PLAN_MEMORY_NAME.test(name) },
  { directory: `${STORE_DIRECTORY}/${EXECUTION_DIRECTORY}`, source: 'sessions', accepts: (name) => EXECUTION_RECORD_NAME.test(name) },
];

/** Every plan-memory, execution and findings record under `root`, in a stable order, with a project-relative `/` path. */
export function collectStoreSources(params: {
  readonly project: string;
  readonly root: string;
  readonly fs: DocumentFs;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}): CollectedDocuments {
  const maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const maxTotalBytes = params.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const { fs } = params;
  let totalBytes = 0;

  const recordAt = (source: SearchSourceKind, rel: string, size: number, mtimeMs: number): Found => {
    if (size > maxFileBytes) return { path: rel, reason: 'too-large' };
    if (totalBytes + size > maxTotalBytes) return { path: rel, reason: 'total-size' };
    const raw = fs.readText(`${params.root}/${rel}`);
    if (raw === null) return { path: rel, reason: 'unreadable' };
    const content = raw.replace(/^\ufeff/, '');
    if (content.includes('\0')) return { path: rel, reason: 'binary' };
    const secret = sensitiveContentProblem(content);
    if (secret !== null) return { path: rel, reason: secret };
    totalBytes += size;
    return { project: params.project, source, path: rel, content, mtimeMs };
  };

  const entryAt = (listing: Listing, name: string): readonly Found[] => {
    const rel = `${listing.directory}/${name}`;
    const stat = fs.stat(`${params.root}/${rel}`);
    if (stat === null) return [{ path: rel, reason: 'unreadable' }];
    if (stat.kind === 'link') return [{ path: rel, reason: 'link' }];
    if (stat.kind !== 'file') return [];
    return [recordAt(listing.source, rel, stat.size, stat.mtimeMs)];
  };

  /** Why a directory on the way to a listing may not be walked, or null; `absent` is an empty project and is not a problem. */
  const directoryProblem = (directory: string): SkippedDocument | 'absent' | null => {
    const stat = fs.stat(`${params.root}/${directory}`);
    if (stat === null) return 'absent';
    if (stat.kind === 'link') return { path: directory, reason: 'link' };
    return stat.kind === 'directory' ? null : { path: directory, reason: 'unreadable' };
  };

  const reported = new Set<string>();
  const found = LISTINGS.flatMap((listing) => {
    // EVERY DIRECTORY ON THE WAY IS ASKED, NOT ONLY THE ONE LISTED. A junction at `.projectops/execution` read as an ordinary
    // directory and indexed files from outside the project (fix round 1, M2). A link is reported once and nothing behind it is read.
    const chain = listing.directory.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
    for (const directory of chain) {
      const problem = directoryProblem(directory);
      if (problem === 'absent') return [];
      if (problem !== null) {
        if (reported.has(problem.path)) return [];
        reported.add(problem.path);
        return [problem];
      }
    }
    const names = [...fs.listDir(`${params.root}/${listing.directory}`)].filter(listing.accepts).sort();
    if (names.length > MAX_STORE_FILES_PER_DIRECTORY) return [{ path: listing.directory, reason: 'too-large' } as const];
    return names.flatMap((name) => entryAt(listing, name));
  });
  return {
    sources: found.filter((entry): entry is SearchSourceText => 'content' in entry),
    skipped: found.filter((entry): entry is SkippedDocument => 'reason' in entry),
  };
}

/** Which of the three stores a record path belongs to, for a report. Not used to decide anything. */
export function storeClassOfPath(path: string): 'plan-memory' | 'execution' | 'findings' | null {
  const prefix = `${STORE_DIRECTORY}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (rest.startsWith(`${EXECUTION_DIRECTORY}/`)) return rest.endsWith(FINDINGS_SUFFIX) ? 'findings' : 'execution';
  return PLAN_MEMORY_NAME.test(rest) ? 'plan-memory' : null;
}

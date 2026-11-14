// Origin: original ProjectOS code
/**
 * WHAT THE INDEX MAY READ (PROJECTOS-PORT-SEARCH1A).
 *
 * The walk is an allowlist. Only document extensions are read, so `.env`, keys, databases and source code never
 * reach an index by accident. Dot-entries and dependency or build directories are not entered at all, whatever
 * their case. A credential name or secret content is left out here too, and the index checks both again.
 *
 * A LINK IS NOT FOLLOWED. A symbolic link or a junction can point outside the project, and a citation names a
 * file inside it. It is reported, not read. What was left out and why comes back to the caller, so an index
 * that holds less than the tree says so. A file that cannot be read is reported the same way, and does not stop
 * the walk.
 *
 * THROUGH A PORT (STORES1A). The walk reads through a `DocumentFs`, built from the agent's `System` and an `lstat` probe,
 * and touches no file system of its own. `system.ts` has no `lstat`, so the probe is a separate port; see `ports.ts`.
 */
import { extname } from 'node:path';
import {
  citationPathProblem,
  sensitiveContentProblem,
  sensitivePathProblem,
  type SearchSourceText,
  type SensitiveReason,
} from '@projectos/core';
import type { DocumentFs } from './ports.js';

export const DOCUMENT_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx', '.txt'];
const UNENTERED_DIRECTORIES: readonly string[] = ['node_modules', 'dist', 'build', 'target', 'vendor', 'coverage'];
export const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export type SkippedReason = 'link' | 'too-large' | 'total-size' | 'binary' | 'unreadable' | 'uncitable-path' | SensitiveReason;

export interface SkippedDocument {
  readonly path: string;
  readonly reason: SkippedReason;
}

export interface CollectedDocuments {
  readonly sources: readonly SearchSourceText[];
  readonly skipped: readonly SkippedDocument[];
}

type Found = SearchSourceText | SkippedDocument;

/** Every document under `root`, in a stable order, with a project-relative `/` path. */
export function collectDocumentSources(params: {
  readonly project: string;
  readonly root: string;
  /** The file system the walk reads through. Required: there is no ambient one. */
  readonly fs: DocumentFs;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}): CollectedDocuments {
  const maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const maxTotalBytes = params.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const { fs } = params;
  let totalBytes = 0;

  const documentAt = (abs: string, rel: string, size: number, mtimeMs: number): Found => {
    if (totalBytes + size > maxTotalBytes) return { path: rel, reason: 'total-size' };
    const raw = fs.readText(abs);
    if (raw === null) return { path: rel, reason: 'unreadable' };
    const content = raw.replace(/^\ufeff/, '');
    if (content.includes('\0')) return { path: rel, reason: 'binary' };
    const secret = sensitiveContentProblem(content);
    if (secret !== null) return { path: rel, reason: secret };
    totalBytes += size;
    return { project: params.project, source: 'documents', path: rel, content, mtimeMs };
  };

  const entryAt = (relDir: string, name: string): readonly Found[] => {
    if (name.startsWith('.')) return [];
    const rel = relDir === '' ? name : `${relDir}/${name}`;
    const abs = `${params.root}/${rel}`;
    const stat = fs.stat(abs);
    if (stat === null) return [{ path: rel, reason: 'unreadable' }];
    if (stat.kind === 'link') return [{ path: rel, reason: 'link' }];
    if (stat.kind === 'directory') return UNENTERED_DIRECTORIES.includes(name.toLowerCase()) ? [] : visit(rel);
    if (stat.kind !== 'file' || !DOCUMENT_EXTENSIONS.includes(extname(name).toLowerCase())) return [];
    if (citationPathProblem(rel) !== null) return [{ path: rel, reason: 'uncitable-path' }];
    const named = sensitivePathProblem(rel);
    if (named !== null) return [{ path: rel, reason: named }];
    if (stat.size > maxFileBytes) return [{ path: rel, reason: 'too-large' }];
    return [documentAt(abs, rel, stat.size, stat.mtimeMs)];
  };

  const visit = (relDir: string): readonly Found[] => {
    // `listDir` answers an empty list for a directory that is not there, so the root is asked, and a root that is not a
    // directory is reported, not read as an empty project.
    if (relDir === '' && fs.stat(params.root)?.kind !== 'directory') return [{ path: '.', reason: 'unreadable' }];
    const names = fs.listDir(relDir === '' ? params.root : `${params.root}/${relDir}`);
    return [...names].sort().flatMap((name) => entryAt(relDir, name));
  };

  const found = visit('');
  return {
    sources: found.filter((entry): entry is SearchSourceText => 'content' in entry),
    skipped: found.filter((entry): entry is SkippedDocument => 'reason' in entry),
  };
}

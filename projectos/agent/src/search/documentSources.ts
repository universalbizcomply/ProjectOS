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
 * NOT ON THE SYSTEM PORT. `system.ts` has no `lstat`, and this walk needs one to see a link, so it uses `node:fs`.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  citationPathProblem,
  sensitiveContentProblem,
  sensitivePathProblem,
  type SearchSourceText,
  type SensitiveReason,
} from '@projectos/core';

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

const readUtf8 = (abs: string): string => readFileSync(abs, 'utf8');

/** Every document under `root`, in a stable order, with a project-relative `/` path. */
export function collectDocumentSources(params: {
  readonly project: string;
  readonly root: string;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly readText?: (abs: string) => string;
}): CollectedDocuments {
  const maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const maxTotalBytes = params.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const readText = params.readText ?? readUtf8;
  let totalBytes = 0;

  const documentAt = (abs: string, rel: string, size: number, mtimeMs: number): Found => {
    if (totalBytes + size > maxTotalBytes) return { path: rel, reason: 'total-size' };
    let raw: string;
    try {
      raw = readText(abs);
    } catch {
      return { path: rel, reason: 'unreadable' };
    }
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
    const abs = join(params.root, rel);
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' }];
    if (stat.isDirectory()) return UNENTERED_DIRECTORIES.includes(name.toLowerCase()) ? [] : visit(rel);
    if (!stat.isFile() || !DOCUMENT_EXTENSIONS.includes(extname(name).toLowerCase())) return [];
    if (citationPathProblem(rel) !== null) return [{ path: rel, reason: 'uncitable-path' }];
    const named = sensitivePathProblem(rel);
    if (named !== null) return [{ path: rel, reason: named }];
    if (stat.size > maxFileBytes) return [{ path: rel, reason: 'too-large' }];
    return [documentAt(abs, rel, stat.size, stat.mtimeMs)];
  };

  const visit = (relDir: string): readonly Found[] => {
    let names: readonly string[];
    try {
      names = readdirSync(relDir === '' ? params.root : join(params.root, relDir));
    } catch {
      return [{ path: relDir === '' ? '.' : relDir, reason: 'unreadable' }];
    }
    return [...names].sort().flatMap((name) => entryAt(relDir, name));
  };

  const found = visit('');
  return {
    sources: found.filter((entry): entry is SearchSourceText => 'content' in entry),
    skipped: found.filter((entry): entry is SkippedDocument => 'reason' in entry),
  };
}

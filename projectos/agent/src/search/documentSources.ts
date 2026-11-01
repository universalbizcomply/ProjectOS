// Origin: original ProjectOS code
/**
 * WHAT THE INDEX MAY READ (PROJECTOS-PORT-SEARCH1A).
 *
 * The walk is an allowlist. Only document extensions are read, so `.env`, keys, databases and source code never
 * reach an index by accident. Dot-entries and dependency or build directories are not entered at all.
 *
 * A LINK IS NOT FOLLOWED. A symbolic link or a junction can point outside the project, and a citation names a
 * file inside it. It is reported, not read. What was left out and why comes back to the caller, so an index
 * that holds less than the tree says so.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { citationPathProblem, type SearchSourceText } from '@projectos/core';

export const DOCUMENT_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx', '.txt'];
const UNENTERED_DIRECTORIES: readonly string[] = ['node_modules', 'dist', 'build', 'target', 'vendor', 'coverage'];
export const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export type SkippedReason = 'link' | 'too-large' | 'binary' | 'uncitable-path';

export interface SkippedDocument {
  readonly path: string;
  readonly reason: SkippedReason;
}

export interface CollectedDocuments {
  readonly sources: readonly SearchSourceText[];
  readonly skipped: readonly SkippedDocument[];
}

function documentAt(project: string, abs: string, rel: string, mtimeMs: number): SearchSourceText | SkippedDocument {
  const content = readFileSync(abs, 'utf8').replace(/^\ufeff/, '');
  if (content.includes('\0')) return { path: rel, reason: 'binary' };
  return { project, source: 'documents', path: rel, content, mtimeMs };
}

/** Every document under `root`, in a stable order, with a project-relative `/` path. */
export function collectDocumentSources(params: {
  readonly project: string;
  readonly root: string;
  readonly maxFileBytes?: number;
}): CollectedDocuments {
  const maxFileBytes = params.maxFileBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;

  const visit = (relDir: string): readonly (SearchSourceText | SkippedDocument)[] =>
    readdirSync(relDir === '' ? params.root : join(params.root, relDir)).sort().flatMap((name) => {
      if (name.startsWith('.')) return [];
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const abs = join(params.root, rel);
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' as const }];
      if (stat.isDirectory()) return UNENTERED_DIRECTORIES.includes(name) ? [] : visit(rel);
      if (!stat.isFile() || !DOCUMENT_EXTENSIONS.includes(extname(name).toLowerCase())) return [];
      if (citationPathProblem(rel) !== null) return [{ path: rel, reason: 'uncitable-path' as const }];
      if (stat.size > maxFileBytes) return [{ path: rel, reason: 'too-large' as const }];
      return [documentAt(params.project, abs, rel, stat.mtimeMs)];
    });

  const found = visit('');
  return {
    sources: found.filter((entry): entry is SearchSourceText => 'content' in entry),
    skipped: found.filter((entry): entry is SkippedDocument => 'reason' in entry),
  };
}

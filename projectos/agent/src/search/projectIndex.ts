// Origin: original ProjectOS code
/**
 * ONE INDEX FILE PER TENANT AND PROJECT (PROJECTOS-MEMORY-STORES1A).
 *
 * `searchIndexFileName` in core names the file from the pair by a collision-proof encoding, with no id text in it, so
 * nothing in either id can reach a path. This joins that name to the directory the indexes live in and opens it. Two
 * projects therefore never share a file, and never share the term statistics a file holds.
 *
 * THE DIRECTORY IS NOT AN ID. It is the caller's, from the installation, and it is made if it is not there by an injected
 * function, so this module touches no file system of its own. A refusal is a value; an index that cannot open throws, as
 * `openSearchIndex` does.
 */
import { searchIndexFileName, type SearchIndexOwner, type SearchIndexKeyRefusal } from '@projectos/core';
import { openSearchIndex, type SearchIndex } from './localIndex.js';
import type { SearchClock } from './ports.js';

export interface ProjectIndexDeps {
  readonly clock: SearchClock;
  /** Makes the directory the index file lives in. Throws when it cannot. */
  readonly ensureDirectory: (directory: string) => void;
}

export type ProjectIndexOpening =
  | { readonly ok: true; readonly index: SearchIndex; readonly location: string }
  | { readonly ok: false; readonly reason: SearchIndexKeyRefusal };

/** The path of one owner's index file under `directory`, or why there is none. */
export function projectIndexLocation(directory: string, owner: SearchIndexOwner): { readonly ok: true; readonly location: string } | { readonly ok: false; readonly reason: SearchIndexKeyRefusal } {
  const named = searchIndexFileName(owner);
  if (!named.ok) return named;
  return { ok: true, location: `${directory.replace(/[\/]+$/, '')}/${named.fileName}` };
}

/** Open the index of one tenant's one project, in its own file under `directory`. The caller closes it. */
export function openProjectSearchIndex(directory: string, owner: SearchIndexOwner, deps: ProjectIndexDeps): ProjectIndexOpening {
  const where = projectIndexLocation(directory, owner);
  if (!where.ok) return where;
  deps.ensureDirectory(directory);
  return { ok: true, index: openSearchIndex(where.location, { owner, clock: deps.clock }), location: where.location };
}

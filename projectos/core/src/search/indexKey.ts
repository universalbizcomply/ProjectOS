// Origin: original ProjectOS code
/**
 * WHICH FILE HOLDS WHICH PROJECT'S INDEX (PROJECTOS-MEMORY-STORES1A).
 *
 * One FTS table for every project in a file made BM25 statistics a shared quantity: one project's documents moved another's
 * scores. So an index file belongs to ONE tenant and ONE project, and this names it.
 *
 * THE NAME IS A HASH OF THE PAIR, NOT THE PAIR. A project id may carry uppercase letters and dots, and a tenant id and a
 * project id may be spelled so that `tenant + '-' + project` is the same string for two different pairs, and a case-folding
 * file system would join `Alpha` and `alpha`. The pair is therefore written as a JSON array, which cannot be re-split,
 * and hashed, so no two pairs share a name and no part of either id ever reaches a path. Each id is checked against the
 * registry's own shapes first, so a value that is not an id is refused, not hashed.
 *
 * Pure: no I/O.
 */
import { sha256Hex } from '../execution/evidence.js';
import { isProjectId, isTenantId } from '../tenant.js';

/** Bumped only if the naming changes, so an old name can never be read as a new one. */
export const SEARCH_INDEX_KEY_DOMAIN = 'projectos.search-index-file/1';

export interface SearchIndexOwner {
  readonly tenant: string;
  readonly project: string;
}

export type SearchIndexKeyRefusal = 'invalid-tenant' | 'invalid-project';

export type SearchIndexFileName =
  | { readonly ok: true; readonly fileName: string }
  | { readonly ok: false; readonly reason: SearchIndexKeyRefusal };

/** The file name for one tenant's one project, or why there is none. It has no separator, no dot segment and no id text. */
export function searchIndexFileName(owner: SearchIndexOwner): SearchIndexFileName {
  if (!isTenantId(owner.tenant)) return { ok: false, reason: 'invalid-tenant' };
  if (!isProjectId(owner.project)) return { ok: false, reason: 'invalid-project' };
  return { ok: true, fileName: `idx-${sha256Hex(JSON.stringify([SEARCH_INDEX_KEY_DOMAIN, owner.tenant, owner.project]))}.sqlite` };
}

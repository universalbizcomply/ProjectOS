// Origin: original ProjectOS code
/**
 * Fetched pages, remembered and slots, held (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * EVERY STORE IS KEYED BY TENANT AND PROJECT. A page fetched for one tenant is never served to another, whatever the
 * URL: the key starts with `<tenant>/<project>`, and a read checks the page's own scope again, so a bug in the key
 * still cannot cross a scope. Ids cannot contain `/`, so one scope's key is never a prefix of another's.
 *
 * EVERY STORE IS BOUNDED. A cached page carries no limit, so a full scope drops its oldest page, and a full cache
 * drops its oldest scope. The slot book carries a limit, a count of fetches in flight, and is not evicted while a count
 * is held: an entry leaves only when its last slot is released, so a full book refuses new scopes instead of
 * forgetting one that is still counting.
 *
 * A PAGE IS SERVED FOR ITS TIME ONLY. Age is read from the injected clock, never from the page, and a read under a
 * policy other than the one the page was fetched under is a miss.
 *
 * In memory, and no more: persistence is a later phase.
 */

import { isProjectId, isTenantId } from '../tenant.js';
import type { FetchedPage } from './webFetch.js';
import type { ResearchScope } from './ports.js';

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

export const scopeKeyOf = (scope: ResearchScope): string => `${scope.tenant}/${scope.project}`;
export const isResearchScope = (scope: unknown): scope is ResearchScope => {
  const row = scope as Partial<ResearchScope> | null;
  return typeof row === 'object' && row !== null && isTenantId(row.tenant) && isProjectId(row.project);
};

export interface PageCache {
  readonly get: (scope: ResearchScope, urlKey: string, policyDigest: string, nowMs: number) => FetchedPage | null;
  readonly put: (scope: ResearchScope, urlKey: string, page: FetchedPage, nowMs: number) => void;
}

export interface PageCacheOptions {
  readonly ttlMs: number;
  readonly maxPagesPerScope: number;
  readonly maxScopes: number;
}

interface Held {
  readonly page: FetchedPage;
  readonly storedAtMs: number;
}

export const DEFAULT_PAGE_CACHE: PageCacheOptions = { ttlMs: 15 * 60_000, maxPagesPerScope: 32, maxScopes: 256 };

export function createPageCache(options: PageCacheOptions = DEFAULT_PAGE_CACHE): PageCache {
  if (!isCount(options.ttlMs) || !isCount(options.maxPagesPerScope) || !isCount(options.maxScopes)) throw new Error('the page cache needs a whole positive time, page count and scope count');
  const scopes = new Map<string, Map<string, Held>>();
  return {
    get: (scope, urlKey, policyDigest, nowMs) => {
      if (!isResearchScope(scope)) return null;
      const pages = scopes.get(scopeKeyOf(scope));
      const held = pages?.get(urlKey);
      if (pages === undefined || held === undefined) return null;
      if (held.page.scope.tenant !== scope.tenant || held.page.scope.project !== scope.project) {
        pages.delete(urlKey);
        return null;
      }
      if (held.page.policyDigest !== policyDigest || !(nowMs >= held.storedAtMs)) return null;
      if (nowMs - held.storedAtMs >= options.ttlMs) {
        pages.delete(urlKey);
        return null;
      }
      return held.page;
    },
    put: (scope, urlKey, page, nowMs) => {
      if (!isResearchScope(scope) || page.scope.tenant !== scope.tenant || page.scope.project !== scope.project || !Number.isFinite(nowMs)) return;
      const key = scopeKeyOf(scope);
      const pages = scopes.get(key) ?? new Map<string, Held>();
      scopes.delete(key);
      pages.delete(urlKey);
      pages.set(urlKey, { page, storedAtMs: nowMs });
      while (pages.size > options.maxPagesPerScope) pages.delete(pages.keys().next().value as string);
      scopes.set(key, pages);
      while (scopes.size > options.maxScopes) scopes.delete(scopes.keys().next().value as string);
    },
  };
}

export interface FetchSlots {
  /** A release function, or null when this scope has no slot to give. The release is safe to call twice. */
  readonly acquire: (scope: ResearchScope) => (() => void) | null;
}

export function createFetchSlots(maxPerScope: number, maxScopes = 1024): FetchSlots {
  if (!isCount(maxPerScope) || !isCount(maxScopes)) throw new Error('the slot book needs whole positive counts');
  const inFlight = new Map<string, number>();
  return {
    acquire: (scope) => {
      if (!isResearchScope(scope)) return null;
      const key = scopeKeyOf(scope);
      const held = inFlight.get(key) ?? 0;
      if (held >= maxPerScope || (held === 0 && inFlight.size >= maxScopes)) return null;
      inFlight.set(key, held + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const now = (inFlight.get(key) ?? 1) - 1;
        if (now <= 0) inFlight.delete(key);
        else inFlight.set(key, now);
      };
    },
  };
}

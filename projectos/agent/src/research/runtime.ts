// Origin: original ProjectOS code
/**
 * One research runtime for the agent (PROJECTOS-PORT-RESEARCH1A, C16): the core's loop with its stores made once.
 *
 * WHAT THIS ADDS. The page cache and the slot book are made here, once, and every run shares them: both are keyed by
 * tenant and project, so sharing them shares nothing between scopes, and a cache that lived for one run would never be
 * a cache. The website policy comes from committed bytes (`committedPolicy.ts`), and a runtime is not made without
 * one: no policy file, or a malformed one, is a refusal to start, never an open door.
 *
 * WHAT THIS DOES NOT DO. It opens nothing. Time, DNS, HTTP, the planner (a model call) and the spend grant are ports
 * handed in, and the ports a later phase supplies must keep the contract in the core's `ports.ts`. Nothing calls this
 * file yet: the wiring phase is the first caller.
 */

import {
  READABLE_TEXT_EXTRACTOR,
  createFetchSlots,
  createPageCache,
  runResearch,
  type HttpFetchPort,
  type PlannerPort,
  type ResearchClock,
  type ResearchRequest,
  type ResearchRun,
  type ResolverPort,
  type SpendGrant,
  type WebContentExtractor,
  type WebSearchProvider,
} from '@projectos/core';
import { loadCommittedWebsitePolicy, type CommittedRead } from './committedPolicy.js';

export const DEFAULT_SLOTS_PER_SCOPE = 2;

export interface ResearchRuntimeParams {
  readonly read: CommittedRead;
  readonly policyPath: string;
  readonly resolver: ResolverPort;
  readonly fetch: HttpFetchPort;
  readonly clock: ResearchClock;
  readonly planner: PlannerPort;
  readonly grant: SpendGrant;
  readonly providers: readonly WebSearchProvider[];
  readonly extractors?: readonly WebContentExtractor[];
  readonly slotsPerScope?: number;
}

export interface ResearchRuntime {
  readonly policyCommit: string;
  readonly run: (request: ResearchRequest) => Promise<ResearchRun>;
}

export type ResearchRuntimeResult = { readonly ok: true; readonly runtime: ResearchRuntime } | { readonly ok: false; readonly problems: readonly string[] };

export function createResearchRuntime(params: ResearchRuntimeParams): ResearchRuntimeResult {
  const loaded = loadCommittedWebsitePolicy({ read: params.read, path: params.policyPath });
  if (!loaded.ok) return loaded;
  let cache: ReturnType<typeof createPageCache>;
  let slots: ReturnType<typeof createFetchSlots>;
  try {
    cache = createPageCache();
    slots = createFetchSlots(params.slotsPerScope ?? DEFAULT_SLOTS_PER_SCOPE);
  } catch {
    return { ok: false, problems: ['the slot count must be a whole positive number'] };
  }
  const deps = {
    resolver: params.resolver,
    fetch: params.fetch,
    clock: params.clock,
    policy: loaded.policy,
    extractors: params.extractors ?? [READABLE_TEXT_EXTRACTOR],
    cache,
    slots,
    providers: params.providers,
    grant: params.grant,
    planner: params.planner,
  };
  return { ok: true, runtime: { policyCommit: loaded.commit, run: (request) => runResearch(request, deps) } };
}

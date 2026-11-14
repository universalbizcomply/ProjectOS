// Origin: original ProjectOS code
/**
 * The agent's half of cited research (PROJECTOS-PORT-RESEARCH1A): the website policy from committed bytes, and a runtime
 * that shares the page cache and the slot book across runs. Nothing calls it yet: a later phase wires it.
 */
export { loadCommittedWebsitePolicy, type CommittedRead, type PolicyLoad } from './committedPolicy.js';
export { DEFAULT_SLOTS_PER_SCOPE, createResearchRuntime, type ResearchRuntime, type ResearchRuntimeParams, type ResearchRuntimeResult } from './runtime.js';

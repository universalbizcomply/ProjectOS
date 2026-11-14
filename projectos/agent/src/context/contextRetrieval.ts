// Origin: original ProjectOS code
/**
 * GATHERING STORED TEXT FOR ONE RUN (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * This is the only place the context manager reads memory, and it is keyed on a `ContextRetrievalKey` that core worked out from
 * the admitted run envelope. Nothing here takes a tenant, a project or a path from a request, a stored file or a worker.
 *
 *   APPROVED MEMORY     `.projectops/memory/MEMORY.md` and `USER.md`, from COMMITTED BYTES (`readCommittedMemoryFile`): a copy
 *                       that differs from HEAD, a link, a file over the cap is refused with its own code and none of its text is
 *                       returned. The entries come from those bytes. An entry is ALSO needed in the provenance record the owner
 *                       approved (`readMemoryStore`, a working-tree file: the owner's approval is read from it, the entry text is
 *                       not). An entry with no whole record is NOT SHOWN, and it is not silent: each is a failure
 *                       `MEMORY_ENTRY_NO_PROVENANCE`, by a hash of the entry, so the record names what was left out and why.
 *                       It is withheld and named, not a stop: whether an entry would have been a decision is exactly what the
 *                       missing record says, so it cannot be told, and stopping every run of a project for a note the owner never
 *                       approved would lock it for the wrong reason. The advice the run prints says the owner approves or removes it.
 *   APPROVED DECISIONS  the entries whose record says `decision` come out on their own, as `ApprovedDecision`s, to be loaded
 *                       into the thread whatever the budget says. They are not repeated inside the memory item.
 *   COMMITTED DECISIONS `.projectops/closure/decisions/<phase>.json` for each phase this one depends on (at most twenty), as
 *                       committed. The brief's `dependsOn` is derived from the approved plan, so a worker names none of them.
 *   PLAN MEMORY         the plan-memory paths the caller passes, only when they are of that shape (at most eight).
 *   THE INDEX           the index of THIS tenant's THIS project (`openIndex(owner)`), asked the phase's own description, at
 *                       most five hits, each one's citation project compared to the key and a hit that names another project
 *                       dropped and recorded. A hit is a CLAIM: it carries no proof, so it ranks as a recollection.
 *
 * A file that is simply not in HEAD is nothing to show and not a failure. Every other refusal is a failure with a closed code,
 * and a failure never carries text. The index is closed on every path.
 *
 * A FAILURE ON A SOURCE THAT CAN HOLD A DECISION IS BLOCKING (review round 1, item 5): the approved memory files, their provenance
 * records, and the committed decision of a phase this one depends on. A worker that is not shown an approved or committed decision
 * because a file could not be read would act as if there were none, so the manager stops the run and names the fix. A plan-memory
 * path and the index are not decisions: a failure there is withheld by code and the run goes on.
 */
import {
  citationFreshnessMarkOf,
  citationFreshnessOfValue,
  isMemoryEntryProvenance,
  joinMemoryEntries,
  memoryEntryHash,
  parseMemoryEntries,
  provenanceKindOfPath,
  type ApprovedDecision,
  type CitedSearchHit,
  type CommittedProof,
  type ContextRetrievalKey,
  type MemoryEntryProvenance,
  type MemoryTarget,
  type ProvenanceKind,
} from '@projectos/core';
import { readCommittedMemoryFile } from '../memory/committedBytes.js';
import type { ContextManagerPorts } from './contextPorts.js';

export const MAX_DECISION_PHASES = 20;
export const MAX_PLAN_MEMORY_PATHS = 8;
export const MAX_INDEX_HITS = 5;
/** The phase description is the query: a few paragraphs at most, and a hit for ANY of its terms (an AND of them all would find nothing). */
export const MAX_QUERY_CHARS = 1000;

export interface ContextRetrievalRequest {
  readonly root: string;
  /** The phase's own description, from the brief. It is the whole query. */
  readonly query: string;
  readonly dependsOn: readonly string[];
  readonly planMemoryPaths: readonly string[];
}

export interface ContextRead {
  readonly id: string;
  readonly kind: ProvenanceKind;
  readonly text: string;
  /** Minted by the committed read that produced `text`; null for anything an index returned. */
  readonly proof: CommittedProof | null;
  readonly source: 'committed' | 'index';
  readonly freshness: string | null;
}

export interface ContextFailure {
  readonly id: string;
  readonly code: string;
  /** True when the source can hold a decision, so the run must not go on without it. */
  readonly blocking: boolean;
}

export interface ContextRetrieval {
  readonly reads: readonly ContextRead[];
  readonly decisions: readonly ApprovedDecision[];
  readonly failures: readonly ContextFailure[];
}

const MEMORY_FILES: readonly { readonly target: MemoryTarget; readonly path: string }[] = [
  { target: 'memory', path: '.projectops/memory/MEMORY.md' },
  { target: 'user', path: '.projectops/memory/USER.md' },
];

const NOT_IN_HEAD = 'COMMITTED_NOT_IN_HEAD';
/** A committed memory entry the owner has no approval record for: it is withheld by this code and never shown. */
export const MEMORY_ENTRY_NO_PROVENANCE = 'MEMORY_ENTRY_NO_PROVENANCE';
const NO_PROVENANCE = MEMORY_ENTRY_NO_PROVENANCE;

function approvedMemory(ports: ContextManagerPorts, root: string): { reads: ContextRead[]; decisions: ApprovedDecision[]; failures: ContextFailure[] } {
  const reads: ContextRead[] = [];
  const decisions: ApprovedDecision[] = [];
  const failures: ContextFailure[] = [];
  for (const { target, path } of MEMORY_FILES) {
    const committed = readCommittedMemoryFile({ git: ports.git, fs: ports.fs }, root, path);
    if (!committed.ok) {
      if (committed.code !== NOT_IN_HEAD) failures.push({ id: path, code: committed.code, blocking: true });
      continue;
    }
    const store = ports.readMemoryStore(target);
    if (!store.ok) {
      failures.push({ id: path, code: store.refusal.code, blocking: true });
      continue;
    }
    const recordOf = (entry: string): MemoryEntryProvenance | null => {
      const hash = memoryEntryHash(entry);
      const record = store.value.provenance.get(hash);
      return isMemoryEntryProvenance(hash, record) ? record : null;
    };
    const shown: string[] = [];
    for (const entry of parseMemoryEntries(committed.read.text)) {
      const record = recordOf(entry);
      if (record === null) {
        failures.push({ id: `${path}#${memoryEntryHash(entry).slice(7, 19)}`, code: NO_PROVENANCE, blocking: false });
        continue;
      }
      if (record.kind === 'decision') decisions.push({ target, entry, record });
      else shown.push(entry);
    }
    if (shown.length > 0) reads.push({ id: path, kind: 'approved-memory', text: joinMemoryEntries(shown), proof: committed.read.proof, source: 'committed', freshness: null });
  }
  return { reads, decisions, failures };
}

/** One committed file of the given kind, as a read or as a failure. A file not in HEAD is neither. */
function committedFile(ports: ContextManagerPorts, root: string, path: string, blocking: boolean, reads: ContextRead[], failures: ContextFailure[]): void {
  const committed = readCommittedMemoryFile({ git: ports.git, fs: ports.fs }, root, path);
  if (committed.ok) reads.push({ id: path, kind: committed.read.kind, text: committed.read.text, proof: committed.read.proof, source: 'committed', freshness: null });
  else if (committed.code !== NOT_IN_HEAD) failures.push({ id: path.slice(0, 200), code: committed.code, blocking });
}

function firstOf(list: readonly string[], max: number, label: string, failures: ContextFailure[]): readonly string[] {
  const kept = list.slice(0, max);
  for (const extra of list.slice(max)) failures.push({ id: typeof extra === 'string' ? extra.slice(0, 200) : label, code: 'CONTEXT_TOO_MANY_PATHS', blocking: false });
  return kept;
}

function indexHits(ports: ContextManagerPorts, key: ContextRetrievalKey, query: string, reads: ContextRead[], failures: ContextFailure[]): void {
  if (ports.openIndex === null) return;
  let index: ReturnType<NonNullable<ContextManagerPorts['openIndex']>> = null;
  try {
    index = ports.openIndex({ tenant: key.tenant, project: key.project });
    if (index === null) return;
    const outcome = index.search({ project: key.project, query: query.slice(0, MAX_QUERY_CHARS), maxResults: MAX_INDEX_HITS, matchAny: true });
    if (!outcome.ok) {
      failures.push({ id: 'index', code: 'CONTEXT_INDEX_UNAVAILABLE', blocking: false });
      return;
    }
    for (const hit of outcome.hits.slice(0, MAX_INDEX_HITS)) {
      const read = indexRead(hit, key, failures);
      if (read !== null) reads.push(read);
    }
  } catch {
    failures.push({ id: 'index', code: 'CONTEXT_INDEX_UNAVAILABLE', blocking: false });
  } finally {
    try {
      index?.close();
    } catch {
      // A close that fails leaves nothing the run reads.
    }
  }
}

function indexRead(hit: CitedSearchHit, key: ContextRetrievalKey, failures: ContextFailure[]): ContextRead | null {
  const { project, path, startLine, endLine } = hit.citation;
  const id = `index:${path}:${startLine}-${endLine}`;
  if (project !== key.project) {
    failures.push({ id, code: 'CONTEXT_WRONG_PROJECT', blocking: false });
    return null;
  }
  const judged = citationFreshnessOfValue(hit.citation.freshness);
  return {
    id,
    kind: provenanceKindOfPath(path) ?? 'recollection',
    text: hit.untrustedText,
    proof: null,
    source: 'index',
    freshness: judged === null ? 'stale:head-unknown' : citationFreshnessMarkOf(judged),
  };
}

/** Everything stored that this run may be shown, for the project the envelope names. Reads only. */
export function retrieveStoredContext(ports: ContextManagerPorts, key: ContextRetrievalKey, request: ContextRetrievalRequest): ContextRetrieval {
  const failures: ContextFailure[] = [];
  const memory = approvedMemory(ports, request.root);
  const reads: ContextRead[] = [...memory.reads];
  failures.push(...memory.failures);
  const phases = firstOf(request.dependsOn, MAX_DECISION_PHASES, 'dependsOn', failures);
  for (const phase of phases) committedFile(ports, request.root, `.projectops/closure/decisions/${phase}.json`, true, reads, failures);
  const plans = firstOf(request.planMemoryPaths, MAX_PLAN_MEMORY_PATHS, 'planMemoryPaths', failures);
  for (const path of plans) committedFile(ports, request.root, path, false, reads, failures);
  indexHits(ports, key, request.query, reads, failures);
  return { reads, decisions: memory.decisions, failures };
}

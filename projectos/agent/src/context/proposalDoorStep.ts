// Origin: original ProjectOS code
/**
 * WHAT THE LOOP DOES WITH THE PROPOSAL DOOR'S ANSWER (PROJECTOS-PROPOSAL-DOOR-WIRING1A, plan v1.38).
 *
 * `loop/runner.ts` is the one caller of `openProposalDoor`. It runs after the worker's changes and the checks were judged, and before the
 * evidence is written. This module is what it does with the answer, so that the runner's own edit stays one call and its pins stay where they were:
 *
 *   THE LINES   one per accepted or refused entry, carrying a class, an index, a closed code, an id and a hash, and NEVER the worker's text
 *               or the door's message (rule DW-11). A record with many entries prints the first few and counts the rest.
 *   THE FILES   `doorCreatedPaths` names the proposal files the door made, from the ids it reported and from nothing else: a duplicate made none.
 *   THE GUARD   `afterProposalDoor` re-baselines the store guard for exactly those files (`rebaseStoreGuard`), so the kernel's own proposals are not
 *               refused in the next attempt as a worker's write. A worker's file beside them still is.
 *
 * It writes nothing and proposes nothing itself: the door already did, and this only reads the stores again.
 */
import { rebaseStoreGuard, type StoreGuardBefore, type StoreGuardSystem } from './contextStoreGuard.js';
import type { DoorEntryOutcome, ProposalDoorOutcome } from '../memory/proposalDoor.js';
import type { DocumentFs } from '../search/ports.js';

/** Entries printed one by one; past this the rest are counted. */
export const MAX_DOOR_LINES = 20;

const STORE_OF = { memory: '.projectops/memory/proposals', skill: '.projectops/skills/proposals' } as const;

/** The project-relative path of each proposal file the door made: an accepted entry that was not a duplicate. */
export function doorCreatedPaths(outcome: ProposalDoorOutcome): readonly string[] {
  return outcome.entries.flatMap((entry) => (entry.ok && !entry.duplicate ? [`${STORE_OF[entry.class]}/${entry.id}.json`] : []));
}

function lineOf(entry: DoorEntryOutcome): string {
  const where = entry.index === null ? 'record' : `entry ${entry.index}`;
  if (entry.ok) return `  proposal ${where}: ${entry.class} ${entry.id} ${entry.proposalHash} ${entry.duplicate ? 'already pending (duplicate, none made)' : 'pending'}`;
  return `  proposal ${where}: ${entry.class === null ? 'unclassified' : entry.class} REFUSED (${entry.code})`;
}

/** The run output for one door call. Codes, indexes, ids and hashes; no worker text, no message. */
export function doorOutcomeLines(outcome: ProposalDoorOutcome): readonly string[] {
  if (outcome.findings === 'absent') return [];
  const accepted = outcome.entries.filter((entry) => entry.ok);
  const duplicates = accepted.filter((entry) => entry.ok && entry.duplicate).length;
  const heading = `  proposal door: findings ${outcome.findings}; ${accepted.length - duplicates} new pending, ${duplicates} already pending, ${outcome.entries.length - accepted.length} refused`;
  const shown = outcome.entries.slice(0, MAX_DOOR_LINES).map(lineOf);
  const rest = outcome.entries.length - shown.length;
  return [heading, ...shown, ...(rest > 0 ? [`  and ${rest} more entries not listed`] : [])];
}

export interface AfterDoor {
  readonly lines: readonly string[];
  /** The baseline every later judgement compares against: the new one when the door's files were absorbed, else the one it was. */
  readonly baseline: StoreGuardBefore;
}

/** Say what the door did, and take the store baseline again for exactly the files it made. */
export function afterProposalDoor(sys: StoreGuardSystem, root: string, fs: DocumentFs, baseline: StoreGuardBefore, outcome: ProposalDoorOutcome): AfterDoor {
  const lines = doorOutcomeLines(outcome);
  const made = doorCreatedPaths(outcome);
  if (made.length === 0) return { lines, baseline };
  const rebased = rebaseStoreGuard(sys, root, fs, baseline, made);
  const note = rebased.absorbed ? [] : ['  proposal door: the store baseline could not be taken again, so the next judgement will name what changed (MEMORY_STORE_CHANGED)'];
  return { lines: [...lines, ...note], baseline: rebased.baseline };
}

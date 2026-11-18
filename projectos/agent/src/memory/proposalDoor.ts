// Origin: original ProjectOS code
/**
 * THE ONE DOOR, ON THE AGENT'S SYSTEM PORT (PROJECTOS-MEMORY-STORES1A).
 *
 * A worker asks for a memory or a skill by adding an entry to the `proposals` list of its findings record. This turns each
 * accepted entry into a PENDING proposal, through the queues that already exist: `proposeMemoryWrite` for memory and
 * `proposeSkill` for skills. There is no second queue, and nothing here writes a store, promotes a skill or approves anything:
 * the owner decides a memory proposal over its hash, and an independent reviewer decides a skill, as before.
 *
 * WHO PROPOSED IS THE KERNEL'S TO SAY. The caller (author, role, session) is passed in by the code that ran the worker, and
 * an entry that tries to name its own is refused by core before it gets here. A caller in the owner's role is refused too:
 * the findings record is the worker's, and text from it must not ride under the owner's authority. A skill is always a
 * proposal; its origin is never read from the record.
 *
 * THE RECORD IS DATA. It is parsed once from text, size-capped before parsing, read by core's `readFindingsProposals`, which
 * is handed `util.types.isProxy` here (core loads in a browser and may not import `node:util`), and every entry is answered, accepted or refused, each with a machine-readable code and no worker text. Asked twice with the same
 * record, an entry that is already pending comes back as a duplicate of that proposal, not a second one.
 *
 * WIRED (PROJECTOS-PROPOSAL-DOOR-WIRING1A): `loop/runner.ts` is the one caller, once per attempt after the checks were judged and before the
 * evidence is written. It passes `state`, the checkout identity and the installation's state directory, so a skill proposal is minted and can
 * be reviewed; without it a skill proposal is pending and readable and can never be promoted.
 */
import { types } from 'node:util';
import { normalizedEntryKey, readFindingsProposals, type FindingsMemoryRequest, type FindingsSkillRequest, type ProposalDoorCode, type Role } from '@projectos/core';
import type { SkillStatePorts } from '../skills/skillMint.js';
import { listPendingSkillProposals, proposeSkill } from '../skills/skillQueue.js';
import type { System } from '../system.js';
import { listPendingMemoryProposals, proposeMemoryWrite } from './proposalQueue.js';

/** A findings record is a small file. Over this it is refused unread, so the parse is bounded by this and not by the worker. */
export const MAX_FINDINGS_RECORD_CHARS = 1_048_576;
/** What one author may have waiting for the owner through the door, so one worker cannot fill the queue the owner reads (fix round 1, L2). */
export const MAX_PENDING_MEMORY_PER_AUTHOR = 10;

export type AgentDoorCode =
  | 'PROPOSAL_DOOR_CALLER_NOT_WORKER'
  | 'PROPOSAL_DOOR_UNREADABLE'
  | 'PROPOSAL_DOOR_TOO_LARGE'
  | 'PROPOSAL_DOOR_AUTHOR_QUEUE_FULL'
  | 'PROPOSAL_DOOR_BUDGET';

/**
 * Whether one more proposal fits in the room the stores are allowed (PROJECTOS-PROPOSAL-DOOR-WIRING1A, rule DW-12). The loop gives it, measured the way the store digest
 * measures, so a worker cannot fill the stores past what the guard can digest and lock every later run out. Absent, nothing is measured (a caller that is not the loop).
 */
export type ProposalBudget = (entry: FindingsMemoryRequest | FindingsSkillRequest) => boolean;

const overBudget = (index: number, entryClass: 'memory' | 'skill'): DoorEntryOutcome => ({
  ok: false,
  index,
  class: entryClass,
  code: 'PROPOSAL_DOOR_BUDGET',
  message: 'The memory and skill stores have no room left for this proposal, so it was not made. The owner decides what is waiting, and then it can be asked again.',
});

/** Who is asking, from the kernel. Never read from the record. */
export interface ProposalDoorCaller {
  readonly author: string;
  readonly role: Role;
  readonly session: string;
}

export type DoorEntryOutcome =
  | {
      readonly ok: true;
      readonly index: number;
      readonly class: 'memory' | 'skill';
      readonly id: string;
      /** The hash the decider reviews. */
      readonly proposalHash: string;
      readonly state: 'pending';
      /** True when an identical proposal was already pending and no second one was made. */
      readonly duplicate: boolean;
    }
  | {
      readonly ok: false;
      /** The position in the record's list, or null when the record itself was refused. */
      readonly index: number | null;
      readonly class: 'memory' | 'skill' | null;
      readonly code: string;
      /** Neutral: it quotes none of the worker's text. */
      readonly message: string;
    };

export interface ProposalDoorOutcome {
  readonly findings: 'absent' | 'read' | 'unreadable';
  readonly entries: readonly DoorEntryOutcome[];
}

const whole = (code: ProposalDoorCode | AgentDoorCode, message: string): DoorEntryOutcome => ({ ok: false, index: null, class: null, code, message });

function parsedRecord(text: string): { readonly ok: true; readonly record: unknown } | { readonly ok: false } {
  try {
    return { ok: true, record: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

const sameAuthor = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * THE TARGET IS PART OF THE ENTRY (fix round, LOW-1). Two replaces with the same new content that act on different entries, or two decisions that point at different
 * ledger records, are different requests. A held proposal keeps the whole entry its `oldText` resolved to, so a request names the same one when its `oldText` is found in it.
 */
function sameTarget(held: { readonly targetEntry: string | null; readonly ledgerRef: string | null }, request: FindingsMemoryRequest['request']): boolean {
  if (held.ledgerRef !== (request.ledgerRef ?? null)) return false;
  const wantedOld = normalizedEntryKey(request.oldText ?? '');
  if (wantedOld === '') return held.targetEntry === null;
  return held.targetEntry !== null && normalizedEntryKey(held.targetEntry).includes(wantedOld);
}

function memoryEntry(sys: System, root: string, caller: ProposalDoorCaller, one: FindingsMemoryRequest, budget?: ProposalBudget): DoorEntryOutcome {
  const { request } = one;
  const pending = listPendingMemoryProposals(sys, root).pending;
  if (request.op !== 'remove') {
    // CANONICAL, NOT LITERAL: trailing spaces, line breaks, case and composed characters do not make a second proposal.
    const wanted = normalizedEntryKey(request.content ?? '');
    const same = pending.find(
      (held) =>
        held.target === request.target &&
        held.op === request.op &&
        held.kind === request.kind &&
        normalizedEntryKey(held.content ?? '') === wanted &&
        sameTarget(held, request) &&
        sameAuthor(held.provenance.author, caller.author),
    );
    if (same !== undefined) return { ok: true, index: one.index, class: 'memory', id: same.id, proposalHash: same.proposalHash, state: 'pending', duplicate: true };
  }
  if (pending.filter((held) => sameAuthor(held.provenance.author, caller.author)).length >= MAX_PENDING_MEMORY_PER_AUTHOR) {
    return {
      ok: false,
      index: one.index,
      class: 'memory',
      code: 'PROPOSAL_DOOR_AUTHOR_QUEUE_FULL',
      message: `${MAX_PENDING_MEMORY_PER_AUTHOR} of this author's proposals are already waiting for the owner. Nothing was proposed.`,
    };
  }
  if (budget !== undefined && !budget(one)) return overBudget(one.index, 'memory');
  const made = proposeMemoryWrite(sys, root, caller, request);
  if (!made.ok) return { ok: false, index: one.index, class: 'memory', code: made.refusal.code, message: made.refusal.message };
  return { ok: true, index: one.index, class: 'memory', id: made.value.id, proposalHash: made.value.proposalHash, state: 'pending', duplicate: false };
}

const filesKey = (files: readonly { readonly path: string; readonly text: string }[]): string =>
  JSON.stringify([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(({ path, text }) => [path, text]));

function skillEntry(sys: System, root: string, caller: ProposalDoorCaller, one: FindingsSkillRequest, state?: SkillStatePorts, budget?: ProposalBudget): DoorEntryOutcome {
  const wanted = filesKey(one.files);
  const same = listPendingSkillProposals(sys, root).pending.find((pending) => pending.provenance.author === caller.author && filesKey(pending.files) === wanted);
  if (same !== undefined) return { ok: true, index: one.index, class: 'skill', id: same.id, proposalHash: same.proposalHash, state: 'pending', duplicate: true };
  if (budget !== undefined && !budget(one)) return overBudget(one.index, 'skill');
  const made = proposeSkill(sys, root, { actor: caller.author, role: caller.role, session: caller.session }, { files: one.files }, state);
  if (!made.ok) return { ok: false, index: one.index, class: 'skill', code: made.refusal.code, message: made.refusal.message };
  return { ok: true, index: one.index, class: 'skill', id: made.value.id, proposalHash: made.value.proposalHash, state: 'pending', duplicate: false };
}

/**
 * Turn the `proposals` entry of one findings record into pending proposals. `findingsText` is the record's text, or null when
 * there is none. Every accepted entry is pending and pinned by its hash, and every refused one says why.
 */
export function openProposalDoor(sys: System, root: string, caller: ProposalDoorCaller, findingsText: string | null, state?: SkillStatePorts, budget?: ProposalBudget): ProposalDoorOutcome {
  if (findingsText === null) return { findings: 'absent', entries: [] };
  if (caller.role === 'owner') {
    return { findings: 'read', entries: [whole('PROPOSAL_DOOR_CALLER_NOT_WORKER', 'A findings record is the worker\'s, so its proposals are not made in the owner\'s role. Nothing was proposed.')] };
  }
  if (findingsText.length > MAX_FINDINGS_RECORD_CHARS) {
    return { findings: 'unreadable', entries: [whole('PROPOSAL_DOOR_TOO_LARGE', `A findings record holds at most ${MAX_FINDINGS_RECORD_CHARS} characters. It was not read.`)] };
  }
  const parsed = parsedRecord(findingsText);
  if (!parsed.ok) return { findings: 'unreadable', entries: [whole('PROPOSAL_DOOR_UNREADABLE', 'The findings record is not valid JSON, so it asked for nothing.')] };
  const read = readFindingsProposals(parsed.record, (value) => types.isProxy(value));
  const accepted = read.requests.map((one) => (one.class === 'memory' ? memoryEntry(sys, root, caller, one, budget) : skillEntry(sys, root, caller, one, state, budget)));
  const refused = read.refused.map((one): DoorEntryOutcome => ({ ok: false, index: one.index, class: null, code: one.code, message: one.message }));
  return { findings: 'read', entries: [...accepted, ...refused].sort((a, b) => (a.index ?? -1) - (b.index ?? -1)) };
}

// Origin: original ProjectOS code
/**
 * One agent's thread: its turns, its approved decisions, its summary and the record of each compaction.
 *
 * AN APPROVED DECISION IS NOT A TURN, AND IT IS NOT SUMMARY TEXT. It sits in its own list, as the memory
 * rule that holds it: `checkMemoryProposal` will not let a summary overwrite a decision, whoever approves
 * it, and nothing here gives a summary a second way to. Only a whole record the owner approved gets in.
 * Each compaction records the decisions it held, and a thread that has lost one afterwards is refused, so
 * dropping one takes a forged record, not a slip.
 *
 * A TEXT KNOWN TO BE UNTRUSTED CANNOT COME BACK TRUSTED. The record keeps a key for every untrusted turn
 * and every summary, and a trusted turn holding the same text, in any case or spacing, is refused by
 * name. This is the rule that does not depend on an origin being honest. It is an equality on the whole
 * text, so a trusted turn quoting part of a summary is not caught, and it starts at a length, so an owner
 * who says "ok" after a model said "ok" is not refused. That is why trusted turns are the kernel's and
 * the owner's, and no model writes one. An owner who pastes a whole tool output gets this refusal: the
 * text lands as a `channel` turn, which is what it is.
 *
 * Every read of a thread goes through `checkContextThread`, because a thread is a value a caller holds and
 * could have changed. The hash and the keys detect a change; neither is a signature. Pure.
 */
import { createHash } from 'node:crypto';
import { isMemoryEntryProvenance, type MemoryEntryProvenance } from '../memory/proposal.js';
import { MEMORY_TARGETS, memoryEntryHash, type MemoryTarget } from '../memory/store.js';
import { TURN_OVERHEAD_TOKENS, estimateTextTokens } from './estimate.js';
import { turnCostTokens } from './fence.js';
import { compactionRecordProblem, type CompactionRecord } from './provenance.js';
import { contextOk, contextRefused, isContextLabel, type ContextRefused, type ContextResult } from './refusal.js';
import { textKey, trustOfOrigin, turnProblem, type ContextOrigin, type ContextSourceRef, type ContextTurn } from './turn.js';

/** An entry the owner approved, with the record that says so. The record's `ledgerRef` is its source. */
export interface ApprovedDecision {
  readonly target: MemoryTarget;
  readonly entry: string;
  readonly record: MemoryEntryProvenance;
}

/** The text a compaction left. Its trust and its authority are closed fields, so nothing can read more into it. */
export interface ContextSummary {
  readonly text: string;
  readonly trust: 'untrusted';
  readonly authority: 'none';
  readonly compactionId: string;
  readonly carriedOrigins: readonly ContextOrigin[];
  readonly carriedSources: readonly ContextSourceRef[];
}

export interface ContextThread {
  readonly agentId: string;
  readonly turns: readonly ContextTurn[];
  readonly decisions: readonly ApprovedDecision[];
  readonly summary: ContextSummary | null;
  readonly compactions: readonly CompactionRecord[];
}

/** Below this a match is a coincidence: "ok" and "done" are not laundering. */
const MIN_LAUNDERED_CHARS = 16;

const decisionHash = (decision: ApprovedDecision): string => memoryEntryHash(decision.entry);

function decisionProblem(decision: ApprovedDecision): string | null {
  if (!MEMORY_TARGETS.includes(decision.target)) return 'its memory target is not known';
  const { entry, record } = decision;
  if (!isMemoryEntryProvenance(memoryEntryHash(entry), record)) return 'no whole record the owner approved holds it';
  return record.kind === 'decision' ? null : 'its record is not a decision';
}

function decisionsProblem(thread: ContextThread): ContextRefused | null {
  const hashes = thread.decisions.map(decisionHash);
  const bad = thread.decisions.map(decisionProblem).find((problem) => problem !== null);
  if (bad !== undefined) return contextRefused('CONTEXT_DECISION_INVALID', `That is not an approved decision: ${bad}.`);
  if (new Set(hashes).size !== hashes.length) return contextRefused('CONTEXT_DECISION_INVALID', 'That decision is already held.');
  const held = thread.compactions.at(-1)?.decisionHashes ?? [];
  if (held.some((hash) => !hashes.includes(hash))) {
    return contextRefused('CONTEXT_DECISION_LOST', 'A decision this thread held at its last compaction is gone. A summary replaces nothing.');
  }
  return null;
}

function turnsProblem(thread: ContextThread): ContextRefused | null {
  const refuse = (why: string): ContextRefused => contextRefused('CONTEXT_TURN_INVALID', `That turn cannot join this thread: ${why}.`);
  const seen = new Set(thread.compactions.flatMap((record) => record.covered.map((mark) => mark.turnId)));
  const calls = new Set<string>();
  for (const turn of thread.turns) {
    const problem = turnProblem(turn);
    if (problem !== null) return refuse(problem);
    if (seen.has(turn.id)) return refuse(`the id ${turn.id} is already used`);
    if (turn.toolCallId !== null && !calls.has(turn.toolCallId)) return refuse('it answers a call no earlier turn made');
    seen.add(turn.id);
    turn.toolCalls.forEach((call) => calls.add(call.id));
  }
  return null;
}

function compactionsProblem(thread: ContextThread): ContextRefused | null {
  const refuse = (why: string): ContextRefused => contextRefused('CONTEXT_RECORD_TAMPERED', `This thread's record does not hold: ${why}.`);
  for (const [index, record] of thread.compactions.entries()) {
    const problem = compactionRecordProblem(record);
    if (problem !== null) return refuse(problem);
    if (record.agentId !== thread.agentId) return refuse('a record belongs to another agent');
    if (record.priorCompactionId !== (thread.compactions[index - 1]?.id ?? null)) return refuse('the chain of records is broken');
  }
  const last = thread.compactions.at(-1) ?? null;
  if (last === null) return thread.summary === null ? null : refuse('it has a summary and no record of one');
  if (thread.summary === null || thread.summary.compactionId !== last.id) return refuse('its summary is not the one recorded');
  return memoryEntryHash(thread.summary.text) === last.summaryHash ? null : refuse('its summary text changed after the record');
}

/** A summary that says more than its record, or a trusted turn holding a text known to be untrusted. */
function launderedProblem(thread: ContextThread): ContextRefused | null {
  const refuse = (why: string): ContextRefused => contextRefused('CONTEXT_LAUNDERED', `Untrusted text cannot become trusted: ${why}.`);
  const { summary } = thread;
  const last = thread.compactions.at(-1);
  if (summary !== null && last !== undefined) {
    if (summary.trust !== 'untrusted' || summary.authority !== 'none') return refuse('a summary is always untrusted and grants nothing');
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (!same(summary.carriedOrigins, last.carriedOrigins) || !same(summary.carriedSources, last.carriedSources)) return refuse('a summary lost the marks its record carries');
  }
  const known = new Set([
    ...thread.turns.filter((turn) => trustOfOrigin(turn.origin) === 'untrusted').map((turn) => textKey(turn.text)),
    ...thread.compactions.flatMap((record) => [...record.covered, ...record.kept].filter((mark) => mark.trust === 'untrusted').map((mark) => mark.textKey)),
    ...(summary === null ? [] : [textKey(summary.text)]),
  ]);
  const caught = thread.turns.find((turn) => trustOfOrigin(turn.origin) === 'trusted' && turn.text.trim().length >= MIN_LAUNDERED_CHARS && known.has(textKey(turn.text)));
  return caught === undefined ? null : refuse(`turn ${caught.id} holds a text already known to be untrusted`);
}

function threadProblem(thread: ContextThread): ContextRefused | null {
  if (!isContextLabel(thread.agentId)) return contextRefused('CONTEXT_ACCOUNT_INVALID', 'A thread needs an agent id of a closed shape.');
  return turnsProblem(thread) ?? compactionsProblem(thread) ?? decisionsProblem(thread) ?? launderedProblem(thread);
}

/** This thread, if every rule holds of it. */
export function checkContextThread(thread: ContextThread): ContextResult<ContextThread> {
  return threadProblem(thread) ?? contextOk(thread);
}

export function openContextThread(agentId: string): ContextResult<ContextThread> {
  return checkContextThread({ agentId, turns: [], decisions: [], summary: null, compactions: [] });
}

export function appendContextTurn(thread: ContextThread, turn: ContextTurn): ContextResult<ContextThread> {
  return checkContextThread({ ...thread, turns: [...thread.turns, turn] });
}

/** The one way a decision enters a thread. */
export function withApprovedDecision(thread: ContextThread, decision: ApprovedDecision): ContextResult<ContextThread> {
  return checkContextThread({ ...thread, decisions: [...thread.decisions, decision] });
}

/** Everything a compaction could disturb, so a draft made from one state cannot land on another. */
export function contextThreadHash(thread: ContextThread): string {
  const fields = [thread.agentId, thread.turns, thread.decisions.map(decisionHash), thread.compactions.map((record) => record.id)];
  return `sha256:${createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex')}`;
}

/** The rough size of a thread: turns, decisions and the summary, each with its overhead. */
export function estimateThreadTokens(thread: Pick<ContextThread, 'turns' | 'decisions'> & { readonly summary: Pick<ContextSummary, 'text'> | null }): number {
  const turns = thread.turns.reduce((sum, turn) => sum + turnCostTokens(turn), 0);
  const decisions = thread.decisions.reduce((sum, { entry, record }) => sum + estimateTextTokens(`${record.ledgerRef ?? ''} ${entry}`) + TURN_OVERHEAD_TOKENS, 0);
  return turns + decisions + (thread.summary === null ? 0 : estimateTextTokens(thread.summary.text) + TURN_OVERHEAD_TOKENS);
}

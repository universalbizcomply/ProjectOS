// Origin: original ProjectOS code
/**
 * Compacting a thread: what is summarised, what stays, and what a summary may and may not become.
 *
 * NO PROVIDER IS CALLED HERE. `planCompaction` says what to summarise, something outside this module has a
 * model write it, and `applyCompaction` judges what comes back. A draft is pinned to the thread it was
 * made from, so one that took longer than a new turn is stale, not silently short of that turn. The kept
 * turns are worked out again from the thread, so nothing a caller hands back decides what stays.
 *
 * THE SUMMARY IS WHAT YIELDS. Current turns and approved decisions are charged first, and the summary gets
 * what is left under the trigger. There is no path that drops a decision or a kept turn to make room. If
 * they alone reach the trigger the compaction is refused by name, and the kernel decides. The latest
 * request stays verbatim even when the turns around it are summarised, because a one-request task with
 * hundreds of tool results is the ordinary shape of work here, and that request is what the agent is doing.
 *
 * A SUMMARY IS ALWAYS UNTRUSTED AND NEVER AUTHORITY, whatever it summarised. A draft has no trust field to
 * read, and these two values are written here as literals. A model wrote the text, and that model read
 * whatever the turns held, so owner-only input earns it nothing either.
 *
 * WHAT A SUMMARY MAY SAY is the memory admission rule: no threat pattern, no hidden characters, no order
 * to its reader. A summary replays into later turns as memory does, and the size is asked first, so the
 * scan's cost is set by the budget and not by whatever came back. Pure.
 */
import { admitMemoryContent } from '../memory/admission.js';
import { memoryEntryHash } from '../memory/store.js';
import { summaryBudgetTokens, type AgentContextAccount } from './accounting.js';
import { TURN_OVERHEAD_TOKENS, estimateTextTokens } from './estimate.js';
import { carriedMarks, compactionProvenanceProblem, sealCompactionRecord, turnMark, type CompactionRecord } from './provenance.js';
import { contextOk, contextRefused, type ContextRefused, type ContextResult } from './refusal.js';
import { checkContextThread, contextThreadHash, estimateThreadTokens, type ContextSummary, type ContextThread } from './thread.js';
import type { ContextTurn } from './turn.js';
import { findTailStart, headEndOf, latestRequestIndex, tailBudgetTokens } from './window.js';

export interface CompactionPlan {
  readonly agentId: string;
  /** What a draft must name, to show it was made from this thread. */
  readonly threadHash: string;
  /** The turns the summary will replace. */
  readonly summarise: readonly ContextTurn[];
  /** The summary before this one, which the new one absorbs. */
  readonly priorSummary: ContextSummary | null;
  readonly keep: readonly ContextTurn[];
  /** All the room a summary has. Over this it is refused, and nothing else gives way. */
  readonly summaryBudgetTokens: number;
}

export interface CompactionDraft {
  readonly threadHash: string;
  readonly text: string;
  readonly summarisedBy: string;
  readonly session: string;
  readonly at: string;
}

export interface CompactedContext {
  readonly thread: ContextThread;
  readonly record: CompactionRecord;
}

/** Which turns go where. The latest request stays verbatim wherever the tail happens to start. */
function divide(thread: ContextThread, account: AgentContextAccount): Pick<CompactionPlan, 'summarise' | 'keep'> {
  const { turns } = thread;
  const headEnd = headEndOf(turns);
  const tailStart = findTailStart(turns, headEnd, tailBudgetTokens(account.window));
  const latest = latestRequestIndex(turns);
  const middle = turns.slice(headEnd, tailStart);
  return {
    summarise: middle.filter((turn) => turn !== turns[latest]),
    keep: [...turns.slice(0, headEnd), ...middle.filter((turn) => turn === turns[latest]), ...turns.slice(tailStart)],
  };
}

function planFor(thread: ContextThread, account: AgentContextAccount): ContextResult<CompactionPlan> {
  if (account.agentId !== thread.agentId) return contextRefused('CONTEXT_NO_ACCOUNT', `That account is ${account.agentId}'s, and this thread is ${thread.agentId}'s.`);
  const { summarise, keep } = divide(thread, account);
  if (summarise.length === 0) return contextRefused('CONTEXT_NOTHING_TO_COMPACT', 'Every turn in this thread stays, so there is nothing to summarise.');
  const protectedTokens = estimateThreadTokens({ turns: keep, decisions: thread.decisions, summary: null });
  const room = account.triggerTokens - 1 - protectedTokens - TURN_OVERHEAD_TOKENS;
  if (room < 1) {
    return contextRefused('CONTEXT_PROTECTED_OVER_BUDGET', `What must stay already costs ${protectedTokens} tokens against a trigger of ${account.triggerTokens}. Nothing protected is dropped to fit.`);
  }
  const replacedTokens = estimateThreadTokens({ turns: summarise, decisions: [], summary: thread.summary });
  return contextOk({
    agentId: thread.agentId,
    threadHash: contextThreadHash(thread),
    summarise,
    priorSummary: thread.summary,
    keep,
    summaryBudgetTokens: Math.min(room, summaryBudgetTokens(account.window, replacedTokens)),
  });
}

/** What to summarise, and how much room there is. It changes nothing. */
export function planCompaction(thread: ContextThread, account: AgentContextAccount): ContextResult<CompactionPlan> {
  const checked = checkContextThread(thread);
  return checked.ok ? planFor(thread, account) : checked;
}

function draftProblem(draft: CompactionDraft, plan: CompactionPlan): ContextRefused | null {
  if (draft.threadHash !== plan.threadHash) return contextRefused('CONTEXT_PLAN_STALE', 'This thread changed after the draft was made. Draft it again.');
  const missing = compactionProvenanceProblem(draft);
  if (missing !== null) return contextRefused('CONTEXT_DRAFT_INVALID', `A draft must name ${missing}.`);
  if (typeof draft.text !== 'string' || draft.text.trim() === '') return contextRefused('CONTEXT_DRAFT_INVALID', 'A draft must hold text.');
  const tokens = estimateTextTokens(draft.text);
  if (tokens > plan.summaryBudgetTokens) {
    return contextRefused('CONTEXT_SUMMARY_OVER_BUDGET', `That summary is ${tokens} tokens and there is room for ${plan.summaryBudgetTokens}. It was not read.`);
  }
  const admitted = admitMemoryContent(draft.text);
  return admitted.ok ? null : contextRefused('CONTEXT_SUMMARY_REFUSED', admitted.refusal.message, admitted.refusal.named);
}

function compacted(thread: ContextThread, plan: CompactionPlan, draft: CompactionDraft): ContextResult<CompactedContext> {
  const tokensBefore = estimateThreadTokens(thread);
  const tokensAfter = estimateThreadTokens({ turns: plan.keep, decisions: thread.decisions, summary: { text: draft.text } });
  if (tokensAfter >= tokensBefore) {
    return contextRefused('CONTEXT_NOT_SMALLER', `This compaction would leave ${tokensAfter} tokens where there were ${tokensBefore}.`);
  }
  const prior = thread.compactions.at(-1) ?? null;
  const covered = plan.summarise.map(turnMark);
  const carried = carriedMarks(covered, prior);
  const record = sealCompactionRecord({
    agentId: thread.agentId,
    summarisedBy: draft.summarisedBy,
    session: draft.session,
    compactedAt: draft.at,
    covered,
    kept: plan.keep.map(turnMark),
    priorCompactionId: prior?.id ?? null,
    summaryHash: memoryEntryHash(draft.text),
    ...carried,
    decisionHashes: thread.decisions.map((decision) => decision.record.entryHash),
    tokensBefore,
    tokensAfter,
  });
  const summary: ContextSummary = { text: draft.text, trust: 'untrusted', authority: 'none', compactionId: record.id, ...carried };
  return contextOk({ thread: { ...thread, turns: plan.keep, summary, compactions: [...thread.compactions, record] }, record });
}

/** The thread with this draft as its summary, or why not. The thread it was given is left as it was. */
export function applyCompaction(thread: ContextThread, account: AgentContextAccount, draft: CompactionDraft): ContextResult<CompactedContext> {
  const plan = planCompaction(thread, account);
  if (!plan.ok) return plan;
  return draftProblem(draft, plan.value) ?? compacted(thread, plan.value, draft);
}

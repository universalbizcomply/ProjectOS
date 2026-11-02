import { describe, expect, it } from 'vitest';
import { memoryEntryHash } from '../src/memory/store.js';
import {
  appendContextTurn,
  applyCompaction,
  checkContextThread,
  compactionRecordProblem,
  contextPressure,
  contextThreadHash,
  estimateThreadTokens,
  noteContextCompaction,
  planCompaction,
  recordContextUsage,
  renderContextPrompt,
  summaryCostTokens,
  turnCostTokens,
  withApprovedDecision,
  type CompactionRecord,
  type ContextThread,
} from '../src/context/index.js';
import {
  AGENT,
  AT,
  LEDGER,
  WINDOW,
  accountOf,
  accountsFor,
  agentTurn,
  codeOf,
  decisionOf,
  draftFor,
  kernelTurn,
  longTurns,
  must,
  ownerTurn,
  threadOf,
} from './context-support.js';

const account = accountOf(accountsFor());
const DECISION = 'Two tenants, one owner.';
const SECOND = 'Hermes code is translated under the MIT licence.';
const SUMMARY = 'The work read the plan, then fixed two tests.';
const base = (): ContextThread =>
  threadOf([kernelTurn('s1', 'The kernel prompt.'), ...longTurns('old', 8), ownerTurn('u1', 'Please finish the phase.'), agentTurn('a1', 'Working on it.')], [decisionOf(DECISION), decisionOf(SECOND, 'docs/adr/ADR-P1-port-ownership-and-credit.md')]);
const compact = (thread: ContextThread, text: string = SUMMARY) => must(applyCompaction(thread, account, draftFor(thread, text)));

describe('what a compaction keeps', () => {
  it('drops the turns it summarised and keeps the head and the newest turns: the positive control', () => {
    const { thread } = compact(base());
    expect(thread.turns.map((turn) => turn.id)).toEqual(['s1', 'old7', 'u1', 'a1']);
    expect(thread.summary?.text).toBe(SUMMARY);
  });

  it('keeps the latest request verbatim when it would have been summarised', () => {
    const thread = threadOf([ownerTurn('u1', 'Please finish the phase.'), ...longTurns('work', 8)]);
    const after = compact(thread).thread;
    expect(after.turns.map((turn) => turn.id)).toEqual(['u1', 'work7']);
  });

  it('leaves nothing out of the thread it was given', () => {
    const thread = base();
    compact(thread);
    expect(thread.turns).toHaveLength(11);
    expect(thread.summary).toBeNull();
  });

  it('comes out below the trigger on a thread that reached it', () => {
    const thread = base();
    expect(must(contextPressure(accountsFor(), AGENT, estimateThreadTokens(thread))).action).toBe('compact');
    const after = compact(thread).thread;
    expect(must(contextPressure(accountsFor(), AGENT, estimateThreadTokens(after))).action).toBe('none');
  });

  it('refuses a thread with nothing to summarise', () => {
    const thread = threadOf([kernelTurn('s1', 'a'), ownerTurn('u1', 'b')]);
    expect(codeOf(planCompaction(thread, account))).toBe('CONTEXT_NOTHING_TO_COMPACT');
  });

  it('never reaches the limit over a long run', () => {
    let accounts = accountsFor();
    let thread = threadOf([kernelTurn('s1', 'The kernel prompt.')], [decisionOf(DECISION)]);
    let compactions = 0;
    /** A provider that counts more than the estimate does, with a floor the estimate cannot see. */
    const providerCount = (held: ContextThread): number => Math.ceil(estimateThreadTokens(held) * 1.25) + 300;
    for (let index = 0; index < 120; index += 1) {
      const incoming = agentTurn(`t${index}`, 'x'.repeat(800));
      const pressure = must(contextPressure(accounts, AGENT, estimateThreadTokens(thread), turnCostTokens(incoming)));
      expect(pressure.projectedTokens).toBeLessThan(pressure.inputTokens);
      if (pressure.action === 'compact') {
        thread = must(applyCompaction(thread, accountOf(accounts), draftFor(thread, `Round ${index} of the work, in plain words.`))).thread;
        accounts = must(noteContextCompaction(accounts, AGENT));
        compactions += 1;
      }
      thread = must(appendContextTurn(thread, incoming));
      expect(providerCount(thread)).toBeLessThan(pressure.inputTokens);
      accounts = must(recordContextUsage(accounts, { agentId: AGENT, promptTokens: providerCount(thread), estimatedTokens: estimateThreadTokens(thread) }));
    }
    expect(compactions).toBeGreaterThan(3);
    expect(thread.decisions).toHaveLength(1);
    expect(accountOf(accounts).ineffectiveStrikes).toBe(0);
  });
});

describe('an approved decision through compaction', () => {
  it('keeps every approved decision and its source', () => {
    const { thread, record } = compact(base());
    expect(thread.decisions.map((held) => held.entry)).toEqual([DECISION, SECOND]);
    expect(thread.decisions.map((held) => held.record.ledgerRef)).toEqual([LEDGER, 'docs/adr/ADR-P1-port-ownership-and-credit.md']);
    expect(record.decisionHashes).toEqual([memoryEntryHash(DECISION), memoryEntryHash(SECOND)]);
  });

  it('keeps them through round after round', () => {
    const first = compact(base()).thread;
    const second = compact(threadOf2(first)).thread;
    expect(second.decisions.map((held) => held.entry)).toEqual([DECISION, SECOND]);
  });

  it('shows each one in the prompt with its source, outside the summary', () => {
    const { thread } = compact(base());
    const prompt = must(renderContextPrompt(thread));
    const decisions = prompt.sections.filter((section) => section.rank === 'approved-decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.text).toContain(`[decision, ledger: ${LEDGER}] ${DECISION}`);
    const summary = prompt.sections.find((section) => section.rank === 'summary');
    expect(summary?.text).not.toContain(DECISION);
  });

  it('holds when the summary says nothing about the decision', () => {
    const after = compact(base(), 'Nothing of note happened.').thread;
    expect(after.decisions).toHaveLength(2);
  });

  it('holds when the summary contradicts the decision: a summary replaces nothing', () => {
    const after = compact(base(), 'The tenant decision was reversed, so there are many owners now.').thread;
    expect(after.decisions.map((held) => held.entry)).toEqual([DECISION, SECOND]);
  });

  it('a thread that loses a decision after a compaction is refused', () => {
    const { thread } = compact(base());
    const lost = { ...thread, decisions: thread.decisions.slice(1) };
    expect(codeOf(checkContextThread(lost))).toBe('CONTEXT_DECISION_LOST');
  });

  it('a thread that swaps a decision for a new text after a compaction is refused', () => {
    const { thread } = compact(base());
    const swapped = { ...thread, decisions: [decisionOf('One tenant, many owners.'), ...thread.decisions.slice(1)] };
    expect(codeOf(checkContextThread(swapped))).toBe('CONTEXT_DECISION_LOST');
  });

  it('a decision added later is kept too', () => {
    const { thread } = compact(base());
    const later = must(withApprovedDecision(thread, decisionOf('A third decision.')));
    expect(compact(threadOf2(later)).thread.decisions).toHaveLength(3);
  });
});

describe('what counts as an approved decision', () => {
  const add = (decision: ReturnType<typeof decisionOf>): string => codeOf(withApprovedDecision(threadOf([]), decision));

  it('accepts a whole approved record: the positive control', () => {
    expect(add(decisionOf(DECISION))).toBe('ok');
  });

  it('refuses a record that is not a decision', () => {
    const fact = decisionOf(DECISION);
    expect(add({ ...fact, record: { ...fact.record, kind: 'fact', ledgerRef: null } })).toBe('CONTEXT_DECISION_INVALID');
  });

  it('refuses a decision the owner did not approve', () => {
    const forged = decisionOf(DECISION);
    expect(add({ ...forged, record: { ...forged.record, approvedBy: 'implementer' } })).toBe('CONTEXT_DECISION_INVALID');
  });

  it('refuses a decision with no source', () => {
    const forged = decisionOf(DECISION);
    expect(add({ ...forged, record: { ...forged.record, ledgerRef: null } })).toBe('CONTEXT_DECISION_INVALID');
  });

  it('refuses a record held for another text', () => {
    expect(add({ ...decisionOf(DECISION), entry: 'A different decision.' })).toBe('CONTEXT_DECISION_INVALID');
  });

  it('refuses an unknown memory target', () => {
    expect(add({ ...decisionOf(DECISION), target: 'elsewhere' as never })).toBe('CONTEXT_DECISION_INVALID');
  });

  it('refuses the same decision twice', () => {
    const thread = threadOf([], [decisionOf(DECISION)]);
    expect(codeOf(withApprovedDecision(thread, decisionOf(DECISION)))).toBe('CONTEXT_DECISION_INVALID');
  });
});

describe('what yields when space runs out', () => {
  it('the summary takes only the room decisions and current turns leave: the exact fit lands', () => {
    const thread = base();
    const plan = must(planCompaction(thread, account));
    const text = fittingText(plan.summaryBudgetTokens);
    expect(summaryCostTokens(text)).toBe(plan.summaryBudgetTokens);
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, text)))).toBe('ok');
  });

  it('one token over the room is refused, and the decisions stay', () => {
    const thread = base();
    const plan = must(planCompaction(thread, account));
    const text = `${fittingText(plan.summaryBudgetTokens)}x`;
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, text)))).toBe('CONTEXT_SUMMARY_OVER_BUDGET');
    expect(thread.decisions).toHaveLength(2);
  });

  it('the room is what the kept turns and decisions leave under the trigger', () => {
    const big = 'd'.repeat(2_000);
    const thread = threadOf([...longTurns('old', 8), ownerTurn('u1', 'x'.repeat(18_000)), agentTurn('a1', 'y')], [decisionOf(big)]);
    const plan = must(planCompaction(thread, account));
    const held = estimateThreadTokens({ turns: plan.keep, decisions: thread.decisions, summary: null });
    expect(plan.summaryBudgetTokens).toBe(6_750 - 1 - held);
  });

  it('no room at all is refused by name: nothing protected is dropped to fit', () => {
    const thread = threadOf([...longTurns('old', 4), ownerTurn('u1', 'x'.repeat(27_000)), agentTurn('a1', 'y')], [decisionOf(DECISION)]);
    expect(codeOf(planCompaction(thread, account))).toBe('CONTEXT_PROTECTED_OVER_BUDGET');
    expect(thread.decisions).toHaveLength(1);
  });

  it('a compaction that would not shrink the thread is refused', () => {
    const thread = threadOf([agentTurn('a0', 'x'), agentTurn('a1', 'y'), ownerTurn('u1', 'z'), agentTurn('a2', 'w'.repeat(7_900))]);
    const plan = must(planCompaction(thread, account));
    expect(plan.summarise.map((turn) => turn.id)).toEqual(['a0', 'a1']);
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, 'x'.repeat(800))))).toBe('CONTEXT_NOT_SMALLER');
  });
});

describe('the plan a draft was made from', () => {
  it('is stale when a turn arrives after the draft was made', () => {
    const thread = base();
    const draft = draftFor(thread, SUMMARY);
    const moved = must(appendContextTurn(thread, agentTurn('a2', 'One more.')));
    expect(codeOf(applyCompaction(moved, account, draft))).toBe('CONTEXT_PLAN_STALE');
  });

  it('is stale when a decision arrives after the draft was made', () => {
    const thread = base();
    const draft = draftFor(thread, SUMMARY);
    const moved = must(withApprovedDecision(thread, decisionOf('A later decision.')));
    expect(codeOf(applyCompaction(moved, account, draft))).toBe('CONTEXT_PLAN_STALE');
  });

  it('is stale when one turn text changes by a character', () => {
    const thread = base();
    const turns = thread.turns.map((turn) => (turn.id === 'old0' ? { ...turn, text: `${turn.text}!` } : turn));
    expect(contextThreadHash({ ...thread, turns })).not.toBe(contextThreadHash(thread));
  });

  it('the kept turns come from the thread, not from anything a caller hands back', () => {
    const thread = base();
    const { thread: after } = must(applyCompaction(thread, account, { ...draftFor(thread, SUMMARY), keep: [] } as never));
    expect(after.turns.length).toBeGreaterThan(0);
  });

  it('refuses a compaction for another agent', () => {
    const other = accountOf(accountsFor('agent-2'), 'agent-2');
    expect(codeOf(planCompaction(base(), other))).toBe('CONTEXT_NO_ACCOUNT');
    expect(codeOf(applyCompaction(base(), other, draftFor(base(), SUMMARY)))).toBe('CONTEXT_NO_ACCOUNT');
  });

  it('refuses a draft with no provenance', () => {
    const thread = base();
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, SUMMARY, { summarisedBy: 'a model\n' })))).toBe('CONTEXT_DRAFT_INVALID');
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, SUMMARY, { session: '' })))).toBe('CONTEXT_DRAFT_INVALID');
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, SUMMARY, { at: 'yesterday' })))).toBe('CONTEXT_DRAFT_INVALID');
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, '   ')))).toBe('CONTEXT_DRAFT_INVALID');
    expect(codeOf(applyCompaction(thread, account, draftFor(thread, 7 as never)))).toBe('CONTEXT_DRAFT_INVALID');
  });
});

describe('the record of a compaction', () => {
  const { record } = compact(base());

  it('names who made it, in which session, when, and over which text', () => {
    expect(record).toMatchObject({ agentId: AGENT, summarisedBy: 'summary-model', session: 'sess-1', compactedAt: AT });
    expect(record.summaryHash).toBe(memoryEntryHash(SUMMARY));
  });

  it('lists every turn it covered, each with its marks', () => {
    expect(record.covered.map((mark) => mark.turnId)).toEqual(['old0', 'old1', 'old2', 'old3', 'old4', 'old5', 'old6']);
    expect(record.covered[0]).toMatchObject({ role: 'assistant', origin: 'agent', trust: 'untrusted' });
  });

  it('records how much it saved', () => {
    expect(record.tokensAfter).toBeLessThan(record.tokensBefore);
    expect(record.tokensBefore).toBe(estimateThreadTokens(base()));
  });

  it('has no prior compaction the first time, and names it the second', () => {
    expect(record.priorCompactionId).toBeNull();
    const second = compact(threadOf2(compact(base()).thread)).record;
    expect(second.priorCompactionId).toBe(record.id);
  });

  it('passes its own check: the positive control', () => {
    expect(compactionRecordProblem(record)).toBeNull();
  });

  it.each([
    ['its summary hash', { summaryHash: memoryEntryHash('Another summary.') }],
    ['who made it', { summarisedBy: 'someone-else' }],
    ['its session', { session: 'sess-9' }],
    ['when', { compactedAt: '2026-01-01T00:00:00Z' }],
    ['its covered turns', { covered: [] }],
    ['its kept marks', { kept: [] }],
    ['the decisions it held', { decisionHashes: [] }],
    ['what it carried', { carriedOrigins: [] }],
    ['the sources it carried', { carriedSources: [{ sourceId: 'x', contentHash: memoryEntryHash('x') }] }],
    ['its prior link', { priorCompactionId: 'ctx-000000000000000000000000' }],
    ['the tokens saved', { tokensAfter: 1 }],
    ['the tokens before', { tokensBefore: 1 }],
  ] as const)('is refused when %s changes', (_, change) => {
    expect(compactionRecordProblem({ ...record, ...change } as CompactionRecord)).toContain('its hash');
  });

  it('is refused under another agent or schema', () => {
    expect(compactionRecordProblem({ ...record, agentId: 'agent-2' })).toContain('its hash');
    expect(compactionRecordProblem({ ...record, schema: 'other' } as never)).toContain('schema');
  });

  it('is refused when its id is not its hash', () => {
    expect(compactionRecordProblem({ ...record, id: 'ctx-000000000000000000000000' })).toContain('id');
  });

  it('a thread whose record was changed is refused', () => {
    const { thread, record: held } = compact(base());
    const changed = { ...thread, compactions: [{ ...held, session: 'sess-9' }] };
    expect(codeOf(checkContextThread(changed))).toBe('CONTEXT_RECORD_TAMPERED');
  });

  it('a thread with a broken chain is refused', () => {
    const first = compact(base());
    const second = compact(threadOf2(first.thread));
    const broken = { ...second.thread, compactions: [second.record] };
    expect(codeOf(checkContextThread(broken))).toBe('CONTEXT_RECORD_TAMPERED');
  });

  it('a thread whose record belongs to another agent is refused', () => {
    const { thread } = compact(base());
    expect(codeOf(checkContextThread({ ...thread, agentId: 'agent-2' }))).toBe('CONTEXT_RECORD_TAMPERED');
  });

  it('a thread with a summary and no record of it is refused', () => {
    const { thread } = compact(base());
    expect(codeOf(checkContextThread({ ...thread, compactions: [] }))).toBe('CONTEXT_RECORD_TAMPERED');
  });

  it('a thread whose summary was edited after the record is refused', () => {
    const { thread } = compact(base());
    const summary = { ...must(requireSummary(thread)), text: 'A kinder account of events.' };
    expect(codeOf(checkContextThread({ ...thread, summary }))).toBe('CONTEXT_RECORD_TAMPERED');
  });
});

/** The longest text that costs exactly this as it is sent. */
function fittingText(budget: number): string {
  const size = (budget - summaryCostTokens('x')) * 4;
  const grown = Array.from({ length: 8 }, (_, extra) => size + extra).filter((length) => summaryCostTokens('x'.repeat(length)) <= budget);
  return 'x'.repeat(Math.max(...grown));
}

/** More turns on a compacted thread, so it has something to compact again. */
function threadOf2(thread: ContextThread): ContextThread {
  const stamp = thread.compactions.length + thread.decisions.length;
  const more = longTurns(`more${stamp}x`, 8);
  return more.reduce((held, turn) => must(appendContextTurn(held, turn)), thread);
}

function requireSummary(thread: ContextThread) {
  if (thread.summary === null) throw new Error('no summary');
  return { ok: true as const, value: thread.summary };
}

import { describe, expect, it } from 'vitest';
import {
  MAX_INEFFECTIVE_STRIKES,
  MAX_TRIGGER_RATIO,
  MIN_INPUT_WINDOW_TOKENS,
  MIN_TRIGGER_RATIO,
  agentsToCompact,
  compactionTriggerTokens,
  contextPressure,
  inputWindowTokens,
  noteContextCompaction,
  openContextAccount,
  recordContextUsage,
  summaryBudgetTokens,
  type ContextAccounts,
  type ContextWindow,
} from '../src/context/index.js';
import { AGENT, WINDOW, accountOf, accountsFor, codeOf, must } from './context-support.js';

const TRIGGER = 6_750;
const INPUT = 9_000;
const actionAt = (accounts: ContextAccounts, tokens: number, incoming = 0): string =>
  must(contextPressure(accounts, AGENT, tokens, incoming)).action;
const usage = (promptTokens: number, agentId: string = AGENT) => ({ agentId, promptTokens, estimatedTokens: promptTokens });
const open = (window: ContextWindow): string => codeOf(openContextAccount(new Map(), AGENT, window));

describe('the compaction trigger', () => {
  it('sits where the window says', () => {
    expect(inputWindowTokens(WINDOW)).toBe(INPUT);
    expect(compactionTriggerTokens(WINDOW)).toBe(TRIGGER);
  });

  it('does nothing one token under the trigger: the positive control', () => {
    expect(actionAt(accountsFor(), TRIGGER - 1)).toBe('none');
  });

  it('fires exactly at the trigger, before the limit', () => {
    expect(actionAt(accountsFor(), TRIGGER)).toBe('compact');
    expect(TRIGGER).toBeLessThan(INPUT);
  });

  it('reserves the output space out of the window', () => {
    const reserved = accountsFor(AGENT, { limitTokens: 10_000, reservedOutputTokens: 4_000, triggerRatio: 0.75 });
    expect(actionAt(reserved, 4_499)).toBe('none');
    expect(actionAt(reserved, 4_500)).toBe('compact');
  });

  it('fires on what is about to arrive, before the turn lands', () => {
    expect(actionAt(accountsFor(), TRIGGER - 100, 99)).toBe('none');
    expect(actionAt(accountsFor(), TRIGGER - 100, 100)).toBe('compact');
  });

  it('never sits at or past the input window, at any size or ratio', () => {
    for (let limit = MIN_INPUT_WINDOW_TOKENS; limit < 40_000; limit += 137) {
      for (const triggerRatio of [MIN_TRIGGER_RATIO, 0.5, 0.75, MAX_TRIGGER_RATIO]) {
        const window = { limitTokens: limit, reservedOutputTokens: 0, triggerRatio };
        expect(compactionTriggerTokens(window)).toBeLessThan(inputWindowTokens(window));
        expect(compactionTriggerTokens(window)).toBeGreaterThan(0);
      }
    }
  });
});

describe('a window that cannot hold a trigger', () => {
  it('accepts the highest ratio allowed: the positive control', () => {
    expect(open({ ...WINDOW, triggerRatio: MAX_TRIGGER_RATIO })).toBe('ok');
    expect(open({ ...WINDOW, triggerRatio: MIN_TRIGGER_RATIO })).toBe('ok');
  });

  it('refuses a ratio that leaves too little room before the limit', () => {
    expect(open({ ...WINDOW, triggerRatio: 0.86 })).toBe('CONTEXT_WINDOW_INVALID');
    expect(open({ ...WINDOW, triggerRatio: 1 })).toBe('CONTEXT_WINDOW_INVALID');
  });

  it('refuses a ratio so low that every turn would compact', () => {
    expect(open({ ...WINDOW, triggerRatio: 0.09 })).toBe('CONTEXT_WINDOW_INVALID');
    expect(open({ ...WINDOW, triggerRatio: Number.NaN })).toBe('CONTEXT_WINDOW_INVALID');
  });

  it('refuses an input window too small to work in', () => {
    expect(open({ limitTokens: MIN_INPUT_WINDOW_TOKENS, reservedOutputTokens: 0, triggerRatio: 0.75 })).toBe('ok');
    expect(open({ limitTokens: MIN_INPUT_WINDOW_TOKENS, reservedOutputTokens: 1, triggerRatio: 0.75 })).toBe('CONTEXT_WINDOW_INVALID');
  });

  it('refuses a count that is not a whole number', () => {
    expect(open({ ...WINDOW, limitTokens: 10_000.5 })).toBe('CONTEXT_WINDOW_INVALID');
    expect(open({ ...WINDOW, reservedOutputTokens: -1 })).toBe('CONTEXT_WINDOW_INVALID');
  });
});

describe('one account per agent', () => {
  const both = must(openContextAccount(accountsFor('agent-a'), 'agent-b', WINDOW));

  it('keeps each agent to its own window', () => {
    const small = must(openContextAccount(accountsFor('agent-a'), 'agent-b', { ...WINDOW, limitTokens: 2_000, reservedOutputTokens: 0 }));
    expect(must(contextPressure(small, 'agent-a', 2_000)).action).toBe('none');
    expect(must(contextPressure(small, 'agent-b', 2_000)).action).toBe('compact');
  });

  it('posts usage only to the agent it names', () => {
    const next = must(recordContextUsage(both, usage(TRIGGER, 'agent-a')));
    expect(accountOf(next, 'agent-a').lastPromptTokens).toBe(TRIGGER);
    expect(accountOf(next, 'agent-b').lastPromptTokens).toBe(0);
  });

  it('counts a compaction only for the agent that compacted', () => {
    const next = must(noteContextCompaction(both, 'agent-a'));
    expect(accountOf(next, 'agent-a').compactions).toBe(1);
    expect(accountOf(next, 'agent-b').compactions).toBe(0);
  });

  it('refuses a second account for one agent', () => {
    expect(codeOf(openContextAccount(both, 'agent-a', WINDOW))).toBe('CONTEXT_ACCOUNT_INVALID');
  });

  it('refuses an agent whose name would reach a prompt unchecked', () => {
    expect(codeOf(openContextAccount(new Map(), 'agent one\n', WINDOW))).toBe('CONTEXT_ACCOUNT_INVALID');
  });

  it('refuses a reading or a question about an agent with no account', () => {
    expect(codeOf(recordContextUsage(both, usage(1, 'agent-c')))).toBe('CONTEXT_NO_ACCOUNT');
    expect(codeOf(noteContextCompaction(both, 'agent-c'))).toBe('CONTEXT_NO_ACCOUNT');
    expect(codeOf(contextPressure(both, 'agent-c', 1))).toBe('CONTEXT_NO_ACCOUNT');
  });

  it('leaves the accounts it was given unchanged', () => {
    must(recordContextUsage(both, usage(TRIGGER, 'agent-a')));
    must(noteContextCompaction(both, 'agent-a'));
    expect(accountOf(both, 'agent-a')).toMatchObject({ lastPromptTokens: 0, compactions: 0 });
  });

  it('names only the agents that need compaction', () => {
    const estimates = new Map([['agent-a', TRIGGER - 1], ['agent-b', TRIGGER]]);
    expect(agentsToCompact(both, estimates)).toEqual(['agent-b']);
  });
});

describe('what the count is taken from', () => {
  it('takes the larger of the provider count and the estimate', () => {
    const read = must(recordContextUsage(accountsFor(), usage(5_000)));
    expect(must(contextPressure(read, AGENT, 4_000)).usedTokens).toBe(5_000);
    expect(must(contextPressure(read, AGENT, 6_000)).usedTokens).toBe(6_000);
  });

  it('stops trusting the old reading once a compaction has run', () => {
    const read = must(noteContextCompaction(must(recordContextUsage(accountsFor(), usage(8_000))), AGENT));
    expect(must(contextPressure(read, AGENT, 1_000)).usedTokens).toBe(1_000);
  });

  it('a reading of zero is no reading, so it cannot clear anything', () => {
    expect(codeOf(recordContextUsage(accountsFor(), usage(0)))).toBe('CONTEXT_USAGE_INVALID');
    expect(codeOf(recordContextUsage(accountsFor(), { agentId: AGENT, promptTokens: 1, estimatedTokens: -1 }))).toBe('CONTEXT_USAGE_INVALID');
  });

  it('refuses an estimate that is not a whole count', () => {
    expect(codeOf(contextPressure(accountsFor(), AGENT, -1))).toBe('CONTEXT_USAGE_INVALID');
    expect(codeOf(contextPressure(accountsFor(), AGENT, 1, 0.5))).toBe('CONTEXT_USAGE_INVALID');
  });

  it('reports what is left, and the share used', () => {
    const pressure = must(contextPressure(accountsFor(), AGENT, 4_500, 450));
    expect(pressure).toMatchObject({ projectedTokens: 4_950, triggerTokens: TRIGGER, inputTokens: INPUT, remainingTokens: 4_050, percentUsed: 55, overLimit: false });
  });
});

describe('a compaction that did not help', () => {
  const afterCompaction = (accounts: ContextAccounts): ContextAccounts => must(noteContextCompaction(accounts, AGENT));
  const struck = (times: number): ContextAccounts => {
    let accounts = accountsFor();
    for (let round = 0; round < times; round += 1) accounts = must(recordContextUsage(afterCompaction(accounts), usage(TRIGGER)));
    return accounts;
  };

  it('is struck when the next reading is still at the trigger', () => {
    expect(accountOf(struck(1)).ineffectiveStrikes).toBe(1);
  });

  it('is not struck one token under it: the positive control', () => {
    const next = must(recordContextUsage(afterCompaction(accountsFor()), usage(TRIGGER - 1)));
    expect(accountOf(next).ineffectiveStrikes).toBe(0);
  });

  it('a reading over the trigger with no compaction to judge is no strike', () => {
    const next = must(recordContextUsage(accountsFor(), usage(TRIGGER)));
    expect(accountOf(next).ineffectiveStrikes).toBe(0);
  });

  it('is judged once, on the first reading after it', () => {
    const once = must(recordContextUsage(struck(1), usage(TRIGGER)));
    expect(accountOf(once).ineffectiveStrikes).toBe(1);
  });

  it('blocks automatic compaction at the second strike, and says so', () => {
    expect(MAX_INEFFECTIVE_STRIKES).toBe(2);
    expect(actionAt(struck(1), TRIGGER)).toBe('compact');
    expect(actionAt(struck(2), TRIGGER)).toBe('blocked');
  });

  it('does not block an account under the trigger', () => {
    expect(actionAt(afterCompaction(struck(2)), TRIGGER - 1)).toBe('none');
  });

  it('a reading under the trigger clears the strikes', () => {
    const cleared = must(recordContextUsage(struck(2), usage(TRIGGER - 1)));
    expect(accountOf(cleared).ineffectiveStrikes).toBe(0);
    expect(actionAt(cleared, TRIGGER)).toBe('compact');
  });

  it('says when the limit itself is reached, so the kernel can stop', () => {
    expect(must(contextPressure(struck(2), AGENT, INPUT - 1)).overLimit).toBe(false);
    expect(must(contextPressure(struck(2), AGENT, INPUT))).toMatchObject({ overLimit: true, action: 'blocked' });
  });
});

describe('the budget a summary gets', () => {
  it('scales with what it replaces, up to the ceiling of the window', () => {
    const wide = { limitTokens: 1_000_000, reservedOutputTokens: 0, triggerRatio: 0.75 };
    expect(summaryBudgetTokens(wide, 20_000)).toBe(4_000);
    expect(summaryBudgetTokens(wide, 500_000)).toBe(10_000);
    expect(summaryBudgetTokens({ ...wide, limitTokens: 100_000 }, 500_000)).toBe(5_000);
  });

  it('never falls below the floor', () => {
    expect(summaryBudgetTokens(WINDOW, 100)).toBe(2_000);
  });
});

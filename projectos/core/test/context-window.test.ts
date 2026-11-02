import { describe, expect, it } from 'vitest';
import { findTailStart, headEndOf, latestRequestIndex, tailBudgetTokens, type ContextTurn } from '../src/context/index.js';
import { WINDOW, agentTurn, callTurn, kernelTurn, ownerTurn, resultTurn } from './context-support.js';

const row = (id: string): ContextTurn => agentTurn(id, 'x'.repeat(360));
const ROW_TOKENS = 100;

describe('the tail budget', () => {
  it('is held to the floor on an ordinary window', () => {
    expect(tailBudgetTokens({ limitTokens: 100_000, reservedOutputTokens: 0, triggerRatio: 0.75 })).toBe(10_000);
  });

  it('grows with a large window up to its cap', () => {
    expect(tailBudgetTokens({ limitTokens: 600_000, reservedOutputTokens: 0, triggerRatio: 0.75 })).toBe(15_000);
    expect(tailBudgetTokens({ limitTokens: 4_000_000, reservedOutputTokens: 0, triggerRatio: 0.75 })).toBe(25_000);
  });

  it('never claims more than a fifth of the window', () => {
    expect(tailBudgetTokens(WINDOW)).toBe(2_000);
  });

  it('never claims more than half the trigger', () => {
    expect(tailBudgetTokens({ limitTokens: 10_000, reservedOutputTokens: 8_000, triggerRatio: 0.5 })).toBe(500);
  });

  it('is never nothing', () => {
    expect(tailBudgetTokens({ limitTokens: 1_000, reservedOutputTokens: 0, triggerRatio: 0.1 })).toBeGreaterThan(0);
  });
});

describe('the head', () => {
  it('is the leading system turns', () => {
    expect(headEndOf([kernelTurn('s1', 'a'), kernelTurn('s2', 'b'), ownerTurn('u1', 'c'), kernelTurn('s3', 'd')])).toBe(2);
  });

  it('is empty with no system turn, and everything with nothing else', () => {
    expect(headEndOf([ownerTurn('u1', 'c')])).toBe(0);
    expect(headEndOf([kernelTurn('s1', 'a')])).toBe(1);
  });
});

describe('the latest request', () => {
  it('is the newest user turn', () => {
    expect(latestRequestIndex([ownerTurn('u1', 'a'), agentTurn('a1', 'b'), ownerTurn('u2', 'c'), agentTurn('a2', 'd')])).toBe(2);
  });

  it('is nothing in a thread with no request', () => {
    expect(latestRequestIndex([agentTurn('a1', 'b')])).toBe(-1);
  });
});

describe('where the tail starts', () => {
  const rows = Array.from({ length: 10 }, (_, index) => row(`r${index}`));

  it('walks back from the newest turn until the budget is spent', () => {
    expect(findTailStart(rows, 0, ROW_TOKENS * 3)).toBe(7);
  });

  it('takes one turn more at a budget one token larger than three', () => {
    expect(findTailStart(rows, 0, ROW_TOKENS * 3 - 1)).toBe(8);
  });

  it('stops at the head', () => {
    const headed = [kernelTurn('s1', 'a'), ...rows];
    expect(findTailStart(headed, 1, ROW_TOKENS * 100)).toBe(1);
  });

  it('keeps the newest turn whatever its size', () => {
    expect(findTailStart([...rows, agentTurn('big', 'x'.repeat(4_000))], 0, 10)).toBe(10);
  });

  it('keeps a whole tool group when the budget ends inside it', () => {
    const turns = [row('r0'), callTurn('c1', 'call-1'), resultTurn('t1', 'call-1', 'a'.repeat(400)), resultTurn('t2', 'call-1', 'b')];
    expect(findTailStart(turns, 0, 20)).toBe(1);
  });

  it('keeps a call with its result across a request that arrived between them', () => {
    const turns = [row('r0'), callTurn('c1', 'call-1'), ownerTurn('u1', 'and this'), resultTurn('t1', 'call-1', 'a'.repeat(400))];
    expect(findTailStart(turns, 0, 20)).toBe(1);
  });

  it('keeps two exchanges whole when they overlap', () => {
    const turns = [row('r0'), callTurn('c1', 'call-1'), callTurn('c2', 'call-2'), resultTurn('t1', 'call-1', 'a'), resultTurn('t2', 'call-2', 'b'.repeat(400))];
    expect(findTailStart(turns, 0, 20)).toBe(1);
  });

  it('never separates a tool result from its call, at any budget', () => {
    const turns = [
      kernelTurn('s1', 'a'),
      ...Array.from({ length: 6 }, (_, index) => [
        ownerTurn(`u${index}`, 'q'.repeat(40 * (index + 1))),
        callTurn(`c${index}`, `call-${index}`),
        resultTurn(`t${index}a`, `call-${index}`, 'r'.repeat(50 * (index + 1))),
        resultTurn(`t${index}b`, `call-${index}`, 'r'),
      ]).flat(),
    ];
    const callIndex = (id: string): number => turns.findIndex((turn) => turn.toolCalls.some((call) => call.id === id));
    for (let budget = 1; budget < 500; budget += 1) {
      const start = findTailStart(turns, 1, budget);
      expect(start).toBeGreaterThanOrEqual(1);
      for (const turn of turns.slice(start)) {
        if (turn.toolCallId !== null) expect(callIndex(turn.toolCallId)).toBeGreaterThanOrEqual(start);
      }
    }
  });
});

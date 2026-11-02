import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, TURN_OVERHEAD_TOKENS, estimateTextTokens, estimateThreadTokens, estimateTurnTokens, renderContextPrompt, turnCostTokens } from '../src/context/index.js';
import { agentTurn, callTurn, must, ownerTurn, resultTurn, threadOf } from './context-support.js';

describe('the rough count of a text', () => {
  it('counts an empty text as nothing', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('rounds up, so a short text is never free', () => {
    expect(estimateTextTokens('a')).toBe(1);
    expect(estimateTextTokens('a'.repeat(CHARS_PER_TOKEN))).toBe(1);
    expect(estimateTextTokens('a'.repeat(CHARS_PER_TOKEN + 1))).toBe(2);
  });

  it('counts a dense script per character', () => {
    expect(estimateTextTokens('\u6f22\u5b57\u6f22\u5b57')).toBe(4);
    expect(estimateTextTokens('\ud55c\uae00\ud55c\uae00')).toBe(4);
    expect(estimateTextTokens('\uff21\uff21\uff21\uff21')).toBe(4);
  });

  it('counts other scripts by their bytes, not their characters', () => {
    // Twelve bytes in six Cyrillic letters: chars/4 would call this two.
    expect(estimateTextTokens('\u043f\u0440\u0438\u0432\u0435\u0442')).toBe(3);
  });

  it('counts a mix of the two, each its own way', () => {
    expect(estimateTextTokens('\u6f22abcde')).toBe(3);
  });

  it('counts a broken surrogate instead of failing on it', () => {
    expect(estimateTextTokens('\ud83d')).toBe(1);
  });
});

describe('what a turn costs as it is sent', () => {
  const sent = (text: string): number => estimateTextTokens(text) + TURN_OVERHEAD_TOKENS;

  it('charges owner text as it stands: the positive control', () => {
    expect(turnCostTokens(ownerTurn('u1', 'Go on.'))).toBe(sent('Go on.'));
  });

  it('charges a source for its fence, exactly as sent', () => {
    const thread = threadOf([callTurn('c1', 'call-1'), resultTurn('t1', 'call-1', 'A long page of text.', 'docs/a.md', 'document')]);
    const section = must(renderContextPrompt(thread)).sections.at(-1);
    expect(turnCostTokens(thread.turns[1] as never)).toBe(sent(section?.text ?? ''));
    expect(turnCostTokens(thread.turns[1] as never)).toBeGreaterThan(sent('A long page of text.') + 40);
  });

  it('a thread of many tool results is not counted as its bare text', () => {
    const turns = Array.from({ length: 200 }, (_, index) => agentTurn(`a${index}`, 'x'));
    expect(estimateThreadTokens({ turns, decisions: [], summary: null })).toBeGreaterThan(200 * 60);
  });
});

describe('the rough count of a turn', () => {
  it('charges every turn its overhead', () => {
    expect(estimateTurnTokens({ text: '', toolCalls: [] })).toBe(TURN_OVERHEAD_TOKENS);
  });

  it('charges the whole of each tool call, not only its arguments', () => {
    const call = { id: 'call-1', name: 'read_file', args: 'a'.repeat(400) };
    expect(estimateTurnTokens({ text: 'read', toolCalls: [call] })).toBe(1 + TURN_OVERHEAD_TOKENS + estimateTextTokens(`${call.id}${call.name}${call.args}`));
  });
});

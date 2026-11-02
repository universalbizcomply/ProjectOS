import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, TURN_OVERHEAD_TOKENS, estimateTextTokens, estimateTurnTokens } from '../src/context/index.js';

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
    expect(estimateTextTokens('漢字')).toBe(2);
    expect(estimateTextTokens('한글')).toBe(2);
    expect(estimateTextTokens('Ａ')).toBe(1);
  });

  it('counts other scripts by their bytes, not their characters', () => {
    // Twelve bytes in six Cyrillic letters: chars/4 would call this two.
    expect(estimateTextTokens('привет')).toBe(3);
  });

  it('counts a mix of the two, each its own way', () => {
    expect(estimateTextTokens('漢abcde')).toBe(3);
  });

  it('counts a broken surrogate instead of failing on it', () => {
    expect(estimateTextTokens('\ud83d')).toBe(1);
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

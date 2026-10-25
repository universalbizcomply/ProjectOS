/**
 * SEC-001. `safeExcerpt()` quotes provider-controlled text into governance records and reports; it
 * must not carry Unicode bidi override/isolate characters that can make quoted text read as the
 * opposite of what it says. Targeted to this one defect — see openaiResponses.ts for the fix.
 */
import { describe, it, expect } from 'vitest';
import { safeExcerpt } from '../src/loop/transports/openaiResponses.js';

describe('safeExcerpt', () => {
  it('strips Unicode bidi override and isolate characters', () => {
    const rlo = '‮'; // RIGHT-TO-LEFT OVERRIDE
    const pdf = '‬'; // POP DIRECTIONAL FORMATTING
    const lri = '⁦'; // LEFT-TO-RIGHT ISOLATE
    const pdi = '⁩'; // POP DIRECTIONAL ISOLATE
    expect(safeExcerpt(`safe ${rlo}reversed${pdf} text`)).toBe('safe reversed text');
    expect(safeExcerpt(`safe ${lri}isolated${pdi} text`)).toBe('safe isolated text');
  });

  it('strips every character in the full bidi range U+202A-U+202E and U+2066-U+2069', () => {
    const bidiChars = [
      '‪',
      '‫',
      '‬',
      '‭',
      '‮',
      '⁦',
      '⁧',
      '⁨',
      '⁩',
    ];
    for (const ch of bidiChars) {
      expect(safeExcerpt(`a${ch}b`)).toBe('ab');
    }
  });

  it('leaves ordinary safe text unchanged', () => {
    expect(safeExcerpt('the gatekeeper reply was not JSON')).toBe('the gatekeeper reply was not JSON');
    expect(safeExcerpt('rate_limit_exceeded: try again later')).toBe('rate_limit_exceeded: try again later');
  });

  it('still allows newlines, unaffected by the bidi strip', () => {
    expect(safeExcerpt('line one\nline two')).toBe('line one\nline two');
  });

  it('keeps truncation behaviour unchanged, including when bidi characters are stripped first', () => {
    expect(safeExcerpt('abcdefghij', 5)).toBe('abcde');
    // Stripping happens before truncation, so a bidi character does not consume a slot in the limit.
    expect(safeExcerpt(`a‮bcdef`, 5)).toBe('abcde');
  });
});

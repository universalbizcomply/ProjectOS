import { describe, expect, it } from 'vitest';
import { MAX_DISPLAY_OUTPUT_CHARS, describeExecForOwner, sanitizeExecDisplayText } from '../src/computer/index.js';
import { polygo, preparedOf } from './computer-support.js';

describe('the command text an owner reads before deciding', () => {
  it('shows the command as it runs and as it was asked, each word on its own, with the hash it is bound to: the control', () => {
    const prepared = preparedOf(polygo(), { argv: ['env', 'git', 'log', 'a b', ''] });
    const shown = describeExecForOwner(prepared);
    expect(shown).toMatchObject({ launchers: ['env'], tenant: 'owner-personal', project: 'polygo', hash: prepared.hash });
    expect(shown?.asked.text).toBe('env git log "a b" ""');
    expect(shown?.runs.text).toBe('/usr/bin/git log "a b" ""');
    expect(shown?.cwd.text).toBe('"/work/polygo"');
    expect(shown).toMatchObject({ timeoutMs: 30000, maxOutputBytes: 65536, syntax: [] });
  });

  it('writes every hidden or spoofing character out as an escape, so the owner reads the command that runs', () => {
    const text = (value: string): string => sanitizeExecDisplayText(value).text;
    expect(text('a\u200bb')).toBe('a\\u{200B}b');
    expect(text('a\u202eb')).toBe('a\\u{202E}b');
    expect(text('a\u00a0b')).toBe('a\\u{A0}b');
    expect(text('a\u3000b')).toBe('a\\u{3000}b');
    expect(text('a\u0007b')).toBe('a\\u{7}b');
    expect(text('a\nb')).toBe('a\\u{A}b');
    expect(text('a b')).toBe('a b');
    const shown = describeExecForOwner(preparedOf(polygo(), { argv: ['git', 'status', 'x\u200by'] }));
    expect(shown?.runs.text).toBe('/usr/bin/git status "x\\u{200B}y"');
  });

  it('cuts a long command at the cap with a marker, and suppresses one that is far past it', () => {
    const long = sanitizeExecDisplayText('a'.repeat(MAX_DISPLAY_OUTPUT_CHARS + 50));
    expect(long.truncated).toBe(true);
    expect(long.text.endsWith('...[truncated]')).toBe(true);
    const huge = sanitizeExecDisplayText('a'.repeat(300 * 1024));
    expect(huge).toMatchObject({ oversized: true, truncated: false });
    expect(huge.text).not.toContain('aaaa');
  });

  it('shows nothing for a value the reader did not prepare', () => {
    const prepared = preparedOf(polygo());
    expect(describeExecForOwner({ ...prepared })).toBeNull();
  });
});

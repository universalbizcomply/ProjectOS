import { describe, expect, it } from 'vitest';
import { compileExecAllowlistPattern, execCanonicalPath } from '../src/computer/index.js';

const matcher = (pattern: string): ((target: unknown) => boolean) => {
  const compiled = compileExecAllowlistPattern(pattern);
  if (!compiled.ok) throw new Error(`the control pattern was refused: ${compiled.refusal}`);
  return compiled.pattern.matches;
};
const refusal = (raw: unknown): string => {
  const result = execCanonicalPath(raw);
  return result.ok ? 'ok' : result.refusal;
};

describe('canonical executable paths and allowlist patterns', () => {
  it('matches a posix executable by an exact pattern and by a one-segment wildcard: the positive control', () => {
    expect(matcher('/usr/bin/git')('/usr/bin/git')).toBe(true);
    expect(matcher('/usr/bin/*')('/usr/bin/git')).toBe(true);
    expect(matcher('/usr/bin/*')('/usr/bin/sub/git')).toBe(false);
    expect(matcher('/usr/local/**')('/usr/local/bin/git')).toBe(true);
    expect(matcher('/usr/bin/gi?')('/usr/bin/git')).toBe(true);
    expect(matcher('/usr/bin/git')('/usr/bin/gitk')).toBe(false);
    expect(matcher('/usr/bin/git')('/usr/bin/Git')).toBe(false);
  });

  it('matches a windows path in any case, with either separator, and through the extended-length prefix', () => {
    const matches = matcher('C:/Program Files/Git/bin/git.exe');
    expect(matches('c:\\program files\\git\\BIN\\Git.EXE')).toBe(true);
    expect(matches('C:/Program Files/./Git/bin/git.exe')).toBe(true);
    expect(matches('\\\\?\\C:\\Program Files\\Git\\bin\\git.exe')).toBe(true);
    expect(matches('C:\\Program Files\\Git\\bin\\git.cmd')).toBe(false);
    expect(matcher('\\\\server\\share\\tools\\*.exe')('//SERVER/Share/tools/a.exe')).toBe(true);
    expect(matcher('\\\\server\\share\\tools\\*.exe')('\\\\?\\UNC\\server\\share\\tools\\a.exe')).toBe(true);
  });

  it('refuses a path with a .. segment, as a target and as a pattern, instead of collapsing it', () => {
    expect(refusal('/usr/bin/../bin/git')).toBe('DOT_DOT');
    expect(matcher('/usr/bin/*')('/usr/bin/../../tmp/evil')).toBe(false);
    expect(compileExecAllowlistPattern('/usr/bin/../*')).toEqual({ ok: false, refusal: 'DOT_DOT' });
    expect(refusal('C:\\tools\\..\\Windows\\cmd.exe')).toBe('DOT_DOT');
  });

  it('refuses a trailing dot or space, an 8.3 short name, an alternate data stream and a device name', () => {
    expect(refusal('C:\\tools\\git.exe.')).toBe('TRAILING_DOT_OR_SPACE');
    expect(refusal('C:\\tools\\git.exe ')).toBe('TRAILING_DOT_OR_SPACE');
    expect(refusal('C:\\PROGRA~1\\Git\\git.exe')).toBe('SHORT_NAME');
    expect(refusal('/usr/bin/GITHUB~1')).toBe('SHORT_NAME');
    expect(refusal('C:\\tools\\git.exe:payload')).toBe('STREAM_OR_RESERVED');
    expect(refusal('C:\\tools\\con')).toBe('STREAM_OR_RESERVED');
    expect(refusal('C:\\tools\\com1.txt')).toBe('STREAM_OR_RESERVED');
    expect(refusal('C:\\tools\\a|b')).toBe('STREAM_OR_RESERVED');
    expect(matcher('C:/tools/*')('C:\\tools\\git.exe.')).toBe(false);
  });

  it('refuses a look-alike letter, a full-width character, a control character and any non-ASCII path', () => {
    expect(refusal('/usr/bin/g\u0456t')).toBe('NON_ASCII');
    expect(refusal('/usr/bin/\uff47\uff49\uff54')).toBe('NON_ASCII');
    expect(refusal('/usr/bin/git\u00a0')).toBe('NON_ASCII');
    expect(refusal('/usr/bin/git\u0000')).toBe('CONTROL_CHARACTER');
    expect(refusal('/usr/bin/git\n')).toBe('CONTROL_CHARACTER');
    expect(matcher('/usr/bin/git')('/usr/bin/g\u0456t')).toBe(false);
  });

  it('refuses a device path and every extended form other than a drive or a UNC path', () => {
    expect(refusal('\\\\.\\PhysicalDrive0')).toBe('DEVICE_PATH');
    expect(refusal('\\\\.\\pipe\\x')).toBe('DEVICE_PATH');
    expect(refusal('\\\\?\\GLOBALROOT\\Device\\x')).toBe('DEVICE_PATH');
    expect(refusal('\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\git.exe')).toBe('DEVICE_PATH');
    expect(refusal('//./C:/x')).toBe('DEVICE_PATH');
    expect(refusal('\\\\?\\C:\\x\\y')).toBe('ok');
  });

  it('refuses a backslash in a posix path rather than reading it as a separator', () => {
    expect(refusal('/usr/bin\\git')).toBe('AMBIGUOUS_SEPARATOR');
    expect(matcher('/usr/bin/git')('/usr/bin\\git')).toBe(false);
  });

  it('refuses a relative path, a drive-relative path, a home prefix and anything that is not text', () => {
    expect(refusal('git')).toBe('NOT_ABSOLUTE');
    expect(refusal('./git')).toBe('NOT_ABSOLUTE');
    expect(refusal('C:git.exe')).toBe('NOT_ABSOLUTE');
    expect(refusal('~/bin/git')).toBe('HOME_PREFIX');
    expect(refusal(42)).toBe('NOT_TEXT');
    expect(refusal('')).toBe('EMPTY');
    expect(refusal('/')).toBe('EMPTY');
    expect(refusal(`/${'a'.repeat(5000)}`)).toBe('TOO_LONG');
  });

  it('refuses a pattern that could stand for every executable, and a pattern it cannot read completely', () => {
    expect(compileExecAllowlistPattern('*')).toEqual({ ok: false, refusal: 'NOT_ABSOLUTE' });
    expect(compileExecAllowlistPattern('/**')).toEqual({ ok: false, refusal: 'WILDCARD_IN_FIRST_SEGMENT' });
    expect(compileExecAllowlistPattern('/*/git')).toEqual({ ok: false, refusal: 'WILDCARD_IN_FIRST_SEGMENT' });
    expect(compileExecAllowlistPattern('/usr/**/git')).toMatchObject({ ok: false, refusal: 'RECURSIVE_NEEDS_PREFIX' });
    expect(compileExecAllowlistPattern('/usr/**')).toMatchObject({ ok: false, refusal: 'RECURSIVE_NEEDS_PREFIX' });
    expect(compileExecAllowlistPattern('/usr/local/**')).toMatchObject({ ok: true });
    expect(compileExecAllowlistPattern('/usr/local/a**b**c**d')).toMatchObject({ ok: false, refusal: 'TOO_MANY_WILDCARDS' });
    expect(compileExecAllowlistPattern('/a/b/*/*/*/*/*/*/*/*/*')).toMatchObject({ ok: false, refusal: 'TOO_MANY_WILDCARDS' });
    expect(compileExecAllowlistPattern('~/bin/*')).toMatchObject({ ok: false, refusal: 'HOME_PREFIX' });
    expect(compileExecAllowlistPattern(undefined)).toMatchObject({ ok: false, refusal: 'NOT_TEXT' });
    expect(compileExecAllowlistPattern('\\\\*\\share\\x')).toMatchObject({ ok: false, refusal: 'WILDCARD' });
  });

  it('does not match a pattern of one path style against a target of the other', () => {
    expect(matcher('/c:/tools/git')('C:/tools/git')).toBe(false);
    expect(matcher('C:/tools/git.exe')('/tools/git.exe')).toBe(false);
  });
});

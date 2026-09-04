/**
 * THE COMPARISON THAT COULD NEVER SUCCEED.
 *
 * The live-work card and the Projects list both matched a run to a project by comparing the run's
 * root to the project's recorded path with `===`. On Windows the host supplies a backslash path and
 * `.projectops/project-config.json` records a forward-slash one — the same folder, spelled twice —
 * so a running programme was shown as interrupted while its worker was working.
 */
import { describe, test, expect } from 'vitest';
import { sameRepositoryRoot } from '../src/governed/sameRoot';

/** Built rather than written, so no escaping accident can quietly weaken this test. */
const BACK = String.fromCharCode(92);
const WINDOWS_STYLE = `C:${BACK}dev${BACK}ProjectOS`;
const POSIX_STYLE = 'C:/dev/ProjectOS';

describe('sameRepositoryRoot', () => {
  test('the two spellings this product actually produces are the same root', () => {
    expect(WINDOWS_STYLE).toContain(BACK);
    expect(sameRepositoryRoot(WINDOWS_STYLE, POSIX_STYLE)).toBe(true);
  });

  test('a trailing separator and drive-letter case do not make a different folder', () => {
    expect(sameRepositoryRoot('C:/dev/ProjectOS/', POSIX_STYLE)).toBe(true);
    expect(sameRepositoryRoot(`c:${BACK}dev${BACK}projectos`, POSIX_STYLE)).toBe(true);
  });

  test('different projects are still different, which is the whole point of comparing', () => {
    expect(sameRepositoryRoot(POSIX_STYLE, 'C:/dev/PolyGo')).toBe(false);
    expect(sameRepositoryRoot(POSIX_STYLE, 'C:/dev/ProjectOS2')).toBe(false);
    // A prefix is not a match.
    expect(sameRepositoryRoot('C:/dev', POSIX_STYLE)).toBe(false);
  });

  test('"we do not know" is never "the same place"', () => {
    expect(sameRepositoryRoot(null, POSIX_STYLE)).toBe(false);
    expect(sameRepositoryRoot(POSIX_STYLE, null)).toBe(false);
    expect(sameRepositoryRoot(undefined, undefined)).toBe(false);
    expect(sameRepositoryRoot('', '')).toBe(false);
    expect(sameRepositoryRoot('   ', POSIX_STYLE)).toBe(false);
  });

  test('a posix root compares the same way', () => {
    expect(sameRepositoryRoot('/home/murad/ProjectOS', '/home/murad/ProjectOS/')).toBe(true);
    expect(sameRepositoryRoot('/home/murad/ProjectOS', '/home/murad/Other')).toBe(false);
  });
});

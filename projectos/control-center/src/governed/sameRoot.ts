/**
 * DO TWO PATHS NAME THE SAME REPOSITORY?
 *
 * 2026-09-04: the live-work card never appeared, and the Projects list never said "Working", because
 * both compared the run's root to the project's recorded path with `===`. On Windows those are the
 * same folder written two ways: the host supplies `C:\dev\ProjectOS` and `.projectops/project-config
 * .json` records `C:/dev/ProjectOS`. The comparison could never be true, so a running programme was
 * displayed as interrupted while its worker was working.
 *
 * WHY COMPARE AT ALL. A run event carries its own root precisely so one project's activity is never
 * painted onto another's row. That guarantee is worth keeping; it just has to be able to succeed.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not resolve, canonicalise, or touch the filesystem —
 * the renderer has no filesystem, and a path that needs resolving is not a path this surface should
 * be trusting anyway. It normalises the two spellings that the SAME string can legitimately take on
 * the platform ProjectOS runs on, and nothing more. Anything else is not a match.
 */

/** Separator form, trailing separator, and case — the three ways one folder is spelled twice. */
function normalise(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const trimmed = slashed.endsWith('/') && slashed.length > 1 ? slashed.slice(0, -1) : slashed;
  // CASE-INSENSITIVITY IS A WINDOWS RULE, NOT A UNIVERSAL ONE. The two sources here disagree on
  // drive-letter case often enough to matter, so it is applied where it is true. Applying it
  // everywhere would make two genuinely different roots on a case-sensitive filesystem compare
  // equal — painting one project's activity onto another, the exact thing this module prevents.
  return typeof process !== 'undefined' && process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * True when both strings name the same repository root. Empty or absent values never match —
 * "we do not know" is not "the same place".
 */
export function sameRepositoryRoot(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.trim() === '' || b.trim() === '') return false;
  return normalise(a.trim()) === normalise(b.trim());
}

// Origin: original ProjectOS code
/**
 * HOW MANY NAMES A FILE HAS (PROJECTOS-RESUME1A).
 *
 * `EntryStat` (the search ports' lstat) has no link count, and `search/` is outside this phase's write paths, so the count is its own
 * small port: the one place this phase reaches `node:fs`. A file with more than one name can be another file's bytes under a path inside
 * the project (a hard link to something outside it), so a changed path with a second name is refused and never hashed or read.
 * `null` when the count cannot be read. Never throws.
 */
import { lstatSync } from 'node:fs';

export function resumeNodeLinkCount(path: string): number | null {
  try {
    return lstatSync(path).nlink;
  } catch {
    return null;
  }
}

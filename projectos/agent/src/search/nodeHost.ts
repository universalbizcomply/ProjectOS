// Origin: original ProjectOS code
/**
 * THE ONE PLACE THE SEARCH INDEX REACHES `node:fs` (PROJECTOS-MEMORY-STORES1A).
 *
 * `system.ts` has no `lstat` and no way to make a directory without writing a file in it. These two are what the index needs
 * beyond it, and they live here so the walk and the index stay free of the file system. Both are read-only on content: one
 * asks what a path is, and one makes the directory an index file lives in.
 */
import { lstatSync, mkdirSync } from 'node:fs';
import type { EntryProbe, EntryStat } from './ports.js';

/** `lstat`: a link is reported as a link and never followed. Never throws. */
export const nodeEntryProbe: EntryProbe = (path) => {
  try {
    const stat = lstatSync(path);
    const result: EntryStat = {
      kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
    return result;
  } catch {
    return null;
  }
};

/** Make the directory an index file lives in. Throws when it cannot, so a failed open says why. */
export function nodeEnsureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

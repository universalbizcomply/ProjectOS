/**
 * Git watcher — pure diff between two read-only git snapshots. Detects commits (head moved)
 * and working-tree changes. The daemon reacts to a commit by advancing the phase stage; it
 * NEVER commits, pushes, or mutates the repo itself.
 */
import type { GitSnapshot } from '../types.js';

export interface GitSignals {
  readonly committed: boolean;
  readonly branchChanged: boolean;
  readonly filesChanged: boolean;
  readonly head: string;
  readonly branch: string;
}

/** Compare snapshots and report what changed. Null-safe on either side. */
export function diffGit(prev: GitSnapshot | null, next: GitSnapshot | null): GitSignals {
  if (next === null) {
    return { committed: false, branchChanged: false, filesChanged: false, head: '', branch: '' };
  }
  if (prev === null) {
    return {
      committed: false,
      branchChanged: false,
      filesChanged: next.dirtyCount > 0,
      head: next.head,
      branch: next.branch,
    };
  }
  return {
    committed: prev.head !== next.head && next.head.length > 0,
    branchChanged: prev.branch !== next.branch,
    filesChanged: prev.dirtyCount !== next.dirtyCount,
    head: next.head,
    branch: next.branch,
  };
}

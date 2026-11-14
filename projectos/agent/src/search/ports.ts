// Origin: original ProjectOS code
/**
 * WHAT THE SEARCH INDEX MAY TOUCH, AS PORTS (PROJECTOS-MEMORY-STORES1A).
 *
 * The index and the document walk used `node:fs` and `Date.now()` directly, which put a file system and a clock outside the
 * agent's `System` port. These are the narrow ports they take now, so a test (and a caller that is not the CLI) supplies
 * its own, and the walk reads nothing the caller did not hand it.
 *
 * THE REAL `System` SATISFIES MOST OF THIS AND NOT ALL. It reads text, lists a directory and says the time. It has no `lstat`,
 * and the walk needs one, to see a link and to size a file before reading it. Adding `lstat` to `system.ts` is the
 * proper fix and `system.ts` is outside this phase's write paths, so the stat is a separate port (`EntryProbe`), and
 * `nodeHost.ts` is the one place that reaches `node:fs` for it. When `System` gains `lstat`, the probe goes.
 *
 * Types are structural and nothing here imports `system.ts`, so a `System` passes where a `DocumentSystem` is asked for.
 */

/** The time in whole milliseconds. Must be a finite number; the index refuses one that is not. */
export interface SearchClock {
  readonly nowMs: () => number;
}

/** The three methods of the agent's `System` the index and the walk use. A real `System` has them all. */
export interface DocumentSystem {
  /** The text, or null when there is no such file or it cannot be read. */
  readText(path: string): string | null;
  /** The names in a directory, or an empty list when there is none. */
  listDir(path: string): readonly string[];
  /** The time as an ISO-8601 string. */
  now(): string;
}

export type EntryKind = 'file' | 'directory' | 'link' | 'other';

export interface EntryStat {
  readonly kind: EntryKind;
  readonly size: number;
  readonly mtimeMs: number;
}

/** An `lstat`: what a path is WITHOUT following a link, or null when it cannot be read. Never throws. */
export type EntryProbe = (path: string) => EntryStat | null;

/** What the document walk reads through. */
export interface DocumentFs {
  readonly readText: (path: string) => string | null;
  readonly listDir: (path: string) => readonly string[];
  readonly stat: EntryProbe;
}

/** A `DocumentFs` made of a `System` and the probe that `System` lacks. */
export function documentFsOver(system: Pick<DocumentSystem, 'readText' | 'listDir'>, probe: EntryProbe): DocumentFs {
  return {
    readText: (path) => system.readText(path),
    listDir: (path) => system.listDir(path),
    stat: probe,
  };
}

/**
 * The index's clock, from a `System`. It never goes backwards: a system clock that steps back (a correction, a daylight change
 * misread) would otherwise make a rebuild look older than the one before it. A clock that gives no time throws, because every
 * number made from it would be wrong, and a `NaN` stored as a build time is not a time.
 */
export function searchClockOver(system: Pick<DocumentSystem, 'now'>): SearchClock {
  let latest = Number.NEGATIVE_INFINITY;
  return {
    nowMs: () => {
      const read = Date.parse(system.now());
      if (!Number.isFinite(read)) throw new Error('the clock did not give a time');
      latest = Math.max(latest, read);
      return latest;
    },
  };
}

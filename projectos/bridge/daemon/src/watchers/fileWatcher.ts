/**
 * File watcher — coalesces raw fs events into debounced, filtered path notifications.
 *
 * The raw fs.watch stream (from the system port) is noisy and fires mid-write; this filters
 * ignored folders and debounces bursts. Time is injected (onRaw/flush take `now`), so the
 * coalescing is deterministic and unit-testable without real timers.
 */
import type { DaemonConfig } from '../types.js';
import { Debouncer } from '../utils/debounce.js';

export class FileWatcher {
  readonly #ignored: readonly string[];
  readonly #debouncer: Debouncer;

  constructor(config: Pick<DaemonConfig, 'ignoredFolders' | 'debounceMs'>) {
    this.#ignored = config.ignoredFolders;
    this.#debouncer = new Debouncer(config.debounceMs);
  }

  /** True if a path lives inside an ignored folder. */
  isIgnored(path: string): boolean {
    const p = path.replace(/\\/g, '/');
    return this.#ignored.some((folder) => p.includes(`/${folder}/`) || p.endsWith(`/${folder}`));
  }

  /** Record a raw change (unless ignored). Debounced against `now`. */
  onRaw(path: string, now: number): void {
    if (this.isIgnored(path)) return;
    this.#debouncer.schedule(path, now);
  }

  /** Paths whose debounce window has elapsed by `now`. */
  flush(now: number): readonly string[] {
    return this.#debouncer.due(now);
  }

  get pending(): number {
    return this.#debouncer.size;
  }
}

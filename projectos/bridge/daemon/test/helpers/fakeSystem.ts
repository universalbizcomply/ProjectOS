/**
 * fakeSystem — in-memory DaemonSystem for deterministic tests. Virtual clock, counter-based
 * ids, a Map-backed filesystem, a capturable watch callback, and a settable git snapshot map.
 *
 * All methods are closures (not `this`-bound) so they survive being passed as detached
 * references (e.g. `system.now` into the Logger), exactly like the real nodeSystem.
 */
import type { DaemonSystem } from '../../src/system.js';
import type { GitSnapshot } from '../../src/types.js';

export interface FakeSystem extends DaemonSystem {
  files: Map<string, string>;
  dirs: Set<string>;
  logs: string[];
  gitSnapshots: Map<string, GitSnapshot>;
  lastWatch: { paths: readonly string[]; onRaw: (p: string) => void } | null;
  setNow(ms: number): void;
  put(path: string, content: string): void;
  mkdir(path: string): void;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

function parent(p: string): string {
  const n = norm(p);
  const idx = n.lastIndexOf('/');
  return idx <= 0 ? '' : n.slice(0, idx);
}

export function createFakeSystem(): FakeSystem {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const logs: string[] = [];
  const gitSnapshots = new Map<string, GitSnapshot>();
  let clockMs = 0;
  let monoMs = 0;
  let idCounter = 0;

  function registerAncestors(path: string): void {
    let cur = parent(path);
    while (cur.length > 0) {
      dirs.add(cur);
      cur = parent(cur);
    }
  }

  function addDir(path: string): void {
    const n = norm(path);
    dirs.add(n);
    registerAncestors(n);
  }

  function isDir(path: string): boolean {
    const n = norm(path);
    return dirs.has(n) || [...files.keys()].some((f) => f.startsWith(n + '/'));
  }

  function readDir(path: string): string[] {
    const n = norm(path);
    const names = new Set<string>();
    const collect = (full: string): void => {
      if (full.startsWith(n + '/')) {
        const first = full.slice(n.length + 1).split('/')[0];
        if (first) names.add(first);
      }
    };
    for (const f of files.keys()) collect(f);
    for (const d of dirs) collect(d);
    return [...names];
  }

  const sys: FakeSystem = {
    files,
    dirs,
    logs,
    gitSnapshots,
    lastWatch: null,

    setNow: (ms: number) => {
      clockMs = ms;
      monoMs = ms;
    },
    put: (path: string, content: string) => {
      const n = norm(path);
      files.set(n, content);
      registerAncestors(n);
    },
    mkdir: (path: string) => addDir(path),

    now: () => new Date(clockMs).toISOString(),
    monotonicMs: () => monoMs,
    newId: (prefix: string) => {
      idCounter += 1;
      return `${prefix}_${idCounter}`;
    },
    readFile: (path: string) => files.get(norm(path)) ?? null,
    writeFile: (path: string, content: string) => {
      const n = norm(path);
      if (!n.includes('/.projectops/')) throw new Error(`refused write outside .projectops: ${n}`);
      files.set(n, content);
      registerAncestors(n);
    },
    ensureDir: (path: string) => addDir(path),
    exists: (path: string) => {
      const n = norm(path);
      return files.has(n) || dirs.has(n) || [...files.keys()].some((f) => f.startsWith(n + '/'));
    },
    isDir,
    readDir,
    watch: (paths: readonly string[], onRaw: (p: string) => void) => {
      sys.lastWatch = { paths, onRaw };
      return () => {
        sys.lastWatch = null;
      };
    },
    readGitSnapshot: (root: string) => gitSnapshots.get(norm(root)) ?? null,
    log: (line: string) => {
      logs.push(line);
    },
  };
  return sys;
}

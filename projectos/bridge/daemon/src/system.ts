/**
 * DaemonSystem — the single I/O boundary (mirrors the Agent's system.ts pattern).
 *
 * Every side effect the daemon needs (clock, ids, filesystem, fs.watch, read-only git,
 * log sink) lives behind this port. Pure engines receive time/ids/data through it, so they
 * stay deterministic and unit-testable; tests inject a fakeSystem. This file is the ONLY
 * place that touches node:fs / node:crypto / node:process and is excluded from coverage.
 *
 * Guard rails baked in: writeFile refuses paths outside a `.projectops/` bridge area, so the
 * daemon can never write business code. There are no commit/push/deploy/db calls here.
 */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch as fsWatch,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { hrtime } from 'node:process';
import type { GitSnapshot } from './types.js';

export interface DaemonSystem {
  /** Wall-clock ISO timestamp for stamping events/state. */
  now(): string;
  /** Monotonic milliseconds for uptime (not wall clock). */
  monotonicMs(): number;
  /** A fresh id with the given prefix, e.g. evt_<uuid>. */
  newId(prefix: string): string;
  readFile(path: string): string | null;
  /** Write — refuses anything outside a `.projectops/` bridge area (see writeGuard). */
  writeFile(path: string, content: string): void;
  ensureDir(path: string): void;
  exists(path: string): boolean;
  isDir(path: string): boolean;
  readDir(path: string): string[];
  /** Watch paths recursively; returns an unsubscribe. Raw, undebounced. */
  watch(paths: readonly string[], onRaw: (path: string) => void): () => void;
  /** Read-only git snapshot (branch + head from .git files). null if not a repo. */
  readGitSnapshot(root: string): GitSnapshot | null;
  log(line: string): void;
}

/** A daemon write is only ever allowed inside a `.projectops/` tree. */
export function isWritableTarget(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return p.includes('/.projectops/');
}

function resolveHead(gitDirPath: string): { branch: string; head: string } | null {
  const headFile = join(gitDirPath, 'HEAD');
  if (!existsSync(headFile)) return null;
  const head = readFileSync(headFile, 'utf8').trim();
  const refMatch = head.match(/^ref:\s*(.+)$/);
  if (refMatch && refMatch[1]) {
    const ref = refMatch[1];
    const branch = ref.replace(/^refs\/heads\//, '');
    const refFile = join(gitDirPath, ref);
    if (existsSync(refFile)) {
      return { branch, head: readFileSync(refFile, 'utf8').trim() };
    }
    // Fall back to packed-refs.
    const packed = join(gitDirPath, 'packed-refs');
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([0-9a-f]{7,40})\s+(.+)$/);
        if (m && m[2] === ref && m[1]) return { branch, head: m[1] };
      }
    }
    return { branch, head: '' };
  }
  // Detached HEAD.
  return { branch: 'DETACHED', head };
}

/** The real adapter. Thin; all logic lives in the pure engines. */
export const nodeSystem: DaemonSystem = {
  now: () => new Date().toISOString(),
  monotonicMs: () => Number(hrtime.bigint() / 1_000_000n),
  newId: (prefix: string) => `${prefix}_${randomUUID()}`,
  readFile: (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  writeFile: (path: string, content: string) => {
    if (!isWritableTarget(path)) {
      throw new Error(`refused write outside .projectops: ${path}`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  },
  ensureDir: (path: string) => {
    mkdirSync(path, { recursive: true });
  },
  exists: (path: string) => existsSync(path),
  isDir: (path: string) => existsSync(path) && statSync(path).isDirectory(),
  readDir: (path: string) => (existsSync(path) ? readdirSync(path) : []),
  watch: (paths: readonly string[], onRaw: (path: string) => void) => {
    const watchers = paths
      .filter((p) => existsSync(p))
      .map((p) =>
        fsWatch(p, { recursive: true }, (_evt, filename) => {
          onRaw(filename ? join(p, filename.toString()) : p);
        }),
      );
    return () => {
      for (const w of watchers) w.close();
    };
  },
  readGitSnapshot: (root: string): GitSnapshot | null => {
    const gitDirPath = join(root, '.git');
    if (!existsSync(gitDirPath)) return null;
    const resolved = resolveHead(gitDirPath);
    if (resolved === null) return null;
    // dirtyCount requires a working-tree diff (git). Kept 0 here to avoid subprocesses;
    // commit detection relies on head advancing. Documented as a known limitation.
    return { branch: resolved.branch, head: resolved.head, dirtyCount: 0 };
  },
  log: (line: string) => {
    process.stdout.write(line + '\n');
  },
};

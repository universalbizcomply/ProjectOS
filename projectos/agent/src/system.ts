/**
 * System adapter: the ONLY impure edge of the CLI.
 *
 * Every command takes a System so it can be unit-tested with an in-memory fake. The
 * nodeSystem implementation is the real one used by the bin entrypoint. Because all the
 * command logic depends on this interface (never on node builtins directly), the commands
 * stay pure and deterministic.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface System {
  cwd(): string;
  /** Current time as an ISO-8601 string. */
  now(): string;
  /** Read a UTF-8 file, or null if it does not exist. */
  readText(path: string): string | null;
  /** Write a UTF-8 file, creating parent directories as needed. */
  writeText(path: string, content: string): void;
  exists(path: string): boolean;
  /** List entry names in a directory, or [] if it does not exist. */
  listDir(path: string): readonly string[];
  /** Run a command, capturing output. Never throws; non-zero code is returned. */
  exec(cmd: string, args: readonly string[]): ExecResult;
}

/** The real Node-backed System used at runtime. */
export const nodeSystem: System = {
  cwd() {
    return process.cwd();
  },
  now() {
    return new Date().toISOString();
  },
  readText(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  writeText(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  },
  exists(path) {
    return existsSync(path);
  },
  listDir(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  exec(cmd, args) {
    const r = spawnSync(cmd, [...args], { encoding: 'utf8', shell: false });
    return {
      code: r.status ?? 1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  },
};

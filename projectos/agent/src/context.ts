/**
 * Shared command plumbing: the context every command receives, the result it returns,
 * and pure path helpers. Paths use forward slashes throughout so the same code works on
 * Windows and POSIX and is trivially testable with an in-memory System.
 */
import type { System } from './system.js';

export interface CommandContext {
  readonly sys: System;
  /** Project root the command operates on. */
  readonly root: string;
}

export interface CommandResult {
  readonly code: number;
  readonly lines: readonly string[];
}

export function join(...parts: readonly string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

export function projectopsDir(root: string): string {
  return join(root, '.projectops');
}

export function configPath(root: string): string {
  return join(projectopsDir(root), 'project-config.json');
}

export function reportsDir(root: string): string {
  return join(root, 'knowledge', 'reports');
}

export function ok(lines: readonly string[]): CommandResult {
  return { code: 0, lines };
}

export function fail(code: number, lines: readonly string[]): CommandResult {
  return { code, lines };
}

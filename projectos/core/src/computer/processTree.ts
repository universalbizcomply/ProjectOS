// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/process/kill-tree.ts; packages/agent-core/src/harness/env/kill-tree.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the policy of the kill is taken, never signal a pid that is not a real process, terminate and then force after a grace period, bound the grace period, signal a whole group only when the process is known to lead one, and walk the tree on Windows and attached Linux; the signalling itself (taskkill, kill, procfs and ps reads, the timers) is cut and left to an injected port, so this file only PLANS; the caller's detached flag is no longer trusted: group kill needs a boolean fact and is refused on this process's own group, pid 1 and this process's own pid
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * How to stop a process and what it started: a plan, never an act.
 *
 * A PLAN, NOT A KILL. This file reads no process table, sends no signal and sets no timer. It turns a request into the
 * steps a runner will take through an injected port (terminate, then force after a grace period if the process is still
 * running), and refuses a request that would signal the wrong thing.
 *
 * NOTHING THE CALLER SAYS WIDENS A SIGNAL. The pid must be a whole number above 1 and not this process, so `0`, `-1` and `1`
 * (everything, the caller's own group, the init process) are refused. A group is signalled only when the request carries the
 * boolean fact that the process leads one (`=== true`, never a truthy value), and never when that group is this process's
 * own. The grace period is held to a cap, and anything that is not a finite number is the default.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the pid still names the process the runner started is the port's: the runner holds
 * the child's handle and stops signalling once the handle reports it has exited, so a recycled number is never signalled.
 *
 * Pure: no I/O.
 */

export const DEFAULT_GRACE_MS = 3_000;
export const MAX_GRACE_MS = 60_000;
export const KILL_PLATFORMS = ['win32', 'linux', 'darwin', 'other'] as const;
export type KillPlatform = (typeof KILL_PLATFORMS)[number];
export type KillSignal = 'SIGTERM' | 'SIGKILL';
export type KillTarget = 'process' | 'group' | 'tree';

export interface KillRequest {
  readonly pid: number;
  /** This process's own pid, which is never signalled. */
  readonly selfPid: number;
  /** This process's own process group id, which is never signalled as a group, or `null` when it is not known. */
  readonly ownGroupId: number | null;
  /** Whether the process was started detached, as a boolean fact from the spawn port, or `null` when unknown. */
  readonly detached: boolean | null;
  /** Whether the process leads its own process group, as a boolean fact, or `null` when unknown. */
  readonly isGroupLeader: boolean | null;
  readonly platform: KillPlatform;
  /** Skip the grace period and force at once. Only `true` counts. */
  readonly force: boolean;
  readonly graceMs?: unknown;
}

export interface KillStep {
  readonly signal: KillSignal;
  /** Milliseconds after the plan starts. */
  readonly afterMs: number;
  /** A step after the first is taken only if the process is still running. */
  readonly onlyIfRunning: boolean;
}

export interface KillPlan {
  readonly pid: number;
  readonly target: KillTarget;
  readonly graceMs: number;
  readonly steps: readonly KillStep[];
}

export type KillRefusal = 'REQUEST_SHAPE' | 'PID' | 'SELF' | 'OWN_GROUP';
export type KillPlanResult = { readonly ok: true; readonly plan: KillPlan } | { readonly ok: false; readonly code: KillRefusal };

/** The grace period: whole milliseconds within the cap, and the default for anything that is not a finite number. */
export function normalizeGraceMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GRACE_MS;
  return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
}

const isPidNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** The steps that stop `pid`, or the reason there are none. */
export function planKillTree(request: KillRequest): KillPlanResult {
  if (typeof request !== 'object' || request === null) return { ok: false, code: 'REQUEST_SHAPE' };
  const { pid, selfPid, ownGroupId, detached, isGroupLeader, platform, force } = request;
  if (!isPidNumber(pid) || pid <= 1) return { ok: false, code: 'PID' };
  if (!isPidNumber(selfPid) || pid === selfPid) return { ok: false, code: 'SELF' };
  if (!(KILL_PLATFORMS as readonly unknown[]).includes(platform)) return { ok: false, code: 'REQUEST_SHAPE' };
  const leadsGroup = detached === true || (detached !== false && isGroupLeader === true);
  if (leadsGroup && platform !== 'win32' && (ownGroupId === pid || ownGroupId === null)) return { ok: false, code: 'OWN_GROUP' };
  const target: KillTarget = platform === 'win32' ? 'tree' : leadsGroup ? 'group' : 'tree';
  const graceMs = normalizeGraceMs(request.graceMs);
  const steps: readonly KillStep[] =
    force === true
      ? [{ signal: 'SIGKILL', afterMs: 0, onlyIfRunning: false }]
      : [
          { signal: 'SIGTERM', afterMs: 0, onlyIfRunning: false },
          { signal: 'SIGKILL', afterMs: graceMs, onlyIfRunning: true },
        ];
  return { ok: true, plan: Object.freeze({ pid, target, graceMs, steps: Object.freeze(steps.map((step) => Object.freeze(step))) }) };
}

// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/process/exec-termination.ts; src/process/kill-tree.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the termination policy is taken, signal the tree, wait out a grace period, force only if the root is still running and never signal a process number once its handle says it has exited; the taskkill helper processes, the procfs and ps reads, the start-time identity checks, the zombie reaper, the abort controllers and the timers are cut; the signalling is an injected port, the grace timer is an injected timer, and the steps come from the core kill plan, so this file starts nothing and sleeps on nothing
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Carry out a kill plan through a process handle: terminate now, force later if the child is still running.
 *
 * NEVER SIGNAL A RETIRED CHILD. Every signal after the first is sent only if the handle still says the child is running, and
 * the handle is asked at the moment the escalation fires. A child that exited in the grace period gets no second signal, so
 * a number the system has handed to another process is never signalled. A signal that throws is recorded and the plan goes on.
 *
 * A KILL IS A BEST EFFORT AND SAYS SO. The report names what was sent, what failed and whether the child was still running
 * when the plan finished its immediate steps. It never claims the child is gone: the caller waits on the handle for that.
 *
 * NOTHING HERE STARTS A PROCESS. The plan is core's, the signal is the handle's, and the timer is the port's.
 */
import { planKillTree, type KillPlan, type KillRefusal, type KillSignal } from '@projectos/core';
import type { ProcessHandle, RunnerProcessFacts, TimerPort } from './ports.js';

export interface KillReport {
  readonly sent: readonly KillSignal[];
  readonly failed: readonly { readonly signal: KillSignal; readonly error: string }[];
}

export type StopStarted =
  | { readonly ok: true; readonly plan: KillPlan; readonly cancel: () => void; readonly report: () => KillReport }
  | { readonly ok: false; readonly code: KillRefusal };

/**
 * Begin stopping a child. The first signal goes now and any later one is scheduled on the timer. `cancel` withdraws the
 * escalation, and the caller calls it once the child has exited.
 */
export function beginStop(handle: ProcessHandle, ports: { readonly timer: TimerPort; readonly facts: RunnerProcessFacts }, options: { readonly force?: boolean; readonly graceMs?: unknown } = {}): StopStarted {
  const planned = planKillTree({
    pid: handle.pid,
    selfPid: ports.facts.selfPid,
    ownGroupId: ports.facts.ownGroupId,
    detached: handle.detached,
    isGroupLeader: handle.isGroupLeader,
    platform: ports.facts.platform,
    force: options.force === true,
    graceMs: options.graceMs,
  });
  if (!planned.ok) return { ok: false, code: planned.code };
  const plan = planned.plan;
  const sent: KillSignal[] = [];
  const failed: { signal: KillSignal; error: string }[] = [];
  const cancels: (() => void)[] = [];
  const send = (signal: KillSignal): void => {
    try {
      handle.signal(signal, plan.target);
      sent.push(signal);
    } catch (error) {
      failed.push({ signal, error: error instanceof Error ? error.message : String(error) });
    }
  };
  for (const step of plan.steps) {
    if (step.afterMs === 0) {
      send(step.signal);
      continue;
    }
    cancels.push(
      ports.timer.after(step.afterMs, () => {
        if (!step.onlyIfRunning || handle.isRunning()) send(step.signal);
      }),
    );
  }
  return {
    ok: true,
    plan,
    cancel: () => {
      for (const cancel of cancels) cancel();
    },
    report: () => Object.freeze({ sent: Object.freeze([...sent]), failed: Object.freeze(failed.map((entry) => Object.freeze({ ...entry }))) }),
  };
}

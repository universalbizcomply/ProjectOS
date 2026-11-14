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
 * A GROUP THAT CANNOT BE SIGNALLED SAFELY IS NOT ZERO SIGNALS. When the plan refuses a group kill (this process's own group, or a
 * group id that is not known), the child's own pid is still stopped, by a forced kill of that handle and nothing wider, and the
 * plan says it was degraded. A pid that is not a real process, this process and the init process are still never signalled.
 *
 * A SWEEP IS A GROUP SIGNAL AND NOTHING ELSE. A leader that exited on its own may have left members of its group behind, so
 * `planGroupSweep` answers a plan only when the plan is a whole group and was not degraded. A sweep never signals a bare pid
 * of a child that has exited.
 *
 * A KILL IS A BEST EFFORT AND SAYS SO. The report names what was sent and what failed. It never claims the child is gone: the
 * caller waits on the handle for that.
 *
 * NOTHING HERE STARTS A PROCESS. The plan is core's, the signal is the handle's, and the timer is the port's.
 */
import { planKillTree, type KillPlan, type KillRefusal, type KillSignal } from '@projectos/core';
import type { ProcessHandle, RunnerProcessFacts, TimerPort } from './ports.js';

export interface KillReport {
  readonly sent: readonly KillSignal[];
  readonly failed: readonly { readonly signal: KillSignal; readonly error: string }[];
}

export type StopPlanned =
  | { readonly ok: true; readonly plan: KillPlan; readonly degradedFrom: KillRefusal | null }
  | { readonly ok: false; readonly code: KillRefusal };

export type StopStarted =
  | { readonly ok: true; readonly plan: KillPlan; readonly degradedFrom: KillRefusal | null; readonly cancel: () => void; readonly report: () => KillReport }
  | { readonly ok: false; readonly code: KillRefusal };

interface StopOptions {
  readonly force?: boolean;
  readonly graceMs?: unknown;
}

/** The plan for stopping this child, without sending anything. */
export function planStop(handle: ProcessHandle, ports: { readonly facts: RunnerProcessFacts }, options: StopOptions = {}): StopPlanned {
  const request = {
    pid: handle.pid,
    selfPid: ports.facts.selfPid,
    ownGroupId: ports.facts.ownGroupId,
    detached: handle.detached,
    isGroupLeader: handle.isGroupLeader,
    platform: ports.facts.platform,
    force: options.force === true,
    graceMs: options.graceMs,
  };
  const first = planKillTree(request);
  // Only a group that cannot be signalled safely degrades to the handle's own pid, forced. A bad pid or this process never does.
  const planned = !first.ok && first.code === 'OWN_GROUP' ? planKillTree({ ...request, detached: false, isGroupLeader: false, force: true }) : first;
  if (!planned.ok) return { ok: false, code: planned.code };
  return { ok: true, plan: planned.plan, degradedFrom: first.ok ? null : first.code };
}

/** The forced plan for the group a leader left behind, or `null` when it is not a whole, safe group (so nothing is sent). */
export function planGroupSweep(handle: ProcessHandle, ports: { readonly facts: RunnerProcessFacts }): Extract<StopPlanned, { ok: true }> | null {
  if (handle.detached !== true && handle.isGroupLeader !== true) return null;
  const planned = planStop(handle, ports, { force: true });
  return planned.ok && planned.plan.target === 'group' && planned.degradedFrom === null ? planned : null;
}

/** Send a plan's first signal now and schedule the rest. `cancel` withdraws the escalation, and the caller calls it once the child has exited. */
export function executeStop(handle: ProcessHandle, timer: TimerPort, planned: Extract<StopPlanned, { ok: true }>): Extract<StopStarted, { ok: true }> {
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
      timer.after(step.afterMs, () => {
        if (!step.onlyIfRunning || handle.isRunning()) send(step.signal);
      }),
    );
  }
  return {
    ok: true,
    plan,
    degradedFrom: planned.degradedFrom,
    cancel: () => {
      for (const cancel of cancels) cancel();
    },
    report: () => Object.freeze({ sent: Object.freeze([...sent]), failed: Object.freeze(failed.map((entry) => Object.freeze({ ...entry }))) }),
  };
}

/**
 * Begin stopping a child. The first signal goes now and any later one is scheduled on the timer. `cancel` withdraws the
 * escalation, and the caller calls it once the child has exited.
 */
export function beginStop(handle: ProcessHandle, ports: { readonly timer: TimerPort; readonly facts: RunnerProcessFacts }, options: StopOptions = {}): StopStarted {
  const planned = planStop(handle, ports, options);
  return planned.ok ? executeStop(handle, ports.timer, planned) : planned;
}

// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/process/exec-runner.ts; src/process/exec-result.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the run policy is taken, an execution timeout that stops the process tree, a cap on captured output, and a cleanup outcome that says when the stop could not be confirmed (an admitted command may still write, so nothing is retried); the child process API, the stdio plumbing, the no-output timer, the encodings, the buffer variants, the Windows paths, the lanes and the queue are cut; the process is started through an injected spawn port, the timers are an injected timer port, the environment is the declared names read through an injected environment port, and only a launch plan the core module minted is accepted
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Run one launch plan behind injected ports, once, and report what happened as data.
 *
 * ONLY A MINTED PLAN RUNS. The runner accepts a value only if the core module made it (`isExecLaunchPlan`), launches the
 * plan's argument list, working directory, environment names and limits and reads none of them from anywhere else, and runs a
 * given plan once. The plan is marked run BEFORE the child is started, so a start that throws, a child that times out and a
 * runner that crashes mid-run never leave a plan that can be run a second time.
 *
 * A STALE PLAN IS REFUSED. A plan is good for a minute and for the policy and the grant it was made under. At the moment it would
 * start, the runner asks the gate port for the time, the digest of the policy now in force and whether the grant was revoked,
 * and refuses a plan that is past its expiry (`PLAN_EXPIRED`), cleared under another policy (`POLICY_CHANGED`) or for a revoked
 * grant (`GRANT_REVOKED`). A gate that is absent, throws or cannot say is `GATE_UNAVAILABLE`: the answer is no. A refused plan was
 * never started, so it is not marked run.
 *
 * A POSSIBLY-ACTED RUN IS NEVER RETRIED. `start` throwing does not prove nothing started, and a child that was stopped may
 * have written first. The outcome says `actedUnknown: true` for every launch attempt, the plan stays spent, and nothing falls
 * back to another way of running the same command.
 *
 * EVERY FAILURE PATH RELEASES. The timeout is cancelled and any escalation is withdrawn in `finally`, and a child that is
 * still running when the run ends for any reason other than its own exit is forced, whether or not a stop was already begun
 * (a refused or failed terminate must not leave it alive). A group leader that exited on its own has its whole group swept. A
 * group kill that is refused as unsafe is degraded to a forced kill of the child's own pid, never to zero signals. The timeout and the settle window are
 * injected timers, so no wall clock is read here.
 *
 * OUTPUT IS DATA. What the child printed is bounded to the plan's byte cap, then fenced, labelled untrusted and hashed by the
 * core module, so it can be handed to a model without being read as an instruction.
 *
 * THE ENVIRONMENT IS THE DECLARED NAMES. The child gets the names the plan was cleared under, each read through the
 * environment port, and nothing the host happens to have. The core module refused every loader and credential name before
 * the plan existed, so a plan cannot name one.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the spawn port starts exactly the argument list it is given, with no shell, is the port's.
 */
import { fenceUntrustedOutput, isExecLaunchPlan, readComputerClock, type ExecLaunchPlan, type FencedOutput, type KillRefusal } from '@projectos/core';
import { describeThrown, MAX_START_ERROR_CHARS } from './describeThrown.js';
import { beginStop, executeStop, planGroupSweep, stillRunning, type KillReport, type StopStarted } from './killTree.js';
import type { OutputStream, PlanGatePort, ProcessExit, ProcessHandle, RunnerPorts } from './ports.js';

/** How long to wait for a stopped child to confirm its exit before the run is reported unconfirmed. */
export const SETTLE_WINDOW_MS = 5_000;


export type RunRefusal = 'NOT_A_PLAN' | 'PLAN_ALREADY_RUN' | 'PLAN_EXPIRED' | 'POLICY_CHANGED' | 'GRANT_REVOKED' | 'GATE_UNAVAILABLE';
export type RunStatus = 'exited' | 'timed-out' | 'start-failed' | 'exit-unknown';
export type CleanupOutcome = 'normal' | 'forced' | 'uncertain';

export type RunOutcome =
  | { readonly ok: false; readonly code: RunRefusal }
  | {
      readonly ok: true;
      readonly status: RunStatus;
      readonly exit: ProcessExit | null;
      readonly stdout: FencedOutput;
      readonly stderr: FencedOutput;
      readonly outputTruncated: boolean;
      readonly cleanup: CleanupOutcome;
      readonly stop: KillReport | null;
      readonly killRefused: KillRefusal | null;
      /** Set when a group kill was refused as unsafe and the child's own pid was stopped instead. */
      readonly killDegradedFrom: KillRefusal | null;
      /** True when a leader that exited on its own had its group swept. */
      readonly groupSwept: boolean;
      /** Always true once a launch was attempted: the command may have acted, so it is never retried. */
      readonly actedUnknown: true;
      /** What the spawn port said when the start failed: bounded, cleaned and fenced as untrusted data. */
      readonly startError: FencedOutput | null;
    };

const RUN = new WeakSet<object>();

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

interface Capture {
  readonly chunks: Record<OutputStream, string[]>;
  bytes: number;
  truncated: boolean;
}

/** Take a chunk while the cap holds. The part that fits is kept, and the rest is dropped and counted as truncation. */
function take(capture: Capture, stream: OutputStream, chunk: string, cap: number): void {
  if (capture.truncated) return;
  const size = utf8Length(chunk);
  if (capture.bytes + size <= cap) {
    capture.chunks[stream].push(chunk);
    capture.bytes += size;
    return;
  }
  let fit = '';
  for (const ch of chunk) {
    const next = utf8Length(ch);
    if (capture.bytes + next > cap) break;
    fit += ch;
    capture.bytes += next;
  }
  if (fit !== '') capture.chunks[stream].push(fit);
  capture.truncated = true;
}

function envOf(plan: ExecLaunchPlan, ports: RunnerPorts): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of plan.envNames) {
    const value = ports.env.read(name);
    if (typeof value === 'string') env[name] = value;
  }
  return env;
}

const finished = (capture: Capture, fields: Omit<Extract<RunOutcome, { ok: true }>, 'ok' | 'stdout' | 'stderr' | 'outputTruncated' | 'actedUnknown'>): RunOutcome =>
  Object.freeze({
    ok: true,
    stdout: fenceUntrustedOutput('stdout', capture.chunks.stdout.join('')),
    stderr: fenceUntrustedOutput('stderr', capture.chunks.stderr.join('')),
    outputTruncated: capture.truncated,
    actedUnknown: true,
    ...fields,
  });

/** The last instant a gate's clock showed, so a clock that jumped forward and was corrected cannot make an expired plan fresh. */
const GATE_LAST_SEEN = new WeakMap<object, number>();

/**
 * Whether a plan has gone stale since it was made: past its expiry, cleared under another policy than the one in force now, or
 * for a grant that was revoked. A gate that is missing, throws or cannot say is a refusal, never a pass.
 */
function staleRefusal(plan: ExecLaunchPlan, gate: PlanGatePort | undefined): RunRefusal | null {
  if (typeof gate !== 'object' || gate === null) return 'GATE_UNAVAILABLE';
  const now = readComputerClock(gate.clock, GATE_LAST_SEEN.get(gate) ?? 0);
  if (now === null) return 'GATE_UNAVAILABLE';
  GATE_LAST_SEEN.set(gate, now);
  if (now >= plan.expiresAt) return 'PLAN_EXPIRED';
  let digest: unknown;
  try {
    digest = gate.policyDigest();
  } catch {
    return 'GATE_UNAVAILABLE';
  }
  if (typeof digest !== 'string' || digest !== plan.policyDigest) return 'POLICY_CHANGED';
  if (plan.grantId === null) return null;
  let revoked: unknown;
  try {
    revoked = gate.grantRevoked(plan.tenant, plan.project, plan.grantId);
  } catch {
    return 'GATE_UNAVAILABLE';
  }
  return revoked === false ? null : 'GRANT_REVOKED';
}

const mergeReports = (reports: readonly (KillReport | null)[]): KillReport | null => {
  const present = reports.filter((report): report is KillReport => report !== null);
  if (present.length === 0) return null;
  return Object.freeze({ sent: Object.freeze(present.flatMap((report) => report.sent)), failed: Object.freeze(present.flatMap((report) => report.failed)) });
};

/** What happens after the child is started: wait for its exit, stop it at the timeout, and release everything. */
async function supervise(handle: ProcessHandle, plan: ExecLaunchPlan, ports: RunnerPorts, capture: Capture): Promise<RunOutcome> {
  const state: { timedOut: boolean; stop: StopStarted | null; force: StopStarted | null; settle: (() => void) | null } = { timedOut: false, stop: null, force: null, settle: null };
  const cancels: (() => void)[] = [];
  let exit: ProcessExit | null = null;
  let exitLost = false;
  try {
    handle.onOutput((stream, chunk) => take(capture, stream, chunk, plan.maxOutputBytes));
    const settled = new Promise<null>((resolve) => {
      state.settle = () => resolve(null);
    });
    cancels.push(
      ports.timer.after(plan.timeoutMs, () => {
        state.timedOut = true;
        state.stop = beginStop(handle, ports);
        const grace = state.stop.ok ? state.stop.plan.graceMs : 0;
        cancels.push(ports.timer.after(SETTLE_WINDOW_MS + grace, () => state.settle?.()));
      }),
    );
    exit = await Promise.race([handle.waitForExit(), settled]);
  } catch {
    exitLost = true;
  } finally {
    for (const cancel of cancels) cancel();
    if (state.stop?.ok === true) state.stop.cancel();
    // Whatever the stop did, a child still running when the run ends is forced: a refused or failed terminate must not end the run with it alive.
    const alreadyForced = state.stop?.ok === true && state.stop.report().sent.includes('SIGKILL');
    if (exit === null && !alreadyForced && stillRunning(handle)) state.force = beginStop(handle, ports, { force: true });
  }
  // A leader that exited on its own may have left its group behind: sweep the whole group, and only a whole, safe group.
  let sweep: ReturnType<typeof executeStop> | null = null;
  try {
    const sweepPlan = exit !== null ? planGroupSweep(handle, ports) : null;
    sweep = sweepPlan === null ? null : executeStop(handle, ports.timer, sweepPlan);
  } catch {
    // A handle that throws when asked about its group is not swept; the run still reports.
    sweep = null;
  }
  const stops = [state.stop, state.force].filter((entry): entry is StopStarted => entry !== null);
  const report = mergeReports([...stops.map((entry) => (entry.ok ? entry.report() : null)), sweep === null ? null : sweep.report()]);
  const forced = report?.sent.includes('SIGKILL') === true;
  const cleanup: CleanupOutcome = exit === null ? 'uncertain' : forced ? 'forced' : 'normal';
  const status: RunStatus = state.timedOut ? 'timed-out' : exitLost || exit === null ? 'exit-unknown' : 'exited';
  const refused = stops.find((entry) => !entry.ok);
  const degraded = stops.find((entry) => entry.ok && entry.degradedFrom !== null);
  return finished(capture, {
    status,
    exit,
    cleanup,
    stop: report,
    killRefused: refused !== undefined && !refused.ok ? refused.code : null,
    killDegradedFrom: degraded !== undefined && degraded.ok ? degraded.degradedFrom : null,
    groupSwept: sweep !== null,
    startError: null,
  });
}


/** Run a plan once. The first call is the only call; a second is `PLAN_ALREADY_RUN`, whatever happened in the first. */
export async function runExecPlan(plan: ExecLaunchPlan, ports: RunnerPorts): Promise<RunOutcome> {
  if (!isExecLaunchPlan(plan)) return { ok: false, code: 'NOT_A_PLAN' };
  if (RUN.has(plan)) return { ok: false, code: 'PLAN_ALREADY_RUN' };
  // A plan that went stale, or whose gate cannot say, is refused before anything starts, and is not marked run: nothing acted.
  const stale = staleRefusal(plan, ports.gate);
  if (stale !== null) return { ok: false, code: stale };
  RUN.add(plan);
  const capture: Capture = { chunks: { stdout: [], stderr: [] }, bytes: 0, truncated: false };
  let handle: ProcessHandle;
  try {
    handle = ports.spawn.start({ argv: plan.argv, cwd: plan.cwd, env: envOf(plan, ports) });
  } catch (error) {
    return finished(capture, {
      status: 'start-failed',
      exit: null,
      cleanup: 'uncertain',
      stop: null,
      killRefused: null,
      killDegradedFrom: null,
      groupSwept: false,
      startError: describeThrown(error),
    });
  }
  return supervise(handle, plan, ports, capture);
}

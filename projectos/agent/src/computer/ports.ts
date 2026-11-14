// Origin: original ProjectOS code
/**
 * The ports the computer runner is written against. Nothing in this directory starts a process, reads the environment or
 * sets a timer itself: a caller hands in a spawn port, an environment port and a timer port, and tests hand in fakes.
 *
 * A PORT IS A PROMISE ABOUT ONE CHILD. A `ProcessHandle` is the child the runner started, and `isRunning` is the handle's
 * own answer about that child, so the runner never signals a process number it only remembers: once the handle says the child
 * has exited, no signal goes out, and a recycled number is never hit.
 *
 * THE REAL PORTS ARE STAGE 4.3'S, AND THEY HAVE A CONTRACT. The real executable resolver (core's `ExecutableResolverPort`) and the
 * real spawn port must refuse a resolved `.cmd` or `.bat` target (a batch file runs a shell, whatever its name), must start
 * exactly the argument list they are given with no shell, must read only the names they are handed from the environment, and
 * must be conformance-tested against the path and launcher rules in core before anything is switched on. Nothing here proves
 * that; a fake stands in for each in every test.
 *
 * NO CHILD PROCESS API IS IMPORTED HERE. The validator refuses `node:child_process` in this directory and in the core side. The
 * real spawn port is Stage 4.3's, behind the sandbox.
 */
import type { ComputerClock, KillPlatform, KillSignal, KillTarget } from '@projectos/core';

export type OutputStream = 'stdout' | 'stderr';

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface ProcessHandle {
  readonly pid: number;
  /** Whether the child was started detached, as a boolean fact from the port. */
  readonly detached: boolean;
  /** Whether the child leads its own process group, as a boolean fact from the port. */
  readonly isGroupLeader: boolean;
  /** The handle's own answer about this child. */
  readonly isRunning: () => boolean;
  /** Send one signal. It may throw; the runner records that and goes on. */
  readonly signal: (signal: KillSignal, target: KillTarget) => void;
  /** Output arrives as text, in order, per stream. */
  readonly onOutput: (listener: (stream: OutputStream, chunk: string) => void) => void;
  /** Resolves once the child has exited. */
  readonly waitForExit: () => Promise<ProcessExit>;
}

export interface SpawnSpec {
  /** The real executable and its arguments. Never a shell line. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Exactly the declared names that have a value. The port adds nothing from the host's own environment. */
  readonly env: Readonly<Record<string, string>>;
}

export interface SpawnPort {
  /** Start the child, or throw. A throw means the child may or may not have started. */
  readonly start: (spec: SpawnSpec) => ProcessHandle;
}

/** The only timer: `after` runs `fn` once after `ms` and returns a function that cancels it. */
export interface TimerPort {
  readonly after: (ms: number, fn: () => void) => () => void;
}

export interface EnvPort {
  readonly read: (name: string) => string | undefined;
}

export interface RunnerProcessFacts {
  /** This process's own pid and process group, so a kill can never reach them. */
  readonly selfPid: number;
  readonly ownGroupId: number | null;
  readonly platform: KillPlatform;
}

/**
 * What the runner asks at the moment it would start, because a plan is only good for a minute and a grant can be revoked or a
 * policy changed after the plan was made. A port that is missing, throws or answers anything but a plain boolean or the digest
 * of a policy makes the plan stale: the answer is no.
 */
export interface PlanGatePort {
  /** The caller's clock, read once at the start of a run and never allowed to run backwards. */
  readonly clock: ComputerClock;
  /** The digest of the exec policy now in force, or `null` when there is none. */
  readonly policyDigest: () => string | null;
  /** Whether the grant a plan spent has been revoked. A grant the store does not hold reads as revoked. */
  readonly grantRevoked: (tenant: string, project: string, grantId: string) => boolean;
}

export interface RunnerPorts {
  readonly gate: PlanGatePort;
  readonly spawn: SpawnPort;
  readonly timer: TimerPort;
  readonly env: EnvPort;
  readonly facts: RunnerProcessFacts;
}

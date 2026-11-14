// Origin: original ProjectOS code
/**
 * The ports the computer runner is written against. Nothing in this directory starts a process, reads the environment or
 * sets a timer itself: a caller hands in a spawn port, an environment port and a timer port, and tests hand in fakes.
 *
 * A PORT IS A PROMISE ABOUT ONE CHILD. A `ProcessHandle` is the child the runner started, and `isRunning` is the handle's
 * own answer about that child, so the runner never signals a process number it only remembers: once the handle says the child
 * has exited, no signal goes out, and a recycled number is never hit.
 *
 * NO CHILD PROCESS API IS IMPORTED HERE. The validator refuses `node:child_process` in this directory and in the core side. The
 * real spawn port is Stage 4.3's, behind the sandbox.
 */
import type { KillPlatform, KillSignal, KillTarget } from '@projectos/core';

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

export interface RunnerPorts {
  readonly spawn: SpawnPort;
  readonly timer: TimerPort;
  readonly env: EnvPort;
  readonly facts: RunnerProcessFacts;
}

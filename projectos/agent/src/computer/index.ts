// Origin: original ProjectOS code
/**
 * The agent side of the computer rules (PROJECTOS-PORT-COMPUTER1A): a runner and a kill-tree executor written against
 * injected spawn, timer and environment ports. Nothing calls them yet, nothing here starts a process, and `agent/src/index.ts`
 * does not export this directory: the sandbox (Stage 4.3) is the first caller and brings the real spawn port.
 */
export { SETTLE_WINDOW_MS, runExecPlan, type CleanupOutcome, type RunOutcome, type RunRefusal, type RunStatus } from './execRunner.js';
export { beginStop, type KillReport, type StopStarted } from './killTree.js';
export type { EnvPort, OutputStream, ProcessExit, ProcessHandle, RunnerPorts, RunnerProcessFacts, SpawnPort, SpawnSpec, TimerPort } from './ports.js';

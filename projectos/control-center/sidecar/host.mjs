#!/usr/bin/env node
/**
 * ProjectOS daemon sidecar — the Node process the Tauri Rust host launches.
 *
 * It runs a real BridgeDaemon (nodeSystem) and reuses the tested InProcessTransport to project
 * daemon state; every TransportMessage is written as one JSON line to stdout, which the Rust host
 * forwards to the webview over the `daemon://message` event channel. It reads commands from stdin.
 * Strictly read-only: it never commits/pushes/deploys/mutates.
 *
 * LIFECYCLE (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B)
 * -------------------------------------------------
 * The host cannot infer readiness from ordinary output: `transport.connect()` emits
 * `{"kind":"snapshot",…}`, and so does every later snapshot and bus event — same shape, no version,
 * no instance. So this process announces readiness EXPLICITLY, exactly once, as its final startup
 * step, on a distinct discriminant (`type`, not `kind`):
 *
 *   {"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"…","status":"read-only"}
 *
 * Readiness is not trust, not identity, and enables no approvals — it only means "startup finished
 * and the command channel is live".
 *
 * The graceful shutdown below is CLEANUP ONLY. It is NOT the parent-death guarantee: the host binds
 * this process to a Windows Job Object with kill-on-close, and that is what survives a force-kill.
 *
 * Run `npm run build:sidecar` first (emits node-build/) so the import below resolves.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join as joinPath, isAbsolute, basename } from 'node:path';
import { BridgeDaemon, nodeSystem, loadConfig } from '@projectos/bridge-daemon';
import { InProcessTransport } from '../node-build/daemon/inProcessTransport.js';
import { projectGovernedState } from '../node-build/governed/governedProjection.js';
import { validateGovernedCommand, toAgentInvocation } from '../node-build/governed/governedCommands.js';
import { phase as phaseCommand, approve as approveCommand, report as reportCommand, nodeSystem as agentSystem } from '@projectos/agent';
import { gitBoundSystem } from './gitBoundSystem.mjs';

const LIFECYCLE_PROTOCOL_VERSION = 1;
/** Bounded: the id is a short non-secret correlator, never a credential. */
const MAX_INSTANCE_ID_LEN = 64;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const EXIT_OK = 0;
const EXIT_BAD_INSTANCE = 3;

/**
 * The host injects this. Its absence means we were not launched by the ProjectOS host, so we refuse
 * to start rather than run unowned.
 */
function readInstanceId() {
  const raw = process.env.PROJECTOS_DAEMON_INSTANCE_ID;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INSTANCE_ID_LEN) return null;
  if (!INSTANCE_ID_PATTERN.test(raw)) return null;
  return raw;
}

function resolveConfig() {
  const roots = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--root' && process.argv[i + 1]) {
      roots.push(process.argv[i + 1]);
      i += 1;
    }
  }
  const raw = existsSync('bridge.config.json') ? readFileSync('bridge.config.json', 'utf8') : null;
  const { config } = loadConfig(raw);
  return { ...config, watchRoots: [...config.watchRoots, ...roots] };
}

/* --- governed state (READ-ONLY) -------------------------------------------------------------
 * The daemon's own model is NOT the governance authority: it carries a twelve-stage `PhaseStage`
 * spine of its own, while `@projectos/core` carries the nine-status governed lifecycle persisted to
 * `.projectops/phases/<id>.json`. The owner surface must read the SECOND one, so this reads the
 * canonical records directly and projects them with the same pure function the browser tests use.
 * Reads only. It never writes, and it never decides readiness itself — the real
 * `plan-governance-engine.cjs` does that, resolved beside this package so a target project cannot
 * substitute its own engine.
 */
const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLAN_RELPATH = '.projectops/plan.json';

function loadEngine() {
  return require_(resolvePath(HERE, '../../validators/plan-governance-engine.cjs'));
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** Same confinement rule as the runtime: a declared path may never leave its project root. */
function resolveDeclared(engine, root, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (!engine.isSafeRepoRelativePath(rel)) return null;
  return joinPath(root, rel);
}

function readPhaseRecords(root) {
  const dir = joinPath(root, '.projectops', 'phases');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/** Build the governed state for `root`, or an honest unavailable reason. Never throws. */
function buildGovernedState(root, observedAt) {
  if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
    return { connected: false, reason: 'NO_RUNTIME', detail: 'No governed project root was supplied.' };
  }
  const cfg = readJsonFile(joinPath(root, '.projectops', 'project-config.json'));
  if (cfg === null) {
    return {
      connected: false,
      reason: 'NO_RUNTIME',
      detail: `No ProjectOS project config at ${root}. Governed control needs an installed .projectops.`,
    };
  }
  let engine;
  try {
    engine = loadEngine();
  } catch {
    return { connected: false, reason: 'REFUSED', detail: 'The plan-governance engine could not be loaded.' };
  }

  const declaredPlan = cfg.planMemory && cfg.planMemory.planPath;
  const planPathAbs =
    declaredPlan === undefined
      ? joinPath(root, DEFAULT_PLAN_RELPATH)
      : resolveDeclared(engine, root, declaredPlan);
  if (planPathAbs === null) {
    return {
      connected: false,
      reason: 'REFUSED',
      detail: 'The configured plan location is not a safe project-relative path and was refused.',
    };
  }
  const plan = readJsonFile(planPathAbs);
  if (plan === null) {
    return {
      connected: false,
      reason: 'REFUSED',
      detail: 'No readable approved plan at the configured plan location.',
    };
  }

  let currentState = null;
  const declaredState = cfg.planMemory && cfg.planMemory.currentStatePath;
  if (declaredState !== undefined) {
    const statePathAbs = resolveDeclared(engine, root, declaredState);
    if (statePathAbs === null) {
      return {
        connected: false,
        reason: 'REFUSED',
        detail: 'The configured current-state location is not a safe project-relative path and was refused.',
      };
    }
    currentState = readJsonFile(statePathAbs);
  }

  try {
    return projectGovernedState({
      config: cfg,
      plan,
      currentState,
      phaseRecords: readPhaseRecords(root),
      readiness: engine.evaluatePlanReady(plan),
      planPath: declaredPlan === undefined ? DEFAULT_PLAN_RELPATH : declaredPlan,
      branch: null,
      head: null,
      observedAt,
    });
  } catch {
    return { connected: false, reason: 'REFUSED', detail: 'Governed state could not be projected.' };
  }
}

const daemonInstanceId = readInstanceId();
if (daemonInstanceId === null) {
  // Typed startup failure: no ready message is emitted, so the host times out and stops us.
  process.stderr.write('projectos sidecar: missing or invalid PROJECTOS_DAEMON_INSTANCE_ID\n');
  process.exit(EXIT_BAD_INSTANCE);
}

const config = resolveConfig();
// Keep stdout a pure JSON-line protocol channel: route the daemon's own log lines to stderr.
const system = { ...nodeSystem, log: (line) => process.stderr.write(line + '\n') };
const daemon = new BridgeDaemon(system, config);
const transport = new InProcessTransport(daemon);

transport.onMessage((message) => {
  process.stdout.write(JSON.stringify(message) + '\n');
});

/**
 * Execute one governed command against the CANONICAL runtime.
 *
 * The verb set is closed and the arguments are typed, so nothing the browser sends can become a
 * command name, a flag name, a path or a shell string: `toAgentArgv` is a pure total function over
 * that closed set. The agent's own `CommandResult` is returned VERBATIM — a refusal is reported as
 * the runtime worded it, never reworded or softened by this layer.
 *
 * Writes are performed by the canonical agent, never by this file.
 */
function handleGovernedCommand(raw) {
  const correlationId =
    raw && typeof raw.correlationId === 'string' ? raw.correlationId.slice(0, 64) : 'unknown';
  const emit = (code, lines, verb) => {
    process.stdout.write(
      JSON.stringify({ kind: 'governed-result', correlationId, code, lines, verb: verb ?? null }) + '\n',
    );
  };

  const check = validateGovernedCommand(raw);
  if (!check.ok) {
    emit(2, [`REFUSED (${check.code}): ${check.detail}`], null);
    return;
  }
  const root = governedRoot();
  if (root === null) {
    emit(2, ['REFUSED (NO_RUNTIME): no governed project root is available.'], check.request.verb);
    return;
  }

  const invocation = toAgentInvocation(check.request);
  if (invocation === null) {
    // `refresh` performs nothing; it is served entirely by the existing read path.
    emitGovernedState();
    emit(0, ['Refreshed governed state.'], check.request.verb);
    return;
  }

  // Called as a TYPED function, never as an argv line. There is no parsing step between the
  // validated request and the runtime, so a value can never become a flag name.
  const COMMANDS = { phase: phaseCommand, approve: approveCommand, report: reportCommand };
  const fn = COMMANDS[invocation.command];
  if (fn === undefined) {
    emit(2, ['REFUSED (UNKNOWN_VERB): no canonical command for this verb.'], check.request.verb);
    return;
  }
  let result;
  try {
    const ctx = { sys: gitBoundSystem(agentSystem), root };
    result =
      invocation.command === 'report'
        ? fn(ctx, invocation.flags)
        : fn(ctx, invocation.flags, invocation.positionals);
  } catch (e) {
    emit(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be executed.'], check.request.verb);
    return;
  }
  emit(result.code, result.lines, check.request.verb);
  // Re-read durable state AFTER the command, so the surface shows what actually persisted rather
  // than what the command was expected to do.
  emitGovernedState();
}

/** The governed project root: the first watched root that carries an installed `.projectops`. */
function governedRoot() {
  for (const r of config.watchRoots) {
    if (typeof r === 'string' && existsSync(joinPath(r, '.projectops', 'project-config.json'))) {
      return resolvePath(r);
    }
  }
  return null;
}

/**
 * Emit the governed state on the SAME stdout channel the host already forwards, as an ordinary
 * `kind`-discriminated transport message. Reusing the existing protocol rather than inventing a
 * parallel one means the encode/parse pair, the client dispatch and the store all stay single-sourced.
 */
function emitGovernedState() {
  const state = buildGovernedState(governedRoot(), new Date().toISOString());
  process.stdout.write(JSON.stringify({ kind: 'governed', state }) + '\n');
}

// --- startup, in order; readiness is announced only after ALL of it ---------------------------
daemon.start();
transport.connect();

const interval = setInterval(() => daemon.tickAt(nodeSystem.monotonicMs()), config.watchIntervalMs);

let shuttingDown = false;
let readyEmitted = false;

/**
 * Idempotent cleanup. Guarded so readline-close, stdin-end, stdin-error, an explicit
 * lifecycle.shutdown and a signal cannot run it twice.
 */
function shutdown(code = EXIT_OK) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    clearInterval(interval);
    transport.disconnect();
    daemon.stop();
  } catch {
    /* bounded cleanup: never let a cleanup fault prevent exit */
  }
  process.exit(code);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (shuttingDown) return; // stop accepting commands
  try {
    const obj = JSON.parse(line);
    if (!obj || typeof obj !== 'object') return;
    // Governed commands are `kind`-discriminated and carry no `cmd`, so they are dispatched BEFORE
    // the legacy `cmd` guard — which would otherwise drop them silently.
    if (obj.kind === 'governed-command') {
      handleGovernedCommand(obj);
      return;
    }
    if (typeof obj.cmd !== 'string') return;
    if (obj.cmd === 'snapshot') {
      transport.requestSnapshot();
      // The owner surface's governed state is re-read on the same trigger, so one snapshot request
      // refreshes both views and they can never drift apart on screen.
      emitGovernedState();
    }
    else if (obj.cmd === 'lifecycle.shutdown') shutdown(EXIT_OK);
  } catch {
    /* ignore malformed command lines */
  }
});

// Parent death / channel loss. The Job Object is the real guarantee; these make exit graceful.
rl.on('close', () => shutdown(EXIT_OK));
process.stdin.on('end', () => shutdown(EXIT_OK));
process.stdin.on('error', () => shutdown(EXIT_OK));
process.on('SIGINT', () => shutdown(EXIT_OK));
process.on('SIGTERM', () => shutdown(EXIT_OK));

// Redact crash evidence: never print a raw stack or object that could carry paths/secrets.
process.on('uncaughtException', () => {
  process.stderr.write('projectos sidecar: uncaught exception [redacted]\n');
  shutdown(1);
});
process.on('unhandledRejection', () => {
  process.stderr.write('projectos sidecar: unhandled rejection [redacted]\n');
  shutdown(1);
});

/**
 * Final startup step: announce readiness exactly once, AFTER the command listeners exist — so
 * readiness truthfully implies the channel is live.
 */
if (!readyEmitted) {
  readyEmitted = true;
  process.stdout.write(
    JSON.stringify({
      type: 'lifecycle.ready',
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      daemonInstanceId,
      status: 'read-only',
    }) + '\n',
  );
  // First governed read AFTER readiness, so the surface never paints authority state from a process
  // that has not finished starting.
  emitGovernedState();
}

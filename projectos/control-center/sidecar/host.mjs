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
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { BridgeDaemon, nodeSystem, loadConfig } from '@projectos/bridge-daemon';
import { InProcessTransport } from '../node-build/daemon/inProcessTransport.js';

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
    if (!obj || typeof obj.cmd !== 'string') return;
    if (obj.cmd === 'snapshot') transport.requestSnapshot();
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
}

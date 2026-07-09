#!/usr/bin/env node
/**
 * ProjectOS daemon sidecar — the Node process the Tauri Rust host spawns.
 *
 * It runs a real BridgeDaemon (nodeSystem) and reuses the tested InProcessTransport to project
 * daemon state; every TransportMessage is written as one JSON line to stdout, which the Rust
 * host forwards to the webview over the `daemon://message` event channel. It reads snapshot
 * requests from stdin. Strictly read-only: it never commits/pushes/deploys/mutates.
 *
 * Run `npm run build:sidecar` first (emits node-build/) so the import below resolves.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { BridgeDaemon, nodeSystem, loadConfig } from '@projectos/bridge-daemon';
import { InProcessTransport } from '../node-build/daemon/inProcessTransport.js';

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

const config = resolveConfig();
// Keep stdout as a pure JSON-line protocol channel: route the daemon's own log lines to stderr.
const system = { ...nodeSystem, log: (line) => process.stderr.write(line + '\n') };
const daemon = new BridgeDaemon(system, config);
const transport = new InProcessTransport(daemon);

transport.onMessage((message) => {
  process.stdout.write(JSON.stringify(message) + '\n');
});

daemon.start();
transport.connect();

const interval = setInterval(() => daemon.tickAt(nodeSystem.monotonicMs()), config.watchIntervalMs);

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj && obj.cmd === 'snapshot') transport.requestSnapshot();
  } catch {
    /* ignore malformed command lines */
  }
});

function shutdown() {
  clearInterval(interval);
  transport.disconnect();
  daemon.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

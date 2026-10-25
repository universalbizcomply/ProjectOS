#!/usr/bin/env node
/**
 * projectos-bridge — process entry for the Bridge Daemon.
 *
 * Usage:
 *   projectos-bridge start [--root <dir> ...]   run the watch loop
 *   projectos-bridge health [--root <dir> ...]  print a one-shot health snapshot
 *
 * Config resolution: a `bridge.config.json` in the current directory (if present) supplies
 * watchRoots etc.; any --root flags are appended. This entry is intentionally thin — all
 * behaviour lives in the tested engine.
 */
import { readFileSync, existsSync } from 'node:fs';
import { BridgeDaemon, nodeSystem, loadConfig } from '../dist/index.js';

function parseArgs(argv) {
  const cmd = argv[2] ?? 'start';
  const roots = [];
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      roots.push(argv[i + 1]);
      i += 1;
    }
  }
  return { cmd, roots };
}

function resolveConfig(extraRoots) {
  const raw = existsSync('bridge.config.json') ? readFileSync('bridge.config.json', 'utf8') : null;
  const { config } = loadConfig(raw);
  return { ...config, watchRoots: [...config.watchRoots, ...extraRoots] };
}

function main() {
  const { cmd, roots } = parseArgs(process.argv);
  const config = resolveConfig(roots);
  const daemon = new BridgeDaemon(nodeSystem, config);

  if (cmd === 'health') {
    daemon.start();
    process.stdout.write(JSON.stringify(daemon.health(), null, 2) + '\n');
    daemon.stop();
    return;
  }

  if (cmd === 'start') {
    daemon.start();
    const interval = setInterval(() => daemon.tickAt(nodeSystem.monotonicMs()), config.watchIntervalMs);
    const shutdown = () => {
      clearInterval(interval);
      daemon.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(1);
}

main();

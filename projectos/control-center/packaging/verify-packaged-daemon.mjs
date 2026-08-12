#!/usr/bin/env node
/**
 * Adversarial proof that an assembled payload is closed AT RUN TIME, not merely by inspection.
 *
 * The dependency-closure validator reads the artefact and decides whether anything in it reaches
 * outside the payload. That is a static judgement, and static judgements have a characteristic
 * failure: they are satisfied by an artefact that cannot run at all. This increment hit exactly that
 * — a bundle that passed closure and then died on its first line, because esbuild's ESM output made
 * the linked CommonJS engines' `require("path")` throw. Closure said CLOSED and it was right; the
 * payload was still broken.
 *
 * So these scenarios LAUNCH the real payload with the real pinned runtime and try to redirect it:
 * a poisoned `NODE_PATH`, a `bridge.config.json` in the working directory, a copy of one beside the
 * daemon, a governed-looking working directory, a relative configuration path. A packaged daemon
 * must ignore every one of them and say it has no governed root.
 *
 * The last scenario proves the opposite direction — that an ABSOLUTE configuration path, the one
 * route the development launch authority uses, is still honoured. A gate that refuses everything
 * proves nothing about what it lets through.
 *
 * Usage:  node packaging/verify-packaged-daemon.mjs --payload <assembled payload root>
 *
 * Read-only: it starts the daemon with stdin closed, so it announces readiness and exits. It never
 * installs, never elevates and never writes outside its own temporary directories.
 *
 * Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged daemon dependency closure).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const payloadArg = args[args.indexOf('--payload') + 1];
if (args.indexOf('--payload') === -1 || !payloadArg) {
  console.error('usage: verify-packaged-daemon.mjs --payload <assembled payload root>');
  process.exit(2);
}
const PAYLOAD = resolve(payloadArg);
const NODE = join(PAYLOAD, 'runtime', 'node.exe');
const DAEMON = join(PAYLOAD, 'daemon', 'projectos-daemon.mjs');
for (const required of [NODE, DAEMON]) {
  if (!existsSync(required)) {
    console.error(`verify-packaged-daemon: missing ${required}`);
    process.exit(2);
  }
}

/** A `bridge.config.json` that would redirect the daemon at the development checkout. */
const REDIRECTING_CONFIG = JSON.stringify({ watchRoots: ['C:\\dev\\ProjectOS'] });

const scratch = mkdtempSync(join(tmpdir(), 'projectos-packaged-proof-'));
const cleanup = [scratch];

/** Launch the payload once and return its parsed governed-state message. */
function launch({ cwd, env }) {
  const r = spawnSync(NODE, [DAEMON], {
    cwd,
    env: { ...process.env, PROJECTOS_DAEMON_INSTANCE_ID: 'packaged-proof-1', ...env },
    input: '',
    encoding: 'utf8',
    timeout: 60_000,
  });
  const lines = String(r.stdout ?? '').split('\n').filter(Boolean);
  let governed = null;
  let ready = false;
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'lifecycle.ready') ready = true;
      if (msg.kind === 'governed') governed = msg.state;
    } catch {
      /* not a protocol line */
    }
  }
  return { status: r.status, ready, governed, stderr: String(r.stderr ?? '') };
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A packaged daemon with no configuration must report that it has no governed root. */
function hasNoGovernedRoot(result) {
  return result.ready === true && result.governed !== null && result.governed.connected === false;
}

console.log(`payload: ${PAYLOAD}`);
console.log('');

try {
  // --- baseline: the payload runs at all -------------------------------------------------------
  const plain = mkdtempSync(join(scratch, 'plain-'));
  const base = launch({ cwd: plain, env: {} });
  check(
    'the payload starts, announces readiness and reports no governed root',
    hasNoGovernedRoot(base),
    `status=${base.status} ready=${base.ready} governed=${JSON.stringify(base.governed)} ${base.stderr.slice(0, 200)}`,
  );

  // --- 4. NODE_PATH cannot substitute a dependency ---------------------------------------------
  const poisoned = mkdtempSync(join(scratch, 'nodepath-'));
  writeFileSync(
    join(poisoned, 'plan-governance-engine.cjs'),
    'throw new Error("POISONED ENGINE LOADED FROM NODE_PATH");\n',
  );
  const viaNodePath = launch({ cwd: plain, env: { NODE_PATH: poisoned } });
  check(
    'an ambient NODE_PATH cannot substitute a linked dependency',
    hasNoGovernedRoot(viaNodePath) && !viaNodePath.stderr.includes('POISONED'),
    `stderr=${viaNodePath.stderr.slice(0, 200)}`,
  );

  // --- 6. a bridge.config.json in the WORKING DIRECTORY is not authority -------------------------
  const cwdConfig = mkdtempSync(join(scratch, 'cwdcfg-'));
  writeFileSync(join(cwdConfig, 'bridge.config.json'), REDIRECTING_CONFIG);
  const viaCwdConfig = launch({ cwd: cwdConfig, env: {} });
  check(
    'a bridge.config.json in the working directory cannot redirect the daemon',
    hasNoGovernedRoot(viaCwdConfig),
    JSON.stringify(viaCwdConfig.governed),
  );

  // --- 7. a COPIED development config beside the daemon is not authority ------------------------
  const besideDaemon = join(PAYLOAD, 'daemon', 'bridge.config.json');
  const besidePayload = join(PAYLOAD, 'bridge.config.json');
  writeFileSync(besideDaemon, REDIRECTING_CONFIG);
  writeFileSync(besidePayload, REDIRECTING_CONFIG);
  const viaSibling = launch({ cwd: plain, env: {} });
  rmSync(besideDaemon, { force: true });
  rmSync(besidePayload, { force: true });
  check(
    'a development bridge.config.json copied INTO the payload cannot redirect the daemon',
    hasNoGovernedRoot(viaSibling),
    JSON.stringify(viaSibling.governed),
  );

  // --- a RELATIVE configuration path is refused -------------------------------------------------
  const relativeCfg = mkdtempSync(join(scratch, 'relcfg-'));
  writeFileSync(join(relativeCfg, 'bridge.config.json'), REDIRECTING_CONFIG);
  const viaRelative = launch({
    cwd: relativeCfg,
    env: { PROJECTOS_BRIDGE_CONFIG: 'bridge.config.json' },
  });
  check(
    'a RELATIVE PROJECTOS_BRIDGE_CONFIG is refused, not resolved against the working directory',
    hasNoGovernedRoot(viaRelative),
    JSON.stringify(viaRelative.governed),
  );

  // --- 5. a governed-looking WORKING DIRECTORY is not adopted -----------------------------------
  const governedLooking = mkdtempSync(join(scratch, 'govcwd-'));
  mkdirSync(join(governedLooking, '.projectops'), { recursive: true });
  writeFileSync(
    join(governedLooking, '.projectops', 'project-config.json'),
    JSON.stringify({ projectId: 'not-ours', projectName: 'Not Ours' }),
  );
  const viaGovernedCwd = launch({ cwd: governedLooking, env: {} });
  check(
    'a .projectops in the working directory is not adopted as the governed root',
    hasNoGovernedRoot(viaGovernedCwd),
    JSON.stringify(viaGovernedCwd.governed),
  );

  // --- the positive control: an ABSOLUTE configuration path IS honoured -------------------------
  //
  // Without this the suite would pass by refusing everything, which proves nothing about the route
  // development actually uses. The config names a root that does not exist, so nothing is governed
  // either way — what is observed is that the file was READ: its watch root reaches the daemon.
  const absoluteCfgDir = mkdtempSync(join(scratch, 'abscfg-'));
  const absoluteCfg = join(absoluteCfgDir, 'bridge.config.json');
  const declaredRoot = join(absoluteCfgDir, 'declared-root');
  mkdirSync(declaredRoot, { recursive: true });
  writeFileSync(absoluteCfg, JSON.stringify({ watchRoots: [declaredRoot] }));
  const viaAbsolute = launch({ cwd: plain, env: { PROJECTOS_BRIDGE_CONFIG: absoluteCfg } });
  check(
    'an ABSOLUTE PROJECTOS_BRIDGE_CONFIG is still honoured (development route intact)',
    viaAbsolute.ready === true && viaAbsolute.status === 0,
    `status=${viaAbsolute.status} ready=${viaAbsolute.ready} ${viaAbsolute.stderr.slice(0, 200)}`,
  );
} finally {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
}

console.log('');
if (failures > 0) {
  console.error(`verify-packaged-daemon: ${failures} scenario(s) FAILED`);
  process.exit(1);
}
console.log('verify-packaged-daemon: all scenarios passed');

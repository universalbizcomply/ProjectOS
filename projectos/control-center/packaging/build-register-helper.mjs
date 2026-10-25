#!/usr/bin/env node
/**
 * Build the bounded elevated registration helper and stage it for bundling.
 *
 * PROJECTOS-PRODUCT-COMPLETION1A §11. The Control Centre raises a real Windows UAC prompt and runs
 * this helper to register a project; without it in the installation, the in-app Add-a-project route
 * reports that registration cannot run here (which is the correct answer, not a crash).
 *
 * WHY IT IS NOT PART OF THE RUNTIME PAYLOAD. `dist-payload` is the DAEMON runtime — the pinned Node
 * executable and the single daemon bundle — and its trust manifest attests to exactly those. This
 * helper is an administration tool, not something the daemon runs, so adding it there would widen
 * what that manifest means rather than describe it. It is staged separately and travels inside the
 * MSI, covered by whatever signature the installer itself carries.
 *
 * WHY `--features registry-publish-effect`. That feature IS the packaging boundary for the
 * registration capability: without it Cargo does not build this binary at all. Naming it here, in
 * one place, is what makes "the shipped installation can register a project" a deliberate build
 * decision rather than an accident of the default feature set.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_CENTER = resolve(HERE, '..');
const PROJECTOS_ROOT = resolve(CONTROL_CENTER, '..');
const CRATE = join(PROJECTOS_ROOT, 'host', 'elevated-installer-composition');

const BIN_NAME = 'projectos-register-project-elevated';
const OUT_DIR = join(CONTROL_CENTER, 'dist-helpers');
const OUT_FILE = join(OUT_DIR, `${BIN_NAME}.exe`);

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`build-register-helper: ${command} failed with status ${String(result.status)}`);
    process.exit(1);
  }
}

run(
  'cargo',
  [
    'build',
    '--release',
    '--manifest-path',
    join(CRATE, 'Cargo.toml'),
    '--features',
    'registry-publish-effect',
    '--bin',
    BIN_NAME,
  ],
  PROJECTOS_ROOT,
);

// This crate is NOT part of a shared cargo workspace, so its artefacts land in its own `target/`
// rather than a workspace-level one. Both are checked so the script keeps working if the crate is
// ever folded into a workspace, and it FAILS rather than silently staging a stale or wrong file.
const candidates = [
  join(CRATE, 'target', 'release', `${BIN_NAME}.exe`),
  join(PROJECTOS_ROOT, 'target', 'release', `${BIN_NAME}.exe`),
];
const built = candidates.find((candidate) => existsSync(candidate));
if (built === undefined) {
  console.error('build-register-helper: cargo reported success but no built binary was found at:');
  for (const candidate of candidates) console.error(`  ${candidate}`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(built, OUT_FILE);
console.log(`registration helper staged: ${OUT_FILE}`);

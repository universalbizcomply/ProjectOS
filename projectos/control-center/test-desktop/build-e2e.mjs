#!/usr/bin/env node
/**
 * Build the webdriver-e2e ProjectOS Control Centre into its OWN target directory.
 *
 * Two things this exists to guarantee, neither of which a plain npm script can do here:
 *
 * 1. THE E2E ARTIFACT IS NOT THE RELEASE ARTIFACT. The WebDriver-enabled executable must never sit
 *    at `target/release/projectos-control-center.exe`, where it could be mistaken for — or picked
 *    up in place of — the ordinary release build. `CARGO_TARGET_DIR` is set to an absolute path so
 *    the separation cannot depend on which directory the tool happens to run from.
 *
 * 2. THE FRONTEND IS REALLY BUNDLED. This goes through the Tauri CLI, not bare `cargo build`.
 *    Tauri's dev-vs-production decision is NOT the cargo profile: a `cargo build --release` binary
 *    still loads `devUrl`, so it serves the frontend from a Vite dev server if one happens to be
 *    running. A desktop proof against a dev server is not a proof of the shipped application, and
 *    it silently depends on an unrelated process being up. `tauri build` embeds `frontendDist`.
 *
 * npm runs scripts through cmd.exe on Windows, where `VAR=value cmd` is not valid syntax — hence a
 * wrapper rather than an inline environment variable.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const controlCentre = resolve(here, '..');
const targetDir = join(controlCentre, 'src-tauri', 'target', 'webdriver-e2e');

console.log(`[build-e2e] CARGO_TARGET_DIR=${targetDir}`);

// `shell: true` is required here: without it the spawn of the npx shim on Windows returned success
// while running nothing at all, which is worse than failing — it left a stale binary in place and
// the desktop proof silently ran against it.
// `--debug` is REQUIRED, and not for convenience. The app classifies a release build as a packaged
// candidate and then refuses to launch its development sidecar at all
// (`ProductionIdentityUnavailable`, with no fallback resolver) — a deliberate custody property, not
// an obstacle to route around. A release E2E binary therefore reports "no ProjectOS runtime has
// reported yet" forever, and the governed chain the proof exists to exercise is unreachable.
//
// `tauri build --debug` gives Development mode while STILL embedding `frontendDist`, so the proof
// keeps the bundled frontend and only the optimisation level differs from a release build. The
// webdriver-e2e feature gate is unchanged, and the ordinary release binary remains free of the
// WebDriver server.
const result = spawnSync('npx tauri build --debug --no-bundle --features webdriver-e2e', {
  cwd: controlCentre,
  env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error(`[build-e2e] build FAILED with status ${result.status}`);
}
process.exit(result.status ?? 1);

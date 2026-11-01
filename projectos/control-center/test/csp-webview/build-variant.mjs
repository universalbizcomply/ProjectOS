#!/usr/bin/env node
/**
 * Build one variant of the webview proof into a DEBUG executable — PROJECTOS-TENANT-CSP1A.
 *
 *   node test/csp-webview/build-variant.mjs <variant>
 *
 * Debug only, with `--no-bundle`: no MSI, no release build, no install. `tauri build --debug` still embeds
 * `frontendDist` and serves it through the `tauri` protocol, so this is the path that carries the CSP
 * header. `tauri dev` on the desktop loads Vite directly and carries none.
 *
 * The packaging steps do not run: `beforeBuildCommand` and the `resources` map are merged away, because
 * neither a payload nor a helper has any bearing on the policy and a debug build launches its development
 * sidecar. Only the variant's own merge reaches the build.
 *
 * Supabase settings come from an env file named by CSP_PROOF_ENV_FILE and go to Vite through the process
 * environment. Nothing here prints them or writes them to a file of its own.
 *
 * It refuses to start under 12 GB free on the target drive.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { CONTROL_CENTER, PROOF_BROWSER_ARGS, committedConf, policySupabaseHost, variants } from './variants.mjs';

export const MIN_FREE_GB = 12;
const TARGET_ROOT = process.env.CSP_PROOF_TARGET_ROOT ?? join(CONTROL_CENTER, 'src-tauri', 'target');

function freeGb(path) {
  const stats = statfsSync(parse(path).root);
  return (stats.bavail * stats.bsize) / 1024 ** 3;
}

/** The two VITE_ settings, read from the env file. Never logged, and refused if they name another host. */
function supabaseEnv() {
  const file = process.env.CSP_PROOF_ENV_FILE;
  if (!file || !existsSync(file)) throw new Error('CSP_PROOF_ENV_FILE does not name an env file');
  const found = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/.exec(line.trim());
    if (match) found[match[1]] = match[2].trim();
  }
  if (!found.VITE_SUPABASE_URL || !found.VITE_SUPABASE_ANON_KEY) throw new Error('the env file lacks the two VITE_ settings');
  if (new URL(found.VITE_SUPABASE_URL).host !== policySupabaseHost()) {
    throw new Error('the env file names a Supabase host the committed policy does not');
  }
  return found;
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: CONTROL_CENTER, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${args.slice(0, 2).join(' ')} failed with status ${result.status}`);
}

export function buildVariant(name) {
  const variant = variants()[name];
  if (variant === undefined) throw new Error(`unknown variant: ${name}`);
  const free = freeGb(CONTROL_CENTER);
  if (free < MIN_FREE_GB) throw new Error(`only ${free.toFixed(1)} GB free; this proof stops under ${MIN_FREE_GB} GB`);

  const scratch = join(TARGET_ROOT, 'csp1a-config');
  mkdirSync(scratch, { recursive: true });
  const merge = {
    build: { beforeBuildCommand: null },
    bundle: { resources: null },
    app: {
      windows: [{ ...committedConf().app.windows[0], additionalBrowserArgs: PROOF_BROWSER_ARGS }],
      security: { csp: variant.csp, ...(variant.extra?.app?.security ?? {}) },
    },
  };
  const configPath = join(scratch, `${name}.json`);
  writeFileSync(configPath, `${JSON.stringify(merge, null, 2)}\n`);

  const base = { ...process.env };
  delete base.VITE_SUPABASE_URL;
  delete base.VITE_SUPABASE_ANON_KEY;
  const viteEnv = variant.profile === 'login' ? { ...base, ...supabaseEnv() } : base;
  run(process.execPath, [
    join(CONTROL_CENTER, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
    '--config', join(CONTROL_CENTER, 'test', 'csp-webview', 'vite.proof.config.ts'),
    '--logLevel', 'warn',
  ], viteEnv);

  const cargoEnv = {
    ...base,
    CARGO_TARGET_DIR: join(TARGET_ROOT, 'csp1a'),
    CARGO_HOME: join(TARGET_ROOT, 'csp1a-cargo-home'),
  };
  run(process.execPath, [
    join(CONTROL_CENTER, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    'build', '--debug', '--no-bundle', '--config', configPath,
  ], cargoEnv);
  return resolve(TARGET_ROOT, 'csp1a', 'debug', 'projectos-control-center.exe');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('build-variant.mjs')) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: build-variant.mjs <variant>');
    process.exit(2);
  }
  console.log(`[csp-proof] built ${buildVariant(name)}`);
}

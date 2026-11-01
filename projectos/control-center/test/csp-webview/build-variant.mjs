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
 * THE FRONTEND IS THE REAL PRODUCTION BUILD: `npm run build`, the app's own vite.config.ts, no extra config
 * and no shim. A build that needs one fails here, and val-projectos-tenant-csp1a fails by name. The packaging
 * steps after it do not run: `beforeBuildCommand` and the `resources` map are merged away, because neither
 * a payload nor a helper has any bearing on the policy and a debug build launches its development sidecar.
 *
 * A variant with `sourceEdit` changes a tracked file so a control can fail, so it refuses to run unless
 * CSP_PROOF_DISPOSABLE=1 says this is a throwaway clone. The edit is reverted afterwards with git.
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

const REPO_ROOT = resolve(CONTROL_CENTER, '..', '..');
const CORE = resolve(CONTROL_CENTER, '..', 'core');

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

/** Through the shell, because npm is a .cmd on Windows. */
function npm(script, cwd, env) {
  const result = spawnSync(`npm run ${script}`, { cwd, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`npm run ${script} failed with status ${result.status}`);
}

/** The control's one change to a tracked file, in a throwaway clone only. */
function applySourceEdit(edit) {
  if (process.env.CSP_PROOF_DISPOSABLE !== '1') throw new Error('this variant edits tracked source: it runs only in a throwaway clone, with CSP_PROOF_DISPOSABLE=1');
  const path = join(REPO_ROOT, edit.file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(edit.from)) throw new Error(`the control's edit no longer applies to ${edit.file}`);
  writeFileSync(path, text.replace(edit.from, edit.to));
}

function revertSourceEdit(edit) {
  const result = spawnSync('git', ['checkout', '--', edit.file], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`could not revert ${edit.file}`);
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
  if (variant.sourceEdit !== undefined) {
    applySourceEdit(variant.sourceEdit);
    npm('build', CORE, base);
  }
  try {
    npm('build', CONTROL_CENTER, viteEnv);
  } finally {
    if (variant.sourceEdit !== undefined) {
      revertSourceEdit(variant.sourceEdit);
      npm('build', CORE, base);
    }
  }

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

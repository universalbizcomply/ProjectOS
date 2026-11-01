#!/usr/bin/env node
/**
 * The record that the production build stands on its own — PROJECTOS-TENANT-CSP1A.
 *
 *   CSP_PROOF_DISPOSABLE=1 node test/csp-webview/record-build.mjs <out.json>
 *
 * Runs in a fresh clone, from a state with no `dist`:
 *
 *   1. validate-desktop-e2e with no bundle, which must fail at check 5
 *   2. `npm run build` with the node:buffer alias removed, which must fail, naming isUtf8
 *   3. `npm run build` as committed, which must pass with no extra config
 *   4. validate-desktop-e2e against that real bundle
 *
 * Step 2 edits vite.config.ts, so it refuses to run outside a throwaway clone.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { CONTROL_CENTER } from './variants.mjs';

const REPO_ROOT = resolve(CONTROL_CENTER, '..', '..');
const VITE_CONFIG = join(CONTROL_CENTER, 'vite.config.ts');
const ALIAS_LINE = /^\s*'node:buffer':.*\r?\n/m;
const require = createRequire(import.meta.url);

function desktopE2e() {
  delete require.cache[require.resolve(join(REPO_ROOT, 'projectos', 'validators', 'validate-desktop-e2e.cjs'))];
  return require(join(REPO_ROOT, 'projectos', 'validators', 'validate-desktop-e2e.cjs')).run();
}

function npmBuild() {
  const result = spawnSync('npm run build', { cwd: CONTROL_CENTER, encoding: 'utf8', shell: true, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const NODE_GLOBAL_CALL = /\b(?:Buffer\.(?:from|alloc|concat|compare)|process\.(?:env|platform|argv|cwd)|setImmediate)\b/g;

/** Every Node-global reference left in the bundle, by name. `typeof` guards are allowed; bare use is listed. */
function scanBundle() {
  const assets = join(CONTROL_CENTER, 'dist', 'assets');
  const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const text = chunks.map((name) => readFileSync(join(assets, name), 'utf8')).join('\n');
  const hits = {};
  for (const match of text.matchAll(NODE_GLOBAL_CALL)) hits[match[0]] = (hits[match[0]] ?? 0) + 1;
  return {
    chunks: chunks.length,
    bytes: text.length,
    nodeGlobalUses: hits,
    runIdInBundle: text.includes('0x50, 0x4f, 0x53, 0x48') || /80,\s*79,\s*83,\s*72,\s*83,\s*84,\s*65,\s*84/.test(text),
    wireMagicInBundle: text.includes('"POS1"') || text.includes("'POS1'"),
  };
}

const out = process.argv[2];
if (!out) {
  console.error('usage: record-build.mjs <out.json>');
  process.exit(2);
}
if (process.env.CSP_PROOF_DISPOSABLE !== '1') {
  console.error('this edits vite.config.ts: it runs only in a throwaway clone, with CSP_PROOF_DISPOSABLE=1');
  process.exit(2);
}
rmSync(join(CONTROL_CENTER, 'dist'), { recursive: true, force: true });

const withoutBundle = desktopE2e();

const config = readFileSync(VITE_CONFIG, 'utf8');
if (!ALIAS_LINE.test(config)) throw new Error('the node:buffer alias line was not found');
writeFileSync(VITE_CONFIG, config.replace(ALIAS_LINE, ''));
const noAlias = npmBuild();
writeFileSync(VITE_CONFIG, config);
rmSync(join(CONTROL_CENTER, 'dist'), { recursive: true, force: true });

const real = npmBuild();
const withBundle = real.status === 0 ? desktopE2e() : ['no bundle'];

const record = {
  checkout: 'fresh git clone with its own npm ci',
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim(),
  script: 'npm run build',
  extraConfig: existsSync(join(CONTROL_CENTER, 'test', 'csp-webview', 'vite.proof.config.ts')),
  status: real.status,
  bundle: real.status === 0 ? scanBundle() : null,
  noBufferAlias: { status: noAlias.status, namesIsUtf8: noAlias.output.includes('isUtf8') },
  desktopE2e: {
    withoutBundle: withoutBundle.map((line) => String(line).slice(0, 120)),
    withRealBundle: withBundle.map((line) => String(line).slice(0, 120)),
  },
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 1));
process.exit(real.status === 0 && noAlias.status !== 0 && withoutBundle.length > 0 && withBundle.length === 0 ? 0 : 1);

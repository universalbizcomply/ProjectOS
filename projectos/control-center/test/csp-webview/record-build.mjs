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
 *   4. the review's case: `core/dist` made stale with a load-time Buffer, source clean. `npm run build` must
 *      rebuild it and come out clean
 *   5. the same stale `dist` with the renderer built alone: the scan must refuse the chunks
 *   6. a load-time Buffer in the source: `npm run build` must fail, naming it
 *   7. `npm run build` again, and validate-desktop-e2e against that real bundle
 *
 * Steps 2, 4, 5 and 6 edit files, so it refuses to run outside a throwaway clone.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { CONTROL_CENTER } from './variants.mjs';

const require = createRequire(import.meta.url);
const { scanDirectory } = require('./scan-bundle.cjs');

const REPO_ROOT = resolve(CONTROL_CENTER, '..', '..');
const VITE_CONFIG = join(CONTROL_CENTER, 'vite.config.ts');
const ALIAS_LINE = /^\s*'node:buffer':.*\r?\n/m;
const CORE = resolve(CONTROL_CENTER, '..', 'core');
const CORE_DIST_WIRE = join(CORE, 'dist', 'hostReviewWire.js');
const CORE_SRC_WIRE = join(CORE, 'src', 'hostReviewWire.ts');
const EAGER = "\nexport const STALE_PROBE = Buffer.from('POS1', 'ascii');\n";

function desktopE2e() {
  delete require.cache[require.resolve(join(REPO_ROOT, 'projectos', 'validators', 'validate-desktop-e2e.cjs'))];
  return require(join(REPO_ROOT, 'projectos', 'validators', 'validate-desktop-e2e.cjs')).run();
}

function npmRun(script) {
  const result = spawnSync(`npm run ${script}`, { cwd: CONTROL_CENTER, encoding: 'utf8', shell: true, env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const npmBuild = () => npmRun('build');

function scanOnly() {
  const result = spawnSync(process.execPath, [join(CONTROL_CENTER, 'test', 'csp-webview', 'scan-bundle.cjs')], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** `core/dist` left behind by an older checkout: the file the renderer really bundles. */
function makeCoreDistStale() {
  writeFileSync(CORE_DIST_WIRE, `${readFileSync(CORE_DIST_WIRE, 'utf8')}${EAGER}`);
}

/** What is left in the bundle, and whether the wire constants went with the tree-shaking. */
function scanBundle() {
  const assets = join(CONTROL_CENTER, 'dist', 'assets');
  const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const text = chunks.map((name) => readFileSync(join(assets, name), 'utf8')).join('\n');
  const { guarded, bare } = scanDirectory(assets);
  return {
    chunks: chunks.length,
    bytes: text.length,
    guardedNodeGlobalUses: guarded,
    bareNodeGlobalUses: bare,
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

// The review's case. Clean source, stale dist: the build must rebuild it.
makeCoreDistStale();
const staleRebuilt = npmBuild();
const staleScan = staleRebuilt.status === 0 ? scanDirectory(join(CONTROL_CENTER, 'dist', 'assets')) : null;

// The same stale dist with no rebuild: only the scan stands between it and a blank window.
makeCoreDistStale();
const rendererAlone = npmRun('build:renderer');
const scanCaught = scanOnly();
rmSync(join(CONTROL_CENTER, 'dist'), { recursive: true, force: true });

// A load-time Buffer in the source itself: the build fails rather than ship it.
const source = readFileSync(CORE_SRC_WIRE, 'utf8');
writeFileSync(CORE_SRC_WIRE, `${source}${EAGER}`);
const eagerSource = npmBuild();
writeFileSync(CORE_SRC_WIRE, source);

const final = npmBuild();
const withBundle = final.status === 0 ? desktopE2e() : ['no bundle'];

const record = {
  checkout: 'fresh git clone with its own npm ci',
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim(),
  script: 'npm run build',
  extraConfig: existsSync(join(CONTROL_CENTER, 'test', 'csp-webview', 'vite.proof.config.ts')),
  status: real.status === 0 ? final.status : real.status,
  bundle: final.status === 0 ? scanBundle() : null,
  noBufferAlias: { status: noAlias.status, namesIsUtf8: noAlias.output.includes('isUtf8') },
  staleCoreDist: { status: staleRebuilt.status, bareAfterRebuild: staleScan?.bare ?? null },
  scanAloneOnStaleChunks: { rendererBuildStatus: rendererAlone.status, status: scanCaught.status, namesBuffer: scanCaught.output.includes('Buffer.from') },
  eagerSource: { status: eagerSource.status, namesBuffer: eagerSource.output.includes('Buffer.from') },
  desktopE2e: {
    withoutBundle: withoutBundle.map((line) => String(line).slice(0, 120)),
    withRealBundle: withBundle.map((line) => String(line).slice(0, 120)),
  },
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 1));
const proved = real.status === 0 && final.status === 0 && noAlias.status !== 0 && staleRebuilt.status === 0 && scanCaught.status !== 0 &&
  eagerSource.status !== 0 && withoutBundle.length > 0 && withBundle.length === 0;
process.exit(proved ? 0 : 1);

#!/usr/bin/env node
/**
 * validate-fixture-isolation — static guard proving the Mission Control desktop fixture cannot
 * contaminate the production application.
 *
 * Checks:
 *   1. No production `src/**` file imports anything from `test-desktop/`.
 *   2. The production Vite bundle (`dist/`), if present, contains NONE of the fixture's synthetic
 *      identifiers or markers.
 *   3. The production Tauri config identifier is unchanged and distinct from the fixture's.
 *
 * Exit 0 = isolated; non-zero = contamination (hard stop). Opt-in; not part of `npm run build`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const failures = [];

const FIXTURE_TOKENS = [
  'ISOLATED DESKTOP FIXTURE',
  'NO PRODUCTION CONNECTION',
  'acme-demo-shop',
  'fixture-claude',
  'FIXTURE-DEMO-PHASE1A',
  'FixtureTransport',
  'SYNTHETIC DATA',
  '__NET_CALLS__',
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// 1. No src import references test-desktop.
for (const f of walk(SRC)) {
  if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
  const txt = fs.readFileSync(f, 'utf8');
  if (/test-desktop/.test(txt)) {
    failures.push(`src imports fixture: ${path.relative(ROOT, f)}`);
  }
}

// 2. Production bundle carries no fixture token.
if (fs.existsSync(DIST)) {
  for (const f of walk(DIST)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    for (const tok of FIXTURE_TOKENS) {
      if (txt.includes(tok)) failures.push(`dist bundle contains fixture token "${tok}" in ${path.relative(ROOT, f)}`);
    }
  }
} else {
  console.log('note: dist/ not present — run `npm run build` first to scan the production bundle.');
}

// 3. Production identifier distinct from fixture identifier.
try {
  const prodConf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  if (prodConf.identifier === 'com.projectos.control-center.fixture') {
    failures.push('production tauri identifier collides with the fixture identifier');
  }
} catch (e) {
  failures.push(`could not read production tauri.conf.json: ${e.message}`);
}

if (failures.length) {
  console.error('validate-fixture-isolation: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('validate-fixture-isolation: PASS');

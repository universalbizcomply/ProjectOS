#!/usr/bin/env node
'use strict';
/**
 * THE BUNDLE IS JUDGED, NOT THE SOURCE — PROJECTOS-TENANT-CSP1A.
 *
 *   node test/csp-webview/scan-bundle.cjs [assets-dir]
 *
 * The last step of `npm run build`, and read by val-projectos-tenant-csp1a. The renderer bundles core from
 * `dist`, so clean source proves nothing about what shipped: a stale `core/dist` with a load-time `Buffer`
 * gave a passing build and a blank window. This reads the chunks themselves and fails on any Node global
 * used with no `typeof` guard beside it.
 *
 * It is stricter than "load time": a bare use inside a function fails too, because it would throw when
 * called, and telling the two apart in minified code is guesswork. What it cannot see is a global reached
 * some other way, such as `globalThis['Buf' + 'fer']`. The real webview run covers that.
 */
const fs = require('fs');
const path = require('path');

const USE = /\b(?:Buffer|process)\.\w+|\bglobal\.\w+|\b__dirname\b|\b__filename\b|\brequire(?=\()|\bsetImmediate(?=\s*[(:])/g;
/** How far back a `typeof` still guards a use. Minified, the two sit side by side. */
const GUARD_REACH = 70;
/** Part of something else: `a.process`, or the opening of a string. */
const NOT_THE_GLOBAL = new Set(['.', '$', '"', "'", '`']);

function rootOf(use) {
  return use.split('.')[0];
}

/** Every use in these chunks, split into guarded and bare. */
function scanChunks(chunks) {
  const guarded = {};
  const bare = {};
  for (const text of chunks) {
    for (const match of text.matchAll(USE)) {
      if (NOT_THE_GLOBAL.has(text[match.index - 1])) continue;
      if (text.slice(match.index - 7, match.index) === 'typeof ') continue;
      const before = text.slice(Math.max(0, match.index - GUARD_REACH), match.index);
      const tally = before.includes(`typeof ${rootOf(match[0])}`) ? guarded : bare;
      tally[match[0]] = (tally[match[0]] ?? 0) + 1;
    }
  }
  return { guarded, bare };
}

/** The chunks in a directory. No chunk at all is an error: nothing was scanned, so nothing passed. */
function readChunks(dir) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.js')) : [];
  if (names.length === 0) throw new Error(`no bundle at ${dir}`);
  return names.map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
}

function scanDirectory(dir) {
  const chunks = readChunks(dir);
  return { chunks: chunks.length, bytes: chunks.reduce((sum, text) => sum + text.length, 0), ...scanChunks(chunks) };
}

if (require.main === module) {
  const dir = process.argv[2] ?? path.resolve(__dirname, '..', '..', 'dist', 'assets');
  try {
    const { bare, chunks } = scanDirectory(dir);
    const names = Object.keys(bare);
    if (names.length > 0) {
      console.error(`scan-bundle: the renderer bundle needs Node, which a webview does not have: ${names.map((name) => `${name} x${bare[name]}`).join(', ')}`);
      console.error('scan-bundle: this blanks the app. If the source looks clean, core/dist is stale: rebuild it.');
      process.exit(1);
    }
    console.log(`scan-bundle: ${chunks} chunks, no bare Node global`);
  } catch (error) {
    console.error(`scan-bundle: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { scanChunks, scanDirectory, readChunks };

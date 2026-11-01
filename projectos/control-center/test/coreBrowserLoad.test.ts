import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * NOTHING IN CORE MAY NEED A NODE GLOBAL WHILE IT LOADS.
 *
 * The renderer bundle tree-shakes, so a clean renderer build only clears what it kept. This goes further:
 * every core module the barrel reaches, with tree-shaking OFF, evaluated in a bare context holding only
 * what a webview has. `Buffer`, `process`, `global`, `__dirname` and `setImmediate` are simply not there,
 * so any top-level use of one throws here exactly as it blanked the app.
 *
 * It reads core's SOURCE by path, because `node_modules/@projectos/core` can be a link to another checkout.
 */
const here = dirname(fileURLToPath(import.meta.url));
const CORE_ENTRY = resolve(here, '..', '..', 'core', 'src', 'index.ts');
const SHIMS = join(here, '..', 'src', 'shims');

const bundleOf = async (entry: string): Promise<string> => {
  const result = await build({
    stdin: { contents: entry, resolveDir: dirname(CORE_ENTRY), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    treeShaking: false,
    logLevel: 'silent',
    alias: {
      'node:crypto': join(SHIMS, 'nodeCryptoStub.ts'),
      'node:buffer': join(SHIMS, 'nodeBufferStub.ts'),
    },
  });
  return result.outputFiles[0]?.text ?? '';
};

/** What the page offers. Anything Node-only is absent by construction, not by being stubbed. */
const webviewGlobals = () => ({ TextEncoder, TextDecoder, URL, URLSearchParams, crypto: globalThis.crypto, console, setTimeout, clearTimeout });

describe('every core module loads with no Node global', () => {
  it('the whole barrel evaluates, with tree-shaking off', async () => {
    const code = await bundleOf(`export * from './index.ts';`);
    expect(code.length).toBeGreaterThan(100_000);
    expect(() => runInNewContext(code, webviewGlobals())).not.toThrow();
  }, 60_000);

  it.each([
    ['Buffer', `globalThis.__x = Buffer.from('POS1', 'ascii');`],
    ['process', `globalThis.__x = process.platform;`],
    ['global', `globalThis.__x = global.Object;`],
    ['__dirname', `globalThis.__x = __dirname;`],
    ['setImmediate', `globalThis.__x = setImmediate(() => {});`],
  ])('the positive control: one top-level %s beside the barrel fails, so the pass above means something', async (name, line) => {
    const code = await bundleOf(`export * from './index.ts';\n${line}`);
    expect(() => runInNewContext(code, webviewGlobals())).toThrow(`${name} is not defined`);
  }, 60_000);

  it('a guarded typeof is fine: the same line that blanked the app, behind the check, loads', async () => {
    const code = await bundleOf(`export * from './index.ts';\nglobalThis.__x = typeof Buffer === 'undefined' ? null : Buffer.from('x');`);
    expect(() => runInNewContext(code, webviewGlobals())).not.toThrow();
  }, 60_000);
});

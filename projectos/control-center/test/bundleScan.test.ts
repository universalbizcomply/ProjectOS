import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .cjs shared with the validator and the build; it has no types and needs none.
import { scanChunks, scanDirectory } from './csp-webview/scan-bundle.cjs';

/**
 * THE BUNDLE IS JUDGED, NOT THE SOURCE. The renderer bundles core from `dist`, so a stale `dist` with a
 * load-time `Buffer` reproduces the blank window from clean source, and the build still passes.
 */
describe('a built chunk that needs a Node global is refused, whatever the source says', () => {
  it.each([
    ['Buffer.from', 'const a=Buffer.from("POS1","ascii");'],
    ['Buffer.alloc', 'export const b=Buffer.alloc(4);'],
    ['process.env', 'const c=process.env.X;'],
    ['process.platform', 'var d=process.platform;'],
    ['global.Object', 'const e=global.Object;'],
    ['__dirname', 'const f=__dirname;'],
    ['setImmediate', 'setImmediate(()=>{});'],
    ['require', 'const g=require("fs");'],
  ])('a bare %s is refused, by name', (name, chunk) => {
    expect(Object.keys(scanChunks([chunk]).bare)).toEqual([name]);
  });

  it('the stale core chunk that blanked the app is refused', () => {
    const stale = 'e:{status:"gated"}};Buffer.from("POS1","ascii");Buffer.from([80,79,83,72]);';
    expect(scanChunks([stale]).bare).toEqual({ 'Buffer.from': 2 });
  });

  it.each([
    ['supabase-js choosing an encoder', 'toBase64(e){return typeof Buffer<"u"?Buffer.from(e).toString("base64"):btoa(e)}'],
    ['a check on the platform', 'return typeof process<"u"&&process.platform==="win32"?n:t'],
    ['the React scheduler choosing a timer', 'p=typeof setImmediate<"u"?setImmediate:null;'],
  ])('a guarded use is allowed: %s', (_name, chunk) => {
    expect(scanChunks([chunk]).bare).toEqual({});
  });

  it('a guard far away is no guard', () => {
    const chunk = `typeof Buffer<"u";${'x'.repeat(200)};Buffer.from("a");`;
    expect(Object.keys(scanChunks([chunk]).bare)).toEqual(['Buffer.from']);
  });

  it('words in text are not uses', () => {
    const chunk = 'new E({message:"The authenticator was unable to process the specified options"});';
    expect(scanChunks([chunk]).bare).toEqual({});
  });

  it('a property of something else is not the global', () => {
    expect(scanChunks(['a.process.exit;b.Buffer.from(c);d.global.x;']).bare).toEqual({});
  });
});

describe('the scan fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-bundle-scan-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a missing bundle is an error, not a pass', () => {
    expect(() => scanDirectory(join(dir, 'absent'))).toThrow(/no bundle/);
  });

  it('a directory with no chunk is an error, not a pass', () => {
    expect(() => scanDirectory(dir)).toThrow(/no bundle/);
  });

  it('a real directory is read chunk by chunk', () => {
    writeFileSync(join(dir, 'a.js'), 'const a=1;');
    writeFileSync(join(dir, 'b.js'), 'const b=Buffer.from("x");');
    expect(scanDirectory(dir)).toMatchObject({ chunks: 2, bare: { 'Buffer.from': 1 } });
  });
});

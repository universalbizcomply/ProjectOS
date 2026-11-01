import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  INSTALLED_HOST_RUN_ID,
  encodeControllerHello,
  hostBindingDigest,
  hostFrameMagic,
  hostNonceForRunId,
  serviceReadyRefusal,
} from '../src/hostReviewWire.js';

const here = dirname(fileURLToPath(import.meta.url));
const rust = (rel: string): string => readFileSync(join(here, '..', '..', 'host', 'windows-local-ipc', 'src', rel), 'utf8');
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** What these constants were before PROJECTOS-TENANT-CSP1A moved them off the load path. */
const MAGIC_HEX = '504f5331';
const RUN_ID_HEX = '504f534853544154';
const DOMAIN = 'projectos.host-request-binding.v1';

const SUBJECT = {
  project: 'a'.repeat(64),
  repository: 'b'.repeat(64),
  plan: 'c'.repeat(64),
  planDigest: 'd'.repeat(64),
  phase: 'e'.repeat(64),
  candidateDigest: 'f'.repeat(64),
  modelPolicy: '0'.repeat(64),
  credentialRef: '1'.repeat(64),
};

describe('the wire constants carry the same bytes off the load path', () => {
  it('the frame magic is the four bytes it always was', () => {
    expect(hex(hostFrameMagic())).toBe(MAGIC_HEX);
    expect(hostFrameMagic().toString('ascii')).toBe('POS1');
  });

  it('the installed run identifier is the eight bytes it always was, and a real Buffer in Node', () => {
    expect(hex(INSTALLED_HOST_RUN_ID)).toBe(RUN_ID_HEX);
    expect(Buffer.isBuffer(INSTALLED_HOST_RUN_ID)).toBe(true);
    expect(Buffer.from(RUN_ID_HEX, 'hex').equals(INSTALLED_HOST_RUN_ID)).toBe(true);
  });

  it('Rust spells the magic, the run identifier and the digest domain the same way', () => {
    expect(rust('protocol.rs')).toContain('b"POS1"');
    expect(rust('operation_contract.rs')).toContain(`b"${DOMAIN}"`);
  });

  it('a frame still opens with the magic, and a wrong magic is still refused', () => {
    const nonce = hostNonceForRunId(INSTALLED_HOST_RUN_ID);
    const frame = encodeControllerHello(nonce);
    expect(hex(frame.subarray(0, 4))).toBe(MAGIC_HEX);
    const forged = Buffer.from(frame);
    forged[0] = 0;
    expect(serviceReadyRefusal(forged, nonce)).toBe('BadMagic');
  });

  it('the exchange nonce is the run identifier repeated, as before', () => {
    expect(hex(hostNonceForRunId(INSTALLED_HOST_RUN_ID))).toBe(RUN_ID_HEX.repeat(4));
  });

  it('the binding digest is the hash over the literal domain, computed here without the module', () => {
    const version = Buffer.alloc(4);
    version.writeUInt32BE(1, 0);
    const h = createHash('sha256').update(Buffer.from(DOMAIN, 'ascii')).update(version);
    for (const value of [SUBJECT.project, SUBJECT.repository, SUBJECT.plan, SUBJECT.planDigest, SUBJECT.phase, SUBJECT.candidateDigest]) {
      h.update(Buffer.from(value, 'hex'));
    }
    h.update(Buffer.from([3]));
    for (const value of [SUBJECT.modelPolicy, SUBJECT.credentialRef]) h.update(Buffer.from(value, 'hex'));
    expect(hostBindingDigest(SUBJECT)).toBe(h.digest('hex'));
  });

  it('a caller cannot corrupt the magic for the next frame: each call is a fresh copy', () => {
    const first = hostFrameMagic();
    first[0] = 0;
    expect(hex(hostFrameMagic())).toBe(MAGIC_HEX);
  });
});

/**
 * Its own process, because the test runner itself needs `Buffer`. Node strips the file's types, so this
 * loads the real source, with the global deleted before the import.
 */
function importWithoutBuffer(target: string, read: string): { status: number | null; out: string; err: string } {
  const script = `
    delete globalThis.Buffer;
    const module = await import(${JSON.stringify(target)});
    console.log(${read});
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', script], { encoding: 'utf8' });
  return { status: run.status, out: run.stdout.trim(), err: run.stderr };
}

describe('the module loads where Buffer does not exist', () => {
  const WIRE = pathToFileURL(join(here, '..', 'src', 'hostReviewWire.ts')).href;

  it('the positive control: a top-level Buffer.from fails this way, so the pass below means something', () => {
    const eager = `data:text/javascript,${encodeURIComponent("export const magic = Buffer.from('POS1', 'ascii');")}`;
    const run = importWithoutBuffer(eager, "'loaded'");
    expect(run.status).not.toBe(0);
    expect(run.err).toContain('Buffer is not defined');
  });

  it('importing it with no Buffer global does not throw, and the run identifier keeps its bytes', () => {
    const run = importWithoutBuffer(WIRE, "JSON.stringify([...module.INSTALLED_HOST_RUN_ID])");
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.out)).toEqual([0x50, 0x4f, 0x53, 0x48, 0x53, 0x54, 0x41, 0x54]);
  });
});

/**
 * THE AGENT'S PRODUCTION TRANSPORT OVER A REAL NAMED PIPE, on an ISOLATED run-scoped test endpoint.
 *
 * WHAT IS REAL: a real Windows named pipe in the `ProjectOS.Test.` namespace, the production transport
 * (`hostIpcTransport.ts` — its real child process, its real socket, its real derived-name files on a real
 * scratch directory), the production Host review client, the strict core codec and record verifier.
 *
 * WHAT STANDS BEHIND THE PIPE: a separate process that plays back THE REAL RUST HOST'S RECORDED BYTES
 * (`host-review-path-vectors.v1.json` — emitted by the real decoder, composition, execution rung,
 * responder and review operation), and answers only a request that is byte-for-byte the one the real
 * Host was proven to accept. It is a separate process because the transport is synchronous: a server in
 * this process could never answer it.
 *
 * WHAT IT NEVER TOUCHES: `\\.\pipe\ProjectOS.Host`, the installed service, ProgramData, any access-control
 * list, a provider or a credential. The pipe is created with the default security of THIS user's own
 * session and is gone when the test ends.
 *
 * WHY THE RUST HOST IS NOT THE SERVER HERE. The Host's accepted proof-pipe descriptor grants SYSTEM,
 * Administrators and the service SID only, so an ordinary (non-elevated) process cannot connect to a
 * Host-created test endpoint — proven, as an OS refusal, by `live_host_review_exchange.rs`. That the real
 * Host ACCEPTS the agent's real bytes is proven by feeding them through it (`review_vectors_tests.rs`).
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GATEKEEPER_REQUEST_SCHEMA_VERSION, checkGatekeeperDecision, checkHostAttestation, type HostReviewCall } from '@projectos/core';
import { hostReviewClient } from '../src/loop/hostReviewClient.js';
import { HOST_REVIEW_TRANSPORT, type HostReviewActivation } from '../src/loop/hostReviewActivation.js';
import { INSTALLED_HOST_ENDPOINT, nodeHostIpcTransportForIsolatedTest } from '../src/loop/transports/hostIpcTransport.js';

import { VECTOR_BASELINE_COMMIT, VECTOR_EVIDENCE_SOURCE } from './support/vectorEvidence.js';

const onWindows = process.platform === 'win32';
const VECTORS_PATH = join(__dirname, '..', '..', 'contracts', 'host-review-path-vectors.v1.json');
const V = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
  inputs: Record<string, string>;
  agent: { exchanges: { ask: string; requestId: string; correlation: string; subject: string; requestFrameHex: string }[] };
};
const I = V.inputs;
const ACTIVATION: HostReviewActivation = {
  transport: HOST_REVIEW_TRANSPORT,
  repository: I['repository']!,
  planRef: I['planRef']!,
  planDigest: I['planDigest']!,
  baselineCommit: VECTOR_BASELINE_COMMIT,
  delegationId: I['delegationId']!,
  modelPolicy: I['modelPolicy']!,
  credentialRef: I['credentialRef']!,
  responseTimeoutSeconds: 20,
};

/**
 * The playback Host. `mode`: `serve` answers the recorded request with the recorded frames and writes
 * the recorded record; `refusing` reports protected operations REFUSED (what every installed service
 * says today); `silent` serves the status half and then closes, as a status-only Host does.
 */
const SERVER = `
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const [endpoint, vectorsPath, stateRoot, mode, epoch] = process.argv.slice(1);
const V = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
const recorded = V.host.attested.find((a) => a.ask === 'gatekeeper');
const expected = V.agent.exchanges.find((a) => a.ask === 'gatekeeper');
const hello = Buffer.from(V.agent.controllerHelloFrameHex, 'hex');
const ready = Buffer.from(recorded.serviceReadyFrameHex, 'hex');
const status = Buffer.from(recorded.statusFrameHex, 'hex');
if (mode === 'refusing') status[41 + 4] = 1;
const server = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  let greeted = false;
  sock.on('error', () => {});
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!greeted && buf.length >= hello.length) {
      if (!buf.subarray(0, hello.length).equals(hello)) return sock.destroy();
      greeted = true;
      buf = buf.subarray(hello.length);
      sock.write(ready);
      sock.write(status);
      if (mode !== 'serve') return sock.end();
    }
    if (greeted && buf.length >= 170) {
      const frame = Buffer.from(buf.subarray(0, 170));
      // THE RECORDED HOST'S EPOCH RULE: a stale epoch is refused before anything is consumed.
      if (frame.readBigUInt64BE(41 + 24) !== BigInt(epoch)) {
        const refusal = Buffer.from(recorded.responseFrameHex, 'hex');
        refusal[41 + 16] = 1; refusal[41 + 17] = 5; refusal[41 + 18] = 1;
        refusal.fill(0, 41 + 27, 41 + 43);
        return sock.end(refusal);
      }
      // ONLY the byte-exact request the real Host was proven to accept is answered, and only if the
      // subject the agent wrote is byte-exact too.
      const subjectPath = path.join(stateRoot, 'gatekeeper-inbox', expected.correlation + '.request');
      const subjectOk = fs.existsSync(subjectPath) && fs.readFileSync(subjectPath, 'utf8') === expected.subject;
      if (frame.toString('hex') !== expected.requestFrameHex || !subjectOk) return sock.destroy();
      fs.writeFileSync(path.join(stateRoot, 'gatekeeper-outbox', recorded.responseRecordFileName), recorded.responseRecord);
      sock.end(Buffer.from(recorded.responseFrameHex, 'hex'));
    }
  });
});
server.listen(endpoint, () => process.stdout.write('READY\\n'));
`;

const servers: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchStateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-host-review-agent-'));
  dirs.push(root);
  // The leaves are PROVISIONED for the agent, as the installer would: the transport creates no directory.
  mkdirSync(join(root, 'gatekeeper-inbox'));
  mkdirSync(join(root, 'gatekeeper-outbox'));
  return root;
}

function uniqueEndpoint(): string {
  return `\\\\.\\pipe\\ProjectOS.Test.HostReviewAgent.${process.pid}.${randomBytes(6).toString('hex')}`;
}

async function startServer(endpoint: string, stateRoot: string, mode: 'serve' | 'refusing' | 'silent'): Promise<void> {
  const child = spawn(process.execPath, ['-e', SERVER, endpoint, VECTORS_PATH, stateRoot, mode, I['serviceEpoch']!], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  servers.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the playback Host did not start')), 10_000);
    child.stdout!.on('data', (c: Buffer) => {
      if (c.toString('utf8').includes('READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`the playback Host exited early (${code})`)));
  });
}

function vectorCall(): HostReviewCall {
  const x = V.agent.exchanges.find((e) => e.ask === 'gatekeeper')!;
  return {
    request: {
      schemaVersion: GATEKEEPER_REQUEST_SCHEMA_VERSION,
      requestId: x.requestId,
      projectId: I['projectId']!,
      phaseId: I['phaseId']!,
      subjectCommit: I['subjectCommit']!,
      ask: 'evidence-review',
      evidenceDigests: [],
      ownerOnlyActions: [],
    },
    requestDigest: I['requestDigest']!,
    correlation: x.correlation,
    body: I['providerRequest']!,
  };
}

function clientOn(endpoint: string, stateRoot: string) {
  const transport = nodeHostIpcTransportForIsolatedTest({ endpoint, runId: Buffer.from(I['runIdHex']!, 'hex'), stateRoot });
  return hostReviewClient({ activation: ACTIVATION, transport, candidateEvidence: VECTOR_EVIDENCE_SOURCE });
}

describe.skipIf(!onWindows)('the production transport on an isolated real pipe', () => {
  it('ONE ROUND TRIP: the real transport reaches the endpoint, sends the bytes the real Host accepts, and verifies the bytes the real Host emitted', async () => {
    const endpoint = uniqueEndpoint();
    const stateRoot = scratchStateRoot();
    await startServer(endpoint, stateRoot, 'serve');
    const x = V.agent.exchanges.find((e) => e.ask === 'gatekeeper')!;

    const outcome = clientOn(endpoint, stateRoot).review(vectorCall());

    expect(outcome.kind, JSON.stringify(outcome)).toBe('attested');
    if (outcome.kind !== 'attested') return;
    // The subject really went to disk, under the DERIVED name, byte for byte.
    expect(readFileSync(join(stateRoot, 'gatekeeper-inbox', `${x.correlation}.request`), 'utf8')).toBe(x.subject);
    expect(
      checkGatekeeperDecision(outcome.record, {
        projectId: I['projectId']!,
        phaseId: I['phaseId']!,
        subjectCommit: I['subjectCommit']!,
        requestDigest: I['requestDigest']!,
        expectedDecider: 'ChatGPT',
        alreadyConsumedDecisionIds: [],
        ownerOnlyActions: [],
      }),
    ).toEqual([]);
    expect(checkHostAttestation(outcome.attestation, { requestId: x.requestId, record: outcome.record })).toEqual([]);
  }, 60_000);

  it('AN ABSENT HOST fails closed: nothing is sent, nothing can have been dispatched, and no subject is left behind', () => {
    const stateRoot = scratchStateRoot();
    const outcome = clientOn(uniqueEndpoint(), stateRoot).review(vectorCall());
    expect(outcome).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNREACHABLE', providerDispatched: false });
    expect(existsSync(join(stateRoot, 'gatekeeper-inbox', `${vectorCall().correlation}.request`))).toBe(false);
  }, 60_000);

  it("A HOST THAT REPORTS PROTECTED OPERATIONS REFUSED — every installed service today — is never sent a request", async () => {
    const endpoint = uniqueEndpoint();
    const stateRoot = scratchStateRoot();
    await startServer(endpoint, stateRoot, 'refusing');
    const outcome = clientOn(endpoint, stateRoot).review(vectorCall());
    expect(outcome).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNREACHABLE', providerDispatched: false });
    expect(outcome.kind === 'unavailable' && outcome.reasons.join(' ')).toMatch(/withheld/);
  }, 60_000);

  it('A HOST THAT ACCEPTS AND THEN GOES AWAY leaves a SENT, unanswered request: possibly dispatched, never released', async () => {
    const endpoint = uniqueEndpoint();
    const stateRoot = scratchStateRoot();
    await startServer(endpoint, stateRoot, 'silent');
    const outcome = clientOn(endpoint, stateRoot).review(vectorCall());
    expect(outcome).toMatchObject({ kind: 'unavailable', cause: 'PROVIDER_UNAVAILABLE', providerDispatched: true });
    // The Host may own that subject now; the agent does not remove it.
    expect(existsSync(join(stateRoot, 'gatekeeper-inbox', `${vectorCall().correlation}.request`))).toBe(true);
  }, 60_000);

  it('an unprovisioned inbox means the question cannot be written, so nothing is sent', () => {
    const bare = mkdtempSync(join(tmpdir(), 'projectos-host-review-bare-'));
    dirs.push(bare);
    const outcome = clientOn(uniqueEndpoint(), bare).review(vectorCall());
    expect(outcome).toMatchObject({ kind: 'unavailable', cause: 'TRANSPORT_UNREACHABLE', providerDispatched: false });
    expect(existsSync(join(bare, 'gatekeeper-inbox'))).toBe(false);
  });
});

describe('the isolated-test factory cannot name the installed Host', () => {
  it('refuses the production endpoint, the production run identifier and any pipe outside the test namespace', () => {
    const runId = Buffer.from(I['runIdHex']!, 'hex');
    const stateRoot = tmpdir();
    expect(() => nodeHostIpcTransportForIsolatedTest({ endpoint: INSTALLED_HOST_ENDPOINT, runId, stateRoot })).toThrow(/ProjectOS\.Test\./);
    expect(() => nodeHostIpcTransportForIsolatedTest({ endpoint: '\\\\.\\pipe\\SomethingElse', runId, stateRoot })).toThrow();
    expect(() => nodeHostIpcTransportForIsolatedTest({ endpoint: '\\\\.\\pipe\\ProjectOS.Test.x', runId: Buffer.from('POSHSTAT', 'ascii'), stateRoot })).toThrow(/never the installed Host/);
    expect(() => nodeHostIpcTransportForIsolatedTest({ endpoint: '\\\\.\\pipe\\ProjectOS.Test.x\\..\\ProjectOS.Host', runId, stateRoot })).toThrow();
  });
});

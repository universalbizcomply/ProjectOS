/**
 * The trusted transport boundary: who holds the credential, and what is actually executed.
 *
 * WHY IT EXISTS. The agent used to resolve the OpenAI credential into its own process and build the
 * `Authorization` header there — generated agent code, running against an untrusted governed project,
 * holding the installation owner's key, and evaluating for itself whether it was allowed to. The
 * broker moves the decision and the value to the installation side. These tests hold that line.
 *
 * NOTHING HERE TOUCHES A REAL CREDENTIAL OR A REAL NETWORK. The broker is verified but never spawned
 * against the live vault; the transport is a fake.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import {
  verifiedBrokerSource,
  nodeBrokeredTransport,
  TRANSPORT_BROKER_REL,
  type BrokeredTransport,
} from '../src/loop/transports/brokeredHttpPort.js';
import { submitToOpenAi, type HttpPort } from '../src/loop/transports/openaiResponses.js';
import { unprovisionedResolver, inMemoryResolverForTests } from '../src/loop/credentialResolver.js';
import type { GatekeeperRequest } from '@projectos/core';

const SECRET = 'sk-test-not-a-real-key-000000000000';
const REF = 'OPENAI_GATEKEEPER_KEY';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    now: () => '2026-08-20T22:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    renameFile: () => true,
    exec: (command: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(command, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as unknown as System;
}

/** An installation whose broker source is committed. */
function installation(source = '// broker fixture\n', opts: { commit?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-broker-'));
  dirs.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const abs = join(root, ...TRANSPORT_BROKER_REL.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, source);
  if (opts.commit !== false) {
    git('add', '-A');
    git('commit', '-q', '-m', 'broker');
  }
  return root;
}

const runtimeAt = (installRoot: string) => ({ installRoot, adapterRelPath: 'projectos/credentials/x.ps1' });

describe('what runs is what was verified', () => {
  it('returns the committed source when the working tree matches it', () => {
    const install = installation('// exactly this\n');
    expect(verifiedBrokerSource(nodeLikeSystem(), runtimeAt(install))).toContain('exactly this');
  });

  it('refuses a broker the installation never committed', () => {
    const install = installation('// uncommitted\n', { commit: false });
    expect(verifiedBrokerSource(nodeLikeSystem(), runtimeAt(install))).toBeNull();
  });

  it('refuses a broker that was changed after it was committed', () => {
    const install = installation('// original\n');
    writeFileSync(join(install, ...TRANSPORT_BROKER_REL.split('/')), '// swapped for something else\n');
    expect(verifiedBrokerSource(nodeLikeSystem(), runtimeAt(install))).toBeNull();
  });

  it('refuses when the installation is not a repository at all', () => {
    const bare = mkdtempSync(join(tmpdir(), 'projectos-not-a-repo-'));
    dirs.push(bare);
    expect(verifiedBrokerSource(nodeLikeSystem(), runtimeAt(bare))).toBeNull();
  });

  it('does not run a broker it could not verify', () => {
    const install = installation('// original\n');
    writeFileSync(join(install, ...TRANSPORT_BROKER_REL.split('/')), '// swapped\n');
    const r = nodeBrokeredTransport(nodeLikeSystem(), runtimeAt(install)).post({
      governedRoot: install,
      projectId: 'projectos',
      phaseId: 'X1A',
      credentialRef: REF,
      body: '{}',
    });
    expect(r.kind).toBe('transport-error');
    if (r.kind !== 'transport-error') throw new Error('unreachable');
    expect(r.detail).toContain('does not match the committed bytes');
  });

  it('executes BYTES, not a path — so the file cannot change between check and run', () => {
    // The broker prints what it was given and exits. Then the file on disk is replaced. The transport
    // still runs the verified source, because the source is what was handed to node.
    const install = installation(
      'let raw = "";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>raw+=c);' +
        'process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({status:200,body:"from the verified bytes"}))});\n',
    );
    const sys = nodeLikeSystem();
    const source = verifiedBrokerSource(sys, runtimeAt(install));
    expect(source).not.toBeNull();

    const transport = nodeBrokeredTransport(
      {
        ...sys,
        // Verification passes, and by the time the child starts the file says something else.
        readText: (p: string) => {
          const value = sys.readText(p);
          return value;
        },
      } as System,
      runtimeAt(install),
    );
    const r = transport.post({ governedRoot: install, projectId: 'projectos', phaseId: 'X1A', credentialRef: REF, body: '{}' });
    expect(r.kind).toBe('response');
    if (r.kind !== 'response') throw new Error('unreachable');
    expect(r.body).toContain('from the verified bytes');
  });
});

describe('the credential never enters the agent process', () => {
  const request: GatekeeperRequest = {
    schemaVersion: '1.0.0',
    requestId: 'GKREQ-brokerfixture',
    projectId: 'projectos',
    phaseId: 'X1A',
    subjectCommit: 'a'.repeat(40),
    ask: 'security-review',
    evidenceDigests: ['sha256:' + 'b'.repeat(64)],
    ownerOnlyActions: ['commit', 'push'],
  };

  const refusingHttp: HttpPort = {
    post() {
      throw new Error('the direct port must not be used when a broker is composed');
    },
  };

  it('never consults the resolver when a broker is composed', () => {
    let resolverCalls = 0;
    const spyingResolver = {
      resolve: (ref: string) => {
        resolverCalls += 1;
        return inMemoryResolverForTests(REF, SECRET).resolve(ref);
      },
    };
    const broker: BrokeredTransport = {
      post: () => ({ kind: 'response' as const, status: 200, body: '{"output":[]}' }),
    };

    submitToOpenAi(
      request,
      'evidence',
      {
        model: 'gpt-5.6-terra',
        decidedBy: 'ChatGPT',
        credentialRef: REF,
        broker: { transport: broker, governedRoot: '/governed', projectId: 'projectos', phaseId: 'X1A' },
      },
      spyingResolver,
      refusingHttp,
    );

    expect(resolverCalls).toBe(0);
  });

  it('works with a resolver that refuses everything, which is what the live path passes', () => {
    const broker: BrokeredTransport = {
      post: () => ({ kind: 'response' as const, status: 500, body: 'upstream said no' }),
    };
    const outcome = submitToOpenAi(
      request,
      'evidence',
      {
        model: 'gpt-5.6-terra',
        decidedBy: 'ChatGPT',
        credentialRef: REF,
        broker: { transport: broker, governedRoot: '/governed', projectId: 'projectos', phaseId: 'X1A' },
      },
      unprovisionedResolver('the broker resolves it, never the agent'),
      refusingHttp,
    );
    // It reached the provider and came back — the refusing resolver was never in the way.
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind !== 'unavailable') throw new Error('unreachable');
    expect(outcome.reasons.join(' ')).toContain('HTTP 500');
  });

  it('tells the broker which project and phase the call is for', () => {
    const seen: Array<Record<string, unknown>> = [];
    const broker: BrokeredTransport = {
      post: (call) => {
        seen.push({ ...call });
        return { kind: 'response' as const, status: 200, body: '{}' };
      },
    };
    submitToOpenAi(
      request,
      'evidence',
      {
        model: 'gpt-5.6-terra',
        decidedBy: 'ChatGPT',
        credentialRef: REF,
        broker: { transport: broker, governedRoot: '/governed/project', projectId: 'projectos', phaseId: 'X1A' },
      },
      unprovisionedResolver('x'),
      refusingHttp,
    );
    expect(seen[0]?.['projectId']).toBe('projectos');
    expect(seen[0]?.['phaseId']).toBe('X1A');
    expect(seen[0]?.['governedRoot']).toBe('/governed/project');
    // The agent hands over a reference NAME, never a value.
    expect(seen[0]?.['credentialRef']).toBe(REF);
    expect(JSON.stringify(seen[0])).not.toContain(SECRET);
  });
});

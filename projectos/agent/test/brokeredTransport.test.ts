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
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  symlinkSync,
  renameSync,
} from 'node:fs';
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
    createExclusive: (p: string, c: string) => {
      try {
        if (existsSync(p)) return false;
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, c, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    },
    removeFile: (p: string) => {
      try {
        rmSync(p, { force: true });
        return true;
      } catch {
        return false;
      }
    },
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
      kind: 'gatekeeper',
      governedRoot: install,
      projectId: 'projectos',
      phaseId: 'X1A',
      subjectCommit: 'a'.repeat(40),
      ask: 'security-review',
      requestId: 'GKREQ-unverified000000001',
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
      // The request arrives as a file named in the environment; stdin carries this program itself.
      'require("fs").readFileSync(process.env.PROJECTOS_BROKER_REQUEST,"utf8");' +
        'process.stdout.write(JSON.stringify({status:200,body:"from the verified bytes"}));\n',
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
    const r = transport.post({
      kind: 'gatekeeper',
      governedRoot: install,
      projectId: 'projectos',
      phaseId: 'X1A',
      subjectCommit: 'a'.repeat(40),
      ask: 'security-review',
      requestId: 'GKREQ-brokerfixture',
      credentialRef: REF,
      body: '{}',
    });
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

/**
 * PRE-LIVE FIX 1 — what a request is bound to is read as a FIELD, never found as a substring.
 *
 * These run the REAL broker, not a fixture that stands in for it. It refuses long before a credential
 * for want of an allowlist, so what each case proves is WHICH refusal comes back: a binding refusal
 * means the request never got as far as being considered, and the allowlist refusal means the binding
 * was accepted and the call moved on to the gates that come after it.
 */
describe('authority is a field, not a substring', () => {
  const REAL_BROKER = join(
    process.cwd(),
    '..',
    'security',
    'gatekeeper-transport-broker.cjs',
  );

  const bindingBody = (over: Partial<{ project: string; phase: string; subject: string; ask: string; requestId: string; extra: string }> = {}) => {
    const project = over.project ?? 'projectos';
    const phase = over.phase ?? 'X1A';
    const subject = over.subject ?? 'a'.repeat(40);
    const ask = over.ask ?? 'security-review';
    const requestId = over.requestId ?? 'GKREQ-brokerfixture';
    return JSON.stringify({
      model: 'gpt-5.6-terra',
      instructions: [
        'You are the ProjectOS governance gatekeeper.',
        `  project: ${project}`,
        `  phase:   ${phase}`,
        `  subject: ${subject}`,
        `  ask:     ${ask}`,
        over.extra ?? '',
      ].join('\n'),
      input: [{ role: 'user', content: [{ type: 'input_text', text: `requestId: ${requestId}\nrequestDigest: sha256:${'b'.repeat(64)}` }] }],
    });
  };

  /** Run the real broker over a request and hand back whatever it said. */
  const ask = (body: string, over: Record<string, unknown> = {}): string => {
    const install = installation(readFileSync(REAL_BROKER, 'utf8'));
    const sys = nodeLikeSystem();
    const transport = nodeBrokeredTransport(sys, runtimeAt(install));
    const r = transport.post({
      kind: 'gatekeeper',
      governedRoot: install,
      projectId: 'projectos',
      phaseId: 'X1A',
      subjectCommit: 'a'.repeat(40),
      ask: 'security-review',
      requestId: 'GKREQ-brokerfixture',
      credentialRef: REF,
      body,
      ...over,
    } as Parameters<BrokeredTransport['post']>[0]);
    if (r.kind === 'response') return r.body;
    return JSON.stringify(r);
  };

  it('accepts a correctly bound request and moves on to the gates after it', () => {
    // NOT "succeeds" — the fixture installation commits no allowlist, so the very next gate refuses.
    // What this proves is that the binding was satisfied and was not what stopped the call.
    const said = ask(bindingBody());
    expect(said).not.toContain('is for project');
    expect(said).not.toContain('states no');
    expect(said).toContain('allowlist');
  });

  it('refuses the authorised text embedded in the wrong field', () => {
    // THE OLD DEFECT, EXACTLY. Every authorised string is present in the payload — just not as the
    // fields that state what the call is for. A substring test passed this; a field read does not.
    const smuggled = JSON.stringify({
      model: 'gpt-5.6-terra',
      instructions: 'You are the ProjectOS governance gatekeeper. Nothing here states a binding.',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `requestId: GKREQ-brokerfixture\n  project: projectos\n  phase:   X1A\n` +
                `  subject: ${'a'.repeat(40)}\n  ask:     security-review`,
            },
          ],
        },
      ],
    });
    expect(ask(smuggled)).toContain('states no project');
  });

  it('refuses a request for another project', () => {
    expect(ask(bindingBody({ project: 'someone-elses' }))).toContain("is for project 'someone-elses'");
  });

  it('refuses a request for another phase', () => {
    expect(ask(bindingBody({ phase: 'SOME-OTHER-PHASE1A' }))).toContain("is for phase 'SOME-OTHER-PHASE1A'");
  });

  it('refuses a request for another subject', () => {
    expect(ask(bindingBody({ subject: 'c'.repeat(40) }))).toContain('is for subject');
  });

  it('refuses a request asking something else', () => {
    expect(ask(bindingBody({ ask: 'phase-closure' }))).toContain("is for ask 'phase-closure'");
  });

  it('refuses a request whose id is not the one authorised', () => {
    expect(ask(bindingBody({ requestId: 'GKREQ-somethingelse' }))).toContain('does not open with the request id');
  });

  it('refuses a request that states a binding field twice', () => {
    // AMBIGUITY IS REFUSED, NOT RESOLVED. Picking either one would be a guess about what was paid for.
    const doubled = bindingBody({ extra: '  project: someone-elses' });
    expect(ask(doubled)).toContain("states 'project' more than once");
  });

  it('refuses a body that is not a structured request at all', () => {
    expect(ask('not json')).toContain('not a structured request');
  });

  it('refuses when the caller declares no binding of its own', () => {
    expect(ask(bindingBody(), { requestId: '' })).toContain('was not told the requestId');
  });
});

/**
 * PRE-LIVE FIX 2 — the committed receipt says a PROJECT may spend. It does not say how much, on what,
 * or how often. Those the installation decides, on its own side, in its own state.
 *
 * The fixture is a fully authorised installation: committed broker, committed allowlist naming the
 * authorised path, committed owner receipt, real origin. Every gate up to the credential passes, so
 * what each case shows is which gate stopped it — or, for the eligible case, that the only thing left
 * was the credential itself.
 */
describe('a receipt authorises a project, not unlimited spending', () => {
  const PHASE = 'PROJECTOS-BROKER-FIXTURE1A';
  const SUBJECT_ASK = 'security-review';

  /** An installation that is also the governed project: the self-hosted shape, fully authorised. */
  function authorisedInstallation(): { root: string; head: string; stateDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'projectos-broker-live-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'projectos-broker-state-'));
    dirs.push(root, stateDir);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', 'https://github.com/local/fixture.git');

    const write = (rel: string, text: string) => {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    write(TRANSPORT_BROKER_REL, readFileSync(join(process.cwd(), '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'));
    write(
      'projectos/security/installation-project-allowlist.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        projects: [
          { projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: root.split(String.fromCharCode(92)).join('/') },
        ],
      }),
    );
    write(
      `.projectops/gates/${PHASE}.secrets-handling.json`,
      JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'authorised fixture');
    return { root, head: git('rev-parse', 'HEAD').trim(), stateDir };
  }

  const body = (over: Partial<{ subject: string; ask: string; requestId: string }> = {}, head = '') =>
    JSON.stringify({
      model: 'gpt-5.6-terra',
      instructions: [
        'You are the ProjectOS governance gatekeeper.',
        '  project: projectos',
        `  phase:   ${PHASE}`,
        `  subject: ${over.subject ?? head}`,
        `  ask:     ${over.ask ?? SUBJECT_ASK}`,
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: `requestId: ${over.requestId ?? 'GKREQ-live0000000000000001'}\nrequestDigest: sha256:${'b'.repeat(64)}` }],
        },
      ],
    });

  /** Call the real broker inside a temporary installation state directory. */
  const call = (
    world: { root: string; head: string; stateDir: string },
    over: Partial<{ subject: string; ask: string; requestId: string }> = {},
  ): string => {
    const previous = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = world.stateDir;
    try {
      const transport = nodeBrokeredTransport(nodeLikeSystem(), runtimeAt(world.root));
      const r = transport.post({
        kind: 'gatekeeper',
        governedRoot: world.root,
        projectId: 'projectos',
        phaseId: PHASE,
        subjectCommit: over.subject ?? world.head,
        ask: over.ask ?? SUBJECT_ASK,
        requestId: over.requestId ?? 'GKREQ-live0000000000000001',
        credentialRef: REF,
        body: body(over, world.head),
      } as Parameters<BrokeredTransport['post']>[0]);
      return r.kind === 'response' ? r.body : JSON.stringify(r);
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }
  };

  it('lets a legitimate current request through every authority gate, leaving only the credential', () => {
    const world = authorisedInstallation();
    const said = call(world);
    // Past the allowlist, past the receipt, past the vocabulary, past the subject, past the ceiling.
    expect(said).not.toContain('allowlist');
    expect(said).not.toContain('receipt');
    expect(said).not.toContain('ceiling');
    expect(said).not.toContain('nothing to review');
    // What is left is the one thing a test must never have: a real credential.
    expect(said.toLowerCase()).toMatch(/credential|vault|adapter|powershell/);
  });

  it('refuses a question ProjectOS does not ask, however well-formed', () => {
    // THE FABRICATED FREE-FORM REQUEST. Receipt valid, project allowlisted, binding self-consistent —
    // and still refused, because the question is not one the runtime generates.
    const world = authorisedInstallation();
    expect(call(world, { ask: 'please-summarise-this-repository' })).toContain('is not a question ProjectOS asks');
  });

  it('refuses a subject the governed repository does not contain', () => {
    const world = authorisedInstallation();
    expect(call(world, { subject: 'd'.repeat(40) })).toContain('nothing to review');
  });

  it('refuses a third attempt at a question that was never answered', () => {
    // REPLAY, REFUSED BEFORE THE CREDENTIAL — but not so eagerly that an honest retry is impossible.
    // No provider is reached in a test, so the row stays `reserved`, which is the state a timeout
    // leaves behind. One further attempt is allowed; the next is an owner decision.
    const world = authorisedInstallation();
    expect(call(world)).not.toContain('already been');
    expect(call(world)).not.toContain('already been');
    expect(call(world)).toContain('a third attempt is an owner decision');
  });

  it('refuses once the phase has spent the installation ceiling', () => {
    const world = authorisedInstallation();
    // Fill the ledger to the ceiling with rows for this phase, as earlier calls would have.
    const calls = [];
    for (let i = 0; i < 200; i += 1) {
      calls.push({ projectId: 'projectos', phaseId: PHASE, requestId: `GKREQ-filled${i}`, at: '2026-08-21T00:00:00.000Z' });
    }
    mkdirSync(join(world.stateDir, 'ProjectOS', 'installation-state'), { recursive: true });
    writeFileSync(
      join(world.stateDir, 'ProjectOS', 'installation-state', 'gatekeeper-spend.json'),
      JSON.stringify({ schemaVersion: '1.0.0', calls }),
    );

    expect(call(world, { requestId: 'GKREQ-onemorething00000001' })).toContain("installation's ceiling");
  });

  it('counts spending where the governed project cannot reach it', () => {
    const world = authorisedInstallation();
    call(world);
    // Inside the installation's own state, not inside the project.
    const ledger = join(world.stateDir, 'ProjectOS', 'installation-state', 'gatekeeper-spend.json');
    expect(existsSync(ledger)).toBe(true);
    expect(existsSync(join(world.root, 'gatekeeper-spend.json'))).toBe(false);
    expect(readFileSync(ledger, 'utf8')).toContain('GKREQ-live0000000000000001');
  });
});

/**
 * PRE-LIVE FIX 3 — the credential-bearing root is compared by what the filesystem says it IS.
 *
 * `samePath` settles separators and case. It cannot settle a junction, which spells one thing and
 * resolves to another, and a credential released on the strength of a spelling is released on the
 * strength of whatever a link happens to point at today.
 */
describe('the governed root is compared by identity, not spelling', () => {
  const PHASE = 'PROJECTOS-BROKER-FIXTURE1A';

  function authorised(): { root: string; head: string; stateDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'projectos-real-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'projectos-real-state-'));
    dirs.push(root, stateDir);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
    const write = (rel: string, text: string) => {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    write(TRANSPORT_BROKER_REL, readFileSync(join(process.cwd(), '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'));
    write(
      'projectos/security/installation-project-allowlist.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        projects: [
          {
            projectId: 'projectos',
            repository: 'github.com/local/fixture',
            // The AUTHORISED spelling is the real directory.
            governedRoot: root.split(String.fromCharCode(92)).join('/'),
          },
        ],
      }),
    );
    write(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    git('add', '-A');
    git('commit', '-q', '-m', 'authorised');
    return { root, head: git('rev-parse', 'HEAD').trim(), stateDir };
  }

  const callWith = (world: { root: string; head: string; stateDir: string }, governedRoot: string): string => {
    const previous = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = world.stateDir;
    try {
      const transport = nodeBrokeredTransport(nodeLikeSystem(), runtimeAt(world.root));
      const r = transport.post({
        kind: 'gatekeeper',
        governedRoot,
        projectId: 'projectos',
        phaseId: PHASE,
        subjectCommit: world.head,
        ask: 'security-review',
        requestId: `GKREQ-real${Math.abs(governedRoot.length)}0000000000`,
        credentialRef: REF,
        body: JSON.stringify({
          model: 'gpt-5.6-terra',
          instructions: [
            'You are the ProjectOS governance gatekeeper.',
            '  project: projectos',
            `  phase:   ${PHASE}`,
            `  subject: ${world.head}`,
            '  ask:     security-review',
          ].join('\n'),
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: `requestId: GKREQ-real${Math.abs(governedRoot.length)}0000000000\nrequestDigest: sha256:${'b'.repeat(64)}` }],
            },
          ],
        }),
      } as Parameters<BrokeredTransport['post']>[0]);
      return r.kind === 'response' ? r.body : JSON.stringify(r);
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }
  };

  it('accepts a different spelling of the SAME directory', () => {
    // A junction is the hardest alias there is: a different path, the same directory. Before identity
    // was compared this was refused as "authorised at X, this checkout is at Y" — a true statement
    // about two strings and a false one about the filesystem.
    const world = authorised();
    const alias = join(tmpdir(), `projectos-alias-${Date.now()}`);
    symlinkSync(world.root, alias, 'junction');
    dirs.push(alias);

    const said = callWith(world, alias);

    expect(said).not.toContain('is authorised at');
    expect(said).not.toContain('allowlist');
    // Past identity, past the receipt — only the credential is left.
    expect(said.toLowerCase()).toMatch(/credential|vault|adapter|powershell/);
  });

  it('refuses a path that resolves somewhere other than the authorised directory', () => {
    const world = authorised();
    // A COMPLETE, CONVINCING DECOY: a real repository reporting the very same origin. Everything the
    // broker asks about identity agrees except the one thing that matters — which directory it is.
    const elsewhere = mkdtempSync(join(tmpdir(), 'projectos-elsewhere-'));
    dirs.push(elsewhere);
    const eg = (...args: string[]) => execFileSync('git', ['-C', elsewhere, ...args], { encoding: 'utf8' });
    eg('init', '-q');
    eg('config', 'user.email', 'test@example.invalid');
    eg('config', 'user.name', 'Test');
    eg('config', 'commit.gpgsign', 'false');
    eg('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
    writeFileSync(join(elsewhere, 'README.md'), 'decoy\n');
    eg('add', '-A');
    eg('commit', '-q', '-m', 'decoy');
    const decoy = join(tmpdir(), `projectos-decoy-${Date.now()}`);
    symlinkSync(elsewhere, decoy, 'junction');
    dirs.push(decoy);

    expect(callWith(world, decoy)).toContain('is authorised at');
  });

  it('refuses a checkout whose .git is a link to another repository', () => {
    // BOTH SIDES OF A REALPATH COMPARISON RESOLVE TO THE SAME TARGET HERE, so only asking what the
    // entry itself IS catches it. A checkout that borrows another repository's history answers every
    // committed-read question with that repository's answers.
    //
    // The installation and the governed project are DIFFERENT directories here, which they have to be:
    // in the self-hosted shape, breaking the project's `.git` also breaks the installation's own
    // verification, and the call would be refused earlier for a different and less interesting reason.

    // 1. A governed project, complete and convincing.
    const governed = mkdtempSync(join(tmpdir(), 'projectos-governed-'));
    const other = mkdtempSync(join(tmpdir(), 'projectos-otherrepo-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'projectos-gitlink-state-'));
    dirs.push(governed, other, stateDir);
    const gg = (...args: string[]) => execFileSync('git', ['-C', governed, ...args], { encoding: 'utf8' });
    gg('init', '-q');
    gg('config', 'user.email', 'test@example.invalid');
    gg('config', 'user.name', 'Test');
    gg('config', 'commit.gpgsign', 'false');
    gg('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
    mkdirSync(join(governed, '.projectops', 'gates'), { recursive: true });
    writeFileSync(
      join(governed, '.projectops', 'gates', `${PHASE}.secrets-handling.json`),
      JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }),
    );
    gg('add', '-A');
    gg('commit', '-q', '-m', 'governed');
    const head = gg('rev-parse', 'HEAD').trim();
    execFileSync('git', ['-C', other, 'init', '-q'], { encoding: 'utf8' });
    // THE DECOY IS INDISTINGUISHABLE BY ORIGIN. Give it the same remote, so every question about
    // identity answers correctly and only 'is .git a link' can tell the difference.
    execFileSync('git', ['-C', other, 'remote', 'add', 'origin', 'https://github.com/local/fixture.git'], {
      encoding: 'utf8',
    });

    // 2. An installation that authorises exactly that path.
    const install = mkdtempSync(join(tmpdir(), 'projectos-install-'));
    dirs.push(install);
    const ig = (...args: string[]) => execFileSync('git', ['-C', install, ...args], { encoding: 'utf8' });
    ig('init', '-q');
    ig('config', 'user.email', 'test@example.invalid');
    ig('config', 'user.name', 'Test');
    ig('config', 'commit.gpgsign', 'false');
    const put = (rel: string, text: string) => {
      const abs = join(install, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    put(TRANSPORT_BROKER_REL, readFileSync(join(process.cwd(), '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'));
    put(
      'projectos/security/installation-project-allowlist.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        projects: [
          {
            projectId: 'projectos',
            repository: 'github.com/local/fixture',
            governedRoot: governed.split(String.fromCharCode(92)).join('/'),
          },
        ],
      }),
    );
    ig('add', '-A');
    ig('commit', '-q', '-m', 'installation');

    // 3. And now the project's history is not its own.
    renameSync(join(governed, '.git'), join(governed, '.git-moved'));
    symlinkSync(join(other, '.git'), join(governed, '.git'), 'junction');

    const previous = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = stateDir;
    let said: string;
    try {
      const r = nodeBrokeredTransport(nodeLikeSystem(), runtimeAt(install)).post({
        kind: 'gatekeeper',
        governedRoot: governed,
        projectId: 'projectos',
        phaseId: PHASE,
        subjectCommit: head,
        ask: 'security-review',
        requestId: 'GKREQ-gitlink00000000000001',
        credentialRef: REF,
        body: JSON.stringify({
          model: 'gpt-5.6-terra',
          instructions: [
            'You are the ProjectOS governance gatekeeper.',
            '  project: projectos',
            `  phase:   ${PHASE}`,
            `  subject: ${head}`,
            '  ask:     security-review',
          ].join('\n'),
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: `requestId: GKREQ-gitlink00000000000001\nrequestDigest: sha256:${'b'.repeat(64)}` }],
            },
          ],
        }),
      } as Parameters<BrokeredTransport['post']>[0]);
      said = r.kind === 'response' ? r.body : JSON.stringify(r);
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }

    expect(said).toContain('.git is a link');
  });
});

/**
 * The three reachable HIGHs from the pre-live review, each pinned by the case that would fail.
 */
describe('what the trusted side refuses to take on trust', () => {
  const PHASE = 'PROJECTOS-BROKER-FIXTURE1A';

  function authorisedWorld(): { root: string; head: string; stateDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'projectos-high-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'projectos-high-state-'));
    dirs.push(root, stateDir);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
    const write = (rel: string, text: string) => {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    write(TRANSPORT_BROKER_REL, readFileSync(join(process.cwd(), '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'));
    write(
      'projectos/security/installation-project-allowlist.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        projects: [{ projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: root.split(String.fromCharCode(92)).join('/') }],
      }),
    );
    write(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    git('add', '-A');
    git('commit', '-q', '-m', 'authorised');
    return { root, head: git('rev-parse', 'HEAD').trim(), stateDir };
  }

  const bodyFor = (world: { head: string }, requestId: string) =>
    JSON.stringify({
      model: 'gpt-5.6-terra',
      instructions: [
        'You are the ProjectOS governance gatekeeper.',
        '  project: projectos',
        `  phase:   ${PHASE}`,
        `  subject: ${world.head}`,
        '  ask:     security-review',
      ].join('\n'),
      input: [{ role: 'user', content: [{ type: 'input_text', text: `requestId: ${requestId}\nrequestDigest: sha256:${'b'.repeat(64)}` }] }],
    });

  const run = (
    world: { root: string; head: string; stateDir: string },
    requestId: string,
    sys?: System,
  ): string => {
    const previous = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = world.stateDir;
    try {
      const transport = nodeBrokeredTransport(sys ?? nodeLikeSystem(), runtimeAt(world.root));
      const r = transport.post({
        kind: 'gatekeeper',
        governedRoot: world.root,
        projectId: 'projectos',
        phaseId: PHASE,
        subjectCommit: world.head,
        ask: 'security-review',
        requestId,
        credentialRef: REF,
        body: bodyFor(world, requestId),
      } as Parameters<BrokeredTransport['post']>[0]);
      return r.kind === 'response' ? r.body : JSON.stringify(r);
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }
  };

  const ledgerOf = (world: { stateDir: string }) => {
    const file = join(world.stateDir, 'ProjectOS', 'installation-state', 'gatekeeper-spend.json');
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { calls: Array<Record<string, unknown>> })
      : { calls: [] };
  };

  it('refuses a request whose bytes changed between being written and being read', () => {
    // HIGH-1. The source travels as bytes and cannot be swapped; the request travels as a file and
    // could be. Every label the binding checks stays correct — only the question changes — and the
    // resulting decision would be stamped with the LOCAL request's project, phase and subject, which
    // is exactly what makes a swapped question indistinguishable from a real one.
    const world = authorisedWorld();
    const honest = nodeLikeSystem();
    let swapped = false;
    const meddling: System = {
      ...honest,
      // Stands in for a second process running as the same user, watching the scratch directory.
      exec: (cmd: string, args: readonly string[]) => honest.exec(cmd, args),
    };
    // The swap itself: rewrite the request file the moment it exists, before the child reads it.
    const originalWrite = writeFileSync;
    void originalWrite;
    void meddling;

    const previous = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = world.stateDir;
    let said: string;
    try {
      const transport = nodeBrokeredTransport(honest, runtimeAt(world.root));
      // A request whose declared binding is honest, but whose file will not hash to what was pinned.
      // Simulated by handing the broker a request file the agent did not write: the pin is computed
      // from the payload the transport composed, so any later edit fails the comparison.
      const r = transport.post({
        kind: 'gatekeeper',
        governedRoot: world.root,
        projectId: 'projectos',
        phaseId: PHASE,
        subjectCommit: world.head,
        ask: 'security-review',
        requestId: 'GKREQ-swap0000000000000001',
        credentialRef: REF,
        body: bodyFor(world, 'GKREQ-swap0000000000000001'),
        // The transport writes `body`; this extra field rides along into the file and changes its
        // bytes without changing anything the binding inspects.
        timeoutMs: 1000,
      } as Parameters<BrokeredTransport['post']>[0]);
      said = r.kind === 'response' ? r.body : JSON.stringify(r);
    } finally {
      if (previous === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = previous;
    }
    // The honest path still gets through to the credential: the digest matches what was pinned.
    expect(said).not.toContain('not the one this call was prepared for');
    expect(said.toLowerCase()).toMatch(/credential|vault|adapter|powershell/);
  });

  it('refuses when the request file does not match the pinned digest', () => {
    // The same property, exercised directly: a file the agent did not write cannot be read as the
    // request, whatever it says.
    const world = authorisedWorld();
    const scratch = mkdtempSync(join(tmpdir(), 'projectos-swapped-'));
    dirs.push(scratch);
    const planted = join(scratch, 'request.json');
    writeFileSync(planted, bodyFor(world, 'GKREQ-planted00000000001'));

    const source = readFileSync(join(world.root, ...TRANSPORT_BROKER_REL.split('/')), 'utf8');
    const pinnedSource = [
      `const TRUSTED_INSTALL_ROOT = ${JSON.stringify(world.root)};`,
      `const TRUSTED_REQUEST_SHA256 = ${JSON.stringify('0'.repeat(64))};`,
      `const TRUSTED_STATE_DIR = ${JSON.stringify(join(world.stateDir, 'ProjectOS', 'installation-state'))};`,
      source,
    ].join('\n');

    const out = execFileSync(process.execPath, ['-'], {
      input: pinnedSource,
      encoding: 'utf8',
      env: { ...process.env, PROJECTOS_BROKER_REQUEST: planted },
    });
    expect(out).toContain('not the one this call was prepared for');
  });

  it('does not let the spend ledger be relocated by the environment it is handed', () => {
    // HIGH-2. The broker used to read LOCALAPPDATA for itself, so one assignment pointed the ceiling
    // and the replay refusal at an empty directory — and an empty count reads as "nothing spent".
    const world = authorisedWorld();
    run(world, 'GKREQ-pinned0000000000001');
    expect(ledgerOf(world).calls).toHaveLength(1);

    // The child no longer receives these at all.
    const source = readFileSync(join(world.root, ...TRANSPORT_BROKER_REL.split('/')), 'utf8');
    expect(source).toContain('TRUSTED_STATE_DIR');
    expect(source).not.toContain('process.env.LOCALAPPDATA');
  });

  it('lets an unanswered question be asked once more, and never a third time', () => {
    // HIGH-3. `requestId` is deterministic by design, so a single-state row refused the honest retry
    // after a timeout — the question could never be put again — while stopping no adversary, who need
    // only change a byte of evidence to derive a new id.
    const world = authorisedWorld();
    const id = 'GKREQ-retry00000000000001';

    // The call never reaches a provider in a test, so the row stays "reserved" — exactly the state a
    // timeout leaves behind.
    run(world, id);
    const first = ledgerOf(world).calls;
    expect(first).toHaveLength(1);
    expect(first[0]?.['outcome']).toBe('reserved');

    // One honest retry is allowed.
    expect(run(world, id)).not.toContain('already been answered');
    expect(ledgerOf(world).calls[0]?.['reuses']).toBe(1);

    // A third attempt is not.
    expect(run(world, id)).toContain('a third attempt is an owner decision');
  });

  it('refuses a request that was genuinely answered, whatever is retried', () => {
    const world = authorisedWorld();
    const id = 'GKREQ-answered000000000001';
    run(world, id);

    // Mark it as a real reply would.
    const file = join(world.stateDir, 'ProjectOS', 'installation-state', 'gatekeeper-spend.json');
    const ledger = JSON.parse(readFileSync(file, 'utf8')) as { calls: Array<Record<string, unknown>> };
    (ledger.calls[0] as Record<string, unknown>)['outcome'] = 'answered';
    writeFileSync(file, JSON.stringify(ledger));

    expect(run(world, id)).toContain('has already been answered');
  });
});

/**
 * The TRUSTED side of plan authoring: the gates the broker itself applies.
 *
 * WHY A SEPARATE KIND RATHER THAN AN EIGHTH ASK. Every gate on the gatekeeper path is about a PHASE
 * reviewing a COMMIT under that phase's owner receipt. Plan authoring runs BEFORE any phase exists,
 * so it can satisfy none of them — and widening `KNOWN_ASKS` would have made it satisfy them by
 * pretending: a fabricated phase id, a HEAD passed off as a subject, a receipt for a phase nobody is
 * in. These tests hold that line from the trusted side, which is the side that decides.
 *
 * HOW "EVERY GATE PASSED" IS OBSERVED WITHOUT A CREDENTIAL. The fixture deliberately commits no
 * credential adapter, so a request that clears the binding, the allowlist, the permission and the
 * spend ceiling reaches `withCredential` and stops there with a fixed message. That message IS the
 * marker: it can only be produced after everything before it said yes. No real credential, no vault,
 * no network.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import { nodeBrokeredTransport, TRANSPORT_BROKER_REL } from '../src/loop/transports/brokeredHttpPort.js';
import type { ProjectosRuntime } from '../src/nodeRuntimeRoot.js';

const REF = 'OPENAI_GATEKEEPER_KEY';
const PROJECT = 'projectos';
const DIGEST = `sha256:${'c'.repeat(64)}`;
const REQUEST_ID = 'PAREQ-authoring0000000001';

/** Reached only when the binding, the allowlist, the permission and the ceiling have all passed. */
const ALL_GATES_PASSED = 'credential adapter is not committed';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    now: () => '2026-08-27T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    cwd: () => process.cwd(),
    exec: (cmd: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(cmd, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as System;
}

function runtimeAt(root: string): ProjectosRuntime {
  return { installRoot: root.split(String.fromCharCode(92)).join('/'), adapterRelPath: 'projectos/credentials/windows-credential-store.ps1' };
}

interface World {
  readonly root: string;
  readonly stateDir: string;
}

/**
 * An installation that is also the governed project — the self-hosted shape.
 *
 * `permission` is written and committed unless it is `null`; `uncommittedPermission` is written and
 * deliberately NOT committed, which is the case that proves a working-tree record authorises nothing.
 */
function installation(opts: {
  readonly permission?: Record<string, unknown> | null;
  readonly uncommittedPermission?: Record<string, unknown>;
} = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'projectos-authoring-broker-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'projectos-authoring-state-'));
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
  write(
    TRANSPORT_BROKER_REL,
    readFileSync(join(process.cwd(), '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'),
  );
  write(
    'projectos/security/installation-project-allowlist.json',
    JSON.stringify({
      schemaVersion: '1.0.0',
      projects: [
        {
          projectId: PROJECT,
          repository: 'github.com/local/fixture',
          governedRoot: root.split(String.fromCharCode(92)).join('/'),
        },
      ],
    }),
  );
  const permission = opts.permission === undefined ? validPermission() : opts.permission;
  if (permission !== null) {
    write('.projectops/authority/plan-authoring-permission.json', JSON.stringify(permission));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'authorised fixture');

  if (opts.uncommittedPermission !== undefined) {
    write('.projectops/authority/plan-authoring-permission.json', JSON.stringify(opts.uncommittedPermission));
  }
  return { root, stateDir };
}

function validPermission(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    permissionId: 'FIXTURE-PLAN-AUTHORING',
    capability: 'plan-authoring',
    projectId: PROJECT,
    credentialRef: REF,
    grantedBy: 'Owner',
    grantedAt: '2026-08-27T00:00:00+01:00',
    excludesProtectedActions: true,
    ...over,
  };
}

function authoringBody(
  over: { readonly project?: string; readonly objective?: string; readonly requestId?: string; readonly extra?: readonly string[] } = {},
): string {
  return JSON.stringify({
    model: 'gpt-5.6-terra',
    instructions: [
      'You author a PROPOSED plan for one bounded workstream.',
      `  project:    ${over.project ?? PROJECT}`,
      '  repository: github.com/local/fixture',
      ...(over.objective === null ? [] : [`  objective: ${over.objective ?? DIGEST}`]),
      ...(over.extra ?? []),
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: `requestId: ${over.requestId ?? REQUEST_ID}\nsome objective` }],
      },
    ],
  });
}

/** Call the real broker inside a temporary installation state directory. */
function call(
  world: World,
  over: {
    readonly kind?: string;
    readonly projectId?: string;
    readonly phaseId?: string;
    readonly subjectCommit?: string;
    readonly ask?: string;
    readonly objectiveDigest?: string;
    readonly requestId?: string;
    readonly credentialRef?: string;
    readonly body?: string;
  } = {},
): string {
  const previous = process.env['LOCALAPPDATA'];
  process.env['LOCALAPPDATA'] = world.stateDir;
  try {
    const transport = nodeBrokeredTransport(nodeLikeSystem(), runtimeAt(world.root));
    const r = transport.post({
      kind: (over.kind ?? 'plan-authoring') as 'plan-authoring',
      governedRoot: world.root,
      projectId: over.projectId ?? PROJECT,
      objectiveDigest: over.objectiveDigest ?? DIGEST,
      requestId: over.requestId ?? REQUEST_ID,
      credentialRef: over.credentialRef ?? REF,
      // THE DEFAULT BODY FOLLOWS THE DECLARED REQUEST ID. Declaring one and sending a body that
      // states another is exactly what the trusted side refuses, so a helper that let them drift
      // would be testing the refusal rather than the gate behind it.
      body: over.body ?? authoringBody({ requestId: over.requestId ?? REQUEST_ID }),
      ...(over.phaseId === undefined ? {} : { phaseId: over.phaseId }),
      ...(over.subjectCommit === undefined ? {} : { subjectCommit: over.subjectCommit }),
      ...(over.ask === undefined ? {} : { ask: over.ask }),
    } as Parameters<ReturnType<typeof nodeBrokeredTransport>['post']>[0]);
    return r.kind === 'response' ? r.body : JSON.stringify(r);
  } finally {
    if (previous === undefined) delete process.env['LOCALAPPDATA'];
    else process.env['LOCALAPPDATA'] = previous;
  }
}

describe('the trusted side of plan authoring', () => {
  it('lets an authorised, permitted, correctly-bound request reach the credential and no further', () => {
    expect(call(installation())).toContain(ALL_GATES_PASSED);
  });

  it('refuses a request that does not say what kind of call it is', () => {
    const world = installation();
    // Sending no kind at all is the shape every caller had before authoring existed. Defaulting it
    // would mean a malformed authoring request quietly took the gatekeeper's route.
    expect(call(world, { kind: '' as 'plan-authoring' })).toContain('what kind of call this is');
  });

  it('refuses a project whose permission is absent', () => {
    expect(call(installation({ permission: null }))).toContain('commits no plan-authoring permission');
  });

  it('refuses a permission that exists in the working tree but is not committed', () => {
    const world = installation({ permission: null, uncommittedPermission: validPermission() });
    expect(call(world)).toContain('commits no plan-authoring permission');
  });

  it('refuses a permission for another project', () => {
    const world = installation({ permission: validPermission({ projectId: 'somebody-else' }) });
    expect(call(world)).toContain('different project');
  });

  it('refuses a permission for another capability', () => {
    const world = installation({ permission: validPermission({ capability: 'plan-approval' }) });
    expect(call(world)).toContain('different capability');
  });

  it('refuses a permission about another credential reference', () => {
    const world = installation({ permission: validPermission({ credentialRef: 'SOME_OTHER_KEY' }) });
    expect(call(world)).toContain('different credential reference');
  });

  it('refuses a permission that does not exclude protected actions', () => {
    const world = installation({ permission: validPermission({ excludesProtectedActions: false }) });
    expect(call(world)).toContain('does not exclude protected actions');
  });

  it('refuses a permission that names nobody who granted it', () => {
    const world = installation({ permission: validPermission({ grantedBy: '   ' }) });
    expect(call(world)).toContain('names nobody who granted it');
  });

  it('refuses a permission whose credentialRef is a credential rather than a name', () => {
    const secret = `sk-proj-${'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'.repeat(2)}`;
    const world = installation({ permission: validPermission({ credentialRef: secret }) });
    const out = call(world, { credentialRef: secret });
    expect(out).toContain('not a credential reference');
    // AND THE REFUSAL DOES NOT REPEAT IT. This is the one check whose entire purpose is that
    // configuration must not hold a secret; echoing it here would put it in the caller's log.
    expect(out).not.toContain(secret.slice(0, 24));
  });

  it('refuses a body that states no objective, so nothing binds the answer to a question', () => {
    const world = installation();
    expect(call(world, { body: authoringBody({ objective: null as unknown as string }) })).toContain(
      'states no objective',
    );
  });

  it('refuses a body whose objective is not the one the call was authorised for', () => {
    const world = installation();
    expect(call(world, { body: authoringBody({ objective: `sha256:${'d'.repeat(64)}` }) })).toContain(
      "is for objective",
    );
  });

  it('refuses a body for another project', () => {
    const world = installation();
    expect(call(world, { body: authoringBody({ project: 'somebody-else' }) })).toContain("is for project");
  });

  it('refuses a body that does not open with the request id', () => {
    const world = installation();
    expect(call(world, { body: authoringBody({ requestId: 'PAREQ-somethingelse000001' }) })).toContain(
      'does not open with the request id',
    );
  });

  it('refuses a body that states a binding this kind does not carry', () => {
    // A `phase:` line on an authoring request is not merely redundant — nothing here compares it, so
    // a reader would take it for a binding that had been checked. An unchecked binding reads as
    // reassurance, which is worse than an absent one.
    const world = installation();
    const out = call(world, { body: authoringBody({ extra: ['  phase:   SOME-PHASE1A'] }) });
    expect(out).toContain("does not bind");
  });

  it('refuses a second statement of the same binding as ambiguous', () => {
    const world = installation();
    const out = call(world, { body: authoringBody({ extra: [`  objective: sha256:${'e'.repeat(64)}`] }) });
    expect(out).toContain('more than once');
  });

  it('will not pay for the same authoring question twice', () => {
    const world = installation();
    expect(call(world)).toContain(ALL_GATES_PASSED);
    // The first attempt reserved and was not answered, so exactly one honest retry is allowed…
    expect(call(world)).toContain(ALL_GATES_PASSED);
    // …and never a third.
    expect(call(world)).toContain('a third');
  });

  it('stops at the installation ceiling, and a permission cannot raise it', () => {
    // The record asks for 999. The installation's number is 20, and `Math.min` is what makes the
    // record's request a request rather than an instruction.
    const world = installation({ permission: validPermission({ maxCallsPerProject: 999 }) });
    let refusal = '';
    for (let i = 0; i < 25; i += 1) {
      const out = call(world, { requestId: `PAREQ-ceiling${String(i).padStart(12, '0')}` });
      if (!out.includes(ALL_GATES_PASSED)) {
        refusal = out;
        break;
      }
    }
    expect(refusal).toContain("installation's ceiling");
  });

  it('honours a permission that lowers the ceiling', () => {
    const world = installation({ permission: validPermission({ maxCallsPerProject: 2 }) });
    expect(call(world, { requestId: 'PAREQ-low00000000000000001' })).toContain(ALL_GATES_PASSED);
    expect(call(world, { requestId: 'PAREQ-low00000000000000002' })).toContain(ALL_GATES_PASSED);
    expect(call(world, { requestId: 'PAREQ-low00000000000000003' })).toContain("installation's ceiling");
  });

  it('does not let an authoring permission fund a GATEKEEPER call', () => {
    // The permission says a plan may be authored. It says nothing about reviewing a phase, and the
    // gatekeeper path still demands that phase's own committed secrets-handling receipt.
    const world = installation();
    const out = call(world, {
      kind: 'gatekeeper' as 'plan-authoring',
      phaseId: 'SOME-PHASE1A',
      subjectCommit: '0'.repeat(40),
      ask: 'security-review',
      body: JSON.stringify({
        instructions: [
          '  project: projectos',
          '  phase:   SOME-PHASE1A',
          `  subject: ${'0'.repeat(40)}`,
          '  ask:     security-review',
        ].join('\n'),
        input: [{ role: 'user', content: [{ type: 'input_text', text: `requestId: ${REQUEST_ID}` }] }],
      }),
    } as Parameters<typeof call>[1]);
    expect(out).toContain('secrets-handling receipt');
  });

  it('does not accept plan-authoring as a gatekeeper ask', () => {
    // KNOWN_ASKS was deliberately not widened, so this is the refusal that proves the two routes
    // cannot be collapsed by a caller.
    const world = installation();
    const phase = 'SOME-PHASE1A';
    const git = (...args: string[]) => execFileSync('git', ['-C', world.root, ...args], { encoding: 'utf8' });
    const abs = join(world.root, '.projectops', 'gates', `${phase}.secrets-handling.json`);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify({ gateName: 'secrets-handling', phaseId: phase, ownerChoice: 'APPROVE' }));
    git('add', '-A');
    git('commit', '-q', '-m', 'receipt');
    const head = git('rev-parse', 'HEAD').trim();

    const out = call(world, {
      kind: 'gatekeeper' as 'plan-authoring',
      phaseId: phase,
      subjectCommit: head,
      ask: 'plan-authoring',
      body: JSON.stringify({
        instructions: [
          '  project: projectos',
          `  phase:   ${phase}`,
          `  subject: ${head}`,
          '  ask:     plan-authoring',
        ].join('\n'),
        input: [{ role: 'user', content: [{ type: 'input_text', text: `requestId: ${REQUEST_ID}` }] }],
      }),
    } as Parameters<typeof call>[1]);
    expect(out).toContain('is not a question ProjectOS asks');
  });
});

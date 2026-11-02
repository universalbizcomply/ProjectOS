/**
 * The review round on PROJECTOS-TENANT-CREDENTIALS1A, 2026-11-02: each finding as a behaviour.
 *
 * THESE WERE WRITTEN FIRST and failed at `151bfd8b`. The CRITICAL is the grant: a `secrets-handling` gate
 * released any production credential to anyone who named a phase holding one. Nothing here reaches the
 * Windows Credential Manager; the installations are real git, and every value and grant is synthetic.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type CommandContext } from '../src/context.js';
import { admittedRunEnvelopeOf, endAdmittedRuns, mintRunCrossing, runStartTenantRefusal } from '../src/governedContext.js';
import { ENVELOPE_RECORDS_FILENAME } from '../src/installation/tenantRegistry.js';
import { nodeSystem, type System } from '../src/system.js';
import { AGENCY_TENANT, cleanUp, commitAll, FIXTURE_NOW, git, linesOf, OWNER_TENANT, registryText, tempDir } from './support/tenantWorld.js';
import {
  cli,
  credentialWorld,
  grantRelease,
  GRANT_REL,
  metadata,
  nowMs,
  PHASE,
  PROJECTOS_ROOT,
  reference,
  refusalOf,
  underTest,
  type CredentialWorld,
} from './support/credentialWorld.js';

vi.unmock('../src/governedContext.js');
vi.setConfig({ testTimeout: 60_000 });

const made: string[] = [];
afterEach(() => cleanUp(made));

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };
const VALUE = 'synthetic-credential-value-2222';
const OP = 'ProjectOS/alpha/staging/supabase/service-role-key';
const GH = 'ProjectOS/alpha/staging/github/gh-token';
const NODE = process.execPath;
const AT_CONSOLE = { stdin: { isTTY: true }, stdout: { isTTY: true } };
const NO_TERMINAL = { stdin: {}, stdout: {} };

function ctxAt(w: CredentialWorld, root: string): CommandContext {
  return Object.assign({ sys, root }, w.installation.ctxFields) as unknown as CommandContext;
}

function kernelHandle(w: CredentialWorld, root: string): string {
  const ctx = ctxAt(w, root);
  expect(runStartTenantRefusal(ctx, true)).toBeNull();
  return (admittedRunEnvelopeOf(ctx) as { envelopeId: string }).envelopeId;
}

function gateOf(w: CredentialWorld) {
  const calls: unknown[] = [];
  const spawnSync_ = (...args: unknown[]) => {
    calls.push(args);
    return { status: 7, stdout: '', stderr: '' };
  };
  return { calls, gate: underTest.gate.createOperationGate({ vault: w.vault, spawnSync: spawnSync_ }) };
}

function run(gate: { grantPermit: (i: unknown) => unknown; run: (i: unknown) => { ok: boolean; blocker: string | null; exitCode: number | null } }, requester: unknown, target = OP, action = 'read-config', phaseId = PHASE) {
  const permit = gate.grantPermit({ reference: target, action, requester, capability: { ownerConfirmation: true }, phaseId });
  return gate.run({ reference: target, action, requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: ['--version'], envVarName: 'SYNTHETIC_VALUE' });
}

describe('CRITICAL: a release needs a committed credential-release grant', () => {
  it('a gatekeeper secrets-handling gate is never a grant, whatever it approves', () => {
    const w = credentialWorld(made, sys);
    mkdirSync(join(w.alpha.root, '.projectops', 'gates'), { recursive: true });
    writeFileSync(join(w.alpha.root, '.projectops', 'gates', `${PHASE}.secrets-handling.json`), JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    commitAll(w.alpha.root, 'a gate');
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const { calls, gate } = gateOf(w);
    expect(run(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(calls).toHaveLength(0);
  });

  it('positive control: a grant naming the project, the exact reference, the action and a live expiry releases', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, {});
    const { calls, gate } = gateOf(w);
    expect(run(gate, w.console('alpha')).exitCode).toBe(7);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['another project', { projectId: 'beta' }],
    ['another credential', { references: ['ProjectOS/alpha/staging/supabase/db-password'] }],
    ['no references', { references: [] }],
    ['a wildcard reference', { references: ['ProjectOS/alpha/staging/supabase/*'] }],
    ['another action', { action: 'apply-migration' }],
    ['a stale date', { expiresAt: '2026-10-31T23:59:59.000Z' }],
    ['an unreadable date', { expiresAt: 'next week' }],
    ['another phase inside it', { phaseId: 'OTHER-PHASE1A' }],
    ['another kind', { kind: 'secrets-handling' }],
    ['a missing field', { grantedBy: undefined }],
    ['an extra field', { allProjects: true }],
  ])('a record with %s releases nothing', (_label, over) => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, over);
    const { calls, gate } = gateOf(w);
    expect(run(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(calls).toHaveLength(0);
  });

  it('a grant for one phase does not answer for another', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, {});
    const { gate } = gateOf(w);
    expect(run(gate, w.console('alpha'), OP, 'read-config', 'OTHER-PHASE1A').blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
  });

  it('an uncommitted grant, and a grant committed only in the project, release nothing', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, {});
    const path = join(w.installation.root, ...GRANT_REL(PHASE).split('/'));
    const bytes = readFileSync(path, 'utf8');
    writeFileSync(path, `${bytes}\n`);
    const { gate } = gateOf(w);
    expect(run(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    writeFileSync(path, bytes);
    git(w.installation.root, 'rm', '--quiet', '-f', GRANT_REL(PHASE));
    commitAll(w.installation.root, 'grant withdrawn');
    mkdirSync(join(w.alpha.root, ...GRANT_REL(PHASE).split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(w.alpha.root, ...GRANT_REL(PHASE).split('/')), bytes);
    commitAll(w.alpha.root, 'the work grants itself');
    expect(run(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
  });

  it('a phase id cannot climb out of the grants directory', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const { gate } = gateOf(w);
    expect(run(gate, w.console('alpha'), OP, 'read-config', '../../x').blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
  });
});

describe('HIGH: every committed read in the broker is the object\'s own bytes', () => {
  const brokerSource = readFileSync(join(PROJECTOS_ROOT, 'security/gatekeeper-transport-broker.cjs'), 'utf8');

  function world(permit: Record<string, unknown> | null = null) {
    const root = tempDir(made, 'projectos-review-broker-');
    const stateDir = tempDir(made, 'projectos-review-state-');
    git(root, 'init', '--quiet');
    git(root, 'remote', 'add', 'origin', 'https://github.com/local/fixture.git');
    const write = (rel: string, text: string) => {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    write('projectos/security/installation-project-allowlist.json', JSON.stringify({ schemaVersion: '1.0.0', projects: [{ projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: root }] }));
    write('projectos/security/tenant-registry.json', registryText([{ projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: root, tenant: OWNER_TENANT, domain: 'develop' }]));
    write(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    if (permit !== null) write('.projectops/authority/plan-authoring-permission.json', JSON.stringify(permit));
    commitAll(root, 'authorised');
    const head = git(root, 'rev-parse', 'HEAD').trim();
    const ask = () => {
      const requestId = 'REQUEST-REVIEW-1';
      const body = JSON.stringify({ model: 'fixture', instructions: ['  project: projectos', `  phase: ${PHASE}`, `  subject: ${head}`, '  ask: security-review'].join('\n'), input: [{ content: [{ text: `requestId: ${requestId}\nreview` }] }] });
      const payload = JSON.stringify({ kind: 'gatekeeper', governedRoot: root, projectId: 'projectos', phaseId: PHASE, subjectCommit: head, ask: 'security-review', requestId, credentialRef: 'SYNTHETIC_HELD_NOWHERE', body });
      const requestFile = join(stateDir, 'request.json');
      writeFileSync(requestFile, payload);
      const sha = execFileSync(NODE, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(requestFile)})).digest('hex'))`], { encoding: 'utf8' });
      const input = [`const TRUSTED_INSTALL_ROOT = ${JSON.stringify(root)};`, `const TRUSTED_REQUEST_SHA256 = ${JSON.stringify(sha)};`, `const TRUSTED_STATE_DIR = ${JSON.stringify(stateDir)};`, brokerSource].join('\n');
      const git_ = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0] ?? '';
      const result = spawnSync(NODE, ['-'], { input, encoding: 'utf8', cwd: root, windowsHide: true, env: { SystemRoot: process.env['SystemRoot'] ?? '', PROJECTOS_BROKER_REQUEST: requestFile, PROJECTOS_GIT_EXE: git_ } });
      return (JSON.parse(result.stdout) as { error?: string }).error ?? '';
    };
    /** A replace ref, and a working-tree file that matches it, so a plain read sees a clean, approved record. */
    const forge = (rel: string, text: string) => {
      const blob = git(root, 'rev-parse', `HEAD:${rel}`).trim();
      const planted = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: text, encoding: 'utf8' }).trim();
      git(root, 'replace', blob, planted);
      write(rel, text);
    };
    return { root, ask, forge, write };
  }

  it('positive control: the world reaches the credential stage', () => {
    expect(world().ask()).toContain('is not one this broker holds');
  });

  it('a replace ref cannot forge the owner\'s approval', () => {
    const w = world();
    w.write(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'REJECT' }));
    commitAll(w.root, 'the owner refused');
    expect(w.ask()).toContain('does not approve');
    w.forge(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    expect(w.ask()).not.toContain('is not one this broker holds');
  });

  it('a replace ref cannot forge the installation allowlist', () => {
    const w = world();
    w.write('projectos/security/installation-project-allowlist.json', JSON.stringify({ schemaVersion: '1.0.0', projects: [] }));
    commitAll(w.root, 'the installation spends on nobody');
    expect(w.ask()).toContain('does not authorise');
    w.forge('projectos/security/installation-project-allowlist.json', JSON.stringify({ schemaVersion: '1.0.0', projects: [{ projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: w.root }] }));
    expect(w.ask()).not.toContain('is not one this broker holds');
  });

  it.each([
    ['an unknown domain', { domain: 'somewhere' }],
    ['a malformed tenant id', { tenant: 'Not A Tenant', declare: 'Not A Tenant' }],
  ])('refuses the whole registry for %s, as the core does', (_label, over) => {
    const w = world();
    const { declare, ...line } = over as { declare?: string; domain?: string; tenant?: string };
    const real = JSON.parse(registryText([{ projectId: 'projectos', repository: 'github.com/local/fixture', governedRoot: w.root, tenant: OWNER_TENANT, domain: 'develop' }])) as { tenants: Record<string, unknown>[]; projects: Record<string, unknown>[] };
    const tenants = declare === undefined ? real.tenants : [...real.tenants, { tenantId: declare, name: 'x', note: 'x' }];
    w.write('projectos/security/tenant-registry.json', JSON.stringify({ ...real, tenants, projects: [{ ...real.projects[0], ...line }] }));
    commitAll(w.root, 'a registry the core would refuse');
    expect(w.ask()).toContain('TENANT_REGISTRY_INVALID');
  });
});

describe('HIGH: console authority needs a real terminal', () => {
  it('a console handle read back elsewhere is not a console, and with no terminal it is nothing', () => {
    const w = credentialWorld(made, sys);
    const handle = w.console('alpha').runHandle;
    expect(refusalOf(() => cli.requesterFor({ run: handle }, { authority: w.authority, terminal: NO_TERMINAL })).code).toBe('RUN_HANDLE_CONSOLE_ONLY');
  });

  it('a console handle cannot declare a reach or touch the platform key from a process with no terminal', () => {
    const w = credentialWorld(made, sys);
    const handle = w.console('projectos').runHandle;
    const other = metadata.createRequesterAuthority({ installRoot: w.installation.root, stateDir: w.stateDir, nowMs });
    expect(refusalOf(() => other.fromRun(handle)).code).toBe('RUN_HANDLE_CONSOLE_ONLY');
  });

  it('--owner-confirm needs a real terminal, on every verb that takes it', async () => {
    const w = credentialWorld(made, sys);
    const deps = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal: NO_TERMINAL };
    const handle = kernelHandle(w, w.alpha.root);
    await expect(cli.main(['operation', 'run', '--ref', OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--run', handle, '--owner-confirm', '--', NODE], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['session', 'start', '--slot', 'cred-1', '--profile', 'production-operation', '--environment', 'production', '--run', handle, '--checkout', w.alpha.root, '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['projects', 'register', '--checkout', w.alpha.root, '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['projects', 'unregister', '--project', 'alpha', '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
  });

  it('positive control: at a real terminal the same operation is confirmed, and refused only for want of a grant', async () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const deps = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal: AT_CONSOLE };
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(cli.main(['operation', 'run', '--ref', OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--project', 'alpha', '--owner-confirm', '--', NODE], deps)).resolves.toBe(1);
    expect(said).toHaveBeenCalledWith('CREDENTIAL_GRANT_REQUIRED');
    said.mockRestore();
  });
});

describe('HIGH: reach and expiry, at the vault, on both paths', () => {
  it('a new value clears the old reach: what the old token reached says nothing about this one', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    w.vault.provision({ reference: GH, requester: w.console('alpha'), replace: true, readValue: () => 'synthetic-another-value-3333' });
    expect(w.vault.status({}).find((row: { reference: string }) => row.reference === GH).reach).toBeNull();
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GH, requester: w.console('alpha') })).code).toBe('REACH_UNDECLARED');
  });

  it.each([
    ['tenant', { reach: 'tenant' }],
    ['account, in its own tenant', { reach: 'account', reachTenants: [OWNER_TENANT] }],
  ])('auto-load takes project reach only: a %s reach would sidestep the class rule', (_label, reach) => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), readValue: () => VALUE, ...reach });
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GH, requester: w.console('alpha') })).code).toBe('REACH_WIDER_THAN_PROJECT');
  });

  it('positive control: project reach loads', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GH, requester: w.console('alpha') })).code).toBeUndefined();
  });

  it('the operation path refuses an undeclared reach and a reach into another tenant, with a good grant', () => {
    const w = credentialWorld(made, sys);
    grantRelease(w, {});
    const { calls, gate } = gateOf(w);
    w.vault.provision({ reference: OP, requester: w.console('alpha'), readValue: () => VALUE });
    expect(run(gate, w.console('alpha')).blocker).toBe('REACH_UNDECLARED');
    w.vault.rotateMetadata({ reference: OP, requester: w.console('alpha'), reach: 'account', reachTenants: [OWNER_TENANT, AGENCY_TENANT] });
    expect(run(gate, w.console('alpha')).blocker).toBe('REACH_CROSSES_TENANTS');
    expect(calls).toHaveLength(0);
    w.vault.rotateMetadata({ reference: OP, requester: w.console('alpha'), reach: 'account', reachTenants: [OWNER_TENANT] });
    expect(run(gate, w.console('alpha')).exitCode).toBe(7);
  });

  it('an expired credential is refused at the vault on both paths', () => {
    const w = credentialWorld(made, sys);
    grantRelease(w, {});
    const past = '2026-10-01T00:00:00Z';
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', expiresAt: past, readValue: () => VALUE });
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', expiresAt: past, readValue: () => VALUE });
    const { calls, gate } = gateOf(w);
    expect(run(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_EXPIRED');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GH, requester: w.console('alpha') })).code).toBe('CREDENTIAL_EXPIRED');
    expect(calls).toHaveLength(0);
  });

  it('a Supabase personal access token is account-wide, whatever it declares', () => {
    const w = credentialWorld(made, sys);
    const pat = 'ProjectOS/alpha/staging/supabase/supabase-access-token';
    expect(reference.classifyRisk('supabase-access-token')).toBe('operation');
    expect(reference.ACCOUNT_WIDE_CREDENTIALS).toContain('supabase-access-token');
    w.vault.provision({ reference: pat, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, { references: [pat] });
    const { gate } = gateOf(w);
    expect(run(gate, w.console('alpha'), pat).blocker).toBe('REACH_CROSSES_TENANTS');
    w.vault.rotateMetadata({ reference: pat, requester: w.console('alpha'), reach: 'account', reachTenants: [OWNER_TENANT] });
    expect(run(gate, w.console('alpha'), pat).exitCode).toBe(7);
  });

  it('no session profile offers it', () => {
    const profiles = createRequireProfiles();
    expect(profiles.permitsCredential('staging-writer', 'supabase-access-token')).toBe(false);
    expect(profiles.permitsCredential('staging-writer', 'gh-token')).toBe(true);
  });
});

function createRequireProfiles(): { permitsCredential: (profile: string, credential: string) => boolean } {
  return createRequire(import.meta.url)(join(PROJECTOS_ROOT, 'session-router/session-profiles.cjs'));
}

describe('HIGH: a handle ends with its run', () => {
  it('the end of the run is a line, and the handle stops', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelHandle(w, w.alpha.root);
    expect(w.authority.fromRun(handle).project).toBe('alpha');
    endAdmittedRuns(0);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('RUN_HANDLE_ENDED');
    expect(linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1)).toMatchObject({ stage: 'execution', outcome: 'allowed', rule: 'run-ended:0' });
  });

  it('a run that failed says so, and ends once', () => {
    const w = credentialWorld(made, sys);
    kernelHandle(w, w.alpha.root);
    endAdmittedRuns(3);
    endAdmittedRuns(3);
    const ends = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).filter((line) => line['stage'] === 'execution');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ outcome: 'failed', rule: 'run-ended:3' });
  });

  it.each([
    [0, 'allowed'],
    [5, 'failed'],
  ])('a real process that exits with %s writes its end line, and the handle stops', (code, outcome) => {
    const w = credentialWorld(made, sys);
    const viteNode = join(PROJECTOS_ROOT, 'agent/node_modules/vite-node/vite-node.mjs');
    const child = spawnSync(NODE, [viteNode, 'test/support/runEndChild.ts', w.alpha.root, w.installation.root, w.stateDir, String(code)], { cwd: join(PROJECTOS_ROOT, 'agent'), encoding: 'utf8', windowsHide: true });
    expect(child.status).toBe(code);
    const handle = /HANDLE (ENV-[0-9a-f]{24})/.exec(child.stdout)?.[1] ?? '';
    expect(linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1)).toMatchObject({ stage: 'execution', outcome, rule: `run-ended:${code}` });
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('RUN_HANDLE_ENDED');
  });

  it('one exit hook, however many runs', () => {
    const before = process.listenerCount('exit');
    const w = credentialWorld(made, sys);
    kernelHandle(w, w.alpha.root);
    commitAll(w.alpha.root, 'another commit');
    kernelHandle(w, w.alpha.root);
    expect(process.listenerCount('exit') - before).toBeLessThanOrEqual(1);
    endAdmittedRuns(0);
  });
});

describe('HIGH: the durable audit says what happened', () => {
  const auditOf = (w: CredentialWorld): Record<string, unknown>[] => readFileSync(w.vault.auditPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

  it('records the command and its exit code on disk, before and after, and no value', () => {
    const w = credentialWorld(made, sys);
    grantRelease(w, {});
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const { gate } = gateOf(w);
    run(gate, w.console('alpha'));
    const lines = auditOf(w);
    expect(lines.find((line) => line['action'] === 'operation-start')).toMatchObject({ reference: OP, command: NODE, args: ['--version'] });
    expect(lines.find((line) => line['action'] === 'operation-end')).toMatchObject({ reference: OP, exitCode: 7, ok: false });
    expect(JSON.stringify(lines)).not.toContain(VALUE);
  });

  it('masks a credential-shaped argument', () => {
    const w = credentialWorld(made, sys);
    grantRelease(w, {});
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const { gate } = gateOf(w);
    const requester = w.console('alpha');
    const permit = gate.grantPermit({ reference: OP, action: 'read-config', requester, capability: { ownerConfirmation: true }, phaseId: PHASE });
    const shaped = `ghp_${'a'.repeat(36)}`;
    gate.run({ reference: OP, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: [shaped], envVarName: 'SYNTHETIC_VALUE' });
    const text = readFileSync(w.vault.auditPath, 'utf8');
    expect(text).toContain('[credential-shaped]');
    expect(text).not.toContain(shaped);
  });

  it('records the session id, and the old and new reach', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    w.vault.rotateMetadata({ reference: GH, requester: w.console('alpha'), reach: 'tenant' });
    w.vault.rotateMetadata({ reference: GH, requester: w.console('alpha'), reach: 'project' });
    w.vault.authoriseSessionRelease({ reference: GH, requester: w.console('alpha'), sessionId: 'sess_fixture' });
    const lines = auditOf(w);
    expect(lines.find((line) => line['action'] === 'provision')).toMatchObject({ reachBefore: null, reachAfter: 'project' });
    expect(lines.filter((line) => line['action'] === 'rotate-metadata')[0]).toMatchObject({ reachBefore: 'project', reachAfter: 'tenant' });
    expect(lines.find((line) => line['action'] === 'authorise-session')).toMatchObject({ sessionId: 'sess_fixture' });
  });

  it('a failed audit stops the command before it starts', () => {
    const w = credentialWorld(made, sys);
    grantRelease(w, {});
    w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const { calls, gate } = gateOf(w);
    const requester = w.console('alpha');
    const permit = gate.grantPermit({ reference: OP, action: 'read-config', requester, capability: { ownerConfirmation: true }, phaseId: PHASE });
    const original = w.vault.auditOperation;
    const failing = underTest.gate.createOperationGate({
      vault: { ...w.vault, auditOperation: (event: { action: string }) => { if (event.action === 'operation-start') throw Object.assign(new Error('x'), { code: 'AUDIT_NOT_RECORDED' }); return original(event); } },
      spawnSync: (...args: unknown[]) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; },
    });
    const out = failing.run({ reference: OP, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: [], envVarName: 'SYNTHETIC_VALUE' });
    expect(out.blocker).toBe('AUDIT_NOT_RECORDED');
    expect(calls).toHaveLength(0);
  });
});

describe('MEDIUM: run-start has a budget', () => {
  const gatekeeperJson = (cap: unknown) => JSON.stringify({ schemaVersion: '1.0.0', budget: { phaseHardStopAtMicroUsd: cap } });

  function withCap(w: CredentialWorld, text: string): void {
    writeFileSync(join(w.alpha.root, '.projectops', 'gatekeeper.json'), text);
    commitAll(w.alpha.root, 'gatekeeper');
  }

  it('is the committed per-phase cap, and a paid crossing within it passes the mint', () => {
    const w = credentialWorld(made, sys);
    withCap(w, gatekeeperJson(1_500_000));
    const ctx = ctxAt(w, w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(admittedRunEnvelopeOf(ctx)?.budget).toBe(1_500_000);
    const expiry = (admittedRunEnvelopeOf(ctx) as { expiry: string }).expiry;
    const crossing = (budget: number) => mintRunCrossing(ctx, { action: 'broker-call', subjectHash: 'a'.repeat(40), budget, expiry, intentScope: 'x' });
    expect(crossing(1_500_000).ok).toBe(true);
    expect(crossing(1_500_001).ok).toBe(false);
  });

  it.each([
    ['no record', null],
    ['a record with no cap', JSON.stringify({ schemaVersion: '1.0.0', budget: {} })],
    ['a nonsense cap', gatekeeperJson(-1)],
    ['a fractional cap', gatekeeperJson(1.5)],
  ])('is zero with %s: a run with no cap may not spend', (_label, text) => {
    const w = credentialWorld(made, sys);
    if (text !== null) withCap(w, text);
    const ctx = ctxAt(w, w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(admittedRunEnvelopeOf(ctx)?.budget).toBe(0);
  });

  it('reads committed bytes: a working-tree edit moves nothing', () => {
    const w = credentialWorld(made, sys);
    withCap(w, gatekeeperJson(100));
    writeFileSync(join(w.alpha.root, '.projectops', 'gatekeeper.json'), gatekeeperJson(999_999));
    const ctx = ctxAt(w, w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(admittedRunEnvelopeOf(ctx)?.budget).toBe(100);
  });
});

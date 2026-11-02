/**
 * PROJECTOS-TENANT-CREDENTIALS1A: who may have a credential, asked of a kernel-issued run handle.
 *
 * REAL GIT, REAL RECORDS, SYNTHETIC SECRETS. No test here reaches the Windows Credential Manager. The runs
 * that matter are minted by the real kernel, `runStartTenantRefusal`, and read back by the CommonJS side.
 *
 * A REFUSAL COUNTS ONLY BESIDE ITS POSITIVE CONTROL, and each asserts the rule's own code. A refusal that a
 * fail-closed default, or another rule, would have produced is not a proof of this one.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deriveIdempotencyKey, parseEnvelope, parseTenantRegistry } from '@projectos/core';
import type { CommandContext } from '../src/context.js';
import { admittedRunEnvelopeOf, runStartTenantRefusal } from '../src/governedContext.js';
import { ENVELOPE_RECORDS_FILENAME } from '../src/installation/tenantRegistry.js';
import { nodeSystem, type System } from '../src/system.js';
import { AGENCY_TENANT, cleanUp, commitAll, FIXTURE_NOW, git, holdRecordLock, linesOf, OWNER_TENANT, registryText, tempDir } from './support/tenantWorld.js';
import {
  cli,
  credentialWorld,
  grantPhase,
  memory,
  metadata,
  nowMs,
  PHASE,
  projectRegistryModule,
  PROJECTOS_ROOT,
  reference,
  refusalOf,
  routerModule,
  underTest,
  vaultModule,
  type CredentialWorld,
  type Project,
} from './support/credentialWorld.js';

vi.unmock('../src/governedContext.js');

// EACH WORLD IS FIVE REAL REPOSITORIES, and the suite runs beside everything else.
vi.setConfig({ testTimeout: 60_000 });

const made: string[] = [];
afterEach(() => cleanUp(made));

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };

const VALUE = 'synthetic-credential-value-0000';
const ALPHA_GH = 'ProjectOS/alpha/staging/github/gh-token';
const GAMMA_GH = 'ProjectOS/gamma/staging/github/gh-token';
const ALPHA_OP = 'ProjectOS/alpha/staging/supabase/service-role-key';
const GAMMA_OP = 'ProjectOS/gamma/staging/supabase/service-role-key';
const OWNER_SECRET = 'ProjectOS/tenant.owner-personal/staging/supabase/service-role-key';
const PLATFORM = 'ProjectOS/projectos/development/openai/gatekeeper-api-key';

function ctxAt(w: CredentialWorld, root: string): CommandContext {
  return Object.assign({ sys, root }, w.installation.ctxFields) as unknown as CommandContext;
}

/** A run the real kernel admitted at this root: its handle is the id on the durable line. */
function kernelRun(w: CredentialWorld, root: string): string {
  const ctx = ctxAt(w, root);
  expect(runStartTenantRefusal(ctx, true)).toBeNull();
  const envelope = admittedRunEnvelopeOf(ctx);
  if (envelope === null) throw new Error('the kernel admitted no run');
  return envelope.envelopeId;
}

function seed(w: CredentialWorld, reference_: string, project: string, extra: Record<string, unknown> = {}): void {
  w.vault.provision({ reference: reference_, requester: w.console(project), readValue: () => VALUE, ...extra });
}

function fakeSpawn(): { readonly calls: unknown[]; readonly spawnSync: (...args: unknown[]) => unknown } {
  const calls: unknown[] = [];
  return { calls, spawnSync: (...args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; } };
}

const NODE = process.execPath;

function runThrough(w: CredentialWorld, gate: { grantPermit: (i: unknown) => unknown; run: (i: unknown) => { ok: boolean; blocker: string | null } }, target: string, requester: unknown) {
  const permit = gate.grantPermit({ reference: target, action: 'read-config', requester, capability: { ownerConfirmation: true }, phaseId: PHASE });
  return gate.run({ reference: target, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: ['--version'], envVarName: 'SYNTHETIC_VALUE' });
}

describe('the requester is a kernel-issued run handle', () => {
  it('survives the process boundary, and the directory a process stands in counts for nothing', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    // ANOTHER PROCESS, STANDING IN ANOTHER TENANT'S ROOT, holding only the handle.
    const program = [
      `const { createRequesterAuthority } = require(${JSON.stringify(join(PROJECTOS_ROOT, 'credentials/credential-metadata.cjs'))});`,
      `const authority = createRequesterAuthority({ installRoot: ${JSON.stringify(w.installation.root)}, stateDir: ${JSON.stringify(w.stateDir)} , nowMs: () => ${Date.parse(FIXTURE_NOW)} });`,
      `const requester = authority.fromRun(process.argv[1]);`,
      `process.stdout.write(JSON.stringify(requester));`,
    ].join('\n');
    const out = execFileSync(NODE, ['-e', program, handle], { cwd: w.gamma.root, encoding: 'utf8' });
    expect(JSON.parse(out)).toMatchObject({ tenant: OWNER_TENANT, project: 'alpha', domain: 'develop', via: 'governed-root', runHandle: handle });
  });

  it('holds nothing but what the line and the registry say: a tenant named in text, argv or the environment changes nothing', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    process.env['PROJECTOS_TENANT'] = AGENCY_TENANT;
    process.env['TENANT'] = AGENCY_TENANT;
    try {
      const requester = w.authority.fromRun(handle);
      expect(requester.tenant).toBe(OWNER_TENANT);
      const viaCli = cli.requesterFor({ run: handle, tenant: AGENCY_TENANT, project: 'gamma' }, { authority: w.authority });
      expect(viaCli).toMatchObject({ tenant: OWNER_TENANT, project: 'alpha' });
    } finally {
      delete process.env['PROJECTOS_TENANT'];
      delete process.env['TENANT'];
    }
  });

  it.each([
    ['a project id', 'alpha', 'REQUESTER_REQUIRED'],
    ['a tenant id', OWNER_TENANT, 'REQUESTER_REQUIRED'],
    ['a JWT', ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJvd25lciJ9', '.', 'c2lnbmF0dXJl'].join(''), 'REQUESTER_REQUIRED'],
    ['an OAuth bearer', 'Bearer synthetic-oauth-identity', 'REQUESTER_REQUIRED'],
    ['a handle shape with no line', `ENV-${'0'.repeat(24)}`, 'RUN_HANDLE_UNKNOWN'],
  ])('refuses %s as a handle', (_label, handle, code) => {
    const w = credentialWorld(made, sys);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe(code);
  });

  it('refuses a plain string and a perfect copy at every door, and a live requester passes', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const live = w.console('alpha');
    expect(w.vault.present({ reference: ALPHA_GH, requester: live })).toBe(true);
    for (const forged of ['alpha', OWNER_TENANT, { ...live }, JSON.parse(JSON.stringify(live)), null, undefined]) {
      for (const door of [
        () => w.vault.present({ reference: ALPHA_GH, requester: forged }),
        () => w.vault.remove({ reference: ALPHA_GH, requester: forged }),
        () => w.vault.provision({ reference: ALPHA_GH, requester: forged, replace: true, readValue: () => VALUE }),
        () => w.vault.rotateMetadata({ reference: ALPHA_GH, requester: forged }),
        () => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester: forged }),
        () => w.vault.authoriseOperationRelease({ reference: ALPHA_GH, requester: forged, capability: { ownerConfirmation: true } }),
      ]) {
        expect(refusalOf(door).code).toBe('REQUESTER_REQUIRED');
      }
    }
    expect(w.store.get(ALPHA_GH)).toBe(VALUE);
  });

  it('refuses the old call shape: a bare projectId is not a requester', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, projectId: 'alpha' })).code).toBe('REQUESTER_REQUIRED');
  });

  it('refuses a run that has recorded its end, a line that says it ended, and a second line under one handle', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const file = join(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    const [line] = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(w.authority.fromRun(handle).project).toBe('alpha');
    appendFileSync(file, `${JSON.stringify({ ...line })}\n`);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('RUN_HANDLE_UNKNOWN');
    const next = kernelRunAgain(w);
    const nextLine = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1);
    appendFileSync(file, `${JSON.stringify({ ...nextLine, stage: 'execution', outcome: 'refused' })}\n`);
    expect(refusalOf(() => w.authority.fromRun(next)).code).toBe('RUN_HANDLE_ENDED');
  });

  function kernelRunAgain(w: CredentialWorld): string {
    commitAll(w.alpha.root, 'a new commit, so a new run');
    return kernelRun(w, w.alpha.root);
  }

  it.each([
    ['another action', { envelope: { action: 'project-selection' } }],
    ['a refused admission', { outcome: 'refused' }],
    ['a child envelope', { envelope: { parentEnvelopeId: `ENV-${'1'.repeat(24)}` } }],
    ['a route the kernel does not use', { via: 'somewhere-else' }],
  ])('a line that is %s is no handle, though every other field is a real run\'s', (_label, over) => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const file = join(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    const line = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME)[0] as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify({ ...line, ...over, envelope: { ...(line['envelope'] as object), ...(over as { envelope?: object }).envelope } })}\n`);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('RUN_HANDLE_UNKNOWN');
  });

  it('refuses a run past its window, at minting and again at release', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const late = metadata.createRequesterAuthority({ installRoot: w.installation.root, stateDir: w.stateDir, nowMs: () => nowMs() + 13 * 3_600_000 });
    expect(refusalOf(() => late.fromRun(handle)).code).toBe('RUN_HANDLE_EXPIRED');

    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const live = w.authority.fromRun(handle);
    const lateVault = vaultModule.createCredentialVault({ store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs: () => nowMs() + 13 * 3_600_000 });
    expect(refusalOf(() => lateVault.authoriseSessionRelease({ reference: ALPHA_GH, requester: live })).code).toBe('REQUESTER_REQUIRED');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester: live })).code).toBeUndefined();
  });

  it('holds the line to the registry: a tenant moved since, or a line written by hand, stops', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const lines = readFileSync(join(w.stateDir, ENVELOPE_RECORDS_FILENAME), 'utf8');
    writeFileSync(join(w.stateDir, ENVELOPE_RECORDS_FILENAME), lines.split(`"tenant":"${OWNER_TENANT}"`).join(`"tenant":"${AGENCY_TENANT}"`));
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('TENANT_MISMATCH');
  });

  it('reads the registry from committed bytes: dirty, unconfirmed, replaced or contradictory all refuse', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    expect(w.authority.fromRun(handle).tenant).toBe(OWNER_TENANT);

    const registryPath = join(w.installation.root, 'projectos', 'security', 'tenant-registry.json');
    const held = readFileSync(registryPath);
    writeFileSync(registryPath, `${held.toString('utf8')}\n`);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('TENANT_REGISTRY_UNREADABLE');
    writeFileSync(registryPath, held);

    // A COMMIT ALONE MOVES NOTHING: a new blob has no receipt.
    w.installation.commitLines([]);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe('TENANT_REGISTRY_NO_RECEIPT');
  });

  it('does not read through a replace ref: the blob must hash to its bytes', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const root = w.installation.root;
    const blob = w.installation.blob();
    const moved = readFileSync(join(root, 'projectos', 'security', 'tenant-registry.json'), 'utf8').split(AGENCY_TENANT).join('moved-away');
    const planted = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: moved, encoding: 'utf8' }).trim();
    git(root, 'replace', blob, planted);
    expect(git(root, 'show', `HEAD:projectos/security/tenant-registry.json`)).toContain('moved-away');
    expect(w.authority.fromRun(handle).tenant).toBe(OWNER_TENANT);
  });

  it.each([
    ['a duplicate project', (lines: Record<string, unknown>[]) => [...lines, { ...lines[0] }], 'TENANT_REGISTRY_DUPLICATE'],
    ['a wildcard', (lines: Record<string, unknown>[]) => [{ ...lines[0], governedRoot: 'C:/dev/*' }, ...lines.slice(1)], 'TENANT_REGISTRY_WILDCARD'],
    ['a reserved project id, in any case', (lines: Record<string, unknown>[]) => [...lines, { ...lines[0], projectId: 'TENANT.Stray', repository: 'github.com/fixture/stray', governedRoot: 'C:/dev/stray' }], 'TENANT_REGISTRY_RESERVED_ID'],
    ['an undeclared tenant', (lines: Record<string, unknown>[]) => [{ ...lines[0], tenant: 'nobody-here' }, ...lines.slice(1)], 'TENANT_REGISTRY_INVALID'],
    ['one root inside another', (lines: Record<string, unknown>[]) => [...lines, { ...lines[0], projectId: 'inner', repository: 'github.com/fixture/inner', governedRoot: `${String(lines[0]?.['governedRoot'])}/inner` }], 'TENANT_REGISTRY_NESTED_ROOT'],
  ])('refuses the whole registry for %s, even for a perfect line', (_label, mutate, code) => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const registry = JSON.parse(readFileSync(join(w.installation.root, 'projectos', 'security', 'tenant-registry.json'), 'utf8')) as { projects: Record<string, unknown>[] };
    w.installation.commitRegistryText(`${JSON.stringify({ ...registry, projects: mutate(registry.projects) }, null, 2)}\n`);
    w.installation.confirm(sys);
    expect(refusalOf(() => w.authority.fromRun(handle)).code).toBe(code);
    // AND THE CORE AGREES, so this copy of the rule has not drifted from the one it repeats.
    const parsed = parseTenantRegistry({ ...registry, projects: mutate(registry.projects) });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.problems.map((problem) => problem.code)).toContain(code);
  });

  it('reads the real committed registry whole, and the core agrees', () => {
    const w = credentialWorld(made, sys);
    const realBytes = readFileSync(join(PROJECTOS_ROOT, 'security/tenant-registry.json'), 'utf8');
    w.installation.commitRegistryText(realBytes);
    w.installation.confirm(sys);
    expect(parseTenantRegistry(JSON.parse(realBytes)).ok).toBe(true);
    expect(w.console('seo-agency')).toMatchObject({ tenant: AGENCY_TENANT, domain: 'business' });
    expect(w.console('polygo')).toMatchObject({ tenant: OWNER_TENANT });
  });

  it('a console run is a real run: it is one line the core can read, and it needs a listed project', () => {
    const w = credentialWorld(made, sys);
    const requester = w.console('gamma');
    expect(requester).toMatchObject({ tenant: AGENCY_TENANT, project: 'gamma', via: 'console' });
    const line = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1) as { envelope: Record<string, unknown>; via: string };
    expect(parseEnvelope(line.envelope).ok).toBe(true);
    expect(line.via).toBe('console');
    expect(line.envelope['idempotencyKey']).toBe(deriveIdempotencyKey({ tenant: AGENCY_TENANT, project: 'gamma', action: 'run-start', subjectHash: String(line.envelope['subjectHash']), intentScope: `console-run:${requester.runHandle}` }));
    expect(refusalOf(() => w.console('not-listed')).code).toBe('TENANT_UNKNOWN');
  });

  it('refuses when the record cannot be written, and writes under the kernel\'s own lock', () => {
    const w = credentialWorld(made, sys);
    holdRecordLock(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(refusalOf(() => w.console('alpha')).code).toBe('ENVELOPE_NOT_RECORDED');
  });

  it('rotates past the size, as the kernel does, and a run in a rotated file is still found', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    const file = join(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    appendFileSync(file, `${'x'.repeat(1_100_000)}\n`);
    w.console('beta');
    const names = readdirSync(w.stateDir).filter((name) => name.startsWith(ENVELOPE_RECORDS_FILENAME));
    expect(names.length).toBe(2);
    expect(w.authority.fromRun(handle).project).toBe('alpha');
  });

  it('a state directory or installation that cannot be established refuses', () => {
    const none = metadata.createRequesterAuthority({ installRoot: null, stateDir: null });
    expect(refusalOf(() => none.fromRun(`ENV-${'a'.repeat(24)}`)).code).toBe('TENANT_REGISTRY_UNREADABLE');
  });
});

describe('the operation path', () => {
  function gateFor(w: CredentialWorld, vault = w.vault) {
    const spawn = fakeSpawn();
    return { spawn, gate: underTest.gate.createOperationGate({ vault, spawnSync: spawn.spawnSync }) };
  }

  /**
   * THE TEST THAT FAILS ON THE CODE BEFORE THIS PHASE. Run with `CRED_UNDER_TEST` at the old tree, the old
   * gate is handed the same requester and permit, compares the reference with itself, and starts the
   * command with another project's secret in its environment. That is the assertion that fails.
   */
  it('refuses a requester outside the reference\'s project, and runs nothing', () => {
    const w = credentialWorld(made, sys);
    const store = memory.createMemoryCredentialStore({ acknowledgedNonPersistent: true });
    const vault = underTest.vault.createCredentialVault({ store, stateDir: join(w.stateDir, 'operation-vault'), nowMs });
    grantPhase(w.gamma);
    grantPhase(w.beta);
    store.set(GAMMA_OP, VALUE);
    const { spawn, gate } = gateFor(w, vault);
    const outsider = w.authority.fromRun(kernelRun(w, w.beta.root));
    const result = runThrough(w, gate, GAMMA_OP, outsider);
    expect(spawn.calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe('CROSS_PROJECT_REFUSED');
  });

  it('positive control: the same call from the project\'s own run starts the command', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.alpha);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    const result = runThrough(w, gate, ALPHA_OP, w.authority.fromRun(kernelRun(w, w.alpha.root)));
    expect(result.ok).toBe(true);
    expect(spawn.calls).toHaveLength(1);
  });

  it('a project in the same tenant is still another project', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.beta);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    expect(runThrough(w, gate, ALPHA_OP, w.console('beta')).blocker).toBe('CROSS_PROJECT_REFUSED');
    expect(spawn.calls).toHaveLength(0);
  });

  it('refuses a plain string: no permit is minted for one, and a stolen permit does not make one', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.alpha);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    expect(refusalOf(() => gate.grantPermit({ reference: ALPHA_OP, action: 'read-config', requester: 'alpha', capability: { ownerConfirmation: true }, phaseId: PHASE })).message).toContain('REQUESTER REQUIRED');
    const permit = gate.grantPermit({ reference: ALPHA_OP, action: 'read-config', requester: w.console('alpha'), capability: { ownerConfirmation: true }, phaseId: PHASE });
    const result = gate.run({ reference: ALPHA_OP, action: 'read-config', requester: 'alpha', permit, capability: { ownerConfirmation: true }, command: NODE, args: [], envVarName: 'SYNTHETIC_VALUE' });
    expect(result.blocker).toBe('REQUESTER_REQUIRED');
    expect(spawn.calls).toHaveLength(0);
  });

  it('a permit is for one run: another run of the same project cannot spend it', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.alpha);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    const permit = gate.grantPermit({ reference: ALPHA_OP, action: 'read-config', requester: w.console('alpha'), capability: { ownerConfirmation: true }, phaseId: PHASE });
    const result = gate.run({ reference: ALPHA_OP, action: 'read-config', requester: w.console('alpha'), permit, capability: { ownerConfirmation: true }, command: NODE, args: [], envVarName: 'SYNTHETIC_VALUE' });
    expect(result.blocker).toBe('OWNER PERMIT REQUIRED');
    expect(spawn.calls).toHaveLength(0);
  });

  it('the grant is the phase\'s committed owner record: a tenant receipt is not one, and an uncommitted record is not one', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    const requester = w.console('alpha');
    // A RECEIPT EXISTS, the registry is confirmed, the permit is good, and nothing is released.
    expect(runThrough(w, gate, ALPHA_OP, requester).blocker).toBe('SECRETS_HANDLING_GRANT_REQUIRED');
    mkdirSync(join(w.alpha.root, '.projectops', 'gates'), { recursive: true });
    writeFileSync(join(w.alpha.root, '.projectops', 'gates', `${PHASE}.secrets-handling.json`), JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    expect(runThrough(w, gate, ALPHA_OP, requester).blocker).toBe('SECRETS_HANDLING_GRANT_REQUIRED');
    expect(spawn.calls).toHaveLength(0);
    grantPhase(w.alpha);
    expect(runThrough(w, gate, ALPHA_OP, requester).ok).toBe(true);
  });

  it.each([
    ['refuses', { gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'REJECT' }],
    ['answers another gate', { gateName: 'commit', phaseId: PHASE, ownerChoice: 'APPROVE' }],
    ['is for another phase', { gateName: 'secrets-handling', phaseId: 'OTHER-PHASE1A', ownerChoice: 'APPROVE' }],
  ])('an owner record that %s is not a grant', (_label, record) => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_OP, 'alpha');
    mkdirSync(join(w.alpha.root, '.projectops', 'gates'), { recursive: true });
    writeFileSync(join(w.alpha.root, '.projectops', 'gates', `${PHASE}.secrets-handling.json`), JSON.stringify(record));
    commitAll(w.alpha.root, 'record');
    const { gate } = gateFor(w);
    expect(runThrough(w, gate, ALPHA_OP, w.console('alpha')).blocker).toBe('SECRETS_HANDLING_GRANT_REQUIRED');
  });

  it('a permit with no phase names no record', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_OP, 'alpha');
    const { gate } = gateFor(w);
    const requester = w.console('alpha');
    const permit = gate.grantPermit({ reference: ALPHA_OP, action: 'read-config', requester, capability: { ownerConfirmation: true } });
    expect(gate.run({ reference: ALPHA_OP, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: [], envVarName: 'SYNTHETIC_VALUE' }).blocker).toBe('SECRETS_HANDLING_GRANT_REQUIRED');
  });

  it('records a release through an envelope tied to its run, and refuses when that line cannot be written', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.alpha);
    seed(w, ALPHA_OP, 'alpha');
    const { spawn, gate } = gateFor(w);
    const requester = w.console('alpha');
    expect(runThrough(w, gate, ALPHA_OP, requester).ok).toBe(true);
    const line = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1) as { envelope: Record<string, unknown>; outcome: string; runLinked: boolean; grantSource: string };
    expect(line).toMatchObject({ outcome: 'allowed', runLinked: true, grantSource: `secrets-handling:${PHASE}` });
    expect(line.envelope).toMatchObject({ action: 'credential-release', actionClass: 'P5', tenant: OWNER_TENANT, project: 'alpha', scope: [`run:${requester.runHandle}`] });
    expect(parseEnvelope(line.envelope).ok).toBe(true);

    holdRecordLock(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    const before = spawn.calls.length;
    expect(runThrough(w, gate, ALPHA_OP, requester).blocker).toBe('ENVELOPE_NOT_RECORDED');
    expect(spawn.calls).toHaveLength(before);
  });
});

describe('the tenant class', () => {
  /** THE ACCEPTANCE CRITERION, and only the tenant rule can decide it: this credential has no project. */
  it('releases to a second project in the same tenant, and refuses across tenants', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.beta);
    grantPhase(w.alpha);
    grantPhase(w.gamma);
    seed(w, OWNER_SECRET, 'alpha');
    const spawn = fakeSpawn();
    const gate = underTest.gate.createOperationGate({ vault: w.vault, spawnSync: spawn.spawnSync });
    expect(runThrough(w, gate, OWNER_SECRET, w.authority.fromRun(kernelRun(w, w.alpha.root))).ok).toBe(true);
    expect(runThrough(w, gate, OWNER_SECRET, w.authority.fromRun(kernelRun(w, w.beta.root))).ok).toBe(true);
    expect(spawn.calls).toHaveLength(2);
    expect(runThrough(w, gate, OWNER_SECRET, w.authority.fromRun(kernelRun(w, w.gamma.root))).blocker).toBe('TENANT_MISMATCH');
    expect(spawn.calls).toHaveLength(2);
  });

  it.each(['Tenant.Owner-Personal', 'TENANT.OWNER-PERSONAL', 'tenant.OWNER-personal'])('matches %s case-insensitively, both ways', (segment) => {
    const w = credentialWorld(made, sys);
    grantPhase(w.gamma);
    grantPhase(w.beta);
    const spelled = `ProjectOS/${segment}/staging/supabase/service-role-key`;
    expect(reference.parseReference(spelled).ref).toMatchObject({ credentialClass: 'tenant', tenantId: OWNER_TENANT });
    seed(w, spelled, 'alpha');
    const spawn = fakeSpawn();
    const gate = underTest.gate.createOperationGate({ vault: w.vault, spawnSync: spawn.spawnSync });
    expect(runThrough(w, gate, spelled, w.console('beta')).ok).toBe(true);
    expect(runThrough(w, gate, spelled, w.console('gamma')).blocker).toBe('TENANT_MISMATCH');
  });

  it('holds on a store that folds case, as a Windows target name may', () => {
    const w = credentialWorld(made, sys);
    const inner = memory.createMemoryCredentialStore({ acknowledgedNonPersistent: true });
    const fold = (text: string): string => reference.asciiLower(text);
    const folding = { name: 'folding', set: (r: string, v: string) => inner.set(fold(r).replace('projectos/', 'ProjectOS/'), v), get: (r: string) => inner.get(fold(r).replace('projectos/', 'ProjectOS/')), exists: (r: string) => inner.exists(fold(r).replace('projectos/', 'ProjectOS/')), del: (r: string) => inner.del(fold(r).replace('projectos/', 'ProjectOS/')), list: inner.list };
    const vault = vaultModule.createCredentialVault({ store: folding, stateDir: join(w.stateDir, 'fold'), nowMs });
    vault.provision({ reference: OWNER_SECRET, requester: w.console('alpha'), readValue: () => VALUE });
    const shout = 'ProjectOS/TENANT.OWNER-PERSONAL/staging/supabase/service-role-key';
    expect(vault.present({ reference: shout, requester: w.console('beta') })).toBe(true);
    expect(refusalOf(() => vault.present({ reference: shout, requester: w.console('gamma') })).code).toBe('TENANT_MISMATCH');
  });

  it('refuses a malformed tenant segment and folds no non-ASCII letter onto a reserved one', () => {
    expect(reference.parseReference('ProjectOS/tenant.A_b/staging/x/y').ok).toBe(false);
    expect(reference.parseReference('ProjectOS/tenant.1a/staging/x/y').ok).toBe(false);
    expect(reference.isReservedProjectId('tenant.x')).toBe(true);
    expect(reference.isReservedProjectId('TeNaNt.x')).toBe(true);
    expect(reference.isReservedProjectId('tenantx')).toBe(false);
    expect(reference.isReservedProjectId('\u212Atenant.x')).toBe(false);
  });

  it('never loads into a session, though its name is a session name and its tenant is right', () => {
    const w = credentialWorld(made, sys);
    const target = 'ProjectOS/tenant.owner-personal/staging/github/gh-token';
    seed(w, target, 'alpha', { reach: 'tenant' });
    expect(reference.classifyRisk('gh-token')).toBe('session');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: target, requester: w.console('alpha') })).code).toBe('TENANT_CLASS_NOT_SESSION');
  });
});

describe('the platform class', () => {
  it('releases the gatekeeper key to no one, with every other gate open', () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.projectos);
    w.store.set(PLATFORM, VALUE);
    // ITS OWN PROJECT'S RUN, ITS OWN TENANT, A GOOD PERMIT, A COMMITTED RECORD: only the class rule is left.
    // The provider guard does not know `openai`, so this goes to the vault directly: the rule must hold there.
    expect(reference.parseReference(PLATFORM).ref.credentialClass).toBe('platform');
    const requester = w.authority.fromRun(kernelRun(w, w.projectos.root));
    const permit = { permitId: 'permit_fixture', reference: PLATFORM, projectId: 'projectos', environment: 'development', runHandle: requester.runHandle, phaseId: PHASE, expiresAtMs: nowMs() + 60_000 };
    expect(refusalOf(() => w.vault.authoriseOperationRelease({ reference: PLATFORM, requester, permit, capability: { ownerConfirmation: true } })).code).toBe('PLATFORM_RELEASED_TO_NONE');
  });

  it('is released to no tenant session, by its own rule', () => {
    const w = credentialWorld(made, sys);
    w.store.set(PLATFORM, VALUE);
    for (const project of ['projectos', 'alpha', 'gamma']) {
      expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: PLATFORM, requester: w.console(project) })).code).toBe('PLATFORM_RELEASED_TO_NONE');
    }
  });

  it('is recognised in any case, because a Windows target name may be', () => {
    expect(reference.parseReference('ProjectOS/PROJECTOS/development/OPENAI/GATEKEEPER-API-KEY').ref.credentialClass).toBe('platform');
    expect(reference.parseReference('ProjectOS/projectos/production/openai/gatekeeper-api-key').ref.credentialClass).toBe('project');
  });

  it('is changed from a console and never from a run', () => {
    const w = credentialWorld(made, sys);
    const run = w.authority.fromRun(kernelRun(w, w.projectos.root));
    expect(refusalOf(() => w.vault.provision({ reference: PLATFORM, requester: run, readValue: () => VALUE })).code).toBe('PLATFORM_CONSOLE_ONLY');
    expect(refusalOf(() => w.vault.remove({ reference: PLATFORM, requester: run })).code).toBe('PLATFORM_CONSOLE_ONLY');
    expect(refusalOf(() => w.vault.present({ reference: PLATFORM, requester: run })).code).toBe('PLATFORM_CONSOLE_ONLY');
    expect(w.store.exists(PLATFORM)).toBe(false);
    expect(w.vault.provision({ reference: PLATFORM, requester: w.console('projectos'), readValue: () => VALUE }).replaced).toBe(false);
  });
});

describe('a project id may not read as a tenant', () => {
  it('refuses a connection calling itself tenant.<id>, in any case, before anything is read', () => {
    const w = credentialWorld(made, sys);
    const r = session(w);
    for (const projectId of ['tenant.agency-business', 'Tenant.Agency-Business', 'TENANT.X1']) {
      const out = r.router.prepare({ ...r.base(w.alpha), connection: { ...r.connection(w.alpha, 'alpha'), projectId }, requester: w.console('alpha') });
      expect(out.blocker).toBe('TENANT_RESERVED_ID');
    }
    expect(r.spawned).toHaveLength(0);
  });
});

describe('provision, remove and present are bound', () => {
  it('each refuses across a project and across a tenant, with the store untouched, and passes for its own', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha');
    for (const project of ['beta', 'gamma']) {
      const requester = w.console(project);
      expect(refusalOf(() => w.vault.present({ reference: ALPHA_GH, requester })).code).toBe('CROSS_PROJECT_REFUSED');
      expect(refusalOf(() => w.vault.remove({ reference: ALPHA_GH, requester })).code).toBe('CROSS_PROJECT_REFUSED');
      expect(refusalOf(() => w.vault.provision({ reference: ALPHA_GH, requester, replace: true, readValue: () => 'overwritten' })).code).toBe('CROSS_PROJECT_REFUSED');
    }
    expect(w.store.get(ALPHA_GH)).toBe(VALUE);
    const own = w.console('alpha');
    expect(w.vault.present({ reference: ALPHA_GH, requester: own })).toBe(true);
    expect(w.vault.remove({ reference: ALPHA_GH, requester: own })).toBe(true);
    expect(w.store.exists(ALPHA_GH)).toBe(false);
  });

  it('each refuses a tenant-class reference from another tenant, and passes for a second project in it', () => {
    const w = credentialWorld(made, sys);
    seed(w, OWNER_SECRET, 'alpha');
    const outsider = w.console('gamma');
    expect(refusalOf(() => w.vault.present({ reference: OWNER_SECRET, requester: outsider })).code).toBe('TENANT_MISMATCH');
    expect(refusalOf(() => w.vault.remove({ reference: OWNER_SECRET, requester: outsider })).code).toBe('TENANT_MISMATCH');
    expect(refusalOf(() => w.vault.provision({ reference: OWNER_SECRET, requester: outsider, replace: true, readValue: () => 'overwritten' })).code).toBe('TENANT_MISMATCH');
    expect(w.vault.present({ reference: OWNER_SECRET, requester: w.console('beta') })).toBe(true);
  });

  it('rotate-metadata is bound the same way', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha');
    expect(refusalOf(() => w.vault.rotateMetadata({ reference: ALPHA_GH, requester: w.console('beta'), note: 'x' })).code).toBe('CROSS_PROJECT_REFUSED');
  });

  it('a project with no registry line has no tenant, even for its own reference', () => {
    const w = credentialWorld(made, sys);
    const requester = w.console('alpha');
    expect(refusalOf(() => w.vault.present({ reference: 'ProjectOS/stray/staging/github/gh-token', requester })).code).toBe('CROSS_PROJECT_REFUSED');
  });
});

describe('reach', () => {
  it('is kept, replaced whole, and judged when declared', () => {
    const w = credentialWorld(made, sys);
    const dir = tempDir(made, 'projectos-reach-');
    const store = metadata.createMetadataStore({ stateDir: dir });
    const ref = ALPHA_GH;
    store.recordProvision(ref, VALUE, { reach: 'account', reachTenants: [OWNER_TENANT] });
    store.recordProvision(ref, VALUE, {});
    expect(store.get(ref)).toMatchObject({ reach: 'account', reachTenants: [OWNER_TENANT] });
    store.recordRotationMetadata(ref, { reach: 'project' });
    expect(store.get(ref)).toMatchObject({ reach: 'project', reachTenants: null });
    expect(refusalOf(() => store.recordProvision(ref, VALUE, { reach: 'everything' })).message).toContain('reach must be one of');
    expect(refusalOf(() => store.recordProvision(ref, VALUE, { reach: 'account' })).message).toContain('names the tenants');
    expect(refusalOf(() => store.recordProvision(ref, VALUE, { reach: 'account', reachTenants: ['Not A Tenant'] })).message).toContain('names the tenants');
    expect(refusalOf(() => store.recordProvision(ref, VALUE, { reach: 'project', reachTenants: [OWNER_TENANT] })).message).toContain('names the tenants');
    expect(w.authority).toBeDefined();
  });

  it('is declared from a console only: a run cannot lower its own credential\'s reach', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'account', reachTenants: [OWNER_TENANT, AGENCY_TENANT] });
    const run = w.authority.fromRun(kernelRun(w, w.alpha.root));
    expect(refusalOf(() => w.vault.rotateMetadata({ reference: ALPHA_GH, requester: run, reach: 'project' })).code).toBe('REACH_CONSOLE_ONLY');
    expect(refusalOf(() => w.vault.provision({ reference: ALPHA_GH, requester: run, replace: true, reach: 'project', readValue: () => VALUE })).code).toBe('REACH_CONSOLE_ONLY');
    expect(w.vault.rotateMetadata({ reference: ALPHA_GH, requester: w.console('alpha'), reach: 'project' })).toMatchObject({ reach: 'project' });
  });
});

/** A session world: registered projects, a spawn double, and everything the router asks for. */
function session(w: CredentialWorld, providers: readonly string[] = ['github', 'supabase']) {
  const stateDir = join(w.stateDir, 'sessions-state');
  const spawned: { env: Record<string, string> }[] = [];
  const projectRegistry = projectRegistryModule.createProjectRegistry({ stateDir });
  const connection = (project: Project, projectId: string) => ({
    schemaVersion: '1.0',
    projectId,
    canonicalRepositoryRoot: canonical(project),
    providers,
    github: { repository: `synthetic-owner/${projectId}` },
    supabase: { environments: { staging: { projectRef: `${projectId}refaaaaaaaaaaaaaaaaaaaa`.slice(0, 20) } } },
  });
  const router = routerModule.createSessionRouter({
    vault: w.vault,
    stateDir,
    projectRegistry,
    spawn: (_command: string, _args: readonly string[], options: { env: Record<string, string> }) => {
      spawned.push(options);
      return { pid: 4242, on: () => undefined };
    },
  });
  const base = (project: Project) => ({ slot: 'cred-1', profileName: 'staging-writer', environment: 'staging', checkoutPath: project.root, repository: { checkoutPath: project.root, canonicalRoot: canonical(project), branch: 'main', remoteUrl: null } });
  return { router, spawned, projectRegistry, connection, base };
}

function canonical(project: Project): string {
  return reference.asciiLower(project.root).split('/').join(String.fromCharCode(92));
}

function startSession(w: CredentialWorld, project: Project, projectId: string, requester: unknown) {
  const r = session(w);
  const connection = r.connection(project, projectId);
  r.projectRegistry.register({ connection, checkoutPath: project.root, capability: { ownerConfirmation: true } });
  const outcome = r.router.start({
    ...r.base(project),
    connection,
    repository: { ...r.base(project).repository, remoteRepositoryFullName: connection.github.repository },
    observations: { github: { apiRepositoryFullName: connection.github.repository, remoteRepositoryFullName: connection.github.repository }, supabase: { projectRef: connection.supabase.environments.staging.projectRef } },
    requester,
    command: 'node',
    args: ['--version'],
    baseEnv: {},
    mcpConfig: null,
  });
  return { outcome, spawned: r.spawned };
}

const SUPABASE = (project: string): string => `ProjectOS/${project}/staging/supabase/supabase-access-token`;
const GITHUB = (project: string): string => `ProjectOS/${project}/staging/github/gh-token`;

describe('session auto-load', () => {
  it('positive control: a project credential for its own project in its own tenant, recorded through an envelope', () => {
    const w = credentialWorld(made, sys);
    seed(w, GITHUB('alpha'), 'alpha', { reach: 'project' });
    seed(w, SUPABASE('alpha'), 'alpha', { reach: 'account', reachTenants: [OWNER_TENANT] });
    const requester = w.authority.fromRun(kernelRun(w, w.alpha.root));
    const { outcome, spawned } = startSession(w, w.alpha, 'alpha', requester);
    expect(outcome.ready).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.env['GH_TOKEN']).toBe(VALUE);
    expect(outcome.record).toMatchObject({ tenant: OWNER_TENANT, runHandle: requester.runHandle });
    expect(JSON.stringify(outcome.record)).not.toContain(VALUE);
    const releases = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).filter((line) => (line['envelope'] as { action?: string } | null)?.action === 'credential-release');
    expect(releases).toHaveLength(2);
    expect(releases[0]).toMatchObject({ outcome: 'allowed', grantSource: 'session-auto-load', via: 'governed-root' });
  });

  /** THE ACCEPTANCE CRITERION. The project check passes here: only the reach rule stands in the way. */
  it('does not project an account-wide token into another tenant\'s session, and only the reach rule refuses', () => {
    const w = credentialWorld(made, sys);
    seed(w, GITHUB('gamma'), 'gamma', { reach: 'project' });
    // THE OWNER'S ACCOUNT TOKEN, stored under the agency project's name.
    seed(w, SUPABASE('gamma'), 'gamma', { reach: 'account', reachTenants: [OWNER_TENANT] });
    const { outcome, spawned } = startSession(w, w.gamma, 'gamma', w.authority.fromRun(kernelRun(w, w.gamma.root)));
    expect(outcome.ready).toBe(false);
    expect(outcome.blocker).toBe('REACH_CROSSES_TENANTS');
    expect(spawned).toHaveLength(0);
  });

  it('an account spanning both tenants loads into neither', () => {
    const w = credentialWorld(made, sys);
    seed(w, GITHUB('alpha'), 'alpha', { reach: 'project' });
    seed(w, SUPABASE('alpha'), 'alpha', { reach: 'account', reachTenants: [OWNER_TENANT, AGENCY_TENANT] });
    expect(startSession(w, w.alpha, 'alpha', w.console('alpha')).outcome.blocker).toBe('REACH_CROSSES_TENANTS');
  });

  it('refuses an undeclared reach, and says what to do', () => {
    const w = credentialWorld(made, sys);
    seed(w, GITHUB('alpha'), 'alpha');
    seed(w, SUPABASE('alpha'), 'alpha', { reach: 'project' });
    const { outcome, spawned } = startSession(w, w.alpha, 'alpha', w.console('alpha'));
    expect(outcome.blocker).toBe('REACH_UNDECLARED');
    expect(spawned).toHaveLength(0);
  });

  it('the vault asks reach itself: the router is not the only thing between a token and a child', () => {
    const w = credentialWorld(made, sys);
    seed(w, SUPABASE('gamma'), 'gamma', { reach: 'account', reachTenants: [OWNER_TENANT] });
    seed(w, SUPABASE('alpha'), 'alpha');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: SUPABASE('gamma'), requester: w.console('gamma') })).code).toBe('REACH_CROSSES_TENANTS');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: SUPABASE('alpha'), requester: w.console('alpha') })).code).toBe('REACH_UNDECLARED');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GITHUB('alpha'), requester: w.console('alpha') })).code).toBe('CREDENTIAL MISSING');
  });

  it('a linked worktree\'s binding alone releases nothing, and the same credential loads from the root', () => {
    const w = credentialWorld(made, sys);
    const worktree = join(tempDir(made, 'projectos-cred-wt-'), 'alpha-wt');
    git(w.alpha.root, 'worktree', 'add', '--quiet', worktree, '-b', 'wt');
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const line = kernelRun(w, worktree);
    const requester = w.authority.fromRun(line);
    expect(requester.via).toBe('linked-worktree');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester })).code).toBe('LINKED_WORKTREE_ALONE');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester: w.authority.fromRun(kernelRun(w, w.alpha.root)) })).code).toBeUndefined();
  });

  it('a linked worktree still reaches an operation, through the record at the registered root and no other', () => {
    const w = credentialWorld(made, sys);
    const worktree = join(tempDir(made, 'projectos-cred-wt-'), 'alpha-wt');
    git(w.alpha.root, 'worktree', 'add', '--quiet', worktree, '-b', 'wt');
    seed(w, ALPHA_OP, 'alpha');
    const requester = w.authority.fromRun(kernelRun(w, worktree));
    const spawn = fakeSpawn();
    const gate = underTest.gate.createOperationGate({ vault: w.vault, spawnSync: spawn.spawnSync });
    // ITS OWN COMMIT, IN ITS OWN CHECKOUT, GRANTS NOTHING.
    grantPhase({ root: worktree, repository: w.alpha.repository });
    expect(runThrough(w, gate, ALPHA_OP, requester).blocker).toBe('SECRETS_HANDLING_GRANT_REQUIRED');
    grantPhase(w.alpha);
    expect(runThrough(w, gate, ALPHA_OP, requester).ok).toBe(true);
  });

  it('refuses a session whose requester is another project\'s, or a string, before any lease', () => {
    const w = credentialWorld(made, sys);
    seed(w, GITHUB('alpha'), 'alpha', { reach: 'project' });
    const r = session(w);
    const out = r.router.prepare({ ...r.base(w.alpha), connection: r.connection(w.alpha, 'alpha'), requester: w.console('gamma') });
    expect(out.blocker).toBe('CROSS_PROJECT_REFUSED');
    expect(r.router.prepare({ ...r.base(w.alpha), connection: r.connection(w.alpha, 'alpha'), requester: 'alpha' }).blocker).toBe('REQUESTER_REQUIRED');
    expect(r.router.leases.inspect(w.alpha.root).held).toBeFalsy();
  });

  it('refuses when the envelope line cannot be written, and no value is released', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const requester = w.console('alpha');
    holdRecordLock(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester })).code).toBe('ENVELOPE_NOT_RECORDED');
  });

  it('a refused release is on the record, and a refusal that cannot be recorded stops by name', () => {
    const w = credentialWorld(made, sys);
    seed(w, GAMMA_GH, 'gamma', { reach: 'project' });
    const requester = w.console('alpha');
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GAMMA_GH, requester })).code).toBe('CROSS_PROJECT_REFUSED');
    expect(linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1)).toMatchObject({ outcome: 'refused', rule: 'CROSS_PROJECT_REFUSED' });
    holdRecordLock(w.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(refusalOf(() => w.vault.authoriseSessionRelease({ reference: GAMMA_GH, requester })).code).toBe('REFUSAL_NOT_RECORDED');
  });
});

describe('the durable audit', () => {
  it('survives the vault that wrote it, and holds no value', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const requester = w.console('alpha');
    const grant = w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester });
    expect(w.vault.releaseIntoChildEnvironment(grant)).toBe(VALUE);
    expect(refusalOf(() => w.vault.present({ reference: GAMMA_GH, requester })).code).toBe('CROSS_PROJECT_REFUSED');

    const text = readFileSync(w.vault.auditPath, 'utf8');
    const lines = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line['action'])).toEqual(expect.arrayContaining(['provision-intent', 'provision', 'authorise-session', 'release-into-child-environment', 'present']));
    expect(lines.find((line) => line['action'] === 'authorise-session')).toMatchObject({ tenant: OWNER_TENANT, requester: requester.runHandle, ok: true });
    expect(lines.find((line) => line['reason'] === 'cross-project-refused')).toBeDefined();
    expect(text).not.toContain(VALUE);
    const again = vaultModule.createCredentialVault({ store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs });
    expect(readFileSync(again.auditPath, 'utf8')).toBe(text);
  });

  it('stops before the store changes when a line cannot be written', () => {
    const w = credentialWorld(made, sys);
    const requester = w.console('alpha');
    const dir = join(w.stateDir, 'vault');
    mkdirSync(dir, { recursive: true });
    const auditPath = join(dir, vaultModule.AUDIT_FILE_NAME);
    rmSync(auditPath, { force: true });
    mkdirSync(auditPath);
    expect(refusalOf(() => w.vault.provision({ reference: ALPHA_GH, requester, readValue: () => VALUE })).code).toBe('AUDIT_NOT_RECORDED');
    expect(w.store.exists(ALPHA_GH)).toBe(false);
    w.store.set(GAMMA_GH, VALUE);
    expect(refusalOf(() => w.vault.remove({ reference: GAMMA_GH, requester: w.console('gamma') })).code).toBe('AUDIT_NOT_RECORDED');
    expect(w.store.exists(GAMMA_GH)).toBe(true);
  });

  it('a value is not released when its own line cannot be written', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const grant = w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester: w.console('alpha') });
    rmSync(w.vault.auditPath, { force: true });
    mkdirSync(w.vault.auditPath);
    expect(refusalOf(() => w.vault.releaseIntoChildEnvironment(grant)).code).toBe('AUDIT_NOT_RECORDED');
  });

  it('keeps the text of a malformed reference out of the line: it may be a value pasted in the wrong place', () => {
    const w = credentialWorld(made, sys);
    const pasted = 'synthetic-value-pasted-into-the-reference-field';
    expect(refusalOf(() => w.vault.present({ reference: pasted, requester: w.console('alpha') })).message).not.toContain(pasted);
    expect(readFileSync(w.vault.auditPath, 'utf8')).not.toContain(pasted);
  });

  it('rotates past its size and keeps the old file', () => {
    const w = credentialWorld(made, sys);
    seed(w, ALPHA_GH, 'alpha');
    appendFileSync(w.vault.auditPath, `${'x'.repeat(1_100_000)}\n`);
    w.vault.present({ reference: ALPHA_GH, requester: w.console('alpha') });
    const dir = join(w.stateDir, 'vault');
    expect(readdirSync(dir).filter((name) => name.startsWith(vaultModule.AUDIT_FILE_NAME))).toHaveLength(2);
    expect(readFileSync(w.vault.auditPath, 'utf8').length).toBeLessThan(10_000);
  });
});

describe('the credential router', () => {
  const quiet = { stdin: { isTTY: undefined }, stdout: { isTTY: undefined } };
  const atConsole = { stdin: { isTTY: true }, stdout: { isTTY: true } };

  it('refuses every requester-bound verb with no terminal and no handle, before any store is reached', async () => {
    const w = credentialWorld(made, sys);
    const untouched = { set: () => { throw new Error('reached'); }, get: () => { throw new Error('reached'); }, exists: () => { throw new Error('reached'); }, del: () => { throw new Error('reached'); }, list: () => [] };
    const deps = { store: untouched, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal: quiet };
    process.env['PROJECTOS_CREDENTIAL_VALUE'] = VALUE;
    await expect(cli.main(['credentials', 'set', '--ref', ALPHA_GH, '--from-env', '--project', 'alpha'], deps)).rejects.toMatchObject({ code: 'REQUESTER_REQUIRED' });
    delete process.env['PROJECTOS_CREDENTIAL_VALUE'];
    await expect(cli.main(['credentials', 'delete', '--ref', ALPHA_GH, '--project', 'alpha'], deps)).rejects.toMatchObject({ code: 'REQUESTER_REQUIRED' });
    await expect(cli.main(['credentials', 'reach', '--ref', ALPHA_GH, '--reach', 'project', '--project', 'alpha'], deps)).rejects.toMatchObject({ code: 'REQUESTER_REQUIRED' });
    await expect(cli.main(['operation', 'run', '--ref', ALPHA_GH, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--owner-confirm', '--', NODE], deps)).rejects.toMatchObject({ code: 'REQUESTER_REQUIRED' });
  });

  it('one terminal end is not a console', () => {
    const w = credentialWorld(made, sys);
    for (const terminal of [{ stdin: { isTTY: true }, stdout: {} }, { stdin: {}, stdout: { isTTY: true } }]) {
      expect(refusalOf(() => cli.requesterFor({ project: 'alpha' }, { authority: w.authority, terminal })).code).toBe('REQUESTER_REQUIRED');
    }
  });

  it('a console must name the project, and the registry must list it', () => {
    const w = credentialWorld(made, sys);
    expect(refusalOf(() => cli.requesterFor({}, { authority: w.authority, terminal: atConsole })).code).toBe('REQUESTER_REQUIRED');
    expect(refusalOf(() => cli.requesterFor({ project: 'nobody' }, { authority: w.authority, terminal: atConsole })).code).toBe('TENANT_UNKNOWN');
    expect(cli.requesterFor({ project: 'gamma' }, { authority: w.authority, terminal: atConsole })).toMatchObject({ tenant: AGENCY_TENANT, via: 'console' });
  });

  it('a run handle needs no terminal, and a bare --run is not one', () => {
    const w = credentialWorld(made, sys);
    const handle = kernelRun(w, w.alpha.root);
    expect(cli.requesterFor({ run: handle }, { authority: w.authority, terminal: quiet }).project).toBe('alpha');
    expect(refusalOf(() => cli.requesterFor({ run: true, project: 'alpha' }, { authority: w.authority, terminal: atConsole })).code).toBe('REQUESTER_REQUIRED');
  });

  it('sets, declares reach and deletes through the real command, with synthetic entries', async () => {
    const w = credentialWorld(made, sys);
    const deps = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal: atConsole };
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env['PROJECTOS_CREDENTIAL_VALUE'] = VALUE;
    await expect(cli.main(['credentials', 'set', '--ref', ALPHA_GH, '--from-env', '--project', 'alpha', '--reach', 'account', '--reach-tenants', `${OWNER_TENANT},${AGENCY_TENANT}`], deps)).resolves.toBe(0);
    expect(w.store.get(ALPHA_GH)).toBe(VALUE);
    expect(w.vault.status({}).find((row: { reference: string }) => row.reference === ALPHA_GH)).toMatchObject({ reach: 'account', reachTenants: [OWNER_TENANT, AGENCY_TENANT] });
    await expect(cli.main(['credentials', 'reach', '--ref', ALPHA_GH, '--project', 'alpha', '--reach', 'project'], deps)).resolves.toBe(0);
    await expect(cli.main(['credentials', 'delete', '--ref', ALPHA_GH, '--project', 'gamma'], deps)).rejects.toMatchObject({ code: 'CROSS_PROJECT_REFUSED' });
    await expect(cli.main(['credentials', 'delete', '--ref', ALPHA_GH, '--project', 'alpha'], deps)).resolves.toBe(0);
    logged.mockRestore();
  });

  it('runs one operation through the real command, naming its phase', async () => {
    const w = credentialWorld(made, sys);
    grantPhase(w.alpha);
    seed(w, ALPHA_OP, 'alpha');
    const spawn = fakeSpawn();
    const deps = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal: atConsole, gate: { spawnSync: spawn.spawnSync } };
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const flags = ['--ref', ALPHA_OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--owner-confirm'];
    await expect(cli.main(['operation', 'run', ...flags, '--project', 'alpha', '--', NODE], deps)).rejects.toThrow('--phase is required');
    await expect(cli.main(['operation', 'run', ...flags, '--project', 'alpha', '--phase', PHASE, '--', NODE], deps)).resolves.toBe(0);
    expect(spawn.calls).toHaveLength(1);
    logged.mockRestore();
  });

  it('the real process refuses with no terminal, and reaches no store', () => {
    const script = join(PROJECTOS_ROOT, 'scripts/projectos-credential-router.cjs');
    const out = spawnSync(NODE, [script, 'credentials', 'delete', '--ref', 'ProjectOS/synthetic-probe/staging/github/gh-token', '--project', 'synthetic-probe'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('REQUESTER_REQUIRED');
  });
});

describe('the session and operation rules stand without the project check', () => {
  /**
   * `belongsToProject` is read once, when the vault loads. A fresh copy of the vault, loaded with that
   * function replaced, has every project check answering yes: only the tenant rule is left.
   */
  function vaultWithoutProjectCheck(w: CredentialWorld): { readonly vault: { authoriseSessionRelease: (i: unknown) => unknown; present: (i: unknown) => unknown } } {
    const load = createRequire(import.meta.url);
    const vaultPath = join(PROJECTOS_ROOT, 'credentials/vault.cjs');
    const held = reference.belongsToProject;
    const loaded = load.cache[load.resolve(vaultPath)];
    delete load.cache[load.resolve(vaultPath)];
    reference.belongsToProject = () => true;
    try {
      return { vault: load(vaultPath).createCredentialVault({ store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs }) };
    } finally {
      reference.belongsToProject = held;
      if (loaded !== undefined) load.cache[load.resolve(vaultPath)] = loaded;
    }
  }

  it('a session across tenants is refused by the tenant rule alone, and a second project in the tenant passes', () => {
    const w = credentialWorld(made, sys);
    seed(w, GAMMA_GH, 'gamma', { reach: 'project' });
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    const { vault } = vaultWithoutProjectCheck(w);
    expect(refusalOf(() => vault.authoriseSessionRelease({ reference: GAMMA_GH, requester: w.console('alpha') })).code).toBe('TENANT_MISMATCH');
    // THE SAME CALL IN THE SAME TENANT GOES THROUGH, so the refusal above is the tenant rule's.
    expect(refusalOf(() => vault.authoriseSessionRelease({ reference: ALPHA_GH, requester: w.console('beta') })).code).toBeUndefined();
  });

  it('a mutation across tenants is refused the same way', () => {
    const w = credentialWorld(made, sys);
    seed(w, GAMMA_GH, 'gamma');
    const { vault } = vaultWithoutProjectCheck(w);
    expect(refusalOf(() => vault.present({ reference: GAMMA_GH, requester: w.console('alpha') })).code).toBe('TENANT_MISMATCH');
  });
});

describe('the broker\'s own tenant check', () => {
  const brokerSource = readFileSync(join(PROJECTOS_ROOT, 'security/gatekeeper-transport-broker.cjs'), 'utf8');
  const PROJECT = 'projectos';
  const FIXTURE_REPOSITORY = 'github.com/local/fixture';

  interface BrokerWorld {
    readonly root: string;
    readonly stateDir: string;
    readonly head: string;
    readonly commitRegistry: (text: string) => void;
    readonly ask: (over?: Readonly<Record<string, unknown>>) => { readonly error?: string };
  }

  function brokerWorld(lines: readonly { projectId: string; repository: string; governedRoot: string; tenant: string; domain: string }[] | null): BrokerWorld {
    const root = tempDir(made, 'projectos-tenant-broker-');
    const stateDir = tempDir(made, 'projectos-tenant-broker-state-');
    const run = (...args: string[]) => git(root, ...args);
    run('init', '--quiet');
    run('remote', 'add', 'origin', `https://${FIXTURE_REPOSITORY}.git`);
    const write = (rel: string, text: string) => {
      const abs = join(root, ...rel.split('/'));
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, text);
    };
    write('projectos/security/installation-project-allowlist.json', JSON.stringify({ schemaVersion: '1.0.0', projects: [{ projectId: PROJECT, repository: FIXTURE_REPOSITORY, governedRoot: root }] }));
    write(`.projectops/gates/${PHASE}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: PHASE, ownerChoice: 'APPROVE' }));
    const here = { projectId: PROJECT, repository: FIXTURE_REPOSITORY, governedRoot: root, tenant: OWNER_TENANT, domain: 'develop' };
    if (lines !== null) write('projectos/security/tenant-registry.json', registryText(lines.length === 0 ? [here] : lines));
    commitAll(root, 'authorised');
    const head = run('rev-parse', 'HEAD').trim();
    const ask = (over: Readonly<Record<string, unknown>> = {}) => {
      const requestId = 'REQUEST-TENANT-1';
      const body = JSON.stringify({ model: 'fixture', instructions: ['  project: projectos', `  phase: ${PHASE}`, `  subject: ${head}`, '  ask: security-review'].join('\n'), input: [{ content: [{ text: `requestId: ${requestId}\nreview` }] }] });
      const payload = JSON.stringify({ kind: 'gatekeeper', governedRoot: root, projectId: PROJECT, phaseId: PHASE, subjectCommit: head, ask: 'security-review', requestId, credentialRef: 'SYNTHETIC_HELD_NOWHERE', body, ...over });
      const requestFile = join(stateDir, 'request.json');
      writeFileSync(requestFile, payload);
      const sha = execFileSync(NODE, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(requestFile)})).digest('hex'))`], { encoding: 'utf8' });
      const pinned = [`const TRUSTED_INSTALL_ROOT = ${JSON.stringify(root)};`, `const TRUSTED_REQUEST_SHA256 = ${JSON.stringify(sha)};`, `const TRUSTED_STATE_DIR = ${JSON.stringify(stateDir)};`, brokerSource].join('\n');
      const result = spawnSync(NODE, ['-'], { input: pinned, encoding: 'utf8', cwd: root, windowsHide: true, env: { SystemRoot: process.env['SystemRoot'] ?? '', PROJECTOS_BROKER_REQUEST: requestFile, PROJECTOS_GIT_EXE: boundGitPath() } });
      return JSON.parse(result.stdout) as { error?: string };
    };
    return { root, stateDir, head, ask, commitRegistry: (text) => { write('projectos/security/tenant-registry.json', text); commitAll(root, 'registry'); } };
  }

  function boundGitPath(): string {
    return execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0] ?? '';
  }

  const STOPPED_AT_CREDENTIAL = "credential 'SYNTHETIC_HELD_NOWHERE' is not one this broker holds";

  it('positive control: a listed project at its root reaches the credential stage, and the spend row says whose it was', () => {
    const world = brokerWorld([]);
    expect(world.ask().error).toBe(STOPPED_AT_CREDENTIAL);
    const ledger = JSON.parse(readFileSync(join(world.stateDir, 'gatekeeper-spend.json'), 'utf8')) as { calls: { tenant: string }[] };
    expect(ledger.calls[0]?.tenant).toBe(OWNER_TENANT);
  });

  it('judges the real committed registry sound, and refuses only because this checkout is not its line', () => {
    const world = brokerWorld([]);
    world.commitRegistry(readFileSync(join(PROJECTOS_ROOT, 'security/tenant-registry.json'), 'utf8'));
    const said = world.ask().error ?? '';
    expect(said).toContain('TENANT_MISMATCH');
    expect(said).not.toContain('TENANT_REGISTRY');
  });

  it('refuses a project the allowlist admits and the tenant registry does not list', () => {
    const world = brokerWorld([{ projectId: 'someone-else', repository: 'github.com/fixture/else', governedRoot: 'C:/dev/else', tenant: OWNER_TENANT, domain: 'develop' }]);
    expect(world.ask().error).toContain('TENANT_UNKNOWN');
  });

  it('refuses a line at another root, and another repository, each alone', () => {
    const root = brokerWorld([{ projectId: PROJECT, repository: FIXTURE_REPOSITORY, governedRoot: 'C:/dev/elsewhere', tenant: OWNER_TENANT, domain: 'develop' }]);
    expect(root.ask().error).toContain('TENANT_MISMATCH');
    const moved = brokerWorld([]);
    moved.commitRegistry(registryText([{ projectId: PROJECT, repository: 'github.com/fixture/moved', governedRoot: moved.root, tenant: OWNER_TENANT, domain: 'develop' }]));
    expect(moved.ask().error).toContain('TENANT_MISMATCH');
  });

  it('refuses an installation with no committed registry, and a dirty one', () => {
    expect(brokerWorld(null).ask().error).toContain('TENANT_REGISTRY_UNREADABLE');
    const dirty = brokerWorld([]);
    appendFileSync(join(dirty.root, 'projectos', 'security', 'tenant-registry.json'), '\n');
    expect(dirty.ask().error).toContain('TENANT_REGISTRY_UNREADABLE');
  });

  it.each([
    ['a duplicate root', (l: Record<string, unknown>) => [l, { ...l, projectId: 'twin', repository: 'github.com/fixture/twin' }], 'TENANT_REGISTRY_DUPLICATE'],
    ['a duplicate project', (l: Record<string, unknown>) => [l, { ...l, repository: 'github.com/fixture/twin', governedRoot: 'C:/dev/twin' }], 'TENANT_REGISTRY_DUPLICATE'],
    ['a wildcard elsewhere in the file', (l: Record<string, unknown>) => [l, { ...l, projectId: 'other', repository: 'github.com/fixture/*', governedRoot: 'C:/dev/other' }], 'TENANT_REGISTRY_WILDCARD'],
    ['a reserved id elsewhere in the file', (l: Record<string, unknown>) => [l, { ...l, projectId: 'Tenant.Other', repository: 'github.com/fixture/other', governedRoot: 'C:/dev/other' }], 'TENANT_REGISTRY_RESERVED_ID'],
    ['an undeclared tenant elsewhere in the file', (l: Record<string, unknown>) => [l, { ...l, projectId: 'other', repository: 'github.com/fixture/other', governedRoot: 'C:/dev/other', tenant: 'nobody-here' }], 'TENANT_REGISTRY_INVALID'],
    ['one root inside another', (l: Record<string, unknown>) => [l, { ...l, projectId: 'inner', repository: 'github.com/fixture/inner', governedRoot: `${String(l['governedRoot'])}/inner` }], 'TENANT_REGISTRY_NESTED_ROOT'],
  ])('refuses the whole registry for %s, though this project\'s own line is perfect', (_label, projects, code) => {
    const world = brokerWorld([]);
    const line = { projectId: PROJECT, repository: FIXTURE_REPOSITORY, governedRoot: world.root, tenant: OWNER_TENANT, domain: 'develop' };
    world.commitRegistry(registryText(projects(line) as never));
    expect(world.ask().error).toContain(code);
  });

  it('does not read through a replace ref', () => {
    const world = brokerWorld([]);
    const rel = 'projectos/security/tenant-registry.json';
    const blob = git(world.root, 'rev-parse', `HEAD:${rel}`).trim();
    const flipped = readFileSync(join(world.root, ...rel.split('/')), 'utf8').split('"tenant": "owner-personal"').join('"tenant": "agency-business"');
    const planted = execFileSync('git', ['-C', world.root, 'hash-object', '-w', '--stdin'], { input: flipped, encoding: 'utf8' }).trim();
    git(world.root, 'replace', blob, planted);
    world.ask();
    const ledger = JSON.parse(readFileSync(join(world.stateDir, 'gatekeeper-spend.json'), 'utf8')) as { calls: { tenant: string }[] };
    expect(ledger.calls[0]?.tenant).toBe(OWNER_TENANT);
  });

  it('a tenant named in the request changes nothing', () => {
    const world = brokerWorld([]);
    expect(world.ask({ tenant: AGENCY_TENANT, requesterTenant: AGENCY_TENANT }).error).toBe(STOPPED_AT_CREDENTIAL);
    const ledger = JSON.parse(readFileSync(join(world.stateDir, 'gatekeeper-spend.json'), 'utf8')) as { calls: { tenant: string }[] };
    expect(ledger.calls[0]?.tenant).toBe(OWNER_TENANT);
  });
});

describe('what the CommonJS side repeats, held to the core', () => {
  it('the idempotency key is the kernel\'s, byte for byte', () => {
    const w = credentialWorld(made, sys);
    const requester = w.console('alpha');
    grantPhase(w.alpha);
    seed(w, ALPHA_GH, 'alpha', { reach: 'project' });
    w.vault.authoriseSessionRelease({ reference: ALPHA_GH, requester, sessionId: 'sess_x' });
    const line = linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).at(-1) as { envelope: { subjectHash: string; idempotencyKey: string } };
    expect(line.envelope.idempotencyKey).toBe(deriveIdempotencyKey({ tenant: OWNER_TENANT, project: 'alpha', action: 'credential-release', subjectHash: line.envelope.subjectHash, intentScope: 'session:sess_x' }));
  });

  it('takes class and environment from the committed action registry', () => {
    const w = credentialWorld(made, sys);
    const root = w.installation.root;
    const path = join(root, 'projectos', 'security', 'action-registry.json');
    const registry = JSON.parse(readFileSync(path, 'utf8')) as { actions: { id: string }[] };
    writeFileSync(path, JSON.stringify({ ...registry, actions: registry.actions.filter((entry) => entry.id !== 'run-start') }, null, 2));
    commitAll(root, 'an action registry with no run-start');
    expect(refusalOf(() => w.console('alpha')).code).toBe('ACTION_REGISTRY_UNREADABLE');
  });

  it('the state directory is the platform stop\'s: the environment cannot move it alone', () => {
    const held = process.env['LOCALAPPDATA'];
    const agreed = metadata.installationStateDir();
    process.env['LOCALAPPDATA'] = 'C:/somewhere/forged';
    try {
      expect(metadata.installationStateDir()).toBeNull();
    } finally {
      if (held === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = held;
    }
    expect(agreed === null || agreed.endsWith('ProjectOS/installation-state')).toBe(true);
  });
});


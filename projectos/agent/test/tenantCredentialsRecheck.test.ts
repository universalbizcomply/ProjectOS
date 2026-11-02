/**
 * The final recheck on PROJECTOS-TENANT-CREDENTIALS1A, 2026-11-02: each finding as a behaviour.
 *
 * THESE WERE WRITTEN FIRST and failed at `a78ddf92`. The HIGH is an installation worktree writing its own grant:
 * the router takes its root from its own location, so a grant committed on a worktree branch of the ProjectOS
 * repository released a credential while the main checkout held none. Everything here is synthetic.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { nodeSystem, resolveBoundPowerShell, type System } from '../src/system.js';
import { cleanUp, commitAll, FIXTURE_NOW, forward, git, OWNER_TENANT, registryText, tempDir } from './support/tenantWorld.js';
import {
  cli,
  commitGrant,
  confirmGrant,
  credentialWorld,
  GRANT_REL,
  GRANTED_COMMAND,
  grantRelease,
  metadata,
  nowMs,
  PHASE,
  projectRegistryModule,
  PROJECTOS_ROOT,
  reference,
  refusalOf,
  routerModule,
  underTest,
  type CredentialWorld,
} from './support/credentialWorld.js';

vi.setConfig({ testTimeout: 60_000 });

const made: string[] = [];
afterEach(() => cleanUp(made));

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };
const VALUE = 'synthetic-credential-value-4444';
const OP = 'ProjectOS/alpha/staging/supabase/service-role-key';
const GH = 'ProjectOS/alpha/staging/github/gh-token';
const PLATFORM = 'ProjectOS/projectos/development/openai/gatekeeper-api-key';
const NODE = process.execPath;

/** A terminal that answers what the prompt asks for, as a person would. */
const TYPES_WHAT_IT_IS_ASKED = { stdin: { isTTY: true }, stdout: { isTTY: true }, readLine: (question: string) => /"([^"]+)"/.exec(question)?.[1] ?? null };
/** Both ends read as a TTY, as a hidden `Start-Process` window gives, and nobody answers. */
const SPOOFED_TTY = { stdin: { isTTY: true }, stdout: { isTTY: true }, readLine: (): string | null => null };
const WRONG_ANSWER = { stdin: { isTTY: true }, stdout: { isTTY: true }, readLine: (): string | null => 'yes' };

function gateOf(w: CredentialWorld, vault = w.vault) {
  const calls: unknown[] = [];
  return { calls, gate: underTest.gate.createOperationGate({ vault, spawnSync: (...args: unknown[]) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; } }) };
}

function release(gate: { grantPermit: (i: unknown) => unknown; run: (i: unknown) => { ok: boolean; blocker: string | null } }, requester: unknown, args: readonly string[] = ['--version']) {
  const permit = gate.grantPermit({ reference: OP, action: 'read-config', requester, capability: { ownerConfirmation: true }, phaseId: PHASE });
  return gate.run({ reference: OP, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args, envVarName: 'SYNTHETIC_VALUE' });
}

function seed(w: CredentialWorld): void {
  w.vault.provision({ reference: OP, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
}

describe('HIGH: the installation is the main checkout', () => {
  /** A linked worktree of the installation, holding a grant the main checkout does not. */
  function installationWorktree(w: CredentialWorld): string {
    const worktree = join(tempDir(made, 'projectos-install-wt-'), 'wt');
    git(w.installation.root, 'worktree', 'add', '--quiet', worktree, '-b', 'grants-itself');
    const path = join(worktree, ...GRANT_REL(PHASE).split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: '1.0.0', kind: 'credential-release-grant', phaseId: PHASE, projectId: 'alpha', references: [OP], action: 'read-config', command: GRANTED_COMMAND, expiresAt: '2027-01-01T00:00:00.000Z', grantedBy: 'Forged' }));
    commitAll(worktree, 'a grant on a worktree branch');
    return forward(worktree);
  }

  it('a linked worktree of the installation is no installation, so its own grant releases nothing', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    const worktree = installationWorktree(w);
    const forged = metadata.createRequesterAuthority({ installRoot: worktree, stateDir: w.stateDir, nowMs });
    expect(refusalOf(() => forged.issueConsoleRun({ projectId: 'alpha' })).code).toBe('INSTALLATION_NOT_MAIN_CHECKOUT');
    expect(existsSync(join(w.installation.root, ...GRANT_REL(PHASE).split('/')))).toBe(false);
  });

  it('a clone elsewhere is not the installation the registry names', () => {
    const w = credentialWorld(made, sys);
    const clone = join(tempDir(made, 'projectos-install-clone-'), 'clone');
    execFileSync('git', ['clone', '--quiet', w.installation.root, clone], { encoding: 'utf8' });
    const elsewhere = metadata.createRequesterAuthority({ installRoot: forward(clone), stateDir: w.stateDir, nowMs });
    expect(refusalOf(() => elsewhere.issueConsoleRun({ projectId: 'alpha' })).code).toBe('INSTALLATION_NOT_MAIN_CHECKOUT');
  });

  it('a registry that does not name this root as `projectos` refuses, and one with no such line does', () => {
    const w = credentialWorld(made, sys);
    const lines = [{ projectId: 'projectos', repository: w.installation.repository, governedRoot: 'C:/dev/somewhere-else', tenant: OWNER_TENANT, domain: 'develop' }];
    w.installation.commitRegistryText(registryText(lines));
    w.installation.confirm(sys);
    expect(refusalOf(() => w.console('projectos')).code).toBe('INSTALLATION_NOT_MAIN_CHECKOUT');
    w.installation.commitRegistryText(registryText([{ ...lines[0]!, projectId: 'another', governedRoot: w.installation.root }]));
    w.installation.confirm(sys);
    expect(refusalOf(() => w.console('another')).code).toBe('INSTALLATION_NOT_MAIN_CHECKOUT');
  });

  it('positive control: the main checkout passes, in any spelling Windows treats as the same path', () => {
    const w = credentialWorld(made, sys);
    expect(w.console('alpha').project).toBe('alpha');
    const shouted = w.installation.root.toUpperCase().split('/').join(String.fromCharCode(92));
    const spelled = metadata.createRequesterAuthority({ installRoot: shouted, stateDir: w.stateDir, nowMs });
    expect(spelled.issueConsoleRun({ projectId: 'alpha' }).project).toBe('alpha');
  });
});

describe('HIGH: a grant needs a receipt', () => {
  it('a committed grant with no receipt releases nothing, and the same grant with one does', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    const blob = commitGrant(w, {});
    const { calls, gate } = gateOf(w);
    expect(release(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(calls).toHaveLength(0);
    confirmGrant(w, blob);
    expect(release(gate, w.console('alpha')).ok).toBe(true);
  });

  it('a changed grant is a new blob, so its old receipt releases nothing', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    grantRelease(w, {});
    const { gate } = gateOf(w);
    expect(release(gate, w.console('alpha')).ok).toBe(true);
    commitGrant(w, { expiresAt: '2027-06-01T00:00:00.000Z' });
    expect(release(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
  });

  it('a receipt file copied in with no admission line releases nothing', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    grantRelease(w, {});
    const { gate } = gateOf(w);
    writeFileSync(join(w.stateDir, 'credential-grant-changes.jsonl'), '');
    expect(release(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
  });

  it('a receipt is written outside every repository, and the installation stays clean', () => {
    const w = credentialWorld(made, sys);
    const blob = commitGrant(w, {});
    confirmGrant(w, blob);
    expect(readdirSync(join(w.stateDir, 'credential-grant-receipts'))).toEqual([`${blob}.json`]);
    const receipt = JSON.parse(readFileSync(join(w.stateDir, 'credential-grant-receipts', `${blob}.json`), 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({ kind: 'credential-grant-receipt', grantBlob: blob, confirmation: 'typed-terminal' });
    expect(String(receipt['statement'])).toContain('nothing more');
    expect(String(receipt['statement'])).toContain('writes the receipt and its line directly');
    expect(git(w.installation.root, 'status', '--porcelain').trim()).toBe('');
  });

  it('a wrong confirmation and a blob that is no grant write nothing', () => {
    const w = credentialWorld(made, sys);
    const blob = commitGrant(w, {});
    expect(refusalOf(() => w.authority.confirmGrant({ blob, typed: 'x'.repeat(12) })).code).toBe('CREDENTIAL_GRANT_CONFIRMATION_MISMATCH');
    const registryBlob = w.installation.blob();
    expect(refusalOf(() => w.authority.confirmGrant({ blob: registryBlob, typed: registryBlob.slice(0, 12) })).code).toBe('CREDENTIAL_GRANT_NOT_FOUND');
    expect(existsSync(join(w.stateDir, 'credential-grant-receipts'))).toBe(false);
  });

  it('a malformed grant cannot be confirmed', () => {
    const w = credentialWorld(made, sys);
    const blob = commitGrant(w, { command: undefined });
    expect(refusalOf(() => w.authority.confirmGrant({ blob, typed: blob.slice(0, 12) })).code).toBe('CREDENTIAL_GRANT_NOT_FOUND');
  });

  it('the command shows what the grant names, asks for the blob, and writes the receipt', async () => {
    const w = credentialWorld(made, sys);
    const blob = commitGrant(w, {});
    const printed: string[] = [];
    const logged = vi.spyOn(console, 'log').mockImplementation((line: string) => { printed.push(line); });
    const asked: string[] = [];
    const terminal = { stdin: { isTTY: true }, stdout: { isTTY: true }, readLine: (question: string) => { asked.push(question); return blob.slice(0, 12); } };
    const deps = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal };
    await expect(cli.main(['credentials', 'grant-receipt', '--blob', blob], deps)).resolves.toBe(0);
    logged.mockRestore();
    const said = printed.join('\n');
    for (const needle of ['alpha', OP, 'read-config', GRANTED_COMMAND.join(' '), PHASE, '2027-01-01T00:00:00.000Z', 'nothing more']) expect(said).toContain(needle);
    expect(asked[0]).toContain('first 12 characters');
    expect(existsSync(join(w.stateDir, 'credential-grant-receipts', `${blob}.json`))).toBe(true);
  });

  it('with no terminal, or no answer, the command refuses and writes nothing', async () => {
    const w = credentialWorld(made, sys);
    const blob = commitGrant(w, {});
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const base = { store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority };
    await expect(cli.main(['credentials', 'grant-receipt', '--blob', blob], { ...base, terminal: { stdin: {}, stdout: {} } })).rejects.toThrow('CREDENTIAL_GRANT_NO_TERMINAL');
    await expect(cli.main(['credentials', 'grant-receipt', '--blob', blob], { ...base, terminal: SPOOFED_TTY })).rejects.toThrow('CREDENTIAL_GRANT_NO_TERMINAL');
    logged.mockRestore();
    expect(existsSync(join(w.stateDir, 'credential-grant-receipts'))).toBe(false);
  });
});

describe('MEDIUM: a flag confirms nothing, and a TTY alone is not a person', () => {
  const depsOf = (w: CredentialWorld, terminal: unknown) => ({ store: w.store, stateDir: join(w.stateDir, 'vault'), nowMs, authority: w.authority, terminal });

  it('--owner-confirm with a spoofed TTY and no typed answer is refused, on every verb', async () => {
    const w = credentialWorld(made, sys);
    seed(w);
    const deps = depsOf(w, SPOOFED_TTY);
    await expect(cli.main(['operation', 'run', '--ref', OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--project', 'alpha', '--owner-confirm', '--', NODE], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['projects', 'unregister', '--project', 'alpha', '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['projects', 'register', '--checkout', w.alpha.root, '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(['session', 'start', '--slot', 'cred-1', '--profile', 'production-operation', '--environment', 'production', '--project', 'alpha', '--checkout', w.alpha.root, '--owner-confirm'], deps)).rejects.toThrow('OWNER PERMIT REQUIRED');
  });

  it('a wrong answer is refused as firmly as none', async () => {
    const w = credentialWorld(made, sys);
    seed(w);
    await expect(cli.main(['operation', 'run', '--ref', OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--project', 'alpha', '--owner-confirm', '--', NODE], depsOf(w, WRONG_ANSWER))).rejects.toThrow('OWNER PERMIT REQUIRED');
  });

  it('positive control: the typed answer confirms the operation', async () => {
    const w = credentialWorld(made, sys);
    seed(w);
    grantRelease(w, {});
    const spawned: unknown[] = [];
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const deps = { ...depsOf(w, TYPES_WHAT_IT_IS_ASKED), gate: { spawnSync: (...args: unknown[]) => { spawned.push(args); return { status: 0, stdout: '', stderr: '' }; } } };
    await expect(cli.main(['operation', 'run', '--ref', OP, '--action', 'read-config', '--env-var', 'X_VALUE', '--phase', PHASE, '--project', 'alpha', '--owner-confirm', '--', NODE, '--version'], deps)).resolves.toBe(0);
    logged.mockRestore();
    expect(spawned).toHaveLength(1);
  });

  it('declaring a reach needs the typed answer, at set and at reach', async () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), readValue: () => VALUE });
    const flags = ['credentials', 'reach', '--ref', GH, '--project', 'alpha', '--reach', 'project'];
    await expect(cli.main(flags, depsOf(w, SPOOFED_TTY))).rejects.toThrow('OWNER PERMIT REQUIRED');
    await expect(cli.main(flags, depsOf(w, WRONG_ANSWER))).rejects.toThrow('OWNER PERMIT REQUIRED');
    expect(w.vault.status({}).find((row: { reference: string }) => row.reference === GH).reach).toBeNull();
    process.env['PROJECTOS_CREDENTIAL_VALUE'] = VALUE;
    await expect(cli.main(['credentials', 'set', '--ref', GH, '--replace', '--from-env', '--project', 'alpha', '--reach', 'project'], depsOf(w, SPOOFED_TTY))).rejects.toThrow('OWNER PERMIT REQUIRED');
    delete process.env['PROJECTOS_CREDENTIAL_VALUE'];
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(cli.main(flags, depsOf(w, TYPES_WHAT_IT_IS_ASKED))).resolves.toBe(0);
    logged.mockRestore();
    expect(w.vault.status({}).find((row: { reference: string }) => row.reference === GH).reach).toBe('project');
  });

  it('changing the platform key needs the typed answer', async () => {
    const w = credentialWorld(made, sys);
    process.env['PROJECTOS_CREDENTIAL_VALUE'] = VALUE;
    await expect(cli.main(['credentials', 'set', '--ref', PLATFORM, '--from-env', '--project', 'projectos'], depsOf(w, SPOOFED_TTY))).rejects.toThrow('OWNER PERMIT REQUIRED');
    expect(w.store.exists(PLATFORM)).toBe(false);
    process.env['PROJECTOS_CREDENTIAL_VALUE'] = VALUE;
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(cli.main(['credentials', 'set', '--ref', PLATFORM, '--from-env', '--project', 'projectos'], depsOf(w, TYPES_WHAT_IT_IS_ASKED))).resolves.toBe(0);
    await expect(cli.main(['credentials', 'delete', '--ref', PLATFORM, '--project', 'projectos'], depsOf(w, SPOOFED_TTY))).rejects.toThrow('OWNER PERMIT REQUIRED');
    logged.mockRestore();
    expect(w.store.exists(PLATFORM)).toBe(true);
    delete process.env['PROJECTOS_CREDENTIAL_VALUE'];
  });
});

describe('the typed confirmation, in a real Windows console', () => {
  /** The real router, in a real ConPTY. `unregister` asks first and touches no credential. The suite's state is private. */
  function inConsole(typed: string): { readonly output: string; readonly code: number } {
    const script = join(PROJECTOS_ROOT, 'scripts/projectos-credential-router.cjs');
    const commandLine = `"${NODE}" "${script}" projects unregister --project synthetic-probe --owner-confirm`;
    const conpty = join(PROJECTOS_ROOT, 'agent/test/support/conpty.ps1');
    const raw = execFileSync(resolveBoundPowerShell(process.env) as string, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', conpty, '-CommandLine', commandLine, '-WorkingDirectory', join(PROJECTOS_ROOT, 'agent'), '-WaitFor', 'to confirm', '-Typed', typed], { encoding: 'utf8', stdio: 'pipe' });
    const output = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g'), '');
    const exit = /EXIT:(-?\d+)/.exec(output);
    return { output, code: exit === null ? -1 : Number(exit[1]) };
  }

  it('reads what is typed: a wrong answer is refused, and the right one goes through', () => {
    const wrong = inConsole('not-the-answer');
    expect(wrong.output).toContain('to confirm');
    expect(wrong.output).toContain('OWNER PERMIT REQUIRED');
    expect(wrong.code).toBe(1);
    const right = inConsole('synthetic-probe');
    expect(right.output).toContain('not registered');
    expect(right.code).toBe(3);
  });
});

describe('MEDIUM: an MCP server with no projected credential does not start', () => {
  const load = createRequire(import.meta.url);

  function prepare(w: CredentialWorld, mcpConfig: unknown) {
    const stateDir = join(w.stateDir, 'mcp-state');
    const projectRegistry = projectRegistryModule.createProjectRegistry({ stateDir });
    const router = routerModule.createSessionRouter({ vault: w.vault, stateDir, projectRegistry, spawn: () => ({ pid: 1, on: () => undefined }) });
    const canonical = reference.asciiLower(w.alpha.root).split('/').join(String.fromCharCode(92));
    const connection = { schemaVersion: '1.0', projectId: 'alpha', canonicalRepositoryRoot: canonical, providers: ['github', 'supabase'], github: { repository: 'synthetic-owner/alpha' }, supabase: { environments: { staging: { projectRef: 'alpharefaaaaaaaaaaaa' } } } };
    projectRegistry.register({ connection, checkoutPath: w.alpha.root, capability: { ownerConfirmation: true } });
    const out = router.prepare({
      slot: 'mcp-1', profileName: 'staging-writer', environment: 'staging', checkoutPath: w.alpha.root, connection, requester: w.console('alpha'), mcpConfig,
      repository: { checkoutPath: w.alpha.root, canonicalRoot: canonical, branch: 'main', remoteUrl: null, remoteRepositoryFullName: connection.github.repository },
      observations: { github: { apiRepositoryFullName: connection.github.repository, remoteRepositoryFullName: connection.github.repository }, supabase: { projectRef: 'alpharefaaaaaaaaaaaa' } },
    });
    if (out.ready === true && out.leaseHeld) router.leases.release({ checkoutPath: w.alpha.root, sessionId: out.sessionId });
    return out;
  }

  it('staging-writer does not offer the Supabase server', () => {
    const profiles = load(join(PROJECTOS_ROOT, 'session-router/session-profiles.cjs')) as { getProfile: (name: string) => { mcpServers: readonly string[] } };
    expect(profiles.getProfile('staging-writer').mcpServers).toEqual(['github', 'vercel']);
  });

  it('a Supabase server in the project\'s config refuses the session, by its server rule', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const out = prepare(w, { mcpServers: { supabase: { env: {} } } });
    expect(out.blocker).toBe('MCP CONFIG INVALID');
    expect(out.detail).toContain("server 'supabase'");
  });

  it('a placeholder for a token this session will not hold refuses, on any server', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const out = prepare(w, { mcpServers: { github: { env: { T: '${SUPABASE_ACCESS_TOKEN}' } } } });
    expect(out.blocker).toBe('MCP CONFIG INVALID');
    expect(out.detail).toContain('SUPABASE_ACCESS_TOKEN');
  });

  it('positive control: a server with a projected credential, and the non-secret project ref, start', () => {
    const w = credentialWorld(made, sys);
    w.vault.provision({ reference: GH, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    const out = prepare(w, { mcpServers: { github: { env: { T: '${GH_TOKEN}', R: '${SUPABASE_PROJECT_REF}' } } } });
    expect(out.ready).toBe(true);
  });
});

describe('MEDIUM: a grant names the exact command', () => {
  it('a different argument releases nothing', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    grantRelease(w, {});
    const { calls, gate } = gateOf(w);
    expect(release(gate, w.console('alpha'), ['--eval', 'process.exit(0)']).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(release(gate, w.console('alpha'), ['--version', '--extra']).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(release(gate, w.console('alpha'), []).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(calls).toHaveLength(0);
    expect(release(gate, w.console('alpha')).ok).toBe(true);
  });

  it('a different executable releases nothing, and the same path in another spelling is the same one', () => {
    const w = credentialWorld(made, sys);
    seed(w);
    grantRelease(w, { command: ['C:/somewhere/else/node.exe', '--version'] });
    const { gate } = gateOf(w);
    expect(release(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    grantRelease(w, { command: [NODE.toUpperCase().split(String.fromCharCode(92)).join('/'), '--version'] });
    expect(release(gate, w.console('alpha')).ok).toBe(true);
  });

  it.each([
    ['text, not a list', { command: 'node --version' }],
    ['an empty list', { command: [] }],
    ['a non-text item', { command: [NODE, 1] }],
  ])('a command that is %s releases nothing', (_label, over) => {
    const w = credentialWorld(made, sys);
    seed(w);
    const blob = commitGrant(w, over);
    expect(refusalOf(() => w.authority.confirmGrant({ blob, typed: blob.slice(0, 12) })).code).toBe('CREDENTIAL_GRANT_NOT_FOUND');
    const { calls, gate } = gateOf(w);
    expect(release(gate, w.console('alpha')).blocker).toBe('CREDENTIAL_GRANT_REQUIRED');
    expect(calls).toHaveLength(0);
  });
});

describe('LOW: account-wide by its name, as far as a name goes', () => {
  it.each(['supabase-access-token', 'supabase-pat', 'supabase_pat', 'github-pat', 'personal-access-token', 'my.personal.access.token', 'vercel-access-token'])('%s reads as account-wide', (name) => {
    expect(reference.isAccountWide(name)).toBe(true);
  });

  it.each(['gh-token', 'vercel-token', 'service-role-key', 'db-password', 'compatible-key', 'patch-signing-key'])('%s does not', (name) => {
    expect(reference.isAccountWide(name)).toBe(false);
  });

  it('a `supabase-pat` declared project-wide is refused for what it is called', () => {
    const w = credentialWorld(made, sys);
    const pat = 'ProjectOS/alpha/staging/supabase/supabase-pat';
    w.vault.provision({ reference: pat, requester: w.console('alpha'), reach: 'project', readValue: () => VALUE });
    grantRelease(w, { references: [pat] });
    const { gate } = gateOf(w);
    const requester = w.console('alpha');
    const permit = gate.grantPermit({ reference: pat, action: 'read-config', requester, capability: { ownerConfirmation: true }, phaseId: PHASE });
    expect(gate.run({ reference: pat, action: 'read-config', requester, permit, capability: { ownerConfirmation: true }, command: NODE, args: ['--version'], envVarName: 'SYNTHETIC_VALUE' }).blocker).toBe('REACH_CROSSES_TENANTS');
  });
});

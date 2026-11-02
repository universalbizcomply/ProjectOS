/**
 * PROJECTOS-TENANT-PRINCIPAL1A: the tenant, derived from committed bytes, at real crossings.
 *
 * REAL GIT, REAL FILES. Every registry here is committed in a real repository, every worktree is made by
 * `git worktree add`, and every record lands in a real state directory. `test/setup.ts` replaces the run
 * entry's tenant refusal for the rest of the suite; this file takes the real one back.
 *
 * A REFUSAL COUNTS ONLY BESIDE ITS POSITIVE CONTROL. Each rule is shown letting the good case through in
 * the same world, so a fail-closed default cannot pass for the rule.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitEnvelope, deriveIdempotencyKey, mintEnvelope, parseActionRegistry } from '@projectos/core';
import { run as cli, readOnlyUnderPlatformStop } from '../src/cli.js';
import type { CommandContext, CommandResult } from '../src/context.js';
import { run as runCommand } from '../src/commands/run.js';
import { tenant, tenantReceiptGrant, terminalTenantReceiptConfirm, type TenantReceiptConfirm } from '../src/commands/tenant.js';
import {
  admitBoundary,
  CONTROL_CENTER_VERBS_WITHOUT_TENANT,
  controlCenterTenantRefusal,
  deriveProjectTenant,
  deriveTenant,
  projectSelectionRefusal,
  readInstallationRegistries,
  RUN_ENVELOPE_WINDOW_MS,
  runStartTenantRefusal,
  tenantSourceOf,
  type DerivedTenant,
} from '../src/governedContext.js';
import {
  appendDurableLine,
  canonicalCheckoutRoot,
  claimIdempotencyKey,
  crossTenantRefusal,
  ENVELOPE_RECORDS_FILENAME,
  envelopeRecorder,
  TENANT_CHANGE_RECORDS_FILENAME,
  NO_GRANT,
  readTenantReceipt,
  readWorktreeListing,
  settleIdempotencyKey,
  TENANT_RECEIPT_FILENAME,
  TENANT_RECEIPT_KIND,
  TENANT_RECEIPT_STATEMENT,
  tenantReceiptCommand,
  writeTenantReceipt,
} from '../src/installation/tenantRegistry.js';
import { nodeSystem, type System } from '../src/system.js';
import {
  AGENCY_TENANT,
  cleanUp,
  commitAll,
  FIXTURE_NOW,
  forward,
  git,
  holdRecordLock,
  linesOf,
  makeGovernedProject,
  makeInstallation,
  makeProject,
  OWNER_TENANT,
  registryText,
  tempDir,
  type Installation,
  type RegistryLine,
} from './support/tenantWorld.js';

// THE REAL ENTRY REFUSAL. `test/setup.ts` replaces it for fixtures that are in no registry.
vi.unmock('../src/governedContext.js');

const made: string[] = [];
afterEach(() => cleanUp(made));

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };

interface World {
  readonly installation: Installation;
  readonly alpha: { readonly root: string; readonly repository: string };
  readonly beta: { readonly root: string; readonly repository: string };
  readonly gamma: { readonly root: string; readonly repository: string };
  readonly ctxAt: (root: string) => CommandContext;
}

/** `alpha` and `beta` in one tenant, `gamma` in the other, as ADR-T1 lists its three. */
function world(confirmed = true): World {
  const alpha = makeProject(made, 'alpha');
  const beta = makeProject(made, 'beta');
  const gamma = makeProject(made, 'gamma');
  const installation = makeInstallation(made, [
    { projectId: 'alpha', repository: alpha.repository, governedRoot: alpha.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'beta', repository: beta.repository, governedRoot: beta.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'gamma', repository: gamma.repository, governedRoot: gamma.root, tenant: AGENCY_TENANT, domain: 'business' },
  ]);
  if (confirmed) installation.confirm(sys);
  return {
    installation,
    alpha,
    beta,
    gamma,
    ctxAt: (root) => Object.assign({ sys, root }, installation.ctxFields),
  };
}

function derive(w: World, root: string) {
  return deriveProjectTenant(sys, root, tenantSourceOf(w.ctxAt(root)));
}

function refusedCode(result: ReturnType<typeof derive>): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.code;
}

function bound(result: ReturnType<typeof derive>): DerivedTenant {
  if (!result.ok) throw new Error(`expected a tenant, got ${result.code}: ${result.reasons.join('; ')}`);
  return result;
}

function records(w: World): readonly Record<string, unknown>[] {
  return linesOf(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
}

const textOf = (result: CommandResult | readonly string[] | null): string => {
  if (result === null) return '';
  return ('lines' in result ? result.lines : result).join('\n');
};

describe('the committed registry', () => {
  it('derives each project its own tenant and domain from committed bytes', () => {
    const w = world();
    const alpha = bound(derive(w, w.alpha.root));
    const gamma = bound(derive(w, w.gamma.root));
    expect([alpha.binding.tenant, alpha.binding.domain, alpha.binding.via]).toEqual([OWNER_TENANT, 'develop', 'governed-root']);
    expect([gamma.binding.tenant, gamma.binding.domain]).toEqual([AGENCY_TENANT, 'business']);
  });

  it('refuses a registry edited in the working tree, and a commit of it is what would carry authority', () => {
    const w = world();
    expect(derive(w, w.alpha.root).ok).toBe(true);
    writeFileSync(join(w.installation.root, 'projectos', 'security', 'tenant-registry.json'), registryText([]));
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_UNREADABLE');
  });

  it('a working-tree edit hidden from `git diff` still has no authority: the bytes judged are the committed ones', () => {
    const w = world();
    const rel = 'projectos/security/tenant-registry.json';
    const flipped = readFileSync(join(w.installation.root, rel), 'utf8').split(OWNER_TENANT).join('PLACEHOLDER').split(AGENCY_TENANT).join(OWNER_TENANT).split('PLACEHOLDER').join(AGENCY_TENANT);
    git(w.installation.root, 'update-index', '--assume-unchanged', rel);
    writeFileSync(join(w.installation.root, rel), flipped);
    expect(git(w.installation.root, 'diff', '--name-only', 'HEAD', '--', rel).trim()).toBe('');
    expect(bound(derive(w, w.alpha.root)).binding.tenant).toBe(OWNER_TENANT);
  });

  it('refuses an installation that commits no registry, by name', () => {
    const w = world();
    git(w.installation.root, 'rm', '--quiet', '--cached', 'projectos/security/tenant-registry.json');
    rmSync(join(w.installation.root, 'projectos', 'security', 'tenant-registry.json'));
    commitAll(w.installation.root, 'no registry');
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_UNREADABLE');
  });

  it('refuses unreadable JSON, by name', () => {
    const w = world();
    w.installation.commitRegistryText('{ not json');
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_UNREADABLE');
  });

  it('a duplicate entry refuses the whole file by name, the perfect lines included', () => {
    const w = world();
    const line: RegistryLine = { projectId: 'alpha', repository: w.alpha.repository, governedRoot: w.alpha.root, tenant: OWNER_TENANT, domain: 'develop' };
    const beta: RegistryLine = { projectId: 'beta', repository: w.beta.repository, governedRoot: w.beta.root, tenant: OWNER_TENANT, domain: 'develop' };
    w.installation.commitLines([line, beta, { ...line, tenant: AGENCY_TENANT }]);
    w.installation.confirm(sys);
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_DUPLICATE');
    // Beta's own line is perfect, and the file is still refused: the whole file, or nothing.
    expect(refusedCode(derive(w, w.beta.root))).toBe('TENANT_REGISTRY_DUPLICATE');
  });

  it('a wildcard refuses the whole file by name', () => {
    const w = world();
    w.installation.commitLines([{ projectId: 'alpha', repository: w.alpha.repository, governedRoot: 'C:/dev/*', tenant: OWNER_TENANT, domain: 'develop' }]);
    w.installation.confirm(sys);
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_WILDCARD');
  });

  it('refuses a broken committed action registry, because the class comes from it', () => {
    const w = world();
    const actions = join(w.installation.root, 'projectos', 'security', 'action-registry.json');
    writeFileSync(actions, JSON.stringify({ schemaVersion: '1.0.0' }));
    commitAll(w.installation.root, 'break the actions');
    expect(refusedCode(derive(w, w.alpha.root))).toBe('ACTION_REGISTRY_UNREADABLE');
  });

  it('reads the REAL committed registries of this repository', () => {
    const registries = readInstallationRegistries(nodeSystem, tenantSourceOf({}).installRoot);
    if (!registries.ok) throw new Error(registries.reasons.join('; '));
    const tenants = Object.fromEntries(registries.registry.projects.map((p) => [p.projectId, p.tenant]));
    expect(tenants['projectos']).toBe(OWNER_TENANT);
    expect(tenants['polygo']).toBe(OWNER_TENANT);
    expect(tenants['seo-agency']).toBe(AGENCY_TENANT);
    expect(tenants['dead-aisle']).toBe(OWNER_TENANT);
    expect(Object.values(tenants).filter((tenant) => tenant === AGENCY_TENANT)).toEqual([AGENCY_TENANT]);
  });
});

describe('the owner receipt', () => {
  it('refuses a registry with no receipt by name, though its last commit is named Murad, and names the one line to run', () => {
    const w = world(false);
    expect(git(w.installation.root, 'log', '-1', '--format=%an').trim()).toBe('Murad');
    const refused = derive(w, w.alpha.root);
    expect(refusedCode(refused)).toBe('TENANT_REGISTRY_NO_RECEIPT');
    expect(refused.ok ? '' : refused.reasons.join('\n')).toContain(tenantReceiptCommand(w.installation.root, w.installation.blob()));
    // The positive control: the same world, with the receipt.
    w.installation.confirm(sys);
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });

  it('a registry changed by a later commit carries no authority until the owner confirms the new blob', () => {
    const w = world();
    expect(derive(w, w.alpha.root).ok).toBe(true);
    w.installation.commitLines([{ projectId: 'alpha', repository: w.alpha.repository, governedRoot: w.alpha.root, tenant: AGENCY_TENANT, domain: 'business' }]);
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    w.installation.confirm(sys);
    expect(bound(derive(w, w.alpha.root)).binding.tenant).toBe(AGENCY_TENANT);
  });

  it('going back to an older registry needs a new confirmation: there is one receipt, not one per blob', () => {
    const w = world();
    const original = readFileSync(join(w.installation.root, 'projectos', 'security', 'tenant-registry.json'), 'utf8');
    w.installation.commitLines([]);
    w.installation.confirm(sys);
    w.installation.commitRegistryText(original);
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
  });

  it('re-committing the same bytes changes nothing: the receipt names the blob, not the commit', () => {
    const w = world();
    commitAll(w.installation.root, 'an empty commit on top');
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });

  it('does not believe a damaged receipt, one with an extra field, or one of another kind', () => {
    const w = world();
    const path = join(w.installation.stateDir, TENANT_RECEIPT_FILENAME);
    const good = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(derive(w, w.alpha.root).ok).toBe(true);
    for (const bytes of ['{ not json', 'null', '[]', JSON.stringify({ ...good, grantedBy: 'owner' }), JSON.stringify({ ...good, kind: 'stop-lift' }), JSON.stringify({ ...good, schemaVersion: '9' }), JSON.stringify({ ...good, confirmation: 'by-flag' })]) {
      writeFileSync(path, bytes);
      expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    }
  });

  it('an environment variable cannot point the receipt somewhere else', () => {
    const w = world();
    const elsewhere = tempDir(made, 'projectos-tenant-elsewhere-');
    writeTenantReceipt(sys, elsewhere, w.installation.blob(), FIXTURE_NOW, 'ENV-elsewhere');
    const prior = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = elsewhere;
    try {
      // No state directory on the context, so production's own rule answers: the OS must agree.
      expect(tenantSourceOf({ sys, root: w.alpha.root }).stateDir).toBeNull();
      const source = { installRoot: w.installation.root, stateDir: tenantSourceOf({ sys, root: w.alpha.root }).stateDir };
      expect(refusedCode(deriveProjectTenant(sys, w.alpha.root, source))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    } finally {
      process.env['LOCALAPPDATA'] = prior;
    }
  });
});

describe('`tenant receipt`', () => {
  const typed = (w: World): TenantReceiptConfirm => () => ({ kind: 'typed', text: w.installation.blob().slice(0, 12) });
  const receiptAt = (w: World, flags: Record<string, string | boolean> = {}, confirm?: TenantReceiptConfirm): CommandResult =>
    tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob(), ...flags }, ['receipt'], confirm);

  it('refuses with NO TERMINAL: the production confirmation answers no-terminal unless stdin and stdout are both a TTY', () => {
    const ask = (): string => {
      throw new Error('a process with no terminal must not be asked');
    };
    for (const [stdinIsTTY, stdoutIsTTY] of [[false, false], [true, false], [false, true]] as const) {
      expect(terminalTenantReceiptConfirm(() => ({ stdinIsTTY, stdoutIsTTY, ask }))('b', [])).toEqual({ kind: 'no-terminal' });
    }
    expect(terminalTenantReceiptConfirm(() => ({ stdinIsTTY: true, stdoutIsTTY: true, ask: () => 'typed text' }))('b', [])).toEqual({ kind: 'typed', text: 'typed text' });
    expect(terminalTenantReceiptConfirm(() => ({ stdinIsTTY: true, stdoutIsTTY: true, ask: () => null }))('b', [])).toEqual({ kind: 'no-terminal' });
  });

  it('this very process has no terminal: the real command refuses by name and writes no receipt', () => {
    const w = world(false);
    const r = cli(w.ctxAt(w.alpha.root), ['tenant', 'receipt', '--blob', w.installation.blob(), '--as', 'owner']);
    expect(r.code).toBe(2);
    expect(textOf(r)).toContain('REFUSED (TENANT_RECEIPT_NEEDS_A_TERMINAL)');
    expect(textOf(r)).toContain('`--as` was given and was ignored');
    expect(textOf(r)).toContain(TENANT_RECEIPT_STATEMENT);
    expect(readTenantReceipt(sys, w.installation.stateDir).kind).toBe('absent');
    expect(linesOf(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME)).toEqual([]);
  });

  it('refuses a WRONG typed confirmation, near misses included', () => {
    const w = world(false);
    const blob = w.installation.blob();
    for (const text of ['', blob.slice(0, 11), blob.slice(0, 13), blob.slice(0, 12).toUpperCase(), ` ${blob.slice(0, 12)}`]) {
      const r = receiptAt(w, {}, () => ({ kind: 'typed', text }));
      expect(textOf(r)).toContain('REFUSED (TENANT_RECEIPT_CONFIRMATION_MISMATCH)');
    }
    expect(readTenantReceipt(sys, w.installation.stateDir).kind).toBe('absent');
  });

  it('a person typing it makes the receipt, through the door at P5, and the registry then carries authority', () => {
    const w = world(false);
    const r = receiptAt(w, {}, typed(w));
    expect(r.code).toBe(0);
    expect(textOf(r)).toContain('TENANT REGISTRY CONFIRMED');
    expect(textOf(r)).toContain(TENANT_RECEIPT_STATEMENT);
    const read = readTenantReceipt(sys, w.installation.stateDir);
    expect(read.kind === 'ok' ? [read.receipt.kind, read.receipt.registryBlob] : []).toEqual([TENANT_RECEIPT_KIND, w.installation.blob()]);
    const lines = linesOf(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME);
    expect(lines.map((line) => [line['stage'], line['outcome']])).toEqual([['admission', 'allowed'], ['execution', 'allowed']]);
    const envelope = lines[0]?.['envelope'] as Record<string, unknown>;
    expect([envelope['action'], envelope['actionClass'], envelope['subjectHash']]).toEqual(['tenant-registry-change', 'P5', w.installation.blob()]);
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });

  it('asks the person with the bindings in front of them', () => {
    const w = world(false);
    let shown: readonly string[] = [];
    receiptAt(w, {}, (_blob, summary) => {
      shown = summary;
      return { kind: 'no-terminal' };
    });
    expect(shown.join('\n')).toContain(`gamma: tenant ${AGENCY_TENANT}, domain business`);
  });

  it('refuses a blob that is not the committed one', () => {
    const w = world(false);
    const r = tenant(w.ctxAt(w.alpha.root), { blob: 'a'.repeat(40) }, ['receipt'], typed(w));
    expect(textOf(r)).toContain('REFUSED (TENANT_RECEIPT_BLOB_MISMATCH)');
    expect(readTenantReceipt(sys, w.installation.stateDir).kind).toBe('absent');
  });

  it('takes no receipt without --blob', () => {
    const w = world(false);
    expect(tenant(w.ctxAt(w.alpha.root), {}, ['receipt'], typed(w)).code).toBe(1);
  });

  it('an admission that cannot be recorded makes no receipt', () => {
    const w = world(false);
    holdRecordLock(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME);
    const r = receiptAt(w, {}, typed(w));
    expect(r.code).toBe(2);
    expect(textOf(r)).toContain('REFUSED (ENVELOPE_NOT_RECORDED)');
    expect(readTenantReceipt(sys, w.installation.stateDir).kind).toBe('absent');
  });

  it('the grant is for this blob alone: the door refuses the same action on any other subject', () => {
    const w = world();
    const derived = bound(derive(w, w.alpha.root));
    const blob = w.installation.blob();
    const grant = tenantReceiptGrant(blob);
    const request = { action: 'tenant-registry-change', principal: 'implementer' as const, scope: ['x'], windowMs: 60_000, intentScope: 'tenant-receipt' };
    expect(admitBoundary(sys, w.installation.stateDir, derived, { ...request, subjectHash: 'c'.repeat(40) }, grant)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
    expect(admitBoundary(sys, w.installation.stateDir, derived, { ...request, subjectHash: blob }, grant).admitted).toBe(true);
    expect(admitBoundary(sys, w.installation.stateDir, derived, { ...request, subjectHash: blob })).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
    expect(admitBoundary(sys, w.installation.stateDir, derived, { ...request, action: 'cross-tenant-access', subjectHash: blob }, grant)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
  });

  it('answers a second time without another confirmation, and changes nothing', () => {
    const w = world();
    const before = readFileSync(join(w.installation.stateDir, TENANT_RECEIPT_FILENAME), 'utf8');
    const r = receiptAt(w, {}, () => {
      throw new Error('nothing to confirm');
    });
    expect(r.code).toBe(0);
    expect(textOf(r)).toContain('already has a receipt');
    expect(readFileSync(join(w.installation.stateDir, TENANT_RECEIPT_FILENAME), 'utf8')).toBe(before);
  });

  it('is refused under the emergency stop, while `tenant show` is not', () => {
    expect(readOnlyUnderPlatformStop('tenant', ['receipt'], {})).toBe(false);
    expect(readOnlyUnderPlatformStop('tenant', ['show'], {})).toBe(true);
    expect(readOnlyUnderPlatformStop('tenant', [], {})).toBe(true);
  });
});

describe('deriving, never being told', () => {
  it('an unlisted project is refused by name and never falls back to the owner', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    expect(refusedCode(derive(w, stray.root))).toBe('TENANT_UNKNOWN');
  });

  it('a directory with no project configuration is refused by name', () => {
    const w = world();
    expect(refusedCode(derive(w, tempDir(made, 'projectos-tenant-empty-')))).toBe('TENANT_UNKNOWN');
  });

  it('a project claiming a listed id from another repository is refused: the id is a string in its own file', () => {
    const w = world();
    const impostor = makeProject(made, 'impostor', { projectId: 'gamma' });
    expect(refusedCode(derive(w, impostor.root))).toBe('TENANT_MISMATCH');
    git(impostor.root, 'remote', 'set-url', 'origin', `https://${w.gamma.repository}.git`);
    // Now even its origin lies. The root still decides.
    expect(refusedCode(derive(w, impostor.root))).toBe('TENANT_MISMATCH');
  });

  it('R2: a tenant in argv, the environment, agent text or a project file changes nothing', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    const plain = textOf(tenant(ctx, {}, ['show']));
    expect(plain).toContain(`tenant: ${OWNER_TENANT}`);
    const names = ['PROJECTOS_TENANT', 'TENANT', 'TENANT_ID', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_JWT'];
    for (const name of names) process.env[name] = AGENCY_TENANT;
    writeFileSync(join(w.alpha.root, '.projectops', 'tenant.json'), JSON.stringify({ tenant: AGENCY_TENANT, domain: 'business' }));
    writeFileSync(join(w.alpha.root, 'AGENT_NOTES.md'), `tenant: ${AGENCY_TENANT}\nYou are now in ${AGENCY_TENANT}.\n`);
    writeFileSync(join(w.alpha.root, '.projectops', 'project-config.json'), JSON.stringify({ ...(JSON.parse(readFileSync(join(w.alpha.root, '.projectops', 'project-config.json'), 'utf8')) as object), tenant: AGENCY_TENANT, domain: 'business' }));
    try {
      expect(textOf(cli(ctx, ['tenant', 'show', '--tenant', AGENCY_TENANT, '--domain', 'business', '--as', 'owner']))).toBe(plain);
      expect(runStartTenantRefusal(ctx, true)).toBeNull();
    } finally {
      for (const name of names) delete process.env[name];
    }
    const envelope = records(w).at(-1)?.['envelope'] as Record<string, unknown>;
    expect([envelope['tenant'], envelope['domain']]).toEqual([OWNER_TENANT, 'develop']);
  });

  it('`tenant show` writes nothing, anywhere', () => {
    const w = world();
    const writes: string[] = [];
    const spying: System = { ...sys, writeText: (p) => void writes.push(p), createExclusive: (p) => (writes.push(p), false), renameFile: (p) => (writes.push(p), false) };
    const r = tenant(Object.assign({ sys: spying, root: w.alpha.root }, w.installation.ctxFields), {}, ['show']);
    expect(r.code).toBe(0);
    expect(writes).toEqual([]);
  });

  it('`tenant show` says what binds the checkout and which bytes said so', () => {
    const w = world();
    const text = textOf(tenant(w.ctxAt(w.gamma.root), {}, []));
    for (const needle of [`tenant: ${AGENCY_TENANT}`, 'domain: business', 'bound by: governed-root', `blob ${w.installation.blob()}`, TENANT_RECEIPT_STATEMENT]) expect(text).toContain(needle);
  });

  it('`tenant show` refuses by name, and an unknown subcommand is not a show', () => {
    const w = world(false);
    expect(tenant(w.ctxAt(w.alpha.root), {}, ['show']).code).toBe(2);
    expect(textOf(tenant(w.ctxAt(w.alpha.root), {}, ['show']))).toContain('TENANT_REGISTRY_NO_RECEIPT');
    expect(tenant(w.ctxAt(w.alpha.root), {}, ['grant']).code).toBe(1);
  });
});

describe('one spelling of a checkout', () => {
  it('passes its own realpath, whatever the slashes or the drive letter case', () => {
    const dir = tempDir(made, 'projectos-tenant-real-');
    expect(canonicalCheckoutRoot(dir)).toEqual({ ok: true, root: dir });
    expect(canonicalCheckoutRoot(dir.split('/').join(String.fromCharCode(92)))).toEqual({ ok: true, root: dir });
    expect(canonicalCheckoutRoot(`${dir.slice(0, 1).toLowerCase()}${dir.slice(1)}`)).toEqual({ ok: true, root: dir });
  });

  it('refuses a REAL junction to a registered root, where the plain string compare would be misled', () => {
    const w = world();
    const link = join(tempDir(made, 'projectos-tenant-links-'), 'alias');
    symlinkSync(w.alpha.root, link, 'junction');
    expect(canonicalCheckoutRoot(link)).toMatchObject({ ok: false, code: 'TENANT_CHECKOUT_ALIAS' });
    expect(refusedCode(derive(w, forward(link)))).toBe('TENANT_CHECKOUT_ALIAS');
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });

  it('refuses an 8.3 short name: its realpath is another spelling', () => {
    const shortName = 'C:/dev/PROJEC~1';
    expect(canonicalCheckoutRoot(shortName, () => 'C:\\dev\\ProjectOS')).toMatchObject({ ok: false, code: 'TENANT_CHECKOUT_ALIAS' });
  });

  it('refuses a device prefix, a UNC path, an alternate stream, a trailing dot and a relative path', () => {
    const real = (): string => 'C:\\dev\\ProjectOS';
    for (const alias of ['\\\\?\\C:\\dev\\ProjectOS', '\\\\localhost\\C$\\dev\\ProjectOS', 'C:/dev/ProjectOS::$DATA', 'C:/dev/ProjectOS.', 'C:/dev/x/../ProjectOS', 'dev/ProjectOS']) {
      expect(canonicalCheckoutRoot(alias, real)).toMatchObject({ ok: false, code: 'TENANT_CHECKOUT_ALIAS' });
    }
    expect(canonicalCheckoutRoot('C:/dev/ProjectOS', real)).toEqual({ ok: true, root: 'C:/dev/ProjectOS' });
  });

  it('refuses a path that does not exist', () => {
    expect(canonicalCheckoutRoot('C:/dev/no-such-directory-here-at-all')).toMatchObject({ ok: false, code: 'TENANT_CHECKOUT_ALIAS' });
  });
});

describe('linked worktrees, against real git (ADR-T1 section 5)', () => {
  function worktreeOf(root: string, name: string): string {
    const parent = tempDir(made, 'projectos-tenant-wt-');
    const path = `${parent}/${name}`;
    git(root, 'worktree', 'add', '--quiet', '-b', `branch-${name}`, path);
    return path;
  }

  it('a worktree the registered root lists takes that project and tenant, and says how it was bound', () => {
    const w = world();
    const path = worktreeOf(w.gamma.root, 'gamma-wt');
    const derived = bound(derive(w, path));
    expect([derived.binding.projectId, derived.binding.tenant, derived.binding.domain, derived.binding.via]).toEqual(['gamma', AGENCY_TENANT, 'business', 'linked-worktree']);
  });

  it('the listing is asked of the registered root, never of the checkout', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-wt');
    const asked: string[] = [];
    const spying: System = {
      ...sys,
      exec: (cmd, args, options) => {
        if (args.includes('worktree')) asked.push(String(args[1]));
        return sys.exec(cmd, args, options);
      },
    };
    expect(deriveProjectTenant(spying, path, tenantSourceOf(w.ctxAt(path))).ok).toBe(true);
    expect(asked).toEqual([w.alpha.root]);
    expect(readWorktreeListing(sys, w.alpha.root)?.paths.map((p) => p.toLowerCase())).toEqual([path.toLowerCase()]);
  });

  it('a directory whose `.git` FILE points at the registered repository is refused: it is not in the listing', () => {
    const w = world();
    const decoy = tempDir(made, 'projectos-tenant-decoy-');
    mkdirSync(join(decoy, '.projectops'), { recursive: true });
    writeFileSync(join(decoy, '.projectops', 'project-config.json'), readFileSync(join(w.alpha.root, '.projectops', 'project-config.json')));
    writeFileSync(join(decoy, '.git'), `gitdir: ${w.alpha.root}/.git\n`);
    // Git itself agrees it is that repository, so its origin and its common dir both say so.
    expect(git(decoy, 'remote', 'get-url', 'origin').trim()).toBe(`https://${w.alpha.repository}.git`);
    expect(refusedCode(derive(w, decoy))).toBe('TENANT_MISMATCH');
  });

  it('something new at a removed worktree\'s path is refused, though real git still lists that path and does not call it prunable', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-gone');
    expect(derive(w, path).ok).toBe(true);
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path, { recursive: true });
    git(path, 'init', '--quiet');
    git(path, 'remote', 'add', 'origin', `https://${w.alpha.repository}.git`);
    mkdirSync(join(path, '.projectops'), { recursive: true });
    writeFileSync(join(path, '.projectops', 'project-config.json'), readFileSync(join(w.alpha.root, '.projectops', 'project-config.json')));
    const listing = git(w.alpha.root, 'worktree', 'list', '--porcelain');
    expect(listing.toLowerCase()).toContain(path.toLowerCase());
    expect(listing).not.toContain('prunable');
    expect(refusedCode(derive(w, path))).toBe('TENANT_MISMATCH');
  });

  it('a removed worktree git does call prunable attaches nothing: a plain directory at that path is refused', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-pruned');
    rmSync(path, { recursive: true, force: true });
    mkdirSync(join(path, '.projectops'), { recursive: true });
    writeFileSync(join(path, '.projectops', 'project-config.json'), readFileSync(join(w.alpha.root, '.projectops', 'project-config.json')));
    expect(git(w.alpha.root, 'worktree', 'list', '--porcelain')).toContain('prunable');
    expect(refusedCode(derive(w, path))).toBe('TENANT_MISMATCH');
  });

  it('a worktree of one project claiming another project is refused: no listing at that root names it', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-as-gamma');
    git(path, 'remote', 'set-url', 'origin', `https://${w.gamma.repository}.git`);
    writeFileSync(join(path, '.projectops', 'project-config.json'), readFileSync(join(w.gamma.root, '.projectops', 'project-config.json')));
    expect(refusedCode(derive(w, path))).toBe('TENANT_MISMATCH');
  });

  it('a registered root that will not list is no route, and the root itself still binds', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-silent');
    const silent: System = { ...sys, exec: (cmd, args, options) => (args.includes('worktree') ? { code: 128, stdout: '', stderr: 'no' } : sys.exec(cmd, args, options)) };
    const source = tenantSourceOf(w.ctxAt(path));
    expect(deriveProjectTenant(silent, path, source).ok).toBe(false);
    expect(deriveProjectTenant(silent, w.alpha.root, source).ok).toBe(true);
  });

  it('a governed run stays admitted in a worktree, and its record shows the worktree', () => {
    const w = world();
    const path = worktreeOf(w.alpha.root, 'alpha-run');
    expect(runStartTenantRefusal(w.ctxAt(path), true)).toBeNull();
    const line = records(w).at(-1) as Record<string, unknown>;
    expect([line['outcome'], line['via']]).toEqual(['allowed', 'linked-worktree']);
    expect((line['envelope'] as Record<string, unknown>)['tenant']).toBe(OWNER_TENANT);
  });

  it('a real governed `run --dry-run` walks to the worker in a linked worktree, and the same worktree is refused once its project is unlisted', () => {
    const w = world();
    const governed = makeGovernedProject(made, 'delta');
    const line: RegistryLine = { projectId: 'delta', repository: governed.repository, governedRoot: governed.root, tenant: OWNER_TENANT, domain: 'develop' };
    w.installation.commitLines([line]);
    w.installation.confirm(sys);
    const path = worktreeOf(governed.root, 'delta-run');
    const walked = runCommand(w.ctxAt(path), { 'dry-run': true });
    expect(textOf(walked)).toContain('Starting TENANT-FIXTURE1A on branch-delta-run');
    expect(textOf(walked)).toContain('DRY RUN: nothing was written and no worker was started.');
    expect(walked.code).toBe(0);
    w.installation.commitLines([]);
    w.installation.confirm(sys);
    const refused = runCommand(w.ctxAt(path), { 'dry-run': true });
    expect(refused.code).toBe(2);
    expect(textOf(refused)).toContain('REFUSED (TENANT_UNKNOWN)');
    expect(textOf(refused)).not.toContain('DRY RUN');
  });
});

describe('`projectos run`', () => {
  it('refuses an unlisted project before anything starts, recorded, in both forms of the command', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    for (const flags of [{ execute: true }, { 'dry-run': true }]) {
      const r = runCommand(w.ctxAt(stray.root), flags);
      expect(r.code).toBe(2);
      expect(textOf(r)).toContain('REFUSED (TENANT_UNKNOWN)');
      expect(textOf(r)).toContain('Nothing was prepared and nothing was started.');
    }
    // A dry run writes nothing, so the one line is `--execute`'s.
    const lines = records(w);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ stage: 'admission', outcome: 'refused', rule: 'R2', envelope: null });
    expect(JSON.stringify(lines[0]?.['reasons'])).toContain('TENANT_UNKNOWN');
  });

  it('refuses every project until the owner confirms the registry, and says exactly what to run', () => {
    const w = world(false);
    const r = runCommand(w.ctxAt(w.alpha.root), { execute: true });
    expect(r.code).toBe(2);
    expect(textOf(r)).toContain('REFUSED (TENANT_REGISTRY_NO_RECEIPT)');
    expect(textOf(r)).toContain(tenantReceiptCommand(w.installation.root, w.installation.blob()));
    expect(textOf(r)).toContain('Git Bash gives no terminal');
  });

  it('a run whose admission cannot be recorded does not start', () => {
    const w = world();
    expect(runStartTenantRefusal(w.ctxAt(w.alpha.root), true)).toBeNull();
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    const r = runCommand(w.ctxAt(w.alpha.root), { execute: true });
    expect(r.code).toBe(2);
    expect(textOf(r)).toContain('REFUSED (ENVELOPE_NOT_RECORDED)');
    expect(textOf(r)).toContain('.jsonl.lock');
  });

  it('a refusal that cannot be recorded stops the operation, and says it was not recorded', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    expect(textOf(runStartTenantRefusal(w.ctxAt(stray.root), true))).not.toContain('REFUSAL_NOT_RECORDED');
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    const refused = runStartTenantRefusal(w.ctxAt(stray.root), true);
    expect(textOf(refused)).toContain('REFUSED (TENANT_UNKNOWN)');
    expect(textOf(refused)).toContain('REFUSAL_NOT_RECORDED');
  });

  it('records the kernel\'s statement: implementer, kernel actor, the commit, a window, never a budget', () => {
    const w = world();
    expect(runStartTenantRefusal(w.ctxAt(w.alpha.root), true)).toBeNull();
    const line = records(w)[0] as Record<string, unknown>;
    expect(line).toMatchObject({ stage: 'admission', outcome: 'allowed', via: 'governed-root', registered: true });
    const envelope = line['envelope'] as Record<string, unknown>;
    expect(envelope).toMatchObject({
      action: 'run-start',
      actionClass: 'P2',
      principal: 'implementer',
      actor: { agent: 'projectos-kernel', provider: 'projectos', model: 'none' },
      project: 'alpha',
      subjectHash: git(w.alpha.root, 'rev-parse', 'HEAD').trim(),
      budget: 0,
      expiry: new Date(Date.parse(FIXTURE_NOW) + RUN_ENVELOPE_WINDOW_MS).toISOString(),
    });
  });

  it('the same commit is the same key with the attempt counted; a new commit is a new key', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    const first = (records(w)[0]?.['envelope'] as Record<string, unknown>)['idempotencyKey'] as string;
    const second = (records(w)[1]?.['envelope'] as Record<string, unknown>)['idempotencyKey'] as string;
    expect(second).toBe(first);
    const file = join(w.installation.stateDir, 'envelope-idempotency', `${first.replace('sha256:', '')}.json`);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ attempts: 2, action: 'run-start' });
    commitAll(w.alpha.root, 'a run did its work');
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect((records(w)[2]?.['envelope'] as Record<string, unknown>)['idempotencyKey']).not.toBe(first);
  });

  it('a run an earlier run already completed returns the earlier outcome rather than running again', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    const key = (records(w)[0]?.['envelope'] as Record<string, unknown>)['idempotencyKey'] as string;
    expect(settleIdempotencyKey(sys, w.installation.stateDir, key, 'completed', FIXTURE_NOW)).toBe(true);
    const refused = runStartTenantRefusal(ctx, true);
    expect(textOf(refused)).toContain('REFUSED (ENVELOPE_DUPLICATE)');
    expect(textOf(refused)).toContain("already ended as 'completed'");
    expect(records(w).at(-1)).toMatchObject({ stage: 'execution', outcome: 'refused', rule: 'ENVELOPE_DUPLICATE' });
  });

  it('the refusal sits before the gatekeeper is composed, and the dry run asks no idempotency store', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, false)).toBeNull();
    expect(records(w)).toEqual([]);
    expect(existsSync(join(w.installation.stateDir, 'envelope-idempotency'))).toBe(false);
  });
});

describe('Control Center project selection', () => {
  it('admits a listed project and records both lines, with no tenant in the request', () => {
    const w = world();
    expect(projectSelectionRefusal(w.ctxAt(w.gamma.root))).toBeNull();
    const lines = records(w);
    expect(lines.map((line) => [line['stage'], line['outcome']])).toEqual([['admission', 'allowed'], ['execution', 'allowed']]);
    expect(lines[0]?.['envelope']).toMatchObject({ action: 'project-selection', actionClass: 'P1', tenant: AGENCY_TENANT, project: 'gamma', principal: 'advisor' });
  });

  it('refuses an unlisted project by name, recorded', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    expect(textOf(projectSelectionRefusal(w.ctxAt(stray.root)))).toContain('REFUSED (TENANT_UNKNOWN)');
    expect(records(w)).toHaveLength(1);
  });

  it('a selection that cannot be recorded did not happen', () => {
    const w = world();
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(textOf(projectSelectionRefusal(w.ctxAt(w.alpha.root)))).toContain('REFUSED (ENVELOPE_NOT_RECORDED)');
  });

  it('a selection whose outcome cannot be recorded did not happen either', () => {
    const w = world();
    let appends = 0;
    const failingSecond: System = {
      ...sys,
      createExclusive: (path, content) => {
        if (path.endsWith(`${ENVELOPE_RECORDS_FILENAME}.lock`)) {
          appends += 1;
          // From the second record on: a lone failure is retried, so one would prove nothing.
          if (appends >= 2) return false;
        }
        return sys.createExclusive(path, content);
      },
    };
    const refused = projectSelectionRefusal(Object.assign({ sys: failingSecond, root: w.alpha.root }, w.installation.ctxFields));
    expect(textOf(refused)).toContain('REFUSED (ENVELOPE_NOT_RECORDED)');
  });

  it('other verbs need a tenant too; only refresh, project.select and run.stop do not', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    expect([...CONTROL_CENTER_VERBS_WITHOUT_TENANT].sort()).toEqual(['project.select', 'refresh', 'run.stop']);
    for (const verb of CONTROL_CENTER_VERBS_WITHOUT_TENANT) expect(controlCenterTenantRefusal(w.ctxAt(stray.root), verb)).toBeNull();
    for (const verb of ['run.start', 'run.resume', 'phase.advance', 'approve.decide', 'plan.draft']) {
      expect(textOf(controlCenterTenantRefusal(w.ctxAt(stray.root), verb))).toContain('REFUSED (TENANT_UNKNOWN)');
      expect(controlCenterTenantRefusal(w.ctxAt(w.alpha.root), verb)).toBeNull();
    }
  });
});

describe('the cross-tenant rule alone', () => {
  it('passes a second project in the same tenant, and refuses one in another or none', () => {
    const w = world();
    const { registry } = bound(derive(w, w.alpha.root));
    expect(crossTenantRefusal(registry, OWNER_TENANT, 'beta')).toBeNull();
    expect(crossTenantRefusal(registry, OWNER_TENANT, 'gamma')).toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(crossTenantRefusal(registry, OWNER_TENANT, 'nobody')).toMatchObject({ code: 'TENANT_UNKNOWN' });
    expect(crossTenantRefusal(registry, AGENCY_TENANT, 'alpha')).toMatchObject({ code: 'TENANT_MISMATCH' });
  });
});

describe('the grant port this phase wires', () => {
  it('says no, so a P5 action through a route that passes it stops at the door', () => {
    const w = world();
    const derived = bound(derive(w, w.alpha.root));
    const request = { principal: 'implementer' as const, subjectHash: 'a'.repeat(40), scope: ['x'], windowMs: 60_000, intentScope: 'i' };
    expect(admitBoundary(sys, w.installation.stateDir, derived, { ...request, action: 'cross-tenant-access' })).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
    expect(NO_GRANT({} as never, {} as never)).toBe(false);
  });
});

describe('durable lines', () => {
  it('appends in order, across calls', () => {
    const dir = tempDir(made, 'projectos-tenant-lines-');
    const path = join(dir, 'x.jsonl');
    expect(appendDurableLine(sys, path, { n: 1 })).toBe(true);
    expect(appendDurableLine(sys, path, { n: 2 })).toBe(true);
    expect(linesOf(dir, 'x.jsonl')).toEqual([{ n: 1 }, { n: 2 }]);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('answers false while the lock is held, and writes nothing', () => {
    const dir = tempDir(made, 'projectos-tenant-lines-');
    const path = join(dir, 'x.jsonl');
    expect(appendDurableLine(sys, path, { n: 1 })).toBe(true);
    holdRecordLock(dir, 'x.jsonl');
    expect(appendDurableLine(sys, path, { n: 2 })).toBe(false);
    expect(linesOf(dir, 'x.jsonl')).toEqual([{ n: 1 }]);
  });

  it('never replaces a file it cannot read, which would erase what it holds', () => {
    const path = '/state/x.jsonl';
    let written = false;
    const fake: System = {
      ...sys,
      createExclusive: () => true,
      removeFile: () => true,
      readText: () => null,
      exists: (p) => p === path,
      writeText: () => {
        written = true;
      },
    };
    expect(appendDurableLine(fake, path, { n: 1 })).toBe(false);
    expect(written).toBe(false);
  });

  it('answers false when the rename fails, when the write throws, and when the line does not read back', () => {
    const path = join(tempDir(made, 'projectos-tenant-lines-'), 'x.jsonl');
    expect(appendDurableLine({ ...sys, renameFile: () => false }, path, { n: 1 })).toBe(false);
    const throwing: System = {
      ...sys,
      writeText: () => {
        throw new Error('disk full');
      },
    };
    expect(appendDurableLine(throwing, path, { n: 1 })).toBe(false);
    expect(appendDurableLine({ ...sys, renameFile: () => true, writeText: () => undefined }, path, { n: 1 })).toBe(false);
  });

  it('a recorder with no state directory has recorded nothing', () => {
    expect(envelopeRecorder(sys, null)({} as never)).toBe(false);
  });
});

describe('the idempotency store', () => {
  function admitted(w: World, intentScope: string) {
    const derived = bound(derive(w, w.alpha.root));
    const minted = mintEnvelope(
      { binding: derived.binding, registry: derived.actions, principal: 'implementer', actor: { agent: 'a', provider: 'p', model: 'm' }, envelopeId: `ENV-${'a'.repeat(24)}` },
      { action: 'run-start', subjectHash: 'a'.repeat(40), scope: ['x'], budget: 0, expiry: '2030-01-01T00:00:00.000Z', intentScope },
    );
    const door = admitEnvelope(minted, FIXTURE_NOW, () => true, NO_GRANT);
    if (!door.admitted) throw new Error('fixture envelope refused');
    return door.envelope;
  }

  it('a completed key is a duplicate and returns the earlier outcome, from a fresh read of the disk', () => {
    const w = world();
    const envelope = admitted(w, 'once');
    const dir = w.installation.stateDir;
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW)).toEqual({ kind: 'first', attempt: 1 });
    expect(settleIdempotencyKey(sys, dir, envelope.idempotencyKey, 'completed', FIXTURE_NOW)).toBe(true);
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW)).toMatchObject({ kind: 'duplicate', earlier: { outcome: 'completed', attempts: 1 } });
  });

  it('a failed attempt is retried under the same key, with the attempt counted', () => {
    const w = world();
    const envelope = admitted(w, 'retry');
    const dir = w.installation.stateDir;
    claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW);
    settleIdempotencyKey(sys, dir, envelope.idempotencyKey, 'failed', FIXTURE_NOW);
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW)).toEqual({ kind: 'retry', attempt: 2 });
  });

  it('a key admitted and never settled is a duplicate, because its effect may have happened, unless the caller says a repeat is safe', () => {
    const w = world();
    const envelope = admitted(w, 'unsettled');
    const dir = w.installation.stateDir;
    claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW);
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW)).toMatchObject({ kind: 'duplicate', earlier: { outcome: 'admitted' } });
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW, { retryUnsettled: true })).toEqual({ kind: 'retry', attempt: 2 });
  });

  it('two intents are two keys, as ADR-K1 says of next week\'s reminder', () => {
    const base = { tenant: 't', project: 'p', action: 'a', subjectHash: 's' };
    expect(deriveIdempotencyKey({ ...base, intentScope: 'one' })).not.toBe(deriveIdempotencyKey({ ...base, intentScope: 'two' }));
  });

  it('a store that cannot answer has not said "new"', () => {
    const w = world();
    const envelope = admitted(w, 'broken');
    expect(claimIdempotencyKey(sys, null, envelope, FIXTURE_NOW)).toMatchObject({ kind: 'unavailable' });
    const dir = w.installation.stateDir;
    claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW);
    writeFileSync(join(dir, 'envelope-idempotency', `${envelope.idempotencyKey.replace('sha256:', '')}.json`), '{ not json');
    expect(claimIdempotencyKey(sys, dir, envelope, FIXTURE_NOW)).toMatchObject({ kind: 'unavailable' });
    expect(settleIdempotencyKey(sys, dir, envelope.idempotencyKey, 'completed', FIXTURE_NOW)).toBe(false);
    expect(settleIdempotencyKey(sys, null, envelope.idempotencyKey, 'completed', FIXTURE_NOW)).toBe(false);
  });

  it('a run-start refused by a store that cannot answer does not start', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    const key = (records(w)[0]?.['envelope'] as Record<string, unknown>)['idempotencyKey'] as string;
    writeFileSync(join(w.installation.stateDir, 'envelope-idempotency', `${key.replace('sha256:', '')}.json`), '{ not json');
    expect(textOf(runStartTenantRefusal(ctx, true))).toContain('REFUSED (IDEMPOTENCY_UNAVAILABLE)');
    expect(records(w).at(-1)).toMatchObject({ stage: 'execution', outcome: 'refused', rule: 'IDEMPOTENCY_UNAVAILABLE' });
  });
});

describe('the fixture itself', () => {
  it('uses the real action registry, so the classes here are the committed ones', () => {
    const w = world();
    const raw: unknown = JSON.parse(readFileSync(join(w.installation.root, 'projectos', 'security', 'action-registry.json'), 'utf8'));
    expect(parseActionRegistry(raw).ok).toBe(true);
  });

  it('every fixture git command is the real git', () => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toContain('git version');
  });
});

describe('deriveTenant and a bound project id', () => {
  it('a bridge bound to one project is not bound to whatever the file now claims', () => {
    const w = world();
    const source = tenantSourceOf(w.ctxAt(w.alpha.root));
    expect(deriveTenant(sys, w.alpha.root, 'alpha', source).ok).toBe(true);
    expect(deriveTenant(sys, w.alpha.root, 'gamma', source)).toMatchObject({ ok: false, code: 'TENANT_MISMATCH' });
  });
});

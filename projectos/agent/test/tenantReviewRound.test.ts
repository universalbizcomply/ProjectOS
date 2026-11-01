/**
 * PROJECTOS-TENANT-PRINCIPAL1A, review round: ECC SECURITY and Agency identity-access-engineer.
 *
 * Each block is a finding. Real git, real files, the real entry refusal. Where the finding was that a
 * rule could be fooled, the test builds the attack first and shows it was really in force.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitEnvelope, type EnvelopeRecord } from '@projectos/core';
import { run as cli } from '../src/cli.js';
import type { CommandContext, CommandResult } from '../src/context.js';
import { continueCommand, run as runCommand } from '../src/commands/run.js';
import { tenant, type TenantReceiptConfirm } from '../src/commands/tenant.js';
import { admittedRunEnvelopeOf, deriveProjectTenant, mintRunCrossing, runStartTenantRefusal, tenantSourceOf, type DerivedTenant } from '../src/governedContext.js';
import {
  appendDurableLine,
  canonicalCheckoutRoot,
  claimIdempotencyKey,
  DURABLE_LINE_ROTATE_BYTES,
  ENVELOPE_RECORDS_FILENAME,
  readTenantReceipt,
  TENANT_CHANGE_RECORDS_FILENAME,
  TENANT_RECEIPT_CONFIRMATION,
  TENANT_RECEIPT_FILENAME,
  TENANT_RECEIPT_STATEMENT,
  tenantReceiptCommand,
} from '../src/installation/tenantRegistry.js';
import { nodeSystem, type System } from '../src/system.js';
import {
  AGENCY_TENANT,
  cleanUp,
  FIXTURE_NOW,
  forward,
  git,
  holdRecordLock,
  linesOf,
  makeGovernedProject,
  makeInstallation,
  makeProject,
  OWNER_TENANT,
  tempDir,
  type Installation,
  type RegistryLine,
} from './support/tenantWorld.js';

vi.unmock('../src/governedContext.js');

const made: string[] = [];
afterEach(() => cleanUp(made));

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };
const REGISTRY_REL = 'projectos/security/tenant-registry.json';

interface World {
  readonly installation: Installation;
  readonly alpha: { readonly root: string; readonly repository: string };
  readonly gamma: { readonly root: string; readonly repository: string };
  readonly lines: readonly RegistryLine[];
  readonly ctxAt: (root: string) => CommandContext;
}

function world(confirmed = true): World {
  const alpha = makeProject(made, 'alpha');
  const gamma = makeProject(made, 'gamma');
  const lines: readonly RegistryLine[] = [
    { projectId: 'alpha', repository: alpha.repository, governedRoot: alpha.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'gamma', repository: gamma.repository, governedRoot: gamma.root, tenant: AGENCY_TENANT, domain: 'business' },
  ];
  const installation = makeInstallation(made, lines);
  if (confirmed) installation.confirm(sys);
  return { installation, alpha, gamma, lines, ctxAt: (root) => Object.assign({ sys, root }, installation.ctxFields) };
}

const derive = (w: World, root: string, over: System = sys) => deriveProjectTenant(over, root, tenantSourceOf(w.ctxAt(root)));

function bound(result: ReturnType<typeof derive>): DerivedTenant {
  if (!result.ok) throw new Error(`expected a tenant, got ${result.code}: ${result.reasons.join('; ')}`);
  return result;
}

function refusedCode(result: ReturnType<typeof derive>): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.code;
}

const textOf = (result: CommandResult | readonly string[] | null): string => {
  if (result === null) return '';
  return ('lines' in result ? result.lines : result).join('\n');
};

const swapTenants = (text: string): string => text.split(OWNER_TENANT).join('PLACEHOLDER').split(AGENCY_TENANT).join(OWNER_TENANT).split('PLACEHOLDER').join(AGENCY_TENANT);

/** Put different bytes under the registry's blob name, as `git replace` does: no commit, no diff. */
function replaceTheBlob(w: World, repositoryRoot: string = w.installation.root): void {
  const blob = w.installation.blob();
  const flipped = join(tempDir(made, 'projectos-tenant-replace-'), 'flipped.json');
  writeFileSync(flipped, swapTenants(git(repositoryRoot, 'show', `HEAD:./${REGISTRY_REL}`)));
  const planted = git(repositoryRoot, 'hash-object', '-w', flipped).trim();
  git(repositoryRoot, 'replace', blob, planted);
}

describe('HIGH 1: git replace refs', () => {
  it('a replace ref cannot change the bytes judged under a receipted blob name', () => {
    const w = world();
    expect(bound(derive(w, w.alpha.root)).binding.tenant).toBe(OWNER_TENANT);
    replaceTheBlob(w);
    // The attack is real: plain git now serves the other bytes under the same name, with no diff.
    expect(git(w.installation.root, 'show', `HEAD:./${REGISTRY_REL}`)).toContain(`"tenant": "${AGENCY_TENANT}",\n      "domain": "develop"`);
    expect(git(w.installation.root, 'rev-parse', `HEAD:./${REGISTRY_REL}`).trim()).toBe(w.installation.blob());
    expect(git(w.installation.root, 'status', '--porcelain').trim()).toBe('');
    expect(bound(derive(w, w.alpha.root)).binding.tenant).toBe(OWNER_TENANT);
  });

  it('`refs/replace` is shared across linked worktrees, and an installation in one is not fooled either', () => {
    const w = world();
    const linked = `${tempDir(made, 'projectos-tenant-install-wt-')}/install`;
    git(w.installation.root, 'worktree', 'add', '--quiet', '-b', 'install-wt', linked);
    replaceTheBlob(w);
    expect(git(linked, 'show', `HEAD:./${REGISTRY_REL}`)).toContain(`"tenant": "${AGENCY_TENANT}",\n      "domain": "develop"`);
    const ctx: CommandContext = Object.assign({ sys, root: w.alpha.root }, w.installation.ctxFields, { tenantInstallRoot: linked });
    expect(bound(deriveProjectTenant(sys, w.alpha.root, tenantSourceOf(ctx))).binding.tenant).toBe(OWNER_TENANT);
  });

  it('bytes that do not hash to the named blob are refused, whatever produced them', () => {
    const w = world();
    const lying: System = {
      ...sys,
      exec: (cmd, args, options) => {
        const real = sys.exec(cmd, args, options);
        return args.includes('show') && String(args.at(-1)).endsWith(REGISTRY_REL) ? { ...real, stdout: swapTenants(real.stdout) } : real;
      },
    };
    expect(derive(w, w.alpha.root).ok).toBe(true);
    const refused = derive(w, w.alpha.root, lying);
    expect(refusedCode(refused)).toBe('TENANT_REGISTRY_UNREADABLE');
    expect(refused.ok ? '' : refused.reasons.join(' ')).toContain('does not hash to');
  });

  it('every git call on the registry refuses replacement objects', () => {
    const w = world();
    const calls: (readonly string[])[] = [];
    const spying: System = {
      ...sys,
      exec: (cmd, args, options) => {
        if (args.some((arg) => String(arg).includes('security/'))) calls.push(args);
        return sys.exec(cmd, args, options);
      },
    };
    expect(derive(w, w.alpha.root, spying).ok).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const args of calls) expect(args[0]).toBe('--no-replace-objects');
  });
});

describe('HIGH 2: the admitted run stays available', () => {
  const crossing = (run: { readonly expiry: string }) => ({ action: 'credential-release', subjectHash: 'a'.repeat(40), budget: 0, expiry: run.expiry, intentScope: 'phase-4' });

  it('a crossing can be minted from the run this context admitted, and it passes the door tied to that run', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(admittedRunEnvelopeOf(ctx)).toBeNull();
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    const run = admittedRunEnvelopeOf(ctx);
    if (run === null) throw new Error('no admitted run');
    expect([run.action, run.tenant, run.project]).toEqual(['run-start', OWNER_TENANT, 'alpha']);
    const minted = mintRunCrossing(ctx, crossing(run));
    if (!minted.ok) throw new Error(minted.reasons.join('; '));
    expect(minted.envelope.scope).toEqual([`run:${run.envelopeId}`]);
    expect(minted.envelope.tenant).toBe(OWNER_TENANT);
    const door = admitEnvelope(minted, FIXTURE_NOW, () => true, () => true);
    expect(door.admitted).toBe(true);
  });

  it('a dry run, another context and a refused run hold nothing to link', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, false)).toBeNull();
    expect(admittedRunEnvelopeOf(ctx)).toBeNull();
    expect(mintRunCrossing(ctx, crossing({ expiry: '2030-01-01T00:00:00.000Z' }))).toMatchObject({ ok: false, rule: 'RUN_LINK' });
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(admittedRunEnvelopeOf(w.ctxAt(w.alpha.root))).toBeNull();
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    expect(textOf(runStartTenantRefusal(ctx, true))).toContain('ENVELOPE_NOT_RECORDED');
    expect(admittedRunEnvelopeOf(ctx)).toBeNull();
  });

  it('the accessor is the only route: nothing hands out the binding or the registries', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    runStartTenantRefusal(ctx, true);
    expect(Object.keys(ctx).filter((key) => /run|envelope|binding/i.test(key))).toEqual([]);
  });
});

describe('HIGH 3: what actually selects the checkout today', () => {
  it('cwd does: a second `run --execute` from another tenant\'s root gets that tenant, and nothing ties the two', () => {
    const w = world();
    expect(runStartTenantRefusal(w.ctxAt(w.alpha.root), true)).toBeNull();
    expect(runStartTenantRefusal(w.ctxAt(w.gamma.root), true)).toBeNull();
    const envelopes = linesOf(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME).map((line) => line['envelope'] as Record<string, unknown>);
    expect(envelopes.map((e) => e['tenant'])).toEqual([OWNER_TENANT, AGENCY_TENANT]);
    expect(envelopes.map((e) => e['parentEnvelopeId'])).toEqual([null, null]);
  });
});

describe('MEDIUM 4: a receipt says what it can show', () => {
  const typed = (w: World): TenantReceiptConfirm => () => ({ kind: 'typed', text: w.installation.blob().slice(0, 12) });

  it('records the confirmation method, and does not claim the owner', () => {
    const w = world(false);
    const r = tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], typed(w));
    expect(r.code).toBe(0);
    const read = readTenantReceipt(sys, w.installation.stateDir);
    expect(read.kind === 'ok' ? read.receipt.confirmation : '').toBe('typed-terminal');
    expect(TENANT_RECEIPT_CONFIRMATION).toBe('typed-terminal');
    const envelope = linesOf(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME)[0]?.['envelope'] as Record<string, unknown>;
    expect(envelope['principal']).not.toBe('owner');
    expect(envelope['scope']).toContain('confirmation:typed-terminal');
  });

  it('no answer says the owner did it', () => {
    const w = world(false);
    const first = textOf(tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], typed(w)));
    const second = textOf(tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], typed(w)));
    const shown = textOf(tenant(w.ctxAt(w.alpha.root), {}, ['show']));
    for (const text of [first, second, shown]) expect(text.toLowerCase()).not.toContain('owner confirmed');
    expect(second).toContain('already has a receipt');
    expect(TENANT_RECEIPT_STATEMENT).toContain('a person or a process confirmed this registry blob at a console, nothing more');
    expect(shown).not.toContain('owner receipt');
  });
});

describe('MEDIUM 5: a moved tenant cannot be rubber-stamped, and a receipt answers to its line', () => {
  it('shows the change against the last receipted blob at the prompt', () => {
    const w = world();
    const [alpha, gamma] = w.lines as [RegistryLine, RegistryLine];
    const beta = makeProject(made, 'beta');
    w.installation.commitLines([{ ...alpha, tenant: AGENCY_TENANT, domain: 'business' }, { projectId: 'beta', repository: beta.repository, governedRoot: beta.root, tenant: OWNER_TENANT, domain: 'develop' }]);
    let shown = '';
    const r = tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], (_blob, summary) => {
      shown = summary.join('\n');
      return { kind: 'no-terminal' };
    });
    expect(r.code).toBe(2);
    expect(shown).toContain(`CHANGED alpha: tenant ${OWNER_TENANT} to ${AGENCY_TENANT}, domain develop to business`);
    expect(shown).toContain(`ADDED beta: tenant ${OWNER_TENANT}`);
    expect(shown).toContain(`REMOVED gamma: tenant ${gamma.tenant}`);
  });

  it('says so when there is nothing to compare with, and when the old blob cannot be read', () => {
    const w = world(false);
    let shown = '';
    const capture: TenantReceiptConfirm = (_blob, summary) => {
      shown = summary.join('\n');
      return { kind: 'no-terminal' };
    };
    tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], capture);
    expect(shown).toContain('no earlier receipt to compare with');
    w.installation.confirm(sys);
    const path = join(w.installation.stateDir, TENANT_RECEIPT_FILENAME);
    writeFileSync(path, readFileSync(path, 'utf8').replace(w.installation.blob(), 'e'.repeat(40)));
    tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], capture);
    expect(shown).toContain(`the last receipted blob ${'e'.repeat(40)} cannot be read`);
  });

  it('a receipt with no admission line carries no authority: a copied file is not a confirmation', () => {
    const w = world();
    expect(derive(w, w.alpha.root).ok).toBe(true);
    const lines = join(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME);
    const held = readFileSync(lines, 'utf8');
    writeFileSync(lines, '');
    const refused = derive(w, w.alpha.root);
    expect(refusedCode(refused)).toBe('TENANT_REGISTRY_NO_RECEIPT');
    expect(refused.ok ? '' : refused.reasons.join(' ')).toContain('no admission line');
    writeFileSync(lines, held.replace(w.installation.blob(), 'e'.repeat(40)));
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    writeFileSync(lines, held.replace('ENV-', 'ENV-0'));
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    writeFileSync(lines, held.replace('"outcome":"allowed"', '"outcome":"refused"'));
    expect(refusedCode(derive(w, w.alpha.root))).toBe('TENANT_REGISTRY_NO_RECEIPT');
    writeFileSync(lines, held);
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });
});

describe('MEDIUM 6: a busy record does not fail a run', () => {
  /** Another process holding the lock, which lets go after `ms`, as a busy bridge does. */
  function holdLockElsewhere(lock: string, ms: number): void {
    writeFileSync(lock, '{}\n');
    const child = spawn(process.execPath, ['-e', `setTimeout(() => require('fs').rmSync(${JSON.stringify(lock)}, { force: true }), ${ms})`], { stdio: 'ignore' });
    child.unref();
  }

  it('waits for a lock another process lets go of, and the line lands', () => {
    const dir = tempDir(made, 'projectos-tenant-lines-');
    const path = join(dir, 'x.jsonl');
    holdLockElsewhere(`${path}.lock`, 300);
    expect(appendDurableLine(sys, path, { n: 1 })).toBe(true);
    expect(linesOf(dir, 'x.jsonl')).toEqual([{ n: 1 }]);
  });

  it('a busy bridge does not fail `run --execute`', () => {
    const w = world();
    // The lock is taken at the moment the run records, not before, or the run's own git calls outlast it.
    let held = false;
    const busy: System = {
      ...sys,
      createExclusive: (path, content) => {
        if (!held && path.endsWith(`${ENVELOPE_RECORDS_FILENAME}.lock`)) {
          held = true;
          holdLockElsewhere(path, 300);
        }
        return sys.createExclusive(path, content);
      },
    };
    const ctx: CommandContext = Object.assign({ sys: busy, root: w.alpha.root }, w.installation.ctxFields);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    expect(held).toBe(true);
  });

  it('the wait is bounded: a lock nobody releases refuses, and no unwritable directory waits at all', () => {
    let attempts = 0;
    const held: System = { ...sys, exists: () => true, createExclusive: () => ((attempts += 1), false) };
    const started = Date.now();
    expect(appendDurableLine(held, 'C:/nowhere/x.jsonl', {})).toBe(false);
    expect(attempts).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(6000);
    attempts = 0;
    const unwritable: System = { ...sys, exists: () => false, createExclusive: () => ((attempts += 1), false) };
    expect(appendDurableLine(unwritable, 'C:/nowhere/x.jsonl', {})).toBe(false);
    expect(attempts).toBeLessThanOrEqual(2);
  });

  it('rotates past its size, losing nothing', () => {
    const dir = tempDir(made, 'projectos-tenant-lines-');
    const path = join(dir, 'x.jsonl');
    const old = `${JSON.stringify({ filler: 'y'.repeat(DURABLE_LINE_ROTATE_BYTES) })}\n`;
    writeFileSync(path, old);
    expect(appendDurableLine(sys, path, { n: 1 })).toBe(true);
    expect(linesOf(dir, 'x.jsonl')).toEqual([{ n: 1 }]);
    const rotated = readdirSync(dir).filter((name) => name !== 'x.jsonl');
    expect(rotated).toHaveLength(1);
    expect(readFileSync(join(dir, rotated[0] as string), 'utf8')).toBe(old);
  });

  it('a failed rotation records nothing and destroys nothing', () => {
    const dir = tempDir(made, 'projectos-tenant-lines-');
    const path = join(dir, 'x.jsonl');
    const old = `${'z'.repeat(DURABLE_LINE_ROTATE_BYTES)}\n`;
    writeFileSync(path, old);
    expect(appendDurableLine({ ...sys, renameFile: () => false }, path, { n: 1 })).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(old);
  });
});

describe('MEDIUM 7: a real 8.3 name', () => {
  /** Windows' own short form of a real directory, asked of Windows. */
  function shortNameOf(path: string): string {
    const script = `@echo off\r\nfor %%I in ("${path.split('/').join(String.fromCharCode(92))}") do echo %%~sI\r\n`;
    const bat = join(tempDir(made, 'projectos-tenant-short-'), 'short.cmd');
    writeFileSync(bat, script);
    return execFileSync('cmd.exe', ['/d', '/c', bat], { encoding: 'utf8' }).trim();
  }

  it('the real default refuses `C:/PROGRA~1`, which exists and which plain realpathSync leaves unexpanded', () => {
    expect(existsSync('C:/PROGRA~1')).toBe(true);
    expect(canonicalCheckoutRoot('C:/PROGRA~1')).toMatchObject({ ok: false, code: 'TENANT_CHECKOUT_ALIAS' });
  });

  it('a real short name of a registered root is refused by name, and its long name binds', () => {
    const w = world();
    const short = forward(shortNameOf(w.alpha.root));
    expect(short.includes('~')).toBe(true);
    expect(existsSync(short)).toBe(true);
    expect(refusedCode(derive(w, short))).toBe('TENANT_CHECKOUT_ALIAS');
    expect(derive(w, w.alpha.root).ok).toBe(true);
  });
});

describe('MEDIUM 8: the real entry path, with no mock', () => {
  it('the real CLI, `run` and `continue` all reach the real rule', () => {
    const w = world();
    const stray = makeProject(made, 'stray');
    expect(textOf(cli(w.ctxAt(stray.root), ['run', '--dry-run']))).toContain('REFUSED (TENANT_UNKNOWN)');
    expect(textOf(runCommand(w.ctxAt(stray.root), { execute: true }))).toContain('REFUSED (TENANT_UNKNOWN)');
    const governed = makeGovernedProject(made, 'delta');
    const line: RegistryLine = { projectId: 'delta', repository: governed.repository, governedRoot: governed.root, tenant: OWNER_TENANT, domain: 'develop' };
    w.installation.commitLines([...w.lines, line]);
    w.installation.confirm(sys);
    const through = cli(w.ctxAt(governed.root), ['run', '--dry-run']);
    expect(textOf(through)).toContain('DRY RUN: nothing was written and no worker was started.');
    w.installation.commitLines(w.lines);
    w.installation.confirm(sys);
    expect(textOf(continueCommand(w.ctxAt(governed.root), { 'dry-run': true }))).toContain('TENANT_UNKNOWN');
  });

  it('the suite-wide mock is not in force here', () => {
    const w = world(false);
    expect(runStartTenantRefusal(w.ctxAt(w.alpha.root), false)).not.toBeNull();
  });
});

describe('LOW', () => {
  it('quotes the printed command, so a path with spaces works', () => {
    expect(tenantReceiptCommand('C:/Program Files/ProjectOS', 'b'.repeat(40))).toBe(`node "C:/Program Files/ProjectOS/projectos/agent/bin/projectos.js" tenant receipt --blob ${'b'.repeat(40)}`);
  });

  it('a corrupt idempotency file names its fix', () => {
    const w = world();
    const ctx = w.ctxAt(w.alpha.root);
    expect(runStartTenantRefusal(ctx, true)).toBeNull();
    const envelope = linesOf(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME)[0]?.['envelope'] as Record<string, unknown>;
    const file = join(w.installation.stateDir, 'envelope-idempotency', `${String(envelope['idempotencyKey']).replace('sha256:', '')}.json`);
    writeFileSync(file, '{ not json');
    const refused = textOf(runStartTenantRefusal(ctx, true));
    expect(refused).toContain('REFUSED (IDEMPOTENCY_UNAVAILABLE)');
    expect(refused).toContain(file.split(String.fromCharCode(92)).join('/').split('/').at(-1));
    expect(refused).toContain('remove that file');
    expect(admittedRunEnvelopeOf(ctx)).toBeNull();
    const claim = claimIdempotencyKey(sys, w.installation.stateDir, { idempotencyKey: envelope['idempotencyKey'], envelopeId: envelope['envelopeId'], action: 'run-start' } as never, FIXTURE_NOW);
    expect(claim).toMatchObject({ kind: 'unavailable' });
  });
});

describe('the record the door writes', () => {
  it('a receipt\'s lines go to their own unrotated file, which is how a later read can find them', () => {
    const w = world(false);
    const r = tenant(w.ctxAt(w.alpha.root), { blob: w.installation.blob() }, ['receipt'], () => ({ kind: 'typed', text: w.installation.blob().slice(0, 12) }));
    expect(r.code).toBe(0);
    const lines = linesOf(w.installation.stateDir, TENANT_CHANGE_RECORDS_FILENAME) as unknown as readonly EnvelopeRecord[];
    expect(lines.map((line) => [line.stage, line.outcome])).toEqual([['admission', 'allowed'], ['execution', 'allowed']]);
    const read = readTenantReceipt(sys, w.installation.stateDir);
    expect(read.kind === 'ok' ? read.receipt.envelopeId : '').toBe(lines[0]?.envelope?.envelopeId);
    expect(linesOf(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME)).toEqual([]);
  });
});

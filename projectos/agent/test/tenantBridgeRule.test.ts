/**
 * A BRIDGE READ ACROSS TENANTS, WITH THE PROJECT CHECK DISABLED (delta exit proof; plan criterion 4).
 *
 * `checkBridgeRequest` refuses any project the bridge is not bound to, so with it intact a cross-tenant
 * read is refused before the tenant rule is ever reached, and a green test would prove the wrong rule.
 * So this file DISABLES that check, by wrapping the core function so it is told the bridge is bound to
 * whatever was asked for. The same call then has only the tenant rule left to stop it.
 *
 * The switch is one variable, so each proof runs both ways in the same world. `beta` is the second
 * project in the bound tenant: its read goes through, so a refusal of `gamma` is the tenant rule's and
 * not a fail-closed default.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { handleBridgeRpc, type BridgeDeps } from '../src/mcp/bridge.js';
import { ENVELOPE_RECORDS_FILENAME } from '../src/installation/tenantRegistry.js';
import { nodeSystem, type System } from '../src/system.js';
import { readFileSync } from 'node:fs';
import {
  AGENCY_TENANT,
  cleanUp,
  FIXTURE_NOW,
  holdRecordLock,
  linesOf,
  makeInstallation,
  makeProject,
  OWNER_TENANT,
  tempDir,
  type Installation,
} from './support/tenantWorld.js';

const projectCheck = vi.hoisted(() => ({ disabled: false }));

vi.mock('@projectos/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@projectos/core')>();
  return {
    ...core,
    checkBridgeRequest: (request: Parameters<typeof core.checkBridgeRequest>[0], context: Parameters<typeof core.checkBridgeRequest>[1]) =>
      core.checkBridgeRequest(request, projectCheck.disabled ? { ...context, boundProjectIds: [String(request.projectId)] } : context),
  };
});

const made: string[] = [];
afterEach(() => {
  projectCheck.disabled = false;
  cleanUp(made);
});

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };

interface World {
  readonly installation: Installation;
  readonly root: string;
  readonly refusalsDir: string;
  readonly deps: BridgeDeps;
}

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
  const refusalsDir = tempDir(made, 'projectos-tenant-refusals-');
  return {
    installation,
    root: alpha.root,
    refusalsDir,
    deps: {
      ctx: Object.assign({ sys, root: alpha.root }, installation.ctxFields),
      projectId: 'alpha',
      recordedAuthorityIds: [],
      stateDir: refusalsDir,
      durable: { stateDir: refusalsDir, installRoot: installation.root, repository: alpha.repository },
    },
  };
}

interface ToolResult {
  readonly isError: boolean;
  readonly text: string;
}

function read(deps: BridgeDeps, projectId: string, extra: Record<string, unknown> = {}, operation = 'project-state'): ToolResult {
  const response = handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: operation, arguments: { projectId, ...extra } } }, deps);
  const result = response?.result as { content: { text: string }[]; isError: boolean };
  return { isError: result.isError, text: result.content[0]?.text ?? '' };
}

const envelopes = (w: World): readonly Record<string, unknown>[] => linesOf(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);

describe('with the project check DISABLED, only the tenant rule is left', () => {
  it('still refuses a read across tenants, by the tenant rule\'s own name', () => {
    const w = world();
    projectCheck.disabled = true;
    const refused = read(w.deps, 'gamma');
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('TENANT_MISMATCH');
    expect(refused.text).not.toContain('not bound to project');
    expect(JSON.stringify(envelopes(w).at(-1)?.['reasons'])).toContain(`belongs to tenant '${AGENCY_TENANT}'`);
  });

  it('POSITIVE CONTROL: a second project in the same tenant is answered, so that refusal was not a default', () => {
    const w = world();
    projectCheck.disabled = true;
    const allowed = read(w.deps, 'beta');
    expect(allowed.isError).toBe(false);
    expect(allowed.text).toContain('branch:');
  });

  it('refuses a project in no tenant at all, by name', () => {
    const w = world();
    projectCheck.disabled = true;
    expect(read(w.deps, 'nobody').text).toContain('TENANT_UNKNOWN');
  });

  it('the check really is disabled: the same read with it intact is the project check\'s refusal', () => {
    const w = world();
    const refused = read(w.deps, 'gamma');
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('not bound to project');
    expect(refused.text).not.toContain('TENANT_MISMATCH');
  });
});

describe('a read through the bridge', () => {
  it('is a recorded crossing with the derived tenant, and a named tenant changes nothing', () => {
    const w = world();
    const answered = read(w.deps, 'alpha', { tenant: AGENCY_TENANT, domain: 'business' });
    expect(answered.isError).toBe(false);
    const lines = envelopes(w);
    expect(lines.map((line) => [line['stage'], line['outcome']])).toEqual([['admission', 'allowed'], ['execution', 'allowed']]);
    expect(lines[0]?.['envelope']).toMatchObject({ action: 'bridge-read', actionClass: 'P1', principal: 'advisor', tenant: OWNER_TENANT, domain: 'develop', project: 'alpha', scope: ['bridge:project-state'] });
  });

  it('does nothing until the owner has confirmed the registry, and tells the far end no path', () => {
    const w = world(false);
    const refused = read(w.deps, 'alpha');
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('TENANT_REGISTRY_NO_RECEIPT');
    expect(refused.text).not.toContain(w.installation.root);
    expect(refused.text).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(refused.text).not.toContain('tenant receipt --blob');
  });

  it('tells the far end no path when a checkout is refused, while the record keeps the reason', () => {
    const w = world();
    git_mismatch: {
      const deps = { ...w.deps, projectId: 'beta' };
      const refused = read(deps, 'beta');
      expect(refused.text).toContain('TENANT_MISMATCH');
      expect(refused.text).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(JSON.stringify(envelopes(w).at(-1)?.['reasons'])).toContain('TENANT_MISMATCH');
      break git_mismatch;
    }
  });

  it('`stop-work` needs no tenant: it works with the registry unconfirmed', () => {
    const w = world(false);
    const response = handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'stop-work', arguments: { projectId: 'alpha' } } }, w.deps);
    const result = response?.result as { isError: boolean };
    expect(result.isError).toBe(false);
  });
});

describe('a refusal that cannot be recorded stops the operation', () => {
  it('a contract refusal says it was not recorded, where it used to vanish without a word', () => {
    const w = world();
    const recorded = read(w.deps, 'gamma');
    expect(recorded.text).not.toContain('REFUSAL_NOT_RECORDED');
    expect(linesOf(w.refusalsDir, 'bridge-refusals.jsonl')).toHaveLength(1);
    holdRecordLock(w.refusalsDir, 'bridge-refusals.jsonl');
    const unrecorded = read(w.deps, 'gamma');
    expect(unrecorded.isError).toBe(true);
    expect(unrecorded.text).toContain('REFUSAL_NOT_RECORDED');
    expect(linesOf(w.refusalsDir, 'bridge-refusals.jsonl')).toHaveLength(1);
  });

  it('a tenant refusal that cannot be written says so', () => {
    const w = world();
    projectCheck.disabled = true;
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    const refused = read(w.deps, 'gamma');
    expect(refused.text).toContain('TENANT_MISMATCH');
    expect(refused.text).toContain('REFUSAL_NOT_RECORDED');
  });

  it('a derivation refusal that cannot be written says so, beside one that was', () => {
    const w = world(false);
    expect(read(w.deps, 'alpha').text).not.toContain('REFUSAL_NOT_RECORDED');
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    const refused = read(w.deps, 'alpha');
    expect(refused.text).toContain('TENANT_REGISTRY_NO_RECEIPT');
    expect(refused.text).toContain('REFUSAL_NOT_RECORDED');
  });

  it('a read whose admission cannot be written is not answered', () => {
    const w = world();
    expect(read(w.deps, 'alpha').isError).toBe(false);
    holdRecordLock(w.installation.stateDir, ENVELOPE_RECORDS_FILENAME);
    const stopped = read(w.deps, 'alpha');
    expect(stopped.isError).toBe(true);
    expect(stopped.text).toContain('ENVELOPE_R4');
    expect(stopped.text).not.toContain('branch:');
  });

  it('a read whose outcome cannot be written is not answered either', () => {
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
    const deps: BridgeDeps = { ...w.deps, ctx: Object.assign({ sys: failingSecond, root: w.root }, w.installation.ctxFields) };
    const stopped = read(deps, 'alpha');
    expect(stopped.isError).toBe(true);
    expect(stopped.text).toContain('ENVELOPE_NOT_RECORDED');
    expect(stopped.text).not.toContain('branch:');
  });

  it('a failing read leaves a failed outcome line', () => {
    const w = world();
    const failing: System = {
      ...sys,
      exec: (cmd, args, options) => {
        if (args.includes('--abbrev-ref')) throw new Error('git fell over');
        return sys.exec(cmd, args, options);
      },
    };
    const deps: BridgeDeps = { ...w.deps, ctx: Object.assign({ sys: failing, root: w.root }, w.installation.ctxFields) };
    expect(() => read(deps, 'alpha')).toThrow('git fell over');
    expect(envelopes(w).at(-1)).toMatchObject({ stage: 'execution', outcome: 'failed', rule: 'BRIDGE_READ_FAILED' });
  });

  it('a state file that cannot be read is never overwritten by a refusal', () => {
    const w = world();
    read(w.deps, 'gamma');
    const path = join(w.refusalsDir, 'bridge-refusals.jsonl');
    const held = readFileSync(path, 'utf8');
    const deps: BridgeDeps = {
      ...w.deps,
      ctx: { sys: { ...sys, readText: (p: string) => (p === path ? null : sys.readText(p)) }, root: w.root },
    };
    expect(read(deps, 'gamma').text).toContain('REFUSAL_NOT_RECORDED');
    expect(readFileSync(path, 'utf8')).toBe(held);
  });
});

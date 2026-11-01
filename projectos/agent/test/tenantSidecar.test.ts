/**
 * Two things that only a real process can prove.
 *
 * The REAL Control Center sidecar, `control-center/sidecar/host.mjs`, driven over its real stdin and stdout.
 *
 * host.mjs has no unit tests, and its tenant wiring was pinned only as text. So these start the real file
 * as a real process, against a real installation and real git, in a throwaway account profile, and send
 * the commands the renderer sends. It needs the built agent and the built projection, so `beforeAll` builds
 * both: this file proves the code in this tree, not a build left lying around.
 *
 * The REAL prompt in a REAL Windows console. `tenant receipt` is the only way out of a refusal that covers
 * every run, bridge read and verb, and it reads the keyboard with a synchronous read. `support/conpty.ps1`
 * gives it a ConPTY console and types. It runs against a throwaway installation, so a correct answer here
 * reaches no real state. It is also a plain demonstration of the receipt's limit: this is a process
 * driving a console, and the command cannot tell.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENVELOPE_RECORDS_FILENAME, readTenantReceipt, TENANT_CHANGE_RECORDS_FILENAME, TENANT_RECEIPT_STATEMENT } from '../src/installation/tenantRegistry.js';
import { nodeSystem, resolveBoundGit, resolveBoundPowerShell, type System } from '../src/system.js';
import {
  AGENCY_TENANT,
  cleanUp,
  FIXTURE_NOW,
  linesOf,
  makeInstallation,
  makeProject,
  OWNER_TENANT,
  tempDir,
  type Installation,
  type RegistryLine,
} from './support/tenantWorld.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = resolve(HERE, '..');
const CONTROL_CENTER = resolve(AGENT, '..', 'control-center');
const TSC = join(AGENT, 'node_modules', 'typescript', 'bin', 'tsc');

const made: string[] = [];
const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill();
  cleanUp(made);
});

const sys: System = { ...nodeSystem, now: () => FIXTURE_NOW };

beforeAll(() => {
  execFileSync(process.execPath, [TSC, '-p', join(AGENT, 'tsconfig.json')], { stdio: 'pipe' });
  execFileSync(process.execPath, [TSC, '-p', join(CONTROL_CENTER, 'tsconfig.node.json')], { stdio: 'pipe' });
}, 170_000);

interface Result {
  readonly code: number;
  readonly lines: readonly string[];
}

interface Sidecar {
  readonly send: (verb: string, args?: Record<string, string>) => Promise<Result>;
  /** Every JSON message the process has printed so far. */
  readonly messages: Record<string, unknown>[];
  readonly settled: () => Promise<void>;
}

interface World {
  readonly installation: Installation;
  readonly stateDir: string;
  readonly profile: string;
  readonly alpha: { readonly root: string };
  readonly gamma: { readonly root: string };
  readonly stray: { readonly root: string };
  readonly lines: readonly RegistryLine[];
}

function world(confirmed = true): World {
  const alpha = makeProject(made, 'alpha');
  const gamma = makeProject(made, 'gamma');
  const stray = makeProject(made, 'stray');
  const lines: readonly RegistryLine[] = [
    { projectId: 'alpha', repository: alpha.repository, governedRoot: alpha.root, tenant: OWNER_TENANT, domain: 'develop' },
    { projectId: 'gamma', repository: gamma.repository, governedRoot: gamma.root, tenant: AGENCY_TENANT, domain: 'business' },
  ];
  const installation = makeInstallation(made, lines);
  const profile = tempDir(made, 'projectos-tenant-profile-');
  const stateDir = `${profile}/AppData/Local/ProjectOS/installation-state`;
  mkdirSync(stateDir, { recursive: true });
  if (confirmed) installation.confirm(sys, stateDir);
  return { installation, stateDir, profile, alpha, gamma, stray, lines };
}

function start(w: World, projects: readonly (readonly [string, string])[]): Sidecar {
  const args = ['--root', w.installation.root, '--project-registry-status', 'ok', ...projects.flatMap(([id, root]) => ['--project-id', id, '--project-root', root])];
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(HERE, 'support', 'sidecarPreload.mjs')).href, join(CONTROL_CENTER, 'sidecar', 'host.mjs'), ...args], {
    cwd: CONTROL_CENTER,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LOCALAPPDATA: `${w.profile}/AppData/Local`,
      XDG_STATE_HOME: `${w.profile}/AppData/Local`,
      PROJECTOS_DAEMON_INSTANCE_ID: 'tenant-sidecar-test',
      // The launcher binds git for the sidecar, and with none every repository fact fails closed.
      PROJECTOS_GIT_EXE: resolveBoundGit(process.env) as string,
      PROJECTOS_TEST_PROFILE: w.profile,
      PROJECTOS_TEST_AGENT_ENTRY: join(AGENT, 'dist', 'index.js'),
    },
  });
  running.push(child);
  const messages: Record<string, unknown>[] = [];
  const waiting = new Map<string, (result: Result) => void>();
  let buffer = '';
  let exited: string | null = null;
  let errors = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    errors += chunk;
  });
  // A SIDECAR THAT DIED FAILS THE TEST NOW, with what it said, rather than leaving a command unanswered.
  child.on('exit', (code) => {
    exited = `the sidecar exited with ${String(code)}: ${errors.slice(0, 600)}`;
    for (const answer of waiting.values()) answer({ code: -1, lines: [exited] });
  });
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      messages.push(message);
      if (message['kind'] === 'governed-result') {
        waiting.get(String(message['correlationId']))?.({ code: Number(message['code']), lines: message['lines'] as string[] });
      }
    }
  });
  let counter = 0;
  const send = (verb: string, commandArgs: Record<string, string> = {}): Promise<Result> =>
    new Promise((answer) => {
      if (exited !== null) {
        answer({ code: -1, lines: [exited] });
        return;
      }
      counter += 1;
      const correlationId = `tenant-${counter}`;
      waiting.set(correlationId, answer);
      child.stdin?.write(`${JSON.stringify({ kind: 'governed-command', correlationId, verb, args: commandArgs })}\n`);
    });
  return { send, messages, settled: async () => void (await send('refresh')) };
}

/** Which project the sidecar last told the surface was selected. */
function selected(sidecar: Sidecar): unknown {
  const inventories = sidecar.messages.filter((message) => message['inventory'] !== undefined);
  return (inventories.at(-1)?.['inventory'] as Record<string, unknown> | undefined)?.['selectedProjectId'] ?? null;
}

const selectionLines = (w: World): readonly Record<string, unknown>[] =>
  linesOf(w.stateDir, ENVELOPE_RECORDS_FILENAME).filter((line) => (line['envelope'] as Record<string, unknown> | null)?.['action'] === 'project-selection');

describe('the real sidecar, over its real channel', () => {
  it('selects a listed project through the envelope, and refuses an unlisted one before it takes effect', async () => {
    const w = world();
    const sidecar = start(w, [['alpha', w.alpha.root], ['stray', w.stray.root]]);
    const refused = await sidecar.send('project.select', { projectId: 'stray' });
    expect(refused.code).toBe(2);
    expect(refused.lines.join('\n')).toContain('REFUSED (TENANT_UNKNOWN)');
    await sidecar.settled();
    expect(selected(sidecar)).not.toBe('stray');
    const accepted = await sidecar.send('project.select', { projectId: 'alpha' });
    expect(accepted.code).toBe(0);
    await sidecar.settled();
    expect(selected(sidecar)).toBe('alpha');
    expect(selectionLines(w).map((line) => [line['stage'], line['outcome']])).toEqual([['admission', 'allowed'], ['execution', 'allowed']]);
    expect((selectionLines(w)[0]?.['envelope'] as Record<string, unknown>)['tenant']).toBe(OWNER_TENANT);
  }, 60_000);

  it('a verb on a project that has lost its tenant is refused, while refresh and run.stop still answer', async () => {
    const w = world();
    const sidecar = start(w, [['alpha', w.alpha.root], ['gamma', w.gamma.root]]);
    expect((await sidecar.send('project.select', { projectId: 'alpha' })).code).toBe(0);
    // The registry moves underneath it, unconfirmed.
    w.installation.commitLines(w.lines.slice(1));
    const refused = await sidecar.send('run.start', { phaseId: 'SOME-PHASE1A' });
    expect(refused.code).toBe(2);
    expect(refused.lines.join('\n')).toContain('REFUSED (TENANT_REGISTRY_NO_RECEIPT)');
    expect((await sidecar.send('refresh')).lines.join('\n')).not.toContain('TENANT_');
    expect((await sidecar.send('run.stop')).lines.join('\n')).not.toContain('TENANT_');
  }, 60_000);

  it('a remembered selection goes through the envelope at start, and one with no tenant is not restored', async () => {
    const w = world();
    writeFileSync(join(w.installation.root, 'selected-project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'alpha' }));
    const remembered = start(w, [['alpha', w.alpha.root], ['gamma', w.gamma.root]]);
    await remembered.settled();
    expect(selected(remembered)).toBe('alpha');
    expect(selectionLines(w).length).toBeGreaterThanOrEqual(2);

    const v = world();
    writeFileSync(join(v.installation.root, 'selected-project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'stray' }));
    const refused = start(v, [['alpha', v.alpha.root], ['stray', v.stray.root]]);
    await refused.settled();
    expect(selected(refused)).toBeNull();
    expect(selectionLines(v)).toEqual([]);
  }, 90_000);

  it('a default selection of the only project goes through the rule too', async () => {
    const w = world();
    const sidecar = start(w, [['stray', w.stray.root]]);
    await sidecar.settled();
    expect(selected(sidecar)).toBeNull();
    const listed = world();
    const only = start(listed, [['alpha', listed.alpha.root]]);
    await only.settled();
    expect(selected(only)).toBe('alpha');
    expect(selectionLines(listed).length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it('a selection that falls back to the default on a refresh goes through the rule too', async () => {
    const w = world();
    const sidecar = start(w, [['alpha', w.alpha.root], ['stray', w.stray.root]]);
    expect((await sidecar.send('project.select', { projectId: 'alpha' })).code).toBe(0);
    // Alpha is re-badged underneath it, so it leaves the inventory, and only unlisted `stray` remains.
    const config = join(w.alpha.root, '.projectops', 'project-config.json');
    writeFileSync(config, readFileSync(config, 'utf8').replace('"projectId":"alpha"', '"projectId":"rebadged"'));
    await sidecar.settled();
    expect(selected(sidecar)).toBeNull();
  }, 60_000);

  it('with the registry unconfirmed every selection is refused by name, and the refusal carries the one line', async () => {
    const w = world(false);
    const sidecar = start(w, [['alpha', w.alpha.root], ['gamma', w.gamma.root]]);
    const refused = await sidecar.send('project.select', { projectId: 'alpha' });
    expect(refused.code).toBe(2);
    expect(refused.lines.join('\n')).toContain('REFUSED (TENANT_REGISTRY_NO_RECEIPT)');
    expect(refused.lines.join('\n')).toContain('tenant receipt --blob');
  }, 60_000);
});

describe('the real prompt, in a real Windows console', () => {
  function inConsole(w: World, typed: string): { readonly output: string; readonly code: number } {
    const blob = w.installation.blob();
    const driver = join(HERE, 'support', 'receiptDriver.mjs');
    const commandLine = `"${process.execPath}" "${driver}" "${join(AGENT, 'dist')}" "${w.installation.root}" "${w.stateDir}" ${blob}`;
    const script = join(HERE, 'support', 'conpty.ps1');
    const raw = execFileSync(
      resolveBoundPowerShell(process.env) as string,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-CommandLine', commandLine, '-WorkingDirectory', w.installation.root, '-WaitFor', 'to confirm', '-Typed', typed, '-TimeoutMs', '30000'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const output = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g'), '');
    const exit = /EXIT:(-?\d+)/.exec(output);
    return { output, code: exit === null ? -1 : Number(exit[1]) };
  }

  it('the prompt reads what is typed, a wrong answer is refused, and no receipt is written', () => {
    const w = world(false);
    const { output, code } = inConsole(w, 'wrongwrongwr');
    expect(output).toContain('Retype the first 12 characters');
    expect(output).toContain('REFUSED (TENANT_RECEIPT_CONFIRMATION_MISMATCH)');
    expect(code).toBe(2);
    expect(readTenantReceipt(sys, w.stateDir).kind).toBe('absent');
  }, 60_000);

  it('a correct answer at a real console makes the receipt, through the door, and the bindings were on the screen', () => {
    const w = world(false);
    const { output, code } = inConsole(w, w.installation.blob().slice(0, 12));
    expect(output).toContain(`gamma: tenant ${AGENCY_TENANT}`);
    expect(output).toContain('TENANT REGISTRY CONFIRMED');
    expect(code).toBe(0);
    const read = readTenantReceipt(sys, w.stateDir);
    expect(read.kind === 'ok' ? [read.receipt.registryBlob, read.receipt.confirmation] : []).toEqual([w.installation.blob(), 'typed-terminal']);
    expect(linesOf(w.stateDir, TENANT_CHANGE_RECORDS_FILENAME).map((line) => line['outcome'])).toEqual(['allowed', 'allowed']);
  }, 60_000);

  it('says what that proved: this test is a process at a console, and the statement says it is not stopped', () => {
    expect(TENANT_RECEIPT_STATEMENT).toContain('It does not stop a process that drives a console');
  });
});

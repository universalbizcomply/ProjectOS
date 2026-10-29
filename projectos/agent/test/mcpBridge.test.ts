/**
 * The owner's private bridge, proven where it can be proven without a tunnel.
 *
 * WHAT IS AND IS NOT PROVEN HERE. Everything on the ProjectOS side: the vocabulary, the refusals, the
 * fact that no path or address leaves, the loopback bind, the bearer check, and that the whole surface
 * answers while the gatekeeper transport is unreachable. What is NOT proven here is the leg that needs
 * the owner: creating an OpenAI tunnel and connecting it from ChatGPT. No test can stand in for that,
 * and none here pretends to.
 *
 * THE LISTENER IS EXERCISED FOR REAL. A fake HTTP layer would prove the handler and nothing about the
 * socket, and "no public listener, no exposure of the local address" is a property OF the socket. So a
 * real server is started on loopback, real requests are made against it, and it is closed again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import { PLATFORM_STOP_STATEMENT, platformStopRefusal } from '../src/loop/platformStop.js';
import {
  handleBridgeRpc,
  IMPLEMENTED_OPERATIONS,
  MCP_PROTOCOL_VERSION,
  BRIDGE_SERVER_NAME,
  type BridgeDeps,
} from '../src/mcp/bridge.js';
import {
  bridgeListenerConfig,
  serveBridge,
  BRIDGE_BIND_HOST,
  BRIDGE_PATH,
  BRIDGE_TOKEN_FILENAME,
  MAX_REQUEST_BYTES,
} from '../src/mcp/listener.js';

const PROJECT = 'projectos';
const TOKEN = 'a-token-the-owner-chose-not-projectos-0001';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    cwd: () => '/unused',
    now: () => '2026-08-21T01:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    renameFile: (from: string, to: string) => {
      try {
        renameSync(from, to);
        return true;
      } catch {
        return false;
      }
    },
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
        return !existsSync(p);
      } catch {
        return false;
      }
    },
    exec: (command: string, args: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync(command, [...args], { encoding: 'utf8' }), stderr: '' };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  };
}

/** A governed project and an installation state directory, both real and both thrown away after. */
function world(): { deps: BridgeDeps; root: string; stateDir: string; sys: System } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-bridge-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'projectos-bridge-state-'));
  dirs.push(root, stateDir);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
  mkdirSync(join(root, '.projectops'), { recursive: true });
  writeFileSync(
    join(root, '.projectops', 'project-config.json'),
    JSON.stringify({
      projectId: PROJECT,
      projectName: 'ProjectOS',
      projectType: 'delivery-os',
      owner: 'Murad',
      repo: 'local/fixture',
      localPath: root.split(String.fromCharCode(92)).join('/'),
      environments: {},
      installStatus: 'installed',
      protectedBranches: ['main'],
      productionFreeze: false,
      allowedActions: ['inspect-repository'],
      forbiddenActions: ['production-deploy'],
      approvalGates: ['phase-closure'],
      validators: ['validate-project-config'],
      evidenceRequirements: ['phase-report'],
      secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
    }),
  );
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');

  const sys = nodeLikeSystem();
  return {
    root,
    stateDir,
    sys,
    deps: {
      ctx: { sys, root },
      projectId: PROJECT,
      recordedAuthorityIds: [],
      stateDir,
      durable: { stateDir, installRoot: '/install/ProjectOS', repository: 'github.com/local/fixture' },
    },
  };
}

const call = (name: string, args: Record<string, unknown> = { projectId: PROJECT }) => ({
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

function textOf(response: unknown): string {
  const result = (response as { result?: { content?: Array<{ text?: string }> } }).result;
  return result?.content?.[0]?.text ?? '';
}

function isError(response: unknown): boolean {
  return ((response as { result?: { isError?: boolean } }).result?.isError ?? false) === true;
}

describe('the vocabulary is the control', () => {
  it('offers exactly the operations it implements, and no free-text argument', () => {
    const w = world();
    const listed = handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, w.deps);
    const tools = (listed as { result: { tools: Array<Record<string, unknown>> } }).result.tools;

    expect(tools.map((t) => t['name'])).toEqual([...IMPLEMENTED_OPERATIONS]);
    for (const tool of tools) {
      const schema = tool['inputSchema'] as { properties: Record<string, unknown>; additionalProperties: boolean };
      // ONE PROPERTY, AND IT IS AN IDENTIFIER. There is deliberately nowhere for a sentence to go.
      expect(Object.keys(schema.properties)).toEqual(['projectId']);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('refuses an operation it does not expose, whatever it is called', () => {
    const w = world();
    for (const name of ['deploy', 'shell-command', 'record-owner-decision', 'project state', '']) {
      const r = handleBridgeRpc(call(name), w.deps);
      expect(isError(r)).toBe(true);
      expect(textOf(r)).toContain('REFUSED');
    }
  });

  it('refuses an operation the contract allows but this revision does not implement', () => {
    const w = world();
    // `submit-owner-intent` is in the contract and needs no prior authority, so it reaches the
    // implementation check rather than being stopped earlier for a missing authority reference.
    const r = handleBridgeRpc(call('submit-owner-intent'), w.deps);
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain('does not implement it');

    // And one that DOES need prior authority is stopped before that, by the contract itself.
    const needsAuthority = handleBridgeRpc(call('record-bound-decision'), w.deps);
    expect(isError(needsAuthority)).toBe(true);
    expect(textOf(needsAuthority)).toContain('must name the authority');
  });

  it('refuses a project it is not bound to', () => {
    const w = world();
    const r = handleBridgeRpc(call('project-state', { projectId: 'someone-elses-project' }), w.deps);
    expect(isError(r)).toBe(true);
    expect(textOf(r)).toContain('not bound to');
  });

  it('refuses prose, traversal and provenance in arguments', () => {
    const w = world();
    const prose = handleBridgeRpc(call('project-state', { projectId: PROJECT, phase: 'the one about auth' }), w.deps);
    expect(isError(prose)).toBe(true);

    const traversal = handleBridgeRpc(call('project-state', { projectId: PROJECT, phase: '../../etc' }), w.deps);
    expect(isError(traversal)).toBe(true);

    const impersonation = handleBridgeRpc(call('project-state', { projectId: PROJECT, decidedBy: 'Murad' }), w.deps);
    expect(isError(impersonation)).toBe(true);
    expect(textOf(impersonation)).toContain('provenance');
  });

  it('writes every refusal down, outside the governed project', () => {
    // A SILENTLY DROPPED REQUEST IS INDISTINGUISHABLE FROM ONE NEVER MADE. A probing conversation
    // learns nothing from that, and neither does an auditor.
    const w = world();
    handleBridgeRpc(call('deploy'), w.deps);
    handleBridgeRpc(call('project-state', { projectId: 'not-mine' }), w.deps);

    const recorded = readFileSync(join(w.stateDir, 'bridge-refusals.jsonl'), 'utf8').trim().split('\n');
    expect(recorded).toHaveLength(2);
    expect(JSON.parse(recorded[0] as string)['operation']).toBe('deploy');
    // NOT inside the project: deleting the repository does not erase the evidence of being probed.
    expect(existsSync(join(w.root, 'bridge-refusals.jsonl'))).toBe(false);
  });
});

describe('what it answers, and what it never says', () => {
  it('answers the read operations from governed state', () => {
    const w = world();
    const state = textOf(handleBridgeRpc(call('project-state'), w.deps));
    expect(state).toContain('local/fixture');
    expect(state).toContain(PROJECT);
    expect(state).toContain('install:');

    expect(textOf(handleBridgeRpc(call('active-phase'), w.deps))).toContain('no phases recorded');
    expect(textOf(handleBridgeRpc(call('pending-gate'), w.deps))).toContain('no owner gate');
    expect(textOf(handleBridgeRpc(call('evidence'), w.deps))).toContain('no phase reports');
    expect(textOf(handleBridgeRpc(call('cost-status'), w.deps))).toContain('no gatekeeper calls');
  });

  it('never returns a filesystem path, however the question is asked', () => {
    // "No exposure of the local address" is a property of the ANSWERS too. A bridge that binds
    // loopback and then replies with C:\dev\ProjectOS has exposed the machine anyway.
    const w = world();
    for (const operation of IMPLEMENTED_OPERATIONS) {
      const text = textOf(handleBridgeRpc(call(operation), w.deps));
      expect(text).not.toContain(w.root);
      expect(text).not.toContain(w.stateDir);
      expect(text).not.toContain(tmpdir());
    }
  });

  it('keeps working while the gatekeeper transport is unreachable', () => {
    // CRITERION 15's LAST CLAUSE. Nothing in this surface calls out, so there is nothing to be
    // unavailable — proven by answering with an exec that fails every command that is not git.
    const w = world();
    const offline: System = {
      ...w.sys,
      exec: (cmd: string, args: readonly string[]) =>
        cmd === 'git' ? w.sys.exec(cmd, args) : { code: 1, stdout: '', stderr: 'network unavailable' },
    };
    const deps: BridgeDeps = { ...w.deps, ctx: { sys: offline, root: w.root } };

    expect(textOf(handleBridgeRpc(call('worker-status'), deps))).toContain('no degraded-mode debt');
    expect(textOf(handleBridgeRpc(call('project-state'), deps))).toContain(PROJECT);
    expect(isError(handleBridgeRpc(call('cost-status'), deps))).toBe(false);
  });

  it('answers initialize without handing the far end any prose to act on', () => {
    const w = world();
    const r = handleBridgeRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, w.deps) as {
      result: Record<string, unknown>;
    };
    expect(r.result['protocolVersion']).toBe(MCP_PROTOCOL_VERSION);
    expect((r.result['serverInfo'] as { name: string }).name).toBe(BRIDGE_SERVER_NAME);
    // NO `instructions`. It would be prose a governed machine hands to a model.
    expect(r.result['instructions']).toBeUndefined();
  });

  it('says nothing at all to a notification, and refuses an unknown method', () => {
    const w = world();
    expect(handleBridgeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, w.deps)).toBeNull();
    const bad = handleBridgeRpc({ jsonrpc: '2.0', id: 2, method: 'resources/read' }, w.deps) as {
      error: { code: number };
    };
    expect(bad.error.code).toBe(-32601);
  });

  it('[PLATFORM-STOP] stop-work really engages the platform stop, and says what it cannot undo', () => {
    const w = world();
    const response = handleBridgeRpc(call('stop-work'), w.deps);
    const text = textOf(response);
    expect(isError(response)).toBe(false);
    expect(text).toContain('EMERGENCY STOP ENGAGED');
    expect(text).toContain(PLATFORM_STOP_STATEMENT);
    expect(text).not.toContain(w.stateDir);
    // THE CLAIM IS TRUE NOW: the record exists, and every governed entry point refuses on it.
    const record = JSON.parse(readFileSync(join(w.stateDir, 'platform-stop.json'), 'utf8')) as { state: string };
    expect(record.state).toBe('engaged');
    expect(platformStopRefusal(w.sys, w.stateDir)?.join('\n')).toContain('REFUSED (PLATFORM_STOP)');
  });
});

describe('it will not listen unless the owner has made it possible', () => {
  it('refuses to run with no token, and never mints one as a side effect of starting', () => {
    // A token exists only because the owner asked for one — `projectos mcp token --create` — or
    // supplied their own. Starting the bridge is not an occasion for creating authority.
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, {});
    expect(config.ready).toBe(false);
    expect(config.token).toBeNull();
    expect(config.problems.join(' ')).toContain('never mints one as a side effect of starting');
    expect(config.problems.join(' ')).toContain('projectos mcp token --create');
  });

  it('refuses a token too short to be a credential', () => {
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, { PROJECTOS_BRIDGE_TOKEN: 'short' });
    expect(config.ready).toBe(false);
  });

  it('takes the token from the installation state when the environment has none', () => {
    const w = world();
    writeFileSync(join(w.stateDir, BRIDGE_TOKEN_FILENAME), `${TOKEN}\n`);
    const config = bridgeListenerConfig(w.sys, w.stateDir, {});
    expect(config.ready).toBe(true);
    expect(config.token).toBe(TOKEN);
  });

  it('refuses any bind address that is not loopback', () => {
    // NOT SILENTLY IGNORED. An option somebody sets to 0.0.0.0 at 2am must fail loudly, not quietly
    // do the right thing and leave them believing it worked.
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, {
      PROJECTOS_BRIDGE_TOKEN: TOKEN,
      PROJECTOS_BRIDGE_HOST: '0.0.0.0',
    });
    expect(config.ready).toBe(false);
    expect(config.problems.join(' ')).toContain('reachable from the network');
  });

  it('refuses a port that is not a port', () => {
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, {
      PROJECTOS_BRIDGE_TOKEN: TOKEN,
      PROJECTOS_BRIDGE_PORT: 'eighty',
    });
    expect(config.ready).toBe(false);
  });
});

describe('the real socket, on loopback', () => {
  it('binds loopback, demands the token, and serves MCP over it', async () => {
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, { PROJECTOS_BRIDGE_TOKEN: TOKEN });
    const server = await serveBridge(config, (request) => handleBridgeRpc(request, w.deps));
    const url = `http://${BRIDGE_BIND_HOST}:${server.port}${BRIDGE_PATH}`;
    try {
      // NO TOKEN, NO CONVERSATION — and the refusal says nothing about the machine.
      const anonymous = await fetch(url, { method: 'POST', body: '{}' });
      expect(anonymous.status).toBe(401);
      expect(await anonymous.text()).toBe('unauthorised');

      const wrongToken = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}x` },
        body: '{}',
      });
      expect(wrongToken.status).toBe(401);

      // Nothing else on this server is a surface at all.
      const elsewhere = await fetch(`http://${BRIDGE_BIND_HOST}:${server.port}/`, { method: 'GET' });
      expect(elsewhere.status).toBe(404);

      const authorised = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
      const listed = await fetch(url, {
        method: 'POST',
        headers: authorised,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
      expect(body.result.tools.map((t) => t.name)).toEqual([...IMPLEMENTED_OPERATIONS]);

      const called = await fetch(url, {
        method: 'POST',
        headers: authorised,
        body: JSON.stringify(call('project-state')),
      });
      const text = await called.text();
      expect(text).toContain(PROJECT);
      // THE ANSWER CARRIES NOTHING POSITIONAL: not the root, not the state directory, not the port.
      expect(text).not.toContain(w.root);
      expect(text).not.toContain(w.stateDir);
      expect(text).not.toContain(String(server.port));

      // A notification is owed no reply.
      const notified = await fetch(url, {
        method: 'POST',
        headers: authorised,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      expect(notified.status).toBe(202);

      // Malformed input is refused with a fixed string, never an exception detail.
      const malformed = await fetch(url, { method: 'POST', headers: authorised, body: 'not json' });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).toBe('not a JSON-RPC message');
    } finally {
      await server.close();
    }
  });

  it('will not buffer an unbounded body from an authorised caller', async () => {
    const w = world();
    const config = bridgeListenerConfig(w.sys, w.stateDir, { PROJECTOS_BRIDGE_TOKEN: TOKEN });
    const server = await serveBridge(config, (request) => handleBridgeRpc(request, w.deps));
    const url = `http://${BRIDGE_BIND_HOST}:${server.port}${BRIDGE_PATH}`;
    try {
      const huge = 'x'.repeat(MAX_REQUEST_BYTES + 1024);
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: huge,
      }).catch(() => null);
      // The server either refuses it outright or drops the connection; what it must never do is grow.
      expect(response === null || response.status === 413).toBe(true);
    } finally {
      await server.close();
    }
  });
});

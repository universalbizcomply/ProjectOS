/**
 * The minimum OAuth the tunnel needs, proven over the real socket.
 *
 * WHAT THIS IS FOR. ChatGPT will not create a Tunnel connector without an authentication mode, and
 * the mode offered alongside Tunnel is OAuth. So the bridge publishes the metadata an MCP client
 * expects and runs an authorization-code flow with PKCE. These tests drive that flow end to end
 * against a genuinely listening server — metadata, registration, authorization, approval, exchange,
 * then a real MCP call carrying the issued token.
 *
 * THE POINT OF THE NEGATIVES. Every unauthenticated route added here is new reachable surface. Each
 * negative below is a way that surface could have been made to give something away: a code sent to
 * somebody else's redirect, a code replayed, PKCE skipped, a token minted for one resource used at
 * another, or the installation's own credential leaking into a response.
 *
 * WHAT IT DOES NOT PROVE: that ChatGPT's backend can reach a loopback token endpoint through the
 * tunnel. No local test can answer that; it is the one live question left for the owner.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import type { System } from '../src/system.js';
import { handleBridgeRpc, type BridgeDeps } from '../src/mcp/bridge.js';
import { bridgeListenerConfig, serveBridge, BRIDGE_BIND_HOST, BRIDGE_PATH, type BridgeServer } from '../src/mcp/listener.js';
import {
  newOAuthState,
  verifyAccessToken,
  BRIDGE_SCOPE,
  protectedResourceMetadata,
  authorizationServerMetadata,
  type OAuthConfig,
} from '../src/mcp/oauth.js';

const PROJECT = 'projectos';
const TOKEN = 'an-installation-token-not-an-oauth-one-01';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

const dirs: string[] = [];
const servers: BridgeServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    cwd: () => '/unused',
    now: () => '2026-08-22T00:00:00.000Z',
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

function governedProject(): { root: string; stateDir: string; sys: System; deps: BridgeDeps } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-oauth-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'projectos-oauth-state-'));
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

async function start(): Promise<{
  url: string;
  origin: string;
  oauthConfig: OAuthConfig;
  pin: string;
  port: number;
  world: ReturnType<typeof governedProject>;
}> {
  const world = governedProject();
  const config = bridgeListenerConfig(world.sys, world.stateDir, { PROJECTOS_BRIDGE_TOKEN: TOKEN });
  // EXACTLY THE ENTRYPOINT'S COMPOSITION. The origin is resolved from the port actually bound, which
  // is the whole point of `issuerFor` — composing it beforehand published port 0.
  const state = newOAuthState();
  const server = await serveBridge(config, (r) => handleBridgeRpc(r, world.deps), {
    state,
    issuerFor: (port) => ({ issuer: `http://${BRIDGE_BIND_HOST}:${port}`, resource: `http://${BRIDGE_BIND_HOST}:${port}${BRIDGE_PATH}` }),
  });
  servers.push(server);
  const origin = `http://${BRIDGE_BIND_HOST}:${server.port}`;
  // The test reads the PIN from the state the way an operator reads it off the terminal.
  return {
    url: `${origin}${BRIDGE_PATH}`,
    origin,
    oauthConfig: { issuer: origin, resource: `${origin}${BRIDGE_PATH}` },
    pin: state.pin,
    port: server.port,
    world,
  };
}

/** Drive the whole browser-and-backend flow the way ChatGPT would. */
async function fullFlow(
  origin: string,
  pin: string,
  over: Partial<{ verifier: string; exchangeVerifier: string; redirect: string }> = {},
) {
  const verifier = over.verifier ?? randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = over.redirect ?? REDIRECT;

  const authorizeUrl =
    `${origin}/authorize?response_type=code&client_id=test-client&redirect_uri=${encodeURIComponent(redirect)}` +
    `&state=abc123&code_challenge=${challenge}&code_challenge_method=S256&scope=${BRIDGE_SCOPE}`;
  const page = await fetch(authorizeUrl);
  const html = await page.text();
  const handle = /name="handle" value="([a-f0-9]+)"/.exec(html)?.[1] ?? '';

  const approved = await fetch(`${origin}/authorize/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle, pin }).toString(),
    redirect: 'manual',
  });
  const location = approved.headers.get('location') ?? '';
  const code = new URL(location || 'http://x/').searchParams.get('code') ?? '';
  const returnedState = new URL(location || 'http://x/').searchParams.get('state') ?? '';

  const token = await fetch(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: 'test-client',
      code_verifier: over.exchangeVerifier ?? verifier,
    }).toString(),
  });
  const tokenBody = (await token.json().catch(() => ({}))) as Record<string, string>;
  return { page, html, handle, approved, location, code, returnedState, token, tokenBody };
}

/** Speak HTTP directly, so `Host` can be whatever the test needs it to be. */
function rawRequest(
  port: number,
  method: string,
  path: string,
  host: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host,
          ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('the metadata an MCP client discovers', () => {
  it('publishes protected-resource metadata naming this bridge and its authorization server', async () => {
    const w = await start();
    const { origin, oauthConfig } = w;
    const res = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual(protectedResourceMetadata(oauthConfig));
    expect(body.resource).toBe(`${origin}/mcp`);
    expect(body.authorization_servers).toEqual([origin]);
    expect(body.scopes_supported).toEqual([BRIDGE_SCOPE]);
  });

  it('publishes authorization-server metadata requiring PKCE S256 and no client secret', async () => {
    const w = await start();
    const { origin, oauthConfig } = w;
    const body = (await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(body).toEqual(authorizationServerMetadata(oauthConfig));
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(body.grant_types_supported).toEqual(['authorization_code']);
    // Nothing that would let a token outlive its hour or a secret exist to be stolen.
    expect(body.grant_types_supported).not.toContain('refresh_token');
  });

  it('answers metadata without a token, because a client cannot have one yet', async () => {
    const w = await start();
    const { origin } = w;
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${origin}${path}`)).status).toBe(200);
    }
  });
});

describe('the authorization code flow', () => {
  it('registers a client without widening where a code may be sent', async () => {
    const w = await start();
    const { origin } = w;
    const res = await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.client_id).toMatch(/^projectos-connector-/);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('completes: authorize, approve, exchange, then a real MCP call with the issued token', async () => {
    const w = await start();
    const { origin, url } = w;
    const flow = await fullFlow(origin, w.pin);

    expect(flow.page.status).toBe(200);
    expect(flow.html).toContain('Authorise this connector?');
    expect(flow.html).toContain('grants connector access only');
    expect(flow.html).toContain('Approval PIN');
    expect(flow.approved.status).toBe(302);
    expect(flow.location.startsWith(REDIRECT)).toBe(true);
    expect(flow.returnedState).toBe('abc123');
    expect(flow.code).not.toBe('');
    expect(flow.token.status).toBe(200);
    expect(flow.tokenBody.token_type).toBe('Bearer');
    expect(flow.tokenBody.scope).toBe(BRIDGE_SCOPE);
    expect(flow.tokenBody.expires_in).toBeGreaterThan(0);
    expect(flow.tokenBody.refresh_token).toBeUndefined();

    const authorised = { authorization: `Bearer ${flow.tokenBody.access_token}`, 'content-type': 'application/json' };
    const init = await fetch(url, {
      method: 'POST',
      headers: authorised,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(init.status).toBe(200);
    expect(await init.text()).toContain('projectos-owner-bridge');

    const listed = await fetch(url, {
      method: 'POST',
      headers: authorised,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(((await listed.json()) as { result: { tools: unknown[] } }).result.tools.length).toBe(7);

    const read = await fetch(url, {
      method: 'POST',
      headers: authorised,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'project-state', arguments: { projectId: PROJECT } },
      }),
    });
    expect(await read.text()).toContain(PROJECT);
  });

  it('leaves the installation credential working, so the local path is unchanged', async () => {
    const w = await start();
    const { url } = w;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('what the new surface refuses', () => {
  it('refuses an unknown token, and points an MCP client at the metadata', async () => {
    const w = await start();
    const { url, origin } = w;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-token-this-server-issued-0001' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
  });

  it('refuses no token at all', async () => {
    const w = await start();
    const { url } = w;
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('refuses a redirect_uri that is not on the allowlist, and does NOT redirect to it', async () => {
    const w = await start();
    const { origin } = w;
    const evil = 'https://attacker.example.invalid/steal';
    const res = await fetch(
      `${origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(evil)}` +
        `&state=s&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toContain('redirect_uri is not one this installation allows');
  });

  it('refuses a registration that asks for a redirect outside the allowlist', async () => {
    const w = await start();
    const { origin } = w;
    const res = await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://attacker.example.invalid/cb'] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri');
  });

  it('refuses a missing state', async () => {
    const w = await start();
    const { origin } = w;
    const res = await fetch(
      `${origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('state is required');
  });

  it('refuses PKCE that is absent, plain, or malformed', async () => {
    const w = await start();
    const { origin } = w;
    const base = `${origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s`;
    expect((await fetch(base)).status).toBe(400);
    expect(await (await fetch(`${base}&code_challenge=abc&code_challenge_method=plain`)).text()).toContain('only S256');
    expect(await (await fetch(`${base}&code_challenge=short&code_challenge_method=S256`)).text()).toContain('malformed');
  });

  it('refuses an exchange whose verifier does not match the challenge', async () => {
    const w = await start();
    const { origin } = w;
    const flow = await fullFlow(origin, w.pin, { exchangeVerifier: randomBytes(32).toString('base64url') });
    expect(flow.token.status).toBe(400);
    expect(flow.tokenBody.error).toBe('invalid_grant');
    expect(flow.tokenBody.error_description).toContain('PKCE verification failed');
  });

  it('refuses a second exchange of the same code', async () => {
    const w = await start();
    const { origin } = w;
    const verifier = randomBytes(32).toString('base64url');
    const flow = await fullFlow(origin, w.pin, { verifier });
    expect(flow.token.status).toBe(200);

    const replay = await fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: flow.code,
        redirect_uri: REDIRECT,
        client_id: 'test-client',
        code_verifier: verifier,
      }).toString(),
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error_description: string }).error_description).toContain('already-used');
  });

  it('refuses an approval handle that was already spent', async () => {
    const w = await start();
    const { origin } = w;
    const flow = await fullFlow(origin, w.pin);
    const again = await fetch(`${origin}/authorize/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle: flow.handle }).toString(),
      redirect: 'manual',
    });
    expect(again.status).toBe(400);
  });

  it('refuses a scope or resource that is not this bridge', async () => {
    const w = await start();
    const { origin } = w;
    const base = `${origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`;
    expect(await (await fetch(`${base}&scope=admin`)).text()).toContain('issues only');
    expect(await (await fetch(`${base}&resource=${encodeURIComponent('http://127.0.0.1:1/mcp')}`)).text()).toContain(
      'does not name this bridge',
    );
  });

  it('refuses any route that is not part of the surface', async () => {
    const w = await start();
    const { origin } = w;
    for (const path of ['/', '/admin', '/.well-known/openid-configuration', '/token/../mcp']) {
      expect((await fetch(`${origin}${path}`)).status).toBe(404);
    }
  });

  it('never puts the installation credential in any response', async () => {
    const w = await start();
    const { origin, url } = w;
    const flow = await fullFlow(origin, w.pin);
    const everything = [
      flow.html,
      flow.location,
      JSON.stringify(flow.tokenBody),
      await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).text(),
      await (
        await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${flow.tokenBody.access_token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
      ).text(),
    ].join('\n');
    expect(everything).not.toContain(TOKEN);
  });

  it('cannot grant a protected owner action, however it authenticated', async () => {
    // THE WHOLE POINT. OAuth decides whether a caller may speak to the bridge. It decides nothing
    // about what the bridge is willing to do, which is still the closed vocabulary and nothing else.
    const w = await start();
    const { origin, url } = w;
    const flow = await fullFlow(origin, w.pin);
    const headers = { authorization: `Bearer ${flow.tokenBody.access_token}`, 'content-type': 'application/json' };
    for (const name of ['deploy', 'shell-command', 'record-owner-decision', 'continue-authorised-work']) {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { projectId: PROJECT } } }),
      });
      expect(((await res.json()) as { result: { isError: boolean } }).result.isError).toBe(true);
    }
  });
});

describe('token validity, decided where it can be decided exactly', () => {
  const config: OAuthConfig = { issuer: 'http://127.0.0.1:9/', resource: 'http://127.0.0.1:9/mcp' };

  it('refuses a token minted for another resource', () => {
    const state = newOAuthState();
    state.tokens.set('t', { audience: 'http://127.0.0.1:9/other', scope: BRIDGE_SCOPE, expiresAt: Date.now() + 10_000 });
    expect(verifyAccessToken(state, 't', config)).toContain('another resource');
  });

  it('refuses a token without the scope', () => {
    const state = newOAuthState();
    state.tokens.set('t', { audience: config.resource, scope: 'something-else', expiresAt: Date.now() + 10_000 });
    expect(verifyAccessToken(state, 't', config)).toContain('scope');
  });

  it('refuses an expired token and forgets it', () => {
    const state = newOAuthState();
    state.tokens.set('t', { audience: config.resource, scope: BRIDGE_SCOPE, expiresAt: Date.now() - 1 });
    expect(verifyAccessToken(state, 't', config)).toContain('expired');
    expect(state.tokens.has('t')).toBe(false);
  });

  it('accepts a good one', () => {
    const state = newOAuthState();
    state.tokens.set('t', { audience: config.resource, scope: BRIDGE_SCOPE, expiresAt: Date.now() + 10_000 });
    expect(verifyAccessToken(state, 't', config)).toBeNull();
  });
});

describe('approval is the operator\'s act, not the caller\'s', () => {
  it('refuses to mint a code without the PIN, which is never returned over HTTP', async () => {
    // THE CRITICAL THIS CLOSES. The approval handle is delivered to whoever asked for it, so a caller
    // that is not a browser can read it out of the page and post it straight back — no operator, no
    // console, no consent. Through a tunnel that made the installation's own token decorative: anyone
    // who could reach the bridge could mint an equivalent credential for themselves. Found by
    // adversarial review, which observed that this project's own end-to-end test was the exploit.
    const w = await start();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const page = await fetch(
      `${w.origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&state=s&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const html = await page.text();
    const handle = /name="handle" value="([a-f0-9]+)"/.exec(html)?.[1] ?? '';
    expect(handle).not.toBe('');
    // The page hands out the handle, as it must — and the PIN is nowhere in it.
    expect(html).not.toContain(w.pin);

    const selfApproved = await fetch(`${w.origin}/authorize/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle }).toString(),
      redirect: 'manual',
    });
    expect(selfApproved.status).toBe(400);
    expect(selfApproved.headers.get('location')).toBeNull();
    expect(await selfApproved.text()).toContain('approval PIN');
  });

  it('refuses a wrong PIN, and spends the request so it cannot be guessed at leisure', async () => {
    const w = await start();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const page = await fetch(
      `${w.origin}/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&state=s&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const handle = /name="handle" value="([a-f0-9]+)"/.exec(await page.text())?.[1] ?? '';

    const wrong = await fetch(`${w.origin}/authorize/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, pin: 'deadbeef' }).toString(),
      redirect: 'manual',
    });
    expect(wrong.status).toBe(400);

    // ONE ATTEMPT PER REQUEST. The same handle with the RIGHT pin is now worthless.
    const retry = await fetch(`${w.origin}/authorize/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle, pin: w.pin }).toString(),
      redirect: 'manual',
    });
    expect(retry.status).toBe(400);
    expect(await retry.text()).toContain('expired');
  });

  it('refuses the authorization pages when they are not addressed to this machine', async () => {
    // A form post from another site needs no preflight, and DNS rebinding makes it same-origin.
    // `fetch` will not set Host — it is a forbidden header there — so this speaks HTTP directly.
    const w = await start();
    const res = await rawRequest(w.port, 'POST', '/authorize/approve', 'attacker.example.invalid', 'handle=x&pin=y');
    expect(res.status).toBe(403);
    expect(res.body).toContain('only be opened on the machine running');
  });

  it('still answers the machine-to-machine routes through the tunnel, whatever Host they carry', async () => {
    // Metadata and token exchange are not browser routes and must not be restricted to loopback, or
    // discovery through the tunnel would break.
    const w = await start();
    const res = await rawRequest(w.port, 'GET', '/.well-known/oauth-authorization-server', 'some-tunnel-host.example');
    expect(res.status).toBe(200);
    expect(res.body).toContain('authorization_endpoint');
  });
});

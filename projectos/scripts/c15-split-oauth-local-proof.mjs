#!/usr/bin/env node
/**
 * C15 — the SPLIT shape, proven locally: public authorization server, private MCP bridge.
 *
 * WHY THIS EXISTS. The first shape put OAuth on the same loopback origin as the MCP endpoint. ChatGPT
 * reported that the server did not implement OAuth: its connector setup discovers OAuth automatically
 * and could not reach a loopback issuer. So the authorization server has to stand on a public HTTPS
 * origin while the MCP endpoint stays private — two processes that never call each other.
 *
 * WHAT IS SIMULATED AND WHAT IS REAL. Nothing is exposed. The authorization server binds loopback and
 * is addressed as `https://oauth.projectos.example` through the `Host` header, which is exactly what
 * it will receive behind a TLS terminator that forwards the original host. Everything else is real:
 * two OS processes, two sockets, a real authorization-code flow with PKCE, a real signed token, and a
 * real MCP call. What it does NOT prove is that ChatGPT can reach a public origin — that needs a
 * deployment, and a deployment is not authorised.
 *
 * THE CLAIM UNDER TEST: a token minted by the public half is accepted by the private half, the two
 * share nothing but a signing key, and the public half can do nothing else whatsoever.
 *
 * Usage: node projectos/scripts/c15-split-oauth-local-proof.mjs
 */
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const AS_PORT = 8791;
const BRIDGE_PORT = 8790;
const ISSUER = 'https://oauth.projectos.example';
const AS_HOST = 'oauth.projectos.example';
const RESOURCE = 'https://bridge.projectos.example/mcp';
// A key for this run only. It is not a ProjectOS credential and is never written down.
const SIGNING_KEY = randomBytes(32).toString('base64url');
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

const steps = [];
let failures = 0;
const record = (name, ok, detail = '') => {
  steps.push({ step: name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

function call(port, method, path, host, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host,
          ...headers,
          ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Start a child and wait until it says it is listening, so nothing races the first request. */
function start(script, env, readyMarker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${script} never reported ready:\n${out}`)), 30_000);
    child.stdout.on('data', (c) => {
      out += c;
      if (out.includes(readyMarker)) {
        clearTimeout(timer);
        resolve({ child, output: () => out });
      }
    });
    child.stderr.on('data', (c) => (out += c));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${script} exited with ${code}:\n${out}`));
    });
  });
}

const children = [];
const stopAll = () => children.forEach((c) => c.kill());
process.on('exit', stopAll);

try {
  // ------------------------------------------------------------------ two processes, two sockets
  const as = await start(
    'projectos/agent/bin/projectos-oauth.js',
    {
      PROJECTOS_OAUTH_ISSUER: ISSUER,
      PROJECTOS_OAUTH_RESOURCE: RESOURCE,
      PROJECTOS_OAUTH_SIGNING_KEY: SIGNING_KEY,
      PROJECTOS_OAUTH_PORT: String(AS_PORT),
    },
    'listening on',
  );
  children.push(as.child);

  const bridge = await start(
    'projectos/agent/bin/projectos-bridge.js',
    {
      PROJECTOS_BRIDGE_PORT: String(BRIDGE_PORT),
      PROJECTOS_OAUTH_ISSUER: ISSUER,
      PROJECTOS_OAUTH_RESOURCE: RESOURCE,
      PROJECTOS_OAUTH_SIGNING_KEY: SIGNING_KEY,
    },
    'listening on',
  );
  children.push(bridge.child);
  record('the two halves start as separate processes', true, `authorization server :${AS_PORT}, bridge :${BRIDGE_PORT}`);

  // THE PIN IS READ FROM THE AUTHORIZATION SERVER'S OWN TERMINAL, which is the only place it appears.
  const pin = (as.output().match(/approval PIN: ([0-9a-f]+)/) ?? [])[1] ?? '';
  record('the approval PIN exists and appears only on that terminal', pin.length >= 12);
  record(
    'the private bridge does not print a competing PIN in this shape',
    !bridge.output().includes('approval PIN'),
    'it names the authorization server instead',
  );

  // ------------------------------------------------------------------ discovery, as the tunnel does it
  const prmd = await call(BRIDGE_PORT, 'GET', '/.well-known/oauth-protected-resource/mcp', `127.0.0.1:${BRIDGE_PORT}`);
  const prmdDoc = JSON.parse(prmd.body);
  record(
    'the PRIVATE bridge publishes the PUBLIC issuer as its authorization server',
    prmdDoc.authorization_servers?.[0] === ISSUER && prmdDoc.resource === RESOURCE,
    `authorization_servers[0] = ${prmdDoc.authorization_servers?.[0]}`,
  );

  const asMeta = await call(AS_PORT, 'GET', '/.well-known/oauth-authorization-server', AS_HOST);
  const meta = JSON.parse(asMeta.body);
  record(
    'the PUBLIC half publishes endpoints only on its own https origin',
    meta.issuer === ISSUER && Object.values(meta).every((v) => typeof v !== 'string' || !v.startsWith('http') || v.startsWith(ISSUER)),
    meta.authorization_endpoint,
  );
  record(
    'no loopback address appears anywhere in the public metadata',
    !asMeta.body.includes('127.0.0.1') && !asMeta.body.includes('localhost'),
  );

  // ------------------------------------------------------------------ the flow, addressed publicly
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'chatgpt-connector',
    redirect_uri: REDIRECT,
    state: 'proof-state-value',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
  });
  const page = await call(AS_PORT, 'GET', `/authorize?${query}`, AS_HOST);
  const handle = (page.body.match(/name="handle" value="([^"]+)"/) ?? [])[1] ?? '';
  record('the authorization page answers when addressed by its public name', page.status === 200 && handle !== '');

  const approve = await call(AS_PORT, 'POST', '/authorize/approve', AS_HOST, {
    body: new URLSearchParams({ handle, pin }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ISSUER },
  });
  const location = approve.headers.location ?? '';
  const code = new URL(location).searchParams.get('code') ?? '';
  record(
    'approval with the terminal PIN redirects to the allowed redirect with a code',
    approve.status === 302 && location.startsWith(REDIRECT) && code !== '',
  );
  record(
    'the state the client sent comes back unchanged',
    new URL(location).searchParams.get('state') === 'proof-state-value',
  );

  const token = await call(AS_PORT, 'POST', '/token', AS_HOST, {
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: 'chatgpt-connector',
      code_verifier: verifier,
      resource: RESOURCE,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const accessToken = JSON.parse(token.body).access_token ?? '';
  record('the code exchanges for an access token', token.status === 200 && accessToken !== '');

  // ------------------------------------------------------------------ THE CLAIM: the other half accepts it
  const rpc = (tok) =>
    call(BRIDGE_PORT, 'POST', '/mcp', `127.0.0.1:${BRIDGE_PORT}`, {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { 'content-type': 'application/json', ...(tok === null ? {} : { authorization: `Bearer ${tok}` }) },
    });

  const accepted = await rpc(accessToken);
  record(
    'THE SPLIT WORKS: a token minted by the public half is accepted by the private half',
    accepted.status === 200 && accepted.body.includes('tools'),
    'the two processes never called each other',
  );

  // ------------------------------------------------------------------ and what it still refuses
  const anonymous = await rpc(null);
  record(
    'an unauthenticated MCP call is refused and pointed at the resource metadata',
    anonymous.status === 401 && (anonymous.headers['www-authenticate'] ?? '').includes('resource_metadata='),
    anonymous.headers['www-authenticate'] ?? '',
  );

  const foreign = await call(AS_PORT, 'POST', '/token', AS_HOST, {
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: 'chatgpt-connector',
      code_verifier: verifier,
      resource: RESOURCE,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  record('the same code cannot be exchanged twice', foreign.status !== 200);

  const noMcp = await call(AS_PORT, 'POST', '/mcp', AS_HOST, {
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
  });
  record('the PUBLIC half has no MCP route even for a valid token', noMcp.status === 404);

  const pivot = await call(AS_PORT, 'GET', `/authorize?${query}`, `127.0.0.1:${AS_PORT}`);
  record('the public half refuses to be addressed as loopback', pivot.status === 403);

  // THE PRIVATE HALF IS A RESOURCE, NOT AN AUTHORIZATION SERVER, AND SAYS SO BY ANSWERING NOTHING ELSE.
  const shadow = {};
  for (const route of ['/authorize', '/token', '/register', '/.well-known/oauth-authorization-server']) {
    const res = await call(BRIDGE_PORT, 'GET', route, `127.0.0.1:${BRIDGE_PORT}`);
    shadow[route] = res.status;
  }
  record(
    'the private bridge serves no authorization flow of its own in this shape',
    Object.values(shadow).every((status) => status === 404),
    JSON.stringify(shadow),
  );

  const bridgeToken = readFileSync(
    join(process.env.LOCALAPPDATA ?? '', 'ProjectOS', 'installation-state', 'bridge-token'),
    'utf8',
  ).trim();
  const everything = [asMeta, page, approve, token, accepted, anonymous, noMcp, prmd].map((r) => r.body).join('\n');
  record('the installation bridge token appears in nothing the public half ever said', !everything.includes(bridgeToken));
  record('the signing key appears in nothing either half ever said', !everything.includes(SIGNING_KEY));
  record('the approval PIN never travelled over HTTP', !everything.includes(pin));

  // ------------------------------------------------------------------ the evidence
  writeFileSync(
    join(ROOT, '.projectops', 'evidence', 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.c15-split-oauth-local-proof.json'),
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        recordId: 'PROJECTOS-GATEKEEPER-LOOP1A-C15-SPLIT-OAUTH-LOCAL-PROOF1A',
        projectId: 'projectos',
        phaseId: 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A',
        kind: 'c15-split-oauth-local-proof',
        at: new Date().toISOString(),
        shape: {
          authorizationServer: { public: false, boundTo: `127.0.0.1:${AS_PORT}`, addressedAs: ISSUER, mcpRoutes: 'NONE' },
          mcpBridge: { boundTo: `127.0.0.1:${BRIDGE_PORT}`, path: '/mcp', publishesIssuer: ISSUER },
          sharedState: 'NONE — the two processes never call each other; they share only a signing key',
        },
        steps,
        failures,
        exposure: 'NONE — both sockets bound 127.0.0.1; the public host name was supplied only as a Host header',
        secretsExposed:
          'NONE — the run signing key was generated in memory for this run and never written; the ' +
          'installation bridge token was read only to assert its absence; the PIN was read from a child stdout',
        notProven:
          'That ChatGPT can reach a public origin, complete discovery and connect. That requires a public ' +
          'deployment, which is NOT authorised and has NOT been performed.',
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`\n${steps.length - failures}/${steps.length} checks passed`);
  stopAll();
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  console.error(`\nPROOF ABORTED: ${error.message}`);
  stopAll();
  process.exit(1);
}

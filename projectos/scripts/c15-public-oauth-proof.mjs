#!/usr/bin/env node
/**
 * C15 — the public OAuth front door, proven from the public internet.
 *
 * WHAT IS DIFFERENT ABOUT THIS ONE. Every earlier proof addressed the authorization server over
 * loopback and supplied its public name in a `Host` header. This one goes out to DNS, through
 * Cloudflare's edge, over real TLS, and back down the tunnel — the same path ChatGPT will take. What
 * it can therefore establish, and nothing local could, is that the surface reachable from the
 * internet is only the surface intended to be reachable.
 *
 * THE NEGATIVES MATTER MORE THAN THE POSITIVES. A working authorization server that also exposed the
 * MCP endpoint, or a filesystem, or a proxy, would pass every positive check here. So the refusals
 * are checked explicitly, and the responses are searched for the two credentials and the machine's
 * own paths.
 *
 * Usage: node projectos/scripts/c15-public-oauth-proof.mjs [origin]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = process.argv[2] ?? 'https://oauth-projectos.safw4n.com';
const stateDir = join(process.env.LOCALAPPDATA ?? '', 'ProjectOS', 'installation-state');
const bridgeToken = readFileSync(join(stateDir, 'bridge-token'), 'utf8').trim();
const signingKey = readFileSync(join(stateDir, 'oauth-signing-key'), 'utf8').trim();
const cfToken = readFileSync(join(stateDir, 'cloudflare-tunnel-token'), 'utf8').trim();

const steps = [];
let failures = 0;
const record = (name, ok, detail = '') => {
  steps.push({ step: name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const seen = [];
async function get(path, init = {}) {
  const res = await fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });
  const body = await res.text();
  seen.push(body);
  return { status: res.status, body, headers: res.headers };
}

// ---------------------------------------------------------------- discovery, as a client sees it
const asMeta = await get('/.well-known/oauth-authorization-server');
const meta = JSON.parse(asMeta.body);
record('public authorization-server metadata answers over TLS', asMeta.status === 200);
record('issuer is exactly the public origin', meta.issuer === ORIGIN, meta.issuer);
record(
  'every advertised endpoint is on that origin and nowhere else',
  Object.values(meta).every((v) => typeof v !== 'string' || !v.startsWith('http') || v.startsWith(ORIGIN)),
);
record('PKCE S256 is required', JSON.stringify(meta.code_challenge_methods_supported) === '["S256"]');
record('only the read scope is offered', JSON.stringify(meta.scopes_supported) === '["projectos.read"]');

const asMetaMcp = await get('/.well-known/oauth-authorization-server/mcp');
record('the path-suffixed authorization-server document answers', asMetaMcp.status === 200);

const prmd = await get('/.well-known/oauth-protected-resource');
record('protected-resource metadata answers', prmd.status === 200);
const prmdMcp = await get('/.well-known/oauth-protected-resource/mcp');
const prmdDoc = JSON.parse(prmdMcp.body);
record(
  'it names this issuer as the authorization server for the MCP resource',
  prmdMcp.status === 200 && prmdDoc.authorization_servers?.[0] === ORIGIN,
  prmdDoc.resource,
);

// ---------------------------------------------------------------- the OAuth routes exist and judge
const authorizeBare = await get('/authorize?response_type=code');
record('/authorize exists and refuses an incomplete request without redirecting', authorizeBare.status === 400);

const badRedirect = await get(
  `/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'x', redirect_uri: 'https://evil.example/steal', state: 's', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' })}`,
);
record(
  'an unapproved redirect_uri is refused, and nothing is sent to it',
  badRedirect.status === 400 && !badRedirect.body.includes('evil.example') && !badRedirect.headers.get('location'),
);

const noPkce = await get(
  `/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'x', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', state: 's' })}`,
);
record('an authorization request without PKCE is refused', noPkce.status === 400);

const tokenUnknown = await get('/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=authorization_code&code=not-a-real-code',
});
record('/token exists and refuses an unknown code', tokenUnknown.status >= 400);

const register = await get('/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ redirect_uris: ['https://evil.example/steal'] }),
});
record('/register cannot widen the redirect allowlist', !register.body.includes('evil.example'), `status ${register.status}`);

// ---------------------------------------------------------------- THE MANDATORY NEGATIVES
const negatives = ['/mcp', '/', '/healthz', '/readyz', '/admin', '/.env', '/../mcp', '/api', '/config', '/metrics'];
for (const path of negatives) {
  const res = await get(path);
  record(`nothing is served at ${path}`, res.status === 404, `status ${res.status}`);
}

const mcpPost = await get('/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
record(
  'MCP IS NOT EXPOSED PUBLICLY: a real JSON-RPC call to /mcp is refused',
  mcpPost.status === 404 && !mcpPost.body.includes('tools'),
  `status ${mcpPost.status}`,
);

// ---------------------------------------------------------------- nothing of this machine escapes
const everything = seen.join('\n');
record('the ProjectOS bridge token appears in no public response', !everything.includes(bridgeToken));
record('the OAuth signing key appears in no public response', !everything.includes(signingKey));
record('the Cloudflare tunnel token appears in no public response', !everything.includes(cfToken));
record(
  'no local filesystem path appears in any public response',
  !/[A-Za-z]:\\|C:\//.test(everything) && !everything.includes('AppData'),
);
record('no loopback address appears in any public response', !everything.includes('127.0.0.1') && !everything.includes('localhost'));
record('the private bridge port is never named publicly', !everything.includes('8787'));

writeFileSync(
  join(process.cwd(), '.projectops', 'evidence', 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.c15-public-oauth-proof.json'),
  JSON.stringify(
    {
      schemaVersion: '1.0.0',
      recordId: 'PROJECTOS-GATEKEEPER-LOOP1A-C15-PUBLIC-OAUTH-PROOF1A',
      projectId: 'projectos',
      phaseId: 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A',
      kind: 'c15-public-oauth-proof',
      at: new Date().toISOString(),
      origin: ORIGIN,
      edge: 'Cloudflare Tunnel ProjectOS-C15-OAuth, one published application, to http://127.0.0.1:8788',
      publicSurface: {
        served: [
          '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp',
          '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp',
          '/authorize', '/authorize/approve', '/token', '/register',
        ],
        refused: negatives,
        mcpExposed: false,
        privateBridgePortPublic: false,
      },
      steps,
      failures,
      secretsExposed: 'NONE — the three credentials were read only to assert their absence from every response',
      notProven:
        'That ChatGPT completes discovery, authorization and a connector against this origin. That is the ' +
        'live step, and it needs the owner.',
    },
    null,
    2,
  ) + '\n',
);

console.log(`\n${steps.length - failures}/${steps.length} public checks passed`);
process.exit(failures === 0 ? 0 : 1);

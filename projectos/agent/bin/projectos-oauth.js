#!/usr/bin/env node
/**
 * The public half: an authorization server, and nothing else.
 *
 * WHY THERE ARE TWO PROCESSES NOW. ChatGPT's connector setup discovers OAuth automatically — the
 * documentation is explicit that "configuration flows entirely through automated discovery" and that
 * there is no manual way to type an authorization endpoint into the UI. Discovery has to reach the
 * metadata, and it could not reach a loopback address behind a tunnel. So the discovery surface has
 * to stand somewhere ChatGPT can read it, and the MCP control surface must not follow it there.
 *
 * WHAT THIS PROCESS CAN AND CANNOT DO. It can answer four documents and run an authorization-code
 * flow. It has NO route to the MCP endpoint, NO ProjectOS command surface, NO filesystem or shell
 * surface, and no knowledge of the bridge token — it cannot read one, forward one, or be persuaded
 * to proxy anything. Its only relationship with the private side is a signing key they both hold: it
 * mints tokens, the bridge verifies them, and nothing travels between the two.
 *
 * IT IS NOT A GATEWAY. There is deliberately no path here that takes a URL, a host, a port or a file
 * name from a caller. Everything it serves is either a fixed document or a decision about a code.
 *
 * DEPLOYMENT IS NOT PERFORMED BY THIS FILE and is not authorised yet. It binds where it is told,
 * defaulting to loopback so that running it by accident exposes nothing.
 *
 * Run `npm run build` in projectos/agent first (imports ../dist).
 */
import { createServer } from 'node:http';
import { newOAuthState } from '../dist/mcp/oauth.js';
import { serveAuthorizationServer } from '../dist/mcp/authServer.js';

const issuer = process.env.PROJECTOS_OAUTH_ISSUER ?? '';
const resource = process.env.PROJECTOS_OAUTH_RESOURCE ?? '';
const signingKey = process.env.PROJECTOS_OAUTH_SIGNING_KEY ?? '';
const host = process.env.PROJECTOS_OAUTH_HOST ?? '127.0.0.1';
const port = Number(process.env.PROJECTOS_OAUTH_PORT ?? '8788');

const problems = [];
if (!issuer.startsWith('https://')) {
  problems.push(
    'PROJECTOS_OAUTH_ISSUER must be the https:// origin this server is reached at. OAuth 2.1 requires ' +
      'an HTTPS issuer, and a client that follows the spec will refuse anything else — which is one ' +
      'explanation for a loopback attempt being reported as "does not implement OAuth".',
  );
}
if (issuer.endsWith('/')) problems.push('PROJECTOS_OAUTH_ISSUER must not end with a slash');
if (resource === '') {
  problems.push(
    'PROJECTOS_OAUTH_RESOURCE must name the MCP resource these tokens are for. It is the audience ' +
      'the private bridge checks, so a token minted here cannot be replayed at anything else.',
  );
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  problems.push(
    'PROJECTOS_OAUTH_PORT must be a whole number between 0 and 65535. Left unchecked it reaches ' +
      'server.listen as NaN, which throws from inside Node rather than through the diagnostics below.',
  );
}
if (signingKey.length < 32) {
  problems.push(
    'PROJECTOS_OAUTH_SIGNING_KEY must be at least 32 characters and must be the SAME value the ' +
      'private bridge holds. It is what lets the bridge trust a token this server minted without ' +
      'either side calling the other. ProjectOS does not create it: that is an owner act.',
  );
}
if (problems.length > 0) {
  console.error('ProjectOS OAuth server: not ready.');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const state = newOAuthState();
const config = { issuer, resource, signingKey };

const server = createServer((request, response) => {
  serveAuthorizationServer(request, response, { state, config });
});

server.listen(port, host, () => {
  console.log(`ProjectOS OAuth server listening on ${host}:${port}`);
  console.log(`  issuer:   ${issuer}`);
  console.log(`  resource: ${resource}`);
  console.log(`  approval PIN: ${state.pin}   (needed once, to authorise a connector)`);
  console.log('  serves ONLY the OAuth routes. There is no MCP surface in this process.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

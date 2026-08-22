#!/usr/bin/env node
/**
 * Start the private ProjectOS MCP bridge in the split shape.
 *
 * The bridge stays on loopback. All it publishes about OAuth is a pointer: its protected-resource
 * metadata names the public authorization server, which is exactly the discovery chain the tunnel
 * documentation describes — read the resource metadata from the MCP server, then follow
 * authorization_servers[0]. It serves no authorization flow of its own in this shape.
 *
 * THE SIGNING KEY IS READ, NOT PASSED. Same reason as the authorization server: an argument is
 * visible in the process list. Both halves read the same file and neither transmits it; that shared
 * value is the whole reason the private half can trust a token the public half minted without the two
 * ever speaking.
 *
 * A FRESH APPROVAL PIN IS PRINTED TO THIS TERMINAL ONLY — but note that in the split shape the PIN
 * that matters belongs to the authorization server, since that is where the browser lands.
 *
 * Usage: node projectos/scripts/c15-start-bridge-split.mjs <issuer-origin>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const issuer = (process.argv[2] ?? '').replace(/\/$/, '');
if (!issuer.startsWith('https://')) {
  console.error('Usage: node projectos/scripts/c15-start-bridge-split.mjs https://<oauth-hostname>');
  process.exit(1);
}

const stateDir = join(process.env.LOCALAPPDATA ?? '', 'ProjectOS', 'installation-state');
let signingKey = '';
try {
  signingKey = readFileSync(join(stateDir, 'oauth-signing-key'), 'utf8').trim();
} catch {
  console.error('No OAuth signing key exists. The authorization server holds one; this bridge needs the same.');
  process.exit(1);
}

process.env.PROJECTOS_BRIDGE_PORT = process.env.PROJECTOS_BRIDGE_PORT ?? '8787';
process.env.PROJECTOS_OAUTH_ISSUER = issuer;
process.env.PROJECTOS_OAUTH_RESOURCE = `${issuer}/mcp`;
process.env.PROJECTOS_OAUTH_SIGNING_KEY = signingKey;

await import('../agent/bin/projectos-bridge.js');

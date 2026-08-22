#!/usr/bin/env node
/**
 * Start the C15 public authorization server, reading its key rather than being handed one.
 *
 * WHY A LAUNCHER AND NOT A COMMAND LINE. The signing key is the whole trust anchor between the two
 * halves, and anything passed as an argument is visible in the process list to everything running on
 * this machine. So it is read here, from the installation state directory, and placed in this
 * process's own environment before the server is loaded — it never appears in argv, never in a shell
 * history, and never in anything this process prints.
 *
 * THE PIN IS PRINTED TO THIS TERMINAL AND NOWHERE ELSE. That is the point of it: approving a
 * connector requires someone to be at this machine reading this window. It is not written to a file,
 * not returned over HTTP, and not repeated in any report.
 *
 * Usage: node projectos/scripts/c15-start-oauth-server.mjs <issuer-origin>
 *   e.g. node projectos/scripts/c15-start-oauth-server.mjs https://oauth-projectos.example.com
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const issuer = (process.argv[2] ?? '').replace(/\/$/, '');
if (!issuer.startsWith('https://')) {
  console.error('Usage: node projectos/scripts/c15-start-oauth-server.mjs https://<oauth-hostname>');
  console.error('The issuer must be the public https origin this server is reached at.');
  process.exit(1);
}

const stateDir = join(process.env.LOCALAPPDATA ?? '', 'ProjectOS', 'installation-state');
let signingKey = '';
try {
  signingKey = readFileSync(join(stateDir, 'oauth-signing-key'), 'utf8').trim();
} catch {
  console.error('No OAuth signing key exists in the installation state directory.');
  console.error('ProjectOS does not create one as a side effect of starting: that is a deliberate act.');
  process.exit(1);
}
if (signingKey.length < 32) {
  console.error('The stored OAuth signing key is too short to be a credential.');
  process.exit(1);
}

process.env.PROJECTOS_OAUTH_ISSUER = issuer;
process.env.PROJECTOS_OAUTH_RESOURCE = `${issuer}/mcp`;
process.env.PROJECTOS_OAUTH_SIGNING_KEY = signingKey;
process.env.PROJECTOS_OAUTH_HOST = '127.0.0.1';
process.env.PROJECTOS_OAUTH_PORT = process.env.PROJECTOS_OAUTH_PORT ?? '8788';

await import('../agent/bin/projectos-oauth.js');

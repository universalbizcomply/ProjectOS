#!/usr/bin/env node
/**
 * The owner's private MCP bridge, as a process.
 *
 * SEPARATE FROM `projectos` ON PURPOSE. The CLI is synchronous: it composes a program, prints its
 * result and exits. A bridge stays up. Rather than teach the CLI to sometimes not return, the serving
 * entrypoint is its own file — which also means the long-running surface is one small, obvious thing
 * an owner can start, stop and read, instead of a mode hidden inside a command.
 *
 * WHAT IT PRINTS. That it is listening, and the port, because the operator has to tell the tunnel
 * client which port to forward. That is a local fact printed to a local terminal; it never travels to
 * a client, and neither does anything else about this machine.
 *
 * Run `npm run build` in projectos/agent first (imports ../dist).
 */
import { run as runCli } from '../dist/cli.js';
import { nodeSystem, setProcessRoot } from '../dist/system.js';
import { installNodeGovernanceEngines } from '../dist/nodeGovernanceEngines.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../dist/nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity } from '../dist/installation/projectAllowlist.js';
import { handleBridgeRpc } from '../dist/mcp/bridge.js';
import { bridgeListenerConfig, serveBridge, BRIDGE_BIND_HOST, BRIDGE_PATH } from '../dist/mcp/listener.js';
import { newOAuthState } from '../dist/mcp/oauth.js';
import { parseProjectConfig } from '@projectos/core';
import { configPath } from '../dist/context.js';
import { randomBytes } from 'node:crypto';

installNodeGovernanceEngines();
setProcessRoot(process.cwd());

const ctx = { sys: nodeSystem, root: nodeSystem.cwd() };
const stateDir = nodeInstallationStateDir();
if (stateDir === null) {
  console.error('ProjectOS bridge: this installation cannot locate its own state directory.');
  process.exit(1);
}

// THE PROJECT IS READ FROM THE PROJECT, ONCE, AT START. A bridge bound to no project would accept a
// project id from the conversation, which is the far end choosing what it is allowed to ask about.
const cfgText = nodeSystem.readText(configPath(ctx.root));
const parsed = cfgText === null ? null : parseProjectConfig(JSON.parse(cfgText));
if (parsed === null || !parsed.ok) {
  console.error('ProjectOS bridge: this directory has no valid .projectops/project-config.json.');
  process.exit(1);
}
const projectId = parsed.value.projectId;

const config = bridgeListenerConfig(nodeSystem, stateDir);
if (!config.ready) {
  console.error('ProjectOS bridge: not ready.');
  for (const problem of config.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// THE SAME DURABLE BINDING EVERY OTHER GATE USES. The install root comes from the trusted
// installation (resolved from its own module path, not from wherever this was started), and the
// repository is the canonical identity derived from the governed checkout's origin. A bridge that
// invented either would read a different ledger from the gates it reports on.
const repository = canonicalRepositoryIdentity(nodeSystem, ctx.root);
if (repository === null) {
  console.error('ProjectOS bridge: this checkout has no canonical repository identity.');
  process.exit(1);
}

const deps = {
  ctx,
  projectId,
  // NOTHING IS RECORDED AS AUTHORITY HERE. This revision exposes no operation that needs a prior
  // authorisation, so the honest list is empty — and an empty list refuses every request that claims
  // one, which is the correct answer until something real populates it.
  recordedAuthorityIds: [],
  stateDir,
  durable: { stateDir, installRoot: nodeProjectosRuntime().installRoot, repository },
};

// THE OAUTH SURFACE, WHICH MAY OR MAY NOT LIVE ON THIS ORIGIN.
//
// Co-locating it was the first attempt, and it was reasonable: OpenAI's own `tunnel-client dev
// mcp-stub` publishes issuer, authorize and token on the same loopback origin as the MCP endpoint.
// It did not survive contact with ChatGPT, which reported that the server did not implement OAuth —
// its connector setup discovers OAuth automatically and could not reach a loopback issuer.
//
// So there are two shapes now, and the environment decides which:
//
//   LOCAL (no PROJECTOS_OAUTH_ISSUER). Everything on this loopback origin, as before, with a signing
//   key invented at startup. Nothing outside this process can use a token, and nothing needs to.
//
//   SPLIT (PROJECTOS_OAUTH_ISSUER set). The authorization server stands on a public HTTPS origin and
//   this bridge stays private. All this process then publishes is the pointer: its protected-resource
//   metadata names that issuer, which is exactly the discovery chain `tunnel-client help oauth`
//   describes — read the resource metadata from the MCP server, then follow authorization_servers[0].
//   The two halves never call each other. The only thing they share is the signing key, which each
//   reads from its own environment: one mints, the other verifies.
/**
 * Where RFC 9728 says a resource's metadata lives.
 *
 * NOT the resource URL with a suffix bolted on. The well-known segment goes at the ROOT of the
 * resource's origin and the resource's own path follows it, so `https://host/mcp` is described at
 * `https://host/.well-known/oauth-protected-resource/mcp`. Appending instead produces a URL that
 * looks plausible, resolves nowhere, and fails as a client silently declining to authenticate.
 */
function resourceMetadataUrlFor(resource) {
  const url = new URL(resource);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

const publicIssuer = process.env.PROJECTOS_OAUTH_ISSUER ?? '';
const publicResource = process.env.PROJECTOS_OAUTH_RESOURCE ?? '';
const configuredKey = process.env.PROJECTOS_OAUTH_SIGNING_KEY ?? '';

if (publicIssuer !== '' && (!publicIssuer.startsWith('https://') || publicIssuer.endsWith('/'))) {
  // FAIL HERE, LOUDLY, RATHER THAN PER-REQUEST AND MUTELY. A malformed issuer is not rejected at
  // startup by anything else: it survives into the metadata, and the only symptom is a generic 403
  // on the authorization page with nothing to say why. The sibling authorization server already
  // refuses to start on the same grounds, and the two must agree or they do not describe one system.
  console.error(
    'ProjectOS bridge: PROJECTOS_OAUTH_ISSUER must be an https:// origin with no trailing slash. ' +
      'It is published verbatim as this bridge\'s authorization server, and OAuth 2.1 clients refuse ' +
      'anything else.',
  );
  process.exit(1);
}
if (publicIssuer !== '' && configuredKey.length < 32) {
  console.error(
    'ProjectOS bridge: PROJECTOS_OAUTH_ISSUER is set, so PROJECTOS_OAUTH_SIGNING_KEY must be set too ' +
      '(at least 32 characters, the SAME value the authorization server holds). Without it this ' +
      'bridge could not verify a token that server issued.',
  );
  process.exit(1);
}
if (publicIssuer !== '' && publicResource === '') {
  console.error(
    'ProjectOS bridge: PROJECTOS_OAUTH_RESOURCE must be set alongside PROJECTOS_OAUTH_ISSUER. It is ' +
      'the audience both halves agree on, and it is what stops a token minted for something else ' +
      'being spent here.',
  );
  process.exit(1);
}

// A LOCAL RUN STILL NEEDS A KEY. It is random, per-process and never leaves: tokens minted in this
// process are verified in this process, and a restart invalidates every one of them, which is the
// correct behaviour for a credential nobody outside is holding.
const signingKey = configuredKey !== '' ? configuredKey : randomBytes(32).toString('base64url');

const oauthState = newOAuthState();
const oauth = {
  state: oauthState,
  issuerFor: (port) => {
    const origin = `http://${BRIDGE_BIND_HOST}:${port}`;
    if (publicIssuer === '') {
      return { issuer: origin, resource: `${origin}${BRIDGE_PATH}`, signingKey };
    }
    return {
      issuer: publicIssuer,
      resource: publicResource,
      signingKey,
      // WHERE A CLIENT SHOULD LOOK WHEN IT IS TOLD TO LOOK SOMEWHERE. RFC 9728 lets this bridge point
      // at its own metadata from a `WWW-Authenticate` challenge, and that document is served here —
      // on the private origin the tunnel can reach — while the issuer it names is public.
      resourceMetadataUrl: resourceMetadataUrlFor(publicResource),
    };
  },
};

const server = await serveBridge(config, (request) => handleBridgeRpc(request, deps), oauth);
console.log(`ProjectOS owner bridge listening on ${BRIDGE_BIND_HOST}:${server.port}${BRIDGE_PATH}`);
console.log(`  project: ${projectId}`);
// THE ONE PLACE THIS PROCESS'S PIN IS EVER SHOWN. Printed to this terminal, like the port; never
// returned over HTTP, never written to a file, never in a record.
//
// IN THE SPLIT SHAPE IT IS NOT THE PIN THAT MATTERS. The browser is sent to the public authorization
// server, so the PIN to type is the one that server printed. Saying so here avoids the worst kind of
// confusion: two plausible PINs and no indication which one the page is asking for.
if (publicIssuer === '') {
  console.log(`  approval PIN: ${oauthState.pin}   (needed once, to authorise a connector)`);
} else {
  console.log(`  authorization server: ${publicIssuer}   (approve there; its terminal prints the PIN)`);
  console.log(`  resource (token audience): ${publicResource}`);
}
console.log('  point the tunnel client at that port. Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}

// `runCli` is imported so this entrypoint fails loudly at start if the build is stale, rather than
// on the first request.
void runCli;

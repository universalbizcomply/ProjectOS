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

// THE OAUTH SURFACE, CO-LOCATED ON THIS ORIGIN ON PURPOSE.
//
// OpenAI's own `tunnel-client dev mcp-stub` publishes issuer, authorize and token on the same
// loopback origin as the MCP endpoint, and the tunnel documentation says OAuth discovery travels the
// tunnel path so the MCP server can stay private. Same origin is what makes that true: a separate
// authorization server would be a second thing needing to be reachable, and the docs are explicit
// that the tunnel does not carry one.
const oauthState = newOAuthState();
const oauth = {
  state: oauthState,
  issuerFor: (port) => {
    const origin = `http://${BRIDGE_BIND_HOST}:${port}`;
    return { issuer: origin, resource: `${origin}${BRIDGE_PATH}` };
  },
};

const server = await serveBridge(config, (request) => handleBridgeRpc(request, deps), oauth);
console.log(`ProjectOS owner bridge listening on ${BRIDGE_BIND_HOST}:${server.port}${BRIDGE_PATH}`);
console.log(`  project: ${projectId}`);
// THE ONE PLACE THE PIN IS EVER SHOWN. Printed to this terminal, like the port; never returned over
// HTTP, never written to a file, never in a record. Approving a connector requires reading it here.
console.log(`  approval PIN: ${oauthState.pin}   (needed once, to authorise a connector)`);
console.log('  point the tunnel client at that port. Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}

// `runCli` is imported so this entrypoint fails loudly at start if the build is stale, rather than
// on the first request.
void runCli;

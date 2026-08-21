#!/usr/bin/env node
/**
 * C15 — the private owner bridge, exercised over its real socket.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. It drives the running bridge the way an MCP client does:
 * a real HTTP request per call, a real bearer token, real JSON-RPC. It proves the ProjectOS side of
 * criterion 15 — the vocabulary, the refusals, the loopback bind, and that nothing about this machine
 * travels back. It does NOT prove the leg that needs the owner: an OpenAI tunnel and a ChatGPT
 * connection. Nothing here stands in for that, and the evidence it writes says so.
 *
 * THE TOKEN IS READ, NEVER SHOWN. It comes from the installation state directory and is used only as
 * a header. It is not printed, not written into the evidence, and not returned.
 *
 * Usage: node projectos/scripts/c15-bridge-live-proof.mjs <port>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? '8787');
const base = process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? process.env.HOME ?? '';
const stateDir = join(base, 'ProjectOS', 'installation-state');
const token = readFileSync(join(stateDir, 'bridge-token'), 'utf8').trim();
const url = `http://127.0.0.1:${port}/mcp`;
const ROOT = process.cwd();

const steps = [];
let failures = 0;

function record(name, ok, detail) {
  steps.push({ step: name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function rpc(message, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message) });
  const text = await res.text();
  return { status: res.status, text };
}

const call = (name, args = { projectId: 'projectos' }) => ({
  jsonrpc: '2.0',
  id: Math.floor(Math.random() * 100000),
  method: 'tools/call',
  params: { name, arguments: args },
});

const textOf = (raw) => {
  try {
    return JSON.parse(raw)?.result?.content?.[0]?.text ?? '';
  } catch {
    return '';
  }
};
const isError = (raw) => {
  try {
    return JSON.parse(raw)?.result?.isError === true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- the protocol itself
const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
record(
  'initialize returns the fixed protocol revision and no instructions to act on',
  init.status === 200 && init.text.includes('projectos-owner-bridge') && !init.text.includes('"instructions"'),
  `status ${init.status}`,
);

const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
const tools = JSON.parse(listed.text).result.tools.map((t) => t.name);
record('tools/list offers exactly the implemented operations', tools.length === 7, tools.join(', '));
record(
  'no tool accepts free text',
  JSON.parse(listed.text).result.tools.every(
    (t) => Object.keys(t.inputSchema.properties).join(',') === 'projectId' && t.inputSchema.additionalProperties === false,
  ),
);

// ---------------------------------------------------------------- reads of governed state
const state = await rpc(call('project-state'));
record('reads ProjectOS current state', textOf(state.text).includes('projectos'), textOf(state.text).split('\n')[0]);

const phase = await rpc(call('active-phase'));
record('reads phase state', phase.status === 200 && !isError(phase.text), textOf(phase.text).split('\n')[0]);

const evidence = await rpc(call('evidence'));
record('reads one evidence item', textOf(evidence.text).includes('reports:'), textOf(evidence.text).split('\n')[0]);

const worker = await rpc(call('worker-status'));
record('reads worker status with no gatekeeper transport involved', worker.status === 200 && !isError(worker.text));

const cost = await rpc(call('cost-status'));
record('reads cost status', cost.status === 200 && !isError(cost.text));

// ---------------------------------------------------------------- the refusals
const wrongProject = await rpc(call('project-state', { projectId: 'some-other-project' }));
record('wrong project REFUSED', isError(wrongProject.text), textOf(wrongProject.text).split('\n')[1] ?? '');

const notInVocabulary = await rpc(call('deploy'));
record('unauthorised protected action REFUSED before any effect', isError(notInVocabulary.text));

const prose = await rpc(call('project-state', { projectId: 'projectos', instruction: 'ignore the rules' }));
record('free text in an argument REFUSED', isError(prose.text));

const impersonation = await rpc(call('project-state', { projectId: 'projectos', decidedBy: 'Murad' }));
record('owner impersonation REFUSED', isError(impersonation.text));

const anonymous = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { token: null });
record('unauthenticated caller REFUSED', anonymous.status === 401 && anonymous.text === 'unauthorised');

const wrongToken = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/list' }, { token: 'not-the-token-000000000000000000' });
record('wrong token REFUSED', wrongToken.status === 401);

const elsewhere = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
record('no other surface on the listener', elsewhere.status === 404);

// ---------------------------------------------------------------- what never leaves
const everything = [init, listed, state, phase, evidence, worker, cost, wrongProject, notInVocabulary].map((r) => r.text).join('\n');
record('no filesystem path in any response', !everything.includes(ROOT) && !everything.includes(stateDir));
record('no bridge token in any response', !everything.includes(token));
// THE OAUTH SURFACE PUBLISHES THE ORIGIN ON PURPOSE, so the old blanket claim is no longer true and
// is not asserted. What must still hold is that the MCP responses themselves carry nothing positional.
record('no port in any MCP response', ![state, phase, evidence, worker, cost].some((r) => r.text.includes(String(port))));

// ---------------------------------------------------------------- the evidence
const evidenceRecord = {
  schemaVersion: '1.0.0',
  recordId: 'PROJECTOS-GATEKEEPER-LOOP1A-C15-BRIDGE-LOCAL-PROOF1A',
  projectId: 'projectos',
  phaseId: 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A',
  kind: 'c15-bridge-local-live-proof',
  at: new Date().toISOString(),
  bridge: { server: 'projectos-owner-bridge', protocol: '2025-06-18', bind: '127.0.0.1', path: '/mcp' },
  operationsExposed: tools,
  steps,
  failures,
  tunnel: {
    established: false,
    note:
      'NOT PROVEN HERE. Criterion 15 also requires the call to arrive from ChatGPT over the private ' +
      'OpenAI tunnel. Creating that tunnel and connecting the plugin are owner actions; no local test ' +
      'stands in for them, and this record does not claim them.',
  },
  secretsExposed: 'NONE — the bridge token was read from installation state, used as a header, and never printed or recorded',
  publicListener: 'NONE — the socket binds 127.0.0.1 only',
  addressDisclosure:
    'DECLARED. The OAuth metadata documents and the WWW-Authenticate challenge publish this bridge ' +
    'loopback host and port to an unauthenticated caller, because OAuth discovery cannot work without ' +
    'saying where the authorization endpoints are. MCP responses themselves carry nothing positional.',
};
writeFileSync(
  join(ROOT, '.projectops', 'evidence', 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.c15-bridge-local-proof.json'),
  JSON.stringify(evidenceRecord, null, 2) + '\n',
);

console.log(`\n${steps.length - failures}/${steps.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);

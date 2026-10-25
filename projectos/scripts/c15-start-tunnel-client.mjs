#!/usr/bin/env node
/**
 * Start the OpenAI tunnel-client against the replacement C15 tunnel.
 *
 * TWO SECRETS, NEITHER IN ARGV. The control-plane runtime key and the ProjectOS bridge token are both
 * read here from the installation state directory and handed to the child through its environment,
 * which is what `env:NAME` in the tunnel-client flags expects. Anything passed as an argument would be
 * visible in the process list to everything else on this machine.
 *
 * THE RUNTIME KEY IS DELIBERATELY WEAK IN AUTHORITY. It carries Tunnels Read and Use and nothing else
 * — no Manage, no model access, no files. It can attach a client to a tunnel and cannot create, edit
 * or delete one. Creating tunnels is an act of the authenticated operator session, not of this
 * process.
 *
 * Usage: node projectos/scripts/c15-start-tunnel-client.mjs <tunnel-id> [--doctor]
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tunnelId = process.argv[2] ?? '';
const doctorOnly = process.argv.includes('--doctor');
if (!/^tunnel_[a-z0-9]+$/.test(tunnelId)) {
  console.error('Usage: node projectos/scripts/c15-start-tunnel-client.mjs tunnel_<id> [--doctor]');
  process.exit(1);
}

const stateDir = join(process.env.LOCALAPPDATA ?? '', 'ProjectOS', 'installation-state');
const read = (name, label) => {
  try {
    const v = readFileSync(join(stateDir, name), 'utf8').trim();
    if (v === '') throw new Error('empty');
    return v;
  } catch {
    console.error(`${label} is missing from the installation state directory. Nothing is started.`);
    process.exit(1);
  }
};

const runtimeKey = read('openai-tunnel-runtime-key', 'The OpenAI tunnel runtime key');
const bridgeToken = read('bridge-token', 'The ProjectOS bridge token');

const exe = join(
  process.cwd(),
  'Tunnel-Client',
  'tunnel-client-v0.0.12-windows-amd64',
  'tunnel-client.exe',
);

const args = doctorOnly
  ? ['doctor', '--explain']
  : ['run'];
const common = [
  '--control-plane.tunnel-id', tunnelId,
  '--control-plane.api-key', 'env:CONTROL_PLANE_API_KEY',
  '--mcp.server-url', 'channel=main,url=http://127.0.0.1:8787/mcp',
  '--mcp.extra-headers', 'Authorization: env:PROJECTOS_BRIDGE_AUTH',
  '--mcp.discovery-extra-headers', 'Authorization: env:PROJECTOS_BRIDGE_AUTH',
];

const child = spawn(exe, [...args, ...common], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CONTROL_PLANE_API_KEY: runtimeKey,
    PROJECTOS_BRIDGE_AUTH: `Bearer ${bridgeToken}`,
  },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));

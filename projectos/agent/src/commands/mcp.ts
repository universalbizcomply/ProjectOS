/**
 * `projectos mcp` — what the owner's private bridge would do, and whether it can run at all.
 *
 * IT DOES NOT SERVE. The CLI is a synchronous, pure program that prints a result and exits; a bridge
 * is a process that stays up. Rather than bend one into the other, serving lives in its own
 * entrypoint (`bin/projectos-bridge.js`) and this command answers the questions an owner actually has
 * before starting it: what will be exposed, what is missing, and what nothing here can ever do.
 *
 * NOTHING IT PRINTS IS A SECRET. The readiness check says whether a token is configured, never what
 * it is, and never where the state directory lives beyond what the owner already knows.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../context.js';
import type { Flags } from '../flags.js';
import { IMPLEMENTED_OPERATIONS, BRIDGE_SERVER_NAME, MCP_PROTOCOL_VERSION } from '../mcp/bridge.js';
import {
  bridgeListenerConfig,
  BRIDGE_BIND_HOST,
  BRIDGE_PATH,
  BRIDGE_TOKEN_BYTES,
  BRIDGE_TOKEN_FILENAME,
} from '../mcp/listener.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import { EFFECTS_ABSENT_FROM_THE_BRIDGE } from '@projectos/core';

/**
 * Mint the bridge credential, once, where the installation keeps its own state.
 *
 * AN EXPLICIT ACT, NOT A SIDE EFFECT. A bridge that generates a token when it happens to need one has
 * quietly created material authority and then authenticated itself with it. This is a command the
 * owner runs, it refuses to overwrite an existing token, and it never prints the value — not to the
 * terminal, not to a report, not into any model's context. What it prints is that one now exists.
 *
 * WHERE IT LIVES, AND WHAT THAT IS WORTH. The installation's own state directory, outside every
 * repository, protected by the account's own permissions — the same protection the durable degraded
 * ledger has. It is a plaintext file on that account. Anything already running as this user could
 * read it, and could equally read anything else this account can; the token's job is to stop a
 * TUNNEL from being a way in, not to survive the account being compromised.
 */
function createToken(ctx: CommandContext, stateDir: string): CommandResult {
  const path = join(stateDir, BRIDGE_TOKEN_FILENAME);
  const existing = ctx.sys.readText(path);
  if (existing !== null && existing.trim() !== '') {
    return {
      code: 1,
      lines: [
        'a bridge token already exists, and this command will not replace it',
        '  replacing it would silently break any tunnel already trusting the old one',
        '  to rotate deliberately: remove the token file yourself, then run this again',
      ],
    };
  }
  // `createExclusive` so two runs cannot both believe they minted it.
  const value = randomBytes(BRIDGE_TOKEN_BYTES).toString('base64url');
  if (!ctx.sys.createExclusive(path, `${value}\n`)) {
    return { code: 1, lines: ['the bridge token could not be created in the installation state directory'] };
  }
  const back = ctx.sys.readText(path);
  if (back === null || back.trim() !== value) {
    return { code: 1, lines: ['the bridge token could not be read back after writing, so it is not trusted'] };
  }
  return {
    code: 0,
    lines: [
      'bridge token: CREATED',
      `  entropy:      ${BRIDGE_TOKEN_BYTES} bytes, base64url`,
      '  stored in:    the installation state directory, outside every repository',
      '  value shown:  NO — and it is never printed, reported, committed or sent to a model',
      '',
      '  start the bridge with: node ./bin/projectos-bridge.js',
    ],
  };
}

export function mcp(ctx: CommandContext, flags: Flags, positionals: readonly string[]): CommandResult {
  const sub = positionals[0] ?? 'status';
  if (sub !== 'status' && sub !== 'token') {
    return {
      code: 1,
      lines: [`Unknown mcp subcommand: ${sub}`, '', 'Usage: projectos mcp status | projectos mcp token --create'],
    };
  }

  // NO STATE DIRECTORY, NO BRIDGE. An installation that cannot locate its own state cannot hold a
  // token, and guessing a location would put the owner's credential somewhere nobody chose.
  const stateDir = nodeInstallationStateDir();
  if (stateDir === null) {
    return {
      code: 1,
      lines: [
        'ProjectOS owner bridge: NOT READY',
        '  this installation cannot locate its own state directory, so it can hold no bridge token',
      ],
    };
  }
  if (sub === 'token') {
    if (flags['create'] !== true) {
      return { code: 1, lines: ['`projectos mcp token` requires --create'] };
    }
    return createToken(ctx, stateDir);
  }

  const config = bridgeListenerConfig(ctx.sys, stateDir);
  const lines: string[] = [
    `ProjectOS owner bridge (${BRIDGE_SERVER_NAME}, MCP ${MCP_PROTOCOL_VERSION})`,
    `  binds:      ${BRIDGE_BIND_HOST}${BRIDGE_PATH} — loopback only, never the network`,
    `  token:      ${config.token === null ? 'NOT CONFIGURED' : 'configured'}`,
    `  ready:      ${config.ready ? 'yes' : 'no'}`,
    '',
    '  operations exposed:',
    ...IMPLEMENTED_OPERATIONS.map((o) => `    - ${o}`),
    '',
    '  it has no vocabulary for, whatever it is asked:',
    ...EFFECTS_ABSENT_FROM_THE_BRIDGE.map((e) => `    - ${e}`),
  ];
  if (!config.ready) {
    lines.push('', '  not ready:');
    for (const problem of config.problems) lines.push(`    - ${problem}`);
  } else {
    lines.push('', '  start it with: node ./bin/projectos-bridge.js');
  }
  return { code: config.ready ? 0 : 1, lines };
}

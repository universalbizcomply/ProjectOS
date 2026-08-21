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
import type { CommandContext, CommandResult } from '../context.js';
import type { Flags } from '../flags.js';
import { IMPLEMENTED_OPERATIONS, BRIDGE_SERVER_NAME, MCP_PROTOCOL_VERSION } from '../mcp/bridge.js';
import { bridgeListenerConfig, BRIDGE_BIND_HOST, BRIDGE_PATH } from '../mcp/listener.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import { EFFECTS_ABSENT_FROM_THE_BRIDGE } from '@projectos/core';

export function mcp(ctx: CommandContext, _flags: Flags, positionals: readonly string[]): CommandResult {
  const sub = positionals[0] ?? 'status';
  if (sub !== 'status') {
    return { code: 1, lines: [`Unknown mcp subcommand: ${sub}`, '', 'Usage: projectos mcp status'] };
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

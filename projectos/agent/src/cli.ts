/**
 * CLI dispatcher: parse argv into a command + flags and route to a command function.
 * Pure — returns a CommandResult; the bin entrypoint does the actual printing/exit.
 */
import type { CommandContext, CommandResult } from './context.js';
import { ok } from './context.js';
import type { Flags } from './flags.js';
import { status } from './commands/status.js';
import { init } from './commands/init.js';
import { validate } from './commands/validate.js';
import { prompt } from './commands/prompt.js';
import { report } from './commands/report.js';
import { close } from './commands/close.js';
import { phase } from './commands/phase.js';
import { approve } from './commands/approve.js';
import { install } from './commands/install.js';
import { CORE_VERSION } from '@projectos/core';

export const AGENT_VERSION = '0.1.0';

export interface ParsedArgs {
  readonly command: string;
  readonly flags: Flags;
  /** Non-flag tokens after the command (e.g. a subcommand). */
  readonly positionals: readonly string[];
}

/** Parse `cmd sub --key value --flag` into { command, positionals, flags }. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0] ?? 'help';
  const rest = argv.slice(1);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === undefined) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { command, flags, positionals };
}

export const HELP: readonly string[] = [
  'projectos — ProjectOS local agent',
  '',
  'Usage: projectos <command> [flags]',
  '',
  'Commands:',
  '  status                       Show project, branch, config, report counts',
  '  init --id <slug> [--name ..] Scaffold .projectops/project-config.json (cwd)',
  '  install --target <path> --id <slug>  Install .projectops into a product repo',
  '  validate [--framework]       Validate the project-config (and framework validators)',
  '  prompt --phase <ID> [..]     Render a Claude phase prompt',
  '  report [--phase <ID>]        List reports, or write an evidence skeleton',
  '  phase <new|advance|show|list>  Run/persist a phase through its lifecycle',
  '  approve <request|decide|show|list>  Request/decide approvals (owner-gated)',
  '  close --phase <ID>           Refuses — closure is owner-gated',
  '  version                      Print versions',
  '  help                         Show this help',
];

export function run(ctx: CommandContext, argv: readonly string[]): CommandResult {
  const { command, flags, positionals } = parseArgs(argv);
  switch (command) {
    case 'phase':
      return phase(ctx, flags, positionals);
    case 'approve':
      return approve(ctx, flags, positionals);
    case 'status':
      return status(ctx);
    case 'init':
      return init(ctx, flags);
    case 'install':
      return install(ctx, flags);
    case 'validate':
      return validate(ctx, flags);
    case 'prompt':
      return prompt(ctx, flags);
    case 'report':
      return report(ctx, flags);
    case 'close':
      return close(ctx, flags);
    case 'version':
    case '--version':
      return ok([`projectos ${AGENT_VERSION} (core ${CORE_VERSION})`]);
    case 'help':
    case '--help':
      return ok(HELP);
    default:
      return { code: 1, lines: [`Unknown command: ${command}`, '', ...HELP] };
  }
}

/**
 * CLI dispatcher: parse argv into a command + flags and route to a command function.
 * Pure — returns a CommandResult; the bin entrypoint does the actual printing/exit.
 */
import type { CommandContext, CommandResult } from './context.js';
import { ok } from './context.js';
import type { Flags } from './flags.js';
import { status } from './commands/status.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { validate } from './commands/validate.js';
import { prompt } from './commands/prompt.js';
import { report } from './commands/report.js';
import { close } from './commands/close.js';
import { closure } from './commands/closure.js';
import { phase } from './commands/phase.js';
import { approve } from './commands/approve.js';
import { plan } from './commands/plan.js';
import { plugins } from './commands/plugins.js';
import { install } from './commands/install.js';
import { run as runPhase, continueCommand } from './commands/run.js';
import { reconcile } from './commands/reconcile.js';
import { mcp } from './commands/mcp.js';
import { workforce } from './commands/workforce.js';
import { stop } from './commands/stop.js';
import { platformStopDirOf, platformStopRefusal } from './loop/platformStop.js';
import { CORE_VERSION } from '@projectos/core';

/**
 * RE-EXPORTED FOR THE CONTROL CENTER SIDECAR, which dispatches `phase`, `approve`, `report` and `plan`
 * in process and so never passes through the gate below. It imports `@projectos/agent`, whose index
 * re-exports this module, so this is how it reaches the ONE check rather than keeping a copy of it.
 */
export { platformStopRefusal, PLATFORM_STOP_STATEMENT } from './loop/platformStop.js';

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
  '  doctor                       Preflight: is this machine fit for governed work (read-only)',
  '  status                       Show project, branch, config, report counts',
  '  init --id <slug> [--name ..] Scaffold .projectops/project-config.json (cwd)',
  '  install --target <path> --id <slug>  Install .projectops into a product repo',
  '  validate [--framework]       Validate the project-config (and framework validators)',
  '  prompt --phase <ID> [..]     Render a Claude phase prompt',
  '  report [--phase <ID>]        List reports, or write an evidence skeleton',
  '  phase <new|advance|show|list>  Run/persist a phase through its lifecycle',
  '  approve <request|decide|show|list>  Request/decide approvals (owner-gated)',
  '  plan [draft|drafts|show]     Execution plan; or submit an objective and generate a DRAFT',
  '  run [--worker <id>] [--dry-run]  Advance the approved plan by one phase with the governed worker',
  '  continue --execute|--dry-run  Carry the programme from where it stands: run, closure request or closure resume',
  '  reconcile --grant <ID> --work <ID> --dry-run|--execute  Discharge one degraded work item’s review debt',
  '  mcp status                   Whether the private owner bridge can run, and what it exposes',
  '  workforce <roster|team|check-update|acquire|evaluate>  Inspect the governed specialist workforce',
  '  plugins                      List the integration catalog (inert)',
  '  close --phase <ID>           Refuses — closure is owner-gated',
  '  closure <request|resume|status> --id <ID>  Ask the closure authority, wait for the owner’s commit, resume',
  '  stop [engage|status|lift]    Platform-wide emergency stop: engage (no authority), status, owner-only lift',
  '  version                      Print versions',
  '  help                         Show this help',
];

/**
 * WHAT MAY STILL RUN WHILE THE PLATFORM STOP IS ENGAGED — an ALLOWLIST, and everything else refuses.
 *
 * DENY BY DEFAULT, because the failure the other way round is silent: a command added next month and
 * forgotten here would keep working through an emergency stop and nobody would notice until it mattered.
 * Forgotten here, it refuses instead, which is loud and safe. What is listed reads and reports only:
 * the stop itself (engaging is always safe, status reads, and the lift carries its own owner-commit
 * check), help and versions, and the read-only views of each command.
 *
 * `--dry-run` IS NOT ON IT. A dry run writes a worker brief and session records, and "prepare everything
 * for the moment the stop is lifted" is not a read; it refuses like the live form.
 */
export function readOnlyUnderPlatformStop(command: string, positionals: readonly string[], flags: Flags): boolean {
  const sub = positionals[0];
  switch (command) {
    case 'stop':
    case 'help':
    case '--help':
    case 'version':
    case '--version':
    case 'doctor':
    case 'status':
    case 'plugins':
    case 'validate':
    case 'prompt':
      return true;
    case 'closure':
      return sub === undefined || sub === 'status';
    case 'phase':
    case 'approve':
      return sub === undefined || sub === 'show' || sub === 'list';
    case 'plan':
      return sub === undefined || sub === 'show' || sub === 'drafts';
    case 'workforce':
      return sub === 'roster' || sub === 'team' || sub === 'check-update';
    case 'mcp':
      return sub === undefined || sub === 'status';
    case 'report':
      return flags['phase'] === undefined;
    default:
      return false;
  }
}

export function run(ctx: CommandContext, argv: readonly string[]): CommandResult {
  const { command, flags, positionals } = parseArgs(argv);
  // THE PLATFORM STOP, ASKED BEFORE ANY COMMAND IS DISPATCHED. One file read, nothing run; a refusal is
  // the command's whole answer and nothing has been written, spawned, spent, committed or pushed.
  if (!readOnlyUnderPlatformStop(command, positionals, flags)) {
    const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));
    if (halted !== null) return { code: 2, lines: halted };
  }
  switch (command) {
    case 'stop':
      return stop(ctx, flags, positionals);
    case 'phase':
      return phase(ctx, flags, positionals);
    case 'approve':
      return approve(ctx, flags, positionals);
    case 'plan':
      return plan(ctx, flags, positionals);
    case 'run':
      return runPhase(ctx, flags);
    case 'reconcile':
      return reconcile(ctx, flags);
    case 'continue':
      return continueCommand(ctx, flags);
    case 'mcp':
      return mcp(ctx, flags, positionals);
    case 'workforce':
      return workforce(ctx, flags, positionals);
    case 'plugins':
      return plugins(ctx);
    case 'doctor':
      return doctor(ctx);
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
    case 'closure':
      return closure(ctx, flags, positionals);
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

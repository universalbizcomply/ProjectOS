/**
 * `projectos close` — deliberately CANNOT close a phase.
 *
 * Closure is owner-gated (closureAuthorityGate): only Murad/ChatGPT may mark a phase
 * CLOSED. This command exists to make that explicit and to refuse safely. Even with
 * --as owner --confirm it does not mutate any report/index; it only prints how the owner
 * records a closure. Exit code 2 (blocked) when the owner acknowledgement is absent.
 *
 * Flags: --phase (required), --as, --confirm
 */
import type { CommandContext, CommandResult } from '../context.js';
import { fail } from '../context.js';
import { type Flags, str, bool } from '../flags.js';

export function close(_ctx: CommandContext, flags: Flags): CommandResult {
  const phaseId = str(flags, 'phase');
  if (phaseId === '') {
    return fail(1, ['`close` requires --phase <PHASE-ID>']);
  }

  const lines = [
    `Closure of ${phaseId} is OWNER-GATED.`,
    'ProjectOS (and Claude) cannot close a phase — only Murad/ChatGPT may.',
  ];

  if (str(flags, 'as') === 'owner' && bool(flags, 'confirm')) {
    return {
      code: 0,
      lines: [
        ...lines,
        'Owner acknowledgement noted (no file changed).',
        `To record closure: set the ${phaseId} report status to CLOSED and add its`,
        'Reports Index row manually.',
      ],
    };
  }

  return {
    code: 2,
    lines: [
      ...lines,
      'Re-run with `--as owner --confirm` only if you are the owner recording a decision.',
    ],
  };
}

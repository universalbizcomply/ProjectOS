/**
 * `projectos prompt` — render a Claude phase prompt from flags. Prints to stdout, or
 * writes to a file with --out. Read-only unless --out is given.
 *
 * Flags: --phase (required), --project, --type, --objective, --path, --out
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { renderPhasePrompt } from '../templates.js';
import { type Flags, str } from '../flags.js';

export function prompt(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const phaseId = str(flags, 'phase');
  if (phaseId === '') {
    return fail(1, ['`prompt` requires --phase <PHASE-ID>']);
  }
  const text = renderPhasePrompt({
    project: str(flags, 'project', '<PROJECT>'),
    phaseId,
    phaseType: str(flags, 'type', 'GENERAL'),
    objective: str(flags, 'objective', '<one-paragraph objective>'),
    localPath: str(flags, 'path', root),
  });

  const out = str(flags, 'out');
  if (out !== '') {
    sys.writeText(out, text);
    return ok([`Wrote phase prompt to ${out}`]);
  }
  return ok(text.split('\n'));
}

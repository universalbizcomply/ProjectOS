/**
 * `projectos run` — advance the approved plan by one phase, as far as it can go without a decision.
 *
 * This is the only entry point to the execution loop, and it is deliberately thin: every refusal,
 * every choice and every record belongs to `loop/`, so the command cannot become a second place where
 * governance is decided.
 *
 * `--dry-run` prepares everything and starts nothing. It exists because "what would this do?" must be
 * answerable without doing it — the loop's whole risk is that it acts with nobody reading first.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { type Flags, str, bool } from '../flags.js';
import { runLoop } from '../loop/runner.js';

export function run(ctx: CommandContext, flags: Flags): CommandResult {
  const worker = str(flags, 'worker');
  const result = runLoop(ctx.sys, ctx.root, {
    ...(worker === '' ? {} : { workerId: worker }),
    dryRun: bool(flags, 'dry-run'),
  });
  if (!result.ok) return fail(1, result.lines);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok(result.lines);
}

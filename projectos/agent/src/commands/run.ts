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
  const dryRun = bool(flags, 'dry-run');
  const execute = bool(flags, 'execute');

  // LIVE EXECUTION REQUIRES POSITIVE INTENT, and this is why.
  //
  // `dryRun: bool(flags, 'dry-run')` made LIVE the default: a bare `projectos run` started a real
  // worker, so the difference between preparing and spawning was the ABSENCE of a flag. That is the
  // wrong way round for the most consequential thing this CLI does, and on 2026-08-16 a real worker
  // ran against Dead Aisle with no attributable invocation — a run nobody could account for
  // afterwards, because starting one took no positive act.
  if (dryRun && execute) {
    return fail(2, [
      'REFUSED (CONFLICTING_INTENT): --dry-run and --execute cannot both be given.',
      '  - --dry-run prepares and validates; --execute starts a real worker',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }
  if (!dryRun && !execute) {
    return fail(2, [
      'REFUSED (NO_EXECUTION_INTENT): `run` will not start a worker unless you say so.',
      '  - `projectos run --dry-run`  prepare and validate, spawn nothing',
      '  - `projectos run --execute`  start the authorised worker for real',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  const result = runLoop(ctx.sys, ctx.root, {
    ...(worker === '' ? {} : { workerId: worker }),
    dryRun,
  });
  if (!result.ok) return fail(1, result.lines);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok(result.lines);
}

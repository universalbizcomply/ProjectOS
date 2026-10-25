/**
 * `projectos doctor` — the same preflight the loop runs, asked on purpose.
 *
 * ONE IMPLEMENTATION, TWO CALLERS. This does not re-derive anything: it calls `runDoctor` exactly
 * as the loop does, with the same configured check commands, so what an owner sees here is what the
 * loop will decide. A second copy of the rules would be free to drift, and a drifted copy would say
 * a machine is fine seconds before the loop refuses it.
 *
 * IT IS READ-ONLY AND ALWAYS EXITS 0 ON A CLEAN BILL. A non-zero exit is reserved for BLOCKING
 * failures, so this is usable as a shell gate without a caller having to parse prose.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { loadGovernedContext } from '../governedContext.js';
import { configuredChecks } from '../loop/verification.js';
import { runDoctor, DOCTOR_BUDGET_MS, MANDATORY_CONTEXTS, type DoctorCheck } from '../doctor.js';

/** One line per check, wide enough to read and narrow enough to scan. */
function line(c: DoctorCheck): string {
  const mark = c.passed ? 'PASS' : c.severity === 'blocking' ? 'FAIL' : 'WARN';
  return `  ${mark}  ${c.asked} — ${c.detail} (${c.ms}ms)`;
}

export function doctor(ctx: CommandContext): CommandResult {
  const { sys, root } = ctx;
  // The configured check commands come from the project's own configuration, the same source the
  // loop reads. A project whose configuration cannot be read is exactly what Doctor is for, so an
  // unreadable one is not an error here — it becomes a finding below.
  const governed = loadGovernedContext(sys, root);
  const commands = governed.ok
    ? configuredChecks(governed.context.config as unknown as Record<string, unknown>).checks.map((c) => c.command)
    : [];

  const report = runDoctor(sys, root, { checkCommands: commands });
  const body = [
    `Doctor — ${report.totalMs}ms of a ${DOCTOR_BUDGET_MS}ms budget${report.withinBudget ? '' : ' — OVER BUDGET'}`,
    '',
    ...report.checks.map(line),
    '',
  ];

  if (report.safeToActAutonomously) {
    return ok([
      ...body,
      report.ok
        ? 'This machine is fit for governed autonomous work.'
        : 'This machine is fit for governed autonomous work. The warnings above block nothing.',
      '',
      `Doctor is MANDATORY for: ${MANDATORY_CONTEXTS.join(', ')}.`,
      'Browsing, read-only inspection and local preview are advisory contexts and are never blocked by it.',
      '',
      'Doctor performed no action and authorised none. It only read.',
    ]);
  }

  return fail(2, [
    ...body,
    'REFUSED: this machine is not fit for autonomous or paid governed work.',
    `The failures marked FAIL above withhold: ${MANDATORY_CONTEXTS.join(', ')}.`,
    'Browsing and read-only inspection are unaffected.',
    '',
    'Doctor performed no action and authorised none. Fix the above and run it again.',
  ]);
}

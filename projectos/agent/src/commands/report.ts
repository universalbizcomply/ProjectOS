/**
 * `projectos report` — generate an evidence-pack skeleton for a phase into
 * knowledge/reports/, using the canonical naming convention. Without --phase it lists the
 * existing reports and how many await review/closure.
 *
 * Flags: --phase, --project, --force
 */
import type { CommandContext, CommandResult } from '../context.js';
import { reportsDir, join, ok, fail } from '../context.js';
import { renderEvidenceSkeleton } from '../templates.js';
import { type Flags, str, bool } from '../flags.js';

export function report(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const dir = reportsDir(root);
  const phaseId = str(flags, 'phase');

  if (phaseId === '') {
    const reports = sys.listDir(dir).filter((f) => f.endsWith('.md')).slice().sort();
    if (reports.length === 0) {
      return ok([`No reports in ${dir}. Pass --phase <ID> to create one.`]);
    }
    const awaiting = reports.filter((f) => f.includes('AWAITING')).length;
    return ok([`${reports.length} reports in ${dir} (${awaiting} awaiting):`, ...reports.map((f) => `  ${f}`)]);
  }

  const project = str(flags, 'project', 'ProjectOS');
  const date = ctx.sys.now().slice(0, 10);
  const file = join(dir, `${date}_${project}_${phaseId}_AWAITING-REVIEW.md`);
  if (sys.exists(file) && !bool(flags, 'force')) {
    return fail(2, [`Refusing to overwrite ${file} (pass --force)`]);
  }
  sys.writeText(file, renderEvidenceSkeleton(project, phaseId, date));
  return ok([`Wrote evidence skeleton ${file}`, 'Fill it in. Closure remains owner-gated.']);
}

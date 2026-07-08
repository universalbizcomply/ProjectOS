/**
 * `projectos plan` — show the execution plan: which worker owns each workflow step, and
 * which step is owner-gated. Uses the core orchestration over the default worker set.
 * Read-only.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok } from '../context.js';
import { planWorkflow, DEFAULT_WORKERS } from '@projectos/core';

export function plan(_ctx: CommandContext): CommandResult {
  const planned = planWorkflow(DEFAULT_WORKERS);
  const lines = ['Execution plan (default workers):'];
  for (const p of planned) {
    const who = p.worker ? p.worker.displayName : '(unassigned)';
    const gate = p.gated ? '  [owner-gated]' : '';
    lines.push(`  ${p.step.id.padEnd(10)} ${p.role.padEnd(11)} ${who}${gate}`);
  }
  return ok(lines);
}

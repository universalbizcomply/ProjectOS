/**
 * `projectos phase <new|advance|show|list>` — the phase runtime.
 *
 * Persists core Phase objects and advances them through the lifecycle state machine, with
 * governance enforced: transitions to closed/closed_as_blocked require --as owner (the
 * core rejects otherwise). This is what makes ProjectOS actually *run* phases.
 *
 * Subcommands:
 *   new     --id <ID> --project <p> [--objective <o>] [--force]
 *   advance --id <ID> --to <status> [--as owner|advisor|implementer] [--note <n>]
 *   show    --id <ID>
 *   list
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { type Flags, str } from '../flags.js';
import {
  createPhase,
  transitionPhase,
  PHASE_TRANSITIONS,
  type PhaseStatus,
  type Role,
} from '@projectos/core';
import { loadPhase, savePhase, listPhaseIds } from '../phaseStore.js';
import { loadGovernedContext, refusalLines } from '../governedContext.js';

const ROLES: readonly Role[] = ['owner', 'advisor', 'implementer'];

function roleOf(flags: Flags): Role | null {
  const a = str(flags, 'as', 'implementer');
  return (ROLES as readonly string[]).includes(a) ? (a as Role) : null;
}

function isPhaseStatus(s: string): s is PhaseStatus {
  return Object.prototype.hasOwnProperty.call(PHASE_TRANSITIONS, s);
}

export function phase(
  ctx: CommandContext,
  flags: Flags,
  positionals: readonly string[],
): CommandResult {
  const sub = positionals[0] ?? 'list';
  switch (sub) {
    case 'new':
      return phaseNew(ctx, flags);
    case 'advance':
      return phaseAdvance(ctx, flags);
    case 'show':
      return phaseShow(ctx, flags);
    case 'list':
      return phaseList(ctx);
    default:
      return fail(1, [`Unknown 'phase' subcommand: ${sub}`, 'Use: phase new|advance|show|list']);
  }
}

function phaseNew(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase new` requires --id <PHASE-ID>']);
  // Governed context BEFORE any state is written: an invalid or wrong-project context must not be
  // able to create a phase record it then governs.
  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  if (loadPhase(sys, root, id) !== null && flags['force'] !== true) {
    return fail(2, [`Phase ${id} already exists (pass --force to recreate)`]);
  }
  const p = createPhase({
    phaseId: id,
    project: str(flags, 'project', 'ProjectOS'),
    objective: str(flags, 'objective', '<objective>'),
  });
  savePhase(sys, root, p);
  return ok([`Created phase ${id} (status: ${p.status})`]);
}

function phaseAdvance(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase advance` requires --id <PHASE-ID>']);
  const to = str(flags, 'to');
  if (to === '') return fail(1, ['`phase advance` requires --to <status>']);
  if (!isPhaseStatus(to)) {
    return fail(1, [`Unknown status '${to}'. Valid: ${Object.keys(PHASE_TRANSITIONS).join(', ')}`]);
  }
  const role = roleOf(flags);
  if (role === null) return fail(1, [`--as must be one of: ${ROLES.join(', ')}`]);

  // Same gate on advance: a phase must not be moved through its lifecycle under a context that is
  // not the approved plan's project, or under a plan that is no longer READY.
  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));

  const current = loadPhase(sys, root, id);
  if (current === null) return fail(1, [`No phase ${id} — run \`projectos phase new --id ${id}\``]);

  const note = str(flags, 'note');
  const r = transitionPhase(current, to, role, ctx.sys.now(), note === '' ? undefined : note);
  if (!r.ok) {
    // Owner-gated refusal is a governance block (exit 2); other illegal moves are 1.
    const code = r.error.includes("requires role 'owner'") ? 2 : 1;
    return fail(code, [r.error]);
  }
  savePhase(sys, root, r.value);
  return ok([`${id}: ${current.status} -> ${r.value.status} (by ${role})`]);
}

function phaseShow(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase show` requires --id <PHASE-ID>']);
  const p = loadPhase(sys, root, id);
  if (p === null) return fail(1, [`No phase ${id}`]);
  const lines = [
    `phase ${p.phaseId}`,
    `  project:   ${p.project}`,
    `  objective: ${p.objective}`,
    `  status:    ${p.status}`,
    `  history:`,
    ...p.history.map((h) => `    ${h.at} ${h.from} -> ${h.to} (${h.by})${h.note ? ` — ${h.note}` : ''}`),
  ];
  return ok(lines);
}

function phaseList(ctx: CommandContext): CommandResult {
  const { sys, root } = ctx;
  const ids = listPhaseIds(sys, root);
  if (ids.length === 0) return ok(['No phases. Create one with `projectos phase new --id <ID>`.']);
  const lines = ids.map((id) => {
    const p = loadPhase(sys, root, id);
    return `  ${id}: ${p ? p.status : '(unreadable)'}`;
  });
  return ok([`${ids.length} phase(s):`, ...lines]);
}

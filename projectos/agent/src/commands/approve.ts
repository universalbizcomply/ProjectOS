/**
 * `projectos approve <request|decide|show|list>` — the approval loop.
 *
 * Wires the core approval engine to persisted state. Gated actions can only be decided by
 * --as owner; prohibited actions (e.g. force push) additionally need --override. This is
 * the mechanism a phase uses before performing anything the risk engine flags.
 *
 * Subcommands:
 *   request --id <ID> --action "<text>" [--as owner|advisor|implementer]
 *   decide  --id <ID> --decision approved|rejected --as <role> [--override] [--note <n>]
 *   show    --id <ID>
 *   list
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { type Flags, str, bool } from '../flags.js';
import { reconciliationDebtBlock } from '../loop/degradedMode.js';
import { requestApproval, decide as coreDecide, type Role } from '@projectos/core';
import { loadApproval, saveApproval, listApprovalIds } from '../approvalStore.js';
import { loadGovernedContext, refusalLines } from '../governedContext.js';

const ROLES: readonly Role[] = ['owner', 'advisor', 'implementer'];

function roleOf(flags: Flags): Role | null {
  const a = str(flags, 'as', 'implementer');
  return (ROLES as readonly string[]).includes(a) ? (a as Role) : null;
}

/**
 * R17-2. The approval loop is a governed MUTATION and had no governed-context gate.
 *
 * `phase` has been gated since Phase 16: it will not create or advance a phase unless the config in
 * front of it names the project the approved plan is for, and unless that plan recomputes READY.
 * `approve` writes decisions that authorise protected actions and had none of that — so an approval
 * could be minted and decided in a checkout whose plan is for another project entirely, or under a
 * plan that is no longer READY, and nothing would notice. The gap was not that approvals could be
 * self-decided; the core already refuses that. It was that they were not bound to a project at all.
 *
 * Reads and listings stay ungated: showing what is already recorded changes nothing, and refusing to
 * READ an approval because the plan went stale would hide the very records an operator needs in
 * order to fix it.
 */
function governedOrRefusal(ctx: CommandContext): readonly string[] | null {
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  return gc.ok ? null : refusalLines(gc);
}

export function approve(
  ctx: CommandContext,
  flags: Flags,
  positionals: readonly string[],
): CommandResult {
  const sub = positionals[0] ?? 'list';
  switch (sub) {
    case 'request':
      return approveRequest(ctx, flags);
    case 'decide':
      return approveDecide(ctx, flags);
    case 'show':
      return approveShow(ctx, flags);
    case 'list':
      return approveList(ctx);
    default:
      return fail(1, [`Unknown 'approve' subcommand: ${sub}`, 'Use: approve request|decide|show|list']);
  }
}

function approveRequest(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`approve request` requires --id <ID>']);
  const action = str(flags, 'action');
  if (action === '') return fail(1, ['`approve request` requires --action "<text>"']);
  // Before anything is written: the project in front of us must be the project the plan governs.
  const refusal = governedOrRefusal(ctx);
  if (refusal !== null) return fail(2, refusal);
  if (loadApproval(sys, root, id) !== null && !bool(flags, 'force')) {
    return fail(2, [`Approval ${id} already exists (pass --force)`]);
  }
  const by = roleOf(flags);
  if (by === null) return fail(1, [`--as must be one of: ${ROLES.join(', ')}`]);

  const req = requestApproval(id, action, by, ctx.sys.now());
  saveApproval(sys, root, req);
  return ok([
    `Requested approval ${id}`,
    `  action:     ${req.action}`,
    `  risk:       ${req.risk}${req.gate ? ` (${req.gate})` : ''}`,
    `  gated:      ${req.gated}${req.prohibited ? ' (PROHIBITED — needs --override)' : ''}`,
    req.gated ? '  → owner must decide (`approve decide --as owner`)' : '  → may be self-decided',
  ]);
}

function approveDecide(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`approve decide` requires --id <ID>']);
  const decision = str(flags, 'decision');
  if (decision !== 'approved' && decision !== 'rejected') {
    return fail(1, ['`approve decide` requires --decision approved|rejected']);
  }
  const by = roleOf(flags);
  if (by === null) return fail(1, [`--as must be one of: ${ROLES.join(', ')}`]);

  const refusal = governedOrRefusal(ctx);
  if (refusal !== null) return fail(2, refusal);

  const req = loadApproval(sys, root, id);
  if (req === null) return fail(1, [`No approval ${id} — run \`projectos approve request --id ${id}\``]);

  // UNREVIEWED WORK BLOCKS THE AUTHORISATION, not only the closure.
  //
  // `approve decide` is where a gated or prohibited action — commit, push, force push — becomes an
  // APPROVED governed record. Gating phase closure and leaving this open meant the authorisation for
  // a major gate could be minted while degraded-mode work sat unreviewed, which is the same gate by
  // another name. Ungated approvals are untouched: they authorise nothing the debt is about.
  if (req.gated || req.prohibited) {
    const debt = reconciliationDebtBlock(sys, root);
    if (debt.length > 0) {
      return fail(2, [...debt, `  approval ${id}: ${String(req.action)}`]);
    }
  }

  const note = str(flags, 'note');
  const opts: { override?: boolean; note?: string } = {};
  if (bool(flags, 'override')) opts.override = true;
  if (note !== '') opts.note = note;

  const r = coreDecide(req, decision, by, ctx.sys.now(), opts);
  if (!r.ok) {
    const governance = r.error.includes("role 'owner'") || r.error.includes('prohibited');
    return fail(governance ? 2 : 1, [r.error]);
  }
  saveApproval(sys, root, r.value);
  return ok([`Approval ${id}: ${r.value.state} (by ${by})`]);
}

function approveShow(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`approve show` requires --id <ID>']);
  const a = loadApproval(sys, root, id);
  if (a === null) return fail(1, [`No approval ${id}`]);
  return ok([
    `approval ${a.id}`,
    `  action:     ${a.action}`,
    `  requestedBy:${a.requestedBy} @ ${a.requestedAt}`,
    `  risk:       ${a.risk}${a.gate ? ` (${a.gate})` : ''}`,
    `  gated:      ${a.gated}  prohibited: ${a.prohibited}`,
    `  state:      ${a.state}${a.decidedBy ? ` (by ${a.decidedBy} @ ${a.decidedAt ?? '?'})` : ''}`,
    ...(a.note ? [`  note:       ${a.note}`] : []),
  ]);
}

function approveList(ctx: CommandContext): CommandResult {
  const { sys, root } = ctx;
  const ids = listApprovalIds(sys, root);
  if (ids.length === 0) return ok(['No approvals. Create one with `projectos approve request --id <ID> --action "..."`.']);
  const lines = ids.map((id) => {
    const a = loadApproval(sys, root, id);
    return `  ${id}: ${a ? a.state : '(unreadable)'}`;
  });
  return ok([`${ids.length} approval(s):`, ...lines]);
}

/**
 * `projectos phase <new|advance|show|list>` — the phase runtime.
 *
 * Persists core Phase objects and advances them through the lifecycle state machine, with
 * governance enforced: transitions to closed/closed_as_blocked require --as owner (the
 * core rejects otherwise). This is what makes ProjectOS actually *run* phases.
 *
 * Subcommands:
 *   new     --id <ID> --project <p> [--objective <o>] [--force]
 *   advance --id <ID> --to <status> [--as owner|advisor|implementer] [--identity <who>] [--note <n>]
 *   show    --id <ID>
 *   list
 *   reconcile-objective --id <ID>
 *
 * Closure (`closed` / `closed_as_blocked`) is owner-only unless the approved plan records a
 * project-scoped `governance.closureDelegation`; then the named delegate may close with
 * `--as advisor --identity <delegate>`. The implementer can never close, by any route.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { type Flags, str } from '../flags.js';
import {
  createPhase,
  transitionPhase,
  authoriseClosure,
  grantNote,
  requiresOwner,
  PHASE_TRANSITIONS,
  type ClosureDelegation,
  type ClosureGrant,
  type PhaseStatus,
  type Role,
} from '@projectos/core';
import { loadPhase, savePhase, listPhaseIds } from '../phaseStore.js';
import { evaluateG4, g4RefusalLines } from '../closureGate.js';
import {
  loadGovernedContext,
  refusalLines,
  authorisePhase,
  authorisationRefusalLines,
} from '../governedContext.js';

const ROLES: readonly Role[] = ['owner', 'advisor', 'implementer'];

function roleOf(flags: Flags): Role | null {
  const a = str(flags, 'as', 'implementer');
  return (ROLES as readonly string[]).includes(a) ? (a as Role) : null;
}

function isPhaseStatus(s: string): s is PhaseStatus {
  return Object.prototype.hasOwnProperty.call(PHASE_TRANSITIONS, s);
}

/** Read `governance.<key>` off the approved plan as a string, or '' when absent. */
function gov(plan: Record<string, unknown>, key: string): string {
  const g = plan['governance'];
  if (typeof g !== 'object' || g === null) return '';
  const v = (g as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

/** The plan's closure delegation, or null when it records none. Shape is schema-validated already. */
function delegationOf(plan: Record<string, unknown>): ClosureDelegation | null {
  const g = plan['governance'];
  if (typeof g !== 'object' || g === null) return null;
  const d = (g as Record<string, unknown>)['closureDelegation'];
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  return d as unknown as ClosureDelegation;
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
    case 'reconcile-objective':
      return phaseReconcileObjective(ctx, flags);
    default:
      return fail(1, [
        `Unknown 'phase' subcommand: ${sub}`,
        'Use: phase new|advance|show|list|reconcile-objective',
      ]);
  }
}

/**
 * A placeholder is not an objective.
 *
 * `phase new` used to default `--objective` to the literal string `<objective>` and persist it, so a
 * governed phase record could carry a template token as its statement of purpose — and nothing ever
 * looked: no schema field, no validator and no G4 predicate reads `objective`. The angle-bracket form
 * is the shape every template in this repository uses for an unfilled slot, so it is the shape that
 * must never survive into a durable record.
 */
export function isPlaceholderObjective(value: string): boolean {
  const v = value.trim();
  return v === '' || /^<.*>$/.test(v);
}

/**
 * The objective a phase record should carry: the caller's, when they supplied a real one, otherwise
 * the ACTIVE APPROVED PLAN's own description of the phase. The plan is the authority on what a phase
 * is for, and `authorisePhase` has already resolved exactly that phase in order to authorise it —
 * the previous code had the approved description in hand and threw it away.
 */
export function resolveObjective(
  supplied: string,
  planDescription: string | undefined,
): { readonly ok: true; readonly objective: string } | { readonly ok: false; readonly reason: string } {
  if (!isPlaceholderObjective(supplied)) return { ok: true, objective: supplied.trim() };
  const fromPlan = (planDescription ?? '').trim();
  if (isPlaceholderObjective(fromPlan)) {
    return {
      ok: false,
      reason:
        'no objective was supplied and the active approved plan records no usable description for this phase; ' +
        'refusing rather than persisting a placeholder',
    };
  }
  return { ok: true, objective: fromPlan };
}

function phaseNew(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase new` requires --id <PHASE-ID>']);
  // Governed context BEFORE any state is written: an invalid or wrong-project context must not be
  // able to create a phase record it then governs.
  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  // A ready plan for the right project still does not authorise ANY phase id. Prove the requested
  // phase is one the owner approved, and that what it depends on is done, before anything is written.
  const auth = authorisePhase(sys, root, gc.context, id);
  if (!auth.ok) return fail(2, authorisationRefusalLines(auth));
  if (loadPhase(sys, root, id) !== null && flags['force'] !== true) {
    return fail(2, [`Phase ${id} already exists (pass --force to recreate)`]);
  }
  // The objective comes from the owner-approved plan unless the caller supplied a real one. A
  // placeholder is refused outright — a governed record must never say `<objective>`.
  const objective = resolveObjective(str(flags, 'objective'), auth.planPhase.description);
  if (!objective.ok) return fail(2, [`REFUSED (NO_OBJECTIVE): phase '${id}' — ${objective.reason}`]);
  const p = createPhase({
    phaseId: id,
    project: str(flags, 'project', 'ProjectOS'),
    objective: objective.objective,
  });
  savePhase(sys, root, p);
  return ok([`Created phase ${id} (status: ${p.status})`, `  objective: ${p.objective}`]);
}

/**
 * Repair a phase record that already carries a placeholder objective.
 *
 * Deliberately the narrowest possible correction: it refuses unless the STORED objective is a
 * placeholder, it takes the replacement only from the active approved plan, and it changes nothing
 * else — not the status, not the history. `phase new --force` would also overwrite the record, but it
 * resets the lifecycle to `draft` and discards the transition history, which is a governance record,
 * not scratch. Correcting a durable record is a bounded governance action and is written as one.
 */
function phaseReconcileObjective(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase reconcile-objective` requires --id <PHASE-ID>']);

  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const auth = authorisePhase(sys, root, gc.context, id);
  if (!auth.ok) return fail(2, authorisationRefusalLines(auth));

  const current = loadPhase(sys, root, id);
  if (current === null) return fail(1, [`No phase ${id}`]);
  if (!isPlaceholderObjective(current.objective)) {
    return fail(2, [
      `REFUSED (OBJECTIVE_NOT_PLACEHOLDER): phase '${id}' already records a real objective; ` +
        'this command repairs placeholders only and will not overwrite one.',
    ]);
  }
  const resolved = resolveObjective('', auth.planPhase.description);
  if (!resolved.ok) return fail(2, [`REFUSED (NO_OBJECTIVE): phase '${id}' — ${resolved.reason}`]);

  savePhase(sys, root, { ...current, objective: resolved.objective });
  return ok([
    `Reconciled objective for ${id} from the active approved plan.`,
    `  objective: ${resolved.objective}`,
    `  status and history unchanged (${current.status}, ${current.history.length} transition(s))`,
  ]);
}

/** The role the transition is actually performed as: `--delegated` closes as the advisor. */
function effectiveRoleFor(flags: Flags, role: Role, to: PhaseStatus): Role {
  const delegated = flags['delegated'] === true || str(flags, 'delegated') === 'true';
  return delegated && requiresOwner(to) ? 'advisor' : role;
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

  // Closure authority. Closure stays owner-only unless the ACTIVE APPROVED PLAN records a
  // delegation that covers this exact project, delegate and scope. The decision is made by the core
  // authority module — this command never decides it — and the resulting grant is the only way a
  // non-owner reaches a terminal state.
  let grant: ClosureGrant | undefined;
  let basisNote: string | undefined;
  if (requiresOwner(to)) {
    const plan = gc.context.plan;
    const delegation = delegationOf(plan);
    // DELEGATED CLOSURE: the caller asks for closure under the plan's delegation but does NOT name
    // the delegate. The runtime resolves who that is from the ACTIVE APPROVED PLAN, so an untrusted
    // caller — the Control Centre renderer above all — can request closure without being able to
    // nominate or authenticate the authority that grants it. Naming the delegate was the last place
    // a caller could supply the string that confers the power.
    const delegated = flags['delegated'] === true || str(flags, 'delegated') === 'true';
    const effectiveRole: Role = delegated ? 'advisor' : role;
    const effectiveIdentity = delegated
      ? (delegation === null ? null : delegation.delegatedTo)
      : str(flags, 'identity') === ''
        ? null
        : str(flags, 'identity');
    // The G4 gate. A delegation names who MAY close; this proves the conditions actually hold.
    // Facts are DERIVED here, never taken from the request — see closureGate.ts.
    const callerAssertedAuthority =
      str(flags, 'identity') !== '' || (delegated && str(flags, 'as') !== '' && str(flags, 'as') !== 'implementer');
    const g4 = delegated
      ? evaluateG4(
          sys,
          root,
          gc.context,
          id,
          current.status,
          { ready: true, reasons: [] },
          delegation !== null,
          callerAssertedAuthority,
        )
      : null;

    const decision = authoriseClosure({
      governedProjectId: gc.context.projectId,
      planProjectId: typeof plan['projectId'] === 'string' ? plan['projectId'] : '',
      owner: gov(plan, 'owner'),
      implementer: gov(plan, 'implementer'),
      closureAuthority: gov(plan, 'closureAuthority'),
      delegation,
      actorRole: effectiveRole,
      actorIdentity: effectiveIdentity,
      scope: 'phase-closure',
      phaseId: id,
      ...(g4 === null ? {} : { eligibility: g4.verdict }),
    });
    if (!decision.ok) {
      // A G4 failure is reported predicate by predicate: an operator must see everything still
      // outstanding, not just the first thing that failed.
      if (g4 !== null && !g4.verdict.eligible) return fail(2, g4RefusalLines(g4.verdict));
      return fail(2, [`REFUSED (${decision.error})`]);
    }
    grant = decision.value;
    basisNote = grantNote(decision.value);
  }

  const note = str(flags, 'note');
  // The recorded note carries the authority basis, so the durable history says HOW closure was
  // authorised — not merely that some role performed it.
  const finalNote =
    basisNote === undefined ? (note === '' ? undefined : note) : note === '' ? basisNote : `${note} — ${basisNote}`;
  const r = transitionPhase(current, to, effectiveRoleFor(flags, role, to), ctx.sys.now(), finalNote, grant);
  if (!r.ok) {
    // Owner-gated refusal is a governance block (exit 2); other illegal moves are 1.
    const code = r.error.includes("requires role 'owner'") ? 2 : 1;
    return fail(code, [r.error]);
  }
  savePhase(sys, root, r.value);
  const how = basisNote === undefined ? '' : ` [${basisNote}]`;
  const actedAs = effectiveRoleFor(flags, role, to);
  return ok([`${id}: ${current.status} -> ${r.value.status} (by ${actedAs})${how}`]);
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

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
  canTransition,
  createPhase,
  isTerminal,
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
import { syncCurrentState, type SyncResult } from '../currentStateStore.js';
import {
  evaluateG4,
  g4RefusalLines,
  closureDecisionProblems,
  closureDecisionRelPath,
  readDecisionId,
  markDecisionConsumed,
} from '../closureGate.js';
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
    case 'closure-eligibility':
      return phaseClosureEligibility(ctx, flags);
    case 'sync-state':
      return phaseSyncState(ctx);
    default:
      return fail(1, [
        `Unknown 'phase' subcommand: ${sub}`,
        'Use: phase new|advance|show|list|reconcile-objective|closure-eligibility|sync-state',
      ]);
  }
}

/**
 * STEP A — READ-ONLY eligibility. Answers "are the conditions for a closure decision satisfied?" and
 * transitions nothing.
 *
 * This exists so that asking the question is no longer entangled with performing the act. Before it,
 * the only way to find out whether G4 passed was to attempt the closure — and attempting it was
 * enough to do it. Anyone may run this; it writes nothing, so there is nothing to protect.
 *
 * It deliberately reports the DECISION state too, because "eligible" alone is the answer that misled
 * a reader into thinking closure was authorised.
 */
function phaseClosureEligibility(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`phase closure-eligibility` requires --id <PHASE-ID>']);

  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const current = loadPhase(sys, root, id);
  if (current === null) return fail(1, [`No phase ${id}`]);

  const delegation = delegationOf(gc.context.plan);
  const g4 = evaluateG4(sys, root, gc.context, id, current.status, { ready: true, reasons: [] }, delegation !== null, false);
  // Report under the basis this project actually uses: a delegation if the plan records one, the
  // owner otherwise. Always asking about the delegate told an owner-only project its own valid
  // decision was "not the recorded authority".
  const decisionProblems = closureDecisionProblems(sys, root, gc.context, id, current.history, delegation === null ? 'owner' : 'delegated');

  const lines = [`closure eligibility for ${id} (status: ${current.status})`];
  if (g4.verdict.eligible) {
    lines.push(`  G4_ELIGIBLE — all ${g4.verdict.satisfied.length} predicates satisfied`);
  } else {
    lines.push(`  G4_NOT_SATISFIED — ${g4.verdict.unmet.length} predicate(s) unmet:`);
    for (const u of g4.verdict.unmet) lines.push(`    ${u.code}: ${u.detail}`);
  }
  // An owner-accepted HIGH must never read as a clean phase. G4-10 being satisfied says only that a
  // recorded owner decision stopped it BLOCKING; the finding is still HIGH, still unresolved and
  // still carried. Printing nothing here would make "accepted" and "absent" look identical.
  if (g4.facts.ownerAcceptedHighIds.length > 0) {
    lines.push(
      `  RESIDUAL HIGH, OWNER-ACCEPTED — unresolved and carried forward, NOT fixed: ` +
        g4.facts.ownerAcceptedHighIds.join(', '),
    );
  }
  if (decisionProblems.length === 0) {
    lines.push('  GATEKEEPER DECISION: present, bound to this phase and subject, and committed');
  } else {
    lines.push('  GATEKEEPER DECISION: NOT USABLE');
    for (const p of decisionProblems) lines.push(`    ${p}`);
  }
  lines.push(
    g4.verdict.eligible && decisionProblems.length === 0
      ? '  => the trusted finalisation path may close this phase'
      : '  => this phase MUST NOT be closed. Eligibility is not a decision, and this command decides nothing.',
  );
  // Always exit 0: this is a question, and "not eligible" is a legitimate answer to it, not a failure.
  return ok(lines);
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
  const existing = loadPhase(sys, root, id);
  if (existing !== null && flags['force'] !== true) {
    return fail(2, [`Phase ${id} already exists (pass --force to recreate)`]);
  }
  // `--force` MUST NOT resurrect a finished phase. It rewrites the record to `draft` with an empty
  // history, which erased the closure and let the same gatekeeper decision close the phase a second
  // time. Recreating a draft is a convenience; un-closing a governed phase is not, and it is not
  // something an ungated, roleless command should be able to do.
  if (existing !== null && isTerminal(existing.status)) {
    return fail(2, [
      `REFUSED (PHASE_IS_TERMINAL): ${id} is '${existing.status}'. --force recreates a phase from scratch, which would ` +
        'erase a recorded closure and allow its decision to be replayed. A closed phase is not re-openable here.',
    ]);
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
  // The durable memory must not contradict the record we just wrote. See currentStateStore.
  const sync = syncCurrentState(sys, root, gc.context, 'implementer');
  return ok([
    `Created phase ${id} (status: ${p.status})`,
    `  objective: ${p.objective}`,
    ...syncLines(sync),
  ]);
}

/**
 * Reconcile the declared current-state with the phase records, without moving any phase.
 *
 * The repair path for drift that already exists. Every transition now syncs, but a record written
 * before that — or by a run that died between the two writes — leaves a disagreement that no legal
 * transition can clear, because the phase is already where it should be. Refusing to offer a repair
 * would mean the only fix was editing a governed record by hand, which is the thing this programme
 * is trying to stop.
 *
 * It grants nothing: every field is recomputed from the core phase records and the approved plan, a
 * phase counts as complete only on a genuine owner-or-delegate closure, and no caller input is read.
 */
function phaseSyncState(ctx: CommandContext): CommandResult {
  const { sys, root } = ctx;
  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const sync = syncCurrentState(sys, root, gc.context, 'implementer');
  if (!sync.synced) return fail(2, [`REFUSED: the current state was not updated — ${sync.reason ?? 'unknown reason'}`]);
  return ok([
    'Current state reconciled from the canonical phase records.',
    `  active phase:  ${sync.activePhase ?? 'none'}`,
    `  complete:      ${sync.completed}/${sync.total}`,
    '',
    'Nothing was granted: completion is only ever read from a genuine owner-or-delegate closure.',
  ]);
}

/** One line about the durable state, always — silence about it is how it drifted in the first place. */
function syncLines(sync: SyncResult): readonly string[] {
  return sync.synced
    ? [`  state:     active=${sync.activePhase ?? 'none'}, ${sync.completed}/${sync.total} complete`]
    : [`  state:     NOT UPDATED — ${sync.reason ?? 'unknown reason'}`];
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

  // LEGALITY BEFORE AUTHORITY. A transition that could never happen is reported as illegal, not as a
  // missing decision: telling an operator to obtain the gatekeeper's decision for a `draft -> closed`
  // move would send them to fetch an authority that would not help.
  if (!canTransition(current.status, to)) {
    return fail(1, [`Illegal transition: ${current.status} -> ${to}`]);
  }

  // Closure authority. Closure stays owner-only unless the ACTIVE APPROVED PLAN records a
  // delegation that covers this exact project, delegate and scope. The decision is made by the core
  // authority module — this command never decides it — and the resulting grant is the only way a
  // non-owner reaches a terminal state.
  let grant: ClosureGrant | undefined;
  let basisNote: string | undefined;
  let consumedDecisionId: string | undefined;
  /** Set when this closure relied on an owner-accepted residual HIGH, so the durable note can say so. */
  let residualNote = '';
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
    // ANY caller-stated role or identity alongside `--delegated` is an assertion of authority.
    //
    // The earlier form excluded `--as implementer`, on the reasoning that naming yourself the
    // implementer asserts nothing. But `--delegated` overrides the role to advisor, so
    // `--delegated --as implementer` laundered an implementer invocation into a delegated close and
    // slipped past G4-15 precisely because of that exclusion. The caller has no business stating a
    // role here at all: under a delegation the runtime resolves it from the plan.
    const callerAssertedAuthority = str(flags, 'identity') !== '' || (delegated && str(flags, 'as') !== '');
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

    // THE DECISION, established rather than assumed.
    //
    // `--delegated` used to be both the request AND, implicitly, the gatekeeper's decision: the
    // runtime resolved the delegate's identity from the plan and then acted as though that delegate
    // had spoken. It had not. An implementer typing this flag closed Phase 18 with every G4 predicate
    // satisfied, which is exactly the point — eligibility was never the missing thing.
    // Required for BOTH bases. `--as owner` is just as much a caller-supplied string as
    // `--delegated`, and gating only the delegated path would have left the wider hole open.
    const decisionProblems = closureDecisionProblems(
      sys,
      root,
      gc.context,
      id,
      current.history,
      delegated ? 'delegated' : 'owner',
    );
    const decisionId = readDecisionId(sys, root, id);

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
      decisionProblems,
      ...(decisionId === undefined ? {} : { decisionId }),
    });
    if (!decision.ok) {
      // A G4 failure is reported predicate by predicate: an operator must see everything still
      // outstanding, not just the first thing that failed.
      if (g4 !== null && !g4.verdict.eligible) return fail(2, g4RefusalLines(g4.verdict));
      // The eligible-but-undecided case is the common one and deserves its own answer, because it is
      // not a fault: the work is ready and the authority has simply not spoken yet.
      if (g4 !== null && g4.verdict.eligible && decisionProblems.length > 0) {
        return fail(2, [
          `REFUSED (ELIGIBLE_AWAITING_GATEKEEPER): all ${g4.verdict.satisfied.length} G4 predicates are satisfied, ` +
            'but eligibility is not a decision and this caller cannot make one on the gatekeeper\'s behalf.',
          ...decisionProblems.map((p) => `  ${p}`),
          `  Record the decision at ${closureDecisionRelPath(id)} and commit it.`,
        ]);
      }
      return fail(2, [`REFUSED (${decision.error})`]);
    }
    grant = decision.value;
    basisNote = grantNote(decision.value);
    consumedDecisionId = decisionId;
    if (g4 !== null && g4.facts.ownerAcceptedHighIds.length > 0) {
      residualNote = `owner-accepted residual HIGH, unresolved and carried forward: ${g4.facts.ownerAcceptedHighIds.join(', ')}`;
    }
  }

  const note = str(flags, 'note');
  // A closure that carried an owner-accepted residual HIGH must SAY SO in the durable history. The
  // dry-run command printed it, but that output is disposable; without this the permanent record of
  // such a closure read exactly like a clean, zero-findings one, and an auditor would have to know
  // to go and open the decision file to discover otherwise. It goes BEFORE the basis note so the
  // decision id stays last, where `consumedDecisionIds` reads it. Found by ECC review.
  const noteParts = [note, residualNote].filter((s) => s !== '');
  const callerNote = noteParts.join(' — ');
  // The recorded note carries the authority basis LAST, so the durable history says HOW closure was
  // authorised — and so the decision id can be read back from a fixed position. When the caller's
  // text came last, `--note "decision 00000000"` made the replay check read a decoy.
  const finalNote =
    basisNote === undefined
      ? callerNote === ''
        ? undefined
        : callerNote
      : callerNote === ''
        ? basisNote
        : `${callerNote} — ${basisNote}`;
  const r = transitionPhase(current, to, effectiveRoleFor(flags, role, to), ctx.sys.now(), finalNote, grant);
  if (!r.ok) {
    // Owner-gated refusal is a governance block (exit 2); other illegal moves are 1.
    const code = r.error.includes("requires role 'owner'") ? 2 : 1;
    return fail(code, [r.error]);
  }
  savePhase(sys, root, r.value);
  // Spend the decision, in the decision. A phase record can be reset; this cannot be reset with it.
  if (consumedDecisionId !== undefined) markDecisionConsumed(sys, root, id, ctx.sys.now());
  const how = basisNote === undefined ? '' : ` [${basisNote}]`;
  const actedAs = effectiveRoleFor(flags, role, to);
  const sync = syncCurrentState(sys, root, gc.context, actedAs);
  return ok([`${id}: ${current.status} -> ${r.value.status} (by ${actedAs})${how}`, ...syncLines(sync)]);
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

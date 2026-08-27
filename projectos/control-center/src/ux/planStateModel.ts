/**
 * PLANS, AS THE OWNER SEES THEM — and the explicit mapping that gets them there.
 *
 * THE PROBLEM THIS SOLVES. The engine has two different things the product calls "a plan": the
 * ACTIVE plan record (`GovernedPlanView` plus its phases and the programme's counts) and the plan
 * PROPOSALS (`GovernedPlanDraftView`, each with a decision state). It also has eleven phase
 * statuses. The accepted architecture shows four groups and a handful of owner words, so something
 * has to do the collapsing — and if that something is scattered across a renderer, the owner state
 * and the offered action can disagree.
 *
 * So the mapping lives here, once, in the open, with a test per row.
 *
 * TWO RULES IT ENFORCES.
 *
 * 1. NO ACTION WITHOUT A GOVERNED PATH. Every action carries the verb that will run it. Where no
 *    verb exists the action is simply not produced — the renderer cannot invent one, because there
 *    is nothing in the shape for it to invent.
 *
 * 2. NO PERCENTAGE WITHOUT A DENOMINATOR. Progress is reported only for the active plan, where the
 *    programme supplies a real phase count. A proposal has no phases, so it has no progress, and
 *    the field is absent rather than zero.
 *
 * Pure: same projection in, same rows out. No clock beyond what is passed, no I/O.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { GovernedProjection, GovernedPlanDraftView } from '../governed/types';

/** What the owner is told. Deliberately few words, each of which means one thing. */
export type OwnerPlanState =
  | 'Working'
  | 'Ready to continue'
  | 'Needs your decision'
  | 'Approved — not started'
  | 'Rejected'
  | 'Blocked'
  | 'Completed';

/** The four groups the accepted architecture shows. */
export type OwnerPlanGroup = 'active' | 'draft' | 'blocked' | 'completed';

/**
 * An action the owner may take, and the governed verb that will carry it.
 *
 * `verb` is null ONLY for navigation — opening a plan or looking at evidence changes nothing and
 * asks the runtime for nothing. Every action that acts names its verb.
 */
export interface PlanAction {
  readonly id: 'open' | 'approve' | 'reject' | 'activate' | 'stop' | 'start' | 'resume' | 'evidence';
  readonly label: string;
  readonly verb: 'plan.decide' | 'plan.activate' | 'run.start' | 'run.stop' | 'run.resume' | null;
  /**
   * THE ARGUMENTS THE VERB REQUIRES, resolved here from real records.
   *
   * `run.resume` REQUIRES a session id and the channel refuses without one, so an action that
   * offered Resume without naming a session would be refused before it reached the runtime — a
   * button that cannot work. The owner never types an identifier; the model supplies it or the
   * action is not produced.
   */
  readonly args: Readonly<Record<string, string>>;
  /** False when the engine would refuse it right now. The reason is always given with it. */
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export interface PlanRow {
  /** Stable key. The draft id for a proposal; the plan id for the active plan. */
  readonly id: string;
  readonly kind: 'active' | 'draft';
  readonly name: string;
  /** Where this proposal came from. Absent for the active plan. */
  readonly origin?: 'import' | 'authored';
  readonly state: OwnerPlanState;
  readonly group: OwnerPlanGroup;
  /** "Step 2 of 6 — Existing system". Null when nothing is in play, or for a proposal. */
  readonly stepLabel: string | null;
  /** Real counts from the programme, or null. Never a percentage without a denominator. */
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly needsOwnerDecision: boolean;
  /** Why it is blocked, in the engine's own words. Empty when it is not. */
  readonly reasons: readonly string[];
  /** ISO timestamp of the most recent meaningful thing, or null when nothing is recorded. */
  readonly lastActivity: string | null;
  readonly actions: readonly PlanAction[];
  /** Only ever set for an approved proposal — `plan.activate` needs both identifiers. */
  readonly decisionId: string | null;
}

export interface PlansModel {
  readonly rows: readonly PlanRow[];
  /** True when the project genuinely has neither an active plan nor any proposal. */
  readonly empty: boolean;
}

const OPEN: PlanAction = { id: 'open', label: 'Open', verb: null, enabled: true, disabledReason: null, args: {} };

/**
 * Whether spending is stopped. A run control is offered only when the runtime would actually accept
 * it, and a reached hard limit is the one refusal the owner most needs stated before they press.
 */
function budgetStopped(state: GovernedProjection): boolean {
  return state.gatekeeperStatus.budget?.status === 'STOPPED';
}

/** The session that means work is genuinely in flight for the phase in play. */
function liveSession(state: GovernedProjection): boolean {
  const phaseId = state.activePhase?.phaseId ?? null;
  if (phaseId === null) return false;
  return state.sessions.some((s) => s.phaseId === phaseId && s.state !== 'exited');
}

/** The most recent session recorded for the phase in play, which is the one a resume would rejoin. */
function resumableSessionId(state: GovernedProjection): string | null {
  const phaseId = state.activePhase?.phaseId ?? null;
  if (phaseId === null) return null;
  let best: { id: string; at: string } | null = null;
  for (const s of state.sessions) {
    if (s.phaseId !== phaseId) continue;
    if (best === null || s.startedAt > best.at) best = { id: s.sessionId, at: s.startedAt };
  }
  return best === null ? null : best.id;
}

function stepLabelOf(state: GovernedProjection): string | null {
  const phase = state.activePhase ?? state.nextStartablePhase;
  if (phase === null) return null;
  const index = state.phases.findIndex((p) => p.phaseId === phase.phaseId);
  const total = state.phases.length;
  const description = phase.description.trim();
  const position = index >= 0 && total > 0 ? `Step ${index + 1} of ${total}` : 'Step';
  return description === '' ? position : `${position} — ${description}`;
}

/** The most recent session start on record, which is the only activity timestamp a plan carries. */
function lastActivityOf(state: GovernedProjection): string | null {
  let latest: string | null = null;
  for (const s of state.sessions) {
    if (latest === null || s.startedAt > latest) latest = s.startedAt;
  }
  return latest;
}

/**
 * The ACTIVE plan's owner state.
 *
 * ORDER IS THE MAPPING. Completed first, because a finished programme is finished whatever else is
 * true of it; then blocked, because a plan that cannot run must never be shown a run control; then
 * whether work is actually in flight. "Working" requires a live session, not a phase status: a
 * phase recorded `implementing` with nothing running is work waiting to continue, not work
 * happening, and telling the owner otherwise would make the word meaningless.
 */
function activeState(state: GovernedProjection): { state: OwnerPlanState; group: OwnerPlanGroup; reasons: readonly string[] } {
  const total = state.programme.totalPhaseCount;
  const done = state.programme.acceptedPhaseCount;
  if (total > 0 && done === total) return { state: 'Completed', group: 'completed', reasons: [] };

  const reasons = [...state.plan.unmetReasons, ...state.blockers];
  if (!state.plan.ready || state.blockers.length > 0) {
    return { state: 'Blocked', group: 'blocked', reasons };
  }
  if (liveSession(state)) return { state: 'Working', group: 'active', reasons: [] };
  return { state: 'Ready to continue', group: 'active', reasons: [] };
}

/** Run controls for the active plan, offered only where the engine has a path and would accept. */
function activeActions(state: GovernedProjection, owner: OwnerPlanState): readonly PlanAction[] {
  if (owner === 'Completed') {
    return [OPEN, { id: 'evidence', label: 'View evidence', verb: null, enabled: true, disabledReason: null, args: {} }];
  }
  if (owner === 'Blocked') {
    // Deliberately no run control. The reasons are shown instead; a disabled Run beside them would
    // only invite the owner to press something the engine has already refused.
    return [OPEN];
  }
  const phaseId = state.activePhase?.phaseId ?? null;
  const stopped = budgetStopped(state);
  const reason = stopped ? 'The monthly spending limit has been reached.' : null;

  if (owner === 'Working') {
    return [
      OPEN,
      {
        /*
         * STOP, NOT PAUSE — and the word matters.
         *
         * `run.stop` does not suspend anything. The sidecar force-kills the whole process tree
         * (`taskkill /pid <pid> /t /f`) and answers "the governed run will end shortly"; there is no
         * pause or suspend verb anywhere in the channel. Calling it Pause would promise the owner
         * that work is held and will carry on where it left off, which is not what happens.
         *
         * Work is not lost — the loop's records are on disk, and a session that has ended can be
         * rejoined with `run.resume`. But that is resuming a stopped run, not unpausing a held one.
         */
        id: 'stop',
        label: 'Stop',
        verb: 'run.stop',
        enabled: true,
        disabledReason: null,
        args: phaseId === null ? {} : { phaseId },
      },
    ];
  }

  // Resume needs a session to rejoin. Where there is none, continuing is a fresh start.
  const sessionId = resumableSessionId(state);
  if (sessionId !== null) {
    return [
      OPEN,
      {
        id: 'resume',
        label: 'Resume',
        verb: 'run.resume',
        enabled: !stopped,
        disabledReason: reason,
        args: phaseId === null ? { sessionId } : { phaseId, sessionId },
      },
    ];
  }
  return [
    OPEN,
    {
      id: 'start',
      label: 'Start',
      verb: 'run.start',
      enabled: !stopped,
      disabledReason: reason,
      args: phaseId === null ? {} : { phaseId },
    },
  ];
}

/**
 * A proposal's owner state and actions.
 *
 * `consumed` is deliberately absent from the groups below: a consumed decision is one that has
 * already become the active plan, so showing it again as a proposal would put the same plan on the
 * screen twice under two different names.
 */
function draftRow(d: GovernedPlanDraftView): PlanRow | null {
  const base = {
    id: d.draftId,
    kind: 'draft' as const,
    name: d.origin === 'authored' ? 'Proposed plan' : 'Imported plan',
    origin: d.origin,
    stepLabel: null,
    progress: null,
    reasons: [] as readonly string[],
    lastActivity: d.generatedAt === '' ? null : d.generatedAt,
    decisionId: d.decisionId,
  };

  switch (d.decisionState) {
    case 'none':
      return {
        ...base,
        state: 'Needs your decision',
        group: 'draft',
        needsOwnerDecision: true,
        actions: [
          OPEN,
          { id: 'approve', label: 'Approve', verb: 'plan.decide', enabled: true, disabledReason: null, args: { draftId: d.draftId, decision: 'approve' } },
          { id: 'reject', label: 'Reject', verb: 'plan.decide', enabled: true, disabledReason: null, args: { draftId: d.draftId, decision: 'reject' } },
        ],
      };
    case 'approved':
      return {
        ...base,
        state: 'Approved — not started',
        group: 'draft',
        needsOwnerDecision: false,
        actions:
          d.decisionId === null
            ? // Approved, but the decision that approved it cannot be named — so `plan.activate`,
              // which requires both identifiers, has nothing to be given. Say so rather than offer it.
              [
                OPEN,
                {
                  id: 'activate',
                  label: 'Start this plan',
                  verb: 'plan.activate',
                  enabled: false,
                  disabledReason: 'ProjectOS cannot find the decision that approved this plan.',
                  args: {},
                } as PlanAction,
              ]
            : [
                OPEN,
                {
                  id: 'activate',
                  label: 'Start this plan',
                  verb: 'plan.activate',
                  enabled: true,
                  disabledReason: null,
                  args: { draftId: d.draftId, decisionId: d.decisionId },
                },
              ],
      };
    case 'refused':
      return {
        ...base,
        state: 'Rejected',
        group: 'blocked',
        needsOwnerDecision: false,
        // NO RE-APPROVAL. A rejected proposal is answered; offering Approve here would let the same
        // material be approved after the fact without a new proposal ever being made.
        actions: [OPEN],
      };
    case 'consumed':
      return null;
    default:
      return null;
  }
}

export function buildPlansModel(state: GovernedProjection): PlansModel {
  const rows: PlanRow[] = [];

  const version = state.plan.planVersion.trim();
  if (version !== '') {
    const { state: owner, group, reasons } = activeState(state);
    rows.push({
      id: state.plan.planId === '' ? version : state.plan.planId,
      kind: 'active',
      name: `Plan ${version}`,
      state: owner,
      group,
      stepLabel: stepLabelOf(state),
      progress:
        state.programme.totalPhaseCount > 0
          ? { done: state.programme.acceptedPhaseCount, total: state.programme.totalPhaseCount }
          : null,
      needsOwnerDecision: state.pendingApprovals.length > 0,
      reasons,
      lastActivity: lastActivityOf(state),
      actions: activeActions(state, owner),
      decisionId: null,
    });
  }

  for (const d of state.planDrafts) {
    const row = draftRow(d);
    if (row !== null) rows.push(row);
  }

  return { rows, empty: rows.length === 0 };
}

/** The groups, in the order the accepted architecture lists them. */
export const PLAN_GROUPS: ReadonlyArray<{ id: OwnerPlanGroup; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Proposals' },
  { id: 'blocked', label: 'Blocked and rejected' },
  { id: 'completed', label: 'Completed' },
];

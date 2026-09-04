/**
 * "Continue Working" — deciding, from state alone, what the one obvious next action is.
 *
 * THE OWNER SHOULD NEVER BE ASKED FOR A PHASE ID, A RUN ID, A SESSION ID, A COMMIT OR A BRANCH.
 * ProjectOS already knows all of them. What it was not doing was making a decision on the owner's
 * behalf: the surfaces presented every capability at once and left the choice of which one applies
 * as an exercise. This file makes that choice, from the governed projection and nothing else.
 *
 * ORDER MATTERS, AND IT IS NOT ARBITRARY. Something waiting on the owner outranks everything, because
 * offering "Continue" while a decision is pending would invite an action the runtime is going to
 * refuse. A blocker outranks resuming, because resuming into a blocked phase wastes a real worker
 * run. Only then does resuming a stopped session outrank starting a new one — a session that stopped
 * is work already paid for.
 *
 * Pure: same projection in, same answer out. No clock, no I/O.
 *
 * Created in PROJECTOS-SIMPLE-PROJECT-WIZARD1A §15-16.
 */
import type { GovernedProjection, GovernedSessionView } from '../governed/types';

/** The single headline word for the project. */
/**
 * `Interrupted` is work that STARTED and is not running now - a distinct thing from `Working`, which
 * is a claim about the present tense and needs a live process behind it.
 */
export type ProjectStatus = 'Waiting for you' | 'Blocked' | 'Working' | 'Interrupted' | 'Ready';

export interface PrimaryAction {
  /** What pressing it does. */
  readonly kind: 'review' | 'resume' | 'continue' | 'start' | 'working';
  /** Where a `review` goes. `plans` when the thing to review is a proposal. Absent means the Overview itself. */
  readonly target?: 'plans';
  /** The button. Never a verb the owner has to interpret. */
  readonly label: string;
  /** The line above it. */
  readonly heading: string;
  /** One plain sentence about what this is. */
  readonly detail: string;
  /** Present only for `resume` — the runtime supplies it, the owner never types it. */
  readonly sessionId: string | null;
}

export interface ContinueWorkingModel {
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly primary: PrimaryAction;
  /** Shown under "Start something new". Always available; never the primary when work exists. */
  readonly canStartSomethingNew: boolean;
  /** Advanced only. The normal view never needs these. */
  readonly phaseId: string | null;
  readonly sessionId: string | null;
}

/**
 * The session worth offering, if any.
 *
 * A session belonging to the phase actually in play, most recent first. `exited` is not required
 * and is deliberately not checked: an earlier version filtered on it, and no real session ever
 * wrote that state, so the offer never appeared once in practice.
 */
export function resumableSession(
  sessions: readonly GovernedSessionView[],
  phaseId: string | null,
): GovernedSessionView | null {
  if (phaseId === null) return null;
  const mine = sessions.filter((s) => s.phaseId === phaseId);
  if (mine.length === 0) return null;
  const sorted = [...mine].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return sorted[0] ?? null;
}

/** When did this last happen, said the way a person would say it. */
function whenPhrase(startedAt: string, now: number): string {
  const then = Date.parse(startedAt);
  if (Number.isNaN(then)) return 'earlier';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Decide the one thing to offer.
 *
 * `now` is passed in rather than read from a clock so this stays pure and testable.
 */
export function buildContinueWorking(
  state: GovernedProjection,
  ownerActions: readonly { readonly title: string; readonly severity: string }[],
  now: number,
  /**
   * WHETHER A RUN IS ACTUALLY ALIVE — from the process the sidecar spawned and tracks, never from a
   * record. Without it this model said "Working" over a session record whose process had died hours
   * earlier, and offered to continue work that was not happening. Absent means "not known to be
   * running", which is the honest default: an interrupted run reads as interrupted.
   */
  liveRun?: { readonly active: boolean } | null,
): ContinueWorkingModel {
  const phaseId = state.activePhase?.phaseId ?? state.nextStartablePhase?.phaseId ?? null;
  const session = resumableSession(state.sessions, phaseId);

  // 1. Something is waiting on the owner. Nothing else may be offered as the primary action.
  const blocking = ownerActions.filter((a) => a.severity === 'blocking');
  if (blocking.length > 0) {
    return {
      projectName: state.projectName,
      status: 'Waiting for you',
      primary: {
        kind: 'review',
        label: 'Review',
        heading: 'Action needed',
        detail: blocking[0]?.title ?? 'ProjectOS needs a decision from you before it can continue.',
        sessionId: null,
      },
      canStartSomethingNew: false,
      phaseId,
      sessionId: session?.sessionId ?? null,
    };
  }

  // 2. Blocked. Offering work that cannot run is worse than saying so.
  if (state.blockers.length > 0) {
    return {
      projectName: state.projectName,
      status: 'Blocked',
      primary: {
        kind: 'review',
        label: 'See what is blocking it',
        heading: 'Blocked',
        detail: state.blockers[0] ?? 'Something is stopping this project from continuing.',
        sessionId: null,
      },
      canStartSomethingNew: false,
      phaseId,
      sessionId: session?.sessionId ?? null,
    };
  }

  // 2b. A PROPOSAL IS WAITING FOR THE OWNER and nothing is in play. Offering "Start something new"
  //     here sent the owner to write a second objective while the first sat undecided on another tab.
  const undecided = (state.planDrafts ?? []).filter((d) => d.decisionState === 'none');
  if (phaseId === null && session === null && undecided.length > 0) {
    const first = undecided[0]!;
    return {
      projectName: state.projectName,
      status: 'Waiting for you',
      primary: {
        kind: 'review',
        label: 'Review the proposal',
        heading: undecided.length === 1 ? 'A plan is waiting for your decision' : `${undecided.length} plans are waiting for your decision`,
        detail: first.summary ?? 'ProjectOS has proposed a plan. Read it, then approve and start it, or reject it.',
        sessionId: null,
        target: 'plans',
      },
      canStartSomethingNew: true,
      phaseId: null,
      sessionId: null,
    };
  }

  // 2c. A RUN IS ALIVE RIGHT NOW. The screen shows what it is doing; there is nothing to press, and
  //     offering "Continue" here would ask the runtime to start a second run of the same plan.
  if (liveRun?.active === true) {
    return {
      projectName: state.projectName,
      status: 'Working',
      primary: {
        kind: 'working',
        label: 'Working',
        heading: 'ProjectOS is working',
        detail: 'It will stop and ask you if your authority is needed.',
        sessionId: session?.sessionId ?? null,
      },
      canStartSomethingNew: false,
      phaseId,
      sessionId: session?.sessionId ?? null,
    };
  }

  // 2d. THE PHASE IS FINISHED AND WAITING ON THE OWNER.
  //
  //     Until the loop started writing phase records, this state could not occur: a completed phase
  //     left no lifecycle trace at all, so the only thing below to describe it was branch 3 -- "work
  //     stopped before it finished", offering "Continue". Both halves were untrue. The work did
  //     finish; it was reviewed, committed and pushed; and continuing is precisely what the runtime
  //     refuses, because `awaiting_closure` is a state only the owner may move a phase out of.
  //
  //     `awaiting_review` is deliberately NOT here. The loop may carry that one forward on its own,
  //     so "Continue" is the right offer there; `awaiting_closure` is the only one that is the
  //     owner's alone.
  if (state.activePhase?.status === 'awaiting_closure') {
    return {
      projectName: state.projectName,
      status: 'Waiting for you',
      primary: {
        kind: 'review',
        label: 'Review and close',
        heading: 'Finished - waiting for your decision',
        detail:
          `${state.activePhase.description.trim() === '' ? state.activePhase.phaseId : state.activePhase.description} ` +
          'is done and reviewed. Nothing else starts until you close it.',
        sessionId: session?.sessionId ?? null,
      },
      canStartSomethingNew: false,
      phaseId,
      sessionId: session?.sessionId ?? null,
    };
  }

  // 3. Work started earlier and is NOT running now. Resuming it is cheaper than starting again -
  //    but it is interrupted work, and calling that "Working" is the untruth this branch once told.
  if (session !== null && phaseId !== null) {
    return {
      projectName: state.projectName,
      status: 'Interrupted',
      primary: {
        kind: 'resume',
        label: 'Continue',
        heading: 'Work stopped before it finished',
        detail: `Last worked on ${whenPhrase(session.startedAt, now)}. Nothing is running now.`,
        sessionId: session.sessionId,
      },
      canStartSomethingNew: true,
      phaseId,
      sessionId: session.sessionId,
    };
  }

  // 4. A phase is in play but has never run.
  if (phaseId !== null) {
    return {
      projectName: state.projectName,
      status: 'Ready',
      primary: {
        kind: 'continue',
        label: 'Continue',
        heading: 'Ready to continue',
        detail: state.nextSafeAction,
        sessionId: null,
      },
      canStartSomethingNew: true,
      phaseId,
      sessionId: null,
    };
  }

  // 5. Nothing in play. Ask what they want.
  return {
    projectName: state.projectName,
    status: 'Ready',
    primary: {
      kind: 'start',
      label: 'Start',
      heading: 'Start something new',
      detail: 'Tell ProjectOS what you would like it to do.',
      sessionId: null,
    },
    canStartSomethingNew: true,
    phaseId: null,
    sessionId: null,
  };
}

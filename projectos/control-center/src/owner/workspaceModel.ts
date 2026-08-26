/**
 * The workspace view model — every word, colour and number the redesigned surfaces print, derived
 * from the governed projection and from nothing else.
 *
 * WHY THIS FILE EXISTS AT ALL. The approved design carries a demonstration data set: six projects,
 * a five-step plan, a folder that cannot be found, six feed rows, four performance metrics. None of
 * that is real, and none of it is here. What IS here is the translation from canonical ProjectOS
 * state into the design's own vocabulary — a state word, a dot colour, a plain sentence — kept pure
 * so it can be tested without a DOM and so the components stay renderers.
 *
 * WHERE THE RUNTIME HAS NOTHING TO SAY, NEITHER DOES THIS FILE. A project the runtime has not read
 * gets "Not read yet", not a plausible status; a metric with no measurement gets "Unavailable", not
 * a number. The design's layout is preserved in both cases — see the brief §16.
 *
 * Created in PROJECTOS-CONTROL-CENTER-LIKE-FOR-LIKE1A.
 */
import type {
  GovernedConnectionView,
  GovernedPhaseView,
  GovernedProjection,
} from '../governed/types';
import type { ContinueWorkingModel } from './continueWorkingModel';

/** The six states the design colours for. Exactly the prototype's own set. */
export type ProjectState = 'working' | 'waiting' | 'blocked' | 'done' | 'paused' | 'ready';

/** The six state words the plan is allowed to print. No others exist in the approved design. */
export type PlanStateWord = 'Done' | 'Now' | 'Needs your yes' | 'Next' | 'Paused' | 'Blocked';

const DOT: Readonly<Record<ProjectState, string>> = {
  working: 'var(--ok)',
  waiting: 'var(--warn)',
  blocked: 'var(--crit)',
  done: 'var(--acc)',
  paused: 'var(--faint)',
  ready: 'var(--faint)',
};

const CORE_LABEL: Readonly<Record<ProjectState, string>> = {
  working: 'active',
  waiting: 'waiting on you',
  blocked: 'blocked',
  done: 'up to date',
  paused: 'paused',
  ready: 'nothing started',
};

const PLAN_STATE_INK: Readonly<Record<PlanStateWord, string>> = {
  Done: 'var(--faint)',
  Now: 'var(--ok)',
  'Needs your yes': 'var(--warn)',
  Next: 'var(--faint)',
  Paused: 'var(--faint)',
  Blocked: 'var(--crit)',
};

export function dotColour(state: ProjectState): string {
  return DOT[state];
}

/** Paused and idle rows read in `--dim`; everything else takes its own state colour. */
export function statusInk(state: ProjectState): string {
  return state === 'paused' || state === 'ready' ? 'var(--dim)' : DOT[state];
}

export function coreLabel(state: ProjectState): string {
  return CORE_LABEL[state];
}

export function planStateInk(word: PlanStateWord): string {
  return PLAN_STATE_INK[word];
}

/**
 * Two letters for the rail tile.
 *
 * A single-word name gives two letters rather than one, so two projects cannot share a mark.
 */
export function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 /]/g, '').split(/[ /]+/).filter(Boolean);
  if (words.length > 1) {
    return words.slice(0, 2).map((w) => (w[0] ?? '').toUpperCase()).join('');
  }
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/**
 * The project's state, translated from the model's own status word and nothing else.
 *
 * `buildContinueWorking` already decided the priority order — waiting on you, blocked, working,
 * ready — and this only picks the palette key for the word it chose. It deliberately does NOT
 * consult whether a worker process is running: the dot would then say "paused" beside a status line
 * reading "Working", which is the surface contradicting itself about one fact. The model's word is
 * the fact, and it is printed once.
 *
 * `paused` is unreachable from here because the model has no paused outcome; it stays in the palette
 * because the design defines it and a future status word may need it.
 */
export function stateFromStatus(
  status: ContinueWorkingModel['status'],
  _running: boolean,
  complete: boolean,
): ProjectState {
  if (status === 'Waiting for you') return 'waiting';
  if (status === 'Blocked') return 'blocked';
  if (status === 'Working') return 'working';
  return complete ? 'done' : 'ready';
}

/** How long ago, said the way a person would say it. Mirrors `continueWorkingModel`'s phrasing. */
export function relativeTime(at: string, now: number): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return 'earlier';
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A short clock/date stamp for a row, or the relative phrase when the timestamp is unusable. */
export function shortWhen(at: string, now: number): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return '—';
  const sameDay = new Date(then).toDateString() === new Date(now).toDateString();
  const d = new Date(then);
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The plan row's state word.
 *
 * Only the six approved words are reachable. `activePhaseId` decides which in-flight phase reads
 * "Now" — every other in-flight phase is still only "Next".
 */
export function planStateOf(phase: GovernedPhaseView, activePhaseId: string | null): PlanStateWord {
  switch (phase.status) {
    case 'closed':
      return 'Done';
    case 'closed_as_blocked':
      return 'Blocked';
    case 'rolled_back':
      return 'Paused';
    case 'awaiting_review':
    case 'awaiting_closure':
      return 'Needs your yes';
    case 'prompted':
    case 'implementing':
    case 'validating':
    case 'evidence':
      return phase.phaseId === activePhaseId ? 'Now' : 'Next';
    default:
      return 'Next';
  }
}

/**
 * One line under a plan step, said plainly.
 *
 * Derived from the phase record — dependencies it is waiting on, gates it will stop at, whether the
 * programme record says it is complete. Never authored per-step.
 */
export function planNoteOf(phase: GovernedPhaseView): string {
  if (phase.unmetDependencies.length > 0) return 'Waiting on earlier steps';
  if (phase.requiredOwnerGates.length > 0) return 'Asks you first';
  if (phase.closedByRecord) return 'Recorded complete';
  if (phase.requiredBrowserProof) return 'Has to be seen working before it counts';
  return '';
}

/** The plain-language stage a running phase is in. The four the design names, and no others. */
export function stageOf(phase: GovernedPhaseView | null): string {
  switch (phase?.status) {
    case 'implementing':
      return 'Making the changes';
    case 'validating':
      return 'Checking its own work';
    case 'evidence':
    case 'awaiting_review':
    case 'awaiting_closure':
      return 'Writing up what changed';
    default:
      return 'Reading the project';
  }
}

/** One recorded thing that happened, in the shape the Recent work and Work done rows want. */
export interface RecordedItem {
  readonly id: string;
  readonly title: string;
  readonly outcome: string;
  readonly at: string;
  readonly state: ProjectState;
  /** True when the owner is the one who recorded it — the "Your decisions" filter. */
  readonly byOwner: boolean;
  /** True while the step is still waiting on somebody — the "Still waiting" filter. */
  readonly waiting: boolean;
}

const OUTCOME: Readonly<Record<string, { readonly word: string; readonly state: ProjectState }>> = {
  closed: { word: 'Done', state: 'done' },
  closed_as_blocked: { word: 'Blocked', state: 'blocked' },
  rolled_back: { word: 'Rolled back', state: 'paused' },
  awaiting_review: { word: 'Waiting for you', state: 'waiting' },
  awaiting_closure: { word: 'Waiting for you', state: 'waiting' },
  evidence: { word: 'Written up', state: 'working' },
  validating: { word: 'Checked', state: 'working' },
  implementing: { word: 'Started', state: 'working' },
  prompted: { word: 'Prepared', state: 'working' },
  draft: { word: 'Drafted', state: 'ready' },
};

/**
 * Everything ProjectOS has recorded for this project, newest first.
 *
 * The source is each phase's own transition history — the canonical record of what moved, when and
 * by whom. Nothing is summarised or invented; a phase with no history contributes no rows.
 */
export function recordedItems(state: GovernedProjection): readonly RecordedItem[] {
  const rows: RecordedItem[] = [];
  for (const phase of state.phases) {
    phase.history.forEach((t, index) => {
      const outcome = OUTCOME[t.to] ?? { word: t.to, state: 'ready' as ProjectState };
      rows.push({
        id: `${phase.phaseId}:${index}:${t.at}`,
        // The phase DESCRIPTION, never its id — identifiers belong under Advanced.
        title: phase.description || 'Recorded work',
        outcome: t.note !== undefined && t.note !== '' ? `${outcome.word} · ${t.note}` : outcome.word,
        at: t.at,
        state: outcome.state,
        byOwner: t.by === state.authority.owner,
        waiting: t.to === 'awaiting_review' || t.to === 'awaiting_closure',
      });
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * Twenty-four hourly buckets of recorded activity, for the Command-mode activity chart.
 *
 * Real counts of real transitions. An hour in which nothing happened is drawn at zero, which is a
 * fact about the project rather than a shape chosen to look busy.
 */
export function activityByHour(items: readonly RecordedItem[], now: number): readonly number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const item of items) {
    const then = Date.parse(item.at);
    if (Number.isNaN(then)) continue;
    const hoursAgo = Math.floor((now - then) / 3_600_000);
    if (hoursAgo < 0 || hoursAgo > 23) continue;
    buckets[23 - hoursAgo] = (buckets[23 - hoursAgo] ?? 0) + 1;
  }
  return buckets;
}

/**
 * What the Connections row prints in the slot the design gives to a masked value.
 *
 * NOT A MASKED SECRET, BECAUSE THERE IS NO SECRET HERE TO MASK. The projection carries credential
 * METADATA only; `fingerprint` is a salted-domain SHA-256 truncation, not a prefix or suffix of the
 * value. Printing dots followed by four characters of it would tell the owner those characters came
 * from their key, which is false. The fingerprint is labelled as what it is.
 */
export function connectionStandIn(c: GovernedConnectionView): string {
  return c.fingerprint !== null ? `id ${c.fingerprint}` : c.credential;
}

const CONNECTION_STATUS: Readonly<Record<GovernedConnectionView['status'], { label: string; state: ProjectState }>> = {
  STORED: { label: 'Connected', state: 'working' },
  MISSING: { label: 'Not set up', state: 'waiting' },
  EXPIRED: { label: 'Expired', state: 'blocked' },
  UNMANAGED: { label: 'Set up outside ProjectOS', state: 'ready' },
};

export function connectionStatus(c: GovernedConnectionView): { label: string; state: ProjectState } {
  return CONNECTION_STATUS[c.status];
}

/** The four Progress cells, in the approved order. */
export interface ProgressCell {
  readonly k: string;
  readonly v: string;
  readonly sub: string;
}

export function progressCells(
  state: GovernedProjection,
  waitingCount: number,
  recorded: number,
  now: number,
): readonly ProgressCell[] {
  const latest = state.sessions[0];
  return [
    {
      k: 'This task',
      v: `${state.programme.completionPercentage}%`,
      sub:
        state.programme.totalPhaseCount > 0
          ? `Task ${state.programme.acceptedPhaseCount} of ${state.programme.totalPhaseCount}`
          : 'Nothing started yet',
    },
    {
      k: 'Waiting on you',
      v: waitingCount === 0 ? 'Nothing' : waitingCount === 1 ? '1 thing' : `${waitingCount} things`,
      sub: waitingCount === 0 ? 'Work carries on by itself' : 'Answer it and work carries on',
    },
    {
      k: 'Live site',
      v: state.safety.productionFreeze ? 'Frozen' : 'Reachable',
      sub: state.safety.productionFreeze ? 'Every change asks you first' : 'Production is not frozen',
    },
    {
      k: 'Working since',
      v: latest === undefined ? 'Not yet' : relativeTime(latest.startedAt, now),
      sub: `${recorded} ${recorded === 1 ? 'thing done' : 'things done'}`,
    },
  ];
}

/**
 * The three safety guarantees.
 *
 * README names this section but neither it nor the prototype supplies its three lines, so each one
 * is derived from a real safety fact and worded from copy already approved elsewhere in the pack.
 * A guarantee that is not currently true is stated as not true rather than dropped.
 */
export interface Guarantee {
  readonly text: string;
  readonly held: boolean;
}

export function guarantees(state: GovernedProjection): readonly Guarantee[] {
  const frozen = state.safety.productionFreeze;
  const ownerOnly = state.authority.ownerOnlyActions.length > 0;
  return [
    {
      text: frozen
        ? 'The live site is frozen — every change asks you first'
        : 'The live site is NOT frozen for this project',
      held: frozen,
    },
    {
      text: 'Windows holds your keys, not ProjectOS, and they never appear in a report',
      held: true,
    },
    {
      text: ownerOnly
        ? 'Only you can finish and close work'
        : 'No owner-only actions are recorded for this project',
      held: ownerOnly,
    },
  ];
}

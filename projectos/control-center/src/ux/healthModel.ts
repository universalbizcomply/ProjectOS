/**
 * IS PROJECTOS ITSELF OKAY? — the four answers, derived from what the engine already records.
 *
 * THIS MODEL EXISTS TO STOP HEALTH BEING INVENTED. A health screen is the easiest place in a
 * product to print a reassuring word nobody measured, so every field here traces to a real record:
 *
 *   AI usage      → `gatekeeperStatus`, the SAME cost ledger `projectos run` enforces against.
 *   Connectivity  → `connections`, which is credential METADATA and never a provider probe.
 *   Runtime       → the governed state itself: a projection, or the runtime's own reason for not
 *                   being one.
 *   Execution     → sessions, blockers, pending approvals and the plan's recomputed readiness.
 *
 * THE ONE RULE IT ENFORCES ABOVE ALL: a stored credential is not a healthy provider. ProjectOS has
 * never contacted OpenAI, Anthropic, GitHub or Supabase to ask, and there is no liveness probe in
 * the governed engine to ask with — so connectivity reports what is on file and says plainly that
 * reachability is unknown. Anything else would be a claim about the other end of a wire nobody has
 * pulled.
 *
 * Absence is reported as absence: `null` means "not recorded" or "could not be read", and is never
 * rendered as zero. A budget nobody configured is not a budget of $0.
 *
 * Pure: same state in, same model out. No clock beyond what is passed, no I/O.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { GovernedProjection, GovernedState } from '../governed/types';

/**
 * WHAT THE DAEMON CAN PROVE ABOUT A WORKER RIGHT NOW.
 *
 * Structurally satisfied by the sidecar's own `GovernedRunState`, which is set from the `run-started`
 * and `run-finished` events the sidecar emits for the child it actually owns — the process it
 * started and can still stop. Deliberately narrowed to the one field: liveness is a fact, not a
 * panel, and this model must not grow a second runtime state of its own.
 *
 * `null` means this surface has NO live answer, which is not the same as "nothing is running" — it
 * is what an owner opening the panel mid-run looks like.
 */
export interface LiveRunFact {
  readonly active: boolean;
}

/** How the whole system reads at a glance. Never better than the worst thing in it. */
export type HealthTone = 'ok' | 'attention' | 'problem' | 'unknown';

export interface HealthGroup {
  readonly id: 'usage' | 'connectivity' | 'runtime' | 'execution';
  readonly title: string;
  /** The one line an owner reads first. */
  readonly headline: string;
  readonly tone: HealthTone;
  /** Label/value pairs. A null value renders as its own honest word, never as 0 or ''. */
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string | null }>;
  /** Something the owner may need to act on. Empty when nothing does. */
  readonly notes: readonly string[];
}

export interface HealthModel {
  readonly groups: readonly HealthGroup[];
  /** The headline answer to "is anything wrong?". */
  readonly tone: HealthTone;
  readonly summary: string;
  /** True when at least one group needs the owner rather than merely reporting. */
  readonly needsOwner: boolean;
}

/** Micro-USD as money. Mirrors the core ledger's own formatting. */
function usd(microUsd: number): string {
  // A NEGATIVE OR NON-FINITE FIGURE IS NOT ZERO. Clamping it printed "$0.00" over a corrupt ledger
  // entry, which reads as "nothing spent" — the most reassuring possible rendering of a fault.
  if (!Number.isFinite(microUsd) || microUsd < 0) return 'Not recorded';
  const value = microUsd / 1_000_000;
  return value < 0.01 && value > 0 ? `$${value.toFixed(6)}` : `$${value.toFixed(2)}`;
}

/**
 * THE RUNTIME, from the governed state itself.
 *
 * Never inferred from a config value, a binary on disk, a credential or a stale heartbeat: the
 * daemon either delivered a projection, or it said why it could not, and those are the only two
 * things this can report.
 */
function runtimeGroup(governed: GovernedState | null): HealthGroup {
  if (governed === null) {
    return {
      id: 'runtime',
      title: 'ProjectOS runtime',
      headline: 'Not reported yet',
      tone: 'unknown',
      facts: [{ label: 'State', value: 'Waiting for the first report' }],
      notes: [],
    };
  }

  if (governed.connected) {
    return {
      id: 'runtime',
      title: 'ProjectOS runtime',
      headline: 'Running',
      tone: 'ok',
      facts: [
        { label: 'State', value: 'Running' },
        { label: 'Last reported', value: governed.observedAt === '' ? null : governed.observedAt },
        { label: 'Project it is watching', value: governed.projectName },
      ],
      notes: [],
    };
  }

  // The runtime's own four reasons, in the owner's words. The token itself is technical detail.
  const said: Record<string, { headline: string; tone: HealthTone }> = {
    NO_RUNTIME: { headline: 'Not running on this computer', tone: 'problem' },
    RUNTIME_STARTING: { headline: 'Starting up', tone: 'attention' },
    RUNTIME_STOPPED: { headline: 'Stopped', tone: 'problem' },
    REFUSED: { headline: 'Refused to report', tone: 'problem' },
  };
  const known = said[governed.reason] ?? { headline: 'Not responding', tone: 'problem' as HealthTone };
  return {
    id: 'runtime',
    title: 'ProjectOS runtime',
    headline: known.headline,
    tone: known.tone,
    facts: [
      { label: 'State', value: known.headline },
      { label: 'What ProjectOS said', value: governed.detail === '' ? null : governed.detail },
    ],
    notes:
      known.tone === 'problem'
        ? ['Nothing can run until the ProjectOS runtime is answering again.']
        : [],
  };
}

function usageGroup(live: GovernedProjection | null): HealthGroup {
  if (live === null) {
    return {
      id: 'usage',
      title: 'AI usage',
      headline: 'Unavailable',
      tone: 'unknown',
      facts: [{ label: 'Spending', value: null }],
      notes: ['ProjectOS cannot read the usage record while the runtime is not reporting.'],
    };
  }

  const g = live.gatekeeperStatus;

  // NOT CONFIGURED IS NOT ZERO. A project with no ceiling has not spent $0 — nobody set one, and
  // printing a figure would invent a limit that does not exist.
  if (!g.configured || g.budget === null) {
    return {
      id: 'usage',
      title: 'AI usage',
      headline: 'No spending limit set',
      tone: 'unknown',
      facts: [
        { label: 'Limit', value: 'Not set' },
        // A GENUINE ZERO IS KNOWN, and reporting it as "not recorded" is the same lie in reverse:
        // the ledger always computes these, so a new project that has spent nothing has spent
        // nothing — it is not a project whose usage could not be read.
        { label: 'Spent on this project', value: usd(g.spentThisProjectMicroUsd) },
        { label: 'Calls made', value: String(g.callCount) },
      ],
      notes: [],
    };
  }

  const b = g.budget;
  const tone: HealthTone = b.status === 'STOPPED' ? 'problem' : b.status === 'WARNING' ? 'attention' : 'ok';
  const headline =
    b.status === 'STOPPED'
      ? 'Monthly limit reached'
      : b.status === 'WARNING'
        ? 'Past the warning point'
        : 'Within the limit';

  return {
    id: 'usage',
    title: 'AI usage',
    headline,
    tone,
    facts: [
      { label: 'Spent this month', value: usd(b.spentThisMonthMicroUsd) },
      { label: 'Limit', value: usd(b.hardStopAtMicroUsd) },
      { label: 'Warn at', value: usd(b.warnAtMicroUsd) },
      { label: 'Left this month', value: usd(b.remainingMicroUsd) },
      { label: 'Spent on this project', value: usd(g.spentThisProjectMicroUsd) },
      { label: 'Calls made', value: String(g.callCount) },
      {
        label: 'Last call',
        // Only what the ledger actually recorded. No entry means none was ever made.
        value: g.lastCall === null ? 'None recorded' : `${g.lastCall.model} · ${usd(g.lastCall.costMicroUsd)} · ${g.lastCall.at}`,
      },
    ],
    notes:
      b.status === 'STOPPED'
        ? ['Nothing that costs money will run until the limit is raised or the month rolls over.']
        : b.status === 'WARNING'
          ? ['Spending is close to the limit.']
          : [],
  };
}

/**
 * CONNECTIVITY, WHICH IS CREDENTIAL METADATA — NOT REACHABILITY.
 *
 * The projection is built from `credentials status`, which reports whether a credential is on file
 * and nothing about whether the provider answers. There is no probe in the governed engine, and
 * this phase creates none: contacting a provider to make a screen look complete would be a real
 * external call for a cosmetic reason.
 */
function connectivityGroup(live: GovernedProjection | null): HealthGroup {
  if (live === null) {
    return {
      id: 'connectivity',
      title: 'Connections',
      headline: 'Unavailable',
      tone: 'unknown',
      facts: [],
      notes: ['ProjectOS cannot read the connection picture while the runtime is not reporting.'],
    };
  }

  const c = live.connections;

  // "COULD NOT READ" IS NOT "NONE CONFIGURED", and saying the second would be a claim this has not
  // earned — the installation may hold credentials it simply cannot see.
  if (!c.available) {
    return {
      id: 'connectivity',
      title: 'Connections',
      headline: 'Could not be read',
      tone: 'unknown',
      facts: [{ label: 'Why', value: c.detail === '' ? null : c.detail }],
      notes: [],
    };
  }

  if (c.connections.length === 0) {
    return {
      id: 'connectivity',
      title: 'Connections',
      headline: 'None set up',
      tone: 'ok',
      facts: [],
      notes: [],
    };
  }

  const stored = c.connections.filter((x) => x.status === 'STORED');
  const missing = c.connections.filter((x) => x.status === 'MISSING');
  const expired = c.connections.filter((x) => x.status === 'EXPIRED');
  /*
   * UNMANAGED IS ITS OWN ANSWER, and counting it as stored was a fabrication.
   *
   * The projection emits it when a credential is present but ProjectOS holds NO metadata for it —
   * nothing about when it was set or when it expires. The headline used to count every row as
   * "stored" while the fact beneath counted only real STORED rows, so one unmanaged credential
   * produced "1 stored" above "Stored: 0", reported as fine. It is not fine and it is not known.
   */
  const unmanaged = c.connections.filter((x) => x.status === 'UNMANAGED');
  const problems = missing.length + expired.length;

  const headline =
    problems > 0
      ? `${problems} of ${c.connections.length} need attention`
      : unmanaged.length > 0
        ? `${stored.length} stored, ${unmanaged.length} set up outside ProjectOS`
        : `${stored.length} stored`;

  return {
    id: 'connectivity',
    title: 'Connections',
    headline,
    tone:
      expired.length > 0
        ? 'problem'
        : missing.length > 0
          ? 'attention'
          : unmanaged.length > 0
            ? 'unknown'
            : 'ok',
    facts: [
      { label: 'Stored', value: String(stored.length) },
      { label: 'Not set up', value: String(missing.length) },
      { label: 'Expired', value: String(expired.length) },
      { label: 'Set up outside ProjectOS', value: String(unmanaged.length) },
      // Stated as a fact rather than left for the owner to assume.
      { label: 'Provider reachable?', value: 'Not checked — ProjectOS never contacts them to find out' },
    ],
    // The environment is part of the identity: two credentials for one provider are two things.
    notes: [
      ...expired.map((x) => `${x.provider} (${x.environment}) has expired and needs replacing.`),
      ...missing.map((x) => `${x.provider} (${x.environment}) is not set up yet.`),
      ...unmanaged.map(
        (x) => `${x.provider} (${x.environment}) was set up outside ProjectOS, so nothing is known about it.`,
      ),
    ],
  };
}

function executionGroup(live: GovernedProjection | null, liveRun: LiveRunFact | null): HealthGroup {
  if (live === null) {
    return {
      id: 'execution',
      title: 'Work',
      headline: 'Unavailable',
      tone: 'unknown',
      facts: [],
      notes: ['ProjectOS cannot see what is running while the runtime is not reporting.'],
    };
  }

  // HISTORY. A session record is written when a worker starts and rewritten when it exits, so a
  // worker killed, crashed or lost to a reboot leaves `started` on disk for ever — and nothing can
  // correct it, because the record carries no process identity. It is evidence that a run BEGAN,
  // never evidence that one is running.
  // A RUN BELONGS TO ITS PHASE, AND A CLOSED PHASE IS NOT "WORK THAT CANNOT CARRY ON". The day
  // Programme B closed, four of its attempts had failed and one had succeeded — the phase was closed
  // by the closure authority on the successful one. This screen still counted the four, coloured
  // the whole page red and told the owner "Something is wrong and work cannot carry on" while the
  // plan stood complete and ready. A failure inside a phase that has since closed is history, not a
  // problem in front of the owner; the same goes for a record that phase left unfinished. Records
  // whose phase is not in the plan at all (a plan-authoring session, an unknown id) keep counting,
  // because nothing says they are over.
  const closedPhases = new Set(live.phases.filter((p) => p.status === 'closed').map((p) => p.phaseId));
  const stillOpen = (s: { readonly phaseId: string }): boolean => !closedPhases.has(s.phaseId);
  const unfinished = live.sessions.filter((s) => s.state !== 'exited' && stillOpen(s));
  const failed = live.sessions.filter((s) => s.exitCode !== null && s.exitCode !== 0 && stillOpen(s));

  // LIVENESS. `true`/`false` only when the daemon actually answered; `null` when this surface has
  // no live answer at all — which is what an owner opening the panel mid-run looks like.
  const activeNow: boolean | null = liveRun === null ? null : liveRun.active;
  // "Not running" is only sayable when nothing is live AND nothing was left unfinished. With an
  // unfinished record and no live run the honest answer is that it is not known, and `null` is how
  // this model spells that — it renders as its own word rather than as a claim in either direction.
  const runningValue = activeNow === true ? 'Yes' : activeNow === false && unfinished.length === 0 ? 'No' : null;
  const waiting = live.pendingApprovals.length;
  const blocked = live.blockers.length > 0 || !live.plan.ready;

  // AN UNCONFIRMED RUN IS NOT "FINE". When a record was left unfinished and nothing live confirms
  // it, the state of the work is genuinely not known, and reporting that as ok is the reassuring
  // rendering of a fault this whole model exists to prevent.
  const unconfirmed = activeNow !== true && unfinished.length > 0;
  const tone: HealthTone =
    blocked || failed.length > 0
      ? 'problem'
      : waiting > 0
        ? 'attention'
        : unconfirmed
          ? 'unknown'
          : 'ok';
  /*
   * A PROBLEM IS NEVER HIDDEN BEHIND SOMETHING CALMER. `failed` decided the tone but appeared in no
   * headline, so a run that had just failed rendered a red dot beside the words "Nothing running".
   * Blocked first, because nothing can proceed; then a failure, because it already happened; then
   * what is waiting on the owner; then what is simply in flight.
   */
  const headline = blocked
    ? 'Blocked'
    : failed.length > 0
      ? failed.length === 1
        ? 'A run failed'
        : `${failed.length} runs failed`
      : waiting > 0
        ? waiting === 1
          ? '1 decision waiting for you'
          : `${waiting} decisions waiting for you`
        : activeNow === true
          ? 'Working'
          : unconfirmed
            ? unfinished.length === 1
              ? 'A recorded run was never marked finished'
              : `${unfinished.length} recorded runs were never marked finished`
            : 'Nothing running';

  return {
    id: 'execution',
    title: 'Work',
    headline,
    tone,
    facts: [
      { label: 'Running now', value: runningValue },
      { label: 'Recorded runs not marked finished', value: String(unfinished.length) },
      { label: 'Runs that failed', value: String(failed.length) },
      { label: 'Decisions waiting for you', value: String(waiting) },
      { label: 'Plan ready to run', value: live.plan.ready ? 'Yes' : 'No' },
    ],
    notes: [
      ...live.blockers,
      ...(live.plan.ready ? [] : live.plan.unmetReasons),
      ...(unconfirmed
        ? [
            unfinished.length === 1
              ? 'One run was never marked finished, and ProjectOS cannot confirm a worker is running now. A worker that stops unexpectedly leaves a record like this.'
              : `${unfinished.length} runs were never marked finished, and ProjectOS cannot confirm a worker is running now. A worker that stops unexpectedly leaves a record like this.`,
          ]
        : []),
    ],
  };
}

const WORST: readonly HealthTone[] = ['problem', 'attention', 'unknown', 'ok'];

export function buildHealthModel(
  governed: GovernedState | null,
  liveRun: LiveRunFact | null = null,
): HealthModel {
  const live = governed !== null && governed.connected ? governed : null;
  const groups = [
    usageGroup(live),
    connectivityGroup(live),
    runtimeGroup(governed),
    executionGroup(live, liveRun),
  ];

  // The headline is never better than the worst thing under it.
  const tone = WORST.find((t) => groups.some((g) => g.tone === t)) ?? 'ok';
  const needsOwner = groups.some((g) => g.tone === 'problem' || g.tone === 'attention');

  const summary =
    tone === 'ok'
      ? 'ProjectOS is working and nothing needs you.'
      : tone === 'unknown'
        ? 'ProjectOS cannot tell you everything about itself right now.'
        : tone === 'attention'
          ? 'ProjectOS is working, but something needs your attention.'
          : 'Something is wrong and work cannot carry on.';

  return { groups, tone, summary, needsOwner };
}

/**
 * THE EXECUTION WORKSPACE, DERIVED — one screen's worth of truth about a governed programme.
 *
 * WHY THIS EXISTS. Operating a project meant moving between Overview, Plans, Activity, Health and
 * Advanced and assembling the answer yourself. The owner asked for one screen that answers: what are
 * we building, how far are we, what is working now, what has finished, what is blocked, why, do I
 * need to do anything, and what happens next.
 *
 * IT DERIVES; IT DOES NOT DECIDE. Every value here is computed from records the runtime already
 * writes — the approved plan, phase records, the loop's checkpoint, execution evidence, findings,
 * the live run the sidecar tracks. This module holds no state of its own, performs no I/O, and
 * cannot make anything happen. Nothing here is a second lifecycle: a step's state is a reading of
 * the runtime's state, and where the records cannot answer, the answer is UNKNOWN.
 *
 * THE ONE RULE. A claim about the present tense needs present-tense evidence. "Working" requires the
 * live process the sidecar spawned and tracks; a record on disk can only say what was last written
 * down. This is the same rule that stopped a dead session being displayed as live work.
 *
 * Pure: same inputs, same output. No clock beyond the `now` passed in.
 */
import type {
  GovernedProjection,
  GovernedPhaseView,
  GovernedEvidenceView,
  GovernedFindingView,
} from '../governed/types';

/** What a step is doing, in the owner's words. Ordered from not-yet to finished. */
export type StepState =
  | 'QUEUED'
  | 'BLOCKED'
  | 'WORKING'
  | 'CHECKING'
  | 'REVIEWING'
  | 'HELD'
  | 'COMPLETE';

/** Whether a requirement is satisfied. `UNKNOWN` is a real answer and is never dressed up as met. */
export type RequirementState = 'MET' | 'OPEN' | 'FAILED' | 'UNKNOWN';

export interface Requirement {
  readonly id: string;
  readonly label: string;
  readonly state: RequirementState;
  /** What kind of promise this is — shown as a quiet tag, and used for grouping. */
  readonly kind: 'criterion' | 'check' | 'review' | 'gate' | 'proof';
  /** Why it is not met, when the runtime said so. Null when there is nothing to add. */
  readonly detail: string | null;
}

export interface StepView {
  readonly number: number;
  readonly phaseId: string;
  /** The plan's own sentence for this step. */
  readonly title: string;
  readonly state: StepState;
  /** `Agent`, `Owner`, or `Mixed` — from the plan's autonomy level and owner gates. */
  readonly performedBy: string;
  readonly taskTotal: number;
  readonly taskDone: number;
  /** 0–100, from tasks done. */
  readonly percent: number;
  readonly isCurrent: boolean;
  readonly requirements: readonly Requirement[];
  /** Unresolved critical/high findings the worker reported for THIS step. Empty when there are none. */
  readonly findings: readonly GovernedFindingView[];
  readonly blockedReason: string | null;
}

/** One capability the programme is using, and whether it is ready. */
export interface CapabilityView {
  readonly id: string;
  readonly label: string;
  readonly state: 'READY' | 'RUNNING' | 'MATCHED' | 'GAP';
  readonly detail: string;
}

export interface CompletedEntry {
  readonly at: string;
  readonly label: string;
  readonly who: string;
}

/** What the owner is being asked for, if anything. */
export interface OwnerGateView {
  readonly held: true;
  readonly stepNumber: number | null;
  readonly phaseId: string;
  /** Plain sentence: what ProjectOS wants to do. */
  readonly wants: string;
  /** Plain sentence: why the owner is being asked. */
  readonly why: string;
  /** Plain sentence: what the risk is. */
  readonly risk: string;
/**
   * WHETHER ANY PENDING APPROVAL EXISTS FOR THE OWNER TO ANSWER.
   *
   * IT IS NOT A LINK TO ONE. A `GovernedApprovalView` carries an action, a risk and a requester, and
   * NOTHING that ties it to a phase — so a screen that showed one held step and then decided "the
   * first pending approval" could permanently answer a different request than the one the owner was
   * reading. It did, in the first version of this screen. The gate panel now states that decisions
   * are waiting and hands the owner the real inbox, where each request names itself and is confirmed
   * one at a time; it never nominates a request on the owner's behalf.
   */
  readonly hasPendingApprovals: boolean;
  /** What the owner actually has to do, when this screen cannot answer the gate itself. */
  readonly ownerMustDo: string | null;
}

export interface ExecutionView {
  readonly projectName: string;
  readonly programmeLabel: string;
  readonly percentComplete: number;
  readonly stepsAccepted: number;
  readonly stepsTotal: number;
  readonly tasksDone: number;
  readonly tasksTotal: number;
  /** How long the live run has been going, or null when nothing is running. */
  readonly elapsedMs: number | null;
  readonly currentStep: StepView | null;
  readonly steps: readonly StepView[];
  readonly capabilities: readonly CapabilityView[];
  readonly completed: readonly CompletedEntry[];
  readonly ownerGate: OwnerGateView | null;
  /** True when a process is genuinely running right now. */
  readonly working: boolean;
  /** The one-line answer to "do I need to do anything?". */
  readonly ownerAction: string;
}

const CLOSED: readonly string[] = ['closed', 'accepted', 'complete', 'completed'];

/** A step is only Complete when a record says so — never because the ones after it started. */
function isComplete(phase: GovernedPhaseView): boolean {
  return CLOSED.includes(phase.status) || phase.closedByRecord;
}

/**
 * Who does this step. Derived from the plan's own autonomy level, with owner gates promoting it —
 * a step an agent performs but an owner must approve is honestly `Mixed`, not `Agent`.
 */
function performerOf(phase: GovernedPhaseView): string {
  const autonomy = phase.autonomyLevel.toLowerCase();
  const gated = phase.requiredOwnerGates.length > 0;
  if (autonomy.includes('owner') || autonomy.includes('human')) return 'Owner';
  if (gated) return 'Mixed';
  if (autonomy === '') return 'Mixed';
  return 'Agent';
}

/**
 * Requirements for one step: what the plan promised, answered by what the last run proved.
 *
 * Evidence is only consulted when it belongs to THIS step — evidence from another phase says nothing
 * about this one, and letting it tick a box here is exactly how a surface starts lying.
 */
export function requirementsFor(
  phase: GovernedPhaseView,
  evidence: GovernedEvidenceView | null,
): readonly Requirement[] {
  const mine = evidence !== null && evidence.phaseId === phase.phaseId ? evidence : null;
  const out: Requirement[] = [];

  for (const [i, criterion] of phase.acceptanceCriteria.entries()) {
    // A criterion is prose the plan wrote for a person. Nothing mechanically decides it, so it is
    // never claimed as met — it is shown, and the checks and reviews below are what get ticked.
    out.push({ id: `criterion-${i + 1}`, label: criterion, state: 'OPEN', kind: 'criterion', detail: null });
  }

  for (const name of phase.requiredValidators) {
    const ran = mine?.checks.find((c) => c.id === name) ?? null;
    out.push({
      id: `check-${name}`,
      label: name,
      state: ran === null ? 'UNKNOWN' : ran.passed ? 'MET' : 'FAILED',
      kind: 'check',
      detail: ran === null ? 'has not run for this step yet' : null,
    });
  }

  for (const review of phase.requiredReviews) {
    const done = mine !== null && mine.reviewsRecorded.some((r) => r === review);
    out.push({
      id: `review-${review.slice(0, 40)}`,
      label: review,
      state: mine === null ? 'UNKNOWN' : done ? 'MET' : 'OPEN',
      kind: 'review',
      detail: mine === null ? 'no run has recorded reviews for this step yet' : null,
    });
  }

  if (phase.requiredBrowserProof) {
    out.push({
      id: 'proof-browser',
      label: 'Proved in a real browser',
      state: 'UNKNOWN',
      kind: 'proof',
      detail: 'ProjectOS does not yet record browser proof mechanically',
    });
  }

  for (const gate of phase.requiredOwnerGates) {
    // WHETHER AN OWNER GATE IS SATISFIED IS NOT SOMETHING THIS SURFACE CAN SEE.
    //
    // A gate is discharged by a receipt the owner COMMITS, which the runtime reads from the git
    // object store; the projection this screen is built from does not carry that. An earlier
    // version computed it from the pending-approval list, which could never have produced a match
    // and so showed every gate as OPEN — reading as "not done" when the truthful answer is "not
    // known from here". `UNKNOWN` says the second thing, which is the one that is true.
    out.push({
      id: `gate-${gate.slice(0, 40)}`,
      label: gate,
      state: 'UNKNOWN',
      kind: 'gate',
      detail: 'answered by a decision ProjectOS records outside this screen',
    });
  }
  return out;
}

/** Unresolved findings of real weight — the ones that would hold a step up. */
export function blockingFindings(evidence: GovernedEvidenceView | null): readonly GovernedFindingView[] {
  if (evidence === null) return [];
  return evidence.findings.filter(
    (f) => !f.resolved && ['critical', 'high'].includes(f.severity.toLowerCase()),
  );
}

/**
 * A step's state, decided in one place.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. Complete first, because a finished step is finished whatever
 * else is true. Then held — an owner gate outranks activity, since nothing may proceed through it.
 * Then live activity, which alone may claim the present tense. Then blocked, then queued.
 */
export function stateOf(
  phase: GovernedPhaseView,
  opts: {
    readonly live: boolean;
    readonly liveKind: 'working' | 'checking' | 'reviewing';
    readonly held: boolean;
    readonly blockedReason: string | null;
  },
): StepState {
  if (isComplete(phase)) return 'COMPLETE';
  if (opts.held) return 'HELD';
  if (opts.live) {
    return opts.liveKind === 'checking' ? 'CHECKING' : opts.liveKind === 'reviewing' ? 'REVIEWING' : 'WORKING';
  }
  if (opts.blockedReason !== null) return 'BLOCKED';
  return 'QUEUED';
}

/**
 * What the loop is doing right now, read from its own last output line.
 *
 * The loop prints what it is about to do; this reads that and nothing else. An unrecognised line
 * means "working", which is the truthful floor — it is running, and we do not claim to know more.
 */
function liveKindFrom(lines: readonly string[]): 'working' | 'checking' | 'reviewing' {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = (lines[i] ?? '').toLowerCase();
    if (l.includes('gatekeeper request') || l.includes('reviewer')) return 'reviewing';
    if (l.includes('pass validator') || l.includes('pass test') || l.includes('running check') || l.includes('typecheck')) {
      return 'checking';
    }
    if (l.includes('worker') || l.includes('attempt')) return 'working';
  }
  return 'working';
}

/** Plain words for a loop stop code the owner may be looking at. */
function gateWordsFor(
  stopCode: string | null,
  stopDetail: string | null,
): { wants: string; why: string; risk: string } {
  const said = stopDetail ?? 'ProjectOS did not record why.';
  switch (stopCode) {
    case 'CONTINUATION_READY':
      return {
        wants: 'Commit the finished work for this step.',
        why: 'The work is done and passed every required check. ProjectOS does not commit its own work unquestioned — an independent reviewer decides first.',
        risk: 'Low. Nothing reaches customers, payments, credentials or the live site; this only records the work in the project history.',
      };
    case 'CORRECTION_EXHAUSTED':
      return {
        wants: 'Stop and hand the step back to you.',
        why: 'A required check keeps failing and ProjectOS is not allowed to change what fails, so trying again would give the same result.',
        risk: `None from waiting. ProjectOS said: ${said}`,
      };
    case 'OWNER_GATE':
    case 'AWAITING_OWNER':
      return {
        wants: 'Take an action this plan reserves for you.',
        why: 'The next step needs your authority before ProjectOS may take it.',
        risk: `Depends on the action. ProjectOS said: ${said}`,
      };
    case 'BUDGET_STOP':
      return {
        wants: 'Continue past the review budget.',
        why: 'The amount you approved for paid reviews has been reached.',
        risk: 'Spending beyond the limit you set.',
      };
    default:
      return {
        wants: 'Continue this step.',
        why: 'ProjectOS stopped and asked for you.',
        risk: said,
      };
  }
}

export function buildExecutionView(
  state: GovernedProjection,
  liveRun: { readonly active: boolean; readonly phaseId: string | null; readonly startedAt: string | null; readonly lines: readonly string[] } | null,
  now: number,
): ExecutionView {
  const work = state.work ?? null;
  const evidence = state.evidence ?? null;
  const running = liveRun?.active === true;
  const liveKind = liveKindFrom(liveRun?.lines ?? []);

  // WHICH STEP IS IN PLAY. The live run names one; failing that the runtime's own active phase;
  // failing that the checkpoint's. Never a guess from position in the list.
  const currentId = (running ? liveRun?.phaseId : null) ?? state.activePhase?.phaseId ?? work?.phaseId ?? state.nextStartablePhase?.phaseId ?? null;

  const heldId = work !== null && work.ownerRequired && work.state !== 'COMPLETE' ? work.phaseId : null;

  const steps: StepView[] = state.phases.map((phase, i) => {
    const isCurrent = phase.phaseId === currentId;
    const held = phase.phaseId === heldId;
    const requirements = requirementsFor(phase, evidence);
    const blocked =
      phase.unmetDependencies.length > 0
        ? `waiting for ${phase.unmetDependencies.join(', ')}`
        : null;
    const stepState = stateOf(phase, {
      live: running && isCurrent,
      liveKind,
      held,
      blockedReason: blocked,
    });
    // TASKS ARE THE STEP'S OWN REQUIREMENTS, not an invented breakdown. Criteria are excluded from
    // the count because nothing mechanically decides them; counting them would make every step look
    // permanently unfinished.
    const countable = requirements.filter((r) => r.kind !== 'criterion');
    const done = countable.filter((r) => r.state === 'MET').length;
    const total = countable.length;
    return {
      number: i + 1,
      phaseId: phase.phaseId,
      title: phase.description === '' ? phase.phaseId : phase.description,
      state: stepState,
      performedBy: performerOf(phase),
      taskTotal: total,
      taskDone: stepState === 'COMPLETE' ? total : done,
      percent: total === 0 ? (stepState === 'COMPLETE' ? 100 : 0) : Math.round((100 * (stepState === 'COMPLETE' ? total : done)) / total),
      isCurrent,
      requirements,
      // Evidence belongs to one phase; a finding from another says nothing about this step.
      findings: evidence !== null && evidence.phaseId === phase.phaseId ? blockingFindings(evidence) : [],
      blockedReason: blocked,
    };
  });

  const currentStep = steps.find((s) => s.isCurrent) ?? null;

  const ownerGate: OwnerGateView | null =
    heldId === null
      ? null
      : (() => {
          const words = gateWordsFor(work?.stopCode ?? null, work?.stopDetail ?? null);
          const waiting = state.pendingApprovals.length;
          return {
            held: true as const,
            stepNumber: steps.find((s) => s.phaseId === heldId)?.number ?? null,
            phaseId: heldId,
            ...words,
            hasPendingApprovals: waiting > 0,
            ownerMustDo:
              waiting > 0
                ? `${waiting === 1 ? 'One request is' : `${waiting} requests are`} waiting for your decision below. Each one names what it permits, and asks you to confirm before it is recorded.`
                : 'There is no request for this screen to answer. ProjectOS needs a decision recorded outside it before this step can continue — it will carry on by itself once that exists.',
          };
        })();

  const capabilities: CapabilityView[] = [
    {
      id: 'implementer',
      label: state.authority.implementer === '' ? 'Implementer' : state.authority.implementer,
      state: running ? 'RUNNING' : 'READY',
      detail: running ? 'working on this step' : 'ready',
    },
    {
      id: 'reviewer',
      label: state.authority.gatekeeper === '' ? 'Reviewer' : state.authority.gatekeeper,
      state: state.gatekeeperStatus.configured && state.gatekeeperStatus.budget?.status === 'OK' ? 'READY' : 'GAP',
      detail: !state.gatekeeperStatus.configured
        ? 'not configured'
        : state.gatekeeperStatus.budget === null
          ? 'budget not reported'
          : state.gatekeeperStatus.budget.status === 'OK'
            ? 'connected, within budget'
            : 'budget limit reached',
    },
    {
      id: 'checks',
      label: 'Automatic checks',
      state:
        currentStep === null || currentStep.requirements.every((r) => r.kind !== 'check')
          ? 'GAP'
          : currentStep.requirements.some((r) => r.kind === 'check' && r.state === 'UNKNOWN')
            ? 'MATCHED'
            : 'READY',
      detail:
        currentStep === null
          ? 'no step in play'
          : `${currentStep.requirements.filter((r) => r.kind === 'check').length} required for this step`,
    },
    {
      id: 'proof',
      label: 'Browser proof',
      state: currentStep?.requirements.some((r) => r.kind === 'proof') === true ? 'GAP' : 'READY',
      detail:
        currentStep?.requirements.some((r) => r.kind === 'proof') === true
          ? 'required here, not recorded mechanically'
          : 'not required for this step',
    },
  ];

  // WHAT HAS FINISHED, newest first, from records rather than from the screen's own memory.
  const completed: CompletedEntry[] = [];
  if (evidence !== null) {
    for (const c of evidence.checks) {
      if (!c.passed) continue;
      completed.push({ at: c.at, label: c.id, who: 'ProjectOS' });
    }
    for (const r of evidence.reviewsRecorded) {
      completed.push({ at: evidence.collectedAt, label: r, who: state.authority.implementer || 'Implementer' });
    }
  }
  for (const phase of state.phases) {
    for (const t of phase.history) {
      completed.push({ at: t.at, label: `${phase.description === '' ? phase.phaseId : phase.description} — ${t.to}`, who: t.by || 'ProjectOS' });
    }
  }
  completed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const stepsAccepted = steps.filter((s) => s.state === 'COMPLETE').length;
  const tasksTotal = steps.reduce((n, s) => n + s.taskTotal, 0);
  const tasksDone = steps.reduce((n, s) => n + s.taskDone, 0);
  const elapsedMs =
    running && liveRun?.startedAt != null && !Number.isNaN(Date.parse(liveRun.startedAt))
      ? Math.max(0, now - Date.parse(liveRun.startedAt))
      : null;

  return {
    projectName: state.projectName,
    programmeLabel: `Plan ${state.plan.planVersion}`,
    percentComplete:
      steps.length === 0 ? 0 : Math.round((100 * stepsAccepted) / steps.length),
    stepsAccepted,
    stepsTotal: steps.length,
    tasksDone,
    tasksTotal,
    elapsedMs,
    currentStep,
    steps,
    capabilities,
    completed: completed.slice(0, 40),
    ownerGate,
    working: running,
    ownerAction:
      ownerGate !== null
        ? 'YOUR DECISION IS NEEDED'
        : running
          ? 'NONE — ProjectOS is working'
          : stepsAccepted === steps.length && steps.length > 0
            ? 'NONE — every step is finished'
            : 'NONE',
  };
}

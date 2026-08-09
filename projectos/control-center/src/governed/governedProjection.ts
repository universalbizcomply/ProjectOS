/**
 * Pure projection of canonical ProjectOS records into the owner-facing governed view.
 *
 * Pure by design: every input is already-parsed data, so the same function runs in the sidecar (which
 * does the file I/O) and in tests (which feed it this repository's real records). Nothing here reads
 * a file, calls a clock, or decides authority — authority verdicts are INPUTS, computed by the real
 * engine in the process that has it, because a browser cannot run `plan-governance-engine.cjs`.
 *
 * The one rule this module exists to enforce: the surface shows what the records SAY, never what a
 * hand-maintained snapshot claims. Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type {
  GovernedAuthorityView,
  GovernedDelegationView,
  GovernedPhaseStatus,
  GovernedPhaseView,
  GovernedProjection,
  GovernedTransition,
} from './types.js';

/** Verdict from the real plan-governance engine. Supplied, never inferred. */
export interface ReadinessVerdict {
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export interface GovernedInputs {
  /** Parsed `.projectops/project-config.json`. */
  readonly config: Record<string, unknown>;
  /** Parsed active approved plan (the config-declared one, or the default location). */
  readonly plan: Record<string, unknown>;
  /** Parsed config-declared current-state record, or null when none is declared. */
  readonly currentState: Record<string, unknown> | null;
  /** Parsed `.projectops/phases/*.json` records. */
  readonly phaseRecords: readonly Record<string, unknown>[];
  /** Recomputed by the engine — the stored `planStatus` string is never trusted. */
  readonly readiness: ReadinessVerdict;
  readonly planPath: string;
  readonly branch: string | null;
  readonly head: string | null;
  /** Producer-supplied observation time. Keeps this function free of a clock. */
  readonly observedAt: string;
}

const CORE_STATUSES: readonly GovernedPhaseStatus[] = [
  'draft',
  'prompted',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
  'awaiting_closure',
  'closed',
  'closed_as_blocked',
  'rolled_back',
];

/** Statuses that mean the phase is being worked right now. */
const ACTIVE_STATUSES: readonly GovernedPhaseStatus[] = [
  'draft',
  'prompted',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
  'awaiting_closure',
];

function str(rec: Record<string, unknown>, key: string, fallback = ''): string {
  const v = rec[key];
  return typeof v === 'string' ? v : fallback;
}

function strArray(rec: Record<string, unknown> | undefined, key: string): readonly string[] {
  if (rec === undefined) return [];
  const v = rec[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function num(rec: Record<string, unknown> | null, key: string, fallback = 0): number {
  if (rec === null) return fallback;
  const v = rec[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function obj(rec: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = rec[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asStatus(value: unknown): GovernedPhaseStatus {
  return typeof value === 'string' && (CORE_STATUSES as readonly string[]).includes(value)
    ? (value as GovernedPhaseStatus)
    : 'not-started';
}

function historyOf(rec: Record<string, unknown>): readonly GovernedTransition[] {
  const raw = rec['history'];
  if (!Array.isArray(raw)) return [];
  const out: GovernedTransition[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t['to'] !== 'string' || typeof t['by'] !== 'string') continue;
    const note = t['note'];
    out.push({
      from: typeof t['from'] === 'string' ? t['from'] : '',
      to: t['to'],
      by: t['by'],
      at: typeof t['at'] === 'string' ? t['at'] : '',
      ...(typeof note === 'string' ? { note } : {}),
    });
  }
  return out;
}

/**
 * A phase record counts as complete only when the OWNER closed it — the same rule the runtime's own
 * dependency gate applies (`governedContext.isOwnerClosed`). Kept identical on purpose: if the two
 * disagreed, the surface would offer a Start the runtime then refuses, or hide one it would allow.
 */
function isOwnerClosed(rec: Record<string, unknown>): boolean {
  if (rec['status'] !== 'closed') return false;
  const history = historyOf(rec);
  const last = history[history.length - 1];
  return last !== undefined && last.to === 'closed' && last.by === 'owner';
}

function delegationOf(governance: Record<string, unknown> | undefined): GovernedDelegationView | null {
  const del = governance === undefined ? undefined : obj(governance, 'closureDelegation');
  if (del === undefined) return null;
  return {
    delegatedBy: str(del, 'delegatedBy'),
    delegatedTo: str(del, 'delegatedTo'),
    delegatedScope: strArray(del, 'delegatedScope'),
    projectScope: str(del, 'projectScope'),
    excludesProtectedActions: del['excludesProtectedActions'] === true,
  };
}

function authorityOf(plan: Record<string, unknown>): GovernedAuthorityView {
  const gov = obj(plan, 'governance');
  return {
    owner: gov === undefined ? '' : str(gov, 'owner'),
    gatekeeper: gov === undefined ? '' : str(gov, 'gatekeeper'),
    implementer: gov === undefined ? '' : str(gov, 'implementer'),
    closureAuthority: gov === undefined ? '' : str(gov, 'closureAuthority'),
    closureDelegation: delegationOf(gov),
    ownerOnlyActions: strArray(gov, 'ownerOnlyActions'),
  };
}

/**
 * The single safe next action, derived rather than authored. Order matters: a plan that is not READY
 * outranks everything, because nothing governed may proceed under it.
 */
function deriveNextSafeAction(
  ready: boolean,
  unmetReasons: readonly string[],
  active: GovernedPhaseView | null,
  nextStartable: GovernedPhaseView | null,
): string {
  if (!ready) {
    const first = unmetReasons[0] ?? 'the plan does not satisfy the evidence gate';
    return `The approved plan is not READY, so no governed phase may proceed. Unmet: ${first}`;
  }
  if (active !== null) {
    if (active.status === 'awaiting_closure') {
      return `${active.phaseId} is awaiting closure. Closure is owner-gated — the implementer cannot close it.`;
    }
    if (active.status === 'awaiting_review') {
      return `${active.phaseId} is awaiting review. Review the evidence, then move it to awaiting closure.`;
    }
    return `${active.phaseId} is ${active.status}. Continue that phase; no other phase may start while it is open.`;
  }
  if (nextStartable !== null) {
    return `${nextStartable.phaseId} is authorised and its dependencies are recorded complete. Starting it creates a draft phase record — nothing is deployed, closed or approved.`;
  }
  return 'No approved phase is currently startable: every remaining phase has an unmet dependency. Close the phase it depends on first.';
}

/** Build the owner-facing projection from canonical records. */
export function projectGovernedState(inputs: GovernedInputs): GovernedProjection {
  const { config, plan, currentState, phaseRecords, readiness } = inputs;

  const recordById = new Map<string, Record<string, unknown>>();
  for (const rec of phaseRecords) {
    const id = str(rec, 'phaseId');
    if (id !== '') recordById.set(id, rec);
  }

  // Completion evidence, from exactly the two sources the runtime itself accepts.
  const complete = new Set<string>();
  for (const [id, rec] of recordById) if (isOwnerClosed(rec)) complete.add(id);
  const recordedComplete = new Set(strArray(currentState ?? undefined, 'completedPhases'));
  for (const id of recordedComplete) complete.add(id);

  const planPhases = Array.isArray(plan['phases'])
    ? (plan['phases'] as readonly unknown[]).filter(
        (p): p is Record<string, unknown> => typeof p === 'object' && p !== null,
      )
    : [];

  const phases: GovernedPhaseView[] = planPhases.map((ph) => {
    const phaseId = str(ph, 'phaseId');
    const rec = recordById.get(phaseId);
    const dependsOn = strArray(ph, 'dependsOn');
    const unmetDependencies = dependsOn.filter((d) => !complete.has(d));
    const status = rec === undefined ? 'not-started' : asStatus(rec['status']);
    return {
      phaseId,
      description: str(ph, 'description'),
      status,
      dependsOn,
      unmetDependencies,
      // Startable means "may be started now", so three things must all hold: no record exists yet
      // (a phase carrying one is under way or finished), the phase is not ALREADY recorded complete
      // by the programme record (offering a closed phase as startable is how a surface invites a
      // refusal), and every dependency is satisfied — under a plan that is actually READY.
      startable:
        rec === undefined &&
        !complete.has(phaseId) &&
        unmetDependencies.length === 0 &&
        readiness.ready,
      requiredOwnerGates: strArray(ph, 'requiredOwnerGates'),
      requiredBrowserProof: ph['requiredBrowserProof'] === true,
      history: rec === undefined ? [] : historyOf(rec),
      closedByRecord: rec === undefined && recordedComplete.has(phaseId),
    };
  });

  const activePhase = phases.find((p) => (ACTIVE_STATUSES as readonly string[]).includes(p.status)) ?? null;
  // EXECUTION SEQUENCING, not a plan dependency. While a phase is in flight, starting another is
  // never the safe next action, so no phase is offered as the next one to start. This does NOT
  // falsify `startable` on the individual phases — the plan's declared dependencies are reported as
  // they are — it only stops the surface pointing at a second phase while one is open. Recorded
  // because plan v1.1 makes Phase 17 mechanically eligible from Phase 16 alone, so without this the
  // surface would invite starting hardening while the integration phase was still unfinished.
  const nextStartablePhase = activePhase !== null ? null : (phases.find((p) => p.startable) ?? null);

  const approval = obj(plan, 'approval');
  const supersedes = approval === undefined ? null : approval['supersedesPlanVersion'];
  const branch = inputs.branch;
  const protectedBranches = strArray(config, 'protectedBranches');

  return {
    connected: true,
    projectId: str(config, 'projectId'),
    projectName: str(config, 'projectName'),
    repository: {
      repo: str(config, 'repo'),
      localPath: str(config, 'localPath'),
      branch,
      head: inputs.head,
      protectedBranches,
      onProtectedBranch: branch !== null && protectedBranches.includes(branch),
    },
    plan: {
      planId: str(plan, 'planId'),
      planVersion: str(plan, 'planVersion'),
      declaredStatus: str(plan, 'planStatus'),
      ready: readiness.ready,
      unmetReasons: readiness.reasons,
      planPath: inputs.planPath,
      supersedes: typeof supersedes === 'string' ? supersedes : null,
    },
    programme: {
      acceptedPhaseCount: num(currentState, 'acceptedPhaseCount'),
      totalPhaseCount: num(currentState, 'totalPhaseCount', planPhases.length),
      completionPercentage: num(currentState, 'completionPercentage'),
      completedPhases: strArray(currentState ?? undefined, 'completedPhases'),
      pendingPhases: strArray(currentState ?? undefined, 'pendingPhases'),
    },
    phases,
    activePhase,
    nextStartablePhase,
    authority: authorityOf(plan),
    safety: {
      productionFreeze: config['productionFreeze'] === true,
      forbiddenActions: strArray(config, 'forbiddenActions'),
      approvalGates: strArray(config, 'approvalGates'),
    },
    blockers: strArray(currentState ?? undefined, 'currentBlockers'),
    risks: strArray(currentState ?? undefined, 'currentRisks'),
    nextSafeAction: deriveNextSafeAction(
      readiness.ready,
      readiness.reasons,
      activePhase,
      nextStartablePhase,
    ),
    observedAt: inputs.observedAt,
  };
}

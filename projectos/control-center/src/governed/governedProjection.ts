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
import {
  isGenuineClosure,
  summariseLedger,
  evaluateBudget,
  policyProblems,
  type ClosureDecisionRecord,
  type ClosureAuthorityExpectations,
  type LedgerEntry,
} from '@projectos/core';
import type {
  GovernedApprovalView,
  GovernedAuthorityView,
  GovernedDelegationView,
  GovernedGatekeeperView,
  GovernedPhaseStatus,
  GovernedConnectionView,
  GovernedConnectionsView,
  GovernedPlanDraftView,
  GovernedSessionView,
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
  /**
   * Parsed `.projectops/closure/decisions/*.json` records, keyed by phase id.
   *
   * Supplied because this module is pure and a browser cannot read files. Without them a closed
   * phase record would be believed on the strength of its own role string, which is exactly the
   * bypass this input exists to close. Absent (or an empty map) means no closure can be evidenced,
   * which fails closed.
   */
  readonly closureDecisions?: Readonly<Record<string, Record<string, unknown>>>;
  /** Parsed `.projectops/gatekeeper.json`, or null when the project has none configured. */
  readonly gatekeeperConfig?: Record<string, unknown> | null;
  /** Parsed `.projectops/gatekeeper-ledger.json` entries — real spend, never estimated here. */
  readonly gatekeeperLedger?: readonly LedgerEntry[];
  /** Parsed `.projectops/approvals/*.json` records, whatever their state. Filtered to pending below. */
  readonly approvalRecords?: readonly Record<string, unknown>[];
  /** Parsed `.projectops/drafts/*.json` records — every drafted plan proposal. */
  readonly draftRecords?: readonly Record<string, unknown>[];
  /** Parsed `.projectops/plan-decisions/*.json` records, matched to drafts by `draftId` below. */
  readonly planDecisionRecords?: readonly Record<string, unknown>[];
  /** Parsed `.projectops/execution/*.session.json` records — every worker session on record. */
  readonly sessionRecords?: readonly Record<string, unknown>[];
  /**
   * Credential METADATA rows, exactly as `credentials status --json` emits them, or null when the
   * credential router could not be reached. Null and "an empty list" are different facts and are
   * projected differently — see `GovernedConnectionsView`.
   */
  readonly credentialRows?: readonly Record<string, unknown>[] | null;
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

/**
 * Statuses that mean the phase is being worked right now.
 *
 * EXPORTED because the daemon's project-switch gate must ask the same question this projection
 * answers. A second copy over there would be free to drift, and a drifted copy would refuse switches
 * the owner was told were safe — or permit ones they were told were not.
 */
export const ACTIVE_PHASE_STATUSES: readonly GovernedPhaseStatus[] = [
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
/**
 * A GENUINE closure — backed by the DECISION that authorised it, not by a role string.
 *
 * This read the closing entry's role and believed it. A role is a string, and this programme is
 * `tamperProof: false`: anything able to write a phase record can write `by: advisor`, so a
 * hand-written history would have read as a completed phase on the owner's own surface. The rule is
 * now the same one the runtime applies — the closing entry must name the decision that authorised
 * it, and that decision must exist, be for this phase and project, decide to close, name the
 * authority the ACTIVE PLAN records, and carry the consumption marker the closure wrote.
 *
 * The decisions arrive as an INPUT because this module is pure and the browser cannot read files;
 * the sidecar, which can, supplies them. Same rule, one definition, two callers.
 */
function isOwnerClosed(
  rec: Record<string, unknown>,
  decision: ClosureDecisionRecord | null,
  expect: ClosureAuthorityExpectations,
): boolean {
  return isGenuineClosure(rec as never, decision, expect);
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
  allPhasesComplete: boolean,
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
  // A FINISHED programme and a BLOCKED one both reach here with nothing startable, and telling the
  // owner to "close the phase it depends on first" when there is no such phase is simply untrue —
  // it invites a search for work that does not exist. The two cases are separated, and the
  // completion wording deliberately grants nothing: finishing this plan authorises no new work.
  if (allPhasesComplete) {
    return 'Every phase in the approved plan is complete. There is nothing to start here. New work needs a new owner-approved plan.';
  }
  return 'No approved phase is currently startable: every remaining phase has an unmet dependency. Close the phase it depends on first.';
}

/** Build the owner-facing projection from canonical records. */
/**
 * Real gatekeeper spend, summarised with the SAME pure functions `projectos run` itself calls
 * before every live call. Never a second implementation of the arithmetic that decides a budget.
 */
function gatekeeperStatusOf(
  gatekeeperConfig: Record<string, unknown> | null | undefined,
  ledger: readonly LedgerEntry[],
  projectId: string,
  phaseId: string,
  observedAt: string,
): GovernedGatekeeperView {
  const configured = gatekeeperConfig !== null && gatekeeperConfig !== undefined && gatekeeperConfig['enabled'] === true;
  const month = observedAt.slice(0, 7);
  const totals = summariseLedger(ledger, { projectId, phaseId, month });

  const budgetRaw = configured ? (gatekeeperConfig?.['budget'] as Record<string, unknown> | undefined) : undefined;
  const policy =
    budgetRaw === undefined
      ? null
      : {
          warnAtMicroUsd: typeof budgetRaw['warnAtMicroUsd'] === 'number' ? budgetRaw['warnAtMicroUsd'] : NaN,
          hardStopAtMicroUsd: typeof budgetRaw['hardStopAtMicroUsd'] === 'number' ? budgetRaw['hardStopAtMicroUsd'] : NaN,
        };
  const budget =
    policy === null || policyProblems(policy).length > 0
      ? null
      : (() => {
          const verdict = evaluateBudget(totals, policy);
          return {
            status: verdict.status,
            spentThisMonthMicroUsd: verdict.spentMicroUsd,
            remainingMicroUsd: verdict.remainingMicroUsd,
            warnAtMicroUsd: policy.warnAtMicroUsd,
            hardStopAtMicroUsd: policy.hardStopAtMicroUsd,
          };
        })();

  // The most recent entry BY TIME, not by array order — the ledger is append-only but a restart
  // can still append out of strict chronological order relative to a prior run's tail.
  const last = [...ledger]
    .filter((e) => typeof e.at === 'string' && e.at.length > 0)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];

  return {
    configured,
    budget,
    spentThisPhaseMicroUsd: totals.phaseMicroUsd,
    spentThisProjectMicroUsd: totals.projectMicroUsd,
    callCount: totals.callCount,
    lastCall:
      last === undefined ? null : { requestId: last.requestId, model: last.model, at: last.at, costMicroUsd: last.costMicroUsd },
  };
}

/** Every PENDING approval, straight from the canonical records. Decided ones are filtered out. */
function pendingApprovalsOf(records: readonly Record<string, unknown>[]): readonly GovernedApprovalView[] {
  return records
    .filter((rec) => rec['state'] === 'pending')
    .map((rec) => ({
      id: str(rec, 'id'),
      action: str(rec, 'action'),
      gated: rec['gated'] === true,
      prohibited: rec['prohibited'] === true,
      risk: str(rec, 'risk'),
      requestedBy: str(rec, 'requestedBy'),
      requestedAt: str(rec, 'requestedAt'),
    }))
    .filter((a) => a.id !== '')
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0));
}

/**
 * Every drafted plan, matched against any decision recorded for it by the decision's own `draftId`
 * field — never by filename or position, since neither is a claim the decision itself makes.
 */
function planDraftsOf(
  drafts: readonly Record<string, unknown>[],
  decisions: readonly Record<string, unknown>[],
): readonly GovernedPlanDraftView[] {
  return drafts
    .map((d) => {
      const draftId = str(d, 'objectiveId');
      const decision = decisions.find((dec) => str(dec, 'draftId') === draftId);
      const decisionState: GovernedPlanDraftView['decisionState'] =
        decision === undefined
          ? 'none'
          : decision['consumedAt'] !== undefined && decision['consumedAt'] !== null
            ? 'consumed'
            : decision['decision'] === 'approve'
              ? 'approved'
              : 'refused';
      return {
        draftId,
        planStatus: str(d, 'planStatus'),
        generatedAt: str(d, 'generatedAt'),
        decisionState,
        decisionId: decision === undefined ? null : str(decision, 'decisionId'),
        // Absent means 'import': that is what every draft written before authoring existed was.
        origin: str(d, 'origin') === 'authored' ? ('authored' as const) : ('import' as const),
        ...proposalContent(d),
      };
    })
    .filter((v) => v.draftId !== '')
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : 0))
    // THE WHOLE GOVERNED STATE TRAVELS AS ONE PROTOCOL LINE, and the host drops an oversize line
    // whole and silently (MAX_PROTOCOL_LINE_BYTES, 64 KB). With proposal content each draft can add
    // ~6.5 KB, so an unbounded history of drafts would one day stop EVERY update, not just the
    // proposals. Newest first, most recent DRAFTS_MAX kept; the runtime still knows them all.
    .slice(0, DRAFTS_MAX);
}
/** How many proposals the surface carries. Older ones remain on disk and remain decidable by id. */
const DRAFTS_MAX = 8;

/** Bounds for what a proposal shows of itself. A plan that says more is truncated, never refused. */
const SUMMARY_MAX_CHARS = 400;
const STEPS_MAX = 12;
const STEP_PURPOSE_MAX_CHARS = 240;
const DECISIONS_MAX = 8;
const DECISION_MAX_CHARS = 400;

/**
 * SEC-001 CLASS. Provider-authored text reaches the owner's eyes immediately before an Approve. Unicode
 * bidirectional overrides and format characters (U+202A-U+202E, U+2066-U+2069, U+200E/F, U+061C) can
 * make such text READ in an order that has nothing to do with its bytes, and control characters can
 * hide part of it. Stripped, not escaped - the same rule `safeExcerpt` applies to provider excerpts in
 * the agent. Truncation is by code point so an emoji at the boundary is dropped whole, never split.
 */
const REORDERING = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const clip = (text: string, max: number): string => {
  const points = Array.from(text.replace(REORDERING, '')).filter((ch) => ch >= ' ');
  return points.length <= max ? points.join('') : points.slice(0, max - 1).join('') + '\u2026';
};

/**
 * A CONSERVATIVE SECRET SHAPE, at the one point where draft text becomes visible.
 *
 * An AUTHORED draft is refused by the runtime before it is written if it looks like it carries a
 * secret. An IMPORT draft is built from discovered repository documents and has no such gate on its
 * way to disk; until this projection those fields were never shown, so the gap was latent. This is a
 * last line, not the first: a field that matches is WITHHELD from the view with a note, never shown.
 * Shapes: provider key prefixes, PEM private keys, bearer tokens, and `key=value` assignments whose
 * key names a secret. Deliberately narrow so an ordinary sentence about "tokens" is not withheld.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{12,}/i,
];
const WITHHELD = '[withheld - this text looks like it contains a secret]';
const guard = (text: string): string => (SECRET_SHAPES.some((re) => re.test(text)) ? WITHHELD : text);

/**
 * The readable part of a draft record — its vision, its phase candidates and the owner decisions it
 * names — for the Plans screen and the plan detail view. Every field is optional and absent when
 * the record does not carry it, so an import draft written before authoring existed renders as it
 * always did. Bounded on the way out, because a record is a file the runtime wrote and a view
 * should never become an unbounded paint of one.
 */
function proposalContent(
  d: Record<string, unknown>,
): Pick<GovernedPlanDraftView, 'summary' | 'steps' | 'ownerDecisions'> {
  const draft = obj(d, 'draft');
  if (draft === undefined) return {};
  const out: { summary?: string; steps?: GovernedPlanDraftView['steps']; ownerDecisions?: readonly string[] } = {};
  const vision = str(draft, 'businessVision');
  if (vision !== '') out.summary = clip(guard(vision), SUMMARY_MAX_CHARS);
  const phases = draft['phaseCandidates'];
  if (Array.isArray(phases)) {
    const steps = phases
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && !Array.isArray(p))
      .map((p) => ({ id: clip(str(p, 'phaseId'), 80), purpose: clip(guard(str(p, 'purpose')), STEP_PURPOSE_MAX_CHARS), risk: clip(str(p, 'riskLevel'), 16) }))
      .filter((s) => s.id !== '')
      .slice(0, STEPS_MAX);
    if (steps.length > 0) out.steps = steps;
  }
  // The draft body's own list first; the record-level copy - the one the approval digest binds - when
  // the body has none. `strArray` returns [] rather than null, so this is a length test, not `??`:
  // written as `??` the record-level copy could never be reached, and a record carrying decisions only
  // at the top level would have shown NONE - the blind approval this view exists to end.
  const own = strArray(draft, 'ownerDecisionsRequired');
  const decisions = own.length > 0 ? own : strArray(d, 'ownerDecisionsRequired');
  if (decisions.length > 0) out.ownerDecisions = decisions.slice(0, DECISIONS_MAX).map((t) => clip(guard(t), DECISION_MAX_CHARS));
  return out;
}

/** Every worker session on record, newest first. */
function sessionsOf(records: readonly Record<string, unknown>[]): readonly GovernedSessionView[] {
  return records
    .map((rec) => ({
      sessionId: str(rec, 'sessionId'),
      phaseId: str(rec, 'phaseId'),
      workerId: str(rec, 'workerId'),
      kind: str(rec, 'kind'),
      startedAt: str(rec, 'startedAt'),
      state: str(rec, 'state'),
      exitCode: typeof rec['exitCode'] === 'number' ? (rec['exitCode'] as number) : null,
    }))
    .filter((s) => s.sessionId !== '')
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/**
 * The connection picture, from credential METADATA only.
 *
 * `null` rows mean the credential router could not be reached — reported as unavailable rather than
 * as "no connections", because an installation that could not ask has learned nothing. An empty
 * ARRAY is a real answer and is reported as one.
 *
 * Status is derived, never taken from a field: a row that is absent from the OS store is MISSING
 * whatever its metadata claims; a present-but-expired one is EXPIRED; a present one ProjectOS has no
 * metadata for is UNMANAGED, which is worth surfacing because nothing recorded when it was set or
 * when it expires.
 */
function connectionsOf(
  rows: readonly Record<string, unknown>[] | null | undefined,
): GovernedConnectionsView {
  if (rows === null || rows === undefined) {
    return {
      available: false,
      detail: 'ProjectOS could not read this project’s connections on this computer.',
      connections: [],
    };
  }
  const connections: GovernedConnectionView[] = rows
    .map((row) => {
      const present = row['present'] === true;
      const status: GovernedConnectionView['status'] = !present
        ? 'MISSING'
        : row['expired'] === true
          ? 'EXPIRED'
          : row['managed'] === true
            ? 'STORED'
            : 'UNMANAGED';
      const fingerprint = str(row, 'fingerprint');
      const expiresAt = str(row, 'expiresAt');
      return {
        provider: str(row, 'provider'),
        environment: str(row, 'environment'),
        credential: str(row, 'credential'),
        reference: str(row, 'reference'),
        risk: str(row, 'risk'),
        status,
        fingerprint: fingerprint === '' ? null : fingerprint,
        expiresAt: expiresAt === '' ? null : expiresAt,
      };
    })
    .filter((c) => c.reference !== '')
    .sort((a, b) =>
      a.provider !== b.provider
        ? a.provider.localeCompare(b.provider)
        : a.environment.localeCompare(b.environment),
    );
  return { available: true, detail: '', connections };
}

export function projectGovernedState(inputs: GovernedInputs): GovernedProjection {
  const { config, plan, currentState, phaseRecords, readiness } = inputs;

  const recordById = new Map<string, Record<string, unknown>>();
  for (const rec of phaseRecords) {
    const id = str(rec, 'phaseId');
    if (id !== '') recordById.set(id, rec);
  }

  // Completion evidence, from exactly the two sources the runtime itself accepts.
  const complete = new Set<string>();
  const govBlock = (plan['governance'] as Record<string, unknown> | undefined) ?? {};
  const delBlock = govBlock['closureDelegation'] as Record<string, unknown> | undefined;
  const closureExpect = {
    projectId: typeof plan['projectId'] === 'string' ? plan['projectId'] : '',
    owner: typeof govBlock['owner'] === 'string' ? govBlock['owner'] : '',
    delegate: delBlock !== undefined && typeof delBlock['delegatedTo'] === 'string' ? delBlock['delegatedTo'] : null,
  };
  const decisions = inputs.closureDecisions ?? {};
  for (const [id, rec] of recordById) {
    const decision = (decisions[id] ?? null) as ClosureDecisionRecord | null;
    if (isOwnerClosed(rec, decision, { ...closureExpect, phaseId: id })) complete.add(id);
  }
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

  const activePhase = phases.find((p) => (ACTIVE_PHASE_STATUSES as readonly string[]).includes(p.status)) ?? null;
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
    gatekeeperStatus: gatekeeperStatusOf(
      inputs.gatekeeperConfig,
      inputs.gatekeeperLedger ?? [],
      str(config, 'projectId'),
      activePhase?.phaseId ?? '',
      inputs.observedAt,
    ),
    pendingApprovals: pendingApprovalsOf(inputs.approvalRecords ?? []),
    planDrafts: planDraftsOf(inputs.draftRecords ?? [], inputs.planDecisionRecords ?? []),
    sessions: sessionsOf(inputs.sessionRecords ?? []),
    connections: connectionsOf(inputs.credentialRows),
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
      // Judged against the SAME completion evidence that decides dependencies, so the message can
      // never disagree with the dependency arithmetic shown beside it.
      phases.length > 0 && phases.every((p) => complete.has(p.phaseId)),
    ),
    observedAt: inputs.observedAt,
  };
}

/**
 * The worker brief — everything a worker is told, and the proof that nobody added anything to it.
 *
 * WHY A BUILDER AND NOT A TEMPLATE. `projectos prompt` renders a prompt from FLAGS: whoever calls it
 * decides what the objective says. That is fine for a human composing a prompt they will read. It is
 * not fine for a loop that hands instructions to a worker with nobody reading them, because then the
 * caller — any caller — becomes an instruction channel into governed execution. So this builder takes
 * no free text at all. Every field is copied from the approved plan, the project config, or the
 * repository as observed. There is deliberately no `notes`, no `extra`, no `objective` parameter: the
 * absence is the mechanism, and `briefProvenanceProblems` is how that absence is checked rather than
 * asserted.
 *
 * BOUNDED. A brief that grows without limit is the "giant manual prompt relay" the phase exists to
 * remove, wearing a different hat. The size bound is checked at build time and the build fails rather
 * than truncating — silently dropping an acceptance criterion would ship a worker a shorter contract
 * than the owner approved.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { GovernedContext } from '../governedContext.js';
import type { RepositoryObservation } from './observation.js';

export const BRIEF_SCHEMA_VERSION = '1.0.0';

/**
 * The size bound, in characters of serialised JSON. Sized from the real recovery plan's largest
 * phase with generous headroom; a phase that genuinely exceeds it is a plan that needs splitting,
 * which is an owner decision and is reported as one.
 */
export const MAX_BRIEF_CHARS = 16_000;

export interface WorkerBrief {
  readonly schemaVersion: string;
  /** Deterministic: the same phase at the same commit always produces the same id. */
  readonly briefId: string;
  readonly generatedAt: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly repository: {
    readonly root: string;
    readonly remote: string | null;
    readonly branch: string | null;
    readonly head: string | null;
  };
  readonly plan: {
    readonly path: string;
    readonly planId: string;
    readonly planVersion: string;
  };
  readonly phase: {
    readonly phaseId: string;
    readonly description: string;
    readonly dependsOn: readonly string[];
    readonly acceptanceCriteria: readonly string[];
    readonly riskLevel: string;
    readonly autonomyLevel: string;
    readonly requiredValidators: readonly string[];
    readonly requiredReviews: readonly string[];
    readonly requiredBrowserProof: boolean;
    readonly requiredOwnerGates: readonly string[];
  };
  /**
   * Where this run's records live. The worker MUST write the two it owns, and the loop refuses to
   * certify a run that did not: an absent effects attestation is not evidence that nothing happened.
   * These are paths the loop derived, never content — they carry no instruction about the work.
   */
  readonly records: {
    readonly briefPath: string;
    readonly findingsPath: string;
    readonly effectsPath: string;
    readonly evidencePath: string;
  };
  /** The limits the worker is bound by, copied from the project config it is running under. */
  readonly boundaries: {
    readonly forbiddenActions: readonly string[];
    readonly approvalGates: readonly string[];
    readonly protectedBranches: readonly string[];
    readonly productionFreeze: boolean;
  };
}

export type BriefResult =
  | { readonly ok: true; readonly brief: WorkerBrief }
  | { readonly ok: false; readonly problems: readonly string[] };

function strings(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function planPhaseRecord(context: GovernedContext, phaseId: string): Record<string, unknown> | null {
  const phases = context.plan['phases'];
  if (!Array.isArray(phases)) return null;
  const found = phases.find(
    (p) => p !== null && typeof p === 'object' && (p as Record<string, unknown>)['phaseId'] === phaseId,
  );
  return (found as Record<string, unknown> | undefined) ?? null;
}

function planString(context: GovernedContext, key: string): string {
  const v = context.plan[key];
  return typeof v === 'string' ? v : '';
}

/** The record paths the loop derived for this run. Paths only — never content. */
export interface BriefRecordPaths {
  readonly briefPath: string;
  readonly findingsPath: string;
  readonly effectsPath: string;
  readonly evidencePath: string;
}

/**
 * Build the brief for one phase of the approved plan.
 *
 * Fails rather than improvises. A plan phase missing its description or acceptance criteria cannot
 * produce a brief, because the alternative is a worker told to do a phase whose contract is blank.
 */
export function buildWorkerBrief(
  context: GovernedContext,
  phaseId: string,
  observed: RepositoryObservation,
  now: string,
  records: BriefRecordPaths,
): BriefResult {
  const problems: string[] = [];
  const phase = planPhaseRecord(context, phaseId);
  if (phase === null) {
    return { ok: false, problems: [`phase '${phaseId}' is not in the approved plan at ${context.planPath}`] };
  }

  const description = typeof phase['description'] === 'string' ? phase['description'] : '';
  if (description.trim().length === 0) problems.push(`plan phase '${phaseId}' has no description`);
  const acceptanceCriteria = strings(phase['acceptanceCriteria']);
  if (acceptanceCriteria.length === 0) problems.push(`plan phase '${phaseId}' has no acceptance criteria`);
  const riskLevel = typeof phase['riskLevel'] === 'string' ? phase['riskLevel'] : '';
  if (riskLevel === '') problems.push(`plan phase '${phaseId}' has no riskLevel`);
  const autonomyLevel = typeof phase['autonomyLevel'] === 'string' ? phase['autonomyLevel'] : '';
  if (autonomyLevel === '') problems.push(`plan phase '${phaseId}' has no autonomyLevel`);
  if (observed.head === null) problems.push('the brief cannot be bound to a commit: HEAD is unreadable');
  if (problems.length > 0) return { ok: false, problems };

  const brief: WorkerBrief = {
    schemaVersion: BRIEF_SCHEMA_VERSION,
    briefId: `${phaseId}@${String(observed.head)}`,
    generatedAt: now,
    projectId: context.projectId,
    projectName: context.config.projectName,
    repository: {
      root: observed.root,
      remote: observed.remote,
      branch: observed.branch,
      head: observed.head,
    },
    plan: {
      path: context.planPath,
      planId: planString(context, 'planId'),
      planVersion: planString(context, 'planVersion'),
    },
    phase: {
      phaseId,
      description,
      dependsOn: strings(phase['dependsOn']),
      acceptanceCriteria,
      riskLevel,
      autonomyLevel,
      requiredValidators: strings(phase['requiredValidators']),
      requiredReviews: strings(phase['requiredReviews']),
      requiredBrowserProof: phase['requiredBrowserProof'] === true,
      requiredOwnerGates: strings(phase['requiredOwnerGates']),
    },
    records,
    boundaries: {
      forbiddenActions: context.config.forbiddenActions,
      approvalGates: context.config.approvalGates,
      protectedBranches: context.config.protectedBranches,
      productionFreeze: context.config.productionFreeze === true,
    },
  };

  const size = JSON.stringify(brief).length;
  if (size > MAX_BRIEF_CHARS) {
    return {
      ok: false,
      problems: [
        `the brief for '${phaseId}' is ${size} characters, over the ${MAX_BRIEF_CHARS} bound; ` +
          'the phase is too large to hand a worker in one piece and splitting it is an owner decision',
      ],
    };
  }
  return { ok: true, brief };
}

/**
 * Fields exempt from the provenance check: identifiers the loop mints and PATHS the loop derived.
 *
 * A path is exempt because it is addressing, not instruction — it names where a record lives and
 * says nothing about the work. The exemption is by field NAME and is deliberately narrow: any key
 * ending in `Path`, plus the four minted identifiers. Everything that could carry a sentence — a
 * description, an acceptance criterion, a boundary — is checked.
 */
const PROVENANCE_EXEMPT: ReadonlySet<string> = new Set([
  'schemaVersion',
  'briefId',
  'generatedAt',
  'root',
  'path',
]);

function isExempt(key: string): boolean {
  return PROVENANCE_EXEMPT.has(key) || key.endsWith('Path');
}

/**
 * Prove the brief invented nothing: every string it carries must also appear in the approved plan,
 * the project config, or what the loop observed of the repository.
 *
 * This is the check that makes "the builder takes no free text" verifiable instead of asserted. It
 * would catch a future edit that added an argument, a default sentence, or a helpful hint — the exact
 * change that would quietly reopen the instruction channel this design closes.
 */
export function briefProvenanceProblems(
  brief: WorkerBrief,
  context: GovernedContext,
  observed: RepositoryObservation,
): readonly string[] {
  const sources = [
    JSON.stringify(context.plan),
    JSON.stringify(context.config),
    JSON.stringify(observed),
  ].join('\n');

  const problems: string[] = [];
  const walk = (value: unknown, path: string, key: string): void => {
    if (typeof value === 'string') {
      if (isExempt(key)) return;
      if (value.length > 0 && !sources.includes(JSON.stringify(value).slice(1, -1))) {
        problems.push(`${path} carries text that is in neither the plan, the config nor the checkout: ${value}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, key));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, k);
    }
  };
  walk(brief, 'brief', 'brief');
  return problems;
}

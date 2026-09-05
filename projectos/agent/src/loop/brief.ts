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
import { PROTECTED_EFFECT_FIELDS } from './outcome.js';
import { configuredChecks } from './verification.js';

export const BRIEF_SCHEMA_VERSION = '1.0.0';

/**
 * The size bound, in characters of serialised JSON. Sized from the real recovery plan's largest
 * phase with generous headroom; a phase that genuinely exceeds it is a plan that needs splitting,
 * which is an owner decision and is reported as one.
 */
export const MAX_BRIEF_CHARS = 16_000;

/**
 * The effects-record contract, derived from the reader's own field list.
 *
 * One constant, two consumers: the brief that tells the worker, and `attestationProblems` that
 * refuses the result. Deriving rather than restating is what makes "the shape demanded IS the shape
 * described" a property of the code instead of a comment.
 */
export const EFFECTS_CONTRACT = {
  location: 'top-level',
  valueType: 'boolean',
  requiredFields: PROTECTED_EFFECT_FIELDS as readonly string[],
} as const;

/**
 * WHO RUNS THE CONFIGURED CHECKS. ProjectOS does, and the worker was never told so.
 *
 * A worker that believes it must prove the suite passes will try to run it, discover it holds no
 * shell grant, and end the attempt asking for an approval no one is there to give — which is what
 * two overnight runs did before stopping with no records written at all. The loop then paid a
 * strong-tier reviewer to observe that a local JSON file did not exist. The reviewer was not the
 * problem; the worker not knowing who runs the checks was.
 *
 * A CONSTANT, PINNED BY EQUALITY, for the same reason `EFFECTS_CONTRACT` is: it is generated rather
 * than copied from the plan, so the provenance walk cannot clear it, and exempting the subtree
 * without pinning it would open the free-text channel the walk exists to close.
 */
export const VERIFICATION_CONTRACT = { runner: 'projectos' } as const;

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
    /**
     * The SHAPE the effects record must have, not prose about it.
     *
     * THE SECOND LIVE DISCOVERY DIED HERE, AND THE FIRST ONE SURVIVED BY LUCK. The worker
     * instruction named the six fields but described them only as a list — while giving the
     * FINDINGS record an explicit object literal. So one run wrote the six at top level and was
     * certified; the next wrote the same six, truthfully, nested under `attestation`, and was
     * refused `EFFECTS_NOT_ATTESTED`. Both attested honestly; the contract was ambiguous about
     * nesting, and whether a run reached the reviewer at all turned on how the worker read a
     * sentence.
     *
     * This is derived from `PROTECTED_EFFECT_FIELDS` — the same constant the reader validates
     * against — so the shape the worker is told and the shape the loop demands cannot drift. It is
     * generated, never caller-supplied: no argument reaches it, which is why exempting it from the
     * provenance walk (see `effectsContractProblems`) is a stronger check and not a weaker one.
     */
    readonly effectsContract: {
      /** Where they go: the record's own top level, not nested under any key. */
      readonly location: 'top-level';
      /** What each value must be. */
      readonly valueType: 'boolean';
      /** Every field that must be present. */
      readonly requiredFields: readonly string[];
    };
  };
  /**
   * WHO RUNS THE CHECKS, AND WHICH ONES. See `VERIFICATION_CONTRACT`.
   *
   * `runner` is generated and pinned; `checkIds` is copied from the project config, so the
   * provenance walk covers it exactly as it covers every other copied field.
   */
  readonly verification: {
    readonly runner: 'projectos';
    readonly checkIds: readonly string[];
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
    records: { ...records, effectsContract: EFFECTS_CONTRACT },
    verification: {
      ...VERIFICATION_CONTRACT,
      // The ids only. Not the commands, and not their arguments: those are absolute paths on the
      // owner's machine, and a brief is a governance record the worker reads — it has no reason to
      // learn where the owner keeps their toolchain.
      checkIds: configuredChecks(context.config as unknown as Record<string, unknown>).checks.map((c) => c.id),
    },
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
    // The one subtree the walk cannot judge, because it is generated rather than copied. It is not
    // waved through: `effectsContractProblems` pins it to one exact value, which is a stricter test
    // than "appears somewhere in the plan". The skip is by exact PATH, so nothing else inherits it.
    if (path === 'brief.records.effectsContract') return;
    // The second generated string, and the same treatment: `verificationContractProblems` pins it to
    // one exact value, which the walk could not do because it comes from neither the plan, the
    // config nor the checkout. Skipped by exact PATH, so `brief.verification.checkIds` — which IS
    // copied from the config — is still walked.
    if (path === 'brief.verification.runner') return;
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
  return [...problems, ...effectsContractProblems(brief), ...verificationContractProblems(brief)];
}

/**
 * The verification contract is EXACTLY the generated one, and `checkIds` is exactly what the config
 * declares — or the brief is refused.
 *
 * Same argument as `effectsContractProblems`: the walk skips `brief.verification.runner`, so without
 * this the one string it cannot see would be defended by nothing. The key set is pinned too, so an
 * added key — the "helpful hint" this whole module exists to keep out — is a refusal rather than a
 * silent passenger. `checkIds` is NOT pinned here: it varies per project and the walk already proves
 * every id came from the config.
 */
export function verificationContractProblems(brief: WorkerBrief): readonly string[] {
  const v = brief.verification;
  if (v === null || typeof v !== 'object') return ['the brief states no verification contract'];
  const problems: string[] = [];
  const keys = Object.keys(v).sort();
  const expected = [...Object.keys(VERIFICATION_CONTRACT), 'checkIds'].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    problems.push(`the verification contract carries ${JSON.stringify(keys)}, not exactly ${JSON.stringify(expected)}`);
  }
  if (v.runner !== VERIFICATION_CONTRACT.runner) {
    problems.push(`the verification contract names '${String(v.runner)}' as the runner, not '${VERIFICATION_CONTRACT.runner}'`);
  }
  if (!Array.isArray(v.checkIds) || v.checkIds.some((c) => typeof c !== 'string')) {
    problems.push('the verification contract does not list the configured check ids as strings');
  }
  return problems;
}

/**
 * The effects contract is EXACTLY the generated one, or the brief is refused.
 *
 * WHY THIS EXISTS RATHER THAN A PROVENANCE EXEMPTION ON ITS OWN. The walk above proves a string came
 * from the plan, the config or the checkout. The contract comes from none of those — it is derived
 * from the reader's own constant — so the walk cannot clear it, and simply exempting the subtree
 * would open precisely the instruction channel the exemption list exists to keep shut: anything
 * could then be written under `effectsContract` and skipped.
 *
 * Equality is the stronger answer, and it has to be equality of the WHOLE object. Checking the three
 * named fields and letting anything else through would leave the one subtree the walk cannot see
 * defended by a test that does not look at what was added — which is how a "helpful hint" would get
 * into a brief with both checks reporting clean. So the key set is pinned too. Field names come from
 * `PROTECTED_EFFECT_FIELDS`, so if the reader ever demands a seventh field and this is not
 * regenerated, every brief is refused rather than quietly telling workers the old shape.
 */
export function effectsContractProblems(brief: WorkerBrief): readonly string[] {
  const c = brief.records?.effectsContract;
  if (c === null || typeof c !== 'object') return ['the brief states no effects-record contract'];
  const problems: string[] = [];
  // THE KEY SET IS PART OF THE PIN. Checking three named fields and ignoring the rest would make
  // this "a superset of three fields", not "one exact value" — and since the walk no longer looks
  // inside this subtree, an unexamined extra key is the one place in the brief where a string is
  // checked by nothing at all. That is precisely the free-text channel the walk exists to close.
  const keys = Object.keys(c).sort();
  const expected = Object.keys(EFFECTS_CONTRACT).sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    problems.push(
      `the effects contract carries ${JSON.stringify(keys)}, not exactly ${JSON.stringify(expected)}`,
    );
  }
  if (c.location !== EFFECTS_CONTRACT.location) {
    problems.push(`the effects contract states location '${String(c.location)}', not '${EFFECTS_CONTRACT.location}'`);
  }
  if (c.valueType !== EFFECTS_CONTRACT.valueType) {
    problems.push(`the effects contract states valueType '${String(c.valueType)}', not '${EFFECTS_CONTRACT.valueType}'`);
  }
  const want = [...EFFECTS_CONTRACT.requiredFields];
  const got = Array.isArray(c.requiredFields) ? [...c.requiredFields] : [];
  if (got.length !== want.length || want.some((f, i) => got[i] !== f)) {
    problems.push(
      `the effects contract lists ${JSON.stringify(got)}, not the fields the reader requires: ${JSON.stringify(want)}`,
    );
  }
  return problems;
}

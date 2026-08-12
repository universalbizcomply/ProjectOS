/**
 * Owner objective intake → NON-AUTHORITATIVE draft plan.
 *
 * This is the F3 bootstrap seam, and it is deliberately thin. ProjectOS already owns a complete
 * plan discovery/import engine — `projectos/validators/plan-discovery-engine.cjs`, the closed
 * PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A deliverable — which does bounded repository discovery,
 * source fingerprinting, authority classification, duplicate grouping, conflict detection,
 * provenance and draft generation, and which by construction NEVER returns PLAN READY. The pilot
 * found that engine had no caller anywhere outside its own validator, so an owner could not use it
 * to authorise a single new objective.
 *
 * What is added here is the missing call, not a second planner. No discovery, classification,
 * conflict or provenance logic is reimplemented; the algorithm is not copied into another stack.
 * The engine is resolved from THIS package's own URL — exactly as `governedContext.ts` already
 * resolves the governance engine — so a target project root can never redirect which engine runs.
 *
 * AUTHORITY MODEL — the whole point of the module:
 *
 *   an objective is INPUT, never authority;
 *   a draft is a PROPOSAL, never an approved plan;
 *   neither is ever written to the governed plan path;
 *   no status this module can persist is PLAN READY;
 *   nothing here creates, starts or authorises a phase.
 *
 * Text discovered in the repository, and the owner's own objective text, are treated strictly as
 * data. A document that says "approved", "PLAN READY" or "ignore governance" is content to be
 * recorded and flagged — it can never become authority, because authority is not derived from text
 * anywhere in this path.
 *
 * Created in the post-V3 self-hosting pilot (F3).
 */
import { governanceEngines } from './governanceEngines.js';
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';

/** The longest objective accepted. An objective is a paragraph of intent, not a document. */
export const MAX_OBJECTIVE_CHARS = 4000;
/** Below this an objective cannot express intent, and an empty draft would be worse than none. */
export const MIN_OBJECTIVE_CHARS = 20;

/**
 * Statuses this module is permitted to persist.
 *
 * PLAN READY is absent BY DESIGN and its absence is enforced below rather than assumed: the engine
 * does not produce it today, and if a future change ever did, persisting it here would silently
 * manufacture execution authority from an unapproved draft.
 */
export const PERSISTABLE_STATUSES: readonly string[] = [
  'NO PLAN',
  'PLAN DISCOVERED',
  'PLAN CONFLICT',
  'PLAN DRAFTED',
  'AWAITING OWNER APPROVAL',
  'PLAN BLOCKED',
];

export type IntakeRefusal =
  | 'NO_CONFIG'
  | 'MALFORMED_CONFIG'
  | 'NO_PROJECT_ID'
  | 'NO_REPOSITORY'
  | 'REPOSITORY_FACTS_UNAVAILABLE'
  | 'OBJECTIVE_MISSING'
  | 'OBJECTIVE_TOO_SHORT'
  | 'OBJECTIVE_TOO_LONG'
  | 'OBJECTIVE_NOT_TEXT'
  | 'OBJECTIVE_SECRET_SHAPED'
  | 'ENGINE_STATUS_NOT_PERSISTABLE'
  | 'OBJECTIVE_ID_UNSAFE'
  | 'DRAFT_PATH_ESCAPES_PROJECT';

export interface IntakeRefused {
  readonly ok: false;
  readonly code: IntakeRefusal;
  readonly detail: string;
}

export interface ObjectiveRecord {
  readonly schemaVersion: '1.0.0';
  readonly objectiveId: string;
  /** Owner-authored text, stored verbatim as DATA. Never parsed for instructions. */
  readonly objective: string;
  /** Always false. Present so no reader has to infer it. */
  readonly authoritative: false;
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  /** The commit the objective was submitted against — makes staleness detectable later. */
  readonly baseHead: string;
  readonly submittedAt: string;
  readonly submittedBy: 'owner';
  /**
   * True when the objective text contains instruction-shaped content ("ignore governance", …).
   * Recorded so a reviewer sees it. It changes NOTHING about what the text can do, because the text
   * can do nothing.
   */
  readonly instructionShaped: boolean;
}

export interface DraftRecord {
  readonly schemaVersion: '1.0.0';
  readonly objectiveId: string;
  readonly authoritative: false;
  /**
   * Digest of the PLAN MATERIAL in this draft — the vision, definition of complete, success
   * standard, scope, environments, phases, conflicts, owner decisions and planning sources. It is
   * what an approval is taken against, so it deliberately excludes everything an approver is not
   * approving: the generation timestamp, the commit, the branch, and the checksums of the several
   * hundred unrelated files discovery walked past. Editing an unrelated file must not invalidate an
   * approval; changing one word of the plan must.
   */
  readonly planDigest: string;
  readonly planStatus: string;
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly baseHead: string;
  readonly generatedAt: string;
  readonly generatedBy: 'projectos-runtime';
  readonly draft: Record<string, unknown>;
  readonly conflicts: readonly unknown[];
  readonly duplicates: readonly unknown[];
  readonly provenanceErrors: readonly string[];
  readonly discovery: {
    readonly rootScanned: string;
    readonly sourcesConsidered: number;
    readonly sourcesSkipped: number;
    readonly truncated: boolean;
    readonly instructionShapedSources: readonly string[];
  };
  /**
   * How the discovered corpus was divided. Reported so that narrowing what may SHAPE the plan never
   * becomes hiding what was FOUND: an owner can see that 109 historical records were read and
   * deliberately not treated as today's competing plan.
   */
  readonly planningCorpus: {
    readonly totalDiscovered: number;
    readonly counts: Record<string, number>;
    readonly currentPlanningSources: readonly string[];
  };
  /** Owner decisions the draft cannot make for itself. Empty is meaningful, not missing. */
  readonly ownerDecisionsRequired: readonly string[];
  readonly nextStep: string;
}

export interface IntakeAccepted {
  readonly ok: true;
  readonly objective: ObjectiveRecord;
  readonly draftRecord: DraftRecord;
  readonly objectivePath: string;
  readonly draftPath: string;
}

export type IntakeResult = IntakeAccepted | IntakeRefused;

export interface DiscoveryEngine {
  sha256(text: string): string;
  scanSecrets(text: string): readonly string[];
  isUntrustedInstruction(text: string): boolean;
  isSafeRepoRelativePath(p: unknown): boolean;
  discoverPlanSources(
    rootDir: string,
    opts?: unknown,
  ): {
    root: string;
    sources: readonly { relPath: string; content?: string }[];
    skipped: readonly unknown[];
    truncated: boolean;
  };
  importFromSources(
    sources: readonly unknown[],
    repoEvidence: unknown,
    options?: unknown,
  ): {
    duplicates: readonly unknown[];
    conflicts: readonly unknown[];
    draft: Record<string, unknown>;
    status: string;
    provenanceErrors: readonly string[];
    planningCorpus?: { totalDiscovered: number; counts: Record<string, number>; currentPlanningSources: readonly string[] };
  };
}

/**
 * The canonical engine, composed by the entrypoint rather than resolved from the target root.
 * Same reasoning as `governedContext.loadEngine`: the project being governed must not be able to
 * choose the code that governs it.
 */
export function loadDiscoveryEngine(): DiscoveryEngine {
  return governanceEngines().discovery as unknown as DiscoveryEngine;
}

export function objectivesDir(root: string): string {
  return join(projectopsDir(root), 'objectives');
}

export function draftsDir(root: string): string {
  return join(projectopsDir(root), 'drafts');
}

/**
 * Derive the record id, and refuse anything that is not plain lowercase hex.
 *
 * This is a filename, so it is a security boundary, not a formatting nicety. The engine's `sha256`
 * returns an ALGORITHM-PREFIXED digest (`sha256:<hex>`) — using it raw produced ids containing a
 * colon, and on Windows `drafts/sha256:abc.json` does not create that file at all: it writes an
 * NTFS alternate data stream on a file called `sha256`, so the draft silently vanished from every
 * directory listing while appearing to have been written. Caught by the idempotence test.
 *
 * The prefix is stripped and the remainder is then CHECKED rather than trusted, so a future change
 * to the digest format fails closed instead of reintroducing a path-shaped id.
 */
function deriveObjectiveId(
  engine: DiscoveryEngine,
  projectId: string,
  objective: string,
): string | null {
  // A unit separator cannot appear in either input, so distinct pairs cannot collide by
  // concatenation.
  //
  // The base commit is deliberately NOT part of the identity. It was, and the consequence was that
  // the SAME owner objective became a new objective after every commit: each run left another
  // tracked record behind, and the one the owner had actually submitted was orphaned by the next
  // commit. What is bound to a commit is the DRAFT — that is where staleness has to be detectable.
  // An objective is what the owner wants; re-submitting it later refreshes its draft in place.
  const sep = String.fromCharCode(31);
  const digest = engine.sha256(`${projectId}${sep}${objective}`);
  const hex = digest.includes(':') ? digest.slice(digest.lastIndexOf(':') + 1) : digest;
  const id = hex.slice(0, 16);
  return /^[0-9a-f]{16}$/.test(id) ? id : null;
}

/**
 * The plan material an approval is taken against, in a fixed order so the digest is deterministic.
 *
 * Every field here is something the approver read. Everything omitted — `generatedAt`, `baseHead`,
 * `branch`, the duplicate groups, the per-source checksums of the whole repository — is either not a
 * plan decision or would make the digest change when an unrelated file is edited, which would turn
 * "your approval is stale" into noise and train everyone to re-approve without reading.
 */
export function planMaterial(
  draft: Pick<DraftRecord, 'planStatus' | 'projectId' | 'repository' | 'draft' | 'ownerDecisionsRequired' | 'planningCorpus'>,
): string {
  const d = draft.draft;
  const pick = (k: string): unknown => d[k] ?? null;
  return JSON.stringify([
    ['planStatus', draft.planStatus],
    ['projectId', draft.projectId],
    ['repository', draft.repository],
    ['projectIdCandidate', pick('projectIdCandidate')],
    ['businessVision', pick('businessVision')],
    ['definitionOfComplete', pick('definitionOfComplete')],
    ['successStandard', pick('successStandard')],
    ['approvedScopeCandidates', pick('approvedScopeCandidates')],
    ['excludedScopeCandidates', pick('excludedScopeCandidates')],
    ['environmentCandidates', pick('environmentCandidates')],
    ['phaseCandidates', pick('phaseCandidates')],
    ['conflicts', pick('conflicts')],
    ['unresolvedUnknowns', pick('unresolvedUnknowns')],
    ['ownerDecisionsRequired', draft.ownerDecisionsRequired],
    ['currentPlanningSources', draft.planningCorpus.currentPlanningSources],
  ]);
}

/** Trim and normalise line endings. Content is NEVER otherwise rewritten. */
function normaliseObjective(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/**
 * A git fact, or null.
 *
 * It FAILS CLOSED. An earlier version substituted the string "unknown", which quietly defeated the
 * thing `baseHead` exists for: staleness is detected by comparing it, and two genuinely different
 * repository states both recorded as "unknown" compare equal. `system.ts` states the same rule for
 * the bound-git hardening — when nothing binds, every fact derived from git fails closed.
 */
function gitFact(sys: System, args: readonly string[]): string | null {
  const r = sys.exec('git', args);
  if (r.code !== 0) return null;
  const out = r.stdout.trim();
  return out === '' ? null : out;
}

function readConfig(sys: System, root: string): { ok: true; value: Record<string, unknown> } | { ok: false; code: 'NO_CONFIG' | 'MALFORMED_CONFIG' } {
  const path = join(projectopsDir(root), 'project-config.json');
  const text = sys.readText(path);
  if (text === null) return { ok: false, code: 'NO_CONFIG' };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, code: 'MALFORMED_CONFIG' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, code: 'MALFORMED_CONFIG' };
  }
}

function str(o: Record<string, unknown> | undefined, k: string): string {
  const v = o?.[k];
  return typeof v === 'string' ? v : '';
}

/**
 * Validate the owner's objective as INPUT.
 *
 * Secret-shaped content is refused outright rather than stored-and-redacted. Storing it, even
 * redacted, means the raw value reached a durable file first; refusing means it never does. The
 * refusal names the pattern class, never the value.
 */
export function checkObjective(engine: DiscoveryEngine, raw: unknown): IntakeRefused | { ok: true; objective: string } {
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'OBJECTIVE_MISSING', detail: 'no objective was supplied' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'OBJECTIVE_NOT_TEXT', detail: 'an objective must be text' };
  }
  const objective = normaliseObjective(raw);
  if (objective.length === 0) {
    return { ok: false, code: 'OBJECTIVE_MISSING', detail: 'the objective is empty' };
  }
  if (objective.length < MIN_OBJECTIVE_CHARS) {
    return {
      ok: false,
      code: 'OBJECTIVE_TOO_SHORT',
      detail: `an objective must be at least ${MIN_OBJECTIVE_CHARS} characters; got ${objective.length}`,
    };
  }
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    return {
      ok: false,
      code: 'OBJECTIVE_TOO_LONG',
      detail: `an objective must be at most ${MAX_OBJECTIVE_CHARS} characters; got ${objective.length}`,
    };
  }
  const secrets = engine.scanSecrets(objective);
  if (secrets.length > 0) {
    return {
      ok: false,
      code: 'OBJECTIVE_SECRET_SHAPED',
      detail: `the objective looks like it contains a secret (${secrets.join(', ')}); it was NOT stored. Remove it and resubmit.`,
    };
  }
  return { ok: true, objective };
}

/**
 * Submit an owner objective and generate a non-authoritative draft.
 *
 * Deterministic: the same objective and project produce the same `objectiveId` and therefore rewrite
 * the same two records rather than accumulating duplicates.
 */
/** What a run of the engine against this repository produced, before anything is written down. */
export interface Proposal {
  readonly ok: true;
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly baseHead: string;
  readonly planDigest: string;
  readonly status: string;
  readonly imported: ReturnType<DiscoveryEngine['importFromSources']>;
  readonly found: ReturnType<DiscoveryEngine['discoverPlanSources']>;
  readonly ownerDecisionsRequired: readonly string[];
  readonly planningCorpus: NonNullable<ReturnType<DiscoveryEngine['importFromSources']>['planningCorpus']>;
}

/**
 * Run discovery and import against the repository AS IT IS NOW, and return the proposal.
 *
 * Read-only, and shared by the two callers that must not disagree: the one that records a draft, and
 * the one that later checks whether an approval still describes this repository. If approval
 * recomputed the digest by a different route the two could drift, and an approval would be validated
 * against something nobody proposed.
 */
export function buildProposal(sys: System, root: string, engine: DiscoveryEngine): Proposal | IntakeRefused {
  const cfg = readConfig(sys, root);
  if (!cfg.ok) {
    return {
      ok: false,
      code: cfg.code,
      detail:
        cfg.code === 'NO_CONFIG'
          ? 'no .projectops/project-config.json — ProjectOS is not installed in this repository'
          : '.projectops/project-config.json is not valid JSON',
    };
  }
  const projectId = str(cfg.value, 'projectId');
  if (projectId === '') {
    return { ok: false, code: 'NO_PROJECT_ID', detail: 'project-config.json declares no projectId' };
  }

  const branch = gitFact(sys, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const baseHead = gitFact(sys, ['rev-parse', 'HEAD']);
  if (branch === null || baseHead === null) {
    return {
      ok: false,
      code: 'REPOSITORY_FACTS_UNAVAILABLE',
      detail:
        'could not establish the current branch and commit from git; a draft with no verifiable base cannot be checked for staleness later',
    };
  }
  const repository = str(cfg.value, 'repo');
  if (repository === '') {
    return {
      ok: false,
      code: 'NO_REPOSITORY',
      detail:
        'project-config.json declares no repo; a draft with no recorded repository cannot be bound to one later',
    };
  }

  // Discovery is the ENGINE's, bounded by the engine's own limits, rooted at the project only.
  //
  // The repository evidence goes in HERE as well as into the import. Discovery classifies authority
  // as it walks, and without being told whose project this is it has to guess the dominant identity
  // from the documents themselves — which against this repository meant a test fixture's projectId
  // won, and every genuine planning source was marked identity-mismatched before the truth arrived.
  const repoEvidence = { repo: repository, branch, head: baseHead, projectId };
  const found = engine.discoverPlanSources(root, { repoEvidence });
  const imported = engine.importFromSources(found.sources, repoEvidence, {});

  // Defence in depth. The engine does not return PLAN READY today; if it ever did, persisting it
  // would turn an unapproved draft into execution authority, so this fails closed instead.
  if (!PERSISTABLE_STATUSES.includes(imported.status)) {
    return {
      ok: false,
      code: 'ENGINE_STATUS_NOT_PERSISTABLE',
      detail: `refusing to persist a draft with status '${imported.status}' — only a non-authoritative status may be recorded here`,
    };
  }

  const ownerDecisions = Array.isArray(imported.draft['ownerDecisionsRequired'])
    ? (imported.draft['ownerDecisionsRequired'] as readonly string[])
    : [];
  const planningCorpus = imported.planningCorpus ?? {
    totalDiscovered: found.sources.length,
    counts: {},
    currentPlanningSources: [],
  };

  return {
    ok: true,
    projectId,
    repository,
    branch,
    baseHead,
    planDigest: engine.sha256(
      planMaterial({
        planStatus: imported.status,
        projectId,
        repository,
        draft: imported.draft,
        ownerDecisionsRequired: ownerDecisions,
        planningCorpus,
      }),
    ),
    status: imported.status,
    imported,
    found,
    ownerDecisionsRequired: ownerDecisions,
    planningCorpus,
  };
}

export function submitObjective(
  sys: System,
  root: string,
  rawObjective: unknown,
  /**
   * Test seam ONLY, and deliberately not exposed by any command. It exists so the
   * `ENGINE_STATUS_NOT_PERSISTABLE` refusal — the one guard whose whole purpose is to survive a
   * future engine change — can be driven at all. Without it that branch is unreachable and
   * therefore unproven, which is exactly the state a defence-in-depth check must not be left in.
   */
  engineOverride?: DiscoveryEngine,
): IntakeResult {
  const engine = engineOverride ?? loadDiscoveryEngine();

  const checked = checkObjective(engine, rawObjective);
  if (!checked.ok) return checked;
  const objective = checked.objective;

  const proposal = buildProposal(sys, root, engine);
  if (!proposal.ok) return proposal;
  const { projectId, repository, branch, baseHead, imported, found } = proposal;

  const objectiveId = deriveObjectiveId(engine, projectId, objective);
  if (objectiveId === null) {
    return {
      ok: false,
      code: 'OBJECTIVE_ID_UNSAFE',
      detail: 'could not derive a filesystem-safe objective id from this objective',
    };
  }
  const now = sys.now();

  const objectiveRecord: ObjectiveRecord = {
    schemaVersion: '1.0.0',
    objectiveId,
    objective,
    authoritative: false,
    projectId,
    repository,
    branch,
    baseHead,
    submittedAt: now,
    submittedBy: 'owner',
    instructionShaped: engine.isUntrustedInstruction(objective),
  };

  const instructionShapedSources = found.sources
    .filter((s) => typeof s.content === 'string' && engine.isUntrustedInstruction(s.content))
    .map((s) => s.relPath);

  const draftRecord: DraftRecord = {
    schemaVersion: '1.0.0',
    objectiveId,
    authoritative: false,
    planDigest: proposal.planDigest,
    planStatus: proposal.status,
    projectId,
    repository,
    branch,
    baseHead,
    generatedAt: now,
    generatedBy: 'projectos-runtime',
    draft: imported.draft,
    conflicts: imported.conflicts,
    duplicates: imported.duplicates,
    provenanceErrors: imported.provenanceErrors,
    discovery: {
      rootScanned: found.root,
      sourcesConsidered: found.sources.length,
      sourcesSkipped: found.skipped.length,
      truncated: found.truncated,
      instructionShapedSources,
    },
    planningCorpus: proposal.planningCorpus,
    ownerDecisionsRequired: proposal.ownerDecisionsRequired,
    nextStep:
      'This is a PROPOSAL. It authorises nothing. An owner must approve it before any phase may start.',
  };

  const objectivePath = join(objectivesDir(root), `${objectiveId}.json`);
  const draftPath = join(draftsDir(root), `${objectiveId}.json`);

  // Neither record may land outside `.projectops/` — and specifically never on a governed plan
  // path. Checked rather than trusted, because the id is derived from owner-supplied text.
  const guard = projectopsDir(root);
  if (!objectivePath.startsWith(`${guard}/`) || !draftPath.startsWith(`${guard}/`)) {
    return {
      ok: false,
      code: 'DRAFT_PATH_ESCAPES_PROJECT',
      detail: 'refusing to write an intake record outside .projectops/',
    };
  }

  sys.writeText(objectivePath, `${JSON.stringify(objectiveRecord, null, 2)}\n`);
  sys.writeText(draftPath, `${JSON.stringify(draftRecord, null, 2)}\n`);

  return { ok: true, objective: objectiveRecord, draftRecord, objectivePath, draftPath };
}

/**
 * Check a persisted draft against the identity it must still match before anyone acts on it.
 *
 * A draft is a file. Files get copied between checkouts, and a repository moves on after one is
 * generated — so the binding recorded at generation time has to be re-verified, not trusted. This
 * is the check the eventual approval step must run: a draft that was generated for another project,
 * another repository, or an older commit is refused rather than quietly applied.
 *
 * Returns problems, empty when the draft still matches. It decides nothing and grants nothing.
 */
export function checkDraftBinding(
  draft: Pick<DraftRecord, 'projectId' | 'repository' | 'baseHead' | 'planStatus' | 'authoritative'>,
  expected: { readonly projectId: string; readonly repository: string; readonly head: string },
): readonly string[] {
  const problems: string[] = [];
  if (draft.projectId !== expected.projectId) {
    problems.push(
      `draft was generated for project '${draft.projectId}', not '${expected.projectId}'`,
    );
  }
  // Unknown provenance is NOT agreement. `'' !== ''` is false, so equality alone would let a draft
  // with no recorded repository match an expectation with no recorded repository — two different
  // checkouts sharing a projectId would then silently agree. The empty case is refused explicitly.
  if (draft.repository === '' || expected.repository === '') {
    problems.push('repository provenance is missing on the draft or the target; that is not a match');
  } else if (draft.repository !== expected.repository) {
    problems.push(
      `draft was generated against repository '${draft.repository || '(none recorded)'}', not '${expected.repository}'`,
    );
  }
  if (draft.baseHead !== expected.head) {
    problems.push(
      `draft is STALE: generated at ${draft.baseHead.slice(0, 12)}, repository is now at ${expected.head.slice(0, 12)}`,
    );
  }
  if (draft.authoritative !== false) {
    problems.push('draft claims to be authoritative; a draft never is');
  }
  if (!PERSISTABLE_STATUSES.includes(draft.planStatus)) {
    problems.push(`draft carries a status it could never legitimately hold: '${draft.planStatus}'`);
  }
  return problems;
}

/** List persisted drafts, newest-generated first. Read-only. */
export function listDrafts(sys: System, root: string): readonly DraftRecord[] {
  const dir = draftsDir(root);
  if (!sys.exists(dir)) return [];
  const out: DraftRecord[] = [];
  for (const name of sys.listDir(dir)) {
    if (!name.endsWith('.json')) continue;
    const text = sys.readText(join(dir, name));
    if (text === null) continue;
    try {
      out.push(JSON.parse(text) as DraftRecord);
    } catch {
      // A malformed record is skipped rather than crashing the listing. It is still on disk for a
      // human to look at; pretending it parsed would be worse.
    }
  }
  return out.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : 0));
}

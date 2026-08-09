/**
 * Derive the G4 closure facts from the repository and the runtime.
 *
 * The rule this file exists to enforce: **a fact asserted by whoever wants the closure is not
 * evidence.** Nothing here reads a field off the closure request. Everything is either computed live
 * (project identity, plan readiness, phase state, git reconciliation, working-tree cleanliness) or
 * read from a durable, HEAD-BOUND evidence record that some earlier, separate step had to write.
 *
 * The evidence record deliberately cannot be satisfied by intent. It carries the commit it was
 * established against, and `evaluateClosureEligibility` refuses when that commit is not the one being
 * closed — so a record written before the work changed is stale rather than convenient.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import type { GovernedContext } from './governedContext.js';
import type { G4Facts, G4Verdict } from '@projectos/core';
import { evaluateClosureEligibility } from '@projectos/core';

/** Where the durable closure-evidence record for a phase lives. */
export function closureEvidencePath(root: string, phaseId: string): string {
  return join(projectopsDir(root), 'closure', `${phaseId}.json`);
}

/**
 * The durable evidence a closure needs and the runtime cannot compute for itself: whether the
 * validators and checks passed, whether reviews are complete, how many CRITICAL/HIGH findings remain,
 * and whether the required headed proof passed — each bound to the commit it was established at.
 */
interface ClosureEvidenceRecord {
  readonly phaseId?: unknown;
  readonly establishedAtHead?: unknown;
  readonly validatorsPass?: unknown;
  readonly checksPass?: unknown;
  readonly reviewsComplete?: unknown;
  readonly unresolvedCriticalOrHigh?: unknown;
  readonly headedProofPass?: unknown;
}

function readJson(sys: System, path: string): Record<string, unknown> | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `git` facts, computed live. Any failure is reported as NOT reconciled — never assumed clean. */
function gitFacts(sys: System, root: string): {
  head: string | null;
  reconciled: boolean;
  clean: boolean;
} {
  const rev = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const head = rev.code === 0 && /^[0-9a-f]{40}$/.test(rev.stdout.trim()) ? rev.stdout.trim() : null;
  const status = sys.exec('git', ['-C', root, 'status', '--porcelain']);
  const clean = status.code === 0 && status.stdout.trim() === '';
  // Reconciled means the local branch and its upstream point at the same commit.
  const counts = sys.exec('git', ['-C', root, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  const reconciled = counts.code === 0 && /^0\s+0$/.test(counts.stdout.trim());
  return { head, reconciled, clean };
}

/** Does a durable evidence report for this phase exist under the project's reports directory? */
function evidenceReportPresent(sys: System, root: string, phaseId: string): boolean {
  const dir = join(root, 'knowledge', 'reports');
  return sys.listDir(dir).some((f) => f.includes(phaseId) && f.endsWith('.md'));
}

/** Whether any protected effect was recorded for the active session. */
function protectedEffectOccurred(sys: System, context: GovernedContext, root: string): boolean {
  const statePath = context.currentStatePath;
  if (statePath === null) return false;
  const session = readJson(sys, join(root, 'projectos', 'state', 'projectos-v3.session.json'));
  if (session === null) return false;
  return (
    session['productionTouched'] === true ||
    session['deploymentOccurred'] === true ||
    session['databaseMutationOccurred'] === true ||
    session['externalSendOccurred'] === true ||
    session['paymentOccurred'] === true ||
    session['rawSecretStored'] === true
  );
}

interface PlanPhase {
  readonly phaseId: string;
  readonly requiredBrowserProof?: boolean;
}

/**
 * Gather the facts and evaluate the gate.
 *
 * `authorityAssertedByCaller` is a parameter because only the caller knows whether the request tried
 * to supply an identity or role — and if it did, that alone fails G4-15.
 */
export function evaluateG4(
  sys: System,
  root: string,
  context: GovernedContext,
  phaseId: string,
  phaseStatus: string,
  planReady: { ready: boolean; reasons: readonly string[] },
  delegationValidForProject: boolean,
  authorityAssertedByCaller: boolean,
): { facts: G4Facts; verdict: G4Verdict } {
  const plan = context.plan;
  const phases = Array.isArray(plan['phases']) ? (plan['phases'] as readonly PlanPhase[]) : [];
  const planPhase = phases.find((p) => p.phaseId === phaseId);
  const git = gitFacts(sys, root);

  const evidence = (readJson(sys, closureEvidencePath(root, phaseId)) ?? {}) as ClosureEvidenceRecord;
  // The record must name the phase it is about; one written for another phase is not evidence here.
  const boundPhase = typeof evidence.phaseId === 'string' ? evidence.phaseId : '';
  const evidenceHead = typeof evidence.establishedAtHead === 'string' ? evidence.establishedAtHead : null;

  const facts: G4Facts = {
    governedProjectId: context.projectId,
    planProjectId: typeof plan['projectId'] === 'string' ? plan['projectId'] : '',
    activePlanVersion: typeof plan['planVersion'] === 'string' ? plan['planVersion'] : '',
    planReady: planReady.ready,
    planUnmetReasons: planReady.reasons,
    phaseId,
    phaseInActivePlan: planPhase !== undefined,
    phaseStatus,
    validatorsPass: boolOrNull(evidence.validatorsPass),
    checksPass: boolOrNull(evidence.checksPass),
    evidenceReportPresent: evidenceReportPresent(sys, root, phaseId),
    headedProofRequired: planPhase?.requiredBrowserProof === true,
    headedProofPass: boolOrNull(evidence.headedProofPass),
    reviewsComplete: boolOrNull(evidence.reviewsComplete),
    unresolvedCriticalOrHigh: numOrNull(evidence.unresolvedCriticalOrHigh),
    protectedEffectOccurred: protectedEffectOccurred(sys, context, root),
    implementationHead: git.head,
    remoteReconciled: git.reconciled,
    workingTreeClean: git.clean,
    delegationValidForProject,
    authorityAssertedByCaller,
    decisionBoundToPhaseId: boundPhase,
    evidenceHead,
  };

  return { facts, verdict: evaluateClosureEligibility(facts) };
}

/** Render an unmet gate for the CLI: every outstanding predicate, named. */
export function g4RefusalLines(verdict: G4Verdict): readonly string[] {
  return [
    `REFUSED (G4_NOT_SATISFIED): ${verdict.unmet.length} predicate(s) unmet for delegated closure:`,
    ...verdict.unmet.map((u) => `  ${u.code}: ${u.detail}`),
  ];
}

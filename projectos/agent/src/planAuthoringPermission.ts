/**
 * A project's committed permission to have a plan AUTHORED for it.
 *
 * WHY THIS RECORD EXISTS AT ALL. The gatekeeper's second factor is a phase receipt: the owner
 * approved credential use for THIS phase, reviewing THIS commit. Plan authoring runs before any phase
 * exists — that is the whole point of it — so it can satisfy no phase-scoped gate, and the honest
 * options were to invent a fake phase or to ask the same question at the only scope that does exist.
 * A fake phase would have been a lie the rest of the system then had to believe; this is the scope.
 *
 * WHAT IT IS AND IS NOT. It permits the generation of a NON-AUTHORITATIVE PLAN PROPOSAL and nothing
 * else. It approves no plan, activates nothing, starts no phase, and confers no protected authority
 * whatsoever. Those refusals are not merely stated here: authoring produces plan MATERIAL, and every
 * route from material to authority still runs through `approvePlan`, a committed owner decision, and
 * the plan-ready evaluator, none of which this record touches.
 *
 * THE TRUSTED SIDE IS THE ONE THAT DECIDES. `gatekeeper-transport-broker.cjs` reads this record from
 * the governed project's git object store and refuses independently. What is here is the SAME check
 * on the untrusted side, for one reason only: so a refusal can be reported to the owner as a call
 * that was never made, rather than arriving down the same channel as a mid-flight failure and being
 * conservatively billed. That is exactly why `installationAllows` is asked twice on the gatekeeper
 * path, and the same argument applies unchanged here.
 *
 * COMMITTED, OR IT IS NOTHING. Read with `git show HEAD:./…`. A working-tree permission has no
 * authority — under this programme's `tamperProof: false` model the commit is the boundary, and a
 * permission nobody committed is a permission nobody reviewed.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import type { System } from './system.js';

/** Where the permission lives inside the governed project. */
export const PLAN_AUTHORING_PERMISSION_REL = '.projectops/authority/plan-authoring-permission.json';

/** The one capability this record may carry. A record naming another capability is about something else. */
export const PLAN_AUTHORING_CAPABILITY = 'plan-authoring';

export const PLAN_AUTHORING_PERMISSION_SCHEMA_VERSION = '1.0.0';

/**
 * The installation's own ceiling on authoring calls per project.
 *
 * MIRRORED FROM THE BROKER, NOT IMPORTED FROM IT. The broker is a `.cjs` executed as verified bytes
 * with no module identity, so there is nothing to import; the number is asserted equal on both sides
 * by `val-projectos-trust-boundary1a` instead. A permission may lower this and may never raise it.
 */
export const PLAN_AUTHORING_CALL_CEILING = 20;

/**
 * The shape a credential reference must take. Identical to the broker's `REF_SHAPE` and to
 * `credentialResolver`'s, for the same reason all three exist: a reference is a NAME.
 */
const REF_SHAPE = /^[A-Z][A-Z0-9_]{7,63}$/;

export interface AuthoringPermissionDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  /** The effective per-project call ceiling, once the record's own request is clamped. Null when refused. */
  readonly maxCallsPerProject: number | null;
}

function refuse(reasons: readonly string[]): AuthoringPermissionDecision {
  return { allowed: false, reasons, maxCallsPerProject: null };
}

/**
 * Read the record from the COMMITTED blob at HEAD, never from the working tree.
 *
 * "Is it committed?" and "what does it say?" have to be the same question — `readCommittedJson` in
 * `planApproval.ts` carries the full argument, and this is the same read for the same reason. `-C root`
 * and `./` are both load-bearing: without them the repository answering is whichever one the ambient
 * working directory sits in, and the path resolves against that repository's top rather than this root.
 */
function readCommitted(sys: System, root: string, rel: string): Record<string, unknown> | null {
  const r = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  if (r.code !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * May a plan be authored for this project with this credential reference?
 *
 * Every failure is a refusal with a reason the owner can act on: absent, uncommitted, unreadable,
 * malformed, foreign, for another capability, about another credential, or silent about protected
 * actions. There is no path that returns `allowed: true` on a doubt.
 */
export function checkPlanAuthoringPermission(
  sys: System,
  root: string,
  expect: { readonly projectId: string; readonly credentialRef: string },
): AuthoringPermissionDecision {
  const record = readCommitted(sys, root, PLAN_AUTHORING_PERMISSION_REL);
  if (record === null) {
    return refuse([
      `this project commits no plan-authoring permission (${PLAN_AUTHORING_PERMISSION_REL}), so ProjectOS ` +
        'will not spend the installation credential to author a plan for it',
      'the owner grants this once, per project, by committing that record; it authorises a NON-AUTHORITATIVE ' +
        'proposal and nothing else',
    ]);
  }

  const reasons: string[] = [];
  if (record['schemaVersion'] !== PLAN_AUTHORING_PERMISSION_SCHEMA_VERSION) {
    reasons.push(
      `the plan-authoring permission declares schemaVersion ${JSON.stringify(record['schemaVersion'])}, ` +
        `expected ${JSON.stringify(PLAN_AUTHORING_PERMISSION_SCHEMA_VERSION)}`,
    );
  }
  if (record['capability'] !== PLAN_AUTHORING_CAPABILITY) {
    reasons.push(
      `the committed permission authorises capability ${JSON.stringify(record['capability'])}, not ` +
        `'${PLAN_AUTHORING_CAPABILITY}'; a permission for something else is not this one`,
    );
  }
  if (record['projectId'] !== expect.projectId) {
    reasons.push(
      `the committed permission is for project ${JSON.stringify(record['projectId'])}, not ` +
        `'${expect.projectId}' — a permission carried into another checkout authorises nothing there`,
    );
  }
  const ref = record['credentialRef'];
  if (ref !== expect.credentialRef) {
    reasons.push(
      `the committed permission is about a different credential reference than the one configured for ` +
        'this project, so it does not authorise this call',
    );
  }
  // A REFERENCE, NEVER A VALUE. The refusal deliberately does not repeat what it found: this is the
  // one check whose entire purpose is that configuration must not hold a secret, and the sibling
  // `credentialRefProblems` already learned the cost of echoing the value on exactly that path.
  if (typeof ref !== 'string' || !REF_SHAPE.test(ref)) {
    reasons.push(
      'the committed permission names something that is not a credential reference (UPPER_SNAKE_CASE, ' +
        '8 to 64 characters); ProjectOS configuration names a credential and never holds one',
    );
  }
  if (record['excludesProtectedActions'] !== true) {
    reasons.push(
      'the committed permission does not set excludesProtectedActions to true, and a permission silent ' +
        'about protected actions is not one ProjectOS will act on',
    );
  }
  const grantedBy = record['grantedBy'];
  if (typeof grantedBy !== 'string' || grantedBy.trim() === '') {
    reasons.push('the committed permission names nobody who granted it');
  }

  if (reasons.length > 0) return refuse(reasons);

  // THE RECORD MAY LOWER THE CEILING AND MAY NEVER RAISE IT. A committed record that sets its own
  // limit is still a record somebody wrote; the installation's number is the one that binds.
  const asked = record['maxCallsPerProject'];
  const ceiling =
    typeof asked === 'number' && Number.isFinite(asked) && asked > 0
      ? Math.min(Math.floor(asked), PLAN_AUTHORING_CALL_CEILING)
      : PLAN_AUTHORING_CALL_CEILING;

  return { allowed: true, reasons: [], maxCallsPerProject: ceiling };
}

/**
 * `projectos stop` — THE OWNER'S PLATFORM-WIDE EMERGENCY STOP (PROJECTOS-KERNEL-PLATFORM-STOP1A).
 *
 *   projectos stop [engage] [--reason "<text>"] [--by "<name>"]   engage it; needs no authority
 *   projectos stop status                                          show the record and what it cannot undo
 *   projectos stop lift --stop <stopId>                            lift it; owner only, in two steps
 *
 * ENGAGING NEEDS NOTHING, BECAUSE STOPPING IS ALWAYS SAFE — the same reasoning that lets the owner
 * bridge's `stop-work` run without authority. `--by` is recorded as exactly what it is: an
 * unauthenticated claim about who pressed the button.
 *
 * LIFTING NEEDS THE OWNER, IN PERSON, AND A FLAG IS NOT THE OWNER (ADR-K1 R7). The only evidence this
 * module accepts is an owner-authored git commit of a lift record naming the engaged stop — the same
 * shape as `closure request` then `closure resume`:
 *
 *   1. `stop lift --stop <id>` writes `.projectops/stop-lifts/<id>.json`, uncommitted, and says so.
 *   2. The owner commits that one file under their own git identity.
 *   3. `stop lift --stop <id>` again verifies the record is committed, unchanged since, names the engaged
 *      stop, and that the commit's identity is the approved plan's owner — with NO delegated committer, so
 *      the ProjectOS implementer identity can never stand in, whatever any delegation grants. Only then is
 *      the stop recorded as lifted.
 *
 * `--as owner` changes nothing here. It is not read, and saying "the owner" on a command line is the
 * assertion R7 exists to refuse.
 *
 * WHAT IT WRITES: the stop record in the installation state directory, and the one lift record in the
 * governed project. Nothing else, and no commit or push of its own — the owner's commit IS the lift.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail, join } from '../context.js';
import { type Flags, str } from '../flags.js';
import { loadGovernedContext } from '../governedContext.js';
import { committedGovernanceOwner } from '../loop/degradedMode.js';
import { commitIdentityOf, ownerCommitIdentityProblems } from '../closureWait.js';
import { resolveBoundGit } from '../system.js';
import {
  PLATFORM_STOP_SCHEMA_VERSION,
  PLATFORM_STOP_STATEMENT,
  STOP_LIFT_KIND,
  engagePlatformStop,
  isStopId,
  platformStopDirOf,
  platformStopStatusLines,
  readPlatformStop,
  recordPlatformStopLift,
  stopLiftRelPath,
} from '../loop/platformStop.js';
import type { System } from '../system.js';

const USAGE: readonly string[] = [
  'Usage:',
  '  projectos stop [engage] [--reason "<text>"] [--by "<name>"]  engage the platform-wide emergency stop',
  '  projectos stop status                                        show the stop record',
  '  projectos stop lift --stop <stopId>                          lift it (owner only, by an owner-authored commit)',
];

export function stop(ctx: CommandContext, flags: Flags, positionals: readonly string[]): CommandResult {
  const sub = positionals[0] ?? 'engage';
  switch (sub) {
    case 'engage':
      return engage(ctx, flags);
    case 'status':
      return ok(platformStopStatusLines(ctx.sys, platformStopDirOf(ctx)));
    case 'lift':
      return lift(ctx, flags);
    default:
      return fail(1, [`Unknown 'stop' subcommand: ${sub}`, '', ...USAGE]);
  }
}

function engage(ctx: CommandContext, flags: Flags): CommandResult {
  const outcome = engagePlatformStop(ctx.sys, platformStopDirOf(ctx), { reason: str(flags, 'reason'), engagedBy: str(flags, 'by') });
  return outcome.kind === 'FAILED' ? fail(2, outcome.lines) : ok(outcome.lines);
}

/** What git says about the lift record: never committed, committed but changed since, or committed as is. */
type LiftRecordState = 'uncommitted' | 'dirty' | 'committed' | 'git-failed';

function liftRecordState(sys: System, root: string, rel: string): { readonly state: LiftRecordState; readonly commit: string } {
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0) return { state: 'git-failed', commit: '' };
  const commit = logged.stdout.trim();
  if (commit === '') return { state: 'uncommitted', commit: '' };
  // COMMITTED IS NOT ENOUGH: a committed record edited since would let the committed bytes launder an
  // uncommitted change — the same two questions `receiptIsCommitted` asks of an owner gate receipt.
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0) return { state: 'git-failed', commit };
  return { state: dirty.stdout.trim() === '' ? 'committed' : 'dirty', commit };
}

/** The lift record AS COMMITTED, read from the git object — never the working file. */
function committedLiftRecord(sys: System, root: string, rel: string): Record<string, unknown> | null {
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(shown.stdout);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function liftRequestText(stopId: string, at: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: PLATFORM_STOP_SCHEMA_VERSION,
      kind: STOP_LIFT_KIND,
      stopId,
      requestedAt: at,
      effect:
        `Committing this one file under the owner's own git identity, then running ` +
        `\`projectos stop lift --stop ${stopId}\` again, lifts the platform-wide emergency stop ${stopId}.`,
      statement: PLATFORM_STOP_STATEMENT,
    },
    null,
    2,
  )}\n`;
}

function asIgnored(flags: Flags): readonly string[] {
  return flags['as'] === undefined ? [] : ['  - `--as` was given and was ignored: a command-line role is not evidence of the owner'];
}

function lift(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const stopId = str(flags, 'stop');
  if (!isStopId(stopId)) {
    return fail(1, ['`stop lift` requires --stop <stopId>, exactly as `projectos stop status` prints it.', ...asIgnored(flags)]);
  }
  const stateDir = platformStopDirOf(ctx);
  const read = readPlatformStop(sys, stateDir);
  if (read.kind === 'unresolvable' || stateDir === null) {
    return fail(2, ['REFUSED (PLATFORM_STOP_UNVERIFIABLE): no state directory could be resolved, so no stop can be lifted.', PLATFORM_STOP_STATEMENT]);
  }
  if (read.kind === 'absent') return fail(1, [`No platform stop is engaged; there is nothing to lift (${stopId}).`]);
  if (read.kind === 'unreadable') {
    return fail(2, [
      `REFUSED (PLATFORM_STOP_UNREADABLE): the stop record at ${read.path} cannot be trusted (${read.why}).`,
      '  a record that cannot be read cannot be lifted; it must be repaired by hand, and until then the platform stays stopped',
      PLATFORM_STOP_STATEMENT,
    ]);
  }
  if (read.record.state === 'lifted' && read.record.liftedStopId === stopId) {
    return ok([`Platform stop ${stopId} was already lifted, by commit ${read.record.liftCommit ?? '?'}.`]);
  }
  if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {
    return fail(2, [
      `REFUSED (STOP_MISMATCH): ${stopId} is not the engaged stop${read.record.state === 'engaged' ? `; the engaged stop is ${read.record.stopId}` : ''}.`,
      '  a lift names exactly one stop, and a lift for another stop lifts nothing',
      ...asIgnored(flags),
    ]);
  }
  if (resolveBoundGit() === null) {
    return fail(2, ['REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so the owner\'s commit cannot be verified.', ...asIgnored(flags)]);
  }
  const rel = stopLiftRelPath(stopId) as string;
  const abs = join(root, rel);
  const git = liftRecordState(sys, root, rel);
  if (git.state === 'git-failed') return fail(2, [`REFUSED (GIT_FAILED): git could not say whether ${rel} is committed, so the stop stays engaged.`]);
  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);
  if (git.state === 'dirty') {
    return fail(2, [
      `REFUSED (LIFT_RECORD_DIRTY): ${rel} has been changed since it was committed, so what git holds and what is on disk differ.`,
      '  restore it or commit it again as the owner; the stop stays engaged',
      ...asIgnored(flags),
    ]);
  }
  return verifyAndLift(ctx, stateDir, stopId, rel, git.commit, flags);
}

/** Step 1 of 2: write the lift record, uncommitted, and hand the commit to the owner. */
function requestOwnerCommit(sys: System, abs: string, rel: string, stopId: string, flags: Flags): CommandResult {
  const ask = [
    `  - the owner commits that one file under their own git identity:  git add ${rel} && git commit -m "lift platform stop ${stopId}"`,
    `  - then run again:  projectos stop lift --stop ${stopId}`,
    '  - a commit by the ProjectOS implementer identity, or by anyone the approved plan does not name as owner, lifts nothing',
    ...asIgnored(flags),
    PLATFORM_STOP_STATEMENT,
  ];
  if (sys.readText(abs) !== null) {
    return fail(2, [`REFUSED (AWAITING_OWNER_COMMIT): the lift record ${rel} exists but is not committed. The stop stays engaged.`, ...ask]);
  }
  try {
    sys.writeText(abs, liftRequestText(stopId, sys.now()));
  } catch (error: unknown) {
    return fail(2, [`REFUSED (LIFT_RECORD_NOT_WRITTEN): ${error instanceof Error ? error.message : 'write failed'}. The stop stays engaged.`]);
  }
  return ok([`Lift requested for platform stop ${stopId}: wrote ${rel}, UNCOMMITTED. The stop stays engaged.`, ...ask]);
}

/** Step 2 of 2: the committed record names this stop, and the owner made the commit. Only then, lift. */
function verifyAndLift(ctx: CommandContext, stateDir: string, stopId: string, rel: string, liftCommit: string, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const committed = committedLiftRecord(sys, root, rel);
  if (committed === null || committed['kind'] !== STOP_LIFT_KIND || committed['stopId'] !== stopId) {
    return fail(2, [
      `REFUSED (LIFT_RECORD_INVALID): the committed ${rel} is not a lift record for ${stopId}.`,
      '  the stop stays engaged',
      ...asIgnored(flags),
    ]);
  }
  // THE OWNER IS THE APPROVED PLAN'S, AS COMMITTED — never a flag, never the lift record's own claim.
  const gc = loadGovernedContext(sys, root);
  const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;
  if (owner === null) {
    return fail(2, [
      'REFUSED (NO_COMMITTED_OWNER): no committed, unmodified approved plan records an owner here, so no commit can be shown',
      "  to be the owner's. The stop stays engaged.",
      ...asIgnored(flags),
    ]);
  }
  // NULL DELEGATED COMMITTER, ALWAYS. The ProjectOS implementer identity may stand in for the owner only
  // where a delegation grants it, and nothing grants lifting an emergency stop.
  const identity = commitIdentityOf(sys, root, rel);
  const problems = ownerCommitIdentityProblems(identity, owner, null);
  if (problems.length > 0) {
    return fail(2, [
      `REFUSED (LIFT_NOT_OWNER_COMMIT): the lift record ${rel} was not committed by the owner. The stop stays engaged.`,
      ...problems.map((p) => `  - ${p.replace('the closure decision', 'the lift record')}`),
      ...asIgnored(flags),
    ]);
  }
  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);
  if (!written.written) return fail(2, [`REFUSED (LIFT_NOT_RECORDED): ${written.problem}. The stop stays engaged.`]);
  return ok([
    `PLATFORM STOP LIFTED: ${stopId}, by the owner-authored commit ${liftCommit} (${identity?.name ?? '?'} <${identity?.email ?? '?'}>).`,
    '  governed commands and delegations work again from their own checks; nothing that was refused is resumed by this',
    PLATFORM_STOP_STATEMENT,
  ]);
}

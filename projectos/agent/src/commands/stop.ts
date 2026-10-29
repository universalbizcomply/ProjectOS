/**
 * `projectos stop` — THE OWNER'S EMERGENCY STOP FOR THIS WINDOWS ACCOUNT ON THIS MACHINE
 * (PROJECTOS-KERNEL-PLATFORM-STOP1A).
 *
 *   projectos stop [engage] [--reason "<text>"] [--by "<name>"]   engage it; needs no authority
 *   projectos stop status                                          show the record and what it cannot undo
 *   projectos stop lift --stop <stopId>                            lift it; a person, in a terminal
 *
 * ENGAGING NEEDS NOTHING, BECAUSE STOPPING IS ALWAYS SAFE. `--by` is recorded as exactly what it is: an
 * unauthenticated claim. The governed project the command runs in is recorded too, because a lift is
 * accepted only from that same project.
 *
 * LIFTING IS AN OWNER-INTENT CHECK, IN TWO STEPS, AND A FLAG IS NOT THE OWNER (ADR-K1 R7):
 *
 *   1. The first `stop lift` writes `.projectops/stop-lifts/<id>.json`, uncommitted, and says so.
 *   2. The owner commits that ONE file alone, under their own git name.
 *   3. The second `stop lift`, from the SAME project the stop was engaged in, verifies that the record is
 *      committed and unchanged, names the engaged stop, that the commit touched nothing else, and that
 *      the committer is the approved plan's owner with NO delegated committer (so the ProjectOS
 *      implementer identity can never stand in). Then it asks for the stop id to be RETYPED, and only
 *      in an interactive terminal: standard input and output must both be a TTY. Agents run without one.
 *
 * WHAT THAT PROVES, SAID PLAINLY: a git name match plus a typed confirmation in a terminal shows owner
 * intent at this account's keyboard. It is not cryptographic proof of the owner — a git name is
 * configuration — and a later phase adds Windows Hello. `--as owner` changes nothing; it is read only to
 * say it was ignored.
 *
 * WHAT IT WRITES: the stop record in the installation state directory, and the one lift record in the
 * governed project. Nothing else, and no commit or push of its own — the owner's commit is part of the
 * lift. Every output of `stop lift`, refusals included, carries the honest statement.
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
  governedProjectOf,
  isStopId,
  platformStopConfirmOf,
  platformStopDirOf,
  platformStopInstallRootOf,
  platformStopStatusLines,
  readPlatformStop,
  recordPlatformStopLift,
  sameStopPath,
  stopLiftRelPath,
  type PlatformStopRecord,
} from '../loop/platformStop.js';
import type { System } from '../system.js';

const USAGE: readonly string[] = [
  'Usage:',
  '  projectos stop [engage] [--reason "<text>"] [--by "<name>"]  engage the emergency stop for this Windows account',
  '  projectos stop status                                        show the stop record',
  '  projectos stop lift --stop <stopId>                          lift it: a person, in a terminal',
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
  const outcome = engagePlatformStop(ctx.sys, platformStopDirOf(ctx), {
    reason: str(flags, 'reason'),
    engagedBy: str(flags, 'by'),
    project: governedProjectOf(ctx.sys, ctx.root),
  });
  return outcome.kind === 'FAILED' ? fail(2, outcome.lines) : ok(outcome.lines);
}

/** EVERY `stop lift` ANSWER, refusal or success, goes out through here — and carries the statement. */
function liftAnswer(code: number, lines: readonly string[]): CommandResult {
  return { code, lines: [...lines, PLATFORM_STOP_STATEMENT] };
}

/** What git says about the lift record: never committed, committed but changed since, or committed as is. */
type LiftRecordState = 'uncommitted' | 'dirty' | 'committed' | 'git-failed';

function liftRecordState(sys: System, root: string, rel: string): { readonly state: LiftRecordState; readonly commit: string } {
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0) return { state: 'git-failed', commit: '' };
  const commit = logged.stdout.trim();
  if (commit === '') return { state: 'uncommitted', commit: '' };
  if (!/^[0-9a-f]{40}$/.test(commit)) return { state: 'git-failed', commit: '' };
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

/**
 * Every path the lift commit touched, repository-relative, with the root's own prefix to compare against.
 *
 * NOT `--relative`: that would hide every path outside the governed root, which is exactly where a sweep
 * commit's other files would be.
 */
function liftCommitPaths(sys: System, root: string, commit: string): { readonly prefix: string; readonly paths: readonly string[] } | null {
  const prefix = sys.exec('git', ['-C', root, 'rev-parse', '--show-prefix']);
  const shown = sys.exec('git', ['-C', root, 'show', '--name-only', '--format=', commit]);
  if (prefix.code !== 0 || shown.code !== 0) return null;
  return { prefix: prefix.stdout.trim(), paths: shown.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '') };
}

function liftRequestText(stopId: string, at: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: PLATFORM_STOP_SCHEMA_VERSION,
      kind: STOP_LIFT_KIND,
      stopId,
      requestedAt: at,
      effect:
        `Committed alone under the owner's own git name, this file is one half of lifting emergency stop ${stopId}; ` +
        'the other half is the stop id retyped by a person in an interactive terminal.',
      statement: PLATFORM_STOP_STATEMENT,
    },
    null,
    2,
  )}\n`;
}

function asIgnored(flags: Flags): readonly string[] {
  return flags['as'] === undefined ? [] : ['  - `--as` was given and was ignored: a command-line role is not evidence of the owner'];
}

/**
 * The stop is bound to the project it was engaged in, and lifted only from there.
 *
 * A different repository — even one with its own approved plan and its own owner — is refused, so a
 * project an agent can create cannot lift a stop engaged elsewhere. A stop engaged outside any governed
 * project is lifted only from the installation's own project root.
 */
function projectBindingProblem(ctx: CommandContext, record: PlatformStopRecord): string | null {
  const here = governedProjectOf(ctx.sys, ctx.root);
  if (record.project === null) {
    if (!sameStopPath(ctx.root, platformStopInstallRootOf(ctx)) || here === null) {
      return "this stop was engaged outside any governed project, so only the ProjectOS installation's own project root can lift it";
    }
    return null;
  }
  const bound = record.project;
  if (here === null || here.projectId !== bound.projectId || here.planId !== bound.planId || !sameStopPath(here.root, bound.root)) {
    return `this stop is bound to project '${bound.projectId}' at ${bound.root}; a lift from any other repository or plan lifts nothing`;
  }
  return null;
}

function lift(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const stopId = str(flags, 'stop');
  if (!isStopId(stopId)) {
    return liftAnswer(1, ['`stop lift` requires --stop <stopId>, exactly as `projectos stop status` prints it.', ...asIgnored(flags)]);
  }
  const stateDir = platformStopDirOf(ctx);
  const read = readPlatformStop(sys, stateDir);
  if (read.kind === 'unresolvable' || stateDir === null) {
    return liftAnswer(2, ['REFUSED (PLATFORM_STOP_UNVERIFIABLE): no state directory could be established, so no stop can be lifted.']);
  }
  if (read.kind === 'absent') return liftAnswer(1, [`No emergency stop is engaged; there is nothing to lift (${stopId}).`]);
  if (read.kind === 'unreadable') {
    return liftAnswer(2, [
      `REFUSED (PLATFORM_STOP_UNREADABLE): the stop record at ${read.path} cannot be trusted (${read.why}).`,
      '  a record that cannot be read cannot be lifted; it must be repaired by hand, and until then ProjectOS stays stopped',
    ]);
  }
  if (read.record.state === 'lifted' && read.record.liftedStopId === stopId) {
    return liftAnswer(0, [`Emergency stop ${stopId} was already lifted, after commit ${read.record.liftCommit ?? '?'}.`]);
  }
  if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {
    return liftAnswer(2, [
      `REFUSED (STOP_MISMATCH): ${stopId} is not the engaged stop.`,
      '  a lift names exactly one stop, and a lift for another stop lifts nothing',
      ...asIgnored(flags),
    ]);
  }
  const binding = projectBindingProblem(ctx, read.record);
  if (binding !== null) return liftAnswer(2, [`REFUSED (LIFT_WRONG_PROJECT): ${binding}. The stop stays engaged.`, ...asIgnored(flags)]);
  if (resolveBoundGit() === null) {
    return liftAnswer(2, ["REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so the owner's commit cannot be verified.", ...asIgnored(flags)]);
  }
  const rel = stopLiftRelPath(stopId) as string;
  const abs = join(root, rel);
  const git = liftRecordState(sys, root, rel);
  if (git.state === 'git-failed') return liftAnswer(2, [`REFUSED (GIT_FAILED): git could not say whether ${rel} is committed, so the stop stays engaged.`]);
  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);
  if (git.state === 'dirty') {
    return liftAnswer(2, [
      `REFUSED (LIFT_RECORD_DIRTY): ${rel} has been changed since it was committed, so what git holds and what is on disk differ.`,
      '  restore it, or commit it again on its own; the stop stays engaged',
      ...asIgnored(flags),
    ]);
  }
  return verifyAndLift(ctx, stateDir, stopId, rel, git.commit, flags);
}

/** Step 1 of 2: write the lift record, uncommitted, and hand the commit to the owner. No command to paste. */
function requestOwnerCommit(sys: System, abs: string, rel: string, stopId: string, flags: Flags): CommandResult {
  const ask = [
    `  - the owner commits ${rel} ALONE, in a commit that touches no other file, under their own git name`,
    '  - then a person lifts this with `projectos stop lift` in a terminal, retyping the stop id when asked',
    '  - a commit by the ProjectOS implementer identity, by anyone the approved plan does not name as owner, or one',
    '    that also carries other files, lifts nothing',
    ...asIgnored(flags),
  ];
  if (sys.readText(abs) !== null) {
    return liftAnswer(2, [`REFUSED (AWAITING_OWNER_COMMIT): the lift record ${rel} exists but is not committed. The stop stays engaged.`, ...ask]);
  }
  try {
    sys.writeText(abs, liftRequestText(stopId, sys.now()));
  } catch (error: unknown) {
    return liftAnswer(2, [`REFUSED (LIFT_RECORD_NOT_WRITTEN): ${error instanceof Error ? error.message : 'write failed'}. The stop stays engaged.`]);
  }
  return liftAnswer(0, [`Lift requested for emergency stop ${stopId}: wrote ${rel}, UNCOMMITTED. The stop stays engaged.`, ...ask]);
}

/**
 * Step 2 of 2: the committed record names this stop, its commit carried it alone, the owner's git name
 * made that commit, and a person retyped the stop id in a terminal. Only then, the compare-and-swap lift.
 */
function verifyAndLift(ctx: CommandContext, stateDir: string, stopId: string, rel: string, liftCommit: string, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const committed = committedLiftRecord(sys, root, rel);
  if (committed === null || committed['kind'] !== STOP_LIFT_KIND || committed['stopId'] !== stopId) {
    return liftAnswer(2, [`REFUSED (LIFT_RECORD_INVALID): the committed ${rel} is not a lift record for ${stopId}.`, '  the stop stays engaged', ...asIgnored(flags)]);
  }
  // THE LIFT COMMIT CARRIES THE LIFT RECORD AND NOTHING ELSE. A `git add -A && git commit` sweep can pick
  // up a lift file nobody meant to commit; a commit of that one file alone is a deliberate act.
  const touched = liftCommitPaths(sys, root, liftCommit);
  const expected = `${touched?.prefix ?? ''}${rel}`;
  if (touched === null || touched.paths.length !== 1 || touched.paths[0] !== expected) {
    return liftAnswer(2, [
      `REFUSED (LIFT_COMMIT_NOT_ALONE): the commit ${liftCommit.slice(0, 12)} that carries ${rel} also touches other files (or could not be read).`,
      '  the lift record must be committed on its own; the stop stays engaged',
      ...(touched === null ? [] : touched.paths.slice(0, 20).map((p) => `    ${p}`)),
      ...asIgnored(flags),
    ]);
  }
  // THE OWNER IS THE APPROVED PLAN'S, AS COMMITTED — never a flag, never the lift record's own claim.
  const gc = loadGovernedContext(sys, root);
  const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;
  if (owner === null) {
    return liftAnswer(2, [
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
    return liftAnswer(2, [
      `REFUSED (LIFT_NOT_OWNER_COMMIT): the lift record ${rel} was not committed under the owner's git name. The stop stays engaged.`,
      ...problems.map((p) => `  - ${p.replace('the closure decision', 'the lift record')}`),
      ...asIgnored(flags),
    ]);
  }
  // THE IN-PERSON HALF: the stop id, retyped, in an interactive terminal. No terminal, no lift.
  const confirmation = platformStopConfirmOf(ctx)(stopId);
  if (confirmation.kind !== 'typed') {
    return liftAnswer(2, [
      'REFUSED (LIFT_NEEDS_A_TERMINAL): a person must lift this stop in an interactive terminal; this process has no terminal.',
      '  the stop stays engaged',
      ...asIgnored(flags),
    ]);
  }
  if (confirmation.text !== stopId) {
    return liftAnswer(2, ['REFUSED (LIFT_CONFIRMATION_MISMATCH): the stop id typed does not match exactly. The stop stays engaged.', ...asIgnored(flags)]);
  }
  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);
  if (!written.written) return liftAnswer(2, [`REFUSED (LIFT_NOT_RECORDED): ${written.problem}. The stop stays engaged.`]);
  return liftAnswer(0, [
    `EMERGENCY STOP LIFTED: ${stopId}, after an owner-intent check — a commit of the lift record alone under the owner's git name`,
    `  (${identity?.name ?? '?'} <${identity?.email ?? '?'}>, ${liftCommit.slice(0, 12)}) and the stop id retyped in a terminal.`,
    '  This is not cryptographic proof of the owner; a later phase adds Windows Hello.',
    '  governed commands and delegations work again from their own checks; nothing that was refused is resumed by this',
  ]);
}

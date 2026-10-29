"use strict";
/**
 * THE PLATFORM-WIDE EMERGENCY STOP — PROJECTOS-KERNEL-PLATFORM-STOP1A.
 *
 * One owner command halts every loop, suspends every technical delegation and refuses new operations
 * until the owner lifts it — and says plainly that it cannot undo what already left the machine. The
 * value of a stop is that it reaches EVERYTHING, so this pins every place it is asked, and the shape of
 * each rule that keeps it honest, because every way of undoing one reads reasonably in a diff:
 *
 *   PS-1  "the CLI can allow by default"          — and next month's command keeps running through a stop
 *   PS-2  "the loop checks once, at the start"     — and a stop engaged mid-run is honoured next run
 *   PS-3  "the commands are behind the CLI gate"   — and the sidecar and in-process callers walk past it
 *   PS-4  "a delegation can stay live under a stop" — and ProjectOS keeps committing and paying
 *   PS-5  "the surfaces outside the CLI need no check" — and the bridge lies and the sidecar acts
 *   PS-6  "a damaged record is no record"          — and corrupting one file lifts the stop
 *   PS-7  "no state directory means no stop"       — and unsetting one variable lifts the stop
 *   PS-8  "any commit of the lift record will do"   — and the implementer, or anybody, lifts the stop
 *   PS-9  "the owner can say so on the command line" — and `--as owner` lifts the stop
 *   PS-10 "the statement is decoration"            — and a stop implies it recalled sends and payments
 *   PS-11 "the stop may write wherever it likes"    — and engaging or lifting edits authority records
 *   PS-12 "the check may ask git"                   — and it breaks, or lies, where git is not established
 *
 * Added in the fix round after the ECC SECURITY review (H1, H2, M1-M6) and the identity review:
 *
 *   PS-13 "a typed id is a typed id, terminal or not" — and an agent with no terminal lifts the stop
 *   PS-14 "any commit carrying the lift record will do" — and a `git add -A` sweep lifts the stop
 *   PS-15 "a lift from any project will do"         — and a repository an agent creates lifts the stop
 *   PS-16 "the refusal can always say nothing happened" — and a paid call or a dispatched worker is denied
 *   PS-17 "the entry check is enough"               — and a stop engaged mid-step lets the commit or push through
 *   PS-18 "replace the damaged record, then write"  — and a failed write drops a standing stop
 *   PS-19 "the environment names the directory"     — and one variable points the stop at an empty folder
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT
 * rule fires. Comments are stripped first. Reads files; runs nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STOP_REL = "projectos/agent/src/loop/platformStop.ts";
const STOPCMD_REL = "projectos/agent/src/commands/stop.ts";
const CLI_REL = "projectos/agent/src/cli.ts";
const RUNNER_REL = "projectos/agent/src/loop/runner.ts";
const RUN_REL = "projectos/agent/src/commands/run.ts";
const CLOSURE_REL = "projectos/agent/src/commands/closure.ts";
const PHASE_REL = "projectos/agent/src/commands/phase.ts";
const PLAN_REL = "projectos/agent/src/commands/plan.ts";
const RECONCILE_REL = "projectos/agent/src/commands/reconcile.ts";
const GK_REL = "projectos/agent/src/loop/gatekeeperConfig.ts";
const TC_REL = "projectos/agent/src/loop/technicalContinuation.ts";
const BRIDGE_REL = "projectos/agent/src/mcp/bridge.ts";
const SIDECAR_REL = "projectos/control-center/sidecar/host.mjs";
const SOURCES = [STOP_REL, STOPCMD_REL, CLI_REL, RUNNER_REL, RUN_REL, CLOSURE_REL, PHASE_REL, PLAN_REL, RECONCILE_REL, GK_REL, TC_REL, BRIDGE_REL, SIDECAR_REL];

const TESTS = {
  "projectos/agent/test/platformStop.test.ts": [
    "reads an ABSENT record as running, and never runs a command",
    "reads an ENGAGED record as a refusal carrying the stop id and the honest statement",
    "reads a MALFORMED record as stopped — invalid JSON, a wrong schema, or a lift with no commit",
    "reads a record that EXISTS but cannot be read as stopped, never as absent",
    "reads a validly LIFTED record as running",
    "reads a NULL or blank state directory as stopped",
    "classifies every command cli.ts dispatches — a new command without a row here fails",
    "refuses `%s` while engaged, with the statement, zero writes and zero execs",
    "run, continue, closure prepare/request/resume, reconcile, plan draft and phase advance/new all refuse; origin unchanged",
    "runLoop starts nothing and writes nothing under a stop, and runs again once the stop is lifted",
    "the technical continuation and the records commit refuse before git is asked anything",
    "the technical and closure-commit delegations report problems while engaged and resolve again after the lift",
    "admitGatekeeperSpend refuses before the lock or the ledger is touched",
    "refused with no lift record: the first call only writes the request, uncommitted",
    "refused while the lift record is uncommitted",
    "refused when the committed lift record has been changed since (dirty)",
    "refused when committed by the ProjectOS implementer identity",
    "refused when committed by a name the approved plan does not record as owner",
    "refused when only `--as owner` is given: a flag is not the owner",
    "refused when the stop id does not match the engaged stop",
    "accepted for an owner-identity commit, after which runLoop proceeds",
    "the run never folds a lift record into its own records commit",
    "refuses a SWEEP commit: the lift record committed together with any other file lifts nothing",
    "refuses a lift from a FOREIGN repository, even one with its own approved plan and owner",
    "a stop engaged outside any project is lifted only from the installation root",
    "refuses with NO TERMINAL: the production confirmation answers no-terminal when stdin or stdout is not a TTY",
    "refuses a WRONG typed id — near misses included",
    "every `stop lift` answer, refusals included, carries the honest statement and no copy-paste lift command",
    "the lift is a compare-and-swap: a stop re-engaged between the read and the write is not lifted",
    "a FAILING WRITE leaves the damaged record exactly where it was, still refusing",
    "a failing move INTO place restores the damaged record, so a reader never finds nothing",
    "agrees with the installation state directory in the suite, and is unverifiable — stopped — when the environment disagrees",
    "strips C1 controls, line separators and bidirectional overrides from the reason and the claim",
    "a history with a null element is a damaged record — stopped — and `stop status` does not throw on it",
    "an unreachable record (a parent that is a FILE, ENOTDIR) is unreadable — stopped — never absent",
    "refuses every verb that can act while engaged, and lets only refresh, project.select and run.stop through",
    "the sidecar asks this gate before any in-process dispatch, run start or off-loop worker",
    "refuses both with the statement and writes nothing",
    "commitOwnRecords refuses before git is asked anything",
  ],
  "projectos/agent/test/loopRunner.test.ts": [
    "[PLATFORM-STOP] engaged before the run: zero worker starts, zero writes, zero gatekeeper calls",
    "[PLATFORM-STOP] engaged during the first attempt: no second dispatch, BLOCKED, and the gatekeeper is never called",
    "[PLATFORM-STOP] a stop engaged while a refused worker was out means the reviewer is not paid to look",
    "[PLATFORM-STOP] degraded mode spends no grant when the stop is engaged while the reviewer is being reached",
    "[PLATFORM-STOP] an owner receipt is never burned on a passage the stop will refuse",
  ],
  "projectos/agent/test/mcpBridge.test.ts": [
    "[PLATFORM-STOP] stop-work really engages the platform stop, and says what it cannot undo",
  ],
  "projectos/agent/test/closureEndToEnd.test.ts": [
    "[PLATFORM-STOP] a stop engaged while the closure question was out: the paid answer is presented, nothing is committed",
  ],
};

/** The first-statement check every command entry carries. */
const ENTRY = String.raw`const halted = platformStopRefusal\(ctx\.sys, platformStopDirOf\(ctx\)\);\s*if \(halted !== null\) return fail\(2, halted\);`;
const ENTRY_SYS = String.raw`const halted = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(halted !== null\) return fail\(2, halted\);`;
const PLAN_FN = (name) => new RegExp(String.raw`function ${name}\(ctx: CommandContext, flags: Record<string, string \| boolean>\): CommandResult \{\s*${ENTRY}`);
/** A runner site: the check, with whatever honest consequence it passes. */
const SITE = String.raw`platformStopRefusal\(sys, stopDir(?:, [A-Za-z_ =?:0-9]+)?\)`;

const PIN = {
  // PS-1
  cliGate: /export function run\(ctx: CommandContext, argv: readonly string\[\]\): CommandResult \{\s*const \{ command, flags, positionals \} = parseArgs\(argv\);\s*if \(!readOnlyUnderPlatformStop\(command, positionals, flags\)\) \{\s*const halted = platformStopRefusal\(ctx\.sys, platformStopDirOf\(ctx\)\);\s*if \(halted !== null\) return \{ code: 2, lines: halted \};\s*\}\s*switch \(command\) \{/,
  cliDenyDefault: /default:\s*return false;\s*\}\s*\}\s*export function run\(/,
  cliClosure: /case 'closure':\s*return sub === undefined \|\| sub === 'status';/,
  cliPhaseApprove: /case 'phase':\s*case 'approve':\s*return sub === undefined \|\| sub === 'show' \|\| sub === 'list';/,
  cliPlan: /case 'plan':\s*return sub === undefined \|\| sub === 'show' \|\| sub === 'drafts';/,
  cliWorkforce: /case 'workforce':\s*return sub === 'roster' \|\| sub === 'team' \|\| sub === 'check-update';/,
  cliMcp: /case 'mcp':\s*return sub === undefined \|\| sub === 'status';/,
  cliReport: /case 'report':\s*return flags\['phase'\] === undefined;/,
  cliMutatingAllowed: /case '(run|continue|reconcile|init|install|close)':/,
  cliReexport: "export { controlCenterVerbRefusal, platformStopRefusal, PLATFORM_STOP_STATEMENT } from './loop/platformStop.js';",
  // PS-2
  runnerEntry: /export function runLoop\(sys: System, root: string, options: RunOptions = \{\}\): RunResult \{\s*const stopDir = options\.platformStopStateDir;\s*const stoppedAtEntry = platformStopRefusal\(sys, stopDir\);\s*if \(stoppedAtEntry !== null\) return refused\(stoppedAtEntry\);\s*const contextResult = loadGovernedContext\(sys, root\);/,
  runnerDispatch: new RegExp(String.raw`const haltedDispatch = ${SITE};\s*if \(haltedDispatch !== null\) return haltMidRun\(haltedDispatch, attempts\);\s*options\.onWorkState\?\.\(\{\s*state: 'WAITING_AI',`),
  runnerConsult: new RegExp(String.raw`const consultGatekeeper = \(candidate: LoopStop, evidenceText: string\): 'retry' \| 'proceed' \| null => \{\s*const haltedReview = ${SITE};\s*if \(haltedReview !== null\) \{[\s\S]{0,300}?return null;\s*\}`),
  runnerCandidate: new RegExp(String.raw`const recordLocalCandidate = \(\): Record<string, unknown> \| null => \{\s*const haltedCandidate = ${SITE};\s*if \(haltedCandidate !== null\) \{\s*localCandidateRefusal = haltedCandidate;\s*return \{ available: false,`),
  runnerReviewer: new RegExp(String.raw`const haltedReviewer = ${SITE};\s*if \(haltedReviewer !== null\) return haltMidRun\(haltedReviewer, attempts\);\s*if \(decision\.kind === 'stop' && decision\.reason\.code === 'REVIEW_OUTSTANDING' && outstandingIndependent\.length > 0\) \{\s*const reviewed = runIndependentReview\(`),
  runnerDegraded: new RegExp(String.raw`const degradedContinuation = \(candidate: LoopStop, cause: GatekeeperUnavailabilityCause\): DegradedOutcome => \{\s*const haltedDegraded = ${SITE};\s*if \(haltedDegraded !== null\) \{[\s\S]{0,300}?return \{ kind: 'REFUSED', reasons: haltedDegraded \};`),
  runnerReceipts: /const payForPendingOwnerGates = \(\): boolean => \{\s*if \(platformStopRefusal\(sys, stopDir\) !== null\) \{[\s\S]{0,200}?return false;\s*\}/,
  runnerContinuation: new RegExp(String.raw`const runContinuation = \(\): ContinuationResult => \{\s*const haltedContinuation = ${SITE};\s*if \(haltedContinuation !== null\) \{[\s\S]{0,300}?return \{ kind: 'REFUSED',`),
  runnerFinal: new RegExp(String.raw`const haltedAtEnd = ${SITE};\s*if \(haltedAtEnd !== null\) \{\s*return haltMidRun\(`),
  runnerHalt: /const haltMidRun = \(refusal: readonly string\[\], attempt: number\): RunResult => \{\s*options\.onWorkState\?\.\(\{\s*state: 'BLOCKED',[\s\S]{0,300}?ownerRequired: true,\s*\}\);\s*return refused\(\[\.\.\.lines, \.\.\.refusal\]\);/,
  runnerExecutorDir: "platformStopStateDir: stopDir,",
  // PS-3
  closurePrepare: new RegExp(String.raw`export function closurePrepare\(ctx: CommandContext, flags: Flags\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureRequest: new RegExp(String.raw`export function closureRequest\(ctx: CommandContext, flags: Flags, makeDeps\?: MakeClosureDeps\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureResume: new RegExp(String.raw`export function closureResume\(ctx: CommandContext, flags: Flags, ownerWait: OwnerCommitWaitPorts = \{\}\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureBeforeAsk: /const haltedBeforeAsk = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(haltedBeforeAsk !== null\) return fail\(2,[\s\S]{0,200}?\);\s*const turn: ClosureTurnResult =/,
  closureBeforeCommit: /const haltedBeforeCommit = platformStopRefusal\(sys, platformStopDirOf\(ctx\)(?:, [A-Z_]+)?\);\s*if \(haltedBeforeCommit !== null\) \{\s*return fail\(2,[\s\S]{0,300}?\}\s*if \(modeResolution\.mode !== 'unattended' \|\| !closureCommitGrant/,
  closureBeforeClose: /const haltedBeforeClose = platformStopRefusal\(sys, platformStopDirOf\(ctx\)(?:, [A-Z_]+)?\);\s*if \(haltedBeforeClose !== null\) \{\s*return fail\(2,[\s\S]{0,300}?\}\s*const advanced = phaseCommand\(/,
  phaseNew: new RegExp(String.raw`function phaseNew\(ctx: CommandContext, flags: Flags\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY}`),
  phaseAdvance: new RegExp(String.raw`function phaseAdvance\(ctx: CommandContext, flags: Flags\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY}`),
  planDraft: PLAN_FN("draft"),
  planActivate: PLAN_FN("activate"),
  planApprove: PLAN_FN("approve"),
  planDecide: PLAN_FN("decide"),
  reconcile: new RegExp(String.raw`export function reconcile\(ctx: CommandContext, flags: Flags, seams: ReconcileSeams = \{\}\): CommandResult \{\s*${ENTRY}`),
  runEntry: new RegExp(String.raw`export function run\(ctx: CommandContext, flags: Flags\): CommandResult \{\s*${ENTRY}`),
  continueEntry: new RegExp(String.raw`export function continueCommand\(ctx: CommandContext, flags: Flags, ownerWait: OwnerCommitWaitPorts = \{\}\): CommandResult \{\s*${ENTRY}`),
  runLoopDir: /runLoop\(ctx\.sys, ctx\.root, \{\s*platformStopStateDir: platformStopDirOf\(ctx\),/,
  // PS-4
  deciderSuspended: /requiredScope: DelegableScope = GATEKEEPER_REVIEW_SCOPE,\s*platformStopStateDir\?: string \| null,\s*\): DelegatedDeciderResolution \{\s*const stopped = delegationSuspension\(sys, platformStopStateDir\);\s*if \(stopped !== null\) return \{ ok: false, problems: stopped \};/,
  suspensionCheck: /function delegationSuspension\(sys: System, platformStopStateDir: string \| null \| undefined\): readonly string\[\] \| null \{\s*const stopped = platformStopRefusal\(sys, platformStopStateDir\);\s*return stopped === null \? null : \[/,
  technicalSuspended: /\): TechnicalDelegationState \{\s*const suspended = delegationSuspension\(sys, platformStopStateDir\);\s*if \(suspended !== null\) \{/,
  closureCommitSuspended: /\): ClosureCommitDelegationState \{\s*const suspended = delegationSuspension\(sys, platformStopStateDir\);\s*if \(suspended !== null\) return \{ granted: false, problems: suspended \};/,
  spendRefused: /platformStopStateDir\?: string \| null,\s*\): SpendAdmission \{\s*const stopped = platformStopRefusal\(sys, platformStopStateDir\);\s*if \(stopped !== null\) return \{ allowed: false,[\s\S]{0,200}?\};\s*return underCostLedgerLock<SpendAdmission>\(/,
  continuationRefused: /export function runTechnicalContinuation\(sys: System, request: ContinuationRequest\): ContinuationOutcome \{\s*const stopped = platformStopRefusal\(sys, request\.platformStopStateDir\);\s*if \(stopped !== null\) return refuse\(/,
  recordsRefused: /platformStopStateDir\?: string \| null,\s*\): OwnRecordsOutcome \{\s*const stopped = platformStopRefusal\(sys, platformStopStateDir\);\s*if \(stopped !== null\) \{\s*return \{ kind: 'REFUSED',/,
  // PS-5
  bridgeEngages: /function stopWork\(deps: BridgeDeps\): ReturnType<typeof engagePlatformStop> \{\s*return engagePlatformStop\(deps\.ctx\.sys, deps\.stateDir,/,
  bridgeError: /if \(verdict\.operation === 'stop-work'\) \{\s*const engaged = stopWork\(deps\);\s*return ok\(request, toolResult\(engaged\.lines, engaged\.kind === 'FAILED'\)\);/,
  sidecarCheck: /const halted = controlCenterVerbRefusal\(agentSystem, check\.request\.verb\);\s*if \(halted !== null\) \{\s*emit\(2, halted, check\.request\.verb\);/,
  sidecarImport: /setGovernanceEngines, controlCenterVerbRefusal \} from '@projectos\/agent';/,
  ccVerbs: "export const CONTROL_CENTER_VERBS_UNDER_STOP: readonly string[] = ['refresh', 'project.select', 'run.stop'];",
  ccGate: /if \(CONTROL_CENTER_VERBS_UNDER_STOP\.includes\(verb\)\) return null;\s*return platformStopRefusal\(sys, stateDir\);/,
  // PS-6
  absentRunning: "if (read.kind === 'absent') return null;",
  liftedRunning: "if (read.kind === 'ok' && read.record.state === 'lifted') return null;",
  invalidJson: "return { why: 'it is not valid JSON' };",
  invalidRecord: "return record === null ? { why: 'it is not a valid platform stop record' } : { record };",
  invalidUnreadable: "if ('why' in parsed) return { kind: 'unreadable', path, why: parsed.why };",
  unreadableFile: "return present ? { kind: 'unreadable', path, why: 'it exists or is unreachable, but could not be read' } : { kind: 'absent', path };",
  unreachableProbe: "present = sys.exists(path) || !definitelyAbsent(path);",
  enoentOnly: "if ((error as { code?: unknown }).code !== 'ENOENT') return false;",
  schemaChecked: "if (r['schemaVersion'] !== PLATFORM_STOP_SCHEMA_VERSION) return null;",
  stateChecked: "if (r['state'] !== 'engaged' && r['state'] !== 'lifted') return null;",
  historyChecked: "if (!(r['history'] as unknown[]).every(validEvent)) return null;",
  projectChecked: "if (!('project' in r) || !validProject(r['project'])) return null;",
  liftNamesStop: "if (r['liftedStopId'] !== r['stopId']) return null;",
  liftNamesCommit: "if (typeof r['liftCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(r['liftCommit'])) return null;",
  // PS-7
  unresolvable: "if (stateDir === null || stateDir.trim() === '') return { kind: 'unresolvable' };",
  unresolvableRefuses: /if \(read\.kind === 'unresolvable'\) \{\s*return \[\s*`REFUSED \(PLATFORM_STOP_UNVERIFIABLE\)/,
  contextNull: "return typeof named === 'string' && named.trim() !== '' ? named : null;",
  // PS-8
  ownerOnly: "const problems = ownerCommitIdentityProblems(identity, owner, null);",
  ownerRefuses: /if \(problems\.length > 0\) \{\s*return liftAnswer\(2, \[\s*`REFUSED \(LIFT_NOT_OWNER_COMMIT\)/,
  committedOwner: "const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;",
  identityOf: "const identity = commitIdentityOf(sys, root, rel);",
  dirtyChecked: "return { state: dirty.stdout.trim() === '' ? 'committed' : 'dirty', commit };",
  committedBytes: "const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);",
  liftMatches: "if (committed === null || committed['kind'] !== STOP_LIFT_KIND || committed['stopId'] !== stopId) {",
  engagedMatches: "if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {",
  casRead: "return now.kind === 'ok' && now.record.state === 'engaged' && now.record.stopId === stopId",
  casUsed: "{ stillApplies: stillEngaged },",
  // PS-10
  statementText: [
    "'This stop covers this Windows account on this machine. It does NOT reverse completed external effects: '",
    "'commits already pushed, paid provider calls already made, messages already sent and payments already '",
    "'made all stand. A worker that is already running is not killed; it ends at its next check. The '",
    "'ProjectOS Host service is not touched. Lifting it is an owner-intent check — a git name match plus the '",
    "'stop id retyped in a terminal — not cryptographic proof of the owner; a later phase adds Windows Hello.'",
  ],
  liftAnswer: /function liftAnswer\(code: number, lines: readonly string\[\]\): CommandResult \{\s*return \{ code, lines: \[\.\.\.lines, PLATFORM_STOP_STATEMENT\] \};/,
  liftHint: "export const STOP_LIFT_HINT = '  - a person lifts this with `projectos stop lift` in a terminal';",
  // PS-11
  recordWrite: "sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\\n`);",
  recordTemp: "const temporary = `${path}.tmp`;",
  recordPath: "const path = platformStopPath(stateDir);",
  liftWrite: "sys.writeText(abs, liftRequestText(stopId, sys.now()));",
  liftAbs: "const abs = join(root, rel);",
  liftRel: "const rel = stopLiftRelPath(stopId) as string;",
  liftsDir: "export const STOP_LIFTS_REL = '.projectops/stop-lifts';",
  liftRelFn: "return isStopId(stopId) ? `${STOP_LIFTS_REL}/${stopId}.json` : null;",
  stopIdShape: "const STOP_ID = /^STOP-[0-9TZ]{8,16}-[0-9a-f]{12}$/;",
  // PS-13
  confirmAsked: "const confirmation = platformStopConfirmOf(ctx)(stopId);",
  confirmTerminal: /if \(confirmation\.kind !== 'typed'\) \{\s*return liftAnswer\(2, \[\s*'REFUSED \(LIFT_NEEDS_A_TERMINAL\)/,
  confirmExact: /if \(confirmation\.text !== stopId\) \{\s*return liftAnswer\(2,/,
  ttyBoth: "if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'no-terminal' };",
  ttyFromProcess: "return { stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true, ask: askTerminal };",
  confirmDefault: "return typeof named === 'function' ? (named as StopLiftConfirm) : terminalStopLiftConfirm();",
  // PS-14
  commitPaths: "const shown = sys.exec('git', ['-C', root, 'show', '--name-only', '--format=', commit]);",
  commitAlone: "if (touched === null || touched.paths.length !== 1 || touched.paths[0] !== expected) {",
  commitPrefix: "const expected = `${touched?.prefix ?? ''}${rel}`;",
  // PS-15
  bindingAsked: "const binding = projectBindingProblem(ctx, read.record);",
  bindingRefuses: "if (binding !== null) return liftAnswer(2, [`REFUSED (LIFT_WRONG_PROJECT): ${binding}. The stop stays engaged.`, ...asIgnored(flags)]);",
  bindingSameProject: "if (here === null || here.projectId !== bound.projectId || here.planId !== bound.planId || !sameStopPath(here.root, bound.root)) {",
  bindingInstallRoot: "if (!sameStopPath(ctx.root, platformStopInstallRootOf(ctx)) || here === null) {",
  engageBinds: "project: governedProjectOf(ctx.sys, ctx.root),",
  bridgeBinds: "project: governedProjectOf(deps.ctx.sys, deps.ctx.root),",
  // PS-16
  honestDefault: "consequence: string = STOP_NOTHING_DONE,",
  honestEnd: "const haltedAtEnd = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);",
  honestReviewer: "const haltedReviewer = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);",
  honestDispatch: "const haltedDispatch = platformStopRefusal(sys, stopDir, attempts === 0 ? STOP_NOTHING_DONE : STOP_AFTER_WORK);",
  honestAsk: "const haltedBeforeCommit = platformStopRefusal(sys, platformStopDirOf(ctx), STOP_AFTER_ASK);",
  honestClose: "const haltedBeforeClose = platformStopRefusal(sys, platformStopDirOf(ctx), STOP_AFTER_OWNER_COMMIT);",
  // PS-17
  actCommit: /const stoppedBeforeCommit = platformStopRefusal\(sys, request\.platformStopStateDir, STOP_BEFORE_ACT\);\s*if \(stoppedBeforeCommit !== null\) return refuse\([^\n]*\n\s*const staged = sys\.exec\('git', \['-C', root, 'add', '--', \.\.\.paths\]\);/,
  actPush: /const stoppedBeforePush = platformStopRefusal\(sys, request\.platformStopStateDir, STOP_BEFORE_ACT\);\s*if \(stoppedBeforePush !== null\) return refuse\([^\n]*\n\s*const pushed = sys\.exec\('git', \['-C', root, 'push',/,
  actMerge: /const stoppedBeforeMerge = platformStopRefusal\(sys, request\.platformStopStateDir, STOP_BEFORE_ACT\);\s*if \(stoppedBeforeMerge !== null\) return refuse\([^\n]*\n\s*const merged = sys\.exec\('git', \[/,
  actRecordsEntry: /export function commitOwnRecords\(sys: System, request: OwnRecordsCommitRequest\): OwnRecordsOutcome \{\s*const stoppedAtEntry = platformStopRefusal\(sys, request\.platformStopStateDir\);\s*if \(stoppedAtEntry !== null\) \{/,
  actRecordsCommit: /const stoppedBeforeRecordsCommit = platformStopRefusal\(sys, request\.platformStopStateDir, STOP_BEFORE_ACT\);\s*if \(stoppedBeforeRecordsCommit !== null\) return refuseNow\([^\n]*\n\s*const staged = sys\.exec\('git', \['--literal-pathspecs', '-C', root, 'add'/,
  actRecordsPush: /const stoppedBeforeRecordsPush = platformStopRefusal\(sys, request\.platformStopStateDir, STOP_AFTER_COMMIT\);\s*if \(stoppedBeforeRecordsPush !== null\) \{[\s\S]{0,300}?\}\s*const pushed = sys\.exec\('git', \['-C', root, 'push',/,
  actRecordsDir: /closureCommit: resolveClosureCommitDelegation\(sys, root, programme\) \} : \{\}\),\s*platformStopStateDir,\s*\}\);/,
  // PS-18
  stagedRead: "const staged = sys.readText(temporary);",
  stagedChecked: "if (stagedRecord === null || 'why' in stagedRecord || stagedRecord.record.stopId !== next.stopId || stagedRecord.record.state !== next.state) {",
  casAsked: "const changed = opts.stillApplies?.() ?? null;",
  asideMove: "if (opts.aside !== undefined && !sys.renameFile(path, opts.aside)) {",
  recordMove: "if (!sys.renameFile(temporary, path)) {",
  asideRestore: "if (opts.aside !== undefined) sys.renameFile(opts.aside, path);",
  // PS-19
  osHome: "home = os.userInfo().homedir;",
  osAgrees: "return sameStopPath(derived, configured) ? derived : null;",
  osDefaultDir: "if (!('platformStopStateDir' in ctx)) return defaultPlatformStopStateDir();",
  osDefaultParam: "stateDir: string | null | undefined = defaultPlatformStopStateDir(),",
};

const MUTATIONS = [
  // PS-1
  { name: "cli-gate-removed", rule: "PS-1", rel: CLI_REL, from: "  if (!readOnlyUnderPlatformStop(command, positionals, flags)) {", to: "  if (false) {" },
  { name: "cli-allow-by-default", rule: "PS-1", rel: CLI_REL, from: "    default:\n      return false;\n  }\n}\n\nexport function run(", to: "    default:\n      return true;\n  }\n}\n\nexport function run(" },
  { name: "cli-dry-run-allowed", rule: "PS-1", rel: CLI_REL, from: "    case 'prompt':\n      return true;", to: "    case 'prompt':\n    case 'run':\n      return true;" },
  { name: "cli-closure-resume-allowed", rule: "PS-1", rel: CLI_REL, from: "      return sub === undefined || sub === 'status';\n    case 'phase':", to: "      return true;\n    case 'phase':" },
  { name: "cli-report-write-allowed", rule: "PS-1", rel: CLI_REL, from: "      return flags['phase'] === undefined;", to: "      return true;" },
  // PS-2
  { name: "runner-entry-deleted", rule: "PS-2", rel: RUNNER_REL, from: "  const stoppedAtEntry = platformStopRefusal(sys, stopDir);", to: "  const stoppedAtEntry = null as readonly string[] | null;" },
  { name: "runner-dispatch-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedDispatch = platformStopRefusal(sys, stopDir, attempts === 0 ? STOP_NOTHING_DONE : STOP_AFTER_WORK);", to: "    const haltedDispatch = null as readonly string[] | null;" },
  { name: "runner-gatekeeper-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedReview = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "    const haltedReview = null as readonly string[] | null;" },
  { name: "runner-candidate-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedCandidate = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "    const haltedCandidate = null as readonly string[] | null;" },
  { name: "runner-reviewer-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedReviewer = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "    const haltedReviewer = null as readonly string[] | null;" },
  { name: "runner-degraded-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedDegraded = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "    const haltedDegraded = null as readonly string[] | null;" },
  { name: "runner-receipt-burned", rule: "PS-2", rel: RUNNER_REL, from: "    if (platformStopRefusal(sys, stopDir) !== null) {", to: "    if (false) {" },
  { name: "runner-continuation-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedContinuation = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "    const haltedContinuation = null as readonly string[] | null;" },
  { name: "runner-final-deleted", rule: "PS-2", rel: RUNNER_REL, from: "  const haltedAtEnd = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "  const haltedAtEnd = null as readonly string[] | null;" },
  { name: "runner-halt-reported-as-success", rule: "PS-2", rel: RUNNER_REL, from: "    return refused([...lines, ...refusal]);", to: "    return { ok: true, lines, phaseId, sessionId, stop: null, attempts: attempt };" },
  // PS-3
  { name: "closure-prepare-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "export function closurePrepare(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n", to: "export function closurePrepare(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  return closureStatus(ctx, flags);\n" },
  { name: "closure-request-before-ask-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeAsk = platformStopRefusal(sys, platformStopDirOf(ctx));", to: "  const haltedBeforeAsk = null as readonly string[] | null;" },
  { name: "closure-request-before-commit-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeCommit = platformStopRefusal(sys, platformStopDirOf(ctx), STOP_AFTER_ASK);", to: "  const haltedBeforeCommit = null as readonly string[] | null;" },
  { name: "closure-resume-before-close-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeClose = platformStopRefusal(sys, platformStopDirOf(ctx), STOP_AFTER_OWNER_COMMIT);", to: "  const haltedBeforeClose = null as readonly string[] | null;" },
  { name: "phase-advance-deleted", rule: "PS-3", rel: PHASE_REL, from: "function phaseAdvance(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function phaseAdvance(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  const halted = null as readonly string[] | null;" },
  { name: "phase-new-deleted", rule: "PS-3", rel: PHASE_REL, from: "and `closure resume` calls `phase advance` for a delegated close — none of them through the CLI gate.\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "and `closure resume` calls `phase advance` for a delegated close — none of them through the CLI gate.\n  const halted = null as readonly string[] | null;" },
  { name: "plan-draft-deleted", rule: "PS-3", rel: PLAN_REL, from: "An authored draft is a paid provider call; a decision is committed; activation materialises a plan.\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "An authored draft is a paid provider call; a decision is committed; activation materialises a plan.\n  const halted = null as readonly string[] | null;" },
  { name: "plan-decide-deleted", rule: "PS-3", rel: PLAN_REL, from: "function decide(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function decide(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = null as readonly string[] | null;" },
  { name: "plan-activate-deleted", rule: "PS-3", rel: PLAN_REL, from: "function activate(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function activate(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = null as readonly string[] | null;" },
  { name: "plan-approve-deleted", rule: "PS-3", rel: PLAN_REL, from: "function approve(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function approve(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = null as readonly string[] | null;" },
  { name: "reconcile-deleted", rule: "PS-3", rel: RECONCILE_REL, from: "  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "  const halted = null as readonly string[] | null;" },
  { name: "run-entry-deleted", rule: "PS-3", rel: RUN_REL, from: "  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));\n  if (halted !== null) return fail(2, halted);\n  const worker = str(flags, 'worker');", to: "  const worker = str(flags, 'worker');" },
  { name: "continue-entry-deleted", rule: "PS-3", rel: RUN_REL, from: "  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));\n  if (halted !== null) return fail(2, halted);\n  const dryRun = bool(flags, 'dry-run');\n  const execute = bool(flags, 'execute');\n  if (dryRun === execute) {", to: "  const dryRun = bool(flags, 'dry-run');\n  const execute = bool(flags, 'execute');\n  if (dryRun === execute) {" },
  // PS-4
  { name: "delegation-not-suspended", rule: "PS-4", rel: GK_REL, from: "  const stopped = delegationSuspension(sys, platformStopStateDir);\n  if (stopped !== null) return { ok: false, problems: stopped };", to: "" },
  { name: "suspension-never-fires", rule: "PS-4", rel: GK_REL, from: "  const stopped = platformStopRefusal(sys, platformStopStateDir);\n  return stopped === null ? null : [", to: "  const stopped = null as readonly string[] | null;\n  return stopped === null ? null : [" },
  { name: "spend-admitted-under-stop", rule: "PS-4", rel: GK_REL, from: "  if (stopped !== null) return { allowed: false, reasons: ['no provider call is admitted while the platform stop is engaged', ...stopped] };", to: "" },
  { name: "continuation-under-stop", rule: "PS-4", rel: TC_REL, from: "  const stopped = platformStopRefusal(sys, request.platformStopStateDir);", to: "  const stopped = null as readonly string[] | null;" },
  { name: "records-commit-under-stop", rule: "PS-4", rel: TC_REL, from: "  const stopped = platformStopRefusal(sys, platformStopStateDir);\n  if (stopped !== null) {\n    return { kind: 'REFUSED'", to: "  const stopped = null as readonly string[] | null;\n  if (stopped !== null) {\n    return { kind: 'REFUSED'" },
  // PS-5
  { name: "bridge-claims-without-recording", rule: "PS-5", rel: BRIDGE_REL, from: "    const engaged = stopWork(deps);\n    return ok(request, toolResult(engaged.lines, engaged.kind === 'FAILED'));", to: "    return ok(request, toolResult(['stop requested and recorded'], false));" },
  { name: "sidecar-unchecked", rule: "PS-5", rel: SIDECAR_REL, from: "  const halted = controlCenterVerbRefusal(agentSystem, check.request.verb);", to: "  const halted = null;" },
  { name: "control-center-run-start-allowed", rule: "PS-5", rel: STOP_REL, from: "['refresh', 'project.select', 'run.stop'];", to: "['refresh', 'project.select', 'run.stop', 'run.start'];" },
  { name: "control-center-gate-open", rule: "PS-5", rel: STOP_REL, from: "  if (CONTROL_CENTER_VERBS_UNDER_STOP.includes(verb)) return null;\n  return platformStopRefusal(sys, stateDir);", to: "  return null;" },
  // PS-6
  { name: "malformed-means-running", rule: "PS-6", rel: STOP_REL, from: "  if (read.kind === 'absent') return null;", to: "  if (read.kind === 'absent' || read.kind === 'unreadable') return null;" },
  { name: "invalid-is-absent", rule: "PS-6", rel: STOP_REL, from: "if ('why' in parsed) return { kind: 'unreadable', path, why: parsed.why };", to: "if ('why' in parsed) return { kind: 'absent', path };" },
  { name: "unreadable-file-is-absent", rule: "PS-6", rel: STOP_REL, from: "return present ? { kind: 'unreadable', path, why: 'it exists or is unreachable, but could not be read' } : { kind: 'absent', path };", to: "return { kind: 'absent', path };" },
  { name: "unreachable-is-absent", rule: "PS-6", rel: STOP_REL, from: "present = sys.exists(path) || !definitelyAbsent(path);", to: "present = sys.exists(path);" },
  { name: "any-error-is-absent", rule: "PS-6", rel: STOP_REL, from: "if ((error as { code?: unknown }).code !== 'ENOENT') return false;", to: "void error;" },
  { name: "history-unchecked", rule: "PS-6", rel: STOP_REL, from: "  if (!(r['history'] as unknown[]).every(validEvent)) return null;", to: "" },
  { name: "lift-without-commit-accepted", rule: "PS-6", rel: STOP_REL, from: "    if (typeof r['liftCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(r['liftCommit'])) return null;", to: "" },
  // PS-7
  { name: "unresolvable-means-running", rule: "PS-7", rel: STOP_REL, from: "return { kind: 'unresolvable' };", to: "return { kind: 'absent', path: '' };" },
  { name: "context-null-falls-back", rule: "PS-7", rel: STOP_REL, from: "return typeof named === 'string' && named.trim() !== '' ? named : null;", to: "return typeof named === 'string' && named.trim() !== '' ? named : defaultPlatformStopStateDir();" },
  { name: "environment-override", rule: "PS-7", rel: STOP_REL, from: "  if (!('platformStopStateDir' in ctx)) return defaultPlatformStopStateDir();", to: "  if (!('platformStopStateDir' in ctx)) return process.env['PROJECTOS_STOP_DIR'] ?? defaultPlatformStopStateDir();" },
  // PS-8
  { name: "implementer-may-lift", rule: "PS-8", rel: STOPCMD_REL, from: "ownerCommitIdentityProblems(identity, owner, null)", to: "ownerCommitIdentityProblems(identity, owner, { name: 'ProjectOS implementer', email: 'projectos-implementer@projectos.invalid' })" },
  { name: "any-committer-may-lift", rule: "PS-8", rel: STOPCMD_REL, from: "  const problems = ownerCommitIdentityProblems(identity, owner, null);", to: "  const problems: string[] = [];" },
  { name: "dirty-lift-accepted", rule: "PS-8", rel: STOPCMD_REL, from: "return { state: dirty.stdout.trim() === '' ? 'committed' : 'dirty', commit };", to: "return { state: 'committed', commit };" },
  { name: "working-tree-lift-record", rule: "PS-8", rel: STOPCMD_REL, from: "const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);", to: "const shown = { code: 0, stdout: sys.readText(join(root, rel)) ?? '' };" },
  { name: "lift-for-another-stop", rule: "PS-8", rel: STOPCMD_REL, from: " || committed['stopId'] !== stopId) {", to: ") {" },
  { name: "lift-mismatched-engaged-stop", rule: "PS-8", rel: STOPCMD_REL, from: "if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {", to: "if (read.record.state !== 'engaged') {" },
  { name: "owner-from-working-plan", rule: "PS-8", rel: STOPCMD_REL, from: "const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;", to: "const owner = gc.ok ? String((gc.context.plan['governance'] as Record<string, unknown> | undefined)?.['owner'] ?? '') || null : null;" },
  { name: "lift-not-compare-and-swap", rule: "PS-8", rel: STOP_REL, from: "    { stillApplies: stillEngaged },", to: "    {}," },
  // PS-9
  { name: "as-owner-lifts", rule: "PS-9", rel: STOPCMD_REL, from: "  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);", to: "  if (flags['as'] === 'owner') recordPlatformStopLift(sys, stateDir, stopId, 'f'.repeat(40));\n  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);" },
  { name: "as-owner-skips-identity", rule: "PS-9", rel: STOPCMD_REL, from: "  if (problems.length > 0) {", to: "  if (problems.length > 0 && str(flags, 'as') !== 'owner') {" },
  // PS-10
  { name: "statement-softened", rule: "PS-10", rel: STOP_REL, from: "'made all stand. A worker that is already running is not killed; it ends at its next check. The '", to: "'made all stand. A worker that is already running is stopped. The '" },
  { name: "statement-overclaims-proof", rule: "PS-10", rel: STOP_REL, from: "'stop id retyped in a terminal — not cryptographic proof of the owner; a later phase adds Windows Hello.'", to: "'stop id retyped in a terminal — proof of the owner.'" },
  { name: "statement-dropped-from-refusal", rule: "PS-10", rel: STOP_REL, from: "    STOP_LIFT_HINT,\n    PLATFORM_STOP_STATEMENT,\n  ];\n}\n\n/**\n * The Control Center", to: "    STOP_LIFT_HINT,\n  ];\n}\n\n/**\n * The Control Center" },
  { name: "statement-dropped-from-lift-answers", rule: "PS-10", rel: STOPCMD_REL, from: "  return { code, lines: [...lines, PLATFORM_STOP_STATEMENT] };", to: "  return { code, lines };" },
  { name: "lift-refusal-bypasses-statement", rule: "PS-10", rel: STOPCMD_REL, from: "    return liftAnswer(2, ['REFUSED (LIFT_CONFIRMATION_MISMATCH):", to: "    return fail(2, ['REFUSED (LIFT_CONFIRMATION_MISMATCH):" },
  { name: "copy-paste-lift-command", rule: "PS-10", rel: STOP_REL, from: "    `  - ${consequence}`,\n    STOP_LIFT_HINT,", to: "    `  - ${consequence}`,\n    `  - lift it: projectos stop lift --stop ${r.stopId}`," },
  // PS-11
  { name: "lift-writes-elsewhere", rule: "PS-11", rel: STOPCMD_REL, from: "sys.writeText(abs, liftRequestText(stopId, sys.now()));", to: "sys.writeText(join(root, '.projectops', 'authority', 'closure-delegation.json'), liftRequestText(stopId, sys.now()));" },
  { name: "lift-commits-itself", rule: "PS-11", rel: STOPCMD_REL, from: "  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);", to: "  sys.exec('git', ['-C', root, 'commit', '-m', 'lift']);\n  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);" },
  { name: "record-removed", rule: "PS-11", rel: STOP_REL, from: "  const changed = opts.stillApplies?.() ?? null;", to: "  sys.removeFile(path);\n  const changed = opts.stillApplies?.() ?? null;" },
  { name: "lift-path-unchecked", rule: "PS-11", rel: STOP_REL, from: "return isStopId(stopId) ? `${STOP_LIFTS_REL}/${stopId}.json` : null;", to: "return `${STOP_LIFTS_REL}/${stopId}.json`;" },
  // PS-12
  { name: "check-asks-git", rule: "PS-12", rel: STOP_REL, from: "  const path = platformStopPath(stateDir);\n  let raw: string | null;", to: "  const path = platformStopPath(stateDir);\n  sys.exec('git', ['rev-parse', 'HEAD']);\n  let raw: string | null;" },
  // PS-13
  { name: "confirmation-skipped", rule: "PS-13", rel: STOPCMD_REL, from: "  const confirmation = platformStopConfirmOf(ctx)(stopId);", to: "  const confirmation = { kind: 'typed' as const, text: stopId };" },
  { name: "no-terminal-accepted", rule: "PS-13", rel: STOPCMD_REL, from: "  if (confirmation.kind !== 'typed') {", to: "  if (false) {" },
  { name: "loose-typed-match", rule: "PS-13", rel: STOPCMD_REL, from: "  if (confirmation.text !== stopId) {", to: "  if (confirmation.kind === 'typed' && confirmation.text.trim().toLowerCase() !== stopId.toLowerCase()) {" },
  { name: "stdin-tty-not-required", rule: "PS-13", rel: STOP_REL, from: "if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'no-terminal' };", to: "if (t.stdoutIsTTY !== true) return { kind: 'no-terminal' };" },
  { name: "default-confirms-silently", rule: "PS-13", rel: STOP_REL, from: "return typeof named === 'function' ? (named as StopLiftConfirm) : terminalStopLiftConfirm();", to: "return typeof named === 'function' ? (named as StopLiftConfirm) : (id: string) => ({ kind: 'typed' as const, text: id });" },
  // PS-14
  { name: "sweep-commit-accepted", rule: "PS-14", rel: STOPCMD_REL, from: "if (touched === null || touched.paths.length !== 1 || touched.paths[0] !== expected) {", to: "if (touched === null || !touched.paths.includes(expected)) {" },
  { name: "relative-hides-the-sweep", rule: "PS-14", rel: STOPCMD_REL, from: "'show', '--name-only', '--format=', commit]", to: "'show', '--name-only', '--relative', '--format=', commit]" },
  // PS-15
  { name: "project-binding-skipped", rule: "PS-15", rel: STOPCMD_REL, from: "  if (binding !== null) return liftAnswer(2, [`REFUSED (LIFT_WRONG_PROJECT): ${binding}. The stop stays engaged.`, ...asIgnored(flags)]);", to: "" },
  { name: "foreign-root-accepted", rule: "PS-15", rel: STOPCMD_REL, from: " || !sameStopPath(here.root, bound.root)) {", to: ") {" },
  { name: "install-root-unchecked", rule: "PS-15", rel: STOPCMD_REL, from: "if (!sameStopPath(ctx.root, platformStopInstallRootOf(ctx)) || here === null) {", to: "if (here === null) {" },
  { name: "engage-unbound", rule: "PS-15", rel: STOPCMD_REL, from: "    project: governedProjectOf(ctx.sys, ctx.root),", to: "    project: null," },
  // PS-16
  { name: "end-of-run-claims-nothing", rule: "PS-16", rel: RUNNER_REL, from: "  const haltedAtEnd = platformStopRefusal(sys, stopDir, STOP_AFTER_WORK);", to: "  const haltedAtEnd = platformStopRefusal(sys, stopDir);" },
  { name: "post-ask-claims-nothing", rule: "PS-16", rel: CLOSURE_REL, from: "  const haltedBeforeCommit = platformStopRefusal(sys, platformStopDirOf(ctx), STOP_AFTER_ASK);", to: "  const haltedBeforeCommit = platformStopRefusal(sys, platformStopDirOf(ctx));" },
  { name: "consequence-ignored", rule: "PS-16", rel: STOP_REL, from: "    `  - ${consequence}`,", to: "    `  - ${STOP_NOTHING_DONE}`," },
  // PS-17
  { name: "commit-not-rechecked", rule: "PS-17", rel: TC_REL, from: "  const stoppedBeforeCommit = platformStopRefusal(sys, request.platformStopStateDir, STOP_BEFORE_ACT);", to: "  const stoppedBeforeCommit = null as readonly string[] | null;" },
  { name: "push-not-rechecked", rule: "PS-17", rel: TC_REL, from: "  const stoppedBeforePush = platformStopRefusal(sys, request.platformStopStateDir, STOP_BEFORE_ACT);", to: "  const stoppedBeforePush = null as readonly string[] | null;" },
  { name: "merge-not-rechecked", rule: "PS-17", rel: TC_REL, from: "  const stoppedBeforeMerge = platformStopRefusal(sys, request.platformStopStateDir, STOP_BEFORE_ACT);", to: "  const stoppedBeforeMerge = null as readonly string[] | null;" },
  { name: "records-commit-not-rechecked", rule: "PS-17", rel: TC_REL, from: "  const stoppedBeforeRecordsCommit = platformStopRefusal(sys, request.platformStopStateDir, STOP_BEFORE_ACT);", to: "  const stoppedBeforeRecordsCommit = null as readonly string[] | null;" },
  { name: "records-push-not-rechecked", rule: "PS-17", rel: TC_REL, from: "  const stoppedBeforeRecordsPush = platformStopRefusal(sys, request.platformStopStateDir, STOP_AFTER_COMMIT);", to: "  const stoppedBeforeRecordsPush = null as readonly string[] | null;" },
  { name: "records-entry-not-checked", rule: "PS-17", rel: TC_REL, from: "  const stoppedAtEntry = platformStopRefusal(sys, request.platformStopStateDir);", to: "  const stoppedAtEntry = null as readonly string[] | null;" },
  // PS-18
  { name: "unverified-temporary", rule: "PS-18", rel: STOP_REL, from: "  if (stagedRecord === null || 'why' in stagedRecord || stagedRecord.record.stopId !== next.stopId || stagedRecord.record.state !== next.state) {", to: "  if (false) {" },
  { name: "damaged-not-restored", rule: "PS-18", rel: STOP_REL, from: "    if (opts.aside !== undefined) sys.renameFile(opts.aside, path);", to: "" },
  { name: "aside-before-staging", rule: "PS-18", rel: STOP_REL, from: "  const temporary = `${path}.tmp`;\n  try {\n    sys.writeText(temporary,", to: "  const temporary = `${path}.tmp`;\n  if (opts.aside !== undefined) sys.renameFile(path, opts.aside);\n  try {\n    sys.writeText(temporary," },
  // PS-19
  { name: "environment-names-the-directory", rule: "PS-19", rel: STOP_REL, from: "  return sameStopPath(derived, configured) ? derived : null;", to: "  return configured;" },
  { name: "environment-home", rule: "PS-19", rel: STOP_REL, from: "    home = os.userInfo().homedir;", to: "    home = os.homedir();" },
  { name: "check-defaults-to-environment", rule: "PS-19", rel: STOP_REL, from: "  stateDir: string | null | undefined = defaultPlatformStopStateDir(),\n  consequence", to: "  stateDir: string | null | undefined = nodeInstallationStateDir(),\n  consequence" },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
}

/** Strip comments outside strings — the same walk `val-projectos-kernel-cost-cap1a` uses. */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** A function's text from its declaration to the next top-level declaration — enough to scope a count. */
function fnSpan(text, name) {
  const start = text.search(new RegExp(String.raw`(export )?function ${name}\(`));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/\n(export )?(function |const [A-Z_]+ =|type |interface )/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

const has = (src, pin) => (pin instanceof RegExp ? pin.test(src) : src.includes(pin));
const all = (src, pins) => pins.every((p) => has(src, p));

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("PS-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = code(raw[rel]);
  }
  const stopSrc = src[STOP_REL];
  const cmd = src[STOPCMD_REL];
  const cli = src[CLI_REL];
  const runner = src[RUNNER_REL];
  const tc = src[TC_REL];

  // PS-1: the CLI asks the one check before dispatching anything, and allows only by name.
  const allow = fnSpan(cli, "readOnlyUnderPlatformStop");
  if (!all(cli, [PIN.cliGate, PIN.cliDenyDefault, PIN.cliClosure, PIN.cliPhaseApprove, PIN.cliPlan, PIN.cliWorkforce, PIN.cliMcp, PIN.cliReport, PIN.cliReexport]) ||
      PIN.cliMutatingAllowed.test(allow)) {
    E("PS-1", "the CLI gate is missing, allows by default, or lets a command through that can act");
  }
  // PS-2: every runner step that can act asks again, and a halt mid-run is recorded BLOCKED.
  const runnerPins = ["runnerEntry", "runnerDispatch", "runnerConsult", "runnerCandidate", "runnerReviewer", "runnerDegraded", "runnerReceipts", "runnerContinuation", "runnerFinal", "runnerHalt", "runnerExecutorDir"];
  const missingRunner = runnerPins.filter((k) => !has(runner, PIN[k]));
  const finalAt = runner.search(PIN.runnerFinal);
  const completeAt = runner.indexOf("state: stop === null ? 'COMPLETE' : 'BLOCKED',");
  if (missingRunner.length > 0 || finalAt < 0 || completeAt < 0 || finalAt > completeAt) {
    E("PS-2", `the run loop no longer asks the stop at every step that can act (${missingRunner.join(", ") || "final check after COMPLETE"})`);
  }
  // PS-3: every command the CLI gate does not cover by itself asks for itself.
  const commandPins = [
    [CLOSURE_REL, ["closurePrepare", "closureRequest", "closureResume", "closureBeforeAsk", "closureBeforeCommit", "closureBeforeClose"]],
    [PHASE_REL, ["phaseNew", "phaseAdvance"]],
    [PLAN_REL, ["planDraft", "planActivate", "planApprove", "planDecide"]],
    [RECONCILE_REL, ["reconcile"]],
    [RUN_REL, ["runEntry", "continueEntry", "runLoopDir"]],
  ];
  const missingCommands = commandPins.flatMap(([rel, keys]) => keys.filter((k) => !has(src[rel], PIN[k])));
  if (missingCommands.length > 0) E("PS-3", `a governed command no longer refuses under the stop before acting (${missingCommands.join(", ")})`);
  // PS-4: delegations are suspended at their one resolver, and no spend, continuation or records commit runs.
  if (!all(src[GK_REL], [PIN.deciderSuspended, PIN.suspensionCheck, PIN.technicalSuspended, PIN.closureCommitSuspended, PIN.spendRefused]) ||
      !all(tc, [PIN.continuationRefused, PIN.recordsRefused])) {
    E("PS-4", "a delegation, a paid call, the technical continuation or the records commit stays live under the stop");
  }
  // PS-5: the bridge records a real stop; the sidecar asks the agent's one gate before any in-process act.
  const sidecar = src[SIDECAR_REL];
  const handlerAt = sidecar.indexOf("function handleGovernedCommand(");
  const sidecarAt = sidecar.search(PIN.sidecarCheck);
  const firstAct = Math.min(
    ...["startGovernedRun(root,", "startOffLoopCommand({", "const COMMANDS = {"].map((n) => {
      const i = sidecar.indexOf(n, handlerAt);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    }),
  );
  if (!all(src[BRIDGE_REL], [PIN.bridgeEngages, PIN.bridgeError]) || src[BRIDGE_REL].includes("stop requested and recorded") ||
      !PIN.sidecarImport.test(sidecar) || sidecarAt < handlerAt || sidecarAt > firstAct ||
      !all(stopSrc, [PIN.ccVerbs, PIN.ccGate])) {
    E("PS-5", "the owner bridge claims a stop it does not record, or the Control Center acts without asking the stop");
  }
  // PS-6: a damaged or unreachable record is a stop. Absent and validly lifted are the only "running" answers.
  const refusalFn = fnSpan(stopSrc, "platformStopRefusal");
  if (!all(stopSrc, [PIN.absentRunning, PIN.liftedRunning, PIN.invalidJson, PIN.invalidRecord, PIN.invalidUnreadable, PIN.unreadableFile, PIN.unreachableProbe, PIN.enoentOnly, PIN.schemaChecked, PIN.stateChecked, PIN.historyChecked, PIN.projectChecked, PIN.liftNamesStop, PIN.liftNamesCommit]) ||
      (refusalFn.match(/return null;/g) || []).length !== 2 || /'unreadable'\) return null/.test(refusalFn)) {
    E("PS-6", "a malformed, unreachable or unaccountable record can read as running");
  }
  // PS-7: no directory is a stop, the test seam cannot fall back to a real one, and nothing reads the environment.
  if (!all(stopSrc, [PIN.unresolvable, PIN.contextNull, PIN.osDefaultDir]) || !PIN.unresolvableRefuses.test(stopSrc) || /process\.env/.test(stopSrc)) {
    E("PS-7", "an unresolvable state directory can read as running, or the stop can be pointed elsewhere");
  }
  // PS-8: the owner's git name made the commit of the committed record for exactly this stop; the lift is a CAS.
  const verify = fnSpan(cmd, "verifyAndLift");
  const ownerAt = verify.indexOf(PIN.ownerOnly);
  const liftAt = verify.indexOf("recordPlatformStopLift(");
  if (!all(cmd, [PIN.ownerOnly, PIN.committedOwner, PIN.identityOf, PIN.dirtyChecked, PIN.committedBytes, PIN.liftMatches, PIN.engagedMatches, PIN.ownerRefuses]) ||
      !all(stopSrc, [PIN.casRead, PIN.casUsed]) || ownerAt < 0 || liftAt < ownerAt ||
      /ownerCommitIdentityProblems\([^)]*PROJECTOS_COMMIT|ownerCommitIdentityProblems\(identity, owner, \{/.test(cmd)) {
    E("PS-8", "the lift no longer requires the owner's git name on the committed lift record for exactly this stop, compare-and-swapped");
  }
  // PS-9: a command-line role never lifts. `as` is read only to say it was ignored, and the lift is written once.
  if ((cmd.match(/recordPlatformStopLift\(/g) || []).length !== 1 ||
      /flags\[['"]as['"]\]\s*===\s*['"]owner|str\(flags, ['"]as['"]\)/.test(cmd) ||
      !cmd.includes("return flags['as'] === undefined ? [] :")) {
    E("PS-9", "`--as owner` (or any command-line role) can lift the stop or skip the owner's commit");
  }
  // PS-10: the honest statement is exact; every refusal, engagement, status and EVERY lift answer carries it;
  // no output carries a lift command an agent could paste.
  const liftFns = ["lift", "requestOwnerCommit", "verifyAndLift"].map((n) => fnSpan(cmd, n)).join("\n");
  if (!PIN.statementText.every((p) => stopSrc.includes(p)) ||
      (refusalFn.match(/PLATFORM_STOP_STATEMENT,/g) || []).length !== 3 ||
      !fnSpan(stopSrc, "engagedLines").includes("PLATFORM_STOP_STATEMENT,") ||
      !fnSpan(stopSrc, "platformStopStatusLines").includes("PLATFORM_STOP_STATEMENT") ||
      !PIN.liftAnswer.test(cmd) || /\b(fail|ok)\(/.test(liftFns) ||
      !stopSrc.includes(PIN.liftHint) || (refusalFn.match(/STOP_LIFT_HINT,/g) || []).length !== 1 ||
      /stop lift --stop \$\{|git add \$\{|git commit -m/.test(stopSrc + cmd)) {
    E("PS-10", "a stop output no longer carries the honest statement, a lift answer bypasses it, or an output carries a pasteable lift command");
  }
  // PS-11: the stop writes only its record (through a temporary file) and the lift file, and commits nothing.
  const writesIn = (s, re) => (s.match(re) || []).length;
  if (!all(stopSrc, [PIN.recordWrite, PIN.recordTemp, PIN.recordPath, PIN.liftsDir, PIN.liftRelFn, PIN.stopIdShape]) ||
      writesIn(stopSrc, /sys\.writeText\(/g) !== 1 || writesIn(stopSrc, /sys\.renameFile\(/g) !== 3 || /sys\.(removeFile|createExclusive|exec)\(/.test(stopSrc) ||
      /\b(writeFileSync|renameSync|rmSync|unlinkSync|appendFileSync)\b/.test(stopSrc) ||
      !all(cmd, [PIN.liftWrite, PIN.liftAbs, PIN.liftRel]) ||
      writesIn(cmd, /sys\.writeText\(/g) !== 1 || /sys\.(renameFile|removeFile|createExclusive)\(/.test(cmd) ||
      /sys\.exec\('git', \[[^\]]*'(commit|push|add|reset|checkout|rm|restore|update-ref)'/.test(cmd)) {
    E("PS-11", "engaging or lifting the stop writes, moves, removes or commits something other than the stop record and the lift file");
  }
  // PS-12: the check reads one file and runs nothing.
  if (["readPlatformStop", "platformStopRefusal", "validRecord", "definitelyAbsent", "parseRecord"].some((n) => /exec\(/.test(fnSpan(stopSrc, n)))) {
    E("PS-12", "the emergency stop check runs a command");
  }
  // PS-13: the lift needs the stop id retyped exactly, and the production confirmation needs a terminal on both ends.
  const confirmAt = verify.indexOf(PIN.confirmAsked);
  if (!all(cmd, [PIN.confirmAsked, PIN.confirmTerminal, PIN.confirmExact]) || confirmAt < 0 || liftAt < confirmAt ||
      !all(stopSrc, [PIN.ttyBoth, PIN.ttyFromProcess, PIN.confirmDefault])) {
    E("PS-13", "the lift no longer needs the stop id retyped exactly in an interactive terminal");
  }
  // PS-14: the lift commit carries the lift record and nothing else, compared repository-wide.
  const aloneAt = verify.indexOf(PIN.commitAlone);
  if (!all(cmd, [PIN.commitPaths, PIN.commitAlone, PIN.commitPrefix]) || /--relative/.test(cmd) || aloneAt < 0 || liftAt < aloneAt) {
    E("PS-14", "a commit that also carries other files (a sweep) can lift the stop");
  }
  // PS-15: engaging binds the stop to its project; a lift runs only from the same project, or the installation root.
  const liftFn = fnSpan(cmd, "lift");
  const bindAt = liftFn.indexOf(PIN.bindingAsked);
  const writeAt = liftFn.indexOf("requestOwnerCommit(");
  if (!all(cmd, [PIN.bindingAsked, PIN.bindingRefuses, PIN.bindingSameProject, PIN.bindingInstallRoot, PIN.engageBinds]) ||
      !src[BRIDGE_REL].includes(PIN.bridgeBinds) || bindAt < 0 || writeAt < bindAt) {
    E("PS-15", "a lift from another repository or plan, or outside the installation root, can lift the stop");
  }
  // PS-16: a refusal says truthfully what the refusing step had already done.
  if (!stopSrc.includes(PIN.honestDefault) || !/`  - \$\{consequence\}`,/.test(refusalFn) ||
      !all(runner, [PIN.honestEnd, PIN.honestReviewer, PIN.honestDispatch]) || !all(src[CLOSURE_REL], [PIN.honestAsk, PIN.honestClose])) {
    E("PS-16", "a refusal after real work or a paid call says nothing was started, spent, committed or pushed");
  }
  // PS-17: the stop is asked again immediately before every commit, push and integration.
  if (!all(tc, [PIN.actCommit, PIN.actPush, PIN.actMerge, PIN.actRecordsEntry, PIN.actRecordsCommit, PIN.actRecordsPush, PIN.actRecordsDir])) {
    E("PS-17", "a commit, push or integration can run without the stop being asked immediately before it");
  }
  // PS-18: a standing stop is never dropped: stage and verify first, then move aside, then move in, restoring on failure.
  const writeFn = fnSpan(stopSrc, "writeRecord");
  const order = [PIN.recordWrite, PIN.stagedRead, PIN.stagedChecked, PIN.casAsked, PIN.asideMove, PIN.recordMove, PIN.asideRestore].map((p) => writeFn.indexOf(p));
  if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i < order[k - 1]) || (writeFn.match(/sys\.renameFile\(path, opts\.aside\)/g) || []).length !== 1) {
    E("PS-18", "replacing the record can drop a standing stop: the new record is not staged and verified before the old one moves, or it is not restored");
  }
  // PS-19: the directory is the operating system's, and the environment can only make it unverifiable.
  if (!all(stopSrc, [PIN.osHome, PIN.osAgrees, PIN.osDefaultDir]) || !refusalFn.includes(PIN.osDefaultParam) ||
      !fnSpan(stopSrc, "controlCenterVerbRefusal").includes(PIN.osDefaultParam) || /os\.homedir\(/.test(stopSrc)) {
    E("PS-19", "the stop's directory can be chosen by an environment variable rather than derived from the operating system");
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`PS-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`PS-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`PS-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`PS-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-kernel-platform-stop1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-kernel-platform-stop1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };

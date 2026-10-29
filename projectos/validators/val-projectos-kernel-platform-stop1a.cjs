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
  ],
  "projectos/agent/test/loopRunner.test.ts": [
    "[PLATFORM-STOP] engaged before the run: zero worker starts, zero writes, zero gatekeeper calls",
    "[PLATFORM-STOP] engaged during the first attempt: no second dispatch, BLOCKED, and the gatekeeper is never called",
    "[PLATFORM-STOP] a stop engaged while a refused worker was out means the reviewer is not paid to look",
  ],
  "projectos/agent/test/mcpBridge.test.ts": [
    "[PLATFORM-STOP] stop-work really engages the platform stop, and says what it cannot undo",
  ],
};

/** The first-statement check every command entry carries. */
const ENTRY = String.raw`const halted = platformStopRefusal\(ctx\.sys, platformStopDirOf\(ctx\)\);\s*if \(halted !== null\) return fail\(2, halted\);`;
const ENTRY_SYS = String.raw`const halted = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(halted !== null\) return fail\(2, halted\);`;
const PLAN_FN = (name) => new RegExp(String.raw`function ${name}\(ctx: CommandContext, flags: Record<string, string \| boolean>\): CommandResult \{\s*${ENTRY}`);

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
  cliReexport: "export { platformStopRefusal, PLATFORM_STOP_STATEMENT } from './loop/platformStop.js';",
  // PS-2
  runnerEntry: /export function runLoop\(sys: System, root: string, options: RunOptions = \{\}\): RunResult \{\s*const stopDir = options\.platformStopStateDir;\s*const stoppedAtEntry = platformStopRefusal\(sys, stopDir\);\s*if \(stoppedAtEntry !== null\) return refused\(stoppedAtEntry\);\s*const contextResult = loadGovernedContext\(sys, root\);/,
  runnerDispatch: /const haltedDispatch = platformStopRefusal\(sys, stopDir\);\s*if \(haltedDispatch !== null\) return haltMidRun\(haltedDispatch, attempts\);\s*options\.onWorkState\?\.\(\{\s*state: 'WAITING_AI',/,
  runnerConsult: /const consultGatekeeper = \(candidate: LoopStop, evidenceText: string\): 'retry' \| 'proceed' \| null => \{\s*const haltedReview = platformStopRefusal\(sys, stopDir\);\s*if \(haltedReview !== null\) \{[\s\S]{0,300}?return null;\s*\}/,
  runnerCandidate: /const recordLocalCandidate = \(\): Record<string, unknown> \| null => \{\s*const haltedCandidate = platformStopRefusal\(sys, stopDir\);\s*if \(haltedCandidate !== null\) \{\s*localCandidateRefusal = haltedCandidate;\s*return \{ available: false,/,
  runnerReviewer: /const haltedReviewer = platformStopRefusal\(sys, stopDir\);\s*if \(haltedReviewer !== null\) return haltMidRun\(haltedReviewer, attempts\);\s*if \(decision\.kind === 'stop' && decision\.reason\.code === 'REVIEW_OUTSTANDING' && outstandingIndependent\.length > 0\) \{\s*const reviewed = runIndependentReview\(/,
  runnerDegraded: /const degradedContinuation = \(candidate: LoopStop, cause: GatekeeperUnavailabilityCause\): DegradedOutcome => \{\s*const haltedDegraded = platformStopRefusal\(sys, stopDir\);\s*if \(haltedDegraded !== null\) \{[\s\S]{0,300}?return \{ kind: 'REFUSED', reasons: haltedDegraded \};/,
  runnerReceipts: /const payForPendingOwnerGates = \(\): boolean => \{\s*if \(platformStopRefusal\(sys, stopDir\) !== null\) \{[\s\S]{0,200}?return false;\s*\}/,
  runnerContinuation: /const runContinuation = \(\): ContinuationResult => \{\s*const haltedContinuation = platformStopRefusal\(sys, stopDir\);\s*if \(haltedContinuation !== null\) \{[\s\S]{0,300}?return \{ kind: 'REFUSED',/,
  runnerFinal: /const haltedAtEnd = platformStopRefusal\(sys, stopDir\);\s*if \(haltedAtEnd !== null\) \{\s*return haltMidRun\(/,
  runnerHalt: /const haltMidRun = \(refusal: readonly string\[\], attempt: number\): RunResult => \{\s*options\.onWorkState\?\.\(\{\s*state: 'BLOCKED',[\s\S]{0,300}?ownerRequired: true,\s*\}\);\s*return refused\(\[\.\.\.lines, \.\.\.refusal\]\);/,
  runnerExecutorDir: "platformStopStateDir: stopDir,",
  // PS-3
  closurePrepare: new RegExp(String.raw`export function closurePrepare\(ctx: CommandContext, flags: Flags\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureRequest: new RegExp(String.raw`export function closureRequest\(ctx: CommandContext, flags: Flags, makeDeps\?: MakeClosureDeps\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureResume: new RegExp(String.raw`export function closureResume\(ctx: CommandContext, flags: Flags, ownerWait: OwnerCommitWaitPorts = \{\}\): CommandResult \{\s*const \{ sys, root \} = ctx;\s*${ENTRY_SYS}`),
  closureBeforeAsk: /const haltedBeforeAsk = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(haltedBeforeAsk !== null\) return fail\(2,[\s\S]{0,200}?\);\s*const turn: ClosureTurnResult =/,
  closureBeforeCommit: /const haltedBeforeCommit = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(haltedBeforeCommit !== null\) \{\s*return fail\(2,[\s\S]{0,300}?\}\s*if \(modeResolution\.mode !== 'unattended' \|\| !closureCommitGrant/,
  closureBeforeClose: /const haltedBeforeClose = platformStopRefusal\(sys, platformStopDirOf\(ctx\)\);\s*if \(haltedBeforeClose !== null\) \{\s*return fail\(2,[\s\S]{0,300}?\}\s*const advanced = phaseCommand\(/,
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
  bridgeCase: /case 'stop-work':\s*return stopWork\(deps\)\.lines;/,
  bridgeEngages: /function stopWork\(deps: BridgeDeps\): ReturnType<typeof engagePlatformStop> \{\s*return engagePlatformStop\(deps\.ctx\.sys, deps\.stateDir,/,
  bridgeError: /if \(verdict\.operation === 'stop-work'\) \{\s*const engaged = stopWork\(deps\);\s*return ok\(request, toolResult\(engaged\.lines, engaged\.kind === 'FAILED'\)\);/,
  sidecarCheck: /if \(check\.request\.verb !== 'refresh' && check\.request\.verb !== 'run\.stop'\) \{\s*const halted = platformStopRefusal\(agentSystem\);\s*if \(halted !== null\) \{\s*emit\(2, halted, check\.request\.verb\);/,
  sidecarImport: /setGovernanceEngines, platformStopRefusal \} from '@projectos\/agent';/,
  // PS-6
  absentRunning: "if (read.kind === 'absent') return null;",
  liftedRunning: "if (read.kind === 'ok' && read.record.state === 'lifted') return null;",
  invalidJson: "return { kind: 'unreadable', path, why: 'it is not valid JSON' };",
  invalidRecord: "if (record === null) return { kind: 'unreadable', path, why: 'it is not a valid platform stop record' };",
  unreadableFile: "return present ? { kind: 'unreadable', path, why: 'it exists but could not be read' } : { kind: 'absent', path };",
  schemaChecked: "if (r['schemaVersion'] !== PLATFORM_STOP_SCHEMA_VERSION) return null;",
  stateChecked: "if (r['state'] !== 'engaged' && r['state'] !== 'lifted') return null;",
  liftNamesStop: "if (r['liftedStopId'] !== r['stopId']) return null;",
  liftNamesCommit: "if (typeof r['liftCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(r['liftCommit'])) return null;",
  // PS-7
  unresolvable: "if (stateDir === null || stateDir.trim() === '') return { kind: 'unresolvable' };",
  unresolvableRefuses: /if \(read\.kind === 'unresolvable'\) \{\s*return \[\s*'REFUSED \(PLATFORM_STOP_UNVERIFIABLE\)/,
  contextNull: "return typeof named === 'string' && named.trim() !== '' ? named : null;",
  // PS-8
  ownerOnly: "const problems = ownerCommitIdentityProblems(identity, owner, null);",
  ownerRefuses: /if \(problems\.length > 0\) \{\s*return fail\(2, \[\s*`REFUSED \(LIFT_NOT_OWNER_COMMIT\)/,
  committedOwner: "const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;",
  identityOf: "const identity = commitIdentityOf(sys, root, rel);",
  dirtyChecked: "return { state: dirty.stdout.trim() === '' ? 'committed' : 'dirty', commit };",
  committedBytes: "const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);",
  liftMatches: "if (committed === null || committed['kind'] !== STOP_LIFT_KIND || committed['stopId'] !== stopId) {",
  engagedMatches: "if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {",
  recordRechecks: "if (read.kind !== 'ok' || read.record.state !== 'engaged' || read.record.stopId !== stopId) {",
  // PS-10
  statementText: [
    "'This stop does NOT reverse completed external effects: commits already pushed, paid provider calls '",
    "'already made, messages already sent and payments already made all stand. A worker that is already '",
    "'running is not killed; it ends at its next check. The ProjectOS Host service is not touched.'",
  ],
  // PS-11
  recordWrite: "sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\\n`);",
  recordTemp: "const temporary = `${path}.tmp`;",
  recordPath: "const path = platformStopPath(stateDir);",
  recordMove: "if (!sys.renameFile(temporary, path)) {",
  asideMove: "if (!sys.renameFile(read.path, aside)) {",
  liftWrite: "sys.writeText(abs, liftRequestText(stopId, sys.now()));",
  liftAbs: "const abs = join(root, rel);",
  liftRel: "const rel = stopLiftRelPath(stopId) as string;",
  liftsDir: "export const STOP_LIFTS_REL = '.projectops/stop-lifts';",
  liftRelFn: "return isStopId(stopId) ? `${STOP_LIFTS_REL}/${stopId}.json` : null;",
  stopIdShape: "const STOP_ID = /^STOP-[0-9TZ]{8,16}-[0-9a-f]{12}$/;",
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
  { name: "runner-dispatch-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedDispatch = platformStopRefusal(sys, stopDir);", to: "    const haltedDispatch = null as readonly string[] | null;" },
  { name: "runner-gatekeeper-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedReview = platformStopRefusal(sys, stopDir);", to: "    const haltedReview = null as readonly string[] | null;" },
  { name: "runner-candidate-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedCandidate = platformStopRefusal(sys, stopDir);", to: "    const haltedCandidate = null as readonly string[] | null;" },
  { name: "runner-reviewer-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedReviewer = platformStopRefusal(sys, stopDir);", to: "    const haltedReviewer = null as readonly string[] | null;" },
  { name: "runner-degraded-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedDegraded = platformStopRefusal(sys, stopDir);", to: "    const haltedDegraded = null as readonly string[] | null;" },
  { name: "runner-receipt-burned", rule: "PS-2", rel: RUNNER_REL, from: "    if (platformStopRefusal(sys, stopDir) !== null) {", to: "    if (false) {" },
  { name: "runner-continuation-deleted", rule: "PS-2", rel: RUNNER_REL, from: "    const haltedContinuation = platformStopRefusal(sys, stopDir);", to: "    const haltedContinuation = null as readonly string[] | null;" },
  { name: "runner-final-deleted", rule: "PS-2", rel: RUNNER_REL, from: "  const haltedAtEnd = platformStopRefusal(sys, stopDir);", to: "  const haltedAtEnd = null as readonly string[] | null;" },
  { name: "runner-halt-reported-as-success", rule: "PS-2", rel: RUNNER_REL, from: "    return refused([...lines, ...refusal]);", to: "    return { ok: true, lines, phaseId, sessionId, stop: null, attempts: attempt };" },
  // PS-3
  { name: "closure-prepare-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "export function closurePrepare(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n", to: "export function closurePrepare(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  return closureStatus(ctx, flags);\n" },
  { name: "closure-request-before-ask-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeAsk = platformStopRefusal(sys, platformStopDirOf(ctx));", to: "  const haltedBeforeAsk = null as readonly string[] | null;" },
  { name: "closure-request-before-commit-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeCommit = platformStopRefusal(sys, platformStopDirOf(ctx));", to: "  const haltedBeforeCommit = null as readonly string[] | null;" },
  { name: "closure-resume-before-close-deleted", rule: "PS-3", rel: CLOSURE_REL, from: "  const haltedBeforeClose = platformStopRefusal(sys, platformStopDirOf(ctx));", to: "  const haltedBeforeClose = null as readonly string[] | null;" },
  { name: "phase-advance-deleted", rule: "PS-3", rel: PHASE_REL, from: "function phaseAdvance(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function phaseAdvance(ctx: CommandContext, flags: Flags): CommandResult {\n  const { sys, root } = ctx;\n  const halted = null as readonly string[] | null;" },
  { name: "phase-new-deleted", rule: "PS-3", rel: PHASE_REL, from: "and `closure resume` calls `phase advance` for a delegated close — none of them through the CLI gate.\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "and `closure resume` calls `phase advance` for a delegated close — none of them through the CLI gate.\n  const halted = null as readonly string[] | null;" },
  { name: "plan-draft-deleted", rule: "PS-3", rel: PLAN_REL, from: "An authored draft is a paid provider call; a decision is committed; activation materialises a plan.\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "An authored draft is a paid provider call; a decision is committed; activation materialises a plan.\n  const halted = null as readonly string[] | null;" },
  { name: "plan-decide-deleted", rule: "PS-3", rel: PLAN_REL, from: "function decide(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function decide(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = null as readonly string[] | null;" },
  { name: "plan-activate-deleted", rule: "PS-3", rel: PLAN_REL, from: "function activate(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));", to: "function activate(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {\n  const halted = null as readonly string[] | null;" },
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
  { name: "bridge-claims-without-recording", rule: "PS-5", rel: BRIDGE_REL, from: "      return stopWork(deps).lines;", to: "      return ['stop requested and recorded'];" },
  { name: "sidecar-unchecked", rule: "PS-5", rel: SIDECAR_REL, from: "    const halted = platformStopRefusal(agentSystem);", to: "    const halted = null;" },
  { name: "sidecar-run-start-allowed", rule: "PS-5", rel: SIDECAR_REL, from: "  if (check.request.verb !== 'refresh' && check.request.verb !== 'run.stop') {", to: "  if (check.request.verb !== 'refresh' && check.request.verb !== 'run.stop' && check.request.verb !== 'run.start') {" },
  // PS-6
  { name: "malformed-means-running", rule: "PS-6", rel: STOP_REL, from: "  if (read.kind === 'absent') return null;", to: "  if (read.kind === 'absent' || read.kind === 'unreadable') return null;" },
  { name: "invalid-json-is-absent", rule: "PS-6", rel: STOP_REL, from: "return { kind: 'unreadable', path, why: 'it is not valid JSON' };", to: "return { kind: 'absent', path };" },
  { name: "unreadable-file-is-absent", rule: "PS-6", rel: STOP_REL, from: "return present ? { kind: 'unreadable', path, why: 'it exists but could not be read' } : { kind: 'absent', path };", to: "return { kind: 'absent', path };" },
  { name: "lift-without-commit-accepted", rule: "PS-6", rel: STOP_REL, from: "    if (typeof r['liftCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(r['liftCommit'])) return null;", to: "" },
  // PS-7
  { name: "unresolvable-means-running", rule: "PS-7", rel: STOP_REL, from: "return { kind: 'unresolvable' };", to: "return { kind: 'absent', path: '' };" },
  { name: "context-null-falls-back", rule: "PS-7", rel: STOP_REL, from: "return typeof named === 'string' && named.trim() !== '' ? named : null;", to: "return typeof named === 'string' && named.trim() !== '' ? named : nodeInstallationStateDir();" },
  { name: "environment-override", rule: "PS-7", rel: STOP_REL, from: "  if (!('platformStopStateDir' in ctx)) return nodeInstallationStateDir();", to: "  if (!('platformStopStateDir' in ctx)) return process.env['PROJECTOS_STOP_DIR'] ?? nodeInstallationStateDir();" },
  // PS-8
  { name: "implementer-may-lift", rule: "PS-8", rel: STOPCMD_REL, from: "ownerCommitIdentityProblems(identity, owner, null)", to: "ownerCommitIdentityProblems(identity, owner, { name: 'ProjectOS implementer', email: 'projectos-implementer@projectos.invalid' })" },
  { name: "any-committer-may-lift", rule: "PS-8", rel: STOPCMD_REL, from: "  const problems = ownerCommitIdentityProblems(identity, owner, null);", to: "  const problems: string[] = [];" },
  { name: "dirty-lift-accepted", rule: "PS-8", rel: STOPCMD_REL, from: "return { state: dirty.stdout.trim() === '' ? 'committed' : 'dirty', commit };", to: "return { state: 'committed', commit };" },
  { name: "working-tree-lift-record", rule: "PS-8", rel: STOPCMD_REL, from: "const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);", to: "const shown = { code: 0, stdout: sys.readText(join(root, rel)) ?? '' };" },
  { name: "lift-for-another-stop", rule: "PS-8", rel: STOPCMD_REL, from: " || committed['stopId'] !== stopId) {", to: ") {" },
  { name: "lift-mismatched-engaged-stop", rule: "PS-8", rel: STOPCMD_REL, from: "if (read.record.state !== 'engaged' || read.record.stopId !== stopId) {", to: "if (read.record.state !== 'engaged') {" },
  { name: "owner-from-working-plan", rule: "PS-8", rel: STOPCMD_REL, from: "const owner = gc.ok ? committedGovernanceOwner(sys, root, gc.context.planPath) : null;", to: "const owner = gc.ok ? String((gc.context.plan['governance'] as Record<string, unknown> | undefined)?.['owner'] ?? '') || null : null;" },
  // PS-9
  { name: "as-owner-lifts", rule: "PS-9", rel: STOPCMD_REL, from: "  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);", to: "  if (flags['as'] === 'owner') recordPlatformStopLift(sys, stateDir, stopId, 'f'.repeat(40));\n  if (git.state === 'uncommitted') return requestOwnerCommit(sys, abs, rel, stopId, flags);" },
  { name: "as-owner-skips-identity", rule: "PS-9", rel: STOPCMD_REL, from: "  if (problems.length > 0) {", to: "  if (problems.length > 0 && str(flags, 'as') !== 'owner') {" },
  // PS-10
  { name: "statement-softened", rule: "PS-10", rel: STOP_REL, from: "'running is not killed; it ends at its next check. The ProjectOS Host service is not touched.'", to: "'running is stopped.'" },
  { name: "statement-dropped-from-refusal", rule: "PS-10", rel: STOP_REL, from: "    ...nextSteps(r.stopId),\n    PLATFORM_STOP_STATEMENT,\n", to: "    ...nextSteps(r.stopId),\n" },
  { name: "statement-dropped-from-lift", rule: "PS-10", rel: STOPCMD_REL, from: "    '  governed commands and delegations work again from their own checks; nothing that was refused is resumed by this',\n    PLATFORM_STOP_STATEMENT,\n", to: "    '  governed commands and delegations work again from their own checks; nothing that was refused is resumed by this',\n" },
  // PS-11
  { name: "lift-writes-elsewhere", rule: "PS-11", rel: STOPCMD_REL, from: "sys.writeText(abs, liftRequestText(stopId, sys.now()));", to: "sys.writeText(join(root, '.projectops', 'authority', 'closure-delegation.json'), liftRequestText(stopId, sys.now()));" },
  { name: "lift-commits-itself", rule: "PS-11", rel: STOPCMD_REL, from: "  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);", to: "  sys.exec('git', ['-C', root, 'commit', '-m', 'lift']);\n  const written = recordPlatformStopLift(sys, stateDir, stopId, liftCommit);" },
  { name: "record-removed", rule: "PS-11", rel: STOP_REL, from: "    const aside = `${read.path}.unreadable-${stopId}`;", to: "    sys.removeFile(read.path);\n    const aside = `${read.path}.unreadable-${stopId}`;" },
  { name: "lift-path-unchecked", rule: "PS-11", rel: STOP_REL, from: "return isStopId(stopId) ? `${STOP_LIFTS_REL}/${stopId}.json` : null;", to: "return `${STOP_LIFTS_REL}/${stopId}.json`;" },
  // PS-12
  { name: "check-asks-git", rule: "PS-12", rel: STOP_REL, from: "  const path = platformStopPath(stateDir);\n  let raw: string | null;", to: "  const path = platformStopPath(stateDir);\n  sys.exec('git', ['rev-parse', 'HEAD']);\n  let raw: string | null;" },
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

  // PS-1: the CLI asks the one check before dispatching anything, and allows only by name.
  const allow = fnSpan(cli, "readOnlyUnderPlatformStop");
  if (![PIN.cliGate, PIN.cliDenyDefault, PIN.cliClosure, PIN.cliPhaseApprove, PIN.cliPlan, PIN.cliWorkforce, PIN.cliMcp, PIN.cliReport, PIN.cliReexport].every((p) => has(cli, p)) ||
      PIN.cliMutatingAllowed.test(allow)) {
    E("PS-1", "the CLI gate is missing, allows by default, or lets a command through that can act");
  }
  // PS-2: every runner step that can act asks again, and a halt mid-run is recorded BLOCKED.
  const runnerPins = ["runnerEntry", "runnerDispatch", "runnerConsult", "runnerCandidate", "runnerReviewer", "runnerDegraded", "runnerReceipts", "runnerContinuation", "runnerFinal", "runnerHalt", "runnerExecutorDir"];
  const missingRunner = runnerPins.filter((k) => !has(runner, PIN[k]));
  const finalAt = runner.search(PIN.runnerFinal);
  const completeAt = runner.indexOf("state: stop === null ? 'COMPLETE' : 'BLOCKED',");
  if (missingRunner.length > 0 || finalAt < 0 || completeAt < 0 || finalAt > completeAt) {
    E("PS-2", `the run loop no longer asks the platform stop at every step that can act (${missingRunner.join(", ") || "final check after COMPLETE"})`);
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
  const gk = src[GK_REL];
  const tc = src[TC_REL];
  if (![PIN.deciderSuspended, PIN.suspensionCheck, PIN.technicalSuspended, PIN.closureCommitSuspended, PIN.spendRefused].every((p) => has(gk, p)) ||
      ![PIN.continuationRefused, PIN.recordsRefused].every((p) => has(tc, p))) {
    E("PS-4", "a delegation, a paid call, the technical continuation or the records commit stays live under the stop");
  }
  // PS-5: the bridge's stop-work records a real stop, and the sidecar refuses before any in-process dispatch.
  const sidecar = src[SIDECAR_REL];
  const sidecarAt = sidecar.search(PIN.sidecarCheck);
  const firstAct = Math.min(
    ...["startGovernedRun(root,", "startOffLoopCommand({", "const COMMANDS = {"].map((n) => {
      const i = sidecar.indexOf(n, sidecar.indexOf("function handleGovernedCommand("));
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    }),
  );
  if (![PIN.bridgeCase, PIN.bridgeEngages, PIN.bridgeError].every((p) => has(src[BRIDGE_REL], p)) ||
      src[BRIDGE_REL].includes("stop requested and recorded") ||
      !PIN.sidecarImport.test(sidecar) || sidecarAt < 0 || sidecarAt > firstAct) {
    E("PS-5", "the owner bridge claims a stop it does not record, or the Control Center sidecar acts without asking the stop");
  }
  // PS-6: a damaged record is a stop. Absent and validly lifted are the only "running" answers.
  const refusalFn = fnSpan(stopSrc, "platformStopRefusal");
  if (![PIN.absentRunning, PIN.liftedRunning, PIN.invalidJson, PIN.invalidRecord, PIN.unreadableFile, PIN.schemaChecked, PIN.stateChecked, PIN.liftNamesStop, PIN.liftNamesCommit].every((p) => stopSrc.includes(p)) ||
      (refusalFn.match(/return null;/g) || []).length !== 2 || /'unreadable'\) return null/.test(refusalFn)) {
    E("PS-6", "a malformed, unreadable or unaccountable record can read as running");
  }
  // PS-7: no directory is a stop, the test seam cannot fall back to the real one, and nothing reads the environment.
  if (![PIN.unresolvable, PIN.contextNull].every((p) => stopSrc.includes(p)) || !PIN.unresolvableRefuses.test(stopSrc) || /process\.env/.test(stopSrc)) {
    E("PS-7", "an unresolvable state directory can read as running, or the stop can be pointed elsewhere");
  }
  // PS-8: the lift is the owner's commit, of the committed record naming THIS stop, judged with NO delegated committer.
  const verify = fnSpan(cmd, "verifyAndLift");
  const ownerAt = verify.indexOf(PIN.ownerOnly);
  const liftAt = verify.indexOf("recordPlatformStopLift(");
  if (![PIN.ownerOnly, PIN.committedOwner, PIN.identityOf, PIN.dirtyChecked, PIN.committedBytes, PIN.liftMatches, PIN.engagedMatches].every((p) => cmd.includes(p)) ||
      !PIN.ownerRefuses.test(cmd) || !stopSrc.includes(PIN.recordRechecks) || ownerAt < 0 || liftAt < ownerAt ||
      /ownerCommitIdentityProblems\([^)]*PROJECTOS_COMMIT|ownerCommitIdentityProblems\(identity, owner, \{/.test(cmd)) {
    E("PS-8", "the lift no longer requires the owner's own commit of the committed lift record for exactly this stop");
  }
  // PS-9: a command-line role never lifts. `as` is read only to say it was ignored, and the lift is written once.
  if ((cmd.match(/recordPlatformStopLift\(/g) || []).length !== 1 ||
      /flags\[['"]as['"]\]\s*===\s*['"]owner|str\(flags, ['"]as['"]\)/.test(cmd) ||
      !cmd.includes("return flags['as'] === undefined ? [] :")) {
    E("PS-9", "`--as owner` (or any command-line role) can lift the stop or skip the owner's commit");
  }
  // PS-10: the honest statement is exact, and every refusal, engagement, status and lift carries it.
  const engagedFn = fnSpan(stopSrc, "engagedLines");
  if (!PIN.statementText.every((p) => stopSrc.includes(p)) ||
      (refusalFn.match(/PLATFORM_STOP_STATEMENT,/g) || []).length !== 3 ||
      !engagedFn.includes("PLATFORM_STOP_STATEMENT,") ||
      !fnSpan(stopSrc, "platformStopStatusLines").includes("PLATFORM_STOP_STATEMENT") ||
      !fnSpan(cmd, "verifyAndLift").includes("PLATFORM_STOP_STATEMENT,")) {
    E("PS-10", "a stop output no longer says that completed effects are not reversed and a running worker ends at its next check");
  }
  // PS-11: the stop writes only its record (through a temporary file, moved into place) and the lift file.
  const writesIn = (s, re) => (s.match(re) || []).length;
  if (![PIN.recordWrite, PIN.recordTemp, PIN.recordPath, PIN.recordMove, PIN.asideMove, PIN.liftsDir, PIN.liftRelFn, PIN.stopIdShape].every((p) => stopSrc.includes(p)) ||
      writesIn(stopSrc, /sys\.writeText\(/g) !== 1 || writesIn(stopSrc, /sys\.renameFile\(/g) !== 2 || /sys\.(removeFile|createExclusive|exec)\(/.test(stopSrc) ||
      ![PIN.liftWrite, PIN.liftAbs, PIN.liftRel].every((p) => cmd.includes(p)) ||
      writesIn(cmd, /sys\.writeText\(/g) !== 1 || /sys\.(renameFile|removeFile|createExclusive)\(/.test(cmd) ||
      /sys\.exec\('git', \[[^\]]*'(commit|push|add|reset|checkout|rm|restore|update-ref)'/.test(cmd)) {
    E("PS-11", "engaging or lifting the stop writes, moves, removes or commits something other than the stop record and the lift file");
  }
  // PS-12: the check reads one file and runs nothing.
  if (/exec\(/.test(fnSpan(stopSrc, "readPlatformStop")) || /exec\(/.test(refusalFn) || /exec\(/.test(fnSpan(stopSrc, "validRecord"))) {
    E("PS-12", "the platform stop check runs a command");
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

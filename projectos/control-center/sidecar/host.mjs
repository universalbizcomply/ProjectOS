#!/usr/bin/env node
/**
 * ProjectOS daemon sidecar — the Node process the Tauri Rust host launches.
 *
 * It runs a real BridgeDaemon (nodeSystem) and reuses the tested InProcessTransport to project
 * daemon state; every TransportMessage is written as one JSON line to stdout, which the Rust host
 * forwards to the webview over the `daemon://message` event channel. It reads commands from stdin.
 *
 * MOST COMMANDS ARE READ-ONLY. `phase`, `approve`, `report` and `plan` never commit, push, deploy
 * or mutate anything beyond the ordinary governed records those canonical commands already write.
 *
 * `run.start` / `run.resume` / `run.stop` ARE THE EXCEPTION, and deliberately so (PROJECTOS-
 * PRODUCT-COMPLETION1A): they spawn the real `projectos run` process — the same one proven live
 * throughout PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — as a CHILD of this sidecar, not detached. It
 * dies with the sidecar (Windows Job Object kill-on-close, or an explicit stop). This channel
 * decides WHETHER the loop runs; it decides NOTHING about what the loop may do once it does — every
 * delegation check, owner gate, correction boundary and protected-action refusal inside `runLoop`
 * is exactly the one already proven, unchanged by who presses the button.
 *
 * LIFECYCLE (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B)
 * -------------------------------------------------
 * The host cannot infer readiness from ordinary output: `transport.connect()` emits
 * `{"kind":"snapshot",…}`, and so does every later snapshot and bus event — same shape, no version,
 * no instance. So this process announces readiness EXPLICITLY, exactly once, as its final startup
 * step, on a distinct discriminant (`type`, not `kind`):
 *
 *   {"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"…","status":"read-only"}
 *
 * Readiness is not trust, not identity, and enables no approvals — it only means "startup finished
 * and the command channel is live".
 *
 * The graceful shutdown below is CLEANUP ONLY. It is NOT the parent-death guarantee: the host binds
 * this process to a Windows Job Object with kill-on-close, and that is what survives a force-kill.
 *
 * Run `npm run build:sidecar` first (emits node-build/) so the import below resolves.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve as resolvePath, join as joinPath, isAbsolute, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { BridgeDaemon, nodeSystem, loadConfig } from '@projectos/bridge-daemon';
import { InProcessTransport } from '../node-build/daemon/inProcessTransport.js';
import {
  projectGovernedState,
  ACTIVE_PHASE_STATUSES,
} from '../node-build/governed/governedProjection.js';
import { validateGovernedCommand, toAgentInvocation } from '../node-build/governed/governedCommands.js';
import {
  parseProjectArgs,
  buildProjectInventory,
  toInventoryMessage,
  resolveProjectRoot,
  decideSelection,
  defaultSelection,
  restoreSelection,
  serialiseSelection,
  SELECTION_FILE_NAME,
  GOVERNED_PROJECTS_MESSAGE_KIND,
  GOVERNED_PORTFOLIO_MESSAGE_KIND,
  toProjectSummary,
} from '../node-build/governed/projectInventory.js';
import { phase as phaseCommand, approve as approveCommand, report as reportCommand, plan as planCommand, nodeSystem as agentSystem, setGovernanceEngines } from '@projectos/agent';
import { gitBoundSystem } from './gitBoundSystem.mjs';
import { startOffLoopCommand } from './offLoopCommand.mjs';

/* --- THE GOVERNANCE ENGINES, COMPOSED HERE ---------------------------------------------------
 * These four are the canonical governance artefacts from `projectos/validators` and
 * `projectos/schemas`. They used to be resolved at RUN time, by each consumer, with
 * `require(resolve(here, '../../validators/…'))`. That worked in a development checkout and only
 * there: from a packaged installation the same relative path points outside the payload, at a
 * ProjectOS source tree the installation does not have.
 *
 * As STATIC imports they are linked into the daemon bundle at build time, so the packaged artefact
 * carries the engines themselves rather than a path to where they used to live. The security
 * property is unchanged and slightly stronger: the code that governs a project is fixed when the
 * artefact is built and covered by its digest, so a governed project cannot substitute it — and now
 * neither can anything else.
 *
 * In development this file runs directly under Node, which resolves the same four files from the
 * checkout. One program, one set of engines; only the route differs.
 */
import governanceEngine from '../../validators/plan-governance-engine.cjs';
import discoveryEngine from '../../validators/plan-discovery-engine.cjs';
import planSchema from '../../schemas/project-plan.schema.json' with { type: 'json' };
import currentStateSchema from '../../schemas/current-project-state.schema.json' with { type: 'json' };

setGovernanceEngines({
  governance: governanceEngine,
  discovery: discoveryEngine,
  planSchema,
  currentStateSchema,
});

const LIFECYCLE_PROTOCOL_VERSION = 1;
/** Bounded: the id is a short non-secret correlator, never a credential. */
const MAX_INSTANCE_ID_LEN = 64;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const EXIT_OK = 0;
const EXIT_BAD_INSTANCE = 3;

/**
 * The host injects this. Its absence means we were not launched by the ProjectOS host, so we refuse
 * to start rather than run unowned.
 */
function readInstanceId() {
  const raw = process.env.PROJECTOS_DAEMON_INSTANCE_ID;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INSTANCE_ID_LEN) return null;
  if (!INSTANCE_ID_PATTERN.test(raw)) return null;
  return raw;
}

/**
 * The daemon's bridge configuration, if the launcher gave it one.
 *
 * IT IS NEVER READ FROM THE WORKING DIRECTORY. This used to be
 * `existsSync('bridge.config.json')` — a bare relative name, resolved against whatever directory the
 * process happened to start in. That is a redirection primitive: drop a `bridge.config.json` beside
 * wherever the daemon is launched and you choose its watch roots, and therefore which repository it
 * treats as governed. cwd is not authority.
 *
 * The path now arrives as ONE absolute path in `PROJECTOS_BRIDGE_CONFIG`, injected by the
 * development launch authority, which is the existing explicit development boundary. A packaged
 * installation sets nothing, so a packaged daemon has no configuration file at all and cannot be
 * pointed at one. A relative value is refused rather than resolved, because a relative value is the
 * ambient behaviour under another name.
 */
function readBridgeConfigText() {
  const declared = process.env.PROJECTOS_BRIDGE_CONFIG;
  if (typeof declared !== 'string' || declared.length === 0) return null;
  if (!isAbsolute(declared)) return null;
  if (!existsSync(declared)) return null;
  try {
    return readFileSync(declared, 'utf8');
  } catch {
    return null;
  }
}

const projectArgs = parseProjectArgs(process.argv.slice(2));

/**
 * The development bridge configuration text, read EXACTLY ONCE at startup.
 *
 * One read, one answer. Reading it separately for "is there one?" and "what does it say?" lets a
 * transient I/O failure make those two answers disagree, which would leave the daemon deciding it is
 * in development while loading the defaults of a run that has no configuration.
 */
const BRIDGE_CONFIG_TEXT = readBridgeConfigText();

/**
 * The governed SYSTEM root: framework state this daemon may read and write. It is NOT a project.
 * Absent in development, where there is no installed host to name one.
 */
function systemRoot() {
  const first = projectArgs.systemRoots[0];
  return typeof first === 'string' && isAbsolute(first) ? resolvePath(first) : null;
}

/**
 * The roots this daemon may govern.
 *
 * PACKAGED: exactly the `--project-root` values the host read from the protected registry. The watch
 * roots are NOT consulted, so a packaged daemon governs the registry's projects and nothing else.
 *
 * DEVELOPMENT: the host passes no project roots, so the watch roots from the authority-bound
 * `PROJECTOS_BRIDGE_CONFIG` are used instead. That is the existing, accepted development boundary —
 * one absolute path injected by the development launch authority — and a packaged installation sets
 * that variable nowhere, so this branch is unreachable from one.
 */
/**
 * Whether this run is a DEVELOPMENT run. Decided ONCE, at startup, from TWO independent signals.
 *
 * A bridge configuration is present AND no registry status was supplied. The second condition is the
 * one that matters: the packaged launch authority ALWAYS passes `--project-registry-status`, even
 * when zero projects validated, so its presence is proof the launcher was the packaged one. Relying
 * on the absence of `PROJECTOS_BRIDGE_CONFIG` alone would make this file's safety depend entirely on
 * an environment allowlist maintained in another crate; if that allowlist were ever loosened, this
 * would silently accept the redirection. Now it takes both.
 */
const DEVELOPMENT_RUN = BRIDGE_CONFIG_TEXT !== null && projectArgs.registryStatus === null;

function candidateProjects(config) {
  if (projectArgs.suppliedProjects.length > 0) return projectArgs.suppliedProjects;
  if (!DEVELOPMENT_RUN) return [];
  // DEVELOPMENT ONLY. The watch roots come from the authority-bound absolute path the development
  // launch authority injected, and carry no registry-bound identity because there is no registry.
  return config.watchRoots.map((root) => ({ boundProjectId: null, repositoryRoot: root }));
}

function resolveConfig() {
  const { config } = loadConfig(BRIDGE_CONFIG_TEXT);
  return { ...config, watchRoots: [...config.watchRoots, ...projectArgs.systemRoots] };
}

/* --- governed state (READ-ONLY) -------------------------------------------------------------
 * The daemon's own model is NOT the governance authority: it carries a twelve-stage `PhaseStage`
 * spine of its own, while `@projectos/core` carries the nine-status governed lifecycle persisted to
 * `.projectops/phases/<id>.json`. The owner surface must read the SECOND one, so this reads the
 * canonical records directly and projects them with the same pure function the browser tests use.
 * Reads only. It never writes, and it never decides readiness itself — the real
 * `plan-governance-engine.cjs` does that, resolved beside this package so a target project cannot
 * substitute its own engine.
 */
const DEFAULT_PLAN_RELPATH = '.projectops/plan.json';
/** The project's own configuration, relative to its repository root. Spelled once. */
const PROJECT_CONFIG_SEGMENTS = ['.projectops', 'project-config.json'];

/** The engine linked into this artefact at build time — the same one the agent package was given. */
function loadEngine() {
  return governanceEngine;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** Same confinement rule as the runtime: a declared path may never leave its project root. */
function resolveDeclared(engine, root, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (!engine.isSafeRepoRelativePath(rel)) return null;
  return joinPath(root, rel);
}

function readPhaseRecords(root) {
  const dir = joinPath(root, '.projectops', 'phases');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/**
 * The closure DECISIONS, keyed by phase id.
 *
 * The projection is pure and cannot read files, so it is handed these. Without them a closed phase
 * record would be believed on the strength of its own role string — and a role is a string anyone
 * able to write the record can write. Reading them here is what lets the surface apply exactly the
 * rule the runtime applies.
 */
function readClosureDecisions(root) {
  const dir = joinPath(root, '.projectops', 'closure', 'decisions');
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null && typeof rec.phaseId === 'string') out[rec.phaseId] = rec;
  }
  return out;
}

/**
 * The gatekeeper's own config and spend ledger — both read-only, both already-canonical files the
 * loop itself writes and reads. Absent means "not configured" or "nothing spent yet", never an
 * error: most projects legitimately have no gatekeeper wired up at all.
 */
function readGatekeeperConfig(root) {
  return readJsonFile(joinPath(root, '.projectops', 'gatekeeper.json'));
}

function readGatekeeperLedger(root) {
  const raw = readJsonFile(joinPath(root, '.projectops', 'gatekeeper-ledger.json'));
  const entries = raw && Array.isArray(raw.entries) ? raw.entries : [];
  return entries;
}

/** Every `.projectops/approvals/<id>.json` record, whatever its state — the projection filters. */
function readApprovalRecords(root) {
  const dir = joinPath(root, '.projectops', 'approvals');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/** Every drafted plan proposal — `.projectops/drafts/<id>.json`. */
function readDraftRecords(root) {
  const dir = joinPath(root, '.projectops', 'drafts');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/**
 * The credential router, resolved exactly like the governed runtime CLI (see `agentCliPath`), or
 * `null` when this installation cannot reach one.
 */
function credentialRouterPath() {
  const root = systemRoot();
  if (root !== null) {
    const bound = joinPath(root, 'projectos', 'scripts', 'projectos-credential-router.cjs');
    if (existsSync(bound)) return bound;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const local = resolvePath(here, '..', '..', 'scripts', 'projectos-credential-router.cjs');
  return existsSync(local) ? local : null;
}

/**
 * Credential METADATA for one project, or `null` when it could not be established.
 *
 * NO SECRET CROSSES THIS BOUNDARY, and none can: `credentials status --json` is built from
 * `vault.status`, whose entire value-derived surface is a non-reversible fingerprint. There is no
 * flag that makes it emit a value and no code path here that asks for one.
 *
 * `null` is returned for every failure — router absent, non-zero exit, unparseable output — because
 * "ProjectOS could not ask" and "this project has no credentials" are different facts, and the
 * projection renders them differently. Returning an empty list on failure would quietly assert the
 * second while only the first is known.
 */
function readCredentialRows(projectId) {
  const router = credentialRouterPath();
  if (router === null || typeof projectId !== 'string' || projectId === '') return null;
  try {
    const result = spawnSync(
      process.execPath,
      [router, 'credentials', 'status', '--project', projectId, '--json'],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
    );
    if (result.status !== 0 || typeof result.stdout !== 'string') return null;
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed?.credentials) ? parsed.credentials : null;
  } catch {
    return null;
  }
}

/** Every worker session record — `.projectops/execution/<id>.session.json`. */
function readSessionRecords(root) {
  const dir = joinPath(root, '.projectops', 'execution');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.session.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/**
 * Every plan-approval decision on disk — `.projectops/plan-decisions/<id>.json`.
 *
 * DISPLAY ONLY: whether a decision is genuinely usable (committed, unconsumed, matching this exact
 * project/repository/branch/plan digest) is re-verified for real by `approvePlan` at activation
 * time, from git-committed content, not from this working-tree read. This listing exists so the
 * owner can see a decision exists at all before typing its id into `plan.activate`.
 */
function readPlanDecisionRecords(root) {
  const dir = joinPath(root, '.projectops', 'plan-decisions');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = readJsonFile(joinPath(dir, f));
    if (rec !== null) out.push(rec);
  }
  return out;
}

/** Build the governed state for `root`, or an honest unavailable reason. Never throws. */
function buildGovernedState(root, observedAt) {
  if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
    return {
      connected: false,
      reason: 'NO_RUNTIME',
      detail:
        inventory.projects.length === 0
          ? 'No installed project is available to govern.'
          : 'No project is selected. Choose one to see its plan and state.',
    };
  }
  const cfg = readProjectConfig(root);
  if (cfg === null) {
    return {
      connected: false,
      reason: 'NO_RUNTIME',
      detail: `No ProjectOS project config at ${root}. Governed control needs an installed .projectops.`,
    };
  }
  let engine;
  try {
    engine = loadEngine();
  } catch {
    return { connected: false, reason: 'REFUSED', detail: 'The plan-governance engine could not be loaded.' };
  }

  const declaredPlan = cfg.planMemory && cfg.planMemory.planPath;
  const planPathAbs =
    declaredPlan === undefined
      ? joinPath(root, DEFAULT_PLAN_RELPATH)
      : resolveDeclared(engine, root, declaredPlan);
  if (planPathAbs === null) {
    return {
      connected: false,
      reason: 'REFUSED',
      detail: 'The configured plan location is not a safe project-relative path and was refused.',
    };
  }
  const plan = readJsonFile(planPathAbs);
  if (plan === null) {
    return {
      connected: false,
      reason: 'REFUSED',
      detail: 'No readable approved plan at the configured plan location.',
    };
  }

  let currentState = null;
  const declaredState = cfg.planMemory && cfg.planMemory.currentStatePath;
  if (declaredState !== undefined) {
    const statePathAbs = resolveDeclared(engine, root, declaredState);
    if (statePathAbs === null) {
      return {
        connected: false,
        reason: 'REFUSED',
        detail: 'The configured current-state location is not a safe project-relative path and was refused.',
      };
    }
    currentState = readJsonFile(statePathAbs);
  }

  try {
    return projectGovernedState({
      config: cfg,
      plan,
      currentState,
      phaseRecords: readPhaseRecords(root),
      closureDecisions: readClosureDecisions(root),
      gatekeeperConfig: readGatekeeperConfig(root),
      gatekeeperLedger: readGatekeeperLedger(root),
      approvalRecords: readApprovalRecords(root),
      draftRecords: readDraftRecords(root),
      planDecisionRecords: readPlanDecisionRecords(root),
      sessionRecords: readSessionRecords(root),
      credentialRows: readCredentialRows(String(cfg['projectId'] ?? '')),
      readiness: engine.evaluatePlanReady(plan),
      planPath: declaredPlan === undefined ? DEFAULT_PLAN_RELPATH : declaredPlan,
      branch: null,
      head: null,
      observedAt,
    });
  } catch {
    return { connected: false, reason: 'REFUSED', detail: 'Governed state could not be projected.' };
  }
}

const daemonInstanceId = readInstanceId();
if (daemonInstanceId === null) {
  // Typed startup failure: no ready message is emitted, so the host times out and stops us.
  process.stderr.write('projectos sidecar: missing or invalid PROJECTOS_DAEMON_INSTANCE_ID\n');
  process.exit(EXIT_BAD_INSTANCE);
}

const config = resolveConfig();
// Keep stdout a pure JSON-line protocol channel: route the daemon's own log lines to stderr.
const system = { ...nodeSystem, log: (line) => process.stderr.write(line + '\n') };
const daemon = new BridgeDaemon(system, config);
const transport = new InProcessTransport(daemon);

transport.onMessage((message) => {
  process.stdout.write(JSON.stringify(message) + '\n');
});

/**
 * Execute one governed command against the CANONICAL runtime.
 *
 * The verb set is closed and the arguments are typed, so nothing the browser sends can become a
 * command name, a flag name, a path or a shell string: `toAgentArgv` is a pure total function over
 * that closed set. The agent's own `CommandResult` is returned VERBATIM — a refusal is reported as
 * the runtime worded it, never reworded or softened by this layer.
 *
 * Writes are performed by the canonical agent, never by this file.
 */
function handleGovernedCommand(raw) {
  const correlationId =
    raw && typeof raw.correlationId === 'string' ? raw.correlationId.slice(0, 64) : 'unknown';
  const emit = (code, lines, verb) => {
    process.stdout.write(
      JSON.stringify({ kind: 'governed-result', correlationId, code, lines, verb: verb ?? null }) + '\n',
    );
  };

  const check = validateGovernedCommand(raw);
  if (!check.ok) {
    emit(2, [`REFUSED (${check.code}): ${check.detail}`], null);
    return;
  }
  // SELECTION IS HANDLED HERE, before any project root is required — it is the verb that DECIDES
  // which root the others use. It reaches no canonical agent command and writes nothing inside any
  // project; the only thing it can change is which of the host-supplied projects this surface reads.
  if (check.request.verb === 'project.select') {
    // `emitGovernedState` refreshes on its way out, so the decision below reads the inventory this
    // command was dispatched against rather than re-deriving it twice per command.
    refreshInventory();
    const outcome = decideSelection(
      inventory,
      check.request.args.projectId,
      selectedProjectId,
      governedWorkActive(),
    );
    if (!outcome.ok) {
      emit(2, [`REFUSED (${outcome.code}): ${outcome.detail}`], check.request.verb);
      emitGovernedState({ refresh: false });
      return;
    }
    selectedProjectId = outcome.projectId;
    const remembered = persistSelection(outcome.projectId);
    emit(
      0,
      remembered
        ? [`Selected ${outcome.projectId}.`]
        : [`Selected ${outcome.projectId}. It could not be remembered for the next start.`],
      check.request.verb,
    );
    emitGovernedState({ refresh: false });
    return;
  }

  const root = governedRoot();
  if (root === null) {
    emit(2, ['REFUSED (NO_RUNTIME): no governed project root is available.'], check.request.verb);
    return;
  }

  // GOVERNED EXECUTION, intercepted here — same precedent as `project.select` above: these verbs
  // spawn and track a real process rather than calling a synchronous canonical command, so they
  // never reach `toAgentInvocation`/`COMMANDS` at all.
  if (
    check.request.verb === 'run.start' ||
    check.request.verb === 'run.resume' ||
    check.request.verb === 'run.stop'
  ) {
    const args = check.request.args;
    const outcome =
      check.request.verb === 'run.stop'
        ? stopGovernedRun(root)
        : startGovernedRun(root, args.phaseId, check.request.verb === 'run.resume' ? args.sessionId : undefined);
    emit(outcome.code, outcome.lines, check.request.verb);
    emitGovernedState();
    return;
  }

  const invocation = toAgentInvocation(check.request);

  // PROVIDER-BACKED WORK LEAVES THE EVENT LOOP. This is the one governed command that waits on a
  // network call, and waiting here is what made the daemon look dead. Everything else stays exactly
  // where it was: a short synchronous verb gains nothing from a process boundary and would only pay
  // for one. The decision is made on the ARGUMENT, not the verb, because `plan.draft` without
  // `authored` is corpus-led import and never leaves this machine.
  if (invocation !== null && check.request.verb === 'plan.draft' && invocation.flags.authored === 'true') {
    startOffLoopCommand({
      root,
      invocation,
      verb: check.request.verb,
      emit,
      onSettled: () => emitGovernedState(),
      active: activeOffLoopCommands,
      workerPath: offLoopWorkerPath() ?? '',
    });
    return;
  }

  if (invocation === null) {
    // `refresh` performs nothing; it is served entirely by the existing read path.
    emitGovernedState();
    emit(0, ['Refreshed governed state.'], check.request.verb);
    return;
  }

  // Called as a TYPED function, never as an argv line. There is no parsing step between the
  // validated request and the runtime, so a value can never become a flag name.
  const COMMANDS = { phase: phaseCommand, approve: approveCommand, report: reportCommand, plan: planCommand };
  const fn = COMMANDS[invocation.command];
  if (fn === undefined) {
    emit(2, ['REFUSED (UNKNOWN_VERB): no canonical command for this verb.'], check.request.verb);
    return;
  }
  let result;
  try {
    // `root` is bound as git's working directory, not just handed to the command: the packaged
    // daemon's own cwd is the runtime payload root, which is not a repository, so every ambient
    // git call would otherwise fail closed there. See gitBoundSystem.
    const ctx = { sys: gitBoundSystem(agentSystem, process.env, root), root };
    result =
      invocation.command === 'report'
        ? fn(ctx, invocation.flags)
        : fn(ctx, invocation.flags, invocation.positionals);
  } catch {
    // Redacted on purpose — a raw error can carry a path — but not silent: without a marker a
    // governed-command crash leaves no operational trace at all.
    process.stderr.write('projectos sidecar: governed command failed [redacted]\n');
    emit(2, ['REFUSED (RUNTIME_ERROR): the governed command could not be executed.'], check.request.verb);
    return;
  }
  emit(result.code, result.lines, check.request.verb);
  // Re-read durable state AFTER the command, so the surface shows what actually persisted rather
  // than what the command was expected to do.
  emitGovernedState();
}

/* --- THE INSTALLED-PROJECT INVENTORY AND THE OWNER'S SELECTION -------------------------------
 *
 * The governed project root used to be "the first watched root that carries a `.projectops`" — a
 * scan, and therefore a redirection primitive: whoever could place a `.projectops` directory in a
 * watched root chose which repository ProjectOS governed. It is now the root of the project the
 * owner SELECTED, out of the set the installed host validated against the protected registry.
 *
 * Selection carries an ID. It never carries a path: `resolveProjectRoot` looks the id up in this
 * inventory, so the only roots reachable are the ones already here.
 */

/** Read one project's own configuration, or null. Never throws. */
function readProjectConfig(root) {
  return readJsonFile(joinPath(root, ...PROJECT_CONFIG_SEGMENTS));
}

let inventory = buildProjectInventory(
  candidateProjects(config),
  readProjectConfig,
  projectArgs.registryStatus,
);

/** Where the selection is remembered: beneath the governed SYSTEM root, never inside a project. */
function selectionPath() {
  const root = systemRoot();
  return root === null ? null : joinPath(root, SELECTION_FILE_NAME);
}

/**
 * Restore the remembered selection, then fall back to the single-project default.
 *
 * A remembered id is re-resolved against THIS run's inventory, so a project that has since been
 * unregistered, re-badged or broken restores to nothing rather than to a stale root.
 */
function initialSelection() {
  const path = selectionPath();
  let text = null;
  if (path !== null && existsSync(path)) {
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      text = null;
    }
  }
  return restoreSelection(text, inventory) ?? defaultSelection(inventory);
}

let selectedProjectId = initialSelection();

/** Remember the selection. A failure to persist is reported by the next restart, never swallowed
 *  into a false claim that it was saved — the caller's success does not depend on it. */
function persistSelection(projectId) {
  const path = selectionPath();
  if (path === null) return false;
  try {
    writeFileSync(path, serialiseSelection(projectId), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** The governed project root: the SELECTED project's root, or null when none is selected. */
function governedRoot() {
  return selectedProjectId === null ? null : resolveProjectRoot(inventory, selectedProjectId);
}

/**
 * Emit the governed state on the SAME stdout channel the host already forwards, as an ordinary
 * `kind`-discriminated transport message. Reusing the existing protocol rather than inventing a
 * parallel one means the encode/parse pair, the client dispatch and the store all stay single-sourced.
 */
function emitGovernedState({ refresh = true } = {}) {
  if (refresh) refreshInventory();
  // The inventory FIRST, so the surface knows which project the state that follows belongs to
  // and can never paint one project's plan under another project's name.
  process.stdout.write(
    JSON.stringify({
      kind: GOVERNED_PROJECTS_MESSAGE_KIND,
      // Built by the shared serialiser, so the wire shape and the type the renderer consumes come
      // from ONE declaration rather than from a hand-written literal that can drift away from it.
      inventory: toInventoryMessage(inventory, selectedProjectId),
    }) + '\n',
  );
  const at = new Date().toISOString();
  const state = buildGovernedState(governedRoot(), at);
  process.stdout.write(JSON.stringify({ kind: 'governed', state }) + '\n');

  // THE PORTFOLIO: the same projection, for every registered root, reduced to a row.
  //
  // NOTHING IS SELECTED TO PRODUCE THIS. `buildGovernedState` already takes a root and already only
  // reads — this daemon simply never called it for the roots it was not pointed at. Selection stays
  // what it was: an operational context switch that persists a file and is refused while work is
  // running, so a list must never populate itself by performing one.
  //
  // Liveness comes from `activeRuns`, which is keyed by root, and says only RUNNING or UNKNOWN. A
  // root this daemon is not tracking is not a root with no worker — it may be one whose run began
  // under a daemon that has since exited.
  process.stdout.write(
    JSON.stringify({
      kind: GOVERNED_PORTFOLIO_MESSAGE_KIND,
      portfolio: {
        observedAt: at,
        projects: inventory.projects.map((project) =>
          toProjectSummary(
            { projectId: project.projectId, projectName: project.projectName },
            buildGovernedState(project.repositoryRoot, at),
            activeRuns.has(project.repositoryRoot) ? 'RUNNING' : 'UNKNOWN',
            at,
          ),
        ),
      },
    }) + '\n',
  );
}

/**
 * Re-derive the inventory from the roots this daemon was given.
 *
 * The ROOTS never change while the daemon runs — they came from the host, which read the
 * protected registry once — but a repository can be re-badged underneath them, and an id derived
 * at startup would then be a stale claim. Re-deriving means a project that changed identity stops
 * matching its remembered selection instead of silently continuing to answer to it.
 */
function refreshInventory() {
  inventory = buildProjectInventory(
    candidateProjects(config),
    readProjectConfig,
    projectArgs.registryStatus,
  );
  if (selectedProjectId !== null && resolveProjectRoot(inventory, selectedProjectId) === null) {
    selectedProjectId = defaultSelection(inventory);
  }
}

/**
 * Whether governed work is open in the CURRENTLY selected project.
 *
 * FAILS CLOSED WHEN IT CANNOT TELL. `buildGovernedState` gives up before it reads a single phase
 * record if the configuration or the plan cannot be read — so a locked, corrupted or mid-edit
 * project would report "not connected" while a phase was genuinely open on disk, and a gate that
 * read that as "no work" would permit exactly the switch it exists to prevent. Unreadable therefore
 * counts as ACTIVE. The phase records are read directly, independently of whether the plan parses,
 * so an unreadable PLAN beside readable phases still gives a truthful answer rather than a
 * pessimistic one.
 */
function governedWorkActive() {
  const root = governedRoot();
  if (root === null) return false;
  if (readProjectConfig(root) === null) return true;
  const records = readPhaseRecords(root);
  return records.some((record) => ACTIVE_PHASE_STATUSES.includes(record && record.status));
}

/* --- GOVERNED EXECUTION: spawning and tracking the real `projectos run` process ---------------
 *
 * ONE CHILD PER ROOT, MAP-TRACKED. Keyed by the resolved project root, not by phase id: this
 * architecture has one active phase per project, and the real hazard `run.start` must refuse is
 * two overlapping `runLoop` processes writing into the SAME `.projectops` tree at once — the same
 * concurrent-write hazard the loop's own file-lock discipline (C17-F1) was built to close one
 * layer down. A root already in this map is refused here, before a second process is ever spawned.
 *
 * NOT DETACHED. A `runLoop` invocation is the OWNER'S supervised action, not an unattended
 * background job: if the Control Center closes, the Job Object kill-on-close takes the sidecar and
 * this map's tracked children with it. That is the safe default for something that spends real
 * money and can touch source — an owner-supervised action should stop when its supervisor does,
 * not keep running unobserved. `run.stop` explicitly kills the tree the same way for the same
 * reason: on Windows, `child.kill()` alone does not reach the WORKER process `runLoop` itself
 * spawns as our child's own child, so a stop uses `taskkill /t` to take the whole tree.
 */
const activeRuns = new Map();

/**
 * The governed runtime's CLI entry point, or `null` when this installation cannot reach one.
 *
 * THE DEFECT THIS FIXES. It resolved `<this file>/../../agent/bin/projectos.js` unconditionally.
 * That is correct in a development checkout, where this file sits in `control-center/sidecar/`. In a
 * PACKAGED installation the daemon is a single bundle at `runtime-payload/daemon/`, so the same
 * relative walk points at `<install root>/agent/bin/projectos.js` — which does not exist, and cannot:
 * the payload is a CLOSED set of exactly four attested files (pinned runtime, daemon bundle, trust
 * manifest, canonical bytes) and the closure validator refuses any fifth. So governed execution was
 * unreachable from the installed application, which is the one place it most needs to work.
 *
 * WHY THE GOVERNED SYSTEM ROOT IS THE RIGHT SOURCE, and is not a loosening. It is not read from
 * argv-as-the-caller-pleases: the packaged launch authority derives it from the VERIFIED packaged
 * identity and the protected installation record under ProgramData, which an ordinary user cannot
 * write. So the root is anchored by the same protected record that decides which projects exist at
 * all. Running the governed runtime from the system tree this installation is bound to is precisely
 * what a self-hosting installation is for.
 *
 * It returns `null` rather than guessing when neither route resolves, so a caller REFUSES with a
 * reason instead of spawning a path that is not there.
 */
function agentCliPath() {
  const root = systemRoot();
  if (root !== null) {
    const bound = joinPath(root, 'projectos', 'agent', 'bin', 'projectos.js');
    if (existsSync(bound)) return bound;
  }
  // DEVELOPMENT: this file really is in the checkout, beside the agent package.
  const here = dirname(fileURLToPath(import.meta.url));
  const local = resolvePath(here, '..', '..', 'agent', 'bin', 'projectos.js');
  return existsSync(local) ? local : null;
}

/** Emit one run-lifecycle message on the same JSON-line stdout channel as everything else. */
function emitRunEvent(kind, root, extra = {}) {
  process.stdout.write(JSON.stringify({ kind, root, ...extra }) + '\n');
}

/**
 * Start (or resume) the governed loop for the currently selected project.
 *
 * `sessionId` present means resume; absent means a fresh start. Both paths converge here because
 * the spawn/track/stream machinery is identical — only the argv differs.
 */
/** Off-loop governed commands in flight, keyed by governed root. One at a time, per project. */
const activeOffLoopCommands = new Map();

/** The worker script, beside this file in both the packaged payload and the checkout. */
function offLoopWorkerPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const worker = joinPath(here, 'governedWorker.mjs');
  return existsSync(worker) ? worker : null;
}

function startGovernedRun(root, phaseId, sessionId) {
  if (activeRuns.has(root)) {
    return { code: 2, lines: ['REFUSED (RUN_ALREADY_ACTIVE): a governed run is already in progress for this project.'] };
  }
  // REFUSE WITH A REASON rather than spawn a path that is not there. `agentCliPath` returns null
  // when neither the bound system tree nor a development checkout carries the governed runtime, and
  // spawning `undefined` would fail as an unreadable stream error some distance from the cause.
  const cli = agentCliPath();
  if (cli === null) {
    return {
      code: 2,
      lines: [
        'REFUSED (RUN_RUNTIME_UNAVAILABLE): this installation cannot reach the ProjectOS runtime,',
        '  so governed execution cannot be started from here.',
      ],
    };
  }
  const args =
    sessionId === undefined
      ? [cli, 'run', '--execute']
      : [cli, 'run', '--execute', '--resume', '--session', sessionId];
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch {
    return { code: 2, lines: ['REFUSED (RUN_SPAWN_FAILED): the governed run process could not be started.'] };
  }
  activeRuns.set(root, { child, phaseId: phaseId ?? null });

  const streamLines = (readable, stream) => {
    let buffer = '';
    readable.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) emitRunEvent('run-output', root, { phaseId: phaseId ?? null, stream, line });
    });
  };
  streamLines(child.stdout, 'stdout');
  streamLines(child.stderr, 'stderr');

  child.on('close', (exitCode) => {
    activeRuns.delete(root);
    emitRunEvent('run-finished', root, { phaseId: phaseId ?? null, exitCode: exitCode ?? null });
    // The loop's own writes (session, evidence, ledger, phase records) are already on disk by the
    // time `close` fires; refresh so the surface reflects them without a manual reconnect.
    emitGovernedState();
  });

  emitRunEvent('run-started', root, { phaseId: phaseId ?? null, resumed: sessionId !== undefined });
  return { code: 0, lines: [sessionId === undefined ? 'Governed run started.' : `Governed run resumed (session ${sessionId}).`] };
}

/**
 * `taskkill`, resolved to ONE ABSOLUTE EXECUTABLE — never spawned by bare name.
 *
 * This is the same rule the runtime already applies to `git`, to PowerShell and to the governed
 * worker, and it was the one spawn in this file that did not follow it. A bare name is resolved by
 * searching the spawning process's CURRENT DIRECTORY first, and in a development launch this
 * process's current directory is inside the ProjectOS checkout itself — a governed repository whose
 * contents are untrusted until reviewed. A `taskkill.exe` committed there would have been executed,
 * with this process's authority, the moment the owner pressed Stop.
 *
 * `SystemRoot` is one of the two variables the launch authority passes to this process deliberately,
 * so this needs nothing new. Null when it cannot be resolved: the caller then says what it did
 * instead, rather than pretending.
 */
function taskkillPath() {
  const root = process.env.SystemRoot ?? process.env.windir;
  if (typeof root !== 'string' || root.trim() === '') return null;
  // `joinPath` normalises a trailing separator, so no hand-rolled trimming is needed here.
  const exe = joinPath(root, 'System32', 'taskkill.exe');
  return existsSync(exe) ? exe : null;
}

/**
 * Stop the tracked run for a root, killing the whole process tree, not just the immediate child.
 *
 * EXACTLY ONE PID, AND ONLY WHILE IT IS STILL OURS. Nothing here matches on an executable name, and
 * nothing terminates a process this sidecar did not start: the pid comes from the child in
 * `activeRuns`, and if that child has already ended, no kill is issued at all — a pid stops being an
 * identity the moment its process exits, and the operating system reuses it. Killing a number we no
 * longer own is how an unrelated process gets terminated.
 *
 * SYNCHRONOUS, SO THE ANSWER IS TRUE. This was fire-and-forget inside a `try/catch`, which could not
 * work: `spawn` reports a failure to start asynchronously, so the catch never ran, the documented
 * fallback was unreachable, and an unhandled `error` event on a child process ENDS THIS PROCESS —
 * measured, not assumed. Waiting for `taskkill` costs milliseconds and turns "the run will end
 * shortly" from a hope into something this function actually checked.
 */
function stopGovernedRun(root) {
  const tracked = activeRuns.get(root);
  if (tracked === undefined) {
    return { code: 2, lines: ['REFUSED (NO_ACTIVE_RUN): no governed run is in progress for this project.'] };
  }
  const pid = tracked.child.pid;
  const alreadyEnded = tracked.child.exitCode !== null || tracked.child.signalCode !== null;
  if (typeof pid !== 'number' || alreadyEnded) {
    // FAIL CLOSED. We cannot prove this pid is still the run's, so we terminate nothing and say so.
    return {
      code: 0,
      lines: ['The governed run has already ended; nothing was terminated.'],
    };
  }

  const exe = taskkillPath();
  if (exe === null) {
    // `child.kill()` reaches the run process but NOT the worker it started — that is the whole
    // reason the tree kill exists — so this says exactly what it did and what it left behind.
    const killed = tracked.child.kill();
    return {
      code: killed ? 0 : 2,
      lines: [
        'Stop requested, but the system process tool could not be resolved,',
        '  so only the governed run process was signalled; a worker it started may still be running.',
      ],
    };
  }
  // `/t` takes the tree because on Windows `child.kill()` alone leaves the worker — `runLoop`'s own
  // child of our child — orphaned. `/f` because a bound the child may decline is not a bound.
  const r = spawnSync(exe, ['/pid', String(pid), '/t', '/f'], { encoding: 'utf8', windowsHide: true });
  if (r.status === 0) {
    // The tracked entry is still cleared by the `close` handler, which is what actually observes the
    // process ending; this only reports that the termination was accepted.
    return { code: 0, lines: ['Governed run terminated, together with the worker process tree it started.'] };
  }
  // 128 is `taskkill` saying the pid was already gone — which is the outcome asked for, reached
  // another way. Anything else is a stop that did not happen, and must not be reported as one.
  if (r.status === 128) {
    return { code: 0, lines: ['The governed run had already ended; nothing was left to terminate.'] };
  }
  tracked.child.kill();
  return {
    code: 2,
    lines: [
      'REFUSED (STOP_NOT_CONFIRMED): the process tree could not be confirmed terminated',
      `  (${(r.stderr ?? '').trim() || `exit ${r.status ?? 'unknown'}`}).`,
      '  The governed run process was signalled directly; a worker it started may still be running.',
    ],
  };
}


// --- startup, in order; readiness is announced only after ALL of it ---------------------------
daemon.start();
transport.connect();

const interval = setInterval(() => daemon.tickAt(nodeSystem.monotonicMs()), config.watchIntervalMs);

let shuttingDown = false;
let readyEmitted = false;

/**
 * Idempotent cleanup. Guarded so readline-close, stdin-end, stdin-error, an explicit
 * lifecycle.shutdown and a signal cannot run it twice.
 */
function shutdown(code = EXIT_OK) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    clearInterval(interval);
    transport.disconnect();
    daemon.stop();
  } catch {
    /* bounded cleanup: never let a cleanup fault prevent exit */
  }
  process.exit(code);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (shuttingDown) return; // stop accepting commands
  try {
    const obj = JSON.parse(line);
    if (!obj || typeof obj !== 'object') return;
    // Governed commands are `kind`-discriminated and carry no `cmd`, so they are dispatched BEFORE
    // the legacy `cmd` guard — which would otherwise drop them silently.
    if (obj.kind === 'governed-command') {
      handleGovernedCommand(obj);
      return;
    }
    if (typeof obj.cmd !== 'string') return;
    if (obj.cmd === 'snapshot') {
      transport.requestSnapshot();
      // The owner surface's governed state is re-read on the same trigger, so one snapshot request
      // refreshes both views and they can never drift apart on screen.
      emitGovernedState();
    }
    else if (obj.cmd === 'lifecycle.shutdown') shutdown(EXIT_OK);
  } catch {
    /* ignore malformed command lines */
  }
});

// Parent death / channel loss. The Job Object is the real guarantee; these make exit graceful.
rl.on('close', () => shutdown(EXIT_OK));
process.stdin.on('end', () => shutdown(EXIT_OK));
process.stdin.on('error', () => shutdown(EXIT_OK));
process.on('SIGINT', () => shutdown(EXIT_OK));
process.on('SIGTERM', () => shutdown(EXIT_OK));

// Redact crash evidence: never print a raw stack or object that could carry paths/secrets.
process.on('uncaughtException', () => {
  process.stderr.write('projectos sidecar: uncaught exception [redacted]\n');
  shutdown(1);
});
process.on('unhandledRejection', () => {
  process.stderr.write('projectos sidecar: unhandled rejection [redacted]\n');
  shutdown(1);
});

/**
 * Final startup step: announce readiness exactly once, AFTER the command listeners exist — so
 * readiness truthfully implies the channel is live.
 */
if (!readyEmitted) {
  readyEmitted = true;
  process.stdout.write(
    JSON.stringify({
      type: 'lifecycle.ready',
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      daemonInstanceId,
      status: 'read-only',
    }) + '\n',
  );
  // First governed read AFTER readiness, so the surface never paints authority state from a process
  // that has not finished starting.
  emitGovernedState();
}

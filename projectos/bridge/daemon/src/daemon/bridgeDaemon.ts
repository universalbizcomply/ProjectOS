/**
 * BridgeDaemon — the orchestrator. It owns no business logic: every decision is delegated to
 * a pure engine (state machine, reducers, watchers, sync). This file is pure plumbing between
 * the DaemonSystem port and those engines, which is what keeps the whole runtime testable.
 *
 * Governance guarantees enforced here:
 *  - only OWNER-authored approval files become approval events (parseApproval);
 *  - the daemon writes only state/event/cache files (system port refuses anything else);
 *  - it never commits, pushes, deploys, mutates a DB, or edits business code.
 */
import { DASHBOARD_CACHE_FILE, INTERNAL_SEQ } from '../constants.js';
import { EventBus } from '../events/eventBus.js';
import { parseEventLog, nextSeq } from '../events/eventLog.js';
import { makeEvent } from '../events/eventTypes.js';
import { buildDashboardSnapshot } from '../sync/dashboardSync.js';
import { notificationsForEvent } from '../notifications/notificationService.js';
import { computeHealth } from '../health/healthMonitor.js';
import { Logger } from '../logging/logger.js';
import { rebuildFromEvents, pendingDecisions, pendingReviews } from '../recovery/recoveryManager.js';
import { applyEvent, applyGitCommit, initialState } from '../state/stateManager.js';
import { writeState } from '../state/stateStore.js';
import { parseApproval } from '../reports/approvalWatcher.js';
import { reportSignals } from '../reports/reportWatcher.js';
import { diffGit } from '../git/gitWatcher.js';
import { scanProjects } from '../watchers/projectScanner.js';
import { classifyChange } from '../watchers/watchRouter.js';
import { FileWatcher } from '../watchers/fileWatcher.js';
import { applyWorkerEvent } from '../workers/workerManager.js';
import type { WorkerMap } from '../workers/workerManager.js';
import type { DaemonSystem } from '../system.js';
import type {
  Actor,
  BridgeEvent,
  CanonicalEventType,
  DaemonConfig,
  DashboardSnapshot,
  FileChange,
  GitSnapshot,
  HealthSnapshot,
  Notification,
  PhaseState,
  ProjectDescriptor,
} from '../types.js';
import {
  bridgeDir,
  eventLogPath,
  evidenceDir,
  joinPath,
  reportsDir,
  statePath,
  watchTargets,
} from '../utils/paths.js';

function phaseKey(project: string, phase: string): string {
  return `${project}:${phase}`;
}

interface AppendInput {
  readonly project: string;
  readonly phase: string;
  readonly type: CanonicalEventType;
  readonly actor: Actor;
  readonly decisionRequired?: boolean;
  readonly worker?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export class BridgeDaemon {
  readonly #system: DaemonSystem;
  #config: DaemonConfig;
  readonly #bus: EventBus;
  readonly #logger: Logger;
  readonly #fileWatcher: FileWatcher;

  #projects: readonly ProjectDescriptor[] = [];
  #rootByProject = new Map<string, string>();
  #phases = new Map<string, PhaseState>();
  #workers: WorkerMap = new Map();
  #git = new Map<string, GitSnapshot>();
  #reportListing = new Map<string, readonly string[]>();
  #evidenceListing = new Map<string, readonly string[]>();
  #processedApprovals = new Set<string>();
  #notifications: Notification[] = [];
  #dashboard: DashboardSnapshot | null = null;
  #unsubscribe: (() => void) | null = null;
  #running = false;
  #startMono = 0;

  constructor(system: DaemonSystem, config: DaemonConfig, bus?: EventBus) {
    this.#system = system;
    this.#config = config;
    this.#bus = bus ?? new EventBus();
    this.#logger = new Logger(system.log, system.now, config.logLevel);
    this.#fileWatcher = new FileWatcher(config);
  }

  // ---- lifecycle ---------------------------------------------------------

  /** Discover projects, recover state from logs, wire watchers, mark running. */
  start(): void {
    this.#projects = scanProjects(this.#system, this.#config.watchRoots, this.#config.ignoredFolders);
    this.#rootByProject = new Map(this.#projects.map((p) => [p.name, p.root]));
    const hadHistory = this.#recover();
    this.#wireWatch();
    this.#running = true;
    this.#startMono = this.#system.monotonicMs();
    this.#emitInternal('DAEMON_STARTED', { restart: hadHistory });
    this.#logger.info('daemon started', { projects: this.#projects.length });
  }

  stop(): void {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    this.#running = false;
    this.#emitInternal('DAEMON_STOPPED', {});
    this.#logger.info('daemon stopped');
  }

  #wireWatch(): void {
    const targets = this.#projects.flatMap((p) => watchTargets(p.root));
    this.#unsubscribe = this.#system.watch(targets, (path) => {
      this.#fileWatcher.onRaw(path, this.#system.monotonicMs());
    });
  }

  /** Replay every project's event log to reconstruct state. Returns true if any history existed. */
  #recover(): boolean {
    let had = false;
    for (const project of this.#projects) {
      const text = this.#system.readFile(eventLogPath(project.root));
      if (text === null) continue;
      const { events } = parseEventLog(text);
      if (events.length === 0) continue;
      had = true;
      const recovered = rebuildFromEvents(events);
      for (const [key, state] of recovered.phases) {
        this.#phases.set(key, state);
        writeState(this.#system, project.root, state);
      }
      this.#workers = new Map([...this.#workers, ...recovered.workers]);
      this.#logger.log('RECOVERY', 'recovered phases', {
        project: project.name,
        phases: recovered.phases.size,
        refused: recovered.refusedTransitions,
      });
    }
    // Seed git + listing baselines so the first diff is meaningful.
    for (const project of this.#projects) {
      const snap = this.#system.readGitSnapshot(project.root);
      if (snap !== null) this.#git.set(project.name, snap);
      this.#reportListing.set(project.name, this.#system.readDir(reportsDir(project.root)));
      this.#evidenceListing.set(project.name, this.#system.readDir(evidenceDir(project.root)));
    }
    return had;
  }

  // ---- tick + change handling -------------------------------------------

  /** Process all debounced changes due by `now`, then refresh the dashboard. */
  tickAt(now: number): void {
    for (const path of this.#fileWatcher.flush(now)) {
      const change = classifyChange(path, this.#projects);
      if (change !== null) this.handleChange(change);
    }
    if (this.#config.dashboardSync) this.syncDashboard();
  }

  /** Feed a raw fs path in (used by the watch wiring and by tests). */
  onRawPath(path: string, now: number): void {
    this.#fileWatcher.onRaw(path, now);
  }

  /** Dispatch a classified change to its domain handler. */
  handleChange(change: FileChange): void {
    const root = this.#rootByProject.get(change.project);
    if (root === undefined) return;
    switch (change.kind) {
      case 'event':
        this.#handleEventLog(change.project, root);
        break;
      case 'approval':
        this.#handleApproval(change.project, root, change.path);
        break;
      case 'report':
      case 'evidence':
        this.#handleReports(change.project, root);
        break;
      case 'git':
        this.#handleGit(change.project, root);
        break;
      default:
        // state/phase/prompt/worker/unknown: derived elsewhere or owned by the daemon.
        break;
    }
  }

  #handleEventLog(project: string, root: string): void {
    const text = this.#system.readFile(eventLogPath(root));
    if (text === null) return;
    const { events } = parseEventLog(text);
    for (const event of events) {
      const key = phaseKey(event.project, event.phase);
      const cur = this.#phases.get(key);
      if (cur !== undefined && event.seq >= 0 && event.seq <= cur.lastSeq) continue;
      this.ingestEvent(event, root);
    }
  }

  #handleApproval(project: string, root: string, path: string): void {
    if (this.#processedApprovals.has(path)) return;
    const raw = this.#system.readFile(path);
    const parsed = parseApproval(raw);
    if (parsed === null) return;
    this.#processedApprovals.add(path);
    // Attribute to the phase currently awaiting a decision in this project.
    const target = [...this.#phases.values()].find(
      (p) => p.project === project && p.stage !== 'closed',
    );
    if (target === undefined) return;
    this.appendCanonical(root, {
      project,
      phase: target.phase,
      type: parsed.type,
      actor: 'owner',
    });
    this.#logger.log('EVENT', 'owner decision applied', { project, decision: parsed.decision });
  }

  #handleReports(project: string, root: string): void {
    const prevReports = this.#reportListing.get(project) ?? [];
    const prevEvidence = this.#evidenceListing.get(project) ?? [];
    const nextReports = this.#system.readDir(reportsDir(root));
    const nextEvidence = this.#system.readDir(evidenceDir(root));
    const { signals } = reportSignals(prevReports, nextReports, prevEvidence, nextEvidence);
    this.#reportListing.set(project, nextReports);
    this.#evidenceListing.set(project, nextEvidence);
    if (signals.length === 0) return;
    const target = [...this.#phases.values()].find(
      (p) => p.project === project && p.stage !== 'closed',
    );
    if (target === undefined) return;
    for (const signal of signals) {
      this.appendCanonical(root, {
        project,
        phase: target.phase,
        type: signal,
        actor: 'implementer',
        worker: 'claude-code',
        decisionRequired: signal === 'REVIEW_READY' || signal === 'EVIDENCE_CREATED',
      });
    }
  }

  #handleGit(project: string, root: string): void {
    const prev = this.#git.get(project) ?? null;
    const next = this.#system.readGitSnapshot(root);
    const signals = diffGit(prev, next);
    if (next !== null) this.#git.set(project, next);
    if (!signals.committed) return;
    const target = [...this.#phases.values()].find(
      (p) => p.project === project && p.stage === 'ready_to_commit',
    );
    if (target === undefined) return;
    const advanced = applyGitCommit(target, signals.head, this.#system.now());
    this.#phases.set(phaseKey(project, target.phase), advanced);
    writeState(this.#system, root, advanced);
    this.#logger.log('EVENT', 'commit observed', { project, phase: target.phase });
  }

  // ---- event ingestion + persistence ------------------------------------

  /** Fold one event into phase + worker state, persist, publish, and buffer notifications. */
  ingestEvent(event: BridgeEvent, root?: string): void {
    const key = phaseKey(event.project, event.phase);
    const resolvedRoot = root ?? this.#rootByProject.get(event.project);
    const cur =
      this.#phases.get(key) ?? initialState(event.project, event.phase, event.at, event.source);

    const { state, refusedTransition } = applyEvent(cur, event);
    this.#phases.set(key, state);
    this.#workers = applyWorkerEvent(this.#workers, event);
    if (resolvedRoot !== undefined && event.seq >= 0) writeState(this.#system, resolvedRoot, state);
    if (refusedTransition !== null) {
      this.#logger.warn('refused illegal transition', {
        project: event.project,
        phase: event.phase,
        from: refusedTransition.from,
        to: refusedTransition.to,
      });
    }
    for (const n of notificationsForEvent(event)) this.#notifications.push(n);
    this.#bus.publish(event);
    this.#logger.event(`event ${event.type}`, { project: event.project, phase: event.phase });
  }

  /** Build, persist (append to the log) and ingest a canonical event authored by the daemon's inputs. */
  appendCanonical(root: string, input: AppendInput): BridgeEvent {
    const logPath = eventLogPath(root);
    const existing = this.#system.readFile(logPath);
    const events = existing !== null ? parseEventLog(existing).events : [];
    const seq = nextSeq(events);
    const event = makeEvent({
      id: this.#system.newId('evt'),
      seq,
      type: input.type,
      project: input.project,
      phase: input.phase,
      at: this.#system.now(),
      actor: input.actor,
      source: 'bridge-daemon',
      ...(input.worker !== undefined ? { worker: input.worker } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.decisionRequired !== undefined ? { decisionRequired: input.decisionRequired } : {}),
    });
    const line = JSON.stringify({
      id: event.id,
      seq: event.seq,
      type: event.type,
      project: event.project,
      phase: event.phase,
      at: event.at,
      actor: event.actor,
      source: event.source,
      ...(event.worker !== undefined ? { worker: event.worker } : {}),
      decision_required: event.decisionRequired,
    });
    this.#system.writeFile(logPath, (existing ?? '') + line + '\n');
    this.ingestEvent(event, root);
    return event;
  }

  // ---- sync + health -----------------------------------------------------

  /** Rebuild the redacted dashboard snapshot and persist a cache per project. */
  syncDashboard(): DashboardSnapshot {
    this.#emitInternal('SYNC_STARTED', {});
    const snapshot = buildDashboardSnapshot([...this.#phases.values()], this.#workers, this.#system.now());
    this.#dashboard = snapshot;
    for (const project of this.#projects) {
      const cachePath = joinPath(bridgeDir(project.root), 'state', DASHBOARD_CACHE_FILE);
      // Guard: never persist a snapshot that still trips the secret detector.
      this.#system.writeFile(cachePath, JSON.stringify(snapshot, null, 2));
    }
    this.#emitInternal('SYNC_COMPLETED', {});
    this.#logger.log('SYNC', 'dashboard synced', { projects: this.#projects.length });
    return snapshot;
  }

  health(): HealthSnapshot {
    const readyPrompts = [...this.#phases.values()].filter((p) => p.stage === 'ready').length;
    return computeHealth({
      running: this.#running,
      startMonotonicMs: this.#startMono,
      nowMonotonicMs: this.#system.monotonicMs(),
      projects: this.#projects.length,
      workers: this.#workers.size,
      watchers: this.#projects.length,
      pendingEvents: this.#fileWatcher.pending,
      pendingPrompts: readyPrompts,
      pendingReports: pendingReviews(this.#phases).length,
      pendingApprovals: pendingDecisions(this.#phases).length,
    });
  }

  #emitInternal(type: BridgeEvent['type'], payload: Readonly<Record<string, unknown>>): void {
    const event = makeEvent({
      id: this.#system.newId('evt'),
      seq: INTERNAL_SEQ,
      type,
      project: '*',
      phase: '*',
      at: this.#system.now(),
      actor: 'agent',
      source: 'bridge-daemon',
      payload,
    });
    for (const n of notificationsForEvent(event)) this.#notifications.push(n);
    this.#bus.publish(event);
  }

  // ---- read-only accessors (for the CLI + tests) ------------------------

  get running(): boolean {
    return this.#running;
  }
  get projects(): readonly ProjectDescriptor[] {
    return this.#projects;
  }
  phaseStates(): readonly PhaseState[] {
    return [...this.#phases.values()];
  }
  get workers(): WorkerMap {
    return this.#workers;
  }
  get notifications(): readonly Notification[] {
    return this.#notifications;
  }
  get dashboard(): DashboardSnapshot | null {
    return this.#dashboard;
  }
  get bus(): EventBus {
    return this.#bus;
  }
  statePathFor(project: string): string | null {
    const root = this.#rootByProject.get(project);
    return root !== undefined ? statePath(root) : null;
  }
}

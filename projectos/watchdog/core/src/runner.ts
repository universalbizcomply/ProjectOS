// ProjectOS Watchdog Core — run lifecycle (run.v1).
//
// Generalised from the JD reference (MONITORING-PIPELINE-DEADMAN1A,
// health-monitor-run.ts). Central contract:
//
//   A run is SUCCEEDED only after every required stage succeeded, and that
//   status is written LAST. Scheduler invocation alone is never success.
//
// Stages:
//   schema_compat       installed schema/core must match this runtime, else refuse
//   run_start           run row STARTED (DB clock)
//   checks              every declared check yields a result; a pack that throws,
//                       an invalid result or a missing check becomes ERROR,
//                       never an omission
//   record_results      results persisted
//   commit_results      database confirms every declared check has a row
//                       (read-back); only committed runs may open/recover
//   read_incidents      this source's open incidents
//   persist_incidents   open / observe / mark_recovered
//   notify              only when planned; transport must ACCEPT
//   record_notifications state advanced only for accepted notifications
//   finish              SUCCEEDED
// Any failure: FAILED with the stage recorded (best effort, never masking the
// original error) and a non-ok outcome.

import type { CheckStatus } from "./status.ts";
import { REASON_INVALID_RESULT, REASON_NOT_REPORTED, REASON_PACK_FAILED, SYNTHESISED_REASONS, parseStatus } from "./status.ts";
import type { MetadataSpec } from "./metadata.ts";
import { validateMetadata, validateMetadataSpec } from "./metadata.ts";
import { GLOBAL_SCOPE, isScopeId, isToken } from "./identity.ts";
import type { AlertingStatus } from "./status.ts";
import type { CheckResult, Incident, IncidentAction, RunContext } from "./incidents.ts";
import { planIncidents, projectIncidents } from "./incidents.ts";
import type { CooldownPolicy, NotificationKind, NotificationTransport } from "./notifications.ts";
import { planNotifications } from "./notifications.ts";
import { WATCHDOG_CORE_VERSION, checkSchemaCompatibility, isCoreCompatible } from "./version.ts";

export type CheckDefinition = { check_id: string; metadata: MetadataSpec };

export type PackContext = { run_id: string; db_now: string };

export type CheckPack = {
  name: string;
  checks: readonly CheckDefinition[];
  run(ctx: PackContext): Promise<unknown[]>;
};

export type StoreStatus = {
  project: string;
  environment: string;
  schema_version: number | null;
  installed_core_version: string | null;
  db_now: string;
};

export interface WatchdogStore {
  status(): Promise<StoreStatus>;
  runStart(r: { run_id: string; source: string; expected_check_count: number; watchdog_core_version: string }): Promise<void>;
  recordResults(run_id: string, results: CheckResult[]): Promise<void>;
  commitResults(run_id: string, reported: number): Promise<{ actual_check_count: number; db_now: string }>;
  openIncidents(source: string): Promise<Incident[]>;
  openIncident(run_id: string, incident_id: string, r: { check_id: string; scope_type: string; scope_id: string }, severity: AlertingStatus): Promise<void>;
  observeIncident(run_id: string, incident_id: string, severity: AlertingStatus): Promise<void>;
  markRecovered(run_id: string, incident_id: string): Promise<void>;
  clearRecovery(run_id: string, incident_id: string): Promise<void>;
  jobEvent(job_id: string, event: "STARTED" | "SUCCEEDED" | "FAILED", run_id: string): Promise<void>;
  markNotified(run_id: string, incident_id: string, kind: NotificationKind): Promise<void>;
  logNotificationFailure(run_id: string, incident_ids: string[], code: string): Promise<void>; // best effort, never throws
  finishRun(run_id: string, status: "SUCCEEDED" | "FAILED", failure_stage: string | null): Promise<void>;
}

export type CycleDeps = {
  store: WatchdogStore;
  packs: readonly CheckPack[];
  source: string;
  runId: string;
  newId: () => string;
  transport: NotificationTransport | null;
  cooldowns: CooldownPolicy;
  logError: (msg: string) => void;
  // The job that represents THIS runner (e.g. "watchdog-runner"). Its
  // STARTED / SUCCEEDED / FAILED events feed job health, so a runner that keeps
  // failing is detected by the separate watchdog source as a stale job, even
  // when the runner itself can no longer notify.
  selfJobId?: string | null;
};

export type CycleOutcome = {
  ok: boolean;
  run_id: string;
  run_status: "SUCCEEDED" | "FAILED" | "NOT_STARTED";
  failure_stage: string | null;
  message: string | null;
  expected_check_count: number;
  actual_check_count: number;
  findings: number;
  notified: number;
  recovered_marked: number;
};

class StageError extends Error {
  stage: string;
  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

export function declaredChecks(packs: readonly CheckPack[]): Map<string, CheckDefinition> {
  const out = new Map<string, CheckDefinition>();
  for (const p of packs) {
    for (const c of p.checks) {
      if (!isToken(c.check_id)) throw new Error("invalid check_id " + JSON.stringify(c.check_id));
      if (out.has(c.check_id)) throw new Error("check_id declared twice: " + c.check_id);
      const specErrors = validateMetadataSpec(c.metadata);
      if (specErrors.length) throw new Error(c.check_id + ": " + specErrors.join("; "));
      out.set(c.check_id, c);
    }
  }
  return out;
}

function synth(check_id: string, reason: string, scope_type: string = GLOBAL_SCOPE.scope_type, scope_id: string = GLOBAL_SCOPE.scope_id): CheckResult {
  return { check_id, scope_type, scope_id, status: "ERROR", reason_code: reason, metadata: {} };
}

// Normalise one pack's raw output. Never throws; every declared check of the
// pack ends up with at least one result.
export function normalisePackResults(pack: CheckPack, raw: unknown[] | Error, logError: (m: string) => void): CheckResult[] {
  const declared = new Map(pack.checks.map((c) => [c.check_id, c]));
  if (raw instanceof Error) {
    logError("[watchdog] pack " + pack.name + " failed: " + raw.message);
    return pack.checks.map((c) => synth(c.check_id, REASON_PACK_FAILED));
  }
  const byKey = new Map<string, CheckResult>();
  const reported = new Set<string>();
  for (const item of raw) {
    const r = item as Record<string, unknown> | null;
    const checkId = r && typeof r.check_id === "string" ? r.check_id : null;
    const def = checkId ? declared.get(checkId) : undefined;
    if (!def || !r) {
      logError("[watchdog] pack " + pack.name + " returned an undeclared or malformed result; dropped");
      continue;
    }
    reported.add(def.check_id);
    const scopeType = r.scope_type === undefined ? GLOBAL_SCOPE.scope_type : r.scope_type;
    const scopeId = r.scope_id === undefined ? GLOBAL_SCOPE.scope_id : r.scope_id;
    const scopeOk = isToken(scopeType) && isScopeId(scopeId);
    const st = scopeOk ? scopeType as string : GLOBAL_SCOPE.scope_type;
    const sid = scopeOk ? scopeId as string : GLOBAL_SCOPE.scope_id;
    const key = JSON.stringify([def.check_id, st, sid]);

    let status: CheckStatus;
    try { status = parseStatus(r.status); } catch (_e) { byKey.set(key, synth(def.check_id, REASON_INVALID_RESULT, st, sid)); continue; }
    const meta = validateMetadata(r.metadata, def.metadata);
    const reasonOk = r.reason_code === undefined || r.reason_code === null ||
      (typeof r.reason_code === "string" && /^[A-Z0-9_]{1,64}$/.test(r.reason_code) && !SYNTHESISED_REASONS.includes(r.reason_code));
    if (!scopeOk || !meta.ok || !reasonOk || byKey.has(key)) {
      if (!meta.ok) logError("[watchdog] " + def.check_id + " metadata rejected: " + meta.errors.join("; "));
      byKey.set(key, synth(def.check_id, REASON_INVALID_RESULT, st, sid));
      continue;
    }
    byKey.set(key, {
      check_id: def.check_id, scope_type: st, scope_id: sid, status,
      reason_code: (r.reason_code as string | null | undefined) ?? null, metadata: meta.value,
    });
  }
  const out = [...byKey.values()];
  for (const c of pack.checks) if (!reported.has(c.check_id)) out.push(synth(c.check_id, REASON_NOT_REPORTED));
  return out;
}

export function genuineCheckCount(results: readonly CheckResult[]): number {
  const ids = new Set<string>();
  for (const r of results) if (r.reason_code === null || !SYNTHESISED_REASONS.includes(r.reason_code)) ids.add(r.check_id);
  return ids.size;
}

export async function runCycle(deps: CycleDeps): Promise<CycleOutcome> {
  const { store, runId } = deps;
  const outcome: CycleOutcome = {
    ok: false, run_id: runId, run_status: "NOT_STARTED", failure_stage: null, message: null,
    expected_check_count: 0, actual_check_count: 0, findings: 0, notified: 0, recovered_marked: 0,
  };
  let stage = "config";
  let started = false;
  try {
    if (!isToken(deps.source)) throw new StageError(stage, "invalid source");
    const declared = declaredChecks(deps.packs);
    outcome.expected_check_count = declared.size;

    stage = "schema_compat";
    const st = await store.status();
    const compat = checkSchemaCompatibility(st.schema_version);
    if (!compat.ok) throw new StageError(stage, compat.reason + " (installed " + compat.installed + ", required " + compat.required + ")");
    if (st.installed_core_version !== null && !isCoreCompatible(st.installed_core_version)) {
      throw new StageError(stage, "installed core " + st.installed_core_version + " incompatible with runtime " + WATCHDOG_CORE_VERSION);
    }

    stage = "run_start";
    await store.runStart({ run_id: runId, source: deps.source, expected_check_count: declared.size, watchdog_core_version: WATCHDOG_CORE_VERSION });
    started = true;
    if (deps.selfJobId) await store.jobEvent(deps.selfJobId, "STARTED", runId);

    stage = "checks";
    const results: CheckResult[] = [];
    for (const pack of deps.packs) {
      let raw: unknown[] | Error;
      try {
        const got = await pack.run({ run_id: runId, db_now: st.db_now });
        raw = Array.isArray(got) ? got : new Error("pack did not return an array");
      } catch (e) {
        raw = e instanceof Error ? e : new Error(String(e));
      }
      results.push(...normalisePackResults(pack, raw, deps.logError));
    }
    outcome.actual_check_count = genuineCheckCount(results);

    stage = "record_results";
    await store.recordResults(runId, results);

    stage = "commit_results";
    const committed = await store.commitResults(runId, results.length);
    if (committed.actual_check_count !== outcome.actual_check_count) {
      throw new StageError(stage, "database counted " + committed.actual_check_count + " executed checks, runtime " + outcome.actual_check_count);
    }

    stage = "read_incidents";
    const open = await store.openIncidents(deps.source);

    stage = "plan";
    const run: RunContext = {
      run_id: runId, project: st.project, environment: st.environment, source: deps.source,
      results_committed: true, now: committed.db_now,
    };
    const actions: IncidentAction[] = planIncidents(results, open, run, deps.newId);
    const projected = projectIncidents(open, actions, run);
    outcome.findings = results.filter((r) => r.status === "WARN" || r.status === "CRITICAL" || r.status === "ERROR").length;

    // Each action is persisted independently: one incident the database
    // refuses must not block every other alert. Refused incidents are left out
    // of this run's notifications and the run fails at the end (truthfully).
    stage = "persist_incidents";
    const byId = new Map(results.map((r) => [JSON.stringify([r.check_id, r.scope_type, r.scope_id]), r]));
    const refused = new Set<string>();
    const deferred: string[] = [];
    for (const a of actions) {
      if (a.kind === "hold") continue;
      try {
        if (a.kind === "open") {
          const r = byId.get(JSON.stringify([a.identity.check_id, a.identity.scope_type, a.identity.scope_id]));
          if (!r) throw new Error("open without a result");
          await store.openIncident(runId, a.incident_id, r, a.severity);
        } else if (a.kind === "observe") {
          await store.observeIncident(runId, a.incident_id, a.severity);
        } else if (a.kind === "mark_recovered") {
          await store.markRecovered(runId, a.incident_id);
          outcome.recovered_marked++;
        } else if (a.kind === "clear_recovery") {
          await store.clearRecovery(runId, a.incident_id);
        }
      } catch (e) {
        refused.add(a.incident_id);
        deferred.push("persist " + a.kind + " " + a.incident_id + ": " + (e instanceof Error ? e.message : String(e)));
      }
    }

    stage = "notify";
    const planned = planNotifications(projected.filter((i) => !refused.has(i.incident_id)), run.now, deps.cooldowns);
    if (planned.length > 0) {
      if (!deps.transport) throw new StageError(stage, "notifications required but no transport configured");
      const delivery = await deps.transport.send({
        project: st.project, environment: st.environment, generated_at: run.now, notifications: planned,
      });
      if (!delivery.accepted) {
        await store.logNotificationFailure(runId, planned.map((p) => p.incident_id), delivery.code);
        throw new StageError(stage, "delivery not accepted: " + delivery.code);
      }
      // Accepted: try to record EVERY item, so one refused mark cannot make the
      // whole batch re-send. Any failure fails the run afterwards.
      stage = "record_notifications";
      for (const p of planned) {
        try {
          await store.markNotified(runId, p.incident_id, p.kind);
          outcome.notified++;
        } catch (e) {
          deferred.push("mark " + p.kind + " " + p.incident_id + ": " + (e instanceof Error ? e.message : String(e)));
        }
      }
    }
    if (deferred.length > 0) {
      throw new StageError(refused.size > 0 ? "persist_incidents" : "record_notifications", deferred.join("; "));
    }

    stage = "finish";
    await store.finishRun(runId, "SUCCEEDED", null);
    if (deps.selfJobId) {
      try { await store.jobEvent(deps.selfJobId, "SUCCEEDED", runId); }
      catch (e) { deps.logError("[watchdog] self job SUCCEEDED event failed: " + (e instanceof Error ? e.message : String(e))); }
    }
    outcome.ok = true;
    outcome.run_status = "SUCCEEDED";
    return outcome;
  } catch (e) {
    const failedStage = e instanceof StageError ? e.stage : stage;
    const msg = e instanceof Error ? e.message : String(e);
    deps.logError("[watchdog] run " + runId + " stage " + failedStage + " failed: " + msg);
    outcome.failure_stage = failedStage;
    outcome.message = msg;
    if (started) {
      outcome.run_status = "FAILED";
      try { await store.finishRun(runId, "FAILED", failedStage); } catch (_ignored) { /* original error is what is reported */ }
      if (deps.selfJobId) {
        try { await store.jobEvent(deps.selfJobId, "FAILED", runId); } catch (_ignored) { /* stale success still exposes it */ }
      }
    }
    return outcome;
  }
}

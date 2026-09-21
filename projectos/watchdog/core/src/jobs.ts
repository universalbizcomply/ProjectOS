// ProjectOS Watchdog Core — scheduled/background job health (job-health.v1).
//
// A job is judged on proof that it FINISHED, never on the scheduler saying it
// was invoked. One result per job (check_id "job_health", scope job:<job_id>),
// so each job gets its own incident identity. Thresholds are per job and come
// from the product's profile; the core has no built-in cadence.

import type { CheckStatus } from "./status.ts";
import type { MetadataSpec } from "./metadata.ts";
import { isToken } from "./identity.ts";
import type { CheckDefinition } from "./runner.ts";

export const JOB_HEALTH_CHECK_ID = "job_health";

export type JobSpec = {
  job_id: string;
  expected_interval_s: number;
  stale_after_s: number;
  max_run_s: number | null;
  failure_threshold: number;
  scheduler_required: boolean;
};

export type SchedulerState = "present" | "missing" | "disabled" | "not_applicable";

export type JobState = {
  job_id: string;
  created_at: string;
  last_started_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  running_since: string | null;
  consecutive_failures: number;
  scheduler: SchedulerState;
};

export const JOB_CONDITIONS = [
  "OK", "GRACE", "NOT_REGISTERED", "SCHEDULE_MISSING", "SCHEDULE_DISABLED",
  "HUNG", "NEVER_SUCCEEDED", "STALE", "REPEATED_FAILURE", "INVALID_STATE",
] as const;
export type JobCondition = typeof JOB_CONDITIONS[number];

export const JOB_HEALTH_METADATA: MetadataSpec = {
  condition: { type: "enum", values: JOB_CONDITIONS },
  age_s: { type: "integer" },
  running_s: { type: "integer" },
  consecutive_failures: { type: "integer" },
};

export type JobHealthResult = {
  check_id: string;
  scope_type: "job";
  scope_id: string;
  status: CheckStatus;
  reason_code: string | null;
  metadata: Record<string, number | string>;
};

export function jobSpecErrors(s: JobSpec): string[] {
  const e: string[] = [];
  if (!isToken(s.job_id)) e.push("invalid job_id");
  const pos = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0;
  if (!pos(s.expected_interval_s)) e.push(s.job_id + ": expected_interval_s must be a positive integer");
  if (!pos(s.stale_after_s)) e.push(s.job_id + ": stale_after_s must be a positive integer");
  else if (pos(s.expected_interval_s) && s.stale_after_s < s.expected_interval_s) e.push(s.job_id + ": stale_after_s below expected_interval_s");
  if (s.max_run_s !== null && !pos(s.max_run_s)) e.push(s.job_id + ": max_run_s must be a positive integer or null");
  if (!pos(s.failure_threshold)) e.push(s.job_id + ": failure_threshold must be a positive integer");
  return e;
}

function t(v: string | null): number | null {
  if (v === null) return null;
  const n = Date.parse(v);
  if (!Number.isFinite(n)) throw new Error("invalid timestamp");
  return n;
}

function readTimes(dbNowIso: string, s: JobState): { now: number; created: number; lastSuccess: number | null; running: number | null } | null {
  try {
    const now = t(dbNowIso);
    const created = t(s.created_at);
    if (now === null || created === null) return null;
    return { now, created, lastSuccess: t(s.last_success_at), running: t(s.running_since) };
  } catch (_e) {
    return null;
  }
}

export function evaluateJob(spec: JobSpec, state: JobState | null, dbNowIso: string): JobHealthResult {
  const base = { check_id: JOB_HEALTH_CHECK_ID, scope_type: "job" as const, scope_id: spec.job_id };
  const res = (status: CheckStatus, condition: JobCondition, extra: Record<string, number> = {}): JobHealthResult => ({
    ...base, status, reason_code: condition === "OK" || condition === "GRACE" ? null : condition,
    metadata: { condition, ...extra },
  });

  if (state === null) return res("CRITICAL", "NOT_REGISTERED");
  if (spec.scheduler_required && state.scheduler === "missing") return res("CRITICAL", "SCHEDULE_MISSING");
  if (spec.scheduler_required && state.scheduler === "disabled") return res("CRITICAL", "SCHEDULE_DISABLED");
  // A required scheduler we cannot confirm is not a healthy scheduler.
  if (spec.scheduler_required && state.scheduler !== "present") return res("ERROR", "INVALID_STATE");
  // A failure counter we cannot read must not silently become zero.
  if (!Number.isSafeInteger(state.consecutive_failures) || state.consecutive_failures < 0) return res("ERROR", "INVALID_STATE");

  const times = readTimes(dbNowIso, state);
  if (!times) return res("ERROR", "INVALID_STATE");
  const { now, created, lastSuccess, running } = times;

  const failures = state.consecutive_failures;
  if (running !== null && spec.max_run_s !== null && now - running > spec.max_run_s * 1000) {
    return res("CRITICAL", "HUNG", { running_s: Math.floor((now - running) / 1000) });
  }
  if (lastSuccess === null) {
    const since = now - created;
    if (since > spec.stale_after_s * 1000) return res("CRITICAL", "NEVER_SUCCEEDED", { age_s: Math.floor(since / 1000), consecutive_failures: failures });
    return res("PASS", "GRACE", { age_s: Math.floor(since / 1000) });
  }
  const age = now - lastSuccess;
  if (age > spec.stale_after_s * 1000) return res("CRITICAL", "STALE", { age_s: Math.floor(age / 1000), consecutive_failures: failures });
  if (failures >= spec.failure_threshold) return res("WARN", "REPEATED_FAILURE", { age_s: Math.floor(age / 1000), consecutive_failures: failures });
  return res("PASS", "OK", { age_s: Math.floor(age / 1000) });
}

// Declaration for a job-health check (scope.v1): one result per job, scope
// "job"; the declared job list is the scope authority, so a failed jobs pack
// reports ERROR per job (never global).
export const JOB_SCOPE_TYPE = "job";

export function jobHealthCheck(specs: readonly JobSpec[]): CheckDefinition {
  const ids = specs.map((s) => s.job_id);
  return { check_id: JOB_HEALTH_CHECK_ID, metadata: JOB_HEALTH_METADATA, scope: { scope_type: JOB_SCOPE_TYPE, resolve: async () => ids } };
}

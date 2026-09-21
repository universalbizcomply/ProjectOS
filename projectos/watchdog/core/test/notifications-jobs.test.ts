import { test } from "node:test";
import assert from "node:assert/strict";
import type { Incident } from "../src/incidents.ts";
import { planNotifications, applyDelivery, assertCooldownPolicy } from "../src/notifications.ts";
import type { JobSpec, JobState } from "../src/jobs.ts";
import { evaluateJob, jobSpecErrors } from "../src/jobs.ts";
import { COOLDOWNS } from "./helpers.ts";

const base: Incident = {
  project: "demo", environment: "production", source: "runner", check_id: "db", scope_type: "global", scope_id: "global",
  incident_id: "i1", state: "OPEN", severity: "CRITICAL", first_seen: "2026-09-21T09:00:00.000Z", last_seen: "2026-09-21T09:00:00.000Z",
  occurrence_count: 1, opened_at: "2026-09-21T09:00:00.000Z", opening_run_id: "r1",
  last_notified_at: null, last_notified_severity: null, recovered_at: null, resolution_run_id: null, resolved_at: null,
};
const T0 = "2026-09-21T09:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60000).toISOString();

test("initial alert; failed delivery keeps it pending (retry), accepted advances", () => {
  assert.deepEqual(planNotifications([base], T0, COOLDOWNS).map((p) => p.kind), ["INITIAL"]);
  const failed = applyDelivery(base, "INITIAL", false, T0);
  assert.deepEqual(failed, base);
  assert.deepEqual(planNotifications([failed], at(5), COOLDOWNS).map((p) => p.kind), ["INITIAL"]);
  const sent = applyDelivery(base, "INITIAL", true, T0);
  assert.equal(sent.last_notified_at, T0);
  assert.deepEqual(planNotifications([sent], at(5), COOLDOWNS), []);
});

test("cooldown: reminder only after the severity's cooldown", () => {
  const sent = applyDelivery(base, "INITIAL", true, T0);
  assert.deepEqual(planNotifications([sent], at(59), COOLDOWNS), []);
  assert.deepEqual(planNotifications([sent], at(60), COOLDOWNS).map((p) => p.kind), ["REMINDER"]);
  const warn = applyDelivery({ ...base, severity: "WARN" }, "INITIAL", true, T0);
  assert.deepEqual(planNotifications([warn], at(60), COOLDOWNS), []);
  assert.deepEqual(planNotifications([warn], at(24 * 60), COOLDOWNS).map((p) => p.kind), ["REMINDER"]);
});

test("escalation ignores cooldown; de-escalation then re-escalation is announced again", () => {
  const warnSent = applyDelivery({ ...base, severity: "WARN" }, "INITIAL", true, T0);
  assert.deepEqual(planNotifications([{ ...warnSent, severity: "CRITICAL" }], at(1), COOLDOWNS).map((p) => p.kind), ["ESCALATION"]);
  const critSent = applyDelivery({ ...warnSent, severity: "CRITICAL" }, "ESCALATION", true, at(1));
  // de-escalated (projection lowers the watermark), then back to CRITICAL
  const lowered = { ...critSent, severity: "WARN" as const, last_notified_severity: "WARN" as const };
  assert.deepEqual(planNotifications([{ ...lowered, severity: "CRITICAL" }], at(2), COOLDOWNS).map((p) => p.kind), ["ESCALATION"]);
});

test("resolved/retired incidents plan nothing; invalid policy refused", () => {
  assert.deepEqual(planNotifications([{ ...base, state: "RESOLVED" }], T0, COOLDOWNS), []);
  assert.deepEqual(planNotifications([{ ...base, state: "RETIRED" }], T0, COOLDOWNS), []);
  assert.throws(() => assertCooldownPolicy({ WARN: 1, ERROR: 0, CRITICAL: 1 }));
  assert.throws(() => applyDelivery(base, "RECOVERY", true, T0));
});

const spec: JobSpec = { job_id: "invoice-tick", expected_interval_s: 300, stale_after_s: 900, max_run_s: 120, failure_threshold: 3, scheduler_required: true };
const state = (o: Partial<JobState> = {}): JobState => ({
  job_id: "invoice-tick", created_at: at(-600), last_started_at: at(-5), last_success_at: at(-5), last_failure_at: null,
  running_since: null, consecutive_failures: 0, scheduler: "present", ...o,
});

test("job health: healthy", () => {
  const r = evaluateJob(spec, state(), T0);
  assert.equal(r.status, "PASS");
  assert.equal(r.scope_id, "invoice-tick");
  assert.equal(r.metadata.condition, "OK");
});

test("job health: stale success", () => {
  const r = evaluateJob(spec, state({ last_success_at: at(-16) }), T0);
  assert.equal(r.status, "CRITICAL");
  assert.equal(r.reason_code, "STALE");
});

test("job health: never successful after grace; within grace is PASS", () => {
  assert.equal(evaluateJob(spec, state({ last_success_at: null, created_at: at(-16) }), T0).reason_code, "NEVER_SUCCEEDED");
  assert.equal(evaluateJob(spec, state({ last_success_at: null, created_at: at(-5) }), T0).metadata.condition, "GRACE");
});

test("job health: hung execution (started, not finished within max_run_s)", () => {
  const r = evaluateJob(spec, state({ running_since: at(-3) }), T0);
  assert.equal(r.reason_code, "HUNG");
  assert.equal(r.status, "CRITICAL");
});

test("job health: missing or disabled schedule, unregistered job", () => {
  assert.equal(evaluateJob(spec, state({ scheduler: "missing" }), T0).reason_code, "SCHEDULE_MISSING");
  assert.equal(evaluateJob(spec, state({ scheduler: "disabled" }), T0).reason_code, "SCHEDULE_DISABLED");
  assert.equal(evaluateJob(spec, null, T0).reason_code, "NOT_REGISTERED");
  assert.equal(evaluateJob({ ...spec, scheduler_required: false }, state({ scheduler: "not_applicable" }), T0).status, "PASS");
});

test("job health: repeated failure warns; invalid state is ERROR not PASS", () => {
  assert.equal(evaluateJob(spec, state({ consecutive_failures: 3 }), T0).reason_code, "REPEATED_FAILURE");
  assert.equal(evaluateJob(spec, state({ created_at: "nonsense" }), T0).status, "ERROR");
  assert.ok(jobSpecErrors({ ...spec, stale_after_s: 60 }).length > 0);
  assert.deepEqual(jobSpecErrors(spec), []);
});

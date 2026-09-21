import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckResult, Incident, RunContext } from "../src/incidents.ts";
import { planIncidents, projectIncidents } from "../src/incidents.ts";
import { planNotifications, applyDelivery, REFERENCE_COOLDOWNS_MS } from "../src/notifications.ts";
import { ids } from "./helpers.ts";

const run = (over: Partial<RunContext> = {}): RunContext => ({
  run_id: "r2", project: "demo", environment: "production", source: "runner", results_committed: true, now: "2026-09-21T10:00:00.000Z", ...over,
});
const res = (check_id: string, status: CheckResult["status"], scope_id = "global", scope_type = "global"): CheckResult =>
  ({ check_id, scope_type, scope_id, status, reason_code: null, metadata: {} });
const inc = (over: Partial<Incident> = {}): Incident => ({
  project: "demo", environment: "production", source: "runner", check_id: "db", scope_type: "global", scope_id: "global",
  incident_id: "i1", state: "OPEN", severity: "CRITICAL", first_seen: "2026-09-21T09:00:00.000Z", last_seen: "2026-09-21T09:55:00.000Z",
  occurrence_count: 3, opened_at: "2026-09-21T09:00:00.000Z", opening_run_id: "r1",
  last_notified_at: "2026-09-21T09:00:00.000Z", last_notified_severity: "CRITICAL", recovered_at: null, resolution_run_id: null, resolved_at: null,
  ...over,
});

test("positive recovery: CRITICAL -> PASS -> recovered", () => {
  const a = planIncidents([res("db", "PASS")], [inc()], run(), ids());
  assert.deepEqual(a, [{ kind: "mark_recovered", incident_id: "i1" }]);
  const p = projectIncidents([inc()], a, run());
  assert.equal(p[0].recovered_at, "2026-09-21T10:00:00.000Z");
  assert.equal(p[0].resolution_run_id, "r2");
  assert.equal(p[0].state, "OPEN"); // closes only when the recovery notice is accepted
});

test("CRITICAL -> missing result -> remains open", () => {
  const a = planIncidents([], [inc()], run(), ids());
  assert.deepEqual(a, [{ kind: "hold", incident_id: "i1", reason: "missing" }]);
  assert.equal(projectIncidents([inc()], a, run())[0].recovered_at, null);
});

test("CRITICAL -> ERROR -> remains open with severity unchanged", () => {
  const a = planIncidents([res("db", "ERROR")], [inc()], run(), ids());
  assert.deepEqual(a, [{ kind: "hold", incident_id: "i1", reason: "error" }]);
  const p = projectIncidents([inc()], a, run());
  assert.equal(p[0].severity, "CRITICAL");
  assert.equal(p[0].recovered_at, null);
});

test("CRITICAL -> failed (uncommitted) run with PASS -> remains open, nothing opened", () => {
  const a = planIncidents([res("db", "PASS"), res("other", "CRITICAL")], [inc()], run({ results_committed: false }), ids());
  assert.deepEqual(a, [{ kind: "hold", incident_id: "i1", reason: "run_not_committed" }]);
});

test("INFO neither opens nor recovers", () => {
  assert.deepEqual(planIncidents([res("x", "INFO")], [], run(), ids()), []);
  assert.deepEqual(planIncidents([res("db", "INFO")], [inc()], run(), ids()), [{ kind: "hold", incident_id: "i1", reason: "info" }]);
});

test("scoped identity: site A failing does not touch site B; B's PASS does not recover A", () => {
  const a = inc({ incident_id: "ia", check_id: "site_hours", scope_type: "site", scope_id: "site-a" });
  const actions = planIncidents(
    [res("site_hours", "PASS", "site-b", "site"), res("site_hours", "CRITICAL", "site-c", "site")],
    [a], run(), ids(),
  );
  assert.equal(actions.filter((x) => x.kind === "mark_recovered").length, 0);
  assert.deepEqual(actions.find((x) => x.kind === "hold"), { kind: "hold", incident_id: "ia", reason: "missing" });
  const opened = actions.find((x) => x.kind === "open");
  assert.ok(opened && opened.kind === "open" && opened.identity.scope_id === "site-c");
});

test("ownership: another source's incident is never held, recovered or closed", () => {
  const foreign = inc({ incident_id: "iw", source: "watchdog" });
  const actions = planIncidents([res("db", "PASS")], [foreign], run(), ids());
  assert.deepEqual(actions, []);
  const p = projectIncidents([foreign], actions, run());
  assert.deepEqual(p, []); // not in this source's projection at all
});

test("ownership: another project or environment is ignored", () => {
  assert.deepEqual(planIncidents([res("db", "PASS")], [inc({ project: "other" })], run(), ids()), []);
  assert.deepEqual(planIncidents([res("db", "PASS")], [inc({ environment: "staging" })], run(), ids()), []);
});

test("new failure opens exactly one incident; duplicate identity in a run is refused", () => {
  const a = planIncidents([res("db", "WARN")], [], run(), ids());
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, "open");
  assert.throws(() => planIncidents([res("db", "WARN"), res("db", "CRITICAL")], [], run(), ids()));
});

test("escalation and relapse", () => {
  const warn = inc({ severity: "WARN", last_notified_severity: "WARN" });
  const a = planIncidents([res("db", "CRITICAL")], [warn], run(), ids());
  assert.deepEqual(a, [{ kind: "observe", incident_id: "i1", severity: "CRITICAL" }]);
  const recovering = inc({ recovered_at: "2026-09-21T09:58:00.000Z", resolution_run_id: "r1" });
  const p = projectIncidents([recovering], planIncidents([res("db", "CRITICAL")], [recovering], run(), ids()), run());
  assert.equal(p[0].recovered_at, null);
  assert.equal(p[0].incident_id, "i1"); // same incident, not a new one
});

test("recovery notice closes only after acceptance; failed notice leaves it retryable", () => {
  const recovered = projectIncidents([inc()], [{ kind: "mark_recovered", incident_id: "i1" }], run());
  const plan = planNotifications(recovered, "2026-09-21T10:00:00.000Z", REFERENCE_COOLDOWNS_MS);
  assert.deepEqual(plan.map((p) => p.kind), ["RECOVERY"]);
  const failed = applyDelivery(recovered[0], "RECOVERY", false, "2026-09-21T10:00:00.000Z");
  assert.equal(failed.state, "OPEN");
  assert.deepEqual(planNotifications([failed], "2026-09-21T10:05:00.000Z", REFERENCE_COOLDOWNS_MS).map((p) => p.kind), ["RECOVERY"]);
  const ok = applyDelivery(recovered[0], "RECOVERY", true, "2026-09-21T10:05:00.000Z");
  assert.equal(ok.state, "RESOLVED");
});

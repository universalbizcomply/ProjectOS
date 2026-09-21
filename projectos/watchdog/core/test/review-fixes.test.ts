// Regression tests for the reliability review (PROJECTOS-WATCHDOG-CORE1A).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckPack, CycleDeps } from "../src/runner.ts";
import { runCycle } from "../src/runner.ts";
import { planIncidents, projectIncidents } from "../src/incidents.ts";
import type { Incident, RunContext } from "../src/incidents.ts";
import { planNotifications } from "../src/notifications.ts";
import { evaluateJob } from "../src/jobs.ts";
import { MemoryStore, FakeTransport, ids, COOLDOWNS } from "./helpers.ts";

let n = 0;
function pack(results: () => unknown[], checks = ["db", "cron"]): CheckPack {
  return { name: "p", checks: checks.map((check_id) => ({ check_id, metadata: {} })), async run() { return results(); } };
}
function deps(s: MemoryStore, p: CheckPack, t: FakeTransport, selfJobId: string | null = null): CycleDeps {
  n++;
  return { store: s, packs: [p], source: "runner", runId: "rv-" + n, newId: ids(), transport: t, cooldowns: COOLDOWNS, logError: () => {}, selfJobId };
}

test("F3: recovery evidence is withdrawn when the next run shows ERROR / INFO / missing; no RECOVERY is sent", () => {
  const run: RunContext = { run_id: "r3", project: "demo", environment: "production", source: "runner", results_committed: true, now: "2026-09-21T10:10:00.000Z" };
  const recovering: Incident = {
    project: "demo", environment: "production", source: "runner", check_id: "db", scope_type: "global", scope_id: "global",
    incident_id: "i1", state: "OPEN", severity: "CRITICAL", first_seen: "2026-09-21T09:00:00.000Z", last_seen: "2026-09-21T09:00:00.000Z",
    occurrence_count: 1, opened_at: "2026-09-21T09:00:00.000Z", opening_run_id: "r1", last_notified_at: "2026-09-21T09:00:00.000Z",
    last_notified_severity: "CRITICAL", recovered_at: "2026-09-21T10:05:00.000Z", resolution_run_id: "r2", resolved_at: null,
  };
  for (const results of [
    [{ check_id: "db", scope_type: "global", scope_id: "global", status: "ERROR" as const, reason_code: null, metadata: {} }],
    [{ check_id: "db", scope_type: "global", scope_id: "global", status: "INFO" as const, reason_code: null, metadata: {} }],
    [],
  ]) {
    const actions = planIncidents(results, [recovering], run, ids());
    assert.equal(actions[0].kind, "clear_recovery");
    const projected = projectIncidents([recovering], actions, run);
    assert.equal(projected[0].recovered_at, null);
    assert.equal(planNotifications(projected, run.now, COOLDOWNS).some((p) => p.kind === "RECOVERY"), false);
  }
});

test("F3 end to end: CRITICAL -> PASS (recovery notice fails) -> ERROR -> stays OPEN, never resolved on a non-PASS run", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  let db = "CRITICAL";
  const p = pack(() => [{ check_id: "db", status: db }, { check_id: "cron", status: "PASS" }]);
  await runCycle(deps(s, p, t));
  db = "PASS"; t.accept = false; s.advance(60_000);
  await runCycle(deps(s, p, t));
  db = "ERROR"; t.accept = true; s.advance(60_000);
  const before = t.batches.length;
  await runCycle(deps(s, p, t));
  const i = [...s.incidents.values()][0];
  assert.equal(i.state, "OPEN");
  assert.equal(i.recovered_at, null);
  assert.equal(t.batches.slice(before).some((b) => b.notifications.some((x) => x.kind === "RECOVERY")), false);
});

test("F1: one incident the database refuses does not block alerts for the others; run fails truthfully", async () => {
  const s = new MemoryStore();
  s.refuseOpenFor.add("db");
  const t = new FakeTransport();
  const o = await runCycle(deps(s, pack(() => [{ check_id: "db", status: "CRITICAL" }, { check_id: "cron", status: "CRITICAL" }]), t));
  assert.equal(o.ok, false);
  assert.equal(o.failure_stage, "persist_incidents");
  assert.equal(t.batches.length, 1);
  assert.deepEqual(t.batches[0].notifications.map((x) => x.identity.check_id), ["cron"]);
  assert.notEqual([...s.incidents.values()].find((i) => i.check_id === "cron")!.last_notified_at, null);
});

test("F2: a refused mark does not stop the other marks; only the refused one is re-sent", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  const p = pack(() => [{ check_id: "db", status: "CRITICAL" }, { check_id: "cron", status: "CRITICAL" }]);
  const first = [...s.incidents.keys()];
  assert.equal(first.length, 0);
  // refuse marking whichever incident is created for "db"
  const origOpen = s.openIncident.bind(s);
  s.openIncident = async (run_id, incident_id, r, sev) => { await origOpen(run_id, incident_id, r, sev); if (r.check_id === "db") s.refuseMarkFor.add(incident_id); };
  const o1 = await runCycle(deps(s, p, t));
  assert.equal(o1.ok, false);
  assert.equal(o1.failure_stage, "record_notifications");
  assert.equal(o1.notified, 1);
  s.refuseMarkFor.clear();
  s.advance(5 * 60_000);
  await runCycle(deps(s, p, t));
  assert.deepEqual(t.batches[1].notifications.map((x) => x.identity.check_id), ["db"]);
});

test("F1: the runner records its own job heartbeat so a failing runner goes stale for the watchdog", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  await runCycle(deps(s, pack(() => [{ check_id: "db", status: "PASS" }, { check_id: "cron", status: "PASS" }]), t, "watchdog-runner"));
  s.failOn["recordResults"] = "boom";
  await runCycle(deps(s, pack(() => [{ check_id: "db", status: "PASS" }, { check_id: "cron", status: "PASS" }]), t, "watchdog-runner"));
  assert.deepEqual(s.jobEvents, ["watchdog-runner:STARTED", "watchdog-runner:SUCCEEDED", "watchdog-runner:STARTED", "watchdog-runner:FAILED"]);
});

test("F4: unreadable failure counter or unconfirmed required scheduler is ERROR, never PASS", () => {
  const spec = { job_id: "j", expected_interval_s: 300, stale_after_s: 900, max_run_s: null, failure_threshold: 3, scheduler_required: true };
  const state = { job_id: "j", created_at: "2026-09-21T09:00:00Z", last_started_at: null, last_success_at: "2026-09-21T09:58:00Z", last_failure_at: null, running_since: null, consecutive_failures: 0, scheduler: "present" as const };
  const now = "2026-09-21T10:00:00Z";
  assert.equal(evaluateJob(spec, state, now).status, "PASS");
  assert.equal(evaluateJob(spec, { ...state, consecutive_failures: "5" as unknown as number }, now).status, "ERROR");
  assert.equal(evaluateJob(spec, { ...state, consecutive_failures: null as unknown as number }, now).status, "ERROR");
  assert.equal(evaluateJob(spec, { ...state, scheduler: "not_applicable" }, now).status, "ERROR");
  assert.equal(evaluateJob(spec, { ...state, scheduler: "weird" as never }, now).status, "ERROR");
});

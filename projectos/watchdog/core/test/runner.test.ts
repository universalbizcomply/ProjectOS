import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckPack, CycleDeps } from "../src/runner.ts";
import { runCycle } from "../src/runner.ts";
import { MemoryStore, FakeTransport, ids, COOLDOWNS } from "./helpers.ts";

function pack(results: () => unknown[] | Promise<unknown[]>, checks = ["db", "cron"]): CheckPack {
  return {
    name: "demo",
    checks: checks.map((check_id) => ({ check_id, metadata: { age_s: { type: "integer" } } })),
    async run() { return await results(); },
  };
}

let runSeq = 0;
function deps(store: MemoryStore, packs: CheckPack[], transport: FakeTransport | null = new FakeTransport(), source = "runner"): CycleDeps {
  runSeq++;
  return { store, packs, source, runId: "run-" + runSeq, newId: ids(), transport, cooldowns: COOLDOWNS, logError: () => {} };
}

const healthy = () => [{ check_id: "db", status: "PASS" }, { check_id: "cron", status: "PASS", metadata: { age_s: 30 } }];

test("run success: SUCCEEDED written last, counts truthful, no notification needed", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  const o = await runCycle(deps(s, [pack(healthy)], t));
  assert.equal(o.ok, true);
  assert.equal(o.run_status, "SUCCEEDED");
  assert.equal(o.expected_check_count, 2);
  assert.equal(o.actual_check_count, 2);
  assert.equal(t.batches.length, 0);
  assert.equal([...s.runs.values()][0].status, "SUCCEEDED");
});

test("missing expected check becomes ERROR (not omitted) and opens an incident", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  const o = await runCycle(deps(s, [pack(() => [{ check_id: "db", status: "PASS" }])], t));
  assert.equal(o.ok, true);
  assert.equal(o.actual_check_count, 1);
  const recorded = [...s.runs.values()][0].results;
  assert.deepEqual(recorded.find((r) => r.check_id === "cron"), { check_id: "cron", scope_type: "global", scope_id: "global", status: "ERROR", reason_code: "NOT_REPORTED", metadata: {} });
  assert.equal([...s.incidents.values()][0].severity, "ERROR");
  assert.equal(t.batches[0].notifications[0].kind, "INITIAL");
});

test("pack that throws: every declared check ERROR, run still truthful", async () => {
  const s = new MemoryStore();
  const o = await runCycle(deps(s, [pack(() => { throw new Error("connection refused"); })]));
  assert.equal(o.ok, true);
  assert.equal(o.actual_check_count, 0);
  assert.ok([...s.runs.values()][0].results.every((r) => r.status === "ERROR" && r.reason_code === "PACK_FAILED"));
});

test("metadata outside the allowlist is rejected -> ERROR INVALID_RESULT, never stored", async () => {
  const s = new MemoryStore();
  await runCycle(deps(s, [pack(() => [{ check_id: "db", status: "PASS", metadata: { customer_email: "a@b.c" } }, { check_id: "cron", status: "PASS" }])]));
  const r = [...s.runs.values()][0].results.find((x) => x.check_id === "db")!;
  assert.equal(r.status, "ERROR");
  assert.equal(r.reason_code, "INVALID_RESULT");
  assert.equal(JSON.stringify(r).includes("a@b.c"), false);
});

test("run failure: database read-back mismatch -> FAILED, stage recorded", async () => {
  const s = new MemoryStore();
  s.commitSkew = -1;
  const o = await runCycle(deps(s, [pack(healthy)]));
  assert.equal(o.ok, false);
  assert.equal(o.run_status, "FAILED");
  assert.equal(o.failure_stage, "commit_results");
});

test("schema incompatible: refuses before starting a run", async () => {
  const s = new MemoryStore();
  s.schema_version = 2;
  const o = await runCycle(deps(s, [pack(healthy)]));
  assert.equal(o.run_status, "NOT_STARTED");
  assert.equal(o.failure_stage, "schema_compat");
  assert.equal(s.runs.size, 0);
  s.schema_version = 1;
  s.installed_core_version = "0.2.0";
  assert.equal((await runCycle(deps(s, [pack(healthy)]))).failure_stage, "schema_compat");
});

test("notification failure: run FAILED, state not advanced, next run retries then advances once", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  t.accept = false;
  const bad = () => [{ check_id: "db", status: "CRITICAL" }, { check_id: "cron", status: "PASS" }];
  const o1 = await runCycle(deps(s, [pack(bad)], t));
  assert.equal(o1.ok, false);
  assert.equal(o1.failure_stage, "notify");
  assert.equal(s.failuresLogged, 1);
  const i = [...s.incidents.values()][0];
  assert.equal(i.state, "OPEN");                // the incident is real
  assert.equal(i.last_notified_at, null);       // but not falsely notified
  t.accept = true;
  s.advance(5 * 60_000);
  const o2 = await runCycle(deps(s, [pack(bad)], t));
  assert.equal(o2.ok, true);
  assert.equal(t.batches.length, 2);
  assert.equal(t.batches[1].notifications[0].kind, "INITIAL");
  assert.notEqual([...s.incidents.values()][0].last_notified_at, null);
  s.advance(5 * 60_000);
  await runCycle(deps(s, [pack(bad)], t));
  assert.equal(t.batches.length, 2);            // cooldown: no repeat after 5 min
});

test("no transport configured when a notification is required -> failure, not silence", async () => {
  const s = new MemoryStore();
  const o = await runCycle(deps(s, [pack(() => [{ check_id: "db", status: "WARN" }, { check_id: "cron", status: "PASS" }])], null));
  assert.equal(o.ok, false);
  assert.equal(o.failure_stage, "notify");
});

test("end to end: CRITICAL -> missing (open) -> ERROR (open) -> PASS -> RECOVERY accepted -> RESOLVED", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  const seq: unknown[][] = [
    [{ check_id: "db", status: "CRITICAL" }, { check_id: "cron", status: "PASS" }],
    [{ check_id: "cron", status: "PASS" }],                                  // db missing
    [{ check_id: "db", status: "ERROR" }, { check_id: "cron", status: "PASS" }],
    [{ check_id: "db", status: "PASS" }, { check_id: "cron", status: "PASS" }],
  ];
  let n = 0;
  const p = pack(() => seq[n++]);
  await runCycle(deps(s, [p], t));
  const id = [...s.incidents.values()].find((i) => i.check_id === "db")!.incident_id;
  s.advance(60_000); await runCycle(deps(s, [p], t));
  assert.equal(s.incidents.get(id)!.state, "OPEN");
  assert.equal(s.incidents.get(id)!.recovered_at, null);
  s.advance(60_000); await runCycle(deps(s, [p], t));
  assert.equal(s.incidents.get(id)!.state, "OPEN");
  assert.equal(s.incidents.get(id)!.severity, "CRITICAL");
  s.advance(60_000); const last = await runCycle(deps(s, [p], t));
  assert.equal(last.ok, true);
  assert.equal(s.incidents.get(id)!.state, "RESOLVED");
  assert.ok(t.batches.some((b) => b.notifications.some((x) => x.kind === "RECOVERY" && x.incident_id === id)));
});

test("failed recovery notice keeps the incident open until a later accepted notice", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  let status = "CRITICAL";
  const p = pack(() => [{ check_id: "db", status }, { check_id: "cron", status: "PASS" }]);
  await runCycle(deps(s, [p], t));
  status = "PASS";
  t.accept = false;
  s.advance(60_000);
  const o = await runCycle(deps(s, [p], t));
  assert.equal(o.ok, false);
  const i = [...s.incidents.values()][0];
  assert.equal(i.state, "OPEN");
  assert.notEqual(i.recovered_at, null);
  t.accept = true;
  s.advance(60_000);
  await runCycle(deps(s, [p], t));
  assert.equal([...s.incidents.values()][0].state, "RESOLVED");
});

test("failure while writing FAILED status never masks the original error", async () => {
  const s = new MemoryStore();
  s.failOn["recordResults"] = "disk full";
  s.failOn["finishRun:FAILED"] = "also broken";
  const o = await runCycle(deps(s, [pack(healthy)]));
  assert.equal(o.failure_stage, "record_results");
  assert.equal(o.message, "disk full");
});

test("sources are isolated: watchdog run never recovers the runner's incident", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  await runCycle(deps(s, [pack(() => [{ check_id: "db", status: "CRITICAL" }, { check_id: "cron", status: "PASS" }])], t, "runner"));
  await runCycle(deps(s, [pack(() => [{ check_id: "db", status: "PASS" }, { check_id: "cron", status: "PASS" }])], t, "watchdog"));
  const runnerInc = [...s.incidents.values()].find((i) => i.source === "runner")!;
  assert.equal(runnerInc.state, "OPEN");
  assert.equal(runnerInc.recovered_at, null);
});

test("config errors: duplicate or invalid check ids refuse to run", async () => {
  const s = new MemoryStore();
  const dup = await runCycle(deps(s, [pack(healthy, ["db"]), pack(healthy, ["db"])]));
  assert.equal(dup.failure_stage, "config");
  const bad = await runCycle(deps(s, [pack(healthy, ["Bad Id"])]));
  assert.equal(bad.failure_stage, "config");
});

// Watchdog Core 0.1.1 (scope.v1): a failed check pack keeps the check's
// DECLARED scope. Regression tests for PROJECTOS-WATCHDOG-CORE0.1.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckPack, CheckDefinition, CycleDeps } from "../src/runner.ts";
import { runCycle, SCOPE_SET_ID } from "../src/runner.ts";
import { evaluateJob, jobHealthCheck } from "../src/jobs.ts";
import type { JobSpec } from "../src/jobs.ts";
import type { CheckResult } from "../src/incidents.ts";
import { MemoryStore, FakeTransport, ids, COOLDOWNS } from "./helpers.ts";
import { CORE_CONTRACTS, WATCHDOG_CORE_VERSION, REQUIRED_SCHEMA_VERSION } from "../src/version.ts";

test("0.1.1 carries scope.v1 and keeps schema 1", () => {
  assert.equal(WATCHDOG_CORE_VERSION, "0.1.1");
  assert.equal(REQUIRED_SCHEMA_VERSION, 1);
  assert.ok((CORE_CONTRACTS as readonly string[]).includes("scope.v1"));
});

let runSeq = 0;
function deps(store: MemoryStore, packs: CheckPack[], source = "runner"): CycleDeps & { transport: FakeTransport } {
  runSeq++;
  return { store, packs, source, runId: "scope-run-" + runSeq, newId: ids(), transport: new FakeTransport(), cooldowns: COOLDOWNS, logError: () => {} };
}

const THROW = () => { throw new Error("rpc timeout"); };
const lastResults = (s: MemoryStore): CheckResult[] => [...s.runs.values()].at(-1)!.results;
const open = (s: MemoryStore) => [...s.incidents.values()].filter((i) => i.state === "OPEN");
const at = (rs: CheckResult[], type: string, id: string) => rs.filter((r) => r.scope_type === type && r.scope_id === id);

function sitePack(run: () => unknown[] | Promise<unknown[]>, sites: () => Promise<readonly string[]> = async () => ["site-a", "site-b"], check_id = "site_ready"): CheckPack & { authorityCalls: number } {
  const p = {
    name: "sites-" + check_id,
    authorityCalls: 0,
    checks: [] as CheckDefinition[],
    async run() { return await run(); },
  };
  p.checks = [{ check_id, metadata: {}, scope: { scope_type: "site", resolve: async () => { p.authorityCalls++; return await sites(); } } }];
  return p;
}
const globalPack = (run: () => unknown[] | Promise<unknown[]>): CheckPack => ({ name: "global", checks: [{ check_id: "db", metadata: {} }], async run() { return await run(); } });

// ---- scope of a failed pack -------------------------------------------------------

test("global pack throws -> global ERROR (declared global), nothing else", async () => {
  const s = new MemoryStore();
  await runCycle(deps(s, [globalPack(THROW)]));
  assert.deepEqual(lastResults(s), [{ check_id: "db", scope_type: "global", scope_id: "global", status: "ERROR", reason_code: "PACK_FAILED", metadata: {} }]);
  assert.deepEqual(open(s).map((i) => i.scope_type + ":" + i.scope_id + ":" + i.severity), ["global:global:ERROR"]);
});

test("site-scoped pack throws -> ERROR on each authoritative site + site coverage ERROR; never global", async () => {
  const s = new MemoryStore();
  const o = await runCycle(deps(s, [sitePack(THROW)]));
  assert.equal(o.ok, true, "run completes truthfully");
  const rs = lastResults(s);
  assert.equal(rs.some((r) => r.scope_type === "global"), false, "no global result");
  assert.deepEqual(rs.map((r) => r.scope_type + ":" + r.scope_id + ":" + r.status + ":" + r.reason_code).sort(),
    ["site:scope-set:ERROR:PACK_FAILED", "site:site-a:ERROR:PACK_FAILED", "site:site-b:ERROR:PACK_FAILED"]);
  assert.equal(open(s).some((i) => i.scope_type === "global"), false, "no global incident");
  assert.equal(o.actual_check_count, 0, "a failed pack is not an executed check");
});

test("component-scoped pack throws -> component ERRORs", async () => {
  const s = new MemoryStore();
  const comp: CheckPack = {
    name: "components",
    checks: [{ check_id: "component_ok", metadata: {}, scope: { scope_type: "component", resolve: async () => ["stripe-webhook", "email-sender"] } }],
    async run() { throw new Error("boom"); },
  };
  await runCycle(deps(s, [comp]));
  assert.deepEqual(open(s).map((i) => i.scope_type + ":" + i.scope_id).sort(),
    ["component:email-sender", "component:scope-set", "component:stripe-webhook"]);
});

test("job-health helper: a failed jobs pack reports ERROR per declared job", async () => {
  const s = new MemoryStore();
  const specs: JobSpec[] = [
    { job_id: "nightly", expected_interval_s: 300, stale_after_s: 900, max_run_s: 120, failure_threshold: 3, scheduler_required: false },
    { job_id: "reminders", expected_interval_s: 300, stale_after_s: 900, max_run_s: 120, failure_threshold: 3, scheduler_required: false },
  ];
  const jobs: CheckPack = { name: "jobs", checks: [jobHealthCheck(specs)], async run() { throw new Error("job states unavailable"); } };
  await runCycle(deps(s, [jobs]));
  assert.deepEqual(lastResults(s).map((r) => r.scope_type + ":" + r.scope_id).sort(), ["job:nightly", "job:reminders", "job:scope-set"]);
  // and on success the helper's scope matches evaluateJob's own results
  const ok: CheckPack = { name: "jobs", checks: [jobHealthCheck(specs)], async run() { return specs.map((sp) => evaluateJob(sp, null, s.now())); } };
  await runCycle(deps(s, [ok]));
  assert.equal(lastResults(s).some((r) => r.reason_code === "INVALID_RESULT"), false);
});

// ---- isolation, ERROR != PASS / recovery, ownership ----------------------------

test("multi-site: Site A failing never creates, overwrites or recovers Site B's incident", async () => {
  const s = new MemoryStore();
  // run 1: B CRITICAL, A PASS
  await runCycle(deps(s, [sitePack(() => [
    { check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "PASS" },
    { check_id: "site_ready", scope_type: "site", scope_id: "site-b", status: "CRITICAL" },
  ])]));
  const b = open(s).find((i) => i.scope_id === "site-b")!;
  assert.equal(b.severity, "CRITICAL");
  // run 2: only Site A's result is broken
  await runCycle(deps(s, [sitePack(() => [
    { check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "BOGUS" },
    { check_id: "site_ready", scope_type: "site", scope_id: "site-b", status: "CRITICAL" },
  ])]));
  const a = open(s).find((i) => i.scope_id === "site-a")!;
  assert.equal(a.severity, "ERROR", "A's own identity carries A's failure");
  assert.equal(s.incidents.get(b.incident_id)!.severity, "CRITICAL", "B unchanged");
  assert.equal(open(s).filter((i) => i.scope_id === "site-b").length, 1, "no second B incident");
  // run 3: whole pack fails; B keeps its CRITICAL (held), is not recovered, and no global incident appears
  await runCycle(deps(s, [sitePack(THROW)]));
  const b3 = s.incidents.get(b.incident_id)!;
  assert.equal(b3.state, "OPEN");
  assert.equal(b3.severity, "CRITICAL", "ERROR never overwrites a known CRITICAL");
  assert.equal(b3.recovered_at, null);
  assert.equal(open(s).some((i) => i.scope_type === "global"), false);
});

test("two site packs: one failing pack leaves the other pack's sites alone", async () => {
  const s = new MemoryStore();
  const ready = sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "CRITICAL" }], async () => ["site-a"]);
  const hours = sitePack(() => [{ check_id: "site_hours", scope_type: "site", scope_id: "site-a", status: "PASS" }], async () => ["site-a"], "site_hours");
  await runCycle(deps(s, [ready, sitePack(THROW, async () => ["site-a"], "site_hours")]));
  const readyA = open(s).find((i) => i.check_id === "site_ready" && i.scope_id === "site-a")!;
  assert.equal(readyA.severity, "CRITICAL");
  await runCycle(deps(s, [sitePack(THROW, async () => ["site-a"]), hours]));
  assert.equal(s.incidents.get(readyA.incident_id)!.severity, "CRITICAL", "failing pack holds its own incident");
  assert.notEqual(s.incidents.get(readyA.incident_id)!.state, "RESOLVED");
});

test("failed pack is never PASS and never recovery; recovery evidence is withdrawn", async () => {
  const s = new MemoryStore();
  const t = new FakeTransport();
  await runCycle({ ...deps(s, [sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "CRITICAL" }], async () => ["site-a"])]), transport: t });
  const a = open(s)[0];
  t.accept = false; // PASS recorded as evidence but the RECOVERY notice is not accepted -> stays open with recovered_at
  await runCycle({ ...deps(s, [sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "PASS" }], async () => ["site-a"])]), transport: t });
  assert.notEqual(s.incidents.get(a.incident_id)!.recovered_at, null);
  t.accept = true;
  await runCycle({ ...deps(s, [sitePack(THROW, async () => ["site-a"])]), transport: t });
  const rs = lastResults(s);
  assert.equal(rs.some((r) => r.status === "PASS"), false, "no PASS from a failed pack");
  const after = s.incidents.get(a.incident_id)!;
  assert.equal(after.state, "OPEN", "not recovered");
  assert.equal(after.recovered_at, null, "earlier recovery evidence withdrawn");
});

test("pack ERROR respects ownership: another source's incident on the same identity is untouched", async () => {
  const s = new MemoryStore();
  await runCycle(deps(s, [sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "CRITICAL" }], async () => ["site-a"])], "watchdog"));
  const foreign = open(s)[0];
  await runCycle(deps(s, [sitePack(THROW, async () => ["site-a"])], "runner"));
  assert.equal(s.incidents.get(foreign.incident_id)!.severity, "CRITICAL");
  assert.equal(s.incidents.get(foreign.incident_id)!.occurrence_count, 1, "foreign incident not observed");
  assert.equal(open(s).filter((i) => i.source === "runner" && i.scope_id === "site-a").length, 1, "runner owns its own identity");
});

test("later PASS recovers each scope explicitly; coverage recovers only on its own PASS", async () => {
  const s = new MemoryStore();
  const d1 = deps(s, [sitePack(THROW)]);
  await runCycle(d1);
  assert.equal(open(s).length, 3);
  // partial evaluation: only site-a reported -> site-a recovers; site-b is held (missing), not recovered
  const d2 = deps(s, [sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "PASS" }])]);
  await runCycle(d2);
  const byScope = () => Object.fromEntries([...s.incidents.values()].map((i) => [i.scope_id, i.state]));
  assert.equal(byScope()["site-a"], "RESOLVED");
  assert.equal(byScope()["site-b"], "OPEN", "no PASS for B -> no recovery");
  assert.equal(byScope()[SCOPE_SET_ID], "RESOLVED", "coverage PASS: the check evaluated again");
  const d3 = deps(s, [sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-b", status: "PASS" }])]);
  await runCycle(d3);
  assert.equal(byScope()["site-b"], "RESOLVED");
  assert.ok(d3.transport.batches.flatMap((b) => b.notifications).some((n) => n.kind === "RECOVERY"));
});

// ---- declaration contract: refusal, never silently global -----------------------

test("invalid scope declarations are refused before the run starts", async () => {
  const bad: Array<CheckDefinition["scope"]> = [
    { scope_type: "site" } as never,
    { scope_type: "global", resolve: async () => [] },
    { scope_type: "Not A Token", resolve: async () => [] },
    "site" as never,
  ];
  for (const scope of bad) {
    const s = new MemoryStore();
    const o = await runCycle(deps(s, [{ name: "p", checks: [{ check_id: "x", metadata: {}, scope }], async run() { return []; } }]));
    assert.equal(o.ok, false);
    assert.equal(o.run_status, "NOT_STARTED");
    assert.equal(o.failure_stage, "config");
    assert.equal(s.runs.size, 0, "nothing recorded");
  }
});

test("results outside the declared scope are never re-homed to global", async () => {
  const s = new MemoryStore();
  // scoped check: missing scope, wrong scope_type, reserved id -> dropped, coverage ERROR INVALID_RESULT
  await runCycle(deps(s, [sitePack(() => [
    { check_id: "site_ready", status: "CRITICAL" },
    { check_id: "site_ready", scope_type: "device", scope_id: "d1", status: "CRITICAL" },
    { check_id: "site_ready", scope_type: "site", scope_id: SCOPE_SET_ID, status: "PASS" },
    { check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "PASS" },
  ])]));
  let rs = lastResults(s);
  assert.equal(rs.some((r) => r.scope_type !== "site"), false, "nothing global, nothing foreign");
  assert.deepEqual(at(rs, "site", SCOPE_SET_ID).map((r) => r.status + ":" + r.reason_code), ["ERROR:INVALID_RESULT"]);
  assert.deepEqual(at(rs, "site", "site-a").map((r) => r.status), ["PASS"]);
  // only misplaced results -> INVALID_RESULT on authoritative sites (not global)
  await runCycle(deps(s, [sitePack(() => [{ check_id: "site_ready", status: "PASS" }])]));
  rs = lastResults(s);
  assert.deepEqual(rs.map((r) => r.scope_id + ":" + r.reason_code).sort(), ["scope-set:INVALID_RESULT", "site-a:INVALID_RESULT", "site-b:INVALID_RESULT"]);
  // global check with a stray scoped result -> INVALID_RESULT at its declared (global) scope
  const g = new MemoryStore();
  await runCycle(deps(g, [globalPack(() => [{ check_id: "db", scope_type: "site", scope_id: "site-a", status: "PASS" }])]));
  assert.deepEqual(lastResults(g).map((r) => r.scope_type + ":" + r.status + ":" + r.reason_code), ["global:ERROR:INVALID_RESULT"]);
});

test("scope authority unavailable or returning bad ids -> coverage ERROR only; no site or global scope is manufactured", async () => {
  for (const sites of [async () => { throw new Error("sites table unavailable"); }, async () => ["site-a", "../etc"], async () => [SCOPE_SET_ID], async () => "site-a" as never]) {
    const s = new MemoryStore();
    const o = await runCycle(deps(s, [sitePack(THROW, sites as () => Promise<readonly string[]>)]));
    assert.equal(o.ok, true, "commit still satisfied (one row for the declared check)");
    assert.deepEqual(lastResults(s).map((r) => r.scope_type + ":" + r.scope_id + ":" + r.status + ":" + r.reason_code),
      ["site:scope-set:ERROR:PACK_FAILED"]);
  }
});

test("scope authority is consulted only when needed, and ids come only from it", async () => {
  const healthy = sitePack(() => [{ check_id: "site_ready", scope_type: "site", scope_id: "site-a", status: "PASS" }]);
  await runCycle(deps(new MemoryStore(), [healthy]));
  assert.equal(healthy.authorityCalls, 0, "healthy pack: no extra query");
  const failing = sitePack(() => { throw new Error("error mentions site-zzz"); });
  const s = new MemoryStore();
  await runCycle(deps(s, [failing]));
  assert.equal(failing.authorityCalls, 1);
  assert.equal(lastResults(s).some((r) => r.scope_id === "site-zzz"), false);
});

// ---- JD compatibility and second-product readiness ------------------------------

test("JD shape without GLOBAL_OK: connected-account per site, jobs per job — no global rows, commit satisfied, failures stay scoped", async () => {
  const s = new MemoryStore();
  const sites = async () => ["0b7c-site-1", "4f2a-site-2"];
  const connected = (fail: boolean): CheckPack => ({
    name: "jd-connected-accounts",
    checks: [{ check_id: "connected_account_inactive", metadata: {}, scope: { scope_type: "site", resolve: sites } }],
    async run() {
      if (fail) throw new Error("stripe_monitor_unready_connected_sites: timeout");
      return (await sites()).map((id, n) => ({ check_id: "connected_account_inactive", scope_type: "site", scope_id: id, status: n === 0 ? "CRITICAL" : "PASS" }));
    },
  });
  const o1 = await runCycle(deps(s, [connected(false)]));
  assert.equal(o1.ok, true);
  assert.equal(lastResults(s).some((r) => r.scope_type === "global"), false, "the GLOBAL_OK row is no longer needed");
  await runCycle(deps(s, [connected(true)]));
  assert.equal(open(s).some((i) => i.scope_type === "global"), false);
  assert.equal(open(s).find((i) => i.scope_id === "0b7c-site-1")!.severity, "CRITICAL", "site 1 keeps its real failure");
  assert.equal(open(s).find((i) => i.scope_id === "4f2a-site-2")!.severity, "ERROR", "site 2 is honestly blind");
  await runCycle(deps(s, [connected(false)]));
  assert.equal(open(s).some((i) => i.scope_id === "4f2a-site-2" || i.scope_id === SCOPE_SET_ID), false, "explicit PASS recovers");
});

test("second product (device fleet) needs no workaround: zero devices, many devices, and failure all behave", async () => {
  let devices: string[] = [];
  let fail = false;
  const fleet: CheckPack = {
    name: "fleet",
    checks: [{ check_id: "device_online", metadata: {}, scope: { scope_type: "device", resolve: async () => devices } }],
    async run() {
      if (fail) throw new Error("fleet api down");
      return devices.map((d) => ({ check_id: "device_online", scope_type: "device", scope_id: d, status: "PASS" }));
    },
  };
  const s = new MemoryStore();
  const o0 = await runCycle(deps(s, [fleet]));
  assert.equal(o0.ok, true, "zero devices: commit satisfied by coverage, no global stand-in");
  assert.deepEqual(lastResults(s).map((r) => r.scope_id + ":" + r.status), ["scope-set:PASS"]);
  devices = ["pos-1", "pos-2"];
  fail = true;
  await runCycle(deps(s, [fleet]));
  assert.deepEqual(open(s).map((i) => i.scope_type + ":" + i.scope_id).sort(), ["device:pos-1", "device:pos-2", "device:scope-set"]);
  fail = false;
  await runCycle(deps(s, [fleet]));
  assert.equal(open(s).length, 0);
});

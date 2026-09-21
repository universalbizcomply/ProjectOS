import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegistryEntry, SentinelIssue } from "../src/sentinel.ts";
import { runSentinel, planSentinelIssues, mayAdvanceSentinelLiveness, sentinelLivenessResult, registryEntryErrors } from "../src/sentinel.ts";
import { createEmailTransport, renderEmail } from "../src/email.ts";
import type { NotificationBatch } from "../src/notifications.ts";

const entry = (project: string): RegistryEntry => ({
  project, environment: "production", public_url: "https://" + project + ".example.com", health_path: "/health",
  expected_service: project, expected_release: null, timeout_ms: 5000, check_classes: ["reachability", "health"],
});

test("sentinel: no fail-fast — product A throwing does not stop B and C", async () => {
  const probed: string[] = [];
  const out = await runSentinel([entry("a"), entry("b"), entry("c")], async (e) => {
    probed.push(e.project);
    if (e.project === "a") throw new Error("ECONNRESET");
    return e.check_classes.map((cls) => ({ project: e.project, environment: e.environment, check_class: cls, status: "PASS" as const, code: "OK" }));
  }, () => {});
  assert.deepEqual(probed, ["a", "b", "c"]);
  assert.equal(out.length, 6);
  assert.ok(out.filter((o) => o.project === "a").every((o) => o.status === "ERROR" && o.code === "PROBE_NOT_COMPLETED"));
  assert.ok(out.filter((o) => o.project !== "a").every((o) => o.status === "PASS"));
});

test("sentinel: a class the prober did not report is ERROR, not an implicit pass", async () => {
  const out = await runSentinel([entry("a")], async (e) => [{ project: "a", environment: e.environment, check_class: "reachability", status: "PASS", code: "OK" }], () => {});
  assert.equal(out.find((o) => o.check_class === "health")!.status, "ERROR");
});

const NOW = "2026-09-21T10:17:00.000Z";
const issue = (over: Partial<SentinelIssue> = {}): SentinelIssue => ({
  project: "a", environment: "production", check_class: "health", severity: "CRITICAL",
  opened_at: "2026-09-21T09:47:00.000Z", last_alerted_at: "2026-09-21T09:47:00.000Z", ...over,
});
const o = (status: "PASS" | "CRITICAL" | "ERROR" | "WARN") => ({ project: "a", environment: "production", check_class: "health" as const, status, code: "X" });

test("sentinel issues: one deduplicated issue; failure repeated within reminder window does not fail the workflow", () => {
  const first = planSentinelIssues([o("CRITICAL")], [], NOW, 6 * 3600_000);
  assert.equal(first.open.length, 1);
  assert.equal(first.failWorkflow, true);
  const again = planSentinelIssues([o("CRITICAL")], [issue()], NOW, 6 * 3600_000);
  assert.equal(again.open.length, 0);
  assert.equal(again.failWorkflow, false);
  assert.equal(again.keep.length, 1);
});

test("sentinel issues: close only on explicit PASS; ERROR or missing keeps open", () => {
  assert.equal(planSentinelIssues([o("PASS")], [issue()], NOW, 3600_000).close.length, 1);
  assert.equal(planSentinelIssues([o("ERROR")], [issue()], NOW, 6 * 3600_000).close.length, 0);
  assert.equal(planSentinelIssues([], [issue()], NOW, 6 * 3600_000).keep.length, 1);
});

test("sentinel issues: escalation and due reminder fail the workflow", () => {
  assert.equal(planSentinelIssues([o("CRITICAL")], [issue({ severity: "WARN" })], NOW, 6 * 3600_000).escalate.length, 1);
  const due = planSentinelIssues([o("CRITICAL")], [issue({ last_alerted_at: "2026-09-21T04:00:00.000Z" })], NOW, 6 * 3600_000);
  assert.equal(due.remind.length, 1);
  assert.equal(due.failWorkflow, true);
});

test("trust boundary: an unauthenticated public probe can never advance sentinel liveness", () => {
  assert.equal(mayAdvanceSentinelLiveness({ kind: "public" }), false);
  assert.equal(mayAdvanceSentinelLiveness({ kind: "sentinel_credential", verified: false }), false);
  assert.equal(mayAdvanceSentinelLiveness({ kind: "sentinel_credential", verified: true }), true);
});

test("trust boundary: products make no sentinel-staleness claim until probes are authenticated", () => {
  const st = { last_authenticated_probe_at: null, created_at: "2026-09-20T00:00:00.000Z" };
  assert.equal(sentinelLivenessResult("public", st, NOW, 3600), null);
  assert.equal(sentinelLivenessResult("none", st, NOW, 3600), null);
  assert.equal(sentinelLivenessResult("authenticated", st, NOW, 3600)!.status, "CRITICAL");
  assert.equal(sentinelLivenessResult("authenticated", { ...st, last_authenticated_probe_at: "2026-09-21T10:00:00.000Z" }, NOW, 3600)!.status, "PASS");
});

test("registry entries: https only, no credentials, bounded timeout", () => {
  assert.deepEqual(registryEntryErrors(entry("a")), []);
  assert.ok(registryEntryErrors({ ...entry("a"), public_url: "http://a.example.com" }).length > 0);
  assert.ok(registryEntryErrors({ ...entry("a"), public_url: "https://u:p@a.example.com" }).length > 0);
  assert.ok(registryEntryErrors({ ...entry("a"), public_url: "https://a.example.com/?key=1" }).length > 0);
  assert.ok(registryEntryErrors({ ...entry("a"), timeout_ms: 60000 }).length > 0);
  assert.ok(registryEntryErrors({ ...entry("a"), health_path: null }).length > 0);
});

const batch: NotificationBatch = {
  project: "demo", environment: "production", generated_at: "2026-09-21T10:00:00.000Z",
  notifications: [{
    incident_id: "i1", kind: "INITIAL", severity: "CRITICAL", opened_at: "2026-09-21T09:30:00.000Z",
    identity: { project: "demo", environment: "production", source: "runner", check_id: "db<script>", scope_type: "site", scope_id: "site-a" },
  }],
};

test("email: bounded content, escaped, no metadata, test label in subject", () => {
  const e = renderEmail(batch, { productName: "Demo", dashboardUrl: null, test: true });
  assert.ok(e.subject.startsWith("[TEST"));
  assert.ok(e.html.includes("db&lt;script&gt;"));
  assert.ok(e.html.includes("30 min"));
  assert.equal(e.html.includes("metadata"), false);
});

test("email transport: accepted only on 2xx; failures are typed and retryable", async () => {
  const mk = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => createEmailTransport({
    apiKey: "k", from: "a@b.c", recipients: ["ops@example.com"], brand: { productName: "Demo", dashboardUrl: null, test: false }, fetchImpl, ...over,
  });
  assert.deepEqual(await mk((async () => new Response("{}", { status: 200 })) as typeof fetch).send(batch), { accepted: true, code: "accepted" });
  assert.deepEqual(await mk((async () => new Response("{}", { status: 503 })) as typeof fetch).send(batch), { accepted: false, code: "http_503" });
  assert.deepEqual(await mk((async () => { throw new TypeError("fetch failed"); }) as typeof fetch).send(batch), { accepted: false, code: "network" });
  assert.deepEqual(await mk((async () => new Response("{}")) as typeof fetch, { recipients: [] }).send(batch), { accepted: false, code: "no_recipients" });
  assert.deepEqual(await mk((async () => new Response("{}")) as typeof fetch, { apiKey: undefined }).send(batch), { accepted: false, code: "no_api_key" });
});

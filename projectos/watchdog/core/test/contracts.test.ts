import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, parseStatus, isAlerting, alertRank } from "../src/status.ts";
import { validateMetadata, validateMetadataSpec } from "../src/metadata.ts";
import { checkSchemaCompatibility, isCoreCompatible, WATCHDOG_CORE_VERSION, REQUIRED_SCHEMA_VERSION, CORE_CONTRACTS } from "../src/version.ts";
import { identityErrors, identityKey } from "../src/identity.ts";
import { toPublicHealth, releaseIdentityErrors } from "../src/release.ts";
import { constantTimeEqual } from "../src/compare.ts";

test("status contract: exactly PASS INFO WARN CRITICAL ERROR", () => {
  assert.deepEqual([...STATUSES], ["PASS", "INFO", "WARN", "CRITICAL", "ERROR"]);
  for (const s of STATUSES) assert.equal(parseStatus(s), s);
  for (const bad of ["pass", "FAIL", "UNKNOWN", "", null, undefined, 3]) assert.throws(() => parseStatus(bad));
});

test("status contract: ERROR alerts and is never PASS; INFO never alerts", () => {
  assert.equal(isAlerting("ERROR"), true);
  assert.equal(isAlerting("INFO"), false);
  assert.equal(isAlerting("PASS"), false);
  assert.ok(alertRank("CRITICAL") > alertRank("ERROR") && alertRank("ERROR") > alertRank("WARN") && alertRank("WARN") > alertRank("PASS"));
});

const SPEC = {
  count: { type: "integer" },
  ratio: { type: "number" },
  ok: { type: "boolean" },
  at: { type: "timestamp" },
  id: { type: "uuid" },
  code: { type: "code" },
  mode: { type: "enum", values: ["A", "B"] },
} as const;

test("metadata: typed allowlisted values accepted", () => {
  const r = validateMetadata({ count: 3, ratio: 0.5, ok: true, at: "2026-09-21T10:00:00Z", id: "00000000-0000-4000-8000-000000000001", code: "HTTP_503", mode: "A" }, SPEC);
  assert.equal(r.ok, true);
});

test("metadata: customer data, free text, payloads and secrets rejected", () => {
  const cases: Array<Record<string, unknown>> = [
    { email: "jon@example.com" },                       // key not allowlisted
    { code: "jon@example.com" },                        // not a code
    { code: "Customer Name" },                          // free text
    { mode: "C" },                                      // enum mismatch
    { count: 1.5 },                                     // not integer
    { count: "3" },                                     // wrong type
    { code: { nested: true } },                         // object payload
    { at: "Error: boom\n    at x (y.ts:1:1)" },         // stack trace
    { id: "not-a-uuid" },
    { code: "SK_LIVE_" + "A".repeat(70) },              // over length
  ];
  for (const c of cases) assert.equal(validateMetadata(c, SPEC).ok, false, JSON.stringify(c));
  assert.equal(validateMetadata([1, 2], SPEC).ok, false);
  const many: Record<string, number> = {};
  for (let i = 0; i < 17; i++) many["k" + i] = i;
  assert.equal(validateMetadata(many, Object.fromEntries(Object.keys(many).map((k) => [k, { type: "integer" as const }]))).ok, false);
});

test("metadata spec: invalid key names and empty enums refused", () => {
  assert.ok(validateMetadataSpec({ "Bad Key": { type: "integer" } }).length > 0);
  assert.ok(validateMetadataSpec({ e: { type: "enum", values: [] } }).length > 0);
});

test("schema compatibility: refuses missing, older and newer schema truthfully", () => {
  assert.equal(REQUIRED_SCHEMA_VERSION, 1);
  assert.deepEqual(checkSchemaCompatibility(1), { ok: true, installed: 1, required: 1 });
  assert.equal((checkSchemaCompatibility(null) as { reason: string }).reason, "schema_missing");
  assert.equal((checkSchemaCompatibility(0) as { reason: string }).reason, "schema_missing");
  assert.equal((checkSchemaCompatibility(2) as { reason: string }).reason, "schema_too_new");
  assert.equal((checkSchemaCompatibility("1") as { reason: string }).reason, "schema_missing");
});

test("core version compatibility: 0.x needs same minor", () => {
  assert.equal(WATCHDOG_CORE_VERSION, "0.1.1");
  assert.equal(isCoreCompatible("0.1.7"), true);
  assert.equal(isCoreCompatible("0.2.0"), false);
  assert.equal(isCoreCompatible("1.1.0"), false);
  assert.equal(isCoreCompatible("garbage"), false);
  assert.equal(isCoreCompatible("1.4.0", "1.0.0"), true);
  assert.ok(CORE_CONTRACTS.includes("positive-recovery.v1"));
});

test("incident identity: every field required, scope is part of the key", () => {
  const a = { project: "p", environment: "production", source: "runner", check_id: "c", scope_type: "site", scope_id: "site-a" };
  assert.deepEqual(identityErrors(a), []);
  assert.notEqual(identityKey(a), identityKey({ ...a, scope_id: "site-b" }));
  assert.ok(identityErrors({ ...a, scope_id: "" }).length > 0);
  assert.ok(identityErrors({ ...a, project: "Has Space" }).length > 0);
});

const REL = { project: "demo", environment: "production", release_sha: "0123456789abcdef0123456789abcdef01234567", deployment_id: "dpl_1", deployed_at: "2026-09-21T10:00:00Z", watchdog_core_version: "0.1.0", schema_version: 1 };

test("release identity: public form exposes only five safe fields", () => {
  const p = toPublicHealth(REL);
  assert.deepEqual(Object.keys(p).sort(), ["environment", "release", "service", "status", "watchdog"]);
  assert.equal(p.release, "0123456");
  assert.equal(p.status, "ok");
  assert.equal(JSON.stringify(p).includes("dpl_1"), false);
  assert.equal(JSON.stringify(p).includes("2026"), false);
});

test("release identity: monitor state only exposed when opted in", () => {
  assert.equal(toPublicHealth(REL, { monitorHealthy: false }).status, "ok");
  assert.equal(toPublicHealth(REL, { exposeMonitorState: true, monitorHealthy: false }).status, "degraded");
  assert.ok(releaseIdentityErrors({ ...REL, release_sha: "XYZ" }).length > 0);
  assert.throws(() => toPublicHealth({ ...REL, schema_version: 0 }));
});

test("constant-time compare", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("", ""), false);
  assert.equal(constantTimeEqual(undefined, "a"), false);
});

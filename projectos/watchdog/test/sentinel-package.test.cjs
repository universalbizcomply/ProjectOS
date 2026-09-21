"use strict";
// PROJECTOS-WATCHDOG-SENTINEL1A (P3): registrations, contract keys, packaging.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const lib = require("../../scripts/_watchdog-lib.cjs");
const { generate, entryFromRegistration } = require("../../scripts/watchdog-sentinel-registry.cjs");
const { workflowFrom, verify, ALLOWED_SCHEDULES } = require("../../scripts/watchdog-sentinel-package.cjs");

const SENTINEL = path.join(__dirname, "..", "sentinel");
const TEMPLATE = fs.readFileSync(path.join(SENTINEL, "workflow.template.yml"), "utf8");
const SHA = "3f2f688" + "0".repeat(33);

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sentinel-"));
  for (const [rel, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof v === "string" ? v : JSON.stringify(v));
  }
  return dir;
}

test("JD registration generates a valid registry with the public contract and an observed (unpinned) release", () => {
  const reg = generate(path.join(SENTINEL, "registry", "sources.json"), SHA);
  assert.deepEqual(lib.registryErrors(reg), []);
  const jd = reg.entries.find((e) => e.project === "jd-testing");
  assert.equal(jd.public_url, "https://jdtesting.uk");
  assert.equal(jd.health_path, "/version.json");
  assert.equal(jd.expected_service, "jd-testing");
  assert.equal(jd.expected_environment, "production");
  assert.equal(jd.expected_watchdog, "0.1.0");
  assert.equal(jd.expected_release, null, "release is observed, never hard-coded");
});

test("registration refuses unknown keys, a pinned release, missing profile ref and invalid URLs", () => {
  const base = JSON.parse(fs.readFileSync(path.join(SENTINEL, "registry", "registrations", "jd-testing.production.json"), "utf8"));
  const bad = (patch) => { const d = tmp({ "r.json": { ...base, ...patch } }); return () => entryFromRegistration(path.join(d, "r.json")); };
  assert.throws(bad({ expected_release: "20ebfe5" }), /unexpected key expected_release/);
  assert.throws(bad({ secret: "x" }), /unexpected key secret/);
  assert.throws(bad({ product_profile_ref: "" }), /product_profile_ref/);
  assert.throws(bad({ public_url: "http://jdtesting.uk" }), /must be https/);
  assert.throws(bad({ expected_watchdog: "v1" }), /invalid expected_watchdog/);
});

test("workflow: manual dispatch only unless an approved cadence is given; anything else is refused", () => {
  const none = workflowFrom(TEMPLATE, null);
  assert.doesNotMatch(none, /schedule|cron/);
  assert.match(none, /workflow_dispatch/);
  assert.match(none, /permissions:\s*\n\s+contents: read\s*\n\s+issues: write/);
  for (const s of ALLOWED_SCHEDULES) assert.match(workflowFrom(TEMPLATE, s), new RegExp('cron: "' + s.replace(/\*/g, "\\*") + '"'));
  assert.ok(ALLOWED_SCHEDULES.includes("17 6 * * *"), "Owner-chosen daily backup cadence");
  assert.throws(() => workflowFrom(TEMPLATE, "*/5 * * * *"), /schedule must be one of/);
});

test("package --verify detects modified files, registry drift and unapproved schedules", () => {
  const reg = generate(path.join(SENTINEL, "registry", "sources.json"), SHA);
  const wf = workflowFrom(TEMPLATE, "17 * * * *");
  const files = { "sentinel/registry.json": lib.canonicalJson(reg), ".github/workflows/watchdog-sentinel.yml": wf, "core/src/index.ts": "export {};\n" };
  const hash = (t) => require("crypto").createHash("sha256").update(t, "utf8").digest("hex");
  const lock = { lock_version: 1, registry_sha256: reg.content_sha256, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, hash(v)])) };
  const dir = tmp({ ...files, "sentinel.lock.json": lock });
  assert.deepEqual(verify(dir), []);
  fs.writeFileSync(path.join(dir, "core/src/index.ts"), "export const x = 1;\n");
  assert.ok(verify(dir).includes("modified core/src/index.ts"));
  const dir2 = tmp({ ...files, ".github/workflows/watchdog-sentinel.yml": wf.replace("17 * * * *", "*/5 * * * *"), "sentinel.lock.json": lock });
  assert.ok(verify(dir2).some((e) => /unapproved schedule/.test(e)));
});

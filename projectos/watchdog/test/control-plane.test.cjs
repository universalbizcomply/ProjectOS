"use strict";
// Control-plane tests: sync determinism, lock integrity, adapter protection,
// conformance states, sentinel registry generation and drift detection.
// Uses throwaway git repositories in the OS temp directory only.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const lib = require(path.join(ROOT, "projectos/scripts/_watchdog-lib.cjs"));
const sync = require(path.join(ROOT, "projectos/scripts/watchdog-sync.cjs"));
const registry = require(path.join(ROOT, "projectos/scripts/watchdog-sentinel-registry.cjs"));
const conformance = require(path.join(ROOT, "projectos/validators/val-watchdog-conformance.cjs"));

let tmp, source, commit;

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function copyInto(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(source, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function newProduct(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, ".projectops"), { recursive: true });
  fs.mkdirSync(path.join(dir, "supabase/functions/_shared"), { recursive: true });
  return dir;
}

function writeProfile(dir, over) {
  const p = {
    profile_version: 1,
    onboarding_status: "WATCHDOG_INSTALLED",
    runtime: { install_path: lib.DEFAULT_INSTALL_PATH, adapter_path: "supabase/functions/_shared/watchdog-adapter.ts" },
    health: { health_endpoint_path: null, health_not_applicable_reason: null, release_endpoint_path: null },
    monitor: { cadence_seconds: 300, sources: ["runner", "watchdog"] },
    critical_jobs: [],
    notifications: { recipients_setting_ref: null },
    sentinel: { mode: "none", check_classes: [] },
    components: [],
    ...over,
  };
  fs.writeFileSync(path.join(dir, ".projectops/watchdog.json"), JSON.stringify(p, null, 2));
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-watchdog-cp-"));
  source = path.join(tmp, "ProjectOS");
  fs.mkdirSync(source);
  git(source, "init", "-q");
  git(source, "config", "user.email", "test@example.invalid");
  git(source, "config", "user.name", "watchdog-test");
  git(source, "config", "core.autocrlf", "false");
  for (const rel of ["projectos/watchdog/core/src", "projectos/watchdog/core/package.json", "projectos/watchdog/core/test",
    "projectos/watchdog/sql/migrations", "projectos/watchdog/sql/privilege-gate.sql", "projectos/watchdog/sql/test"]) copyInto(rel);
  git(source, "add", "projectos");
  git(source, "commit", "-q", "-m", "watchdog core");
  git(source, "tag", "watchdog-core/v0.1.1");
  git(source, "tag", "watchdog-core/v0.2.0"); // deliberately wrong: code says 0.1.1
  commit = git(source, "rev-parse", "HEAD");
});

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test("sync: exact tag -> exact commit, lock is complete and path-free", () => {
  const dir = newProduct("p-lock");
  const p = sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source });
  sync.apply(p);
  const lock = lib.readJson(path.join(dir, "watchdog-core.lock.json"));
  assert.deepEqual(lib.lockErrors(lock), []);
  assert.equal(lock.commit, commit);
  assert.equal(lock.watchdog_core_version, "0.1.1");
  assert.equal(lock.schema_version, 1);
  assert.equal(lock.source_repository, "universalbizcomply/ProjectOS");
  assert.ok(lock.files["src/runner.ts"] && lock.files["sql/migrations/0001_watchdog_schema_v1.sql"] && lock.files["sql/privilege-gate.sql"]);
  assert.equal(Object.keys(lock.files).some((f) => f.includes("test")), false, "tests are not shipped");
  assert.equal(JSON.stringify(lock).includes(tmp.replace(/\\/g, "\\\\")), false, "no local paths");
  assert.deepEqual(p.upgrade, [lib.DEFAULT_INSTALL_PATH + "/sql/migrations/0001_watchdog_schema_v1.sql"]);
  assert.deepEqual(lib.verifyInstall(dir, lock), []);
});

test("sync: deterministic — two products get byte-identical lock and files", () => {
  const a = newProduct("p-a"), b = newProduct("p-b");
  sync.apply(sync.plan({ target: a, tag: "watchdog-core/v0.1.1", source }));
  sync.apply(sync.plan({ target: b, tag: "watchdog-core/v0.1.1", source }));
  const la = fs.readFileSync(path.join(a, "watchdog-core.lock.json"), "utf8");
  assert.equal(la, fs.readFileSync(path.join(b, "watchdog-core.lock.json"), "utf8"));
  for (const f of Object.keys(JSON.parse(la).files)) {
    assert.equal(fs.readFileSync(path.join(a, lib.DEFAULT_INSTALL_PATH, f), "utf8"), fs.readFileSync(path.join(b, lib.DEFAULT_INSTALL_PATH, f), "utf8"));
  }
  // re-running on an up-to-date product changes nothing
  const again = sync.plan({ target: a, tag: "watchdog-core/v0.1.1", source });
  assert.equal(sync.isCurrent(again), true);
});

test("sync: reads the tagged commit, never the working tree", () => {
  const f = path.join(source, "projectos/watchdog/core/src/compare.ts");
  const original = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, original + "\n// uncommitted edit\n");
  try {
    const dir = newProduct("p-wt");
    sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
    assert.equal(fs.readFileSync(path.join(dir, lib.DEFAULT_INSTALL_PATH, "src/compare.ts"), "utf8").includes("uncommitted edit"), false);
  } finally {
    fs.writeFileSync(f, original);
  }
});

test("sync: refuses a tag whose version does not match the code, and non-release tags", () => {
  assert.throws(() => sync.plan({ target: newProduct("p-bad"), tag: "watchdog-core/v0.2.0", source }), /does not match core version/);
  assert.throws(() => sync.plan({ target: newProduct("p-bad2"), tag: "main", source }), /watchdog-core\/vX\.Y\.Z/);
  assert.throws(() => sync.plan({ target: newProduct("p-bad3"), tag: "watchdog-core/v9.9.9", source }), /git/);
});

test("sync: never overwrites a modified vendored core, foreign files, or an unlocked install dir", () => {
  const dir = newProduct("p-guard");
  sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
  const adapter = path.join(dir, "supabase/functions/_shared/watchdog-adapter.ts");
  fs.writeFileSync(adapter, "// product adapter\n");
  const vendored = path.join(dir, lib.DEFAULT_INSTALL_PATH, "src/status.ts");
  const orig = fs.readFileSync(vendored, "utf8");
  fs.writeFileSync(vendored, orig + "\n// local hack\n");
  assert.throws(() => sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }), /does not match its lock/);
  fs.writeFileSync(vendored, orig);
  fs.writeFileSync(path.join(dir, lib.DEFAULT_INSTALL_PATH, "src/my-adapter.ts"), "x");
  assert.throws(() => sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }), /unexpected file/);
  fs.rmSync(path.join(dir, lib.DEFAULT_INSTALL_PATH, "src/my-adapter.ts"));
  sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
  assert.equal(fs.readFileSync(adapter, "utf8"), "// product adapter\n", "adapter untouched");

  const fresh = newProduct("p-unlocked");
  fs.mkdirSync(path.join(fresh, lib.DEFAULT_INSTALL_PATH), { recursive: true });
  fs.writeFileSync(path.join(fresh, lib.DEFAULT_INSTALL_PATH, "handwritten.ts"), "x");
  assert.throws(() => sync.plan({ target: fresh, tag: "watchdog-core/v0.1.1", source }), /no lock/);
});

test("sync: CRLF checkouts still verify (canonical hashing)", () => {
  const dir = newProduct("p-crlf");
  sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
  const f = path.join(dir, lib.DEFAULT_INSTALL_PATH, "src/index.ts");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(lib.verifyInstall(dir, lib.readJson(path.join(dir, "watchdog-core.lock.json"))), []);
});

test("conformance: installed product passes; tampering, foreign keys and missing DoD fields fail", () => {
  const dir = newProduct("p-conf");
  sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
  fs.writeFileSync(path.join(dir, "supabase/functions/_shared/watchdog-adapter.ts"), "// adapter\n");
  writeProfile(dir, {});
  assert.deepEqual(conformance.run({ target: dir }), []);

  writeProfile(dir, { onboarding_status: "CONFORMANT" });
  const missing = conformance.run({ target: dir }).join("\n");
  for (const need of ["release_endpoint_path", "critical job", "recipients_setting_ref", "component"]) assert.match(missing, new RegExp(need));

  fs.mkdirSync(path.join(dir, "supabase/functions/watchdog-runner"), { recursive: true });
  writeProfile(dir, {
    onboarding_status: "CONFORMANT",
    health: { health_endpoint_path: "/functions/v1/watchdog-health", health_not_applicable_reason: null, release_endpoint_path: "/functions/v1/watchdog-health" },
    critical_jobs: [{ job_id: "watchdog-runner", scheduler_name: "watchdog-runner-5min", expected_interval_s: 300, stale_after_s: 900, max_run_s: 120, failure_threshold: 3 }],
    notifications: { recipients_setting_ref: "system_monitor_notification_recipients" },
    components: [{ component_id: "watchdog-runner", repo_path: "supabase/functions/watchdog-runner", deploy_target: "supabase-edge" }],
  });
  assert.deepEqual(conformance.run({ target: dir }), []);

  const profile = lib.readJson(path.join(dir, ".projectops/watchdog.json"));
  fs.writeFileSync(path.join(dir, ".projectops/watchdog.json"), JSON.stringify({ ...profile, supabase_ref: "abc" }));
  assert.match(conformance.run({ target: dir }).join("\n"), /duplicate project config key: supabase_ref/);
  fs.writeFileSync(path.join(dir, ".projectops/watchdog.json"), JSON.stringify({ ...profile, notifications: { recipients_setting_ref: "ops@example.com" } }));
  assert.match(conformance.run({ target: dir }).join("\n"), /addresses/);
  fs.writeFileSync(path.join(dir, ".projectops/watchdog.json"), JSON.stringify({ ...profile, components: [{ component_id: "x", repo_path: "../outside", deploy_target: "y" }] }));
  assert.match(conformance.run({ target: dir }).join("\n"), /safe relative path/);
  fs.writeFileSync(path.join(dir, ".projectops/watchdog.json"), JSON.stringify(profile));

  const lockPath = path.join(dir, "watchdog-core.lock.json");
  const lock = lib.readJson(lockPath);
  fs.writeFileSync(lockPath, JSON.stringify({ ...lock, schema_version: 2 }));
  assert.match(conformance.run({ target: dir }).join("\n"), /requires schema 1 but lock records 2/);
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  fs.appendFileSync(path.join(dir, lib.DEFAULT_INSTALL_PATH, "sql/migrations/0001_watchdog_schema_v1.sql"), "\ngrant execute on function public.watchdog_status() to anon;\n");
  const tampered = conformance.run({ target: dir }).join("\n");
  assert.match(tampered, /hash mismatch/);
  assert.match(tampered, /grants to a client role/);
});

test("conformance: legacy products onboard gradually", () => {
  const dir = newProduct("p-legacy");
  assert.match(conformance.run({ target: dir }).join("\n"), /NOT_INTEGRATED/);
  writeProfile(dir, { onboarding_status: "DISCOVERED", runtime: { install_path: null, adapter_path: null } });
  assert.deepEqual(conformance.run({ target: dir }), []);
});

test("adapter template type-checks against a synced product (Deno)", { skip: spawnSync("deno", ["--version"]).status !== 0 && "deno not installed" }, () => {
  const dir = newProduct("p-adapter");
  sync.apply(sync.plan({ target: dir, tag: "watchdog-core/v0.1.1", source }));
  const adapter = path.join(dir, "supabase/functions/_shared/watchdog-adapter.ts");
  fs.copyFileSync(path.join(ROOT, "projectos/watchdog/templates/watchdog-adapter.template.ts"), adapter);
  const r = spawnSync("deno", ["check", "--no-config", adapter], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("registry: generated from config, verifies; tampering and unsafe content fail", () => {
  const src = path.join(ROOT, "projectos/watchdog/sentinel/example/registry-sources.example.json");
  const reg = registry.generate(src, commit);
  assert.deepEqual(lib.registryErrors(reg), []);
  assert.equal(reg.entries[0].public_url, "https://example.com");
  assert.equal(reg.entries[0].health_path, "/health");
  const committed = lib.readJson(path.join(ROOT, "projectos/watchdog/sentinel/example/registry.example.json"));
  assert.equal(committed.content_sha256, reg.content_sha256, "committed example matches generator");

  const tampered = JSON.parse(JSON.stringify(reg));
  tampered.entries[0].public_url = "https://evil.example.com";
  assert.match(lib.registryErrors(tampered).join("\n"), /content_sha256/);
  const withToken = JSON.parse(JSON.stringify(reg));
  withToken.entries[0].api_token = "x";
  withToken.content_sha256 = lib.registryContentHash(withToken.entries);
  assert.match(lib.registryErrors(withToken).join("\n"), /credential-like|unexpected registry key/);
  const http = JSON.parse(JSON.stringify(reg));
  http.entries[0].public_url = "http://example.com";
  http.content_sha256 = lib.registryContentHash(http.entries);
  assert.match(lib.registryErrors(http).join("\n"), /https/);
});

test("registry: products with sentinel mode none are not probed", () => {
  const d = path.join(tmp, "reg-none");
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "cfg.json"), JSON.stringify({ projectId: "quiet", environments: { production: { url: "https://quiet.example.com" } } }));
  const prof = lib.readJson(path.join(ROOT, "projectos/watchdog/templates/watchdog-profile.template.json"));
  fs.writeFileSync(path.join(d, "prof.json"), JSON.stringify(prof));
  fs.writeFileSync(path.join(d, "sources.json"), JSON.stringify({ sources: [{ project_config: "cfg.json", profile: "prof.json", environment: "production" }] }));
  assert.equal(registry.generate(path.join(d, "sources.json"), commit).entries.length, 0);
});

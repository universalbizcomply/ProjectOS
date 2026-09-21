"use strict";
// ProjectOS Watchdog — product conformance (definition of done), static part.
//
//   node projectos/validators/val-watchdog-conformance.cjs --target <product checkout>
//
// Reads the product's watchdog-core.lock.json, its vendored core and its
// .projectops/watchdog.json profile. Requirements scale with the profile's
// onboarding_status, so legacy products can onboard gradually:
//   any status          profile valid, no duplicated project-config keys, no
//                       credentials or addresses
//   WATCHDOG_INSTALLED  lock valid; every vendored file present and unmodified;
//                       no foreign files in the vendored core; core and schema
//                       versions consistent; required contracts declared;
//                       vendored SQL has no client grants/policies; privilege
//                       gate shipped; adapter outside the vendored core
//   CONFORMANT          + health/release contract configured, critical jobs,
//                       recipients setting reference, cadence, component map
//                       whose repo paths exist
//   OUTER_SENTINEL_ACTIVE + sentinel mode and check classes
// Live checks (privilege gate against the product database, job registration
// in pg_cron, endpoint responses, smoke test) belong to each product phase and
// are recorded as evidence; this validator never connects to production.

const fs = require("fs");
const path = require("path");
const lib = require("../scripts/_watchdog-lib.cjs");

const REQUIRED_CONTRACTS = ["status.v1", "run.v1", "incident-identity.v1", "incident-ownership.v1", "positive-recovery.v1",
  "notification-truth.v1", "metadata.v1", "job-health.v1", "release-identity.v1", "sentinel-trust.v1"];

function run(opts = {}) {
  const target = opts.target ? path.resolve(opts.target) : null;
  if (!target || !fs.existsSync(target)) return ["--target <product checkout> is required"];
  const errors = [];
  const profilePath = path.join(target, ".projectops", "watchdog.json");
  if (!fs.existsSync(profilePath)) return [".projectops/watchdog.json missing (status NOT_INTEGRATED)"];
  let profile;
  try { profile = lib.readJson(profilePath); } catch (e) { return ["watchdog.json invalid JSON: " + e.message]; }
  errors.push(...lib.profileErrors(profile, { targetDir: target }).map((e) => "profile: " + e));
  const rank = lib.stateRank(profile.onboarding_status);
  if (rank < lib.stateRank("WATCHDOG_INSTALLED")) return errors;

  const lockPath = path.join(target, "watchdog-core.lock.json");
  if (!fs.existsSync(lockPath)) return errors.concat(["watchdog-core.lock.json missing"]);
  const lock = lib.readJson(lockPath);
  const le = lib.lockErrors(lock);
  if (le.length) return errors.concat(le.map((e) => "lock: " + e));
  if (profile.runtime && profile.runtime.install_path !== lock.install_path) errors.push("profile runtime.install_path != lock install_path");
  errors.push(...lib.verifyInstall(target, lock).map((e) => "vendored core: " + e));

  const base = path.join(target, lock.install_path);
  const versionTs = fs.existsSync(path.join(base, "src/version.ts")) ? fs.readFileSync(path.join(base, "src/version.ts"), "utf8") : "";
  const v = lib.parseCoreVersions(versionTs);
  if (v.core !== lock.watchdog_core_version) errors.push("vendored core version " + v.core + " != lock " + lock.watchdog_core_version);
  if (v.schema !== lock.schema_version) errors.push("vendored core requires schema " + v.schema + " but lock records " + lock.schema_version);
  for (const c of REQUIRED_CONTRACTS) if (!v.contracts.includes(c)) errors.push("vendored core does not declare contract " + c);
  const migs = Object.keys(lock.files).filter((f) => f.startsWith("sql/migrations/")).map(lib.migrationNumber);
  if (!migs.length || Math.max(...migs) !== lock.schema_version) errors.push("vendored migrations do not reach schema " + lock.schema_version);
  if (!lock.files["sql/privilege-gate.sql"]) errors.push("privilege gate not vendored");
  for (const f of Object.keys(lock.files).filter((x) => x.endsWith(".sql"))) {
    const sql = fs.existsSync(path.join(base, f)) ? fs.readFileSync(path.join(base, f), "utf8").replace(/--[^\r\n]*/g, "") : "";
    if (/create\s+policy/i.test(sql)) errors.push(f + ": creates an RLS policy");
    if (/grant\s+[^;]*\bto\s+(anon|authenticated|public)\b/i.test(sql)) errors.push(f + ": grants to a client role");
  }
  const adapter = profile.runtime && profile.runtime.adapter_path;
  if (adapter && !fs.existsSync(path.join(target, adapter))) errors.push("adapter " + adapter + " not found");
  return errors;
}

if (require.main === module) {
  const i = process.argv.indexOf("--target");
  const e = run({ target: i >= 0 ? process.argv[i + 1] : null });
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("val-watchdog-conformance: " + e.length + " error(s)"); process.exit(1); }
  console.log("val-watchdog-conformance: PASS");
}
module.exports = { run };

"use strict";
// PROJECTOS-WATCHDOG-CORE1A — canonical Watchdog source validator.
//
// Static checks on projectos/watchdog/ in THIS repository (part of
// validate-all). Behaviour is proven by the core tests and the live
// PostgreSQL harness; these checks prove the parts that are easy to break
// quietly:
//   * structure, and version / schema-version consistency (core version and
//     schema version are separate numbers, each declared once)
//   * the core is portable and self-contained: relative .ts imports only, no
//     Node/Deno/npm/URL imports, no process/Deno globals, no console.log
//   * no product branding or business rules inside the core or SQL template
//   * SQL template: every public entry point SECURITY DEFINER + search_path ''
//     + trusted-caller guard; no client grants; no policies; RLS on every
//     table; revoke sweep present; forward-only migration naming
//   * profile template, schemas and the example sentinel registry are valid
//   * sentinel workflow template: not scheduled, pinned actions, least
//     privilege, single job

const fs = require("fs");
const path = require("path");
const lib = require("../scripts/_watchdog-lib.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const W = path.join(ROOT, "projectos", "watchdog");
const rel = (...p) => path.join(W, ...p);
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\r\n]*/g, "$1");
const stripSql = (s) => s.replace(/--[^\r\n]*/g, "");

const REQUIRED_FILES = [
  "README.md",
  "core/package.json",
  ...["version", "status", "metadata", "identity", "incidents", "notifications", "jobs", "runner", "release", "sentinel", "email", "compare", "index"].map((m) => "core/src/" + m + ".ts"),
  "sql/migrations/0001_watchdog_schema_v1.sql",
  "sql/privilege-gate.sql",
  "sql/test/pg-harness.cjs",
  "sql/test/assertions.sql",
  "sentinel/run-sentinel.ts",
  "sentinel/workflow.template.yml",
  "sentinel/example/registry.example.json",
  "templates/watchdog-profile.template.json",
  "templates/watchdog-adapter.template.ts",
];

// Product names, product identifiers and business-domain terms that must never
// appear in the generic core or schema template.
const PRODUCT_TERMS = /\b(jd[ -]?testing|jdtesting|rawfqlvnylobdnwwxraz|polygo|kakoli|bizcomply|opsoft|booking|bookings|invoice|stripe|gocardless|truelayer|deposit|customer)\b/i;

function run() {
  const errors = [];
  const err = (m) => errors.push(m);

  for (const f of REQUIRED_FILES) if (!fs.existsSync(rel(f))) err("missing projectos/watchdog/" + f);
  if (errors.length) return errors;

  // ---- versions ---------------------------------------------------------------
  const v = lib.parseCoreVersions(read(rel("core/src/version.ts")));
  const pkg = JSON.parse(read(rel("core/package.json")));
  if (!v.core) err("version.ts: WATCHDOG_CORE_VERSION not found");
  if (pkg.version !== v.core) err("core/package.json version " + pkg.version + " != WATCHDOG_CORE_VERSION " + v.core);
  if (!pkg.watchdog || pkg.watchdog.requiredSchemaVersion !== v.schema) err("core/package.json watchdog.requiredSchemaVersion != REQUIRED_SCHEMA_VERSION");
  const migrations = fs.readdirSync(rel("sql/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const nums = migrations.map(lib.migrationNumber);
  if (nums.some((n) => n === null)) err("migration files must be named NNNN_lower_snake.sql");
  nums.forEach((n, i) => { if (n !== i + 1) err("migrations must be contiguous from 0001 (found " + migrations[i] + ")"); });
  if (Math.max(...nums) !== v.schema) err("REQUIRED_SCHEMA_VERSION " + v.schema + " != highest migration " + Math.max(...nums));
  for (const m of migrations) {
    const n = lib.migrationNumber(m);
    if (!new RegExp("insert into watchdog\\.schema_migrations \\(version\\) values \\(" + n + "\\)").test(read(rel("sql/migrations", m)))) {
      err(m + " does not record schema version " + n);
    }
  }
  for (const c of ["status.v1", "run.v1", "incident-identity.v1", "incident-ownership.v1", "positive-recovery.v1", "notification-truth.v1", "metadata.v1", "job-health.v1", "release-identity.v1", "sentinel-trust.v1"]) {
    if (!v.contracts.includes(c)) err("CORE_CONTRACTS missing " + c);
  }

  // ---- core portability and neutrality ------------------------------------------
  const srcDir = rel("core/src");
  for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith(".ts"))) {
    const code = stripTs(read(path.join(srcDir, f)));
    for (const m of code.matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"/g)) {
      if (!/^\.\/[a-z-]+\.ts$/.test(m[1])) err("core/src/" + f + ": non-relative or non-.ts import " + m[1]);
    }
    if (/\bimport\s*\(/.test(code)) err("core/src/" + f + ": dynamic import");
    if (/\b(Deno|process|require)\s*[.(]/.test(code)) err("core/src/" + f + ": runtime-specific global");
    if (/console\.log/.test(code)) err("core/src/" + f + ": console.log");
    if (/\benum\s+[A-Z]|\bnamespace\s+[A-Z]|constructor\s*\(\s*(public|private|protected|readonly)\s/.test(code)) err("core/src/" + f + ": non-erasable TypeScript syntax");
    if (PRODUCT_TERMS.test(code)) err("core/src/" + f + ": product/business term in generic core: " + PRODUCT_TERMS.exec(code)[0]);
  }

  // ---- SQL template ----------------------------------------------------------
  const sqlRaw = migrations.map((m) => read(rel("sql/migrations", m))).join("\n");
  const sql = stripSql(sqlRaw);
  if (PRODUCT_TERMS.test(sql)) err("SQL template contains product/business term: " + PRODUCT_TERMS.exec(sql)[0]);
  if (/create\s+policy/i.test(sql)) err("SQL template must not create RLS policies");
  if (/grant\s+[^;]*\bto\s+(anon|authenticated|public)\b/i.test(sql)) err("SQL template grants to a client role");
  if (!/revoke all on schema watchdog from public/i.test(sql)) err("SQL template must revoke schema watchdog from public");
  if (!/alter default privileges in schema watchdog revoke execute on functions from public/i.test(sql)) err("SQL template must revoke default EXECUTE in schema watchdog");
  // Every migration that creates or replaces a public entry point must end with
  // the revoke sweep: platform default privileges can grant EXECUTE on creation.
  for (const m of migrations) {
    const body = stripSql(read(rel("sql/migrations", m)));
    if (/create or replace function public\./i.test(body)) {
      const sweepAt = body.search(/p\.proname like 'watchdog\\_%'/);
      const lastCreate = body.toLowerCase().lastIndexOf("create or replace function public.");
      if (sweepAt < 0 || !/revoke all on function %s from public/.test(body) || sweepAt < lastCreate) {
        err(m + ": must sweep-revoke every watchdog function AFTER its last public function definition");
      }
    }
  }
  const fnBlocks = sql.split(/create or replace function /i).slice(1);
  let entryPoints = 0;
  for (const b of fnBlocks) {
    const name = b.slice(0, b.indexOf("("));
    if (!name.startsWith("public.")) continue;
    entryPoints++;
    if (!name.startsWith("public.watchdog_")) err(name + ": public functions must be named watchdog_*");
    const header = b.slice(0, b.indexOf("$$"));
    if (!/security definer/i.test(header)) err(name + ": must be SECURITY DEFINER");
    if (!/set search_path = ''/i.test(header)) err(name + ": must pin search_path = ''");
    if (!/perform watchdog\._assert_trusted_caller\(\);/.test(b.slice(0, b.indexOf("end $$")))) err(name + ": must call watchdog._assert_trusted_caller() first");
  }
  if (entryPoints < 20) err("expected the full set of public watchdog_* entry points, found " + entryPoints);
  for (const b of fnBlocks.filter((x) => x.startsWith("watchdog."))) {
    const header = b.slice(0, b.indexOf("$$"));
    if (/security definer/i.test(header)) err("internal helper " + b.slice(0, b.indexOf("(")) + " must not be SECURITY DEFINER");
    if (!/set search_path = ''/i.test(header)) err("internal helper " + b.slice(0, b.indexOf("(")) + " must pin search_path");
  }
  const tables = [...sql.matchAll(/create table if not exists watchdog\.([a-z_]+)/g)].map((m) => m[1]);
  const rlsList = /foreach t in array array\[([^\]]+)\]/.exec(sql);
  for (const t of tables) if (!rlsList || !rlsList[1].includes("'" + t + "'")) err("table watchdog." + t + " is not in the RLS/revoke list");
  if (!/unique index if not exists incident_one_open_per_identity\s+on watchdog\.incident \(project, environment, source, check_id, scope_type, scope_id\) where state = 'OPEN'/.test(sql)) {
    err("incident identity uniqueness must cover project, environment, source, check_id, scope_type, scope_id");
  }
  if (!/_metadata_is_safe\(metadata\)/.test(sql)) err("check_result metadata must be guarded by _metadata_is_safe");
  if (!/'PASS'\)\s*then\s*raise|_has_evidence\([^)]*'PASS'\)/.test(sql)) err("recovery must require PASS evidence in SQL");
  const gate = read(rel("sql/privilege-gate.sql"));
  for (const need of ["has_function_privilege", "has_table_privilege", "has_schema_privilege", "aclexplode"]) {
    if (!gate.includes(need)) err("privilege-gate.sql must use " + need);
  }

  // ---- profile template, schemas, registry -------------------------------------
  const tpl = lib.readJson(rel("templates/watchdog-profile.template.json"));
  for (const e of lib.profileErrors(tpl)) err("watchdog-profile.template.json: " + e);
  for (const s of ["watchdog-profile", "watchdog-lock", "watchdog-sentinel-registry"]) {
    const p = path.join(ROOT, "projectos", "schemas", s + ".schema.json");
    if (!fs.existsSync(p)) { err("missing projectos/schemas/" + s + ".schema.json"); continue; }
    try { const j = lib.readJson(p); if (j.additionalProperties !== false) err(s + ".schema.json must set additionalProperties false"); }
    catch (e) { err(s + ".schema.json invalid JSON: " + e.message); }
  }
  for (const e of lib.registryErrors(lib.readJson(rel("sentinel/example/registry.example.json")))) err("registry.example.json: " + e);

  // ---- sentinel workflow template ----------------------------------------------
  const wf = read(rel("sentinel/workflow.template.yml"));
  const wfCode = wf.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  if (/^\s*schedule\s*:/m.test(wfCode)) err("sentinel workflow template must not be scheduled in P2");
  if (/strategy\s*:|matrix\s*:/.test(wfCode)) err("sentinel workflow must be a single job (no matrix)");
  const jobsSection = wfCode.split(/^jobs:\s*$/m)[1] || "";
  if ((jobsSection.match(/^ {2}[a-z0-9_-]+:\s*$/gm) || []).length !== 1) err("sentinel workflow must define exactly one job");
  for (const m of wfCode.matchAll(/uses:\s*([^\s#]+)/g)) {
    if (!/^actions\/[a-z-]+@[0-9a-f]{40}$/.test(m[1])) err("sentinel workflow action not first-party + SHA-pinned: " + m[1]);
  }
  if (!/permissions:\s*\n\s+contents: read\s*\n\s+issues: write/.test(wfCode)) err("sentinel workflow permissions must be exactly contents: read, issues: write");
  if (/pull_request_target/.test(wfCode)) err("sentinel workflow must not use pull_request_target");
  const runner = stripTs(read(rel("sentinel/run-sentinel.ts")));
  // The sentinel may only reach GitHub's API and the registered product URLs.
  const hosts = [...runner.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  for (const h of hosts) if (h !== "api.github.com") err("sentinel runner contacts a fixed host other than api.github.com: " + h);
  if (/PROJECTOS_[A-Z_]*|projectos[a-z-]*\.vercel\.app|supabase\.co/i.test(runner)) err("sentinel runner must not depend on ProjectOS or a product backend at runtime");
  if (/sentinel_probe_record|watchdog_sentinel/.test(runner)) err("public sentinel runner must never write product sentinel liveness");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("val-watchdog-core1a: " + e.length + " error(s)"); process.exit(1); }
  console.log("val-watchdog-core1a: PASS");
}
module.exports = { run };

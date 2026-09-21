"use strict";
// ProjectOS Watchdog — live PostgreSQL privilege and behaviour harness.
//
// Creates a THROWAWAY local cluster in the OS temp directory (never a product
// database), shapes it like Supabase (client roles + the default privileges
// that re-grant EXECUTE), applies schema v1 TWICE (replay safety), then:
//   1. runs the privilege gate: must return zero rows
//   2. proves the gate is not blind: a deliberately mis-granted function is
//      reported, then removed
//   3. runs assertions.sql (forgery refused, ownership, positive recovery,
//      metadata guard, jobs, release identity, sentinel liveness, retention)
// The cluster is stopped and deleted afterwards.
//
// Needs initdb / pg_ctl / psql on PATH (or WATCHDOG_PG_BIN). If they are not
// available the harness reports SKIPPED and exits 3; it never reports a pass
// it did not run.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const SQL_DIR = path.resolve(HERE, "..");
const MIGRATIONS = fs.readdirSync(path.join(SQL_DIR, "migrations")).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

function bin(name) {
  const dir = process.env.WATCHDOG_PG_BIN;
  const exe = process.platform === "win32" ? name + ".exe" : name;
  if (dir) return path.join(dir, exe);
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
  return probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function main() {
  const initdb = bin("initdb"), pgctl = bin("pg_ctl"), psqlBin = bin("psql");
  if (!initdb || !pgctl || !psqlBin) {
    console.log("pg-harness: SKIPPED (initdb/pg_ctl/psql not found; set WATCHDOG_PG_BIN)");
    process.exit(3);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-watchdog-pg-"));
  const data = path.join(dir, "data");
  const port = String(20000 + crypto.randomInt(20000));
  let started = false;
  let failures = 0;
  const psql = (args, input) => run(psqlBin, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", ...args], input ? { input } : {});
  const check = (label, ok, detail) => {
    console.log((ok ? "PASS " : "FAIL ") + label + (ok || !detail ? "" : "\n" + detail));
    if (!ok) failures++;
  };
  try {
    let r = run(initdb, ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"]);
    if (r.code !== 0) throw new Error("initdb failed:\n" + r.out);
    // stdio ignored: the server inherits pg_ctl's handles, and captured pipes
    // would never close (spawnSync would wait forever on Windows).
    const s = spawnSync(pgctl, ["-D", data, "-l", path.join(dir, "pg.log"), "-o", "-p " + port + " -c listen_addresses=127.0.0.1", "-w", "start"], { stdio: "ignore", timeout: 60000 });
    if (s.status !== 0) throw new Error("pg_ctl start failed (see " + path.join(dir, "pg.log") + ")");
    started = true;

    r = psql(["-f", path.join(HERE, "supabase-like-roles.sql")]);
    check("supabase-like roles and hazardous default privileges created", r.code === 0, r.out);

    for (const pass of [1, 2]) {
      for (const m of MIGRATIONS) {
        r = psql(["-f", path.join(SQL_DIR, "migrations", m)]);
        check("apply " + m + " (pass " + pass + ")", r.code === 0, r.out);
      }
    }

    const gate = path.join(SQL_DIR, "privilege-gate.sql");
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate returns zero rows after migration", r.code === 0 && r.out.trim() === "", r.out);

    r = psql(["-c", "create function public.watchdog_gate_probe() returns int language sql as 'select 1'"]);
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate detects a function re-granted by default privileges", /anon\|function\|watchdog_gate_probe\(\)\|EXECUTE/.test(r.out), r.out);
    psql(["-c", "drop function public.watchdog_gate_probe()"]);
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate clean again", r.code === 0 && r.out.trim() === "", r.out);

    psql(["-c", "alter role anon login"]);
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate detects a client role that can log in directly", /anon\|role\|anon\|LOGIN/.test(r.out), r.out);
    psql(["-c", "alter role anon nologin"]);
    psql(["-c", "create role drift_owner nologin; alter function public.watchdog_status() owner to drift_owner"]);
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate detects ownership drift", /drift_owner\|owner_drift\|watchdog_status\(\)\|OWNER/.test(r.out), r.out);
    psql(["-c", "alter function public.watchdog_status() owner to postgres; drop role drift_owner"]);
    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate clean after drift probes", r.code === 0 && r.out.trim() === "", r.out);

    r = psql(["-A", "-t", "-c",
      "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and p.proname like 'watchdog\\_%' and (not p.prosecdef or not exists " +
      "(select 1 from unnest(p.proconfig) c where c = 'search_path=\"\"'))"]);
    check("every public entry point is SECURITY DEFINER with search_path pinned", r.code === 0 && r.out.trim() === "0", r.out);

    r = psql(["-A", "-t", "-c", "select has_function_privilege('service_role', 'public.watchdog_status()', 'EXECUTE')"]);
    check("service_role can execute entry points", r.out.trim() === "t", r.out);

    r = psql(["-f", path.join(HERE, "assertions.sql")]);
    check("behavioural assertions", r.code === 0 && r.out.includes("ASSERTIONS PASSED"), r.out);

    r = psql(["-A", "-t", "-f", gate]);
    check("privilege gate still zero rows after assertions", r.code === 0 && r.out.trim() === "", r.out);
  } catch (e) {
    console.error("pg-harness: " + e.message);
    failures++;
  } finally {
    if (started) spawnSync(pgctl, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore", timeout: 60000 });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { console.error("pg-harness: could not remove " + dir); }
  }
  if (failures) { console.error("pg-harness: " + failures + " failure(s)"); process.exit(1); }
  console.log("pg-harness: ALL PASS");
}

main();

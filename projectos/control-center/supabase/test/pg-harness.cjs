"use strict";
// ProjectOS Control Center: tenant boundary harness, adapted from
// projectos/watchdog/sql/test/pg-harness.cjs. PROJECTOS-TENANT-RLS1A.
//
// Creates a THROWAWAY local cluster shaped like the live Supabase project, on a free port bound to
// 127.0.0.1 only, and never touches a real database. It proves the exact migration bytes from TWO starts:
//   (a) a fresh empty cluster;
//   (b) a LIVE-SHAPED one: old tables, old permissive policies, the old grants, the 12 seed rows.
// Each start applies the migrations twice as a non-superuser `postgres`, then runs the privilege gate
// and the behavioural assertions. Named mutations then show the proof can fail: each runs inside a
// rolled-back transaction and reports exactly which assertions and gate findings it tripped. Source
// mutations change the migration text itself and must be rolled back by the migration's own check.
//
// Exit codes: 0 all pass; 1 a failure; 3 Postgres is missing (never reported as a pass).
// The last stdout line is `HARNESS_RESULT <json>`, which the validator judges for itself.
//
// Live is PostgreSQL 17, so 17 binaries are preferred. Anything else is said out loud, never silent.
// The cluster uses scram-sha-256 with a random password, and every child gets a minimal environment, so
// no token this process inherited reaches the server.
//
// All scratch lives under one owned temp directory, removed in a finally with the server stopped first.
// A validator timeout is TerminateProcess, which skips every handler, so each run first sweeps what a
// killed run left behind: its own prefix only, and only where the recorded owner is gone.

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scratch = require("../../../validators/lib/scratch.cjs");

const HERE = __dirname;
const MIGRATIONS_DIR = path.resolve(HERE, "..", "migrations");
const MIGRATIONS = ["0001_baseline.sql", "0002_tenant_boundary.sql"];
const RETIRED = [path.resolve(HERE, "..", "schema.sql"), path.resolve(HERE, "..", "interactive.sql")];
const SEED_ROWS = 12;
const QUIET = "-c client_min_messages=warning";
const MINIMUM_ASSERTIONS = 100;
const LIVE_MAJOR = 17;
const SCRATCH_TAG = "tenant-rls-pg";
const STALE_DIR = /^projectos-tenant-rls-pg-[A-Za-z0-9]{6}$/;
const OWNER_MARKER = "harness-owner.json";
/** Far longer than the validator's timeout, so a live run is never mistaken for a dead one. */
const STALE_AFTER_MS = 60 * 60 * 1000;
/** The only names a child process receives from this one. */
const PASSED_ENV = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "TEMP", "TMP", "TMPDIR"];
const TOKEN_NAME = /TOKEN|SECRET|PASSWORD|API_?KEY|ANTHROPIC|OPENAI|GITHUB|SUPABASE|PGPASS/i;
/** Test seams for the validator: `fail-start` breaks the server start, `die-after-start` kills this process outright. */
const SEAM = process.env.TENANT_RLS_TEST_SEAM || "";

const replaceReadPolicy = (table, expr) =>
  `drop policy "${table} member read" on public.${table};\n` +
  `create policy "${table} member read" on public.${table} for select to authenticated using (${expr});`;

/** Named database mutations. Each runs in a transaction that is rolled back. The validator judges the outcome. */
const MUTATIONS = [
  // The five the exit proof names.
  { name: "using-true-projects", sql: replaceReadPolicy("projects", "true") },
  { name: "using-true-phases", sql: replaceReadPolicy("phases", "true") },
  { name: "using-true-tenants", sql: replaceReadPolicy("tenants", "true") },
  { name: "using-true-tenant-members", sql: `drop policy "tenant_members self read" on public.tenant_members;\ncreate policy "tenant_members self read" on public.tenant_members for select to authenticated using (true);` },
  { name: "uid-not-null-projects", sql: replaceReadPolicy("projects", "auth.uid() is not null") },
  { name: "uid-not-null-phases", sql: replaceReadPolicy("phases", "auth.uid() is not null") },
  { name: "true-or-helper", sql: replaceReadPolicy("projects", "true or tenant_id in (select private.my_tenant_ids())") },
  { name: "to-public-policy", sql: `drop policy "projects member read" on public.projects;\ncreate policy "projects member read" on public.projects for select to public using (tenant_id in (select private.my_tenant_ids()));` },
  { name: "private-usage-anon", sql: "grant usage on schema private to anon;" },
  { name: "public-function-added", sql: "create function public.tenant_leak() returns int language sql as 'select 1';" },
  // Every other rule the boundary rests on: removing it must fail its own check.
  { name: "write-update-using-true", sql: `alter policy "projects owner update" on public.projects using (true) with check (true);` },
  { name: "write-delete-using-true", sql: `alter policy "phases owner delete" on public.phases using (true);` },
  { name: "insert-check-true", sql: `alter policy "projects owner insert" on public.projects with check (true);` },
  // A cross-tenant update or delete is refused by the read policy and the write policy together, so
  // only opening both shows those two assertions can fail. Opening one is the member case above.
  { name: "xwrite-projects-open", sql: `${replaceReadPolicy("projects", "true")}\nalter policy "projects owner update" on public.projects using (true) with check (true);\nalter policy "projects owner delete" on public.projects using (true);` },
  { name: "xwrite-phases-open", sql: `${replaceReadPolicy("phases", "true")}\nalter policy "phases owner update" on public.phases using (true) with check (true);\nalter policy "phases owner delete" on public.phases using (true);\nalter policy "phases owner insert" on public.phases with check (true);` },
  { name: "owner-helper-widened", sql: `create or replace function private.my_owned_tenant_ids() returns setof text language sql stable set search_path = '' as $f$ select m.tenant_id from public.tenant_members m where m.user_id = (select auth.uid()) $f$;` },
  { name: "column-grant-tenant-id", sql: "grant update (tenant_id) on public.projects to authenticated;" },
  { name: "column-grant-id", sql: "grant update (id) on public.projects to authenticated;" },
  { name: "malformed-sub-falls-open", sql: `create or replace function auth.uid() returns uuid language plpgsql stable as $f$ begin return (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid; exception when others then return 'aaaaaaaa-0000-4000-8000-000000000001'; end $f$;` },
  { name: "table-update-grant", sql: "grant update on public.phases to authenticated;" },
  { name: "composite-fk-dropped", sql: "alter table public.phases drop constraint phases_tenant_project_fkey;" },
  { name: "truncate-granted", sql: "grant truncate on public.projects, public.phases, public.tenants, public.tenant_members to authenticated, anon;" },
  { name: "members-self-add", sql: `grant insert on public.tenant_members to authenticated;\ncreate policy "mutation self add" on public.tenant_members for insert to authenticated with check (true);` },
  { name: "members-self-promote", sql: `grant update (role) on public.tenant_members to authenticated;\ncreate policy "mutation self promote" on public.tenant_members for update to authenticated using (true) with check (true);` },
  { name: "tenants-client-write", sql: `grant update on public.tenants to authenticated;\ncreate policy "mutation tenant write" on public.tenants for update to authenticated using (true) with check (true);` },
  { name: "anon-select-grant", sql: "grant select on public.projects to anon;" },
  { name: "rls-disabled", sql: "alter table public.projects disable row level security;" },
  { name: "realtime-added", sql: "alter publication supabase_realtime add table public.tenant_members;" },
  { name: "helper-execute-public", sql: "grant execute on function private.my_tenant_ids() to public;" },
  { name: "helper-search-path-dropped", sql: "alter function private.my_tenant_ids() reset search_path;" },
  { name: "tenant-default-added", sql: "alter table public.projects alter column tenant_id set default 'owner-personal';" },
  { name: "global-project-id", sql: `delete from public.projects where tenant_id = 'agency-business' and id = 'fx-shared';\nalter table public.projects add constraint mutation_global_id unique (id);` },
  { name: "retired-policy-recreated", sql: `create policy "projects authenticated write" on public.projects for all to authenticated using (true) with check (true);` },
  { name: "ownership-drift", sql: "alter table public.tenants owner to service_role;" },
  { name: "client-role-login", sql: "alter role anon login;" },
];

/** Mutations of the migration text. The apply must fail on `expect` and leave the live-shaped start untouched. */
const SOURCE_MUTATIONS = [
  { name: "src-using-true", from: "for select to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));\n\ndrop policy if exists \"projects owner insert\"", to: "for select to authenticated\n  using (true);\n\ndrop policy if exists \"projects owner insert\"", expect: "policy is not bound to its helper: projects member read" },
  { name: "src-uid-not-null", from: "for select to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));\n\ndrop policy if exists \"phases owner insert\"", to: "for select to authenticated\n  using (auth.uid() is not null);\n\ndrop policy if exists \"phases owner insert\"", expect: "policy is not bound to its helper: phases member read" },
  { name: "src-true-or-helper", from: "for select to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));\n\ndrop policy if exists \"projects owner insert\"", to: "for select to authenticated\n  using (true or tenant_id in (select private.my_tenant_ids()));\n\ndrop policy if exists \"projects owner insert\"", expect: "policy is not bound to its helper: projects member read" },
  // With the role guard gone, only the final check's ownership test stands between a superuser and objects postgres cannot read.
  { name: "src-no-role-guard", user: "supabase_admin", from: "  if current_user <> 'postgres' then\n    raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;\n  end if;\n", to: "", expect: "not owned by postgres: table tenants" },
  { name: "src-to-public", from:"create policy \"phases owner delete\" on public.phases\n  for delete to authenticated", to: "create policy \"phases owner delete\" on public.phases\n  for delete to public", expect: "policy is not for authenticated alone: phases owner delete" },
  { name: "src-private-usage-anon", from: "grant usage on schema private to authenticated;", to: "grant usage on schema private to authenticated, anon;", expect: "anon can use schema private" },
  { name: "src-revoke-skips-anon", from: "  from public, anon, authenticated;\n\ngrant select on table public.tenants", to: "  from public, authenticated;\n\ngrant select on table public.tenants", expect: "anon holds TRUNCATE on projects" },
  { name: "src-truncate-granted", from: "grant select, insert, delete on table public.projects, public.phases to authenticated;", to: "grant select, insert, delete, truncate on table public.projects, public.phases to authenticated;", expect: "authenticated holds TRUNCATE on projects" },
  { name: "src-update-all-columns", from: "grant update (name, repo, install_status, production_freeze, open_phases)\n  on table public.projects to authenticated;", to: "grant update on table public.projects to authenticated;", expect: "authenticated holds UPDATE on projects" },
  { name: "src-column-default", from: "alter table public.projects\n  alter column tenant_id drop default,\n  alter column tenant_id set not null;", to: "alter table public.projects\n  alter column tenant_id set default 'owner-personal',\n  alter column tenant_id set not null;", expect: "tenant_id is nullable, missing or has a default on projects" },
];

/** Deviations the read-only preflight must refuse. Each runs in a transaction that is rolled back. */
const PREFLIGHT_SCENARIOS = [
  { name: "pf-stranger-row", sql: "insert into public.projects (id, name) values ('stranger-project', 'Stranger');", item: "every row is in the map" },
  { name: "pf-seed-row-missing", sql: "delete from public.projects where id = 'tkn';", item: "every id in the map is a row" },
  { name: "pf-seed-row-rewritten", sql: "update public.projects set repo = 'attacker/fork' where id = 'projectos';", item: "every row is byte-equal to the seed" },
  { name: "pf-orphan-phase", sql: "set local session_replication_role = replica;\ninsert into public.phases (project_id, phase_id) values ('no-such-project', 'P1');\nset local session_replication_role = origin;", item: "no orphan phases" },
  { name: "pf-phase-appeared", sql: "insert into public.phases (project_id, phase_id) values ('polygo', 'P1');", item: "phases is still empty, as audited" },
  { name: "pf-second-account", sql: "insert into auth.users (id) values ('99999999-0000-4000-8000-000000000009');", item: "auth.users is the owner only" },
  { name: "pf-owner-changed", sql: "alter table public.projects owner to service_role;", item: "postgres owns both tables" },
  { name: "pf-new-name-present", sql: "create table public.tenants (id text primary key);", item: "public.tenants is absent" },
  { name: "pf-unknown-policy", sql: `create policy "someone else's" on public.projects for select to authenticated using (false);`, item: "every policy is one 0002 will replace" },
  { name: "pf-view-depends", sql: "create view public.project_names as select id from public.projects;", item: "nothing else depends on these tables" },
  { name: "pf-function-mentions", sql: "create function public.count_rows() returns bigint language sql as 'select count(*) from public.projects';", item: "nothing else depends on these tables" },
  { name: "pf-client-can-create", sql: "grant create on schema public to anon;", item: "no client can create in schema public" },
];

/** Deviations the read-only post-apply check must refuse, on the migrated live-shaped start. */
const POSTAPPLY_SCENARIOS = [
  { name: "pa-true-or-helper", sql: `alter policy "projects member read" on public.projects using (true or tenant_id in (select private.my_tenant_ids()));`, item: "no public table has an open policy" },
  { name: "pa-to-public", sql: `drop policy "phases member read" on public.phases;\ncreate policy "phases member read" on public.phases for select to public using (tenant_id in (select private.my_tenant_ids()));`, item: "no public table has an open policy" },
  { name: "pa-anon-select", sql: "grant select on public.tenants to anon;", item: "the privilege gate reports nothing" },
  { name: "pa-new-table-no-rls", sql: "create table public.leak (id int);", item: "row level security is on for every public table" },
  { name: "pa-realtime-added", sql: "alter publication supabase_realtime add table public.phases;", item: "the four tables are out of every publication" },
  { name: "pa-client-can-create", sql: "grant create on schema public to anon;", item: "no client can create in schema public" },
];

const exeIn = (dir, name) => path.join(dir, process.platform === "win32" ? name + ".exe" : name);

/** Absolute directories that might hold Postgres. A relative PATH entry, the current directory included, never counts. */
function candidateDirs() {
  const dirs = [];
  const programFiles = process.env.ProgramFiles;
  if (programFiles && path.isAbsolute(programFiles)) dirs.push(path.join(programFiles, "PostgreSQL", String(LIVE_MAJOR), "bin"));
  for (const d of (process.env.PATH || "").split(path.delimiter)) if (path.isAbsolute(d)) dirs.push(d);
  // A governed run can have a narrower PATH than the owner's shell.
  if (process.env.USERPROFILE) dirs.push(path.join(process.env.USERPROFILE, "scoop", "apps", "postgresql", "current", "bin"));
  if (programFiles && path.isAbsolute(programFiles)) dirs.push(path.join(programFiles, "PostgreSQL", "18", "bin"));
  return [...new Set(dirs)];
}

function majorOf(dir) {
  const r = spawnSync(exeIn(dir, "psql"), ["--version"], { encoding: "utf8", timeout: 20000 });
  const m = /\(PostgreSQL\) (\d+)/.exec(r.stdout || "");
  return m ? Number(m[1]) : null;
}

/** Prefers the live major version. Any other choice carries a note, so a fallback can never be silent. */
function choosePg(found, explicit) {
  if (found.length === 0) return null;
  const chosen = found.find((f) => f.major === LIVE_MAJOR) || found[0];
  if (chosen.major === LIVE_MAJOR) return { ...chosen, note: null };
  const why = explicit ? "TENANT_RLS_PG_BIN chose it" : `PostgreSQL ${LIVE_MAJOR} binaries were not found`;
  return { ...chosen, note: `FALLBACK: running on PostgreSQL ${chosen.major} because ${why}. Live is ${LIVE_MAJOR}, so this is not the live major version.` };
}

function resolvePg() {
  const explicit = process.env.TENANT_RLS_PG_BIN;
  if (explicit && !path.isAbsolute(explicit)) return null;
  const found = (explicit ? [explicit] : candidateDirs())
    .filter((d) => ["initdb", "pg_ctl", "psql"].every((n) => fs.existsSync(exeIn(d, n))))
    .map((dir) => ({ dir, major: majorOf(dir) }))
    .filter((f) => f.major !== null);
  return choosePg(found, Boolean(explicit));
}

/** What every child gets: named variables only, so nothing this process inherited travels with them. */
function minimalEnv(binDir) {
  const env = {};
  for (const name of PASSED_ENV) if (process.env[name]) env[name] = process.env[name];
  const system = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32") : "/usr/bin:/bin";
  env.PATH = binDir + path.delimiter + system;
  return env;
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}

/** The OS picks the port, so a busy one is never guessed at. */
function freePort(env) {
  const script = 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})';
  const r = run(process.execPath, ["-e", script], { env });
  const port = Number(r.out.trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error("could not get a free port: " + r.all);
  return String(port);
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** The pid on the first line of postmaster.pid, or null. */
function serverPid(data) {
  try {
    return Number(fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split(/\r?\n/)[0]) || null;
  } catch (_e) {
    return null;
  }
}

/** Whether a directory is a dead run's: its prefix, its marker or cluster, and an owner that is gone. */
function isStale(dir) {
  if (!scratch.isSafeOwnedShape(dir) || !STALE_DIR.test(path.basename(dir))) return false;
  const old = Date.now() - fs.statSync(dir).mtimeMs > STALE_AFTER_MS;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(dir, OWNER_MARKER), "utf8"));
    return old || !isAlive(owner.pid);
  } catch (_e) {
    return old && fs.existsSync(path.join(dir, "data", "PG_VERSION"));
  }
}

/** Stops the server a killed run left behind and removes its directory. Never touches a live run's. */
function sweepStale(pgctl, env) {
  const root = fs.realpathSync(os.tmpdir());
  const swept = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!STALE_DIR.test(name) || !isStale(dir)) continue;
    const data = path.join(dir, "data");
    const pid = serverPid(data);
    if (pid !== null) spawnSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 60000, env });
    if (pid !== null && isAlive(pid)) {
      console.error(`pg-harness: stale server ${pid} in ${dir} would not stop; leaving the directory`);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    swept.push(dir);
  }
  return swept;
}

function main() {
  const startedAt = Date.now();
  const result = { ok: false, pgVersion: null, pgMajor: null, pgBinDir: null, pgNote: null, swept: [], starts: [], mutations: [], sourceMutations: [], preflight: [], postapply: [], checks: [], ms: 0 };
  const pg = resolvePg();
  if (!pg) {
    console.error("pg-harness: POSTGRES_MISSING: initdb, pg_ctl or psql not found; install PostgreSQL or set TENANT_RLS_PG_BIN");
    result.error = "POSTGRES_MISSING";
    console.log("HARNESS_RESULT " + JSON.stringify(result));
    process.exitCode = 3;
    return;
  }
  const initdb = exeIn(pg.dir, "initdb"), pgctl = exeIn(pg.dir, "pg_ctl"), psqlBin = exeIn(pg.dir, "psql");
  Object.assign(result, { pgMajor: pg.major, pgBinDir: pg.dir, pgNote: pg.note });
  console.log(`pg-harness: using PostgreSQL ${pg.major} from ${pg.dir}`);
  if (pg.note) console.log("pg-harness: " + pg.note);

  // A canary: if the server's environment holds this, the minimal environment has failed.
  process.env.TENANT_RLS_ENV_CANARY = "inherited";
  const env = minimalEnv(pg.dir);
  const password = crypto.randomBytes(24).toString("hex");

  result.swept = sweepStale(pgctl, env);
  if (result.swept.length > 0) console.log(`pg-harness: swept ${result.swept.length} directory(ies) left by a killed run`);

  // Defined before anything can start. Stopping nothing is harmless, so it is always attempted.
  let data = null;
  let stopped = false;
  const stopServer = () => {
    if (stopped || data === null) return;
    stopped = true;
    spawnSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 60000, env });
  };
  // Registered before scratch installs its own hooks, so the server stops before the directory goes.
  process.on("exit", stopServer);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, stopServer);

  const dir = scratch.owned(SCRATCH_TAG);
  fs.writeFileSync(path.join(dir, OWNER_MARKER), JSON.stringify({ pid: process.pid }));
  data = path.join(dir, "data");
  result.scratchDir = dir;
  let failures = 0;

  const check = (label, ok, detail) => {
    console.log((ok ? "PASS " : "FAIL ") + label + (ok || !detail ? "" : "\n" + detail));
    result.checks.push({ label, ok: !!ok });
    if (!ok) failures++;
  };

  try {
    const pwfile = path.join(dir, "pwfile");
    fs.writeFileSync(pwfile, password + "\n");
    let r = run(initdb, ["-D", data, "-U", "supabase_admin", "--auth=scram-sha-256", "--pwfile=" + pwfile, "-E", "UTF8", "--no-locale"], { env });
    fs.rmSync(pwfile, { force: true });
    if (r.code !== 0) throw new Error("initdb failed:\n" + r.all);

    const port = freePort(env);
    // stdio ignored: the server inherits pg_ctl's handles, and captured pipes never close on Windows.
    let opts = `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`;
    if (SEAM === "fail-start") opts += " -c no_such_setting_for_the_failed_start_test=on";
    const s = spawnSync(pgctl, ["-D", data, "-l", path.join(dir, "pg.log"), "-o", opts, "-w", "start"], { stdio: "ignore", timeout: 60000, env });
    if (s.status !== 0) {
      const log = fs.existsSync(path.join(dir, "pg.log")) ? fs.readFileSync(path.join(dir, "pg.log"), "utf8") : "";
      throw new Error("pg_ctl start failed:\n" + log.slice(-2000));
    }
    if (SEAM === "die-after-start") {
      // Synchronous, then TerminateProcess: exactly what a validator timeout does, with no handler run.
      fs.writeSync(1, `HARNESS_KILLED ${JSON.stringify({ dir, pid: serverPid(data) })}\n`);
      process.kill(process.pid, "SIGKILL");
    }

    const base = (db, user) => ["-X", "-q", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", db];
    const quietEnv = { env: { ...env, PGPASSWORD: password, PGOPTIONS: QUIET } };
    const sql = (db, user, input, opts2 = {}) => run(psqlBin, base(db, user), { input, ...quietEnv, ...opts2 });
    const sqlFile = (db, user, file, opts2 = {}) => run(psqlBin, [...base(db, user), "-f", file], { ...quietEnv, ...opts2 });
    const admin = (db, input) => sql(db, "supabase_admin", input);
    const read = (name) => fs.readFileSync(path.join(HERE, name), "utf8");

    const ASSERTIONS = read("assertions.sql");
    const GATE = read("privilege-gate.sql");
    const GATE_FILE = path.join(HERE, "privilege-gate.sql");
    const PREFLIGHT_FILE = path.join(HERE, "live-preflight.sql");
    const PREFLIGHT = read("live-preflight.sql");
    const POSTAPPLY_FILE = path.join(HERE, "live-postapply.sql");
    const POSTAPPLY = read("live-postapply.sql");
    const FINGERPRINT_FILE = path.join(HERE, "catalog-fingerprint.sql");
    const MEMBERSHIP_FILE = path.join(HERE, "live-owner-membership.sql");

    result.pgVersion = admin("postgres", "select current_setting('server_version');").out.trim();
    console.log(`pg-harness: server is PostgreSQL ${result.pgVersion}`);
    check(`server ${result.pgVersion} listening on 127.0.0.1 only`,
      admin("postgres", "select current_setting('listen_addresses');").out.trim() === "127.0.0.1");

    // ---- the server itself: no trust, and nothing inherited ------------------------------------------
    r = admin("postgres", "select count(*), count(*) filter (where auth_method = 'scram-sha-256') from pg_hba_file_rules;");
    const [hbaRules, hbaScram] = r.out.trim().split("|");
    check("every pg_hba rule is scram-sha-256", r.code === 0 && Number(hbaRules) > 0 && hbaRules === hbaScram, r.all);
    r = run(psqlBin, base("postgres", "supabase_admin"), { input: "select 1;", env });
    check("a connection with no password is refused", r.code !== 0 && /password/i.test(r.err), r.all);
    r = admin("postgres", "create temp table server_env (line text);\ncopy server_env from program 'set' with (format csv, delimiter E'\\x01', quote E'\\x02');\nselect line from server_env;");
    const serverNames = r.out.split(/\r?\n/).map((l) => l.split("=")[0].trim()).filter(Boolean);
    const leaked = serverNames.filter((n) => n === "TENANT_RLS_ENV_CANARY" || TOKEN_NAME.test(n));
    check("the server's environment holds no inherited token", r.code === 0 && serverNames.some((n) => /^path$/i.test(n)) && leaked.length === 0, r.all + " leaked=" + leaked.join(","));

    /** A clone of the shaped database. Database grants are not cloned, so they are made here. */
    const cloneDb = (name, template) => {
      const c = admin("postgres", `create database ${name} template ${template} owner supabase_admin;\ngrant all on database ${name} to postgres;`);
      if (c.code !== 0) throw new Error(`could not create ${name}: ${c.all}`);
    };

    r = admin("postgres", "create database shaped;");
    if (r.code !== 0) throw new Error(r.all);
    r = sqlFile("shaped", "supabase_admin", path.join(HERE, "supabase-shape.sql"));
    check("Supabase-shaped roles, auth stub and default privileges created", r.code === 0, r.all);
    if (r.code !== 0) throw new Error("the shape did not apply");
    r = admin("shaped", ["postgres", "authenticator", "supabase_read_only_user"].map((u) => `alter role ${u} password '${password}';`).join("\n"));
    if (r.code !== 0) throw new Error("could not set role passwords");

    cloneDb("start_fresh", "shaped");
    cloneDb("start_live", "shaped");
    r = sqlFile("start_live", "supabase_admin", path.join(HERE, "live-shape.sql"));
    check("live-shaped start created", r.code === 0, r.all);
    if (r.code !== 0) throw new Error("the live shape did not apply");
    r = admin("start_live", `select
      has_table_privilege('anon', 'public.projects', 'TRUNCATE'),
      has_table_privilege('authenticated', 'public.phases', 'TRUNCATE'),
      has_table_privilege('service_role', 'public.projects', 'TRUNCATE'),
      (select count(*) from public.projects),
      (select count(*) from pg_policy),
      (select rolsuper from pg_roles where rolname = 'postgres'),
      (select pg_get_userbyid(relowner) from pg_class where oid = 'public.projects'::regclass);`);
    check("live-shaped start really holds the hazard (anon TRUNCATE, 12 rows, 3 permissive policies, non-superuser owner)",
      r.out.trim() === `t|t|t|${SEED_ROWS}|3|f|postgres`, r.all);
    cloneDb("live_pristine", "start_live");

    // ---- the preflight, on the live-shaped start ---------------------------------------------------
    const preflightEnv = { env: { ...env, PGPASSWORD: password, PGOPTIONS: QUIET + " -c default_transaction_read_only=on" } };
    const parsePreflight = (text) => text.split(/\r?\n/).filter(Boolean).map((l) => {
      const [section, item, ok] = l.split("|");
      return { section, item, ok };
    });
    r = sqlFile("start_live", "supabase_read_only_user", PREFLIGHT_FILE, preflightEnv);
    const preflightRows = parsePreflight(r.out);
    const verdict = preflightRows.find((x) => x.section === "PREFLIGHT");
    check("read-only preflight passes on the live-shaped start, as supabase_read_only_user in a read-only transaction",
      r.code === 0 && verdict !== undefined && verdict.ok === "t", r.all);
    result.preflight.push({ name: "pf-live-shaped-start", passed: verdict !== undefined && verdict.ok === "t", failed: preflightRows.filter((x) => x.ok === "f").map((x) => x.item) });

    r = sql("start_live", "supabase_read_only_user", "create table public.preflight_probe (id int);", preflightEnv);
    check("that session really is read-only: a write is refused", r.code !== 0 && /read-only transaction|permission denied/.test(r.all), r.all);

    for (const sc of PREFLIGHT_SCENARIOS) {
      const script = `begin;\n${sc.sql}\nset local role supabase_read_only_user;\n${PREFLIGHT}\nrollback;`;
      r = admin("live_pristine", script);
      const rows = parsePreflight(r.out);
      const failed = rows.filter((x) => x.ok === "f").map((x) => x.item);
      const top = rows.find((x) => x.section === "PREFLIGHT");
      result.preflight.push({ name: sc.name, passed: top !== undefined && top.ok === "t", failed, ran: r.code === 0 });
      check(`preflight refuses ${sc.name}`, r.code === 0 && top !== undefined && top.ok === "f" && failed.includes(sc.item), r.all);
    }

    // ---- both starts: apply twice, gate, assertions ---------------------------------------------------
    /** Throws rather than return nothing: two failed reads would compare as equal. */
    const fingerprint = (db) => {
      const f = sqlFile(db, "supabase_admin", FINGERPRINT_FILE);
      if (f.code !== 0 || f.out.trim() === "") throw new Error("the catalogue fingerprint failed: " + f.all);
      return f.out;
    };
    const gateRows = (db) => {
      const g = sqlFile(db, "supabase_admin", GATE_FILE);
      return { code: g.code, rows: g.out.split(/\r?\n/).filter(Boolean), all: g.all };
    };
    const applyMigrations = (db, label) => {
      for (const m of MIGRATIONS) {
        const a = sqlFile(db, "postgres", path.join(MIGRATIONS_DIR, m));
        check(`${label}: apply ${m} as non-superuser postgres`, a.code === 0, a.all);
      }
    };

    /** One transaction, rolled back: mutation, assertions, gate. Reports everything it tripped. */
    const evaluate = (db, mutationSql, expectedSeed) => {
      const script = ["begin;", mutationSql, `\\set expected_seed ${expectedSeed}`, ASSERTIONS, "select '@@GATE';", GATE, "rollback;"].join("\n");
      const e = admin(db, script);
      const lines = e.out.split(/\r?\n/).filter(Boolean);
      const gateAt = lines.indexOf("@@GATE");
      const total = lines.find((l) => l.startsWith("TOTAL|"));
      return {
        complete: e.code === 0 && lines.includes("COMPLETE") && gateAt >= 0,
        total: total ? Number(total.split("|")[1]) : 0,
        failed: lines.filter((l) => l.startsWith("FAILED|")).map((l) => l.split("|")[1]),
        gate: gateAt >= 0 ? lines.slice(gateAt + 1) : [],
        error: e.code === 0 ? null : e.err.slice(0, 600),
      };
    };

    const starts = [
      { label: "fresh start", db: "start_fresh", expectedSeed: 0 },
      { label: "live-shaped start", db: "start_live", expectedSeed: SEED_ROWS },
    ];
    const keyOids = (db) => admin(db, "select string_agg(oid::text, ',' order by oid) from pg_constraint where conrelid in ('public.projects'::regclass, 'public.phases'::regclass) and contype in ('p', 'u', 'f');").out;
    const postapplyVerdict = (text, code) => {
      const rows = parsePreflight(text);
      const top = rows.find((x) => x.section === "POSTAPPLY");
      return { ran: code === 0 && top !== undefined, passed: top !== undefined && top.ok === "t", failed: rows.filter((x) => x.ok === "f").map((x) => x.item) };
    };
    let cleanTotal = 0;
    for (const st of starts) {
      applyMigrations(st.db, st.label + ", pass 1");
      const first = fingerprint(st.db);
      const firstKeys = keyOids(st.db);
      check(`${st.label}: the catalogue fingerprint is not empty`, /policy projects projects member read/.test(first) && /acl projects authenticated SELECT/.test(first), first.slice(0, 400));
      applyMigrations(st.db, st.label + ", pass 2");
      const second = fingerprint(st.db);
      check(`${st.label}: the second apply changed nothing in the catalogue`, first === second, "fingerprints differ");
      check(`${st.label}: the second apply did not re-create a single key`, firstKeys.trim() !== "" && keyOids(st.db) === firstKeys, firstKeys);

      r = sql(st.db, "postgres", "select current_user, (select rolsuper from pg_roles where rolname = current_user);");
      check(`${st.label}: the migration role really is a non-superuser`, r.out.trim() === "postgres|f", r.all);

      let g = gateRows(st.db);
      check(`${st.label}: privilege gate reports nothing, judged on effective privileges`, g.code === 0 && g.rows.length === 0, g.all);

      r = sqlFile(st.db, "supabase_admin", path.join(HERE, "fixtures.sql"));
      check(`${st.label}: both tenants seeded`, r.code === 0, r.all);

      // A re-run over real rows in both tenants must leave them, and the catalogue, alone.
      const rowsQuery = "select md5(string_agg(t::text, '|' order by t::text)) from public.projects t;";
      const before = admin(st.db, rowsQuery).out;
      applyMigrations(st.db, st.label + ", over seeded rows");
      check(`${st.label}: a re-apply over seeded rows changes neither rows nor catalogue`, admin(st.db, rowsQuery).out === before && fingerprint(st.db) === first, "rows or catalogue moved");

      for (const f of RETIRED) {
        r = sqlFile(st.db, "postgres", f);
        check(`${st.label}: re-running retired ${path.basename(f)} succeeds`, r.code === 0, r.all);
      }
      check(`${st.label}: re-running the retired SQL recreated no policy and changed nothing`, fingerprint(st.db) === first, "the retired SQL moved the catalogue");

      for (const pass of [1, 2]) {
        r = sqlFile(st.db, "postgres", MEMBERSHIP_FILE);
        check(`${st.label}: live-owner-membership.sql pass ${pass}`, r.code === 0, r.all);
      }
      r = admin(st.db, "select count(*) from public.tenant_members where user_id = 'cd2e8678-1e00-4264-95bb-7d75738a1f50' and role = 'owner';");
      check(`${st.label}: the owner account owns both tenants`, r.out.trim() === "2", r.all);

      const clean = evaluate(st.db, "", st.expectedSeed);
      check(`${st.label}: behavioural assertions (${clean.total})`,
        clean.complete && clean.failed.length === 0 && clean.gate.length === 0 && clean.total >= MINIMUM_ASSERTIONS,
        JSON.stringify(clean));
      result.starts.push({ label: st.label, ...clean });
      cleanTotal = clean.total;

      // The way PostgREST really connects: log in as authenticator, which holds nothing, then SET ROLE.
      const viaApi = (setup) => sql(st.db, "authenticator", setup);
      r = viaApi(`set role authenticated;
        set request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}';
        select count(*) from public.projects where tenant_id = 'agency-business';
        select count(*) from public.projects where tenant_id = 'owner-personal';
        reset role;
        select current_user, has_table_privilege('public.projects', 'SELECT');`);
      check(`${st.label}: through authenticator, a member sees their tenant and not the other`,
        r.code === 0 && r.out.trim().split(/\r?\n/).join(",") === "2,0,authenticator|f", r.all);
      r = viaApi("set role anon;\nselect count(*) from public.projects;");
      check(`${st.label}: through authenticator, anon is refused by the grant`, r.code !== 0 && /permission denied/.test(r.err), r.all);

      // The read-only post-apply check, as the live read-only role would run it.
      r = sqlFile(st.db, "supabase_read_only_user", POSTAPPLY_FILE, preflightEnv);
      const applied = postapplyVerdict(r.out, r.code);
      result.postapply.push({ name: `pa-clean-${st.db}`, ...applied });
      check(`${st.label}: the read-only post-apply check passes`, applied.ran && applied.passed && applied.failed.length === 0, r.all);

      g = gateRows(st.db);
      check(`${st.label}: privilege gate still reports nothing after the assertions`, g.code === 0 && g.rows.length === 0, g.all);
    }

    r = sqlFile("start_live", "supabase_read_only_user", PREFLIGHT_FILE, preflightEnv);
    const after = parsePreflight(r.out);
    check("the preflight refuses a database that has already been migrated",
      r.code === 0 && after.some((x) => x.section === "PREFLIGHT" && x.ok === "f") && after.some((x) => x.item === "public.tenants is absent" && x.ok === "f"), r.all);

    // ---- the post-apply check must be able to fail -----------------------------------------------------
    for (const sc of POSTAPPLY_SCENARIOS) {
      r = admin("start_live", `begin;\n${sc.sql}\nset local role supabase_read_only_user;\n${POSTAPPLY}\nrollback;`);
      const outcome = postapplyVerdict(r.out, r.code);
      result.postapply.push({ name: sc.name, ...outcome });
      check(`post-apply check refuses ${sc.name}`, outcome.ran && !outcome.passed && outcome.failed.includes(sc.item), r.all);
    }
    r = sqlFile("live_pristine", "supabase_read_only_user", POSTAPPLY_FILE, preflightEnv);
    const unapplied = postapplyVerdict(r.out, r.code);
    result.postapply.push({ name: "pa-before-apply", ...unapplied });
    check("the post-apply check refuses a database that has not been migrated", unapplied.ran && !unapplied.passed, r.all);
    r = sql("start_live", "supabase_read_only_user", POSTAPPLY, preflightEnv);
    check("the post-apply check needs no write: it passes again in a read-only session", postapplyVerdict(r.out, r.code).passed, r.all);

    // ---- named database mutations -------------------------------------------------------------------
    for (const m of MUTATIONS) {
      const outcome = evaluate("start_live", m.sql, SEED_ROWS);
      result.mutations.push({ name: m.name, ...outcome });
      const caught = outcome.failed.length > 0 || outcome.gate.length > 0;
      check(`mutation ${m.name} fails the harness (${outcome.failed.length} assertion(s), ${outcome.gate.length} gate finding(s))`,
        outcome.complete && outcome.total === cleanTotal && caught, JSON.stringify(outcome));
    }
    const afterMutations = gateRows("start_live");
    check("every mutation rolled back: the gate is clean again", afterMutations.code === 0 && afterMutations.rows.length === 0, afterMutations.all);
    const cleanAgain = evaluate("start_live", "", SEED_ROWS);
    check("every mutation rolled back: the assertions pass again", cleanAgain.complete && cleanAgain.failed.length === 0, JSON.stringify(cleanAgain));

    // ---- mutations of the migration text: the apply itself refuses, and rolls back ----------------------
    const boundaryText = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATIONS[1]), "utf8").replace(/\r\n/g, "\n");
    const rolledBack = (db) => admin(db, `select to_regclass('public.tenants') is null, to_regnamespace('private') is null,
      (select count(*) from pg_policy), (select count(*) from public.projects),
      not exists (select 1 from pg_attribute where attrelid = 'public.projects'::regclass and attname = 'tenant_id');`).out.trim();
    const untouched = `t|t|3|${SEED_ROWS}|t`;
    const scenario = (name, prepare, text, user = "postgres") => {
      const db = "m_" + name.replace(/[^a-z0-9]/g, "_");
      cloneDb(db, "live_pristine");
      if (prepare) {
        const p = admin(db, prepare);
        if (p.code !== 0) throw new Error(`could not prepare ${name}: ${p.all}`);
      }
      const file = path.join(dir, db + ".sql");
      fs.writeFileSync(file, text);
      const a = sqlFile(db, user, file);
      return { db, code: a.code, err: a.err };
    };
    const dropDb = (db) => admin("postgres", `drop database ${db};`);

    for (const m of SOURCE_MUTATIONS) {
      if (!boundaryText.includes(m.from)) {
        check(`source mutation ${m.name} still applies to the migration text`, false, "update the mutation with the migration");
        continue;
      }
      const sc = scenario(m.name, null, boundaryText.replace(m.from, m.to), m.user);
      const state = rolledBack(sc.db);
      const raised = sc.err.includes("TENANT_BOUNDARY_CHECK_FAILED") && sc.err.includes(m.expect);
      result.sourceMutations.push({ name: m.name, refused: sc.code !== 0, raised, rolledBack: state === untouched });
      check(`source mutation ${m.name} is refused by the migration's own check and rolled back`, sc.code !== 0 && raised && state === untouched, sc.err + " state=" + state);
      dropDb(sc.db);
    }

    let sc = scenario("unmapped-row", "insert into public.projects (id, name) values ('stranger-project', 'Stranger');", boundaryText);
    let state = rolledBack(sc.db);
    const unmapped = sc.code !== 0 && sc.err.includes("TENANT_BACKFILL_UNMAPPED") && sc.err.includes("stranger-project");
    result.sourceMutations.push({ name: "unmapped-row", refused: sc.code !== 0, raised: unmapped, rolledBack: state === `t|t|3|${SEED_ROWS + 1}|t` });
    check("an unmapped row raises and rolls everything back", unmapped && state === `t|t|3|${SEED_ROWS + 1}|t`, sc.err + " state=" + state);
    dropDb(sc.db);

    // A known id with changed content is not the seed row, so it is not mapped.
    sc = scenario("rewritten-row", "update public.projects set repo = 'attacker/fork' where id = 'projectos';", boundaryText);
    state = rolledBack(sc.db);
    const rewritten = sc.code !== 0 && sc.err.includes("TENANT_BACKFILL_UNMAPPED") && sc.err.includes("projectos");
    result.sourceMutations.push({ name: "rewritten-row", refused: sc.code !== 0, raised: rewritten, rolledBack: state === untouched });
    check("a known id with rewritten content raises and rolls everything back", rewritten && state === untouched, sc.err + " state=" + state);
    dropDb(sc.db);

    // Unchanged bytes, wrong role: the guard refuses a superuser before anything is created.
    sc = scenario("apply-as-superuser", null, boundaryText, "supabase_admin");
    state = rolledBack(sc.db);
    const wrongRole = sc.code !== 0 && sc.err.includes("TENANT_BOUNDARY_WRONG_ROLE") && sc.err.includes("supabase_admin");
    result.sourceMutations.push({ name: "apply-as-superuser", refused: sc.code !== 0, raised: wrongRole, rolledBack: state === untouched });
    check("applying as supabase_admin raises and rolls everything back", wrongRole && state === untouched, sc.err + " state=" + state);
    dropDb(sc.db);

    // A later object depends on a key, and a re-run must neither fail nor touch that key.
    cloneDb("m_dependent_key", "start_live");
    r = sql("m_dependent_key", "postgres", "create table public.key_dependent (tenant_id text not null, project_id text not null, foreign key (tenant_id, project_id) references public.projects (tenant_id, id));");
    const keysBefore = keyOids("m_dependent_key");
    const reapplied = r.code === 0 ? sqlFile("m_dependent_key", "postgres", path.join(MIGRATIONS_DIR, MIGRATIONS[1])) : r;
    const keysKept = keyOids("m_dependent_key") === keysBefore;
    result.sourceMutations.push({ name: "rerun-with-dependent-key", refused: reapplied.code !== 0, raised: false, rolledBack: false, keysKept });
    check("a re-run succeeds and keeps its keys after a later object depends on one", reapplied.code === 0 && keysKept, reapplied.all);
    dropDb("m_dependent_key");

    sc = scenario("realtime-member", "alter publication supabase_realtime add table public.phases, public.projects;", boundaryText);
    r = admin(sc.db, "select count(*) from pg_publication_tables where schemaname = 'public';");
    check("a table already in supabase_realtime is taken out", sc.code === 0 && r.out.trim() === "0", sc.err + r.all);
    result.sourceMutations.push({ name: "realtime-member", refused: false, raised: false, rolledBack: false, tablesLeft: Number(r.out.trim()) });
    dropDb(sc.db);
  } catch (e) {
    console.error("pg-harness: " + e.message);
    failures++;
    result.error = e.message.slice(0, 800);
  } finally {
    stopServer();
    const pidLeft = serverPid(data);
    if (pidLeft !== null && isAlive(pidLeft)) {
      console.error(`pg-harness: server ${pidLeft} is still running in ${data}`);
      result.serverLeft = pidLeft;
      failures++;
    }
    const failure = scratch.cleanup(dir);
    if (failure) {
      console.error("pg-harness: could not remove " + failure.path + " (" + failure.category + ")");
      result.scratchLeft = failure.path;
      failures++;
    }
  }
  result.ok = failures === 0;
  result.failures = failures;
  result.ms = Date.now() - startedAt;
  console.log(failures ? `pg-harness: ${failures} failure(s)` : "pg-harness: ALL PASS");
  console.log(`pg-harness: ${result.checks.length} checks, ${result.mutations.length} database mutations, ${result.sourceMutations.length} source scenarios, ${result.preflight.length} preflight and ${result.postapply.length} post-apply scenarios, ${result.ms} ms, PostgreSQL ${result.pgVersion}`);
  if (result.pgNote) console.log("pg-harness: " + result.pgNote);
  console.log("HARNESS_RESULT " + JSON.stringify(result));
  // exitCode, not exit(): a pipe's writes are asynchronous on Windows, and the result line must arrive.
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) main();

module.exports = { MUTATIONS, SOURCE_MUTATIONS, PREFLIGHT_SCENARIOS, POSTAPPLY_SCENARIOS, choosePg, LIVE_MAJOR };

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
// All scratch lives under one owned temp directory, removed in a finally with the server stopped first.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const scratch = require("../../../validators/lib/scratch.cjs");

const HERE = __dirname;
const MIGRATIONS_DIR = path.resolve(HERE, "..", "migrations");
const MIGRATIONS = ["0001_baseline.sql", "0002_tenant_boundary.sql"];
const RETIRED = [path.resolve(HERE, "..", "schema.sql"), path.resolve(HERE, "..", "interactive.sql")];
const SEED_ROWS = 12;
const QUIET = "-c client_min_messages=warning";
const MINIMUM_ASSERTIONS = 100;

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
  { name: "src-to-public", from: "create policy \"phases owner delete\" on public.phases\n  for delete to authenticated", to: "create policy \"phases owner delete\" on public.phases\n  for delete to public", expect: "policy is not for authenticated alone: phases owner delete" },
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
];

function pgBin(name) {
  const exe = process.platform === "win32" ? name + ".exe" : name;
  const dir = process.env.TENANT_RLS_PG_BIN;
  if (dir) {
    const candidate = path.join(dir, exe);
    return fs.existsSync(candidate) ? candidate : null;
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  // A governed run can have a narrower PATH than the owner's shell.
  const scoop = path.join(process.env.USERPROFILE || "", "scoop", "apps", "postgresql", "current", "bin", exe);
  return fs.existsSync(scoop) ? scoop : null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 120000, ...opts });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}

/** The OS picks the port, so a busy one is never guessed at. */
function freePort() {
  const script = 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})';
  const r = run(process.execPath, ["-e", script]);
  const port = Number(r.out.trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error("could not get a free port: " + r.all);
  return String(port);
}

function main() {
  const startedAt = Date.now();
  const result = { ok: false, pgVersion: null, starts: [], mutations: [], sourceMutations: [], preflight: [], checks: [], ms: 0 };
  const initdb = pgBin("initdb"), pgctl = pgBin("pg_ctl"), psqlBin = pgBin("psql");
  if (!initdb || !pgctl || !psqlBin) {
    console.error("pg-harness: POSTGRES_MISSING: initdb, pg_ctl or psql not found; install PostgreSQL or set TENANT_RLS_PG_BIN");
    result.error = "POSTGRES_MISSING";
    console.log("HARNESS_RESULT " + JSON.stringify(result));
    process.exitCode = 3;
    return;
  }

  let stopServer = () => {};
  // Registered before scratch installs its own hooks, so the server stops before the directory goes.
  process.on("exit", () => stopServer());
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopServer());

  const dir = scratch.owned("tenant-rls-pg");
  const data = path.join(dir, "data");
  let failures = 0;

  const check = (label, ok, detail) => {
    console.log((ok ? "PASS " : "FAIL ") + label + (ok || !detail ? "" : "\n" + detail));
    result.checks.push({ label, ok: !!ok });
    if (!ok) failures++;
  };

  try {
    let r = run(initdb, ["-D", data, "-U", "supabase_admin", "-A", "trust", "-E", "UTF8", "--no-locale"]);
    if (r.code !== 0) throw new Error("initdb failed:\n" + r.all);

    const port = freePort();
    // stdio ignored: the server inherits pg_ctl's handles, and captured pipes never close on Windows.
    const opts = `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`;
    const s = spawnSync(pgctl, ["-D", data, "-l", path.join(dir, "pg.log"), "-o", opts, "-w", "start"], { stdio: "ignore", timeout: 60000 });
    if (s.status !== 0) {
      const log = fs.existsSync(path.join(dir, "pg.log")) ? fs.readFileSync(path.join(dir, "pg.log"), "utf8") : "";
      throw new Error("pg_ctl start failed:\n" + log.slice(-2000));
    }
    let stopped = false;
    stopServer = () => {
      if (stopped) return;
      stopped = true;
      const st = spawnSync(pgctl, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore", timeout: 60000 });
      if (st.status !== 0) spawnSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 60000 });
    };

    const base = (db, user) => ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", db];
    const quietEnv = { env: { ...process.env, PGOPTIONS: QUIET } };
    const sql = (db, user, input, opts2 = {}) => run(psqlBin, base(db, user), { input, ...quietEnv, ...opts2 });
    const sqlFile = (db, user, file, opts2 = {}) => run(psqlBin, [...base(db, user), "-f", file], { ...quietEnv, ...opts2 });
    const admin = (db, input) => sql(db, "supabase_admin", input);
    const read = (name) => fs.readFileSync(path.join(HERE, name), "utf8");

    const ASSERTIONS = read("assertions.sql");
    const GATE = read("privilege-gate.sql");
    const GATE_FILE = path.join(HERE, "privilege-gate.sql");
    const PREFLIGHT_FILE = path.join(HERE, "live-preflight.sql");
    const PREFLIGHT = read("live-preflight.sql");
    const FINGERPRINT_FILE = path.join(HERE, "catalog-fingerprint.sql");
    const MEMBERSHIP_FILE = path.join(HERE, "live-owner-membership.sql");

    result.pgVersion = admin("postgres", "select current_setting('server_version');").out.trim();
    check(`server ${result.pgVersion} listening on 127.0.0.1 only`,
      admin("postgres", "select current_setting('listen_addresses');").out.trim() === "127.0.0.1");

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
    const preflightEnv = { env: { ...process.env, PGOPTIONS: QUIET + " -c default_transaction_read_only=on" } };
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
    let cleanTotal = 0;
    for (const st of starts) {
      applyMigrations(st.db, st.label + ", pass 1");
      const first = fingerprint(st.db);
      check(`${st.label}: the catalogue fingerprint is not empty`, /policy projects projects member read/.test(first) && /acl projects authenticated SELECT/.test(first), first.slice(0, 400));
      applyMigrations(st.db, st.label + ", pass 2");
      const second = fingerprint(st.db);
      check(`${st.label}: the second apply changed nothing in the catalogue`, first === second, "fingerprints differ");

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

      g = gateRows(st.db);
      check(`${st.label}: privilege gate still reports nothing after the assertions`, g.code === 0 && g.rows.length === 0, g.all);
    }

    r = sqlFile("start_live", "supabase_read_only_user", PREFLIGHT_FILE, preflightEnv);
    const after = parsePreflight(r.out);
    check("the preflight refuses a database that has already been migrated",
      r.code === 0 && after.some((x) => x.section === "PREFLIGHT" && x.ok === "f") && after.some((x) => x.item === "public.tenants is absent" && x.ok === "f"), r.all);

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
    const scenario = (name, prepare, text) => {
      const db = "m_" + name.replace(/[^a-z0-9]/g, "_");
      cloneDb(db, "live_pristine");
      if (prepare) {
        const p = admin(db, prepare);
        if (p.code !== 0) throw new Error(`could not prepare ${name}: ${p.all}`);
      }
      const file = path.join(dir, db + ".sql");
      fs.writeFileSync(file, text);
      const a = sqlFile(db, "postgres", file);
      return { db, code: a.code, err: a.err };
    };
    const dropDb = (db) => admin("postgres", `drop database ${db};`);

    for (const m of SOURCE_MUTATIONS) {
      if (!boundaryText.includes(m.from)) {
        check(`source mutation ${m.name} still applies to the migration text`, false, "update the mutation with the migration");
        continue;
      }
      const sc = scenario(m.name, null, boundaryText.replace(m.from, m.to));
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
  console.log(`pg-harness: ${result.checks.length} checks, ${result.mutations.length} database mutations, ${result.sourceMutations.length} source scenarios, ${result.preflight.length} preflight scenarios, ${result.ms} ms, PostgreSQL ${result.pgVersion}`);
  console.log("HARNESS_RESULT " + JSON.stringify(result));
  // exitCode, not exit(): a pipe's writes are asynchronous on Windows, and the result line must arrive.
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) main();

module.exports = { MUTATIONS, SOURCE_MUTATIONS, PREFLIGHT_SCENARIOS };

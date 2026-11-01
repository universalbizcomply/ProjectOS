"use strict";
/**
 * THE TENANT BOUNDARY IN THE DATABASE — PROJECTOS-TENANT-RLS1A.
 *
 * Two kinds of rule, because each can only see half of this:
 *
 *   Text rules (TR-1 to TR-44) pin the migration bytes and the files around them. Each has named
 *   mutations, applied in memory, and each counts as killed only when ITS OWN rule fires.
 *
 *   Harness rules (TR-H*, TR-L*, TR-PG, TR-D:*, TR-S:*, TR-P:*, TR-PA:*) run the real harness on a throwaway
 *   local cluster and judge its raw results here. The harness reports what each database mutation tripped;
 *   this file says what it must have tripped. A refusal only counts if it came from the rule named.
 *   That matters because the grant wall hides a `to public` policy and the read policy hides a
 *   cross-tenant update: "something failed" would prove nothing.
 *
 * Postgres missing is a FAILURE with a named reason. It is never a skip, and never a pass.
 *
 * Comments are stripped before any "must be absent" scan. Runs a local Postgres. Touches no live system.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CC = "projectos/control-center";
const BASE_REL = `${CC}/supabase/migrations/0001_baseline.sql`;
const TB_REL = `${CC}/supabase/migrations/0002_tenant_boundary.sql`;
const SCHEMA_REL = `${CC}/supabase/schema.sql`;
const INTERACTIVE_REL = `${CC}/supabase/interactive.sql`;
const PREFLIGHT_REL = `${CC}/supabase/test/live-preflight.sql`;
const POSTAPPLY_REL = `${CC}/supabase/test/live-postapply.sql`;
const MEMBERSHIP_REL = `${CC}/supabase/test/live-owner-membership.sql`;
const DEFAULTS_REL = `${CC}/supabase/migrations/0003_default_privileges.sql`;
const PREFLIGHT3_REL = `${CC}/supabase/test/live-preflight-0003.sql`;
const GATE_REL = `${CC}/supabase/test/privilege-gate.sql`;
const ASSERT_REL = `${CC}/supabase/test/assertions.sql`;
const FIXTURES_REL = `${CC}/supabase/test/fixtures.sql`;
const SHAPE_REL = `${CC}/supabase/test/supabase-shape.sql`;
const LIVE_REL = `${CC}/supabase/test/live-shape.sql`;
const HARNESS_REL = `${CC}/supabase/test/pg-harness.cjs`;
const SUPA_REL = `${CC}/src/data/supabase.ts`;
const AUTH_REL = `${CC}/src/data/auth.ts`;
const BOOT_REL = `${CC}/test/authBootstrap.test.tsx`;
const DOC_REL = "docs/05_Schema.md";
const EVIDENCE_REL = "docs/finish/PROJECTOS-TENANT-RLS1A.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const SOURCES = [BASE_REL, TB_REL, DEFAULTS_REL, SCHEMA_REL, INTERACTIVE_REL, PREFLIGHT_REL, PREFLIGHT3_REL, POSTAPPLY_REL, MEMBERSHIP_REL, GATE_REL, ASSERT_REL, FIXTURES_REL, EVIDENCE_REL,
  SHAPE_REL, LIVE_REL, HARNESS_REL, SUPA_REL, AUTH_REL, BOOT_REL, DOC_REL, VA_REL, CR_REL];

const SELF = "val-projectos-tenant-rls1a";
const OWNER_ACCOUNT = "cd2e8678-1e00-4264-95bb-7d75738a1f50";
const MIN_ASSERTIONS = 100;
const HELPER_BODIES = {
  my_tenant_ids: "\n  select m.tenant_id from public.tenant_members as m where m.user_id = (select auth.uid());\n",
  my_owned_tenant_ids: "\n  select m.tenant_id from public.tenant_members as m\n   where m.user_id = (select auth.uid()) and m.role = 'owner';\n",
};
const HARNESS_TIMEOUT_MS = 300000;

/** These bytes are applied on the live project. A changed byte means the repository no longer says what ran. */
const LIVE_APPLIED = {
  [BASE_REL]: "11fc5de040b5025beef5ce5068871709418604ad10be32d5eb4d8f656f42ef4a",
  [TB_REL]: "7d1520b3ee2562be3fede900b83401bfed68141e102bf9bfa6000bdf84e3d4c6",
  [MEMBERSHIP_REL]: "31d554d0c71afd993d81b5319a17c1339a8f9128eaac92dd4fa675ec4a1a8517",
};

const DEFAULTS_STATEMENTS = [
  ...["tables", "sequences", "functions"].map((k) => `alter default privileges for role postgres in schema public revoke all on ${k} from anon, authenticated`),
  "alter default privileges for role postgres revoke execute on functions from public",
];
const OPEN_TO_CLIENTS = "anon|t|t|t\nauthenticated|t|t|t\nservice_role|t|t|t\nPUBLIC|t";
const CLOSED_TO_CLIENTS = "anon|f|f|f\nauthenticated|f|f|f\nservice_role|t|t|t\nPUBLIC|f";
const PREFLIGHT3_ITEMS = ["public.tenants exists", "public.tenant_members exists", "both helpers exist", "tenant_id is required on projects and phases",
  "the owner account owns both tenants", "the privilege gate reports nothing", "no public table has an open policy", "no global function default exists yet"];
const LIVE_MAJOR = 17;
const PASSED_ENV_TOKEN = /TOKEN|SECRET|PASSWORD|KEY/i;

const MAP = ["bizcomply-v2", "boithok-khana", "brik", "coverdrive", "criclocal", "erp-system", "firm-flow",
  "jd-testing", "polygo", "projectos", "tkn", "trading-bot"];

const TABLE_GRANTS = [
  "grant select on table public.tenants, public.tenant_members to authenticated",
  "grant select, insert, delete on table public.projects, public.phases to authenticated",
  "grant update (name, repo, install_status, production_freeze, open_phases) on table public.projects to authenticated",
  "grant update (phase_id, objective, status, history, advisor_note) on table public.phases to authenticated",
];
const PRIVATE_GRANTS = [
  "grant usage on schema private to authenticated",
  "grant execute on function private.my_tenant_ids() to authenticated",
  "grant execute on function private.my_owned_tenant_ids() to authenticated",
];

const member = "(tenant_id in (select private.my_tenant_ids()))";
const owner = "(tenant_id in (select private.my_owned_tenant_ids()))";
const POLICIES = [
  `create policy "tenants member read" on public.tenants for select to authenticated using (id in (select private.my_tenant_ids()))`,
  `create policy "tenant_members self read" on public.tenant_members for select to authenticated using (user_id = (select auth.uid()))`,
  ...["projects", "phases"].flatMap((t) => [
    `create policy "${t} member read" on public.${t} for select to authenticated using ${member}`,
    `create policy "${t} owner insert" on public.${t} for insert to authenticated with check ${owner}`,
    `create policy "${t} owner update" on public.${t} for update to authenticated using ${owner} with check ${owner}`,
    `create policy "${t} owner delete" on public.${t} for delete to authenticated using ${owner}`,
  ]),
];
const OLD_POLICIES = [`"projects public read" on public.projects`, `"projects authenticated read" on public.projects`,
  `"projects authenticated write" on public.projects`, `"phases authenticated all" on public.phases`];

const PREFLIGHT_ITEMS = ["postgres owns both tables", "public.tenants is absent", "public.tenant_members is absent",
  "schema private is absent", "every row is in the map", "every id in the map is a row", "every row is byte-equal to the seed",
  "no orphan phases", "auth.users is the owner only", "every policy is one 0002 will replace",
  "supabase_realtime can be emptied of these tables", "nothing else depends on these tables", "no client can create in schema public"];
const POSTAPPLY_ITEMS = ["the privilege gate reports nothing", "no public table has an open policy", "row level security is on for every public table",
  "the four tables are out of every publication", "no client can create in schema public",
  "postgres default ACL in public gives anon and authenticated nothing", "new postgres functions give PUBLIC nothing",
  "both helper bodies are exact", "auth.uid() is the Supabase form, not security definer", "authenticated can execute auth.uid()"];

/** Assertions the exit proof depends on; deleting one would silently shrink the proof. */
const REQUIRED_ASSERTIONS = ["A-CTRL-A-projects", "A-XREAD-projects", "A-XREAD-phases", "A-XREAD-tenants", "A-XREAD-tenant_members",
  "A-XWRITE-update-projects", "A-XWRITE-delete-projects", "A-XWRITE-insert-projects", "A-STEAL-projects", "A-XFK-insert",
  "A-MEMBER-UPDATE-projects", "A-BOTH-TENANT-projects", "A-BOTH-XFK", "A-SELFADD-", "A-NONMEMBER-projects", "A-NULLCLAIMS-projects",
  "A-ANON-projects", "A-TRUNCATE-authenticated-projects", "A-ROWS-UNCHANGED", "A-MALFORMED-SUB-projects", "A-BOTH-UPSERT-ID",
  ...["table", "sequence", "function"].flatMap((k) => ["anon", "authenticated", "service_role"].map((r) => `A-NEWOBJ-${k}-${r}`)), "A-NEWOBJ-function-public",
  "A-MIXED-reads-B", "A-MIXED-writes-A", "A-MIXED-update-B-projects", "A-MIXED-delete-B-projects", "A-MIXED-insert-B-projects", "A-MIXED-helper-owns-one",
  "A-STRANGER-insert-projects", "A-STRANGER-update-projects", "A-STRANGER-delete-projects", "A-NULLCLAIMS-insert-projects", "A-NULLCLAIMS-update-projects",
  "A-NULLCLAIMS-delete-projects", "A-MEMBER-UPSERT-projects", "A-OWNWRITE-upsert-projects", "A-NO-PUBLIC-VIEW"];

// ---- what each database mutation must have tripped -------------------------------------------------

const gateLine = (grantee, kind, object, priv) =>
  [grantee, kind, object, priv].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\|");
const gate = (grantee, kind, object, priv) => new RegExp("^" + gateLine(grantee, kind, object, priv) + "$");

const DB_PROOFS = [
  // The exit proof's five.
  { name: "using-true-projects", failed: ["A-XREAD-projects", "A-NONMEMBER-projects"] },
  { name: "using-true-phases", failed: ["A-XREAD-phases", "A-NONMEMBER-phases"] },
  { name: "using-true-tenants", failed: ["A-XREAD-tenants", "A-NONMEMBER-tenants"] },
  { name: "using-true-tenant-members", failed: ["A-XREAD-tenant_members", "A-MEMBERS-SELF-ONLY", "A-NONMEMBER-tenant_members"] },
  { name: "uid-not-null-projects", failed: ["A-NONMEMBER-projects"] },
  { name: "uid-not-null-phases", failed: ["A-NONMEMBER-phases"] },
  { name: "true-or-helper", failed: ["A-XREAD-projects", "A-NONMEMBER-projects"], gate: gate("nobody", "policy", 'public.projects "projects member read"', "EXPRESSION_DIFFERS") },
  { name: "to-public-policy", gate: gate("public", "policy", 'public.projects "projects member read"', "NOT_TO_AUTHENTICATED") },
  { name: "private-usage-anon", gate: gate("anon", "schema", "private", "USAGE") },
  { name: "public-function-added", gate: gate("anon", "function", "tenant_leak()", "EXECUTE") },
  // The rest of the boundary.
  { name: "write-update-using-true", failed: ["A-MEMBER-UPDATE-projects"] },
  { name: "write-delete-using-true", failed: ["A-MEMBER-DELETE-phases"] },
  { name: "insert-check-true", failed: ["A-XWRITE-insert-projects", "A-MEMBER-INSERT-projects", "A-STRANGER-insert-projects", "A-NULLCLAIMS-insert-projects"] },
  { name: "xwrite-projects-open", failed: ["A-XWRITE-update-projects", "A-XWRITE-delete-projects", "A-STRANGER-update-projects", "A-STRANGER-delete-projects", "A-NULLCLAIMS-update-projects", "A-NULLCLAIMS-delete-projects"] },
  { name: "xwrite-phases-open", failed: ["A-XWRITE-update-phases", "A-XWRITE-delete-phases", "A-XWRITE-insert-phases", "A-STRANGER-update-phases", "A-STRANGER-delete-phases", "A-STRANGER-insert-phases", "A-NULLCLAIMS-update-phases", "A-NULLCLAIMS-delete-phases", "A-NULLCLAIMS-insert-phases"] },
  { name: "owner-helper-widened", failed: ["A-MEMBER-INSERT-projects", "A-MEMBER-UPDATE-phases", "A-MEMBER-UPSERT-projects", "A-HELPER-member-owns-none"] },
  { name: "owner-anywhere-owns-all", failed: ["A-MIXED-helper-owns-one", "A-MIXED-update-B-projects", "A-MIXED-delete-B-projects", "A-MIXED-insert-B-projects", "A-MIXED-update-B-phases", "A-MIXED-delete-B-phases", "A-MIXED-insert-B-phases"] },
  { name: "read-policy-for-all", failed: ["A-MEMBER-INSERT-projects", "A-MEMBER-UPDATE-projects"], gate: gate("nobody", "policy", 'public.projects "projects member read"', "COMMAND_DIFFERS") },
  { name: "public-view-over-tenant-table", failed: ["A-NO-PUBLIC-VIEW"], gate: gate("authenticated", "table", "public.project_names", "SELECT") },
  { name: "column-grant-tenant-id", failed: ["A-BOTH-TENANT-projects", "A-BOTH-UPSERT-TENANT"], gate: gate("authenticated", "column", "public.projects.tenant_id", "UPDATE") },
  { name: "column-grant-id", failed: ["A-BOTH-ID-projects", "A-BOTH-UPSERT-ID"], gate: gate("authenticated", "column", "public.projects.id", "UPDATE") },
  { name: "malformed-sub-falls-open", failed: ["projects", "phases", "tenants", "tenant_members"].map((t) => `A-MALFORMED-SUB-${t}`) },
  { name: "table-update-grant", failed: ["A-BOTH-TENANT-phases", "A-BOTH-ID-phases", "A-BOTH-PROJECT-phases"] },
  { name: "composite-fk-dropped", failed: ["A-XFK-insert", "A-BOTH-XFK"] },
  { name: "truncate-granted", failed: ["projects", "phases", "tenants", "tenant_members"].flatMap((t) => [`A-TRUNCATE-authenticated-${t}`, `A-TRUNCATE-anon-${t}`]) },
  { name: "members-self-add", failed: ["A-SELFADD-stranger"] },
  { name: "members-self-promote", failed: ["A-SELFPROMOTE"] },
  { name: "tenants-client-write", failed: ["A-NOWRITE-tenants-update-owner"] },
  { name: "anon-select-grant", failed: ["A-ANON-projects"], gate: gate("anon", "table", "public.projects", "SELECT") },
  { name: "rls-disabled", failed: ["A-XREAD-projects"], gate: gate("nobody", "rls_off", "public.projects", "RLS_DISABLED") },
  { name: "realtime-added", failed: ["A-REALTIME-OUT"], gate: gate("supabase_realtime", "publication", "public.tenant_members", "PUBLISHED") },
  { name: "helper-execute-public", gate: gate("PUBLIC", "function", "private.my_tenant_ids()", "EXECUTE") },
  { name: "helper-search-path-dropped", gate: gate("nobody", "helper_shape", "private.my_tenant_ids()", "NOT_STABLE_INVOKER_NOARG_EMPTY_PATH") },
  { name: "tenant-default-added", failed: ["A-NODEFAULT-projects"] },
  { name: "global-project-id", failed: ["A-ID-ORACLE"] },
  { name: "retired-policy-recreated", failed: ["A-XREAD-projects"], gate: gate("nobody", "policy", 'public.projects "projects authenticated write"', "NOT_APPROVED") },
  { name: "ownership-drift", gate: gate("service_role", "owner_drift", "public.tenants", "OWNER") },
  { name: "client-role-login", gate: gate("anon", "role", "anon", "LOGIN") },
  // 0003, drifted back: only a new object can show it.
  { name: "default-acl-tables", failed: ["A-NEWOBJ-table-anon", "A-NEWOBJ-table-authenticated"] },
  { name: "default-acl-sequences", failed: ["A-NEWOBJ-sequence-anon", "A-NEWOBJ-sequence-authenticated"] },
  { name: "default-acl-functions", failed: ["A-NEWOBJ-function-anon", "A-NEWOBJ-function-authenticated"] },
  { name: "default-acl-public-execute", failed: ["A-NEWOBJ-function-public", "A-NEWOBJ-function-anon"] },
  { name: "default-acl-service-role-lost", failed: ["A-NEWOBJ-table-service_role", "A-NEWOBJ-sequence-service_role", "A-NEWOBJ-function-service_role"] },
];

const SOURCE_PROOFS = ["src-using-true", "src-uid-not-null", "src-to-public", "src-private-usage-anon", "src-revoke-skips-anon",
  "src-truncate-granted", "src-update-all-columns", "src-column-default", "src-true-or-helper", "src-no-role-guard",
  "unmapped-row", "rewritten-row", "apply-as-superuser",
  "src3-tables-kept", "src3-sequences-kept", "src3-functions-kept", "src3-authenticated-kept", "src3-public-execute-kept",
  "src3-public-execute-per-schema", "src3-service-role-revoked", "0003-as-superuser"];

const PREFLIGHT_PROOFS = {
  "pf-stranger-row": "every row is in the map",
  "pf-seed-row-missing": "every id in the map is a row",
  "pf-seed-row-rewritten": "every row is byte-equal to the seed",
  "pf-orphan-phase": "no orphan phases",
  "pf-phase-appeared": "phases is still empty, as audited",
  "pf-second-account": "auth.users is the owner only",
  "pf-owner-changed": "postgres owns both tables",
  "pf-new-name-present": "public.tenants is absent",
  "pf-unknown-policy": "every policy is one 0002 will replace",
  "pf-view-depends": "nothing else depends on these tables",
  "pf-function-mentions": "nothing else depends on these tables",
  "pf-client-can-create": "no client can create in schema public",
};

const PREFLIGHT3_PROOFS = {
  "pf3-anon-grant": "the privilege gate reports nothing",
  "pf3-open-policy": "no public table has an open policy",
  "pf3-helper-gone": "both helpers exist",
  "pf3-owner-not-member": "the owner account owns both tenants",
  "pf3-tables-already-locked": "anon and authenticated still hold the default on tables",
  "pf3-global-default-set": "no global function default exists yet",
  "pf3-after-0003-start_fresh": "no global function default exists yet",
  "pf3-after-0003-start_live": "no global function default exists yet",
};

const POSTAPPLY_PROOFS = {
  "pa-read-policy-for-all": "no public table has an open policy",
  "pa-helper-body": "both helper bodies are exact",
  "pa-auth-uid-definer": "auth.uid() is the Supabase form, not security definer",
  "pa-auth-uid-hardcoded": "auth.uid() is the Supabase form, not security definer",
  "pa-auth-uid-no-execute": "authenticated can execute auth.uid()",
  "pa-default-acl-tables": "postgres default ACL in public gives anon and authenticated nothing",
  "pa-default-acl-sequences": "postgres default ACL in public gives anon and authenticated nothing",
  "pa-default-acl-functions": "postgres default ACL in public gives anon and authenticated nothing",
  "pa-public-execute": "new postgres functions give PUBLIC nothing",
  "pa-supabase-admin-table": "the privilege gate reports nothing",
  "pa-true-or-helper": "no public table has an open policy",
  "pa-to-public": "no public table has an open policy",
  "pa-anon-select": "the privilege gate reports nothing",
  "pa-new-table-no-rls": "row level security is on for every public table",
  "pa-realtime-added": "the four tables are out of every publication",
  "pa-client-can-create": "no client can create in schema public",
};

// ---- named text mutations ---------------------------------------------------------------------------

const M = (name, rule, rel, from, to) => ({ name, rule, rel, from, to });

const MUTATIONS = [
  // TR-1
  M("baseline-holds-a-policy", "TR-1", BASE_REL, "alter table public.phases enable row level security;", `alter table public.phases enable row level security;\ncreate policy "x" on public.phases for select to authenticated using (true);`),
  M("baseline-seeds-a-row", "TR-1", BASE_REL, "alter table public.phases enable row level security;", "alter table public.phases enable row level security;\ninsert into public.projects (id, name) values ('x', 'x');"),
  M("baseline-grants", "TR-1", BASE_REL, "alter table public.phases enable row level security;", "alter table public.phases enable row level security;\ngrant select on public.projects to anon;"),
  // TR-2
  M("baseline-column-order-differs", "TR-2", BASE_REL, "  created_at   timestamptz not null default now(),\n  advisor_note text not null default '',\n", "  advisor_note text not null default '',\n  created_at   timestamptz not null default now(),\n"),
  M("baseline-drops-cascade", "TR-2", BASE_REL, "references public.projects(id) on delete cascade", "references public.projects(id)"),
  M("baseline-not-idempotent", "TR-2", BASE_REL, "create table if not exists public.phases", "create table public.phases"),
  M("baseline-no-lock-timeout", "TR-2", BASE_REL, "set local lock_timeout = '10s';\n", ""),
  // TR-3
  M("migration-not-transactional", "TR-3", TB_REL, "\nbegin;\n", "\n"),
  M("migration-commits-early", "TR-3", TB_REL, "-- ---- 6. Grants: the first wall", "commit;\nbegin;\n-- ---- 6. Grants: the first wall"),
  M("migration-drops-a-table", "TR-3", TB_REL, "-- ---- 6. Grants: the first wall", "drop table public.projects;\n-- ---- 6. Grants: the first wall"),
  M("migration-truncates", "TR-3", TB_REL, "-- ---- 6. Grants: the first wall", "truncate public.phases;\n-- ---- 6. Grants: the first wall"),
  // TR-4
  M("final-check-never-raises", "TR-4", TB_REL, "  if problems is not null then", "  if false then"),
  M("final-check-moved-early", "TR-4", TB_REL, "$check$;\n\ncommit;", "$check$;\n\ngrant select on table public.projects to anon;\n\ncommit;"),
  M("final-check-ignores-grants", "TR-4", TB_REL, "select 'authenticated can update ' || r.relname", "select 'authenticated may update ' || r.relname"),
  M("final-check-ignores-table-owner", "TR-4", TB_REL, "where pg_catalog.pg_get_userbyid(r.relowner) <> 'postgres'", "where false"),
  M("final-check-ignores-schema-owner", "TR-4", TB_REL, "pg_catalog.pg_get_userbyid(n.nspowner) <> 'postgres'", "false"),
  M("final-check-ignores-helper-owner", "TR-4", TB_REL, "where pg_catalog.pg_get_userbyid(h.proowner) <> 'postgres'", "where false"),
  M("final-check-loose-qual", "TR-4", TB_REL, "where l.qual is distinct from e.qual\n", "where pg_catalog.strpos(l.qual, e.qual) = 0\n"),
  M("final-check-loose-with-check", "TR-4", TB_REL, "or l.with_check is distinct from e.with_check\n", "or pg_catalog.strpos(l.with_check, e.with_check) = 0\n"),
  // TR-5
  M("map-row-dropped", "TR-5", TB_REL, "    ('tkn',           'owner-personal', 'TKN',              'none',                                'installed', true,  0),\n", ""),
  M("map-row-to-agency", "TR-5", TB_REL, "('polygo',        'owner-personal',", "('polygo',        'agency-business',"),
  M("map-row-added", "TR-5", TB_REL, "    ('tkn',           'owner-personal', 'TKN',", "    ('seo-agency',    'owner-personal', 'SEO',              'none',                                'installed', true,  0),\n    ('tkn',           'owner-personal', 'TKN',"),
  M("map-content-drifts", "TR-5", TB_REL, "'universalbizcomply/ProjectOS',        'installed', false, 12)", "'attacker/fork',                       'installed', false, 12)"),
  M("backfill-catch-all", "TR-5", TB_REL, " where p.id = m.project_id\n", " where m.project_id = 'projectos'\n"),
  M("backfill-ignores-repo", "TR-5", TB_REL, "   and p.repo = m.repo\n", ""),
  M("backfill-ignores-open-phases", "TR-5", TB_REL, "   and p.open_phases = m.open_phases\n", ""),
  // TR-6
  M("unmapped-only-warns", "TR-6", TB_REL, "raise exception 'TENANT_BACKFILL_UNMAPPED: no tenant for projects: %', unmapped;", "raise notice 'TENANT_BACKFILL_UNMAPPED: no tenant for projects: %', unmapped;"),
  M("unmapped-check-removed", "TR-6", TB_REL, "  if unmapped is not null then", "  if false then"),
  // TR-7
  M("column-default-added", "TR-7", TB_REL, "alter table public.projects add column if not exists tenant_id text;", "alter table public.projects add column if not exists tenant_id text default 'owner-personal';"),
  M("column-nullable", "TR-7", TB_REL, "alter table public.phases\n  alter column tenant_id drop default,\n  alter column tenant_id set not null;", "alter table public.phases\n  alter column tenant_id drop default;"),
  // TR-8
  M("pk-global", "TR-8", TB_REL, "add constraint projects_pkey primary key (tenant_id, id)", "add constraint projects_pkey primary key (id)"),
  M("phases-pk-global", "TR-8", TB_REL, "add constraint phases_pkey primary key (tenant_id, id)", "add constraint phases_pkey primary key (id)"),
  M("fk-not-composite", "TR-8", TB_REL, "add constraint phases_tenant_project_fkey foreign key (tenant_id, project_id)\n      references public.projects(tenant_id, id) on delete cascade,\n", ""),
  M("keys-always-recreated", "TR-8", TB_REL, "= k.condef) = 5 then\n    return;\n  end if;\n", "= k.condef) = 99 then\n    return;\n  end if;\n"),
  M("key-guard-deleted", "TR-8", TB_REL, "    return;\n  end if;\n\n  alter table public.phases\n    drop constraint", "    null;\n  end if;\n\n  alter table public.phases\n    drop constraint"),
  M("phase-unique-global", "TR-8", TB_REL, "unique (tenant_id, project_id, phase_id);", "unique (project_id, phase_id);"),
  M("helper-path-index-dropped", "TR-8", TB_REL, "create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id);\n", ""),
  // TR-9
  M("revoke-skips-anon", "TR-9", TB_REL, "  from public, anon, authenticated;\n\ngrant select on table public.tenants", "  from public, authenticated;\n\ngrant select on table public.tenants"),
  M("revoke-skips-a-table", "TR-9", TB_REL, "revoke all on table public.projects, public.phases, public.tenants, public.tenant_members", "revoke all on table public.projects, public.phases, public.tenants"),
  // TR-10
  M("update-grants-tenant-id", "TR-10", TB_REL, "grant update (name, repo, install_status,", "grant update (tenant_id, name, repo, install_status,"),
  M("update-grants-project-id", "TR-10", TB_REL, "grant update (phase_id, objective,", "grant update (project_id, phase_id, objective,"),
  M("table-update-granted", "TR-10", TB_REL, "grant update (name, repo, install_status, production_freeze, open_phases)\n  on table public.projects to authenticated;", "grant update on table public.projects to authenticated;"),
  M("truncate-granted", "TR-10", TB_REL, "grant select, insert, delete on table public.projects, public.phases to authenticated;", "grant select, insert, delete, truncate on table public.projects, public.phases to authenticated;"),
  M("tenants-write-granted", "TR-10", TB_REL, "grant select on table public.tenants, public.tenant_members to authenticated;", "grant select, insert on table public.tenants, public.tenant_members to authenticated;"),
  M("anon-read-granted", "TR-10", TB_REL, "grant select on table public.tenants, public.tenant_members to authenticated;", "grant select on table public.tenants, public.tenant_members to authenticated, anon;"),
  // TR-11
  M("using-true", "TR-11", TB_REL, `create policy "projects member read" on public.projects\n  for select to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));`, `create policy "projects member read" on public.projects\n  for select to authenticated\n  using (true);`),
  M("uid-not-null", "TR-11", TB_REL, `create policy "phases member read" on public.phases\n  for select to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));`, `create policy "phases member read" on public.phases\n  for select to authenticated\n  using (auth.uid() is not null);`),
  M("members-write-with-the-read-helper", "TR-11", TB_REL, `create policy "projects owner delete" on public.projects\n  for delete to authenticated\n  using (tenant_id in (select private.my_owned_tenant_ids()));`, `create policy "projects owner delete" on public.projects\n  for delete to authenticated\n  using (tenant_id in (select private.my_tenant_ids()));`),
  // TR-12
  M("to-public", "TR-12", TB_REL, `create policy "phases owner delete" on public.phases\n  for delete to authenticated`, `create policy "phases owner delete" on public.phases\n  for delete to public`),
  M("policy-with-no-role", "TR-12", TB_REL, `create policy "phases owner delete" on public.phases\n  for delete to authenticated`, `create policy "phases owner delete" on public.phases\n  for delete`),
  // TR-13
  M("old-policy-left-in-place", "TR-13", TB_REL, `drop policy if exists "projects authenticated write" on public.projects;\n`, ""),
  M("old-public-read-left-in-place", "TR-13", TB_REL, `drop policy if exists "projects public read" on public.projects;\n`, ""),
  // TR-14
  M("members-write-policy", "TR-14", TB_REL, `-- ---- 6. Grants: the first wall`, `create policy "x" on public.tenant_members for insert to authenticated with check (true);\n-- ---- 6. Grants: the first wall`),
  M("members-policy-calls-the-helper", "TR-14", TB_REL, `  using (user_id = (select auth.uid()));`, `  using (tenant_id in (select private.my_tenant_ids()));`),
  // TR-15
  M("helper-user-argument", "TR-15", TB_REL, "create or replace function private.my_tenant_ids()\nreturns setof text", "create or replace function private.my_tenant_ids(p_user uuid)\nreturns setof text"),
  M("helper-volatile", "TR-15", TB_REL, "create or replace function private.my_owned_tenant_ids()\nreturns setof text\nlanguage sql\nstable", "create or replace function private.my_owned_tenant_ids()\nreturns setof text\nlanguage sql\nvolatile"),
  M("helper-search-path-dropped", "TR-15", TB_REL, "create or replace function private.my_tenant_ids()\nreturns setof text\nlanguage sql\nstable\nsecurity invoker\nset search_path = ''\n", "create or replace function private.my_tenant_ids()\nreturns setof text\nlanguage sql\nstable\nsecurity invoker\n"),
  M("helper-definer", "TR-15", TB_REL, "create or replace function private.my_tenant_ids()\nreturns setof text\nlanguage sql\nstable\nsecurity invoker", "create or replace function private.my_tenant_ids()\nreturns setof text\nlanguage sql\nstable\nsecurity definer"),
  // TR-16
  M("private-usage-anon", "TR-16", TB_REL, "grant usage on schema private to authenticated;", "grant usage on schema private to authenticated, anon;"),
  M("helper-execute-public", "TR-16", TB_REL, "revoke all on function private.my_tenant_ids() from public, anon, service_role;\n", ""),
  M("private-schema-open", "TR-16", TB_REL, "revoke all on schema private from public, anon, authenticated, service_role;\n", ""),
  // TR-17
  M("public-function-added", "TR-17", TB_REL, "-- ---- 6. Grants: the first wall", "create function public.tenant_leak() returns int language sql as 'select 1';\n-- ---- 6. Grants: the first wall"),
  // TR-18
  M("realtime-omits-a-table", "TR-18", TB_REL, "and tablename in ('projects', 'phases', 'tenants', 'tenant_members')\n  loop", "and tablename in ('projects', 'phases', 'tenants')\n  loop"),
  M("realtime-assumes-membership", "TR-18", TB_REL, "-- ---- 8. In-transaction check", "alter publication supabase_realtime drop table public.phases;\n-- ---- 8. In-transaction check"),
  // TR-19
  M("owner-uuid-in-migration", "TR-19", TB_REL, "-- ---- 6. Grants: the first wall", `insert into public.tenant_members (tenant_id, user_id, role) values ('owner-personal', '${OWNER_ACCOUNT}', 'owner');\n-- ---- 6. Grants: the first wall`),
  M("email-in-migration", "TR-19", TB_REL, "('owner-personal', 'Owner personal')", "('owner-personal', 'owner@example.com')"),
  // TR-20
  M("retired-policy-restored", "TR-20", INTERACTIVE_REL, "-- The schema lives in migrations/", `create policy "phases authenticated all" on public.phases for all to authenticated using (true) with check (true);\n-- The schema lives in migrations/`),
  M("retired-seed-restored", "TR-20", SCHEMA_REL, "-- The schema lives in migrations/", "insert into public.projects (id, name) values ('brik', 'Brik');\n-- The schema lives in migrations/"),
  M("retired-pointer-dropped", "TR-20", SCHEMA_REL, "-- The schema lives in migrations/: 0001_baseline.sql, then 0002_tenant_boundary.sql.\n", ""),
  // TR-21
  M("preflight-writes", "TR-21", PREFLIGHT_REL, "with\nseed(id,", "with\nwrites as (update public.projects set name = name returning 1),\nseed(id,"),
  M("preflight-second-statement", "TR-21", PREFLIGHT_REL, "order by seq, item;", "order by seq, item;\nselect 1;"),
  // TR-22
  M("preflight-information-schema", "TR-22", PREFLIGHT_REL, "from pg_default_acl d", "from information_schema.role_table_grants g, pg_default_acl d"),
  M("preflight-grants-not-from-acls", "TR-22", PREFLIGHT_REL, "cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a\n   group by t.relname, a.grantee", "cross join lateral (select 0::oid as grantee, 'none'::text as privilege_type) a\n   group by t.relname, a.grantee"),
  // TR-23
  M("preflight-no-owner-check", "TR-23", PREFLIGHT_REL, "'postgres owns both tables'", "'tables are present'"),
  M("preflight-no-orphan-check", "TR-23", PREFLIGHT_REL, "'no orphan phases'", "'phases look fine'"),
  M("preflight-no-accounts-check", "TR-23", PREFLIGHT_REL, "'auth.users is the owner only'", "'auth.users is readable'"),
  M("preflight-map-drifts", "TR-23", PREFLIGHT_REL, "  ('tkn',           'owner-personal', 'TKN',              'none',                                'installed', true,  0),\n", ""),
  M("preflight-verdict-always-true", "TR-23", PREFLIGHT_REL, "bool_and(ok) as ok", "true as ok"),
  // TR-24
  M("membership-holds-an-email", "TR-24", MEMBERSHIP_REL, "'OWNER_MEMBERSHIP_UNKNOWN_USER: the owner account is not in auth.users'", "'OWNER_MEMBERSHIP_UNKNOWN_USER: owner@example.com is not in auth.users'"),
  M("membership-wrong-account", "TR-24", MEMBERSHIP_REL, `('agency-business', '${OWNER_ACCOUNT}', 'owner')`, "('agency-business', '00000000-0000-4000-8000-000000000000', 'owner')"),
  M("membership-as-member", "TR-24", MEMBERSHIP_REL, `('owner-personal',  '${OWNER_ACCOUNT}', 'owner')`, `('owner-personal',  '${OWNER_ACCOUNT}', 'member')`),
  M("membership-not-transactional", "TR-24", MEMBERSHIP_REL, "\nbegin;\n", "\n"),
  // TR-25
  M("gate-reads-information-schema", "TR-25", GATE_REL, "from pg_policy p join tables t on t.oid = p.polrelid\n   where pg_get_expr", "from information_schema.tables x, pg_policy p join tables t on t.oid = p.polrelid\n   where pg_get_expr"),
  M("gate-skips-expressions", "TR-25", GATE_REL, "'EXPRESSION_DIFFERS'", "'NOT_COMPARED'"),
  M("gate-skips-commands", "TR-25", GATE_REL, "   where p.polcmd::text <> a.polcmd\n", "   where false\n"),
  M("gate-command-table-wrong", "TR-25", GATE_REL, "select t.relname, t.relname || ' member read', 'r', m.expr, null", "select t.relname, t.relname || ' member read', '*', m.expr, null"),
  M("gate-ignores-private", "TR-25", GATE_REL, "where n.nspname in ('public', 'private') and c.relkind", "where n.nspname in ('public') and c.relkind"),
  M("gate-ignores-public-functions", "TR-25", GATE_REL, "   where n.nspname in ('public', 'private')\n),\nallowed_table", "   where n.nspname in ('private')\n),\nallowed_table"),
  M("gate-allows-anon", "TR-25", GATE_REL, "allowed_table(rolname, nspname, relname, priv) as (values\n", "allowed_table(rolname, nspname, relname, priv) as (values\n  ('anon', 'public', 'projects', 'SELECT'),\n"),
  M("gate-skips-policy-roles", "TR-25", GATE_REL, "'NOT_TO_AUTHENTICATED'", "'NOT_CHECKED'"),
  M("gate-trusts-the-grant-table", "TR-25", GATE_REL, "where has_table_privilege(r.rolname, t.oid, p.priv)\n     and not exists", "where false\n     and not exists"),
  // TR-26
  M("fetch-projects-restored", "TR-26", SUPA_REL, "export function getClient()", "export async function fetchProjects() { return []; }\n\nexport function getClient()"),
  M("seed-import-restored", "TR-26", SUPA_REL, "import { createClient, type SupabaseClient } from '@supabase/supabase-js';", "import { createClient, type SupabaseClient } from '@supabase/supabase-js';\nimport { PROJECTS } from './projects';"),
  M("test-mock-restored", "TR-26", BOOT_REL, "  isSupabaseConfigured: true,\n", "  isSupabaseConfigured: true,\n  fetchProjects: async () => ({ rows: [] }),\n"),
  // TR-27
  M("public-read-comment-restored", "TR-27", SUPA_REL, " * Today only Supabase Auth is used", " * This reads a public `projects` table protected by row-level security (public read-only).\n * Today only Supabase Auth is used"),
  M("static-seed-comment-restored", "TR-27", SUPA_REL, "When those are absent `getClient` returns null.", "When those are absent the app falls back to the static seed."),
  M("auth-comment-restored", "TR-27", AUTH_REL, "supabase/migrations/", "supabase/schema.sql"),
  M("auth-comment-claims-the-apply-happened", "TR-27", AUTH_REL, "A session carries no kernel authority.", "A session reaches only the rows of tenants the user belongs to, and carries no kernel authority."),
  M("client-comment-claims-the-apply-happened", "TR-27", SUPA_REL, " * Today only Supabase Auth is used", " * Those tables are tenant-bound by row level security.\n * Today only Supabase Auth is used"),
  // TR-28
  M("harness-one-start", "TR-28", HARNESS_REL, `      { label: "live-shaped start", db: "start_live", expectedSeed: SEED_ROWS },\n`, ""),
  M("harness-applies-once", "TR-28", HARNESS_REL, `      applyMigrations(st.db, st.label + ", pass 2");\n`, ""),
  M("harness-superuser-owner", "TR-28", HARNESS_REL, `const a = sqlFile(db, "postgres", path.join(MIGRATIONS_DIR, m));`, `const a = sqlFile(db, "supabase_admin", path.join(MIGRATIONS_DIR, m));`),
  M("harness-skip-is-a-pass", "TR-28", HARNESS_REL, "process.exitCode = 3;", "process.exitCode = 0;"),
  M("harness-binds-everywhere", "TR-28", HARNESS_REL, "-c listen_addresses=127.0.0.1", "-c listen_addresses=*"),
  M("harness-leaves-the-server", "TR-28", HARNESS_REL, "  } finally {\n    stopServer();\n", "  } finally {\n"),
  M("harness-leaves-the-directory", "TR-28", HARNESS_REL, "    const failure = scratch.cleanup(dir);\n", "    const failure = null;\n"),
  M("harness-own-temp-dir", "TR-28", HARNESS_REL, "const dir = scratch.owned(SCRATCH_TAG);", `const dir = fs.mkdtempSync("tenant-rls-pg");`),
  M("harness-trusts", "TR-28", HARNESS_REL, `"--auth=scram-sha-256"`, `"--auth=trust"`),
  M("harness-password-on-the-command-line", "TR-28", HARNESS_REL, `"--pwfile=" + pwfile`, `"--pwprompt=" + password`),
  M("harness-inherits-the-environment", "TR-28", HARNESS_REL, "const env = minimalEnv(pg.dir);", "const env = { ...process.env, ...minimalEnv(pg.dir) };"),
  M("harness-passes-a-token", "TR-28", HARNESS_REL, `const PASSED_ENV = ["SystemRoot",`, `const PASSED_ENV = ["GITHUB_TOKEN", "SystemRoot",`),
  M("harness-no-sweep", "TR-28", HARNESS_REL, "result.swept = sweepStale(pgctl, env);", "result.swept = [];"),
  M("harness-sweep-ignores-owner", "TR-28", HARNESS_REL, "return old || !isAlive(owner.pid);", "return true;"),
  M("harness-sweep-loose-prefix", "TR-28", HARNESS_REL, "const STALE_DIR = /^projectos-tenant-rls-pg-[A-Za-z0-9]{6}$/;", "const STALE_DIR = /^projectos-/;"),
  M("harness-stop-defined-late", "TR-28", HARNESS_REL, "  let data = null;\n", `  let data = null;\n  spawnSync(pgctl, ["-o", "x", "-w", "start"]);\n`),
  M("harness-graceful-stop-only", "TR-28", HARNESS_REL, `    stopped = true;\n    spawnSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"]`, `    stopped = true;\n    spawnSync(pgctl, ["-D", data, "-m", "fast", "-w", "stop"]`),
  M("harness-asks-the-shell-where", "TR-28", HARNESS_REL, "const found = (explicit ? [explicit] : candidateDirs())", `const found = (explicit ? [explicit] : [path.dirname(spawnSync("where", ["psql"]).stdout.toString().trim())])`),
  M("harness-trusts-relative-path", "TR-28", HARNESS_REL, "if (path.isAbsolute(d)) dirs.push(d);", "dirs.push(d);"),
  M("harness-ignores-live-major", "TR-28", HARNESS_REL, "found.find((f) => f.major === LIVE_MAJOR) || found[0]", "found[0]"),
  M("harness-silent-fallback", "TR-28", HARNESS_REL, "return { ...chosen, note: `FALLBACK: running on PostgreSQL", "return { ...chosen, note: null, unused: `FALLBACK: running on PostgreSQL"),
  M("shape-owner-is-superuser", "TR-28", SHAPE_REL, "create role postgres login nosuperuser createrole bypassrls;", "create role postgres login superuser;"),
  M("shape-no-default-acl", "TR-28", SHAPE_REL, "alter default privileges for role postgres in schema public\n  grant all on tables to postgres, anon, authenticated, service_role;\n", ""),
  M("shape-no-admin-default", "TR-28", SHAPE_REL, "alter default privileges for role supabase_admin in schema public\n  grant all on tables to postgres, anon, authenticated, service_role;\n", ""),
  M("harness-applies-0003-once", "TR-28", HARNESS_REL, `      applyDefaults("pass 2");\n`, ""),
  M("harness-skips-the-positive-control", "TR-28", HARNESS_REL, "objectsBefore === OPEN_TO_CLIENTS, objectsBefore);", "true, objectsBefore);"),
  M("shape-auth-users-owned-by-postgres", "TR-28", SHAPE_REL, "alter table auth.users owner to supabase_auth_admin;", "alter table auth.users owner to postgres;"),
  M("shape-uid-ignores-claims", "TR-28", SHAPE_REL, "(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')", "null"),
  M("live-shape-loses-a-policy", "TR-28", LIVE_REL, `create policy "phases authenticated all" on public.phases\n  for all to authenticated using (true) with check (true);\n`, ""),
  // TR-29
  M("assertions-control-removed", "TR-29", ASSERT_REL, "select rlstest.expect_count('A-CTRL-A-projects', $$select count(*) from public.projects$$, :a_projects);\n", ""),
  M("assertions-steal-dropped", "TR-29", ASSERT_REL, "select rlstest.expect_error('A-BOTH-TENANT-projects',", "select rlstest.expect_error('A-BOTH-NAME-projects',"),
  M("assertions-no-mixed-user", "TR-29", ASSERT_REL, "select rlstest.expect_rows('A-MIXED-update-B-projects',", "select rlstest.expect_rows('A-MIXED-renamed-projects',"),
  M("fixture-mixed-user-owns-b", "TR-29", FIXTURES_REL, "('agency-business', 'ffffffff-0000-4000-8000-000000000001', 'member')", "('agency-business', 'ffffffff-0000-4000-8000-000000000001', 'owner')"),
  M("fixture-mixed-user-missing", "TR-29", FIXTURES_REL, "  ('owner-personal',  'ffffffff-0000-4000-8000-000000000001', 'owner'),\n", ""),
  M("assertions-any-refusal-counts", "TR-29", ASSERT_REL, "  perform rlstest._record(p_id, msg <> 'rlstest_no_error' and msg ilike p_like, msg);", "  perform rlstest._record(p_id, msg <> 'rlstest_no_error', msg);"),
  M("assertions-stop-at-first-failure", "TR-29", ASSERT_REL, "select 'COMPLETE';", "select 'DONE';"),
  // TR-30
  M("not-registered-in-validate-all", "TR-30", VA_REL, `"${SELF}"`, `"val-projectos-tenant-rls1a-disabled"`),
  M("not-registered-in-cached-runner", "TR-30", CR_REL, `"${SELF}"`, `"val-projectos-tenant-rls1a-disabled"`),
  // TR-31
  M("doc-keeps-the-old-source", "TR-31", DOC_REL, "### `public.projects`\n", "### `public.projects` (`schema.sql`)\n"),
  M("doc-keeps-the-old-policy", "TR-31", DOC_REL, "**RLS:** enabled on all four, not forced.", "**RLS:** `using (true)`."),
  M("doc-auth-flow-stale", "TR-31", DOC_REL, "tenant RLS on public.tenants, tenant_members, projects, phases", "RLS policies on public.projects/phases"),
  M("doc-drops-the-upsert-warning", "TR-31", DOC_REL, "fails with `permission denied`, by design", "works"),
  // TR-32
  M("role-guard-removed", "TR-32", TB_REL, "  if current_user <> 'postgres' then\n    raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;\n  end if;\n", ""),
  M("role-guard-any-superuser", "TR-32", TB_REL, "if current_user <> 'postgres' then", "if current_user not in ('postgres', 'supabase_admin') then"),
  M("role-guard-after-the-work", "TR-32", TB_REL, "set local search_path = '';\n", "set local search_path = '';\ncreate schema if not exists early;\n"),
  // TR-33
  M("postapply-writes", "TR-33", POSTAPPLY_REL, "with client_roles as (", "with writes as (update public.projects set name = name returning 1),\nclient_roles as ("),
  M("postapply-second-statement", "TR-33", POSTAPPLY_REL, "order by seq, item;", "order by seq, item;\nselect 1;"),
  M("postapply-information-schema", "TR-33", POSTAPPLY_REL, "from pg_default_acl d left join", "from information_schema.role_table_grants g, pg_default_acl d left join"),
  // TR-34
  M("postapply-gate-drifts", "TR-34", POSTAPPLY_REL, "array['USAGE', 'CREATE']", "array['CREATE']"),
  M("gate-drifts-from-postapply", "TR-34", GATE_REL, "array['USAGE', 'CREATE']", "array['CREATE']"),
  // TR-35
  M("postapply-verdict-always-true", "TR-35", POSTAPPLY_REL, "bool_and(ok) as ok", "true as ok"),
  M("postapply-no-nspacl", "TR-35", POSTAPPLY_REL, "select 70, 'public schema', coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), null,\n         string_agg(a.privilege_type, ', ' order by a.privilege_type)\n    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a\n   where n.nspname = 'public'\n   group by a.grantee\n  union all\n", ""),
  M("postapply-no-default-acl-listing", "TR-35", POSTAPPLY_REL, "    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace\n", "    from (select null::oid as defaclrole, null::\"char\" as defaclobjtype, null::oid as defaclnamespace, null::aclitem[] as defaclacl) d left join pg_namespace n on n.oid = d.defaclnamespace\n"),
  M("postapply-no-open-policy-check", "TR-35", POSTAPPLY_REL, "'no public table has an open policy'", "'policies listed'"),
  M("postapply-open-policy-names-only", "TR-35", POSTAPPLY_REL, "          or pg_get_expr(p.polqual, p.polrelid) is distinct from a.qual\n          or pg_get_expr(p.polwithcheck, p.polrelid) is distinct from a.with_check\n          or p.polcmd::text", "          or p.polcmd::text"),
  M("postapply-no-realtime-check", "TR-35", POSTAPPLY_REL, "'the four tables are out of every publication'", "'realtime listed'"),
  // TR-23, added with the public schema row
  // TR-15, the helper bodies
  M("helper-body-owner-anywhere", "TR-15", TB_REL, "   where m.user_id = (select auth.uid()) and m.role = 'owner';", "   where m.user_id = (select auth.uid()) and exists (select 1 from public.tenant_members o where o.role = 'owner');"),
  M("helper-body-any-user", "TR-15", TB_REL, "select m.tenant_id from public.tenant_members as m where m.user_id = (select auth.uid());", "select m.tenant_id from public.tenant_members as m;"),
  // TR-42
  M("postapply-helper-body-drifts", "TR-42", POSTAPPLY_REL, "   where m.user_id = (select auth.uid()) and m.role = ''owner'';", "   where m.user_id = (select auth.uid());"),
  M("postapply-helper-body-unchecked", "TR-42", POSTAPPLY_REL, "join pg_proc p on p.proname = h.proname and p.prosrc = h.body", "join pg_proc p on p.proname = h.proname"),
  // TR-43
  M("postapply-uid-allows-definer", "TR-43", POSTAPPLY_REL, "select not prosecdef and provolatile = 's'", "select provolatile = 's'"),
  M("postapply-uid-allows-hardcoded-id", "TR-43", POSTAPPLY_REL, "                          and src !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}'\n", ""),
  M("postapply-uid-allows-set-config", "TR-43", POSTAPPLY_REL, "                          and src !~* 'set_config'\n", ""),
  M("postapply-uid-allows-another-setting", "TR-43", POSTAPPLY_REL, "                          and (length(src) - length(replace(src, 'current_setting(', ''))) / length('current_setting(') = 2\n", ""),
  M("postapply-uid-execute-unchecked", "TR-43", POSTAPPLY_REL, "         and has_function_privilege('authenticated', to_regprocedure('auth.uid()'), 'EXECUTE'),\n", "         ,\n"),
  M("postapply-uid-schema-unchecked", "TR-43", POSTAPPLY_REL, "         and has_schema_privilege('authenticated', 'auth', 'USAGE')\n", ""),
  // TR-44
  M("evidence-carries-no-f5-bound", "TR-44", EVIDENCE_REL, "**F5, carried.**", "**F5.**"),
  M("evidence-still-says-open", "TR-44", EVIDENCE_REL, "| Agency `ai-generated-code-security-auditor` | APPROVE WITH CHANGES", "| Agency `ai-generated-code-security-auditor` | **OPEN**"),
  M("preflight-no-nspacl", "TR-23", PREFLIGHT_REL, "   where n.nspname = 'public'\n   group by a.grantee\n", "   where n.nspname = 'none'\n   group by a.grantee\n"),
  // TR-36: bytes already applied live
  M("applied-0001-edited", "TR-36", BASE_REL, "set local lock_timeout = '10s';", "set local lock_timeout = '30s';"),
  M("applied-0002-edited", "TR-36", TB_REL, "('owner-personal', 'Owner personal'),", "('owner-personal', 'Owner'),"),
  M("applied-membership-edited", "TR-36", MEMBERSHIP_REL, "set local search_path = '';", "set local search_path = 'public';"),
  // TR-37
  M("defaults-not-transactional", "TR-37", DEFAULTS_REL, "\nbegin;\n", "\n"),
  M("defaults-commits-early", "TR-37", DEFAULTS_REL, "-- Judges what pg_default_acl now says", "commit;\nbegin;\n-- Judges what pg_default_acl now says"),
  M("defaults-no-lock-timeout", "TR-37", DEFAULTS_REL, "set local lock_timeout = '10s';\n", ""),
  M("defaults-no-role-guard", "TR-37", DEFAULTS_REL, "  if current_user <> 'postgres' then\n    raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;\n  end if;\n", ""),
  M("defaults-guard-after-the-work", "TR-37", DEFAULTS_REL, "set local search_path = '';\n", "set local search_path = '';\nalter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;\n"),
  // TR-38
  M("defaults-keeps-tables", "TR-38", DEFAULTS_REL, "  revoke all on tables from anon, authenticated;", "  revoke all on tables from anon;"),
  M("defaults-keeps-sequences", "TR-38", DEFAULTS_REL, "alter default privileges for role postgres in schema public\n  revoke all on sequences from anon, authenticated;\n", ""),
  M("defaults-keeps-functions", "TR-38", DEFAULTS_REL, "alter default privileges for role postgres in schema public\n  revoke all on functions from anon, authenticated;\n", ""),
  M("defaults-public-execute-per-schema", "TR-38", DEFAULTS_REL, "alter default privileges for role postgres\n  revoke execute", "alter default privileges for role postgres in schema public\n  revoke execute"),
  M("defaults-touches-service-role", "TR-38", DEFAULTS_REL, "revoke all on sequences from anon, authenticated;", "revoke all on sequences from anon, authenticated, service_role;"),
  M("defaults-touches-existing-tables", "TR-38", DEFAULTS_REL, "-- Judges what pg_default_acl now says", "revoke all on table public.projects from service_role;\n-- Judges what pg_default_acl now says"),
  M("defaults-grants-something", "TR-38", DEFAULTS_REL, "-- Judges what pg_default_acl now says", "grant select on public.tenants to service_role;\n-- Judges what pg_default_acl now says"),
  // TR-39
  M("defaults-check-never-raises", "TR-39", DEFAULTS_REL, "  if problems is not null then", "  if false then"),
  M("defaults-check-moved-early", "TR-39", DEFAULTS_REL, "$check$;\n\ncommit;", "$check$;\n\nalter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;\n\ncommit;"),
  M("defaults-check-reads-a-literal", "TR-39", DEFAULTS_REL, "from pg_catalog.pg_default_acl as d", "from (select 0::pg_catalog.oid as defaclrole) as d"),
  M("defaults-check-ignores-public-execute", "TR-39", DEFAULTS_REL, "where not exists (select 1 from entries as e where e.kind = 'f' and e.defaclnamespace = 0)", "where false"),
  M("defaults-check-ignores-service-role", "TR-39", DEFAULTS_REL, "           <> k.service_role_privileges", "           < 0"),
  M("defaults-check-ignores-clients", "TR-39", DEFAULTS_REL, "     where e.nspname = 'public' or e.defaclnamespace = 0\n", "     where false\n"),
  // TR-40
  M("preflight3-writes", "TR-40", PREFLIGHT3_REL, "with client_roles as (", "with writes as (update public.projects set name = name returning 1),\nclient_roles as ("),
  M("preflight3-second-statement", "TR-40", PREFLIGHT3_REL, "order by seq, item;", "order by seq, item;\nselect 1;"),
  M("preflight3-information-schema", "TR-40", PREFLIGHT3_REL, "from pg_default_acl d left join", "from information_schema.role_table_grants g, pg_default_acl d left join"),
  M("preflight3-gate-drifts", "TR-40", PREFLIGHT3_REL, "array['USAGE', 'CREATE']", "array['CREATE']"),
  M("preflight3-verdict-always-true", "TR-40", PREFLIGHT3_REL, "bool_and(ok) as ok", "true as ok"),
  M("preflight3-no-global-check", "TR-40", PREFLIGHT3_REL, "'no global function default exists yet'", "'global default listed'"),
  M("preflight3-no-owner-check", "TR-40", PREFLIGHT3_REL, "'the owner account owns both tenants'", "'tenants have members'"),
  M("preflight3-no-absent-check", "TR-40", PREFLIGHT3_REL, "'anon and authenticated still hold the default on '", "'default listed for '"),
  M("postapply-open-policy-ignores-command", "TR-35", POSTAPPLY_REL, "          or p.polcmd::text <> a.polcmd\n", ""),
  M("preflight3-open-policy-ignores-command", "TR-40", PREFLIGHT3_REL, "          or p.polcmd::text <> a.polcmd\n", ""),
  // TR-41
  M("postapply-no-known-limit", "TR-41", POSTAPPLY_REL, "'known limit: objects made by supabase_admin in public stay exposed'", "'defaults listed'"),
  M("postapply-default-ignores-global", "TR-41", POSTAPPLY_REL, "     and d.defaclnamespace in (0, (select oid from pg_namespace where nspname = 'public'))\n", "     and d.defaclnamespace = (select oid from pg_namespace where nspname = 'public')\n"),
  M("postapply-default-ignores-a-kind", "TR-41", POSTAPPLY_REL, "     and d.defaclobjtype::text in ('r', 'S', 'f')\n", "     and d.defaclobjtype::text in ('r', 'f')\n"),
  M("postapply-public-execute-unchecked", "TR-41", POSTAPPLY_REL, "         and not exists (select 1 from postgres_defaults e where e.grantee = 0),\n", "         ,\n"),
  M("postapply-global-row-not-required", "TR-41", POSTAPPLY_REL, "         exists (select 1 from postgres_defaults e where e.kind = 'f' and e.defaclnamespace = 0)\n         and not exists", "         not exists"),
];

// ---- reading ------------------------------------------------------------------------------------------

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
}

/** Strip SQL comments, leaving strings and dollar-quoted bodies intact, so a comment can never satisfy a scan. */
function stripSql(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (text[i] === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") j += 2;
        else if (text[j] === "'") break;
        else j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      const tag = /^\$[a-zA-Z_]*\$/.exec(text.slice(i, i + 40));
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        const stop = end < 0 ? text.length : end + tag[0].length;
        out += text.slice(i, stop);
        i = stop;
      } else {
        out += text[i];
        i += 1;
      }
    }
  }
  return out;
}

/** Strip comments outside strings: the same walk `val-projectos-kernel-cost-cap1a` uses. */
function stripJs(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** A seed row as `id|tenant|name|repo|status|freeze|open`, so the migration's map and the preflight's can be compared. */
const SEED_ROW = /^\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false),\s*(\d+)\),?\s*$/gm;
const seedRows = (text) => [...text.matchAll(SEED_ROW)].map((m) => m.slice(1, 8).join("|"));
const collapse = (s) => s.replace(/\s+/g, " ").trim();
/** The dollar-quoted body of each helper in the migration, byte for byte. */
const helperBodies = (sql) => Object.fromEntries(["my_tenant_ids", "my_owned_tenant_ids"].map((name) => {
  const m = new RegExp(String.raw`function private\.${name}\(\)[\s\S]*?\$helper\$([\s\S]*?)\$helper\$;`).exec(sql);
  return [name, m ? m[1] : null];
}));
const statements = (sql, re) => (sql.match(re) || []).map((s) => collapse(s.replace(/;$/, "")));
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
/** Removes string literals and dollar-quoted bodies, so the words inside a message cannot look like a verb. */
const withoutStrings = (sql) => sql.replace(/\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$/g, " ").replace(/'(?:[^']|'')*'/g, "''");

// ---- the text rules -----------------------------------------------------------------------------------

function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("TR-0", `${rel} is missing`);
      return errors;
    }
  }
  const base = stripSql(raw[BASE_REL]);
  const tb = stripSql(raw[TB_REL]);
  const pre = stripSql(raw[PREFLIGHT_REL]);
  const own = stripSql(raw[MEMBERSHIP_REL]);
  const gateSql = stripSql(raw[GATE_REL]);
  const harness = stripJs(raw[HARNESS_REL]);
  const supa = stripJs(raw[SUPA_REL]);
  const boot = stripJs(raw[BOOT_REL]);

  // TR-1: the baseline decides no access: no policy, no seed, no grant.
  if (/create\s+policy|insert\s+into|\bgrant\b|\brevoke\b/i.test(base)) E("TR-1", "0001 must hold no policy, no seed and no grant");

  // TR-2: the baseline is the live shape, and is safe to re-run.
  if (!/created_at\s+timestamptz not null default now\(\),\s*advisor_note\s+text not null default ''/.test(base) ||
      !base.includes("references public.projects(id) on delete cascade") || !/unique \(project_id, phase_id\)/.test(base) ||
      !base.includes("create table if not exists public.projects") || !base.includes("create table if not exists public.phases") ||
      !base.includes("set local lock_timeout = '10s';")) {
    E("TR-2", "0001 no longer matches the live shape, cannot be re-run, or has no lock timeout");
  }

  // TR-3: one transaction, nothing destructive.
  const begins = (tb.match(/^begin;\s*$/gm) || []).length;
  const commits = (tb.match(/^commit;\s*$/gm) || []).length;
  if (begins !== 1 || commits !== 1 || !/^\s*begin;/.test(tb) || !/commit;\s*$/.test(tb)) E("TR-3", "0002 must be exactly one transaction, end to end");
  // Only literals are removed: a DROP inside a dollar-quoted DO body must still count.
  const tbNoLiterals = tb.replace(/'(?:[^']|'')*'/g, "''");
  if (/\bdrop\s+table\b|\btruncate\s+(table\s+)?public\b|\bdelete\s+from\b/i.test(tbNoLiterals)) E("TR-3", "0002 must not drop or empty a table");

  // TR-4: the check runs last, raises, and judges every wall.
  const needed = ["row level security is off on", "tenant_id is nullable, missing or has a default on", "key is missing or different",
    "policy is not expected", "policy is not for authenticated alone", "policy is not bound to its helper", "anon holds", "PUBLIC holds",
    "authenticated holds", "authenticated can update", "anon can use schema private", "helper is not stable", "still in supabase_realtime",
    "where pg_catalog.pg_get_userbyid(r.relowner) <> 'postgres'", "pg_catalog.pg_get_userbyid(n.nspowner) <> 'postgres'",
    "where pg_catalog.pg_get_userbyid(h.proowner) <> 'postgres'", "where l.qual is distinct from e.qual\n", "or l.with_check is distinct from e.with_check\n"];
  if (!/if problems is not null then\s+raise exception 'TENANT_BOUNDARY_CHECK_FAILED: %'/.test(tb) || /strpos/.test(tb) ||
      !/\$check\$;\s*commit;\s*$/.test(tb) || !needed.every((n) => tb.includes(n))) {
    E("TR-4", "the in-transaction check no longer runs last, no longer raises, or no longer judges every wall");
  }

  // TR-5: the backfill map is exactly the audited twelve, in owner-personal, and a row must match on content
  // as well as id. The preflight holds the same rows, so a change to one without the other is caught.
  const mapText = /from \(values([\s\S]*?)\) as m\(project_id, tenant_id, name, repo, install_status, production_freeze, open_phases\)/.exec(tb);
  const preSeedText = /seed\(id, tenant, name, repo, install_status, production_freeze, open_phases\) as \(values([\s\S]*?)\n\),\nowner_account/.exec(pre);
  const mapRows = mapText ? seedRows(mapText[1] + "\n") : [];
  const preRows = preSeedText ? seedRows(preSeedText[1] + "\n") : [];
  const contentPins = [" where p.id = m.project_id\n", ...["name", "repo", "install_status", "production_freeze", "open_phases"].map((c) => `   and p.${c} = m.${c}\n`)];
  if (!sameSet(mapRows.map((r) => r.split("|")[0]), MAP) || mapRows.some((r) => r.split("|")[1] !== "owner-personal") ||
      !sameSet(mapRows, preRows) || !contentPins.every((p) => tb.includes(p))) {
    E("TR-5", "the backfill map is not exactly the twelve audited rows in owner-personal, compared by content, and equal to the preflight's");
  }

  // TR-6: an unmapped row raises.
  if (!/if unmapped is not null then\s+raise exception 'TENANT_BACKFILL_UNMAPPED: no tenant for projects: %', unmapped;/.test(tb) ||
      !tb.includes("select string_agg(id, ', ' order by id) into unmapped from public.projects where tenant_id is null;")) {
    E("TR-6", "a row the map does not name no longer stops the migration");
  }

  // TR-7: tenant_id is required and has no default.
  if (!tb.includes("alter table public.projects add column if not exists tenant_id text;") ||
      !tb.includes("alter table public.phases add column if not exists tenant_id text;") ||
      (tb.match(/alter column tenant_id drop default,\s*alter column tenant_id set not null;/g) || []).length !== 2 ||
      /tenant_id\s+text[^;\n]*\bdefault\b/.test(tb)) {
    E("TR-7", "tenant_id must be not null with no default on both tables");
  }

  // TR-8: keys are per tenant, the foreign key is composite, and the helper path has its index.
  if (!["add constraint projects_pkey primary key (tenant_id, id)", "add constraint phases_pkey primary key (tenant_id, id)",
    "add constraint phases_tenant_project_phase_key unique (tenant_id, project_id, phase_id)",
    "create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id)"].every((p) => tb.includes(p)) ||
      !/add constraint phases_tenant_project_fkey foreign key \(tenant_id, project_id\)\s+references public\.projects\(tenant_id, id\) on delete cascade/.test(tb)) {
    E("TR-8", "a key is no longer per tenant, or the composite foreign key is gone");
  }
  const keyGuardAt = tb.search(/= k\.condef\) = 5 then\s+return;\s+end if;/);
  const firstKeyDrop = tb.indexOf("drop constraint if exists phases_project_id_fkey");
  if (keyGuardAt < 0 || firstKeyDrop < keyGuardAt) E("TR-8", "matching keys are no longer left alone, so a re-run is not a no-op");

  // TR-9: all four tables are revoked from all three client contexts.
  if (!/revoke all on table public\.projects, public\.phases, public\.tenants, public\.tenant_members\s+from public, anon, authenticated;/.test(tb)) {
    E("TR-9", "the revoke no longer covers all four tables from public, anon and authenticated");
  }

  // TR-10: the table grants are exactly the approved set.
  const grants = statements(tb, /^grant\b[\s\S]*?;/gim);
  const tableGrants = grants.filter((g) => /\bon table\b/.test(g));
  if (!sameSet(tableGrants, TABLE_GRANTS)) E("TR-10", `table grants differ from the approved set: ${tableGrants.join(" | ")}`);

  // TR-11: each policy is exactly the approved text.
  const policies = statements(tb, /create\s+policy[\s\S]*?;/gi);
  if (!sameSet(policies, POLICIES)) E("TR-11", "the policies differ from the approved text");

  // TR-12: every policy names authenticated.
  if (policies.some((p) => !/\bfor (select|insert|update|delete) to authenticated\b/.test(p))) E("TR-12", "a policy is not `to authenticated`");

  // TR-13: every old permissive policy is dropped by name.
  const missingDrops = OLD_POLICIES.filter((p) => !tb.includes(`drop policy if exists ${p};`));
  if (missingDrops.length > 0) E("TR-13", `old policies left in place: ${missingDrops.join(", ")}`);

  // TR-14: tenant_members has one read policy, its own rows, and it never calls a helper, so no recursion.
  const memberPolicies = policies.filter((p) => /on public\.tenant_members\b/.test(p));
  if (memberPolicies.length !== 1 || !memberPolicies[0].includes("for select to authenticated using (user_id = (select auth.uid()))") ||
      /private\./.test(memberPolicies[0])) {
    E("TR-14", "tenant_members must have one own-rows read policy that calls no helper, and no client write path");
  }

  // TR-15: helpers: stable, invoker, empty search_path, no argument.
  for (const name of ["my_tenant_ids", "my_owned_tenant_ids"]) {
    const shape = new RegExp(String.raw`create or replace function private\.${name}\(\)\s+returns setof text\s+language sql\s+stable\s+security invoker\s+set search_path = ''`);
    if (!shape.test(tb)) E("TR-15", `private.${name} must be stable, security invoker, search_path empty, with no argument`);
  }
  if (helperBodies(tb).my_tenant_ids !== HELPER_BODIES.my_tenant_ids || helperBodies(tb).my_owned_tenant_ids !== HELPER_BODIES.my_owned_tenant_ids) {
    E("TR-15", "a helper body differs: each must answer for the caller alone, and the owned helper for the role in that tenant");
  }

  // TR-16: private is authenticated's alone.
  const privateGrants = grants.filter((g) => !/\bon table\b/.test(g));
  if (!sameSet(privateGrants, PRIVATE_GRANTS) ||
      !tb.includes("revoke all on schema private from public, anon, authenticated, service_role;") ||
      !tb.includes("revoke all on function private.my_tenant_ids() from public, anon, service_role;") ||
      !tb.includes("revoke all on function private.my_owned_tenant_ids() from public, anon, service_role;")) {
    E("TR-16", "the private schema or a helper is reachable by more than authenticated");
  }

  // TR-17: the migration adds nothing callable to public.
  if (/create\s+(or\s+replace\s+)?function\s+public\./i.test(tb)) E("TR-17", "0002 adds a function in public, which the default privileges would expose");

  // TR-18: realtime is judged from the catalogue, so it tolerates a table being in or out and no publication.
  if (!/select tablename from pg_catalog\.pg_publication_tables[\s\S]*?and tablename in \('projects', 'phases', 'tenants', 'tenant_members'\)/.test(tb) ||
      !tb.includes("pg_catalog.format('alter publication supabase_realtime drop table public.%I', member)") ||
      /^\s*alter publication/im.test(tb)) {
    E("TR-18", "the realtime step must drop whichever of the four tables are published, and assume nothing");
  }

  // TR-19: the migration bytes hold no personal identifier.
  if ([BASE_REL, TB_REL].some((rel) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w.+-]+@[\w-]+\.\w+/i.test(raw[rel]))) {
    E("TR-19", "a user id or an email is in the migration bytes");
  }

  // TR-20: the retired files hold no SQL at all, and say where it went.
  for (const rel of [SCHEMA_REL, INTERACTIVE_REL]) {
    if (stripSql(raw[rel]).trim() !== "") E("TR-20", `${rel} is retired and must hold no SQL`);
    if (!raw[rel].includes("migrations/") || !raw[rel].includes("RETIRED")) E("TR-20", `${rel} must say it is retired and point at migrations/`);
  }

  // TR-21: the preflight is one read-only SELECT.
  const preBare = withoutStrings(pre);
  const statementsInPre = preBare.split(";").filter((s) => s.trim() !== "");
  if (statementsInPre.length !== 1 || !/^\s*with\b/i.test(preBare) ||
      /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|merge|copy|call|do|vacuum|reindex|comment|lock|set)\b/i.test(preBare)) {
    E("TR-21", "the live preflight must be a single read-only SELECT");
  }

  // TR-22: grants come from raw ACLs. information_schema came back empty to the live read-only role.
  if (/information_schema/i.test(pre) || !/aclexplode\(coalesce\(t\.relacl, acldefault\('r', t\.relowner\)\)\)/.test(pre) ||
      !pre.includes("aclexplode(c.attacl)") || !pre.includes("pg_default_acl")) {
    E("TR-22", "the live preflight must read raw ACLs, never information_schema");
  }

  // TR-23: the preflight covers the delta's list, with the same map as the migration, and the verdict is real.
  const seedText = /seed\(id, tenant, name, repo, install_status, production_freeze, open_phases\) as \(values([\s\S]*?)\n\),\nowner_account/.exec(pre);
  const seedIds = seedText ? [...seedText[1].matchAll(/^\s*\('([^']+)',\s*'owner-personal'/gm)].map((m) => m[1]) : [];
  if (!PREFLIGHT_ITEMS.every((i) => pre.includes(`'${i}'`)) || !sameSet(seedIds, MAP) || !pre.includes(`'${OWNER_ACCOUNT}'`) ||
      !pre.includes("bool_and(ok) as ok") || !pre.includes("'PREFLIGHT'") ||
      !/'public schema: '[\s\S]*?where n\.nspname = 'public'\s+group by a\.grantee/.test(pre)) {
    E("TR-23", "the live preflight no longer covers the delta's list, its map differs from the migration's, or its verdict is not computed");
  }

  // TR-24: the membership step: both tenants, as owner, in one transaction, no email.
  if (!/^begin;\s*$/m.test(own) || !/^commit;\s*$/m.test(own) || /[\w.+-]+@[\w-]+\.\w+/.test(raw[MEMBERSHIP_REL]) ||
      !own.includes(`('owner-personal',  '${OWNER_ACCOUNT}', 'owner')`) || !own.includes(`('agency-business', '${OWNER_ACCOUNT}', 'owner')`) ||
      !own.includes("OWNER_MEMBERSHIP_CHECK_FAILED")) {
    E("TR-24", "live-owner-membership.sql must add this account as owner of both tenants, transactionally, with no email");
  }

  // TR-25: the gate judges effective privileges, over all of public and private, policies included.
  const anonAllowed = /allowed_table\(rolname, nspname, relname, priv\) as \(values[\s\S]*?\n\),/.exec(gateSql);
  if (/information_schema/i.test(gateSql) ||
      !["where n.nspname in ('public', 'private') and c.relkind", "where n.nspname in ('public', 'private')\n),\nallowed_table",
        "has_table_privilege(r.rolname, t.oid, p.priv)\n     and not exists", "has_column_privilege(r.rolname, c.oid, c.attnum, p.priv)", "has_function_privilege(r.rolname, f.oid, 'EXECUTE')",
        "has_schema_privilege(r.rolname, n.oid, p.priv)", "'NOT_TO_AUTHENTICATED'", "'ALWAYS_TRUE'", "'NOT_APPROVED'", "'EXPRESSION_DIFFERS'", "'COMMAND_DIFFERS'", "   where p.polcmd::text <> a.polcmd\n", "select t.relname, t.relname || ' member read', 'r', m.expr, null", "'RLS_DISABLED'", "'PUBLISHED'", "'LOGIN'"].every((p) => gateSql.includes(p)) ||
      !anonAllowed || /'anon'/.test(anonAllowed[0])) {
    E("TR-25", "the privilege gate no longer judges effective privileges across public and private");
  }

  // TR-26: the dead read path and its silent fallback stay gone.
  if (/fetchProjects|PROJECTS|\bseed\b/.test(supa) || /from '\.\/projects'/.test(supa) || /fetchProjects/.test(boot)) {
    E("TR-26", "fetchProjects, or its silent seed fallback, is back");
  }

  // TR-27: comments are the point here, so these two scan raw text.
  // They must be true before and after the owner's apply, so neither may state what the database enforces today.
  const claimsApplied = /tenants the user belongs to|tenant-bound|row level security/i;
  if (/public read-only|static seed|public `projects`/.test(raw[SUPA_REL]) || /supabase\/schema\.sql/.test(raw[AUTH_REL]) ||
      claimsApplied.test(raw[SUPA_REL]) || claimsApplied.test(raw[AUTH_REL]) ||
      !raw[SUPA_REL].includes("supabase/migrations/") || !raw[AUTH_REL].includes("supabase/migrations/")) {
    E("TR-27", "a comment claims a public or seed-backed table, or states post-apply truth while live may not be applied");
  }

  // TR-28: the harness models production: both starts, twice, a non-superuser, the hazards, a clean exit.
  const shape = stripSql(raw[SHAPE_REL]);
  const live = stripSql(raw[LIVE_REL]);
  const harnessPins = [
    `{ label: "fresh start", db: "start_fresh", expectedSeed: 0 }`, `{ label: "live-shaped start", db: "start_live", expectedSeed: SEED_ROWS }`,
    `applyMigrations(st.db, st.label + ", pass 1");`, `applyMigrations(st.db, st.label + ", pass 2");`,
    `const a = sqlFile(db, "postgres", path.join(MIGRATIONS_DIR, m));`, `"-U", "supabase_admin"`, "-c listen_addresses=127.0.0.1",
    "POSTGRES_MISSING", "process.exitCode = 3;", "const dir = scratch.owned(SCRATCH_TAG);", "const failure = scratch.cleanup(dir);",
    // Auth: scram, a random password through a file and PGPASSWORD, never the command line or trust.
    `"--auth=scram-sha-256"`, `"--pwfile=" + pwfile`, "const password = crypto.randomBytes(24).toString(\"hex\");", "PGPASSWORD: password",
    // Environment: named variables only.
    "const env = minimalEnv(pg.dir);", `const PASSED_ENV = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "TEMP", "TMP", "TMPDIR"];`,
    // Lifecycle: stop is defined before the start, immediate, and a killed run is swept by exact prefix, owner gone.
    "const stopServer = () => {", `spawnSync(pgctl, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 60000, env });\n  };`,
    "result.swept = sweepStale(pgctl, env);", "const STALE_DIR = /^projectos-tenant-rls-pg-[A-Za-z0-9]{6}$/;", "return old || !isAlive(owner.pid);",
    // Binaries: live's major first, absolute paths, and a fallback that says so.
    `applyDefaults("pass 1");`, `applyDefaults("pass 2");`, "objectsBefore === OPEN_TO_CLIENTS, objectsBefore);",
    "const LIVE_MAJOR = 17;", "found.find((f) => f.major === LIVE_MAJOR) || found[0]", "if (path.isAbsolute(d)) dirs.push(d);",
    "const found = (explicit ? [explicit] : candidateDirs())", "note: `FALLBACK: running on PostgreSQL",
  ];
  const stopAt = harness.indexOf("const stopServer = () => {");
  const startAt = harness.indexOf(`"-w", "start"]`);
  if (stopAt < 0 || startAt < stopAt) E("TR-28", "stopServer must be defined before the server can start");
  if (/\.\.\.process\.env/.test(harness) || /"-A", "trust"|--auth=trust/.test(harness) || /spawnSync\("where"|spawnSync\(process\.platform === "win32" \? "where"/.test(harness) ||
      PASSED_ENV_TOKEN.test(/const PASSED_ENV = \[([^\]]*)\]/.exec(harness)?.[1] || "")) {
    E("TR-28", "the harness inherits the environment, trusts connections, or asks the shell where Postgres is");
  }
  const shapePins = ["create role postgres login nosuperuser createrole bypassrls;", "alter table auth.users owner to supabase_auth_admin;",
    "grant select on auth.users to postgres with grant option;", "grant references on auth.users to postgres;",
    "(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')",
    ...["postgres", "supabase_admin"].flatMap((role) => ["tables", "sequences", "functions"].map((k) => `alter default privileges for role ${role} in schema public\n  grant all on ${k} to postgres, anon, authenticated, service_role;`))];
  const livePolicies = ["projects authenticated read", "projects authenticated write", "phases authenticated all"].every((n) => live.includes(`"${n}"`));
  if (!harnessPins.every((p) => harness.includes(p)) || !/\} finally \{\s*stopServer\(\);/.test(harness) ||
      !shapePins.every((p) => shape.includes(p)) || !livePolicies || !live.includes("set role postgres;")) {
    E("TR-28", "the harness no longer models production, or no longer cleans up after itself");
  }

  // TR-29: the assertions keep their controls, match real errors, and finish.
  const assertSql = raw[ASSERT_REL];
  const fixtures = stripSql(raw[FIXTURES_REL]);
  if (!fixtures.includes("('owner-personal',  'ffffffff-0000-4000-8000-000000000001', 'owner')") ||
      !fixtures.includes("('agency-business', 'ffffffff-0000-4000-8000-000000000001', 'member')")) {
    E("TR-29", "the fixtures need a user who owns tenant A and is a plain member of tenant B");
  }
  const firstRefusal = assertSql.indexOf("'A-XREAD-projects'");
  const firstControl = assertSql.indexOf("'A-CTRL-A-projects'");
  if (!REQUIRED_ASSERTIONS.every((id) => assertSql.includes(`'${id}`)) || firstControl < 0 || firstControl > firstRefusal ||
      !assertSql.includes("perform rlstest._record(p_id, msg <> 'rlstest_no_error' and msg ilike p_like, msg);") ||
      !assertSql.includes("select 'COMPLETE';") || !assertSql.includes("select 'TOTAL|'")) {
    E("TR-29", "the assertions lost a named proof, a positive control, or the rule that a refusal must be the right refusal");
  }

  // TR-30: the suite runs this validator.
  for (const rel of [VA_REL, CR_REL]) if (!raw[rel].includes(`"${SELF}"`)) E("TR-30", `${SELF} is not registered in ${rel}`);

  // TR-31: the schema document says what the migrations say.
  const doc = raw[DOC_REL];
  const section1 = doc.slice(doc.indexOf("## 1. Relational"), doc.indexOf("## 2. Relational"));
  if (/\(`schema\.sql`\)|\(`interactive\.sql`\)|`using \(true\)`\.$/m.test(section1) || !section1.includes("0002_tenant_boundary.sql") ||
      !section1.includes("### `public.tenant_members`") || !section1.includes("**PK `(tenant_id, id)`**") ||
      !doc.includes("tenant RLS on public.tenants, tenant_members, projects, phases") || !section1.includes("**RLS:** enabled on all four") ||
      !section1.includes("fails with `permission denied`, by design") || !collapse(section1).includes("Do not fix that by granting `tenant_id`")) {
    E("TR-31", "docs/05_Schema.md no longer matches the migrations");
  }

  // TR-32: the role guard comes first, and names postgres alone.
  const guardAt = tb.search(/if current_user <> 'postgres' then\s+raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;/);
  if (guardAt < 0 || /\b(create|alter|insert|update|revoke|grant|drop)\b/i.test(tb.slice(0, guardAt))) {
    E("TR-32", "0002 must refuse to run as anyone but postgres, before it changes anything");
  }

  // TR-33: the post-apply check is one read-only SELECT over raw catalogues.
  const post = stripSql(raw[POSTAPPLY_REL]);
  const postBare = withoutStrings(post);
  if (postBare.split(";").filter((s) => s.trim() !== "").length !== 1 || !/^\s*with\b/i.test(postBare) || /information_schema/i.test(post) ||
      /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|merge|copy|call|do|vacuum|reindex|comment|lock|set)\b/i.test(postBare)) {
    E("TR-33", "the live post-apply check must be a single read-only SELECT that never reads information_schema");
  }

  // TR-34: its gate is the gate: the CTEs from client_roles to findings are byte-equal.
  const gateStart = gateSql.indexOf("with client_roles as (");
  const gateEnd = gateSql.indexOf("\nselect grantee, object_type, object, privilege from findings");
  const gateBody = gateStart < 0 || gateEnd < 0 ? null : gateSql.slice(gateStart, gateEnd);
  if (gateBody === null || !post.includes(gateBody)) E("TR-34", "live-postapply.sql and privilege-gate.sql have drifted apart");

  // TR-35: it answers the delta's live questions, lists what must be seen, and its verdict is computed.
  if (!POSTAPPLY_ITEMS.every((i) => post.includes(`'${i}'`)) || !post.includes("bool_and(ok) as ok") || !post.includes("'POSTAPPLY'") ||
      !post.includes("from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace") ||
      !/select 70, 'public schema'[\s\S]*?aclexplode\(coalesce\(n\.nspacl, acldefault\('n', n\.nspowner\)\)\)/.test(post) ||
      !/open_policy as \([\s\S]*?or p\.polcmd::text <> a\.polcmd/.test(post) ||
      !/open_policy as \([\s\S]*?pg_get_expr\(p\.polqual, p\.polrelid\) is distinct from a\.qual[\s\S]*?pg_get_expr\(p\.polwithcheck, p\.polrelid\) is distinct from a\.with_check/.test(post)) {
    E("TR-35", "the post-apply check no longer answers the live questions, or its verdict is not computed");
  }

  // TR-36: what ran on live stays what the repository says ran.
  for (const [rel, want] of Object.entries(LIVE_APPLIED)) {
    if (crypto.createHash("sha256").update(raw[rel], "utf8").digest("hex") !== want) E("TR-36", `${rel} is applied live and its bytes must not change`);
  }

  // TR-37: 0003 is one transaction, with the same lock timeout and role guard as 0002, guard first.
  const d3 = stripSql(raw[DEFAULTS_REL]);
  const d3Guard = d3.search(/if current_user <> 'postgres' then\s+raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;/);
  if ((d3.match(/^begin;\s*$/gm) || []).length !== 1 || (d3.match(/^commit;\s*$/gm) || []).length !== 1 || !/^\s*begin;/.test(d3) || !/commit;\s*$/.test(d3) ||
      !d3.includes("set local lock_timeout = '10s';") || d3Guard < 0 || /\balter\b/i.test(d3.slice(0, d3Guard))) {
    E("TR-37", "0003 must be one transaction with a lock timeout, refusing anyone but postgres before it changes anything");
  }

  // TR-38: 0003 is exactly these four statements. Nothing that exists is touched, and the PUBLIC revoke is global.
  const d3Statements = statements(d3, /alter\s+default\s+privileges[\s\S]*?;/gi);
  const d3Rest = withoutStrings(d3).replace(/alter\s+default\s+privileges[\s\S]*?;/gi, " ");
  if (!sameSet(d3Statements, DEFAULTS_STATEMENTS) || /\b(create|drop|truncate|insert|update|delete|grant|revoke|alter)\b/i.test(d3Rest)) {
    E("TR-38", "0003 must make exactly the approved default-privilege changes and touch nothing else");
  }

  // TR-39: 0003's check runs last, raises, and reads pg_default_acl for each thing it promises.
  if (!/if problems is not null then\s+raise exception 'TENANT_DEFAULT_PRIVILEGES_CHECK_FAILED: %'/.test(d3) || !/\$check\$;\s*commit;\s*$/.test(d3) ||
      !["from pg_catalog.pg_default_acl as d", "where e.nspname = 'public' or e.defaclnamespace = 0\n",
        "where not exists (select 1 from entries as e where e.kind = 'f' and e.defaclnamespace = 0)",
        "<> k.service_role_privileges", "('r', 'tables', 8), ('S', 'sequences', 3), ('f', 'functions', 1)"].every((p) => d3.includes(p))) {
    E("TR-39", "0003's in-transaction check no longer reads pg_default_acl, raises last, or judges what it promises");
  }

  // TR-40: the 0003 preflight is one read-only SELECT, with the real gate, and shows 0003 is absent.
  const pre3 = stripSql(raw[PREFLIGHT3_REL]);
  const pre3Bare = withoutStrings(pre3);
  if (pre3Bare.split(";").filter((s) => s.trim() !== "").length !== 1 || !/^\s*with\b/i.test(pre3Bare) || /information_schema/i.test(pre3) ||
      /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|merge|copy|call|do|vacuum|reindex|comment|lock|set)\b/i.test(pre3Bare) ||
      gateBody === null || !pre3.includes(gateBody) || !PREFLIGHT3_ITEMS.every((i) => pre3.includes(`'${i}'`)) ||
      !/open_policy as \([\s\S]*?or p\.polcmd::text <> a\.polcmd/.test(pre3) ||
      !pre3.includes("'anon and authenticated still hold the default on '") || !pre3.includes("bool_and(ok) as ok") || !pre3.includes("'PREFLIGHT'")) {
    E("TR-40", "the 0003 preflight must be a single read-only SELECT with the real gate, a computed verdict and proof 0003 is absent");
  }

  // TR-41: the post-apply check judges postgres's defaults in public and globally, and names the known limit.
  if (!post.includes("'known limit: objects made by supabase_admin in public stay exposed'") ||
      !post.includes("     and d.defaclnamespace in (0, (select oid from pg_namespace where nspname = 'public'))\n") ||
      !post.includes("     and d.defaclobjtype::text in ('r', 'S', 'f')\n") ||
      !/exists \(select 1 from postgres_defaults e where e\.kind = 'f' and e\.defaclnamespace = 0\)\s+and not exists \(select 1 from postgres_defaults e where e\.grantee = 0\)/.test(post)) {
    E("TR-41", "the post-apply check no longer judges postgres's defaults, or no longer names the supabase_admin limit");
  }

  // TR-42: the post-apply check holds the helper bodies byte for byte as 0002 created them, and compares them.
  const bodyLiteral = (name, body) => `('${name}', '${body.replace(/'/g, "''")}')`;
  if (!post.includes(bodyLiteral("my_tenant_ids", HELPER_BODIES.my_tenant_ids)) || !post.includes(bodyLiteral("my_owned_tenant_ids", HELPER_BODIES.my_owned_tenant_ids)) ||
      !post.includes("join pg_proc p on p.proname = h.proname and p.prosrc = h.body") || !post.includes("join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'private'),")) {
    E("TR-42", "the post-apply check no longer compares the helper bodies with what 0002 created");
  }

  // TR-43: auth.uid() is judged by what matters, because Supabase owns its spelling.
  const uidPins = ["select not prosecdef and provolatile = 's' and lanname = 'sql' and returns = 'uuid'",
    "and src like '%current_setting(''request.jwt.claim.sub'', true)%'", "and src like '%current_setting(''request.jwt.claims'', true)%'",
    "and src like '%->> ''sub''%'", "and src like '%::uuid%'", "and src !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}'", "and src !~* 'set_config'",
    "(length(src) - length(replace(src, 'current_setting(', ''))) / length('current_setting(') = 2",
    "and has_schema_privilege('authenticated', 'auth', 'USAGE')", "and has_function_privilege('authenticated', to_regprocedure('auth.uid()'), 'EXECUTE')"];
  if (!uidPins.every((p) => post.includes(p))) E("TR-43", "the post-apply check no longer judges auth.uid() and who can run it");

  // TR-44: the evidence records the Agency verdict, and why F5 stays carried.
  const evidence = raw[EVIDENCE_REL];
  if (/\| Agency `ai-generated-code-security-auditor` \| \*\*OPEN\*\*/.test(evidence) || /auditor`: OPEN/.test(evidence) ||
      !evidence.includes("| Agency `ai-generated-code-security-auditor` | APPROVE WITH CHANGES") || !evidence.includes("**F5, carried.**")) {
    E("TR-44", "the evidence must give the Agency verdict, not OPEN, and carry F5 with what bounds it");
  }
  return errors;
}

/** Every named text mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`TR-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`TR-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

// ---- the harness rules --------------------------------------------------------------------------------

function runHarness(env) {
  const harness = path.join(ROOT, ...HARNESS_REL.split("/"));
  const r = spawnSync(process.execPath, [harness], { encoding: "utf8", timeout: HARNESS_TIMEOUT_MS, maxBuffer: 1 << 26, env: { ...process.env, ...env } });
  const line = (r.stdout || "").split(/\r?\n/).find((l) => l.startsWith("HARNESS_RESULT "));
  let result = null;
  try {
    result = line ? JSON.parse(line.slice("HARNESS_RESULT ".length)) : null;
  } catch (_e) {
    result = null;
  }
  return { status: r.status, result, stderr: r.stderr || "", stdout: r.stdout || "" };
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

/** Runs the harness with its start broken: it must fail by name and leave no directory and no server. */
function failedStartEvidence() {
  const r = runHarness({ TENANT_RLS_TEST_SEAM: "fail-start" });
  if (r.status === 3) return null;
  const dir = r.result ? r.result.scratchDir : null;
  return {
    status: r.status,
    named: Boolean(r.result && String(r.result.error).includes("pg_ctl start failed")),
    dirGone: Boolean(dir) && !fs.existsSync(dir),
    serverLeft: Boolean(r.result && r.result.serverLeft),
  };
}

/** Kills a harness outright, as a validator timeout does. The next real run must clean up after it. */
function killedRun() {
  const r = runHarness({ TENANT_RLS_TEST_SEAM: "die-after-start" });
  if (r.status === 3) return null;
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("HARNESS_KILLED "));
  const left = line ? JSON.parse(line.slice("HARNESS_KILLED ".length)) : null;
  return { reported: left !== null, dir: left && left.dir, pid: left && left.pid, dirLeft: left !== null && fs.existsSync(left.dir), serverLeft: left !== null && isAlive(left.pid) };
}

/** TR-L1 and TR-L2: the lifecycle evidence, judged. Pure, so each rule can be shown to fire. */
function judgeLifecycle(failedStart, killed, afterSweep) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  if (failedStart !== null && (failedStart.status !== 1 || !failedStart.named || !failedStart.dirGone || failedStart.serverLeft)) {
    E("TR-L1", `a failed start must fail by name and leave nothing behind: ${JSON.stringify(failedStart)}`);
  }
  if (killed !== null && (!killed.reported || !killed.dirLeft || !killed.serverLeft)) {
    E("TR-L2", `the killed run did not really leave a server and a directory, so the sweep proves nothing: ${JSON.stringify(killed)}`);
  }
  if (killed !== null && afterSweep !== null && (afterSweep.dirLeft || afterSweep.serverLeft)) {
    E("TR-L2", `the next run did not clean up after a killed run: ${JSON.stringify(afterSweep)}`);
  }
  return errors;
}

/** TR-H4: the choice of binaries, as a pure function: live's major wins, and anything else says so. */
function pgChoiceProblems(choosePg) {
  const problems = [];
  const both = choosePg([{ dir: "a", major: 18 }, { dir: "b", major: LIVE_MAJOR }], false);
  if (!both || both.dir !== "b" || both.note !== null) problems.push("live's major was not preferred");
  const fallback = choosePg([{ dir: "a", major: 18 }], false);
  if (!fallback || fallback.dir !== "a" || !/FALLBACK/.test(String(fallback.note))) problems.push("a fallback was silent");
  if (choosePg([], false) !== null) problems.push("no binaries must mean no choice");
  return problems;
}

/** Judges what the harness reported, against what this file requires. Returns `[rule, message]` pairs. */
function judge(status, result, stderr) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  if (status === 3 || (result && result.error === "POSTGRES_MISSING")) {
    E("TR-PG", "POSTGRES_MISSING: the harness could not run, so nothing was proved. Install PostgreSQL or set TENANT_RLS_PG_BIN");
    return errors;
  }
  if (!result) {
    E("TR-H1", `the harness produced no result (exit ${status}). ${String(stderr).slice(0, 400)}`);
    return errors;
  }
  // TR-H1: it ran, ended clean, and left nothing behind.
  const failedChecks = (result.checks || []).filter((c) => !c.ok).map((c) => c.label);
  if (status !== 0 || result.ok !== true || failedChecks.length > 0 || result.error || result.scratchLeft || result.serverLeft) {
    E("TR-H1", `the harness failed (exit ${status}): ${failedChecks.slice(0, 8).join("; ") || result.error || result.scratchLeft || result.serverLeft || "no detail"}`);
  }
  // TR-H4: the version is known, and a run that is not on live's major version says so.
  if (!/^\d+\./.test(String(result.pgVersion)) || result.pgMajor !== Number(String(result.pgVersion).split(".")[0]) ||
      (result.pgMajor !== LIVE_MAJOR && !/FALLBACK/.test(String(result.pgNote)))) {
    E("TR-H4", `the Postgres version is unknown, or a run on ${result.pgMajor} did not say it fell back from ${LIVE_MAJOR}`);
  }
  // TR-H5: the server itself: scram on every rule, no passwordless login, no inherited token.
  for (const label of ["every pg_hba rule is scram-sha-256", "a connection with no password is refused", "the server's environment holds no inherited token"]) {
    if (!(result.checks || []).some((c) => c.ok && c.label === label)) E("TR-H5", `not shown: ${label}`);
  }
  // TR-H2: both starts, twice, with every assertion run and passing, and a clean gate.
  const starts = result.starts || [];
  for (const label of ["fresh start", "live-shaped start"]) {
    const s = starts.find((x) => x.label === label);
    if (!s || !s.complete || s.failed.length > 0 || s.gate.length > 0 || s.total < MIN_ASSERTIONS) {
      E("TR-H2", `${label}: assertions did not all run and pass with a clean gate`);
    }
    for (const pass of ["pass 1", "pass 2"]) {
      const applied = (result.checks || []).some((c) => c.ok && c.label === `${label}, ${pass}: apply 0002_tenant_boundary.sql as non-superuser postgres`);
      if (!applied) E("TR-H2", `${label}: 0002 was not applied on ${pass}`);
    }
    if (!(result.checks || []).some((c) => c.ok && c.label === `${label}: the second apply changed nothing in the catalogue`)) {
      E("TR-H2", `${label}: the second apply was not shown to change nothing`);
    }
    if (!(result.checks || []).some((c) => c.ok && c.label === `${label}: re-running the retired SQL recreated no policy and changed nothing`)) {
      E("TR-H2", `${label}: the retired SQL was not shown to recreate nothing`);
    }
    if (!(result.checks || []).some((c) => c.ok && c.label === `${label}: through authenticator, a member sees their tenant and not the other`)) {
      E("TR-H2", `${label}: the boundary was not shown through the authenticator login`);
    }
    if (!(result.checks || []).some((c) => c.ok && c.label === `${label}: the second apply did not re-create a single key`)) {
      E("TR-H2", `${label}: the second apply was not shown to leave its keys alone`);
    }
    if (!(result.checks || []).some((c) => c.ok && c.label === `${label}: the read-only post-apply check passes`)) {
      E("TR-H2", `${label}: the read-only post-apply check was not shown to pass`);
    }
    // TR-H6: 0003 on this start: applied twice, the control open before and shut after, and nothing else moved.
    const shown = [`${label}, pass 1: apply 0003_default_privileges.sql as non-superuser postgres`,
      `${label}, pass 2: apply 0003_default_privileges.sql as non-superuser postgres`,
      `${label}: the second apply of 0003 changed nothing in the catalogue`,
      `${label}: before 0003 the post-apply check fails on its two default rows and nothing else`,
      `${label}: 0003 changed nothing that already existed`,
      `${label}: service_role's defaults are unchanged`,
      `${label}: supabase_admin's defaults are unchanged`,
      `${label}: known limit: a table made by supabase_admin stays exposed after 0003`,
      `${label}: the post-apply check lists supabase_admin's defaults as a known limit`,
      `${label}: re-running all three migrations after 0003 changed nothing`];
    for (const name of shown) if (!(result.checks || []).some((c) => c.ok && c.label === name)) E("TR-H6", `not shown: ${name}`);
    const control = (result.defaultAcl || []).find((d) => d.label === label);
    if (!control || control.objectsBefore !== OPEN_TO_CLIENTS) E("TR-H6", `${label}: the positive control did not show new objects open before 0003`);
    if (!control || control.objectsAfter !== CLOSED_TO_CLIENTS) E("TR-H6", `${label}: new objects are not closed to clients, with service_role kept, after 0003`);
  }
  // TR-D:<name>: each database mutation tripped the rule named for it, and every assertion still ran.
  const clean = starts[0] ? starts[0].total : 0;
  for (const proof of DB_PROOFS) {
    const rule = `TR-D:${proof.name}`;
    const outcome = (result.mutations || []).find((m) => m.name === proof.name);
    if (!outcome || !outcome.complete || outcome.total !== clean) {
      E(rule, `mutation ${proof.name} did not run to the end`);
      continue;
    }
    const missing = (proof.failed || []).filter((id) => !outcome.failed.includes(id));
    if (missing.length > 0) E(rule, `mutation ${proof.name} survived its rule: ${missing.join(", ")} did not fail`);
    if (proof.gate && !outcome.gate.some((l) => proof.gate.test(l))) E(rule, `mutation ${proof.name} survived the gate: no finding matched ${proof.gate}`);
  }
  const known = new Set(DB_PROOFS.map((p) => p.name));
  for (const m of result.mutations || []) if (!known.has(m.name)) E("TR-H3", `the harness ran a mutation with no named rule here: ${m.name}`);
  // TR-S:<name>: the migration's own check refused the changed text and the database was left as it was.
  for (const name of SOURCE_PROOFS) {
    const s = (result.sourceMutations || []).find((m) => m.name === name);
    if (!s || !s.refused || !s.raised || !s.rolledBack) E(`TR-S:${name}`, `${name} was not refused by the migration and rolled back`);
  }
  const realtime = (result.sourceMutations || []).find((m) => m.name === "realtime-member");
  if (!realtime || realtime.tablesLeft !== 0) E("TR-S:realtime-member", "tables already in supabase_realtime were not taken out");
  const dependent = (result.sourceMutations || []).find((m) => m.name === "rerun-with-dependent-key");
  if (!dependent || dependent.refused || !dependent.keysKept) E("TR-S:rerun-with-dependent-key", "a re-run failed, or re-created its keys, after a later object came to depend on one");
  // TR-P:<name>: the preflight passes on the live shape and refuses each deviation by the right check.
  const shaped = (result.preflight || []).find((p) => p.name === "pf-live-shaped-start");
  if (!shaped || !shaped.passed) E("TR-P:pf-live-shaped-start", "the preflight did not pass on the live-shaped start");
  for (const [name, item] of Object.entries(PREFLIGHT_PROOFS)) {
    const p = (result.preflight || []).find((x) => x.name === name);
    if (!p || !p.ran || p.passed || !p.failed.includes(item)) E(`TR-P:${name}`, `the preflight did not refuse ${name} by "${item}"`);
  }
  // TR-P3:<name>: the 0003 preflight passes from the state after 0002 and refuses each deviation by the right check.
  for (const name of ["pf3-clean-start_fresh", "pf3-clean-start_live"]) {
    const p = (result.preflight0003 || []).find((x) => x.name === name);
    if (!p || !p.ran || !p.passed) E(`TR-P3:${name}`, `the 0003 preflight did not pass on ${name}`);
  }
  for (const [name, item] of Object.entries(PREFLIGHT3_PROOFS)) {
    const p = (result.preflight0003 || []).find((x) => x.name === name);
    if (!p || !p.ran || p.passed || !p.failed.includes(item)) E(`TR-P3:${name}`, `the 0003 preflight did not refuse ${name} by "${item}"`);
  }
  // TR-PA:<name>: the post-apply check passes on both migrated starts and refuses each deviation by the right check.
  for (const name of ["pa-clean-start_fresh", "pa-clean-start_live"]) {
    const p = (result.postapply || []).find((x) => x.name === name);
    if (!p || !p.ran || !p.passed) E(`TR-PA:${name}`, `the post-apply check did not pass on ${name}`);
  }
  const unapplied = (result.postapply || []).find((x) => x.name === "pa-before-apply");
  if (!unapplied || !unapplied.ran || unapplied.passed) E("TR-PA:pa-before-apply", "the post-apply check did not refuse a database that was never migrated");
  for (const [name, item] of Object.entries(POSTAPPLY_PROOFS)) {
    const p = (result.postapply || []).find((x) => x.name === name);
    if (!p || !p.ran || p.passed || !p.failed.includes(item)) E(`TR-PA:${name}`, `the post-apply check did not refuse ${name} by "${item}"`);
  }
  return errors;
}

/** Each harness rule must fire when its own evidence is gone, so a harness that stops proving is noticed. */
function judgeSelfTest(result) {
  const errors = [];
  const fires = (status, doctored, rule, what) => {
    if (!judge(status, doctored, "").some(([r]) => r === rule)) errors.push(`TR-M: ${what} survived; ${rule} did not fire`);
  };
  const clone = () => JSON.parse(JSON.stringify(result));
  for (const proof of DB_PROOFS) {
    const survived = clone();
    const target = survived.mutations.find((m) => m.name === proof.name);
    if (!target) continue;
    target.failed = [];
    target.gate = [];
    fires(0, survived, `TR-D:${proof.name}`, `a surviving ${proof.name}`);
    const wrongReason = clone();
    const other = wrongReason.mutations.find((m) => m.name === proof.name);
    other.failed = ["A-SOME-OTHER-RULE"];
    other.gate = ["nobody|other|other|OTHER"];
    fires(0, wrongReason, `TR-D:${proof.name}`, `${proof.name} failing for the wrong reason`);
  }
  for (const name of SOURCE_PROOFS) {
    const notRolledBack = clone();
    const target = notRolledBack.sourceMutations.find((m) => m.name === name);
    if (!target) continue;
    target.rolledBack = false;
    fires(0, notRolledBack, `TR-S:${name}`, `${name} not rolled back`);
  }
  for (const name of Object.keys(PREFLIGHT_PROOFS)) {
    const passed = clone();
    const target = passed.preflight.find((p) => p.name === name);
    if (!target) continue;
    target.passed = true;
    fires(0, passed, `TR-P:${name}`, `the preflight passing ${name}`);
  }
  for (const name of Object.keys(POSTAPPLY_PROOFS)) {
    const passed = clone();
    const target = passed.postapply.find((p) => p.name === name);
    if (!target) continue;
    target.passed = true;
    fires(0, passed, `TR-PA:${name}`, `the post-apply check passing ${name}`);
  }
  for (const name of Object.keys(PREFLIGHT3_PROOFS)) {
    const passed = clone();
    const target = passed.preflight0003.find((p) => p.name === name);
    if (!target) continue;
    target.passed = true;
    fires(0, passed, `TR-P3:${name}`, `the 0003 preflight passing ${name}`);
  }
  for (const field of ["objectsBefore", "objectsAfter"]) {
    const uncontrolled = clone();
    uncontrolled.defaultAcl[0][field] = "anon|f|f|f";
    fires(0, uncontrolled, "TR-H6", `a run whose ${field} differ`);
  }
  const unnamedFallback = clone();
  unnamedFallback.pgMajor = 18;
  unnamedFallback.pgVersion = "18.4";
  unnamedFallback.pgNote = null;
  fires(0, unnamedFallback, "TR-H4", "a silent fallback to 18");
  const trusting = clone();
  trusting.checks = trusting.checks.filter((c) => c.label !== "every pg_hba rule is scram-sha-256");
  fires(0, trusting, "TR-H5", "a run that never showed scram");
  const dependent = clone();
  dependent.sourceMutations.find((m) => m.name === "rerun-with-dependent-key").keysKept = false;
  fires(0, dependent, "TR-S:rerun-with-dependent-key", "keys re-created on a re-run");
  const noLive = clone();
  noLive.starts = noLive.starts.filter((s) => s.label !== "live-shaped start");
  fires(0, noLive, "TR-H2", "a run with no live-shaped start");
  const onePass = clone();
  onePass.checks = onePass.checks.filter((c) => !c.label.includes(", pass 2:"));
  fires(0, onePass, "TR-H2", "a run with one apply");
  fires(1, clone(), "TR-H1", "a failing exit status");
  fires(3, { error: "POSTGRES_MISSING" }, "TR-PG", "a missing Postgres read as a pass");
  fires(0, null, "TR-H1", "no result read as a pass");
  return errors;
}

function run() {
  const raw = {};
  for (const rel of SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length > 0) return errors;
  errors.push(...selfTest(raw));

  // Postgres missing is a named failure, proved by actually running the harness with none.
  const absent = runHarness({ TENANT_RLS_PG_BIN: path.join(ROOT, "no-such-postgres-bin") });
  if (absent.status !== 3 || !absent.result || absent.result.error !== "POSTGRES_MISSING") {
    errors.push(`TR-PG: with no Postgres the harness must exit 3 and name POSTGRES_MISSING (exit ${absent.status})`);
  }

  errors.push(...pgChoiceProblems(require(path.join(ROOT, ...HARNESS_REL.split("/"))).choosePg).map((p) => `TR-H4: ${p}`));

  // A failed start, then a run killed the way a validator timeout kills it, then the real run, which must
  // clean up after the killed one. With no Postgres the first two have nothing to prove; TR-PG says so.
  const failedStart = failedStartEvidence();
  const killed = killedRun();
  const real = runHarness({});
  const afterSweep = killed === null || !killed.reported ? null : { dirLeft: fs.existsSync(killed.dir), serverLeft: isAlive(killed.pid) };
  errors.push(...judgeLifecycle(failedStart, killed, afterSweep).map(([, msg]) => msg));
  errors.push(...judge(real.status, real.result, real.stderr).map(([, msg]) => msg));
  // The judge is only tested against a run that passed; a failed run has already said why.
  if (real.status === 0 && real.result) {
    errors.push(...judgeSelfTest(real.result));
    const good = { failed: { status: 1, named: true, dirGone: true, serverLeft: false }, killed: { reported: true, dirLeft: true, serverLeft: true } };
    const fires = (args, rule, what) => {
      if (!judgeLifecycle(...args).some(([r]) => r === rule)) errors.push(`TR-M: ${what} survived; ${rule} did not fire`);
    };
    fires([{ ...good.failed, dirGone: false }, null, null], "TR-L1", "a failed start that left its directory");
    fires([{ ...good.failed, serverLeft: true }, null, null], "TR-L1", "a failed start that left a server");
    fires([{ ...good.failed, status: 0 }, null, null], "TR-L1", "a failed start reported as a pass");
    fires([null, { ...good.killed, serverLeft: false }, null], "TR-L2", "a killed run that left no server to sweep");
    fires([null, good.killed, { dirLeft: true, serverLeft: false }], "TR-L2", "a sweep that left the directory");
    fires([null, good.killed, { dirLeft: false, serverLeft: true }], "TR-L2", "a sweep that left the server");
  }
  lastRun = real.result;
  return errors;
}

let lastRun = null;

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error(`${SELF}: ${e.length} error(s)`);
    process.exitCode = 1;
  } else {
    const r = lastRun;
    console.log(`${SELF}: PASS (${MUTATIONS.length} text mutations and ${DB_PROOFS.length} database mutations killed by their own rules, ` +
      `${SOURCE_PROOFS.length + 2} source scenarios, ${Object.keys(PREFLIGHT_PROOFS).length} preflight, ${Object.keys(PREFLIGHT3_PROOFS).length} 0003 preflight and ${Object.keys(POSTAPPLY_PROOFS).length + 1} post-apply refusals, ` +
      `failed start and killed run cleaned up, ${r.starts[0].total} assertions on 2 starts, PostgreSQL ${r.pgVersion}, ${r.ms} ms)`);
    if (r.pgNote) console.log(`${SELF}: ${r.pgNote}`);
  }
}

module.exports = { run, check, selfTest, judge, judgeSelfTest, judgeLifecycle, MUTATIONS, DB_PROOFS };

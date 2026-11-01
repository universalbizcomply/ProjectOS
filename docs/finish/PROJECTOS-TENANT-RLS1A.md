# PROJECTOS-TENANT-RLS1A — evidence

**Phase:** PROJECTOS-TENANT-RLS1A, phase 2 of V4 Stage 2, plan v1.28; `0003` added under plan v1.29.
**Branch:** `projectos-tenant-rls1a`, from `f2d2ec9`. First build `ed88661`, then one review round on top of it.
`0003` was built on `projectos-tenant-stack2`, where both Stage 2 phases are stacked.
**Route:** built by a Claude subagent in its own worktree, under the lead. This document claims no gatekeeper
ruling and no closure.
**Boundary:** the build was local only. The builder never connected to the live Supabase project, changed nothing in
production and used no credential. The live apply is the lead's, recorded under "Live apply". `projectos/watchdog/**` was copied from, not changed.

## Reviews

The lead ran the reviews and sent one consolidated list of 13 fixes. This document does not record which review
raised which item, because the builder did not receive the two reports separately.

| Review | Result | Disposition |
|---|---|---|
| ECC DATABASE | APPROVE WITH CHANGES, no CRITICAL or HIGH | All fixed, see the table below |
| ECC SECURITY | APPROVE WITH CHANGES, no CRITICAL or HIGH | All fixed, see the table below |
| Agency `ai-generated-code-security-auditor` | **OPEN** | It ran, but its report could not be delivered, because the guard blocks the wrapper's handback tool. **It does NOT count as completed and stays open.** |

The two ECC reviews reviewed `ed88661`. The fixes below have not themselves been reviewed.

| # | Fix | Proof it failed before and passes now |
|---|---|---|
| 1 | `0002` raises unless `current_user = 'postgres'`; the final check judges table, schema and helper ownership | `apply-as-superuser`, `src-no-role-guard`, TR-32, TR-4 |
| 2 | The backfill compares content as well as id | `rewritten-row`, TR-5 |
| 3 | Keys are left alone when they already match | `rerun-with-dependent-key`, "the second apply did not re-create a single key", TR-8 |
| 4 | `0001` has the same `lock_timeout` as `0002` | TR-2, `baseline-no-lock-timeout` |
| 5 | Policy expressions are compared exactly | `src-true-or-helper`, DB `true-or-helper`, TR-4 |
| 6 | scram-sha-256, random password via `--pwfile` and `PGPASSWORD`, minimal environment | TR-H5: every `pg_hba` rule is scram, a passwordless login is refused, and the server's real environment (read with `copy from program`) holds no canary and no token name |
| 7 | `stopServer` defined before the start, always `pg_ctl stop -m immediate`, stale directories swept | TR-L1 and TR-L2, below |
| 8 | PostgreSQL 17 preferred, version printed, absolute paths only, fallback stated | TR-H4, `pgChoiceProblems`, TR-28 |
| 9 | `test/live-postapply.sql` | TR-33 to TR-35, TR-PA rules, below |
| 10 | `live-preflight.sql` lists the `public` schema ACL and checks no client can create there | `pf-client-can-create`, TR-23 |
| 11 | A malformed `sub` fails closed on all four tables | `A-MALFORMED-SUB-*`, DB `malformed-sub-falls-open` |
| 12 | `05_Schema.md` explains why upserts of `tenant_id` or `id` are refused, and what to do instead | TR-31, `A-BOTH-UPSERT-ID`, DB `column-grant-id` |
| 13 | `auth.ts` comment is true before and after the apply. `supabase.ts` had the same defect, so it was fixed too | TR-27 |

**Before and after.** The new harness was run against the `ed88661` migrations, and 7 checks failed: the two
key re-creation checks, `src-true-or-helper`, `src-no-role-guard`, the rewritten row, the superuser apply and the
dependent key. With the environment inherited, the server-environment check failed. On the current bytes all pass.
The files were restored byte-equal afterwards. Items 4, 8, 10, 12 and 13 are text or tooling, so their proof is the
named mutation killed by its own rule.

## What changed

- **Migrations.** `0001_baseline.sql` records the live shape, with no policy and no seed. `0002_tenant_boundary.sql`
  refuses any role but `postgres`, then adds `tenants` and `tenant_members`, `tenant_id` from an explicit map of id
  and content, per-tenant keys, a composite foreign key, narrow grants, tenant policies and the `private` helpers.
  It takes all four tables out of realtime and ends with an in-transaction check.
- **Live tools, not run.** `test/live-preflight.sql` and `test/live-postapply.sql` are each one read-only SELECT.
  `test/live-owner-membership.sql` adds the owner as owner of both tenants, as a separate step after `0002`.
- **Harness.** `test/pg-harness.cjs` with a Supabase-shaped cluster, an `auth` stub, a non-superuser role really
  named `postgres`, the ported privilege gate, 123 assertions and named mutations.
- **Retired.** `schema.sql` and `interactive.sql` are a comment header and no SQL.
- **Control Center.** The dead `fetchProjects` and its silent seed fallback are gone, and the false comments in
  `src/data/supabase.ts` and `src/data/auth.ts` are corrected.
- **Validator.** `val-projectos-tenant-rls1a`, registered in `validate-all` and `cached-runner`.
- **Docs.** `docs/05_Schema.md`: section 1, the Control Center cloud lines of section 4, and the one line in the
  introduction that listed two tables. Section 3 is untouched.

## The exact bytes the owner's apply must use

| File | sha256 |
|---|---|
| `migrations/0001_baseline.sql` | `11fc5de040b5025beef5ce5068871709418604ad10be32d5eb4d8f656f42ef4a` |
| `migrations/0002_tenant_boundary.sql` | `7d1520b3ee2562be3fede900b83401bfed68141e102bf9bfa6000bdf84e3d4c6` |
| `migrations/0003_default_privileges.sql` | `094d74db53fff924bc65e2efb02112d7b101821270c438eb29559b6faa1617bf` |

`0001`, `0002` and `test/live-owner-membership.sql` are applied live, so rule TR-36 pins their sha256 and any change
fails the validator. `0003` is not applied yet: check its hash again at the apply.

## 0003: default privileges (owner decision D9, plan v1.29)

**What it does.** `0003_default_privileges.sql` makes a new table, sequence or function created by `postgres` in
`public` give `anon` and `authenticated` nothing. Same `lock_timeout` and `postgres` guard as `0002`, transactional,
forward-only and safe to re-run. It ends with a check that reads `pg_default_acl` and raises.

**Why PUBLIC EXECUTE uses the global form.** PUBLIC EXECUTE on a new function comes from the built-in global default,
and a per-schema entry can only add to a global one. So `0003` runs `alter default privileges for role postgres revoke
execute on functions from public` with no schema. The source mutation `src3-public-execute-per-schema` shows the
per-schema form leaves PUBLIC EXECUTE in place and is refused. The cost is that this reaches every schema: outside
`public`, a new `postgres` function is callable only by its owner until a migration grants it. `0002`'s helpers already
carry their own grants.

**Proof, from the state live is in, on both starts.** After `0001`, `0002` and the membership step:

| Check | Before `0003` | After, applied twice |
|---|---|---|
| New table, sequence, function for `anon`, `authenticated` | access | nothing |
| New function for PUBLIC | EXECUTE | nothing |
| New table, sequence, function for `service_role` | access | access |
| The four tables and everything else that exists | | catalogue byte-equal, grants included |
| `supabase_admin`'s default entries | | byte-equal |
| Post-apply check | fails on its two default rows and nothing else | passes |
| `test/live-preflight-0003.sql` | passes | refuses |

**Refusals.** 7 source mutations of `0003`, each refused by its own check with no default changed. `0003-as-superuser`
raises `TENANT_BOUNDARY_WRONG_ROLE`. Database mutations `default-acl-tables`, `-sequences`, `-functions`,
`-public-execute` and `-service-role-lost` each fail the `A-NEWOBJ-*` assertions named for them. The post-apply check
refuses each drift, and the 0003 preflight refuses 8 deviations.

**Known limit, carried: `supabase_admin`'s defaults.** Live has separate default entries for `supabase_admin` in
`public`, and `postgres` cannot alter them, so `0003` leaves them. A table made by `supabase_admin` in `public` stays
exposed; the harness proves this, before and after. The post-apply check lists those entries as a known limit, and if
such an object exists the gate reports it and the check fails. Migrations must therefore run as `postgres`, which the
guards enforce. `postgres`'s own entries for schema `storage` also stay as they are, because they are outside the
approved scope.

## Live apply

Run by the lead on 2026-11-01, on the owner's words "Yes, apply it now (Recommended)" (D8) and "Yes, lock by default
(Recommended)" (D9), through the Supabase Management API with a personal access token the owner supplied. The token was held
in an environment variable for each run and written to no file. Each script checked the sha256 of the SQL first, and stopped
at the first failure. The plan's write route was the plugin; the owner changed it to the token (D7).

**Before.** Sign-up was reported off and was found ON by both the admin API and the public settings endpoint. On the owner's
"Yes, switch it off (Recommended)" `disable_signup` was set to true; a before-and-after comparison showed it was the only field
changed. The read-only audit found one account (the owner's), 12 project rows equal to the seed and 0 phases.

| Step | Run as | Result |
|---|---|---|
| Sign-up off, re-read | admin API | `disable_signup: true` |
| `test/live-preflight.sql` | `supabase_read_only_user` on PostgreSQL 17.6 | PREFLIGHT all true, 20 checks, 0 failed |
| Export of both tables | `supabase_read_only_user` | 12 projects, 0 phases, kept outside the repo in the session scratchpad |
| `0001_baseline.sql` | `postgres` | HTTP 201 |
| `0002_tenant_boundary.sql` | `postgres` | HTTP 201; its in-transaction check passed |
| `test/live-owner-membership.sql` | `postgres` | HTTP 201; owner of both tenants |
| `test/live-postapply.sql` at that time | `supabase_read_only_user` | POSTAPPLY all true, 5 checks, 0 failed |
| `test/live-preflight-0003.sql` | `supabase_read_only_user` | PREFLIGHT all true, 16 checks, 0 failed |
| `0003_default_privileges.sql` | `postgres` | HTTP 201; its in-transaction check passed |
| `test/live-postapply.sql` final | `supabase_read_only_user` | POSTAPPLY all true, 7 checks, 0 failed |

**Proved from outside, after 0002.** These do not rest on the migration's own check.

| Who | Route | Result |
|---|---|---|
| anon, with the real public key | REST, all four tables | 401, code 42501, on each |
| The owner's account | `set local role authenticated` with their claims, in a read-only DO block ending in RAISE, so it cannot commit | 12 projects, 0 phases, 2 tenants, 2 memberships |
| A made-up account | Same block | 0 rows in all four tables |

The owner's line is the positive control: the refusals are the boundary and not an empty database. Rows after the probes: 12.
No policy on any public table is permissive, nothing in public is in `supabase_realtime`, and client roles hold no TRUNCATE.

**After 0003.** `postgres`'s defaults in public give anon and authenticated nothing, service_role keeps its defaults, and new
functions no longer default to PUBLIC EXECUTE. The four existing tables kept identical grants. ECC DATABASE proved the global
form cannot be narrowed: a per-schema revoke left anon able to execute a new function. New-object behaviour on live is
read from `pg_default_acl`; no object was created on live to demonstrate it. The behaviour itself is proved in the harness.

**Not proved live.** A real sign-in through the Control Center with the owner's password, and PostgREST behaviour for an
authenticated JWT. Nothing in the product reads these tables, so no screen was expected to change. The Management API's
handling of a failed transaction was never exercised, because no step failed.

**What the owner should know for later tables.** A new table made as `postgres` now answers "permission denied", not an
empty result, until a migration grants it, even when an RLS policy exists. A `serial` column also needs a sequence grant.
A function needs `grant execute`, and an auth hook needs a grant to `supabase_auth_admin`. Objects made by `supabase_admin`
are not covered.

## Commands and results

| Command | Result |
|---|---|
| `node projectos/validators/val-projectos-tenant-rls1a.cjs` | PASS on **PostgreSQL 17.10**, the default: 185 text and 40 database mutations killed by their own rules, 23 source scenarios, 12 preflight, 8 0003 preflight and 12 post-apply refusals, failed start and killed run cleaned up, 133 assertions on 2 starts |
| same, `TENANT_RLS_PG_BIN=<scoop bin>` | PASS on PostgreSQL 18.4, same counts, with the printed `FALLBACK` note |
| same, `TENANT_RLS_PG_BIN` pointing at nothing | FAIL, `TR-PG: POSTGRES_MISSING`. The harness alone exits 3 |
| `node projectos/control-center/supabase/test/pg-harness.cjs` | ALL PASS: 188 checks, about a minute |
| `validate-no-secrets`, `val-projectos-tenant-contract1a`, scratch lifecycle, speed cache: the other validators reading a touched file for `0003` | 4 PASS |
| `npm run typecheck`, `npx vitest run` in `projectos/control-center` | clean, 890 tests passed, at `ed88661` plus the review round. Not re-run for `0003`, which touches no control-center code |

Full `validate-all` was not run, by instruction: the lead runs it after stacking. One validator run takes about 60 to
70 s, because it also proves the lifecycle. It is not in `speed/input-map.cjs`, which is outside this phase's
writePaths, so the cache always runs it. That is the safe direction, but it costs that time on every sweep.

## PostgreSQL version gap

Live is **17.6**. The proof passes on **17.10**, the harness's default, and on **18.4**. The remaining gap is 17.10
against 17.6, a minor-version difference. The 17 binaries belong to the PostgreSQL service installed on this
machine. Only the binaries were used, for a separate throwaway cluster. The service itself was not touched.

Exact policy comparison depends on how Postgres prints an expression. The text matches on both 17.10 and 18.4. If 17.6
printed it differently, the apply would raise and roll back, which is safe but would block it.

## Exit proof, database list

Applied by a non-superuser `postgres` (`rolsuper=false`, `rolcreaterole=true`, `rolbypassrls=true`, as live), with
the superuser being `supabase_admin`, as on Supabase. Both starts apply twice. A catalogue fingerprint shows the second
apply changed nothing, and constraint oids show it re-created no key. The live-shaped start really holds the hazard:
the harness checks that anon holds `TRUNCATE`, that there are 12 rows and that the 3 permissive policies exist.

| Claim | Assertions (controls first) | Mutation that fails it |
|---|---|---|
| A member sees their rows, none of B's, all four tables | `A-CTRL-*`, `A-XREAD-*` | `using-true-projects`, `-phases`, `-tenants`, `-tenant-members`, `true-or-helper` |
| Update and delete of B's rows change nothing | `A-XWRITE-update-*`, `A-XWRITE-delete-*`, each paired with `A-XWRITE-CTRL-*`: B's owner, same statement, 1 row | `xwrite-projects-open`, `xwrite-phases-open` |
| Insert with B's `tenant_id` is refused | `A-XWRITE-insert-*`, real RLS error | `insert-check-true`, `xwrite-phases-open` |
| Stealing a B row is refused | `A-STEAL-*`, real permission error | `column-grant-tenant-id`, `table-update-grant` |
| A phase cannot point at B's project | `A-XFK-insert`, `A-BOTH-XFK`, real foreign key error | `composite-fk-dropped` |
| A non-owner member cannot write | `A-MEMBER-*`, with `A-OWNWRITE-*` and `A-MEMBER-SEES-THE-ROW` as controls | `write-update-using-true`, `write-delete-using-true`, `owner-helper-widened` |
| Clients cannot write `tenants` or `tenant_members`; nobody adds themselves | `A-NOWRITE-*`, `A-SELFADD-*`, `A-SELFPROMOTE` | `tenants-client-write`, `members-self-add`, `members-self-promote` |
| `TRUNCATE` is refused | `A-TRUNCATE-*`, 8 assertions | `truncate-granted` |
| A user who owns both tenants cannot change `tenant_id` or `id` | `A-BOTH-TENANT-*`, `A-BOTH-UPSERT-TENANT`, `A-BOTH-UPSERT-ID`, control `A-BOTH-WRITES-BOTH` | `column-grant-tenant-id`, `column-grant-id`, `table-update-grant` |
| `anon`, a non-member, null claims and a malformed `sub` read nothing | `A-ANON-*`, `A-NONMEMBER-*`, `A-NULLCLAIMS-*`, `A-NOSUBCLAIM-*`, `A-MALFORMED-SUB-*` | `anon-select-grant`, `uid-not-null-*`, `using-true-*`, `malformed-sub-falls-open` |
| The privilege gate reports nothing, on effective privileges | gate, zero rows, before and after the assertions | `to-public-policy`, `private-usage-anon`, `public-function-added`, and others |
| `0002` refuses a bad apply and rolls back | 10 source mutations, an unmapped row, a rewritten row and a superuser apply: the named reason raised, and no tenants table, no `private`, the 3 old policies, the rows as they were | `src-*`, `unmapped-row`, `rewritten-row`, `apply-as-superuser` |
| The retired SQL cannot recreate a permissive policy | both files re-run on both starts: catalogue byte-equal; validator: no SQL after stripping comments | `retired-policy-recreated`, text mutation `retired-policy-restored` |

**Through `authenticator` too.** The assertions switch role from a superuser session. Two extra checks log in as
`authenticator`, the way PostgREST connects, and show the same outcome.

### Harness lifecycle

Both are real runs, driven by the validator through a test seam.

- **Failed start (TR-L1).** A setting the server refuses makes `pg_ctl start` fail. The harness must exit 1 naming
  that failure, with its directory gone and no server left.
- **Killed run (TR-L2).** The harness starts a server and then kills itself with `SIGKILL`, which is
  TerminateProcess: no handler runs, as with a validator timeout. The validator confirms a live server and a
  directory were left. The next real run must stop that server and remove the directory.
- **The sweep is narrow.** It takes only names matching `projectos-tenant-rls-pg-` plus six characters, directly
  under TEMP. Each must hold this harness's owner marker, or a cluster older than an hour. A directory whose recorded
  owner is alive and younger than an hour is left alone, so a parallel run is safe.

### Post-apply check

`test/live-postapply.sql` is one SELECT, and the gate's body is byte-equal to `privilege-gate.sql` (TR-34). It passes on
both starts as `supabase_read_only_user` in a read-only session. It refuses a `true or <helper>` policy, a `to public`
policy, an anon grant, a new table with no row level security, a table in realtime, a client able to create in
`public`, and a database that was never migrated. It lists `pg_default_acl` and the `public` schema ACL.

### Findings the harness changed

- **The grant wall hides a `to public` policy.** Behaviour stays correct with it, so no assertion can catch it. The
  gate judges policy roles directly, and the validator requires the gate finding, not "something failed".
- **Cross-tenant update and delete have two walls.** The read policy alone refuses them, so opening the write policy
  does not fail those assertions. `xwrite-*-open` opens both, which is what shows they can fail. The write policy
  alone is proved by the member case, where the read policy lets the row through.
- **`TRUNCATE ... CASCADE` would have passed vacuously.** It also needs `TRUNCATE` on `phases`, so a mutation on
  `projects` alone would still have been refused. The assertions use no `CASCADE`.
- **A failed catalogue read compared equal to another failed read.** The replay check was vacuous for one run, and
  its own sanity check caught that. The fingerprint now throws on failure.

## Decisions a reviewer should challenge

1. **Helpers are `security invoker`.** The delta does not say which. `tenant_members` answers its own rows through a
   policy that calls no helper, so invoker works, cannot recurse and needs no definer rights.
2. **`service_role` keeps its Supabase defaults on all four tables, `TRUNCATE` included.** The delta revokes from
   `public`, `anon` and `authenticated` only, and ADR-T1 records the service-role bypass. It is treated as a server
   secret, not a client role. Nothing in the Control Center uses it.
3. **The preflight is stricter than the delta.** `phases` must still be empty, as audited, and no client may be able
   to create in `public`. A legitimate change to either stops the apply until it is looked at.
4. **`created_at` on `phases` has no client update grant,** which is narrower than the delta requires.
5. **The role guard names `postgres` alone.** If the live tool connects as any other role, the apply raises and
   rolls back. The lead's route must therefore run as `postgres`.

## Carried, not done

- **`supabase_admin`'s default privileges in `public` stay in place.** See the known limit under `0003`.
- **TR-21 is a deny-list tripwire.** It scans for write verbs. It is not a parser, and it cannot prove a SELECT is
  free of effects.
- **Management API transaction handling is unverified.** The lead sends each migration as its own call. An outer
  transaction would turn the inner `begin` into a warning, and the check would still run before the commit.
- **`MAINTAIN` needs PostgreSQL 17 or later.** Live has that.
- **Event triggers are not modelled.** `pgrst_ddl_watch` and its neighbours exist only on Supabase and run during the
  apply. The preflight lists them. If one fails, the transaction rolls back and nothing changes.
- **`src/data/projects.ts` is orphaned.** Its only importer was `fetchProjects`. Deleting it needs a writePath this
  phase does not have.
- **`docs/00_Baseline_State.md` §5.1** was corrected by the lead after the live apply, under CONTRACT1A's write path.
- **LOWs from the 0003 review, carried:** `live-preflight-0003.sql` does not mirror two of `0003`'s checks, so such a state
  stops at the migration's own check instead; no listing of functions `postgres` owns outside public; the `0003` comment on
  who can call a new function is loose about schemas with per-schema rows.
- **Agency `ai-generated-code-security-auditor`: OPEN.** It ran; its report could not be delivered because the Agency guard
  refuses the wrapper's handback tool. It does not count as a completed review until the report arrives.

## Not modelled, and what the owner's apply should expect

- **`supabase_read_only_user` is assumed able to read `auth.users`.** If it cannot, the preflight errors rather than
  passes.
- **Publication ownership.** On live no table is in `supabase_realtime`, so `0002` issues no `alter publication`. The
  preflight prints the owner.

## What this phase does not prove

Stated in the delta, and true here: **no product flow uses these tables yet**, so the boundary is exercised by the
harness alone. The live claims (sign-up disabled, no permissive policy, tables out of realtime, anon reads nothing) are
an owner step after the apply; `test/live-postapply.sql` covers all but sign-up. **Workers can still reach any tenant's
secrets and files** outside the kernel, as the owner's Windows user, and nothing here changes that.

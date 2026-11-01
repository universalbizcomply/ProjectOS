# PROJECTOS-TENANT-RLS1A — evidence

**Phase:** PROJECTOS-TENANT-RLS1A, phase 2 of V4 Stage 2, plan v1.28.
**Branch:** `projectos-tenant-rls1a`, from `f2d2ec9`.
**Route:** built by a Claude subagent in its own worktree, under the lead. This document claims no gatekeeper
ruling, no review and no closure. The reviews the plan requires (ECC DATABASE, ECC SECURITY, Agency
`ai-generated-code-security-auditor`) have not happened yet.
**Boundary:** local only. Nothing connected to the live Supabase project, nothing in production changed, and
no credential was used. `projectos/watchdog/**` was copied from, not changed.

## What changed

- **Migrations.** `0001_baseline.sql` records the live shape, with no policy and no seed. `0002_tenant_boundary.sql`
  adds `tenants` and `tenant_members`, then `tenant_id` from an explicit map, per-tenant keys, a composite
  foreign key, narrow grants, tenant policies and the `private` helpers. It takes all four tables out of realtime
  and ends with an in-transaction check.
- **Live tools, not run.** `test/live-preflight.sql` is one read-only SELECT. `test/live-owner-membership.sql` adds
  the owner as owner of both tenants, as a separate step after `0002`.
- **Harness.** `test/pg-harness.cjs` with a Supabase-shaped cluster, an `auth` stub, a non-superuser
  `postgres`, the ported privilege gate, 118 assertions and named mutations.
- **Retired.** `schema.sql` and `interactive.sql` are a comment header and no SQL.
- **Control Center.** The dead `fetchProjects` and its silent seed fallback are gone. The false "public read-only"
  comments are corrected in `src/data/supabase.ts` and `src/data/auth.ts`.
- **Validator.** `val-projectos-tenant-rls1a`, registered in `validate-all` and `cached-runner`.
- **Docs.** `docs/05_Schema.md`: section 1, the Control Center cloud lines of section 4, and the one line in the
  introduction that listed two tables. Section 3 is untouched.

## The exact bytes the owner's apply must use

| File | sha256 |
|---|---|
| `migrations/0001_baseline.sql` | `764782a3fdc55a310a1a420793782cc15839989f26c2609d5ee985fdf3f60b94` |
| `migrations/0002_tenant_boundary.sql` | `cd055eb3f1c6b9e2e0b9f03855c41b60e7cad21643af0de4c7c49b75b80dc3db` |

Check these again at the apply. A review fix changes them, and any change means proving them again first.

## Commands and results

| Command | Result |
|---|---|
| `node projectos/validators/val-projectos-tenant-rls1a.cjs` | PASS: 105 text mutations and 32 database mutations killed by their own rules, 9 source scenarios, 11 preflight refusals, 118 assertions on 2 starts, PostgreSQL 18.4 |
| same, `TENANT_RLS_PG_BIN="C:/Program Files/PostgreSQL/17/bin"` | PASS, same counts, **PostgreSQL 17.10** |
| same, `TENANT_RLS_PG_BIN` pointing at nothing | FAIL, exit 1, `TR-PG: POSTGRES_MISSING`. The harness alone exits 3 |
| `node projectos/control-center/supabase/test/pg-harness.cjs` | ALL PASS: 106 checks, 30 to 60 s |
| `npm run typecheck` in `projectos/control-center` | clean |
| `npx vitest run` in `projectos/control-center` | 66 files, 890 tests passed |
| Every validator that reads a touched file, 31 including this one and `validate-no-secrets` | 31 PASS |

Full `validate-all` was not run, by instruction: the lead runs it after stacking. Harness run time is 30 to 60 s,
and the validator adds under a second. It is not in `speed/input-map.cjs`, which is outside this phase's writePaths,
so the cache always runs it. That is the safe direction, but it costs that time on every sweep.

## PostgreSQL version gap

Live is **17.6**. The default local binary is scoop **18.4**. The machine also has PostgreSQL **17.10** installed
as a service, so its binaries were used to start a separate throwaway cluster. The service itself was not touched.
The proof passes on both 18.4 and 17.10. The remaining gap is 17.10 against 17.6, a minor-version difference. No
18-only feature is used. `has_table_privilege(..., 'MAINTAIN')` needs 17 or later, which live has.

## Exit proof, database list

Applied by a non-superuser `postgres` (`rolsuper=false`, `rolcreaterole=true`, `rolbypassrls=true`, as live), with
the superuser being `supabase_admin`, as on Supabase. Both starts apply twice, and a catalogue fingerprint shows
the second apply changed nothing. The live-shaped start really holds the hazard: the harness checks that anon holds
`TRUNCATE`, that there are 12 rows and that the 3 permissive policies exist.

| Claim | Assertions (controls first) | Mutation that fails it |
|---|---|---|
| A member sees their rows, none of B's, all four tables | `A-CTRL-*`, `A-XREAD-*` | `using-true-projects`, `-phases`, `-tenants`, `-tenant-members` |
| Update and delete of B's rows change nothing | `A-XWRITE-update-*`, `A-XWRITE-delete-*`, each paired with `A-XWRITE-CTRL-*`: B's owner, same statement, 1 row | `xwrite-projects-open`, `xwrite-phases-open` |
| Insert with B's `tenant_id` is refused | `A-XWRITE-insert-*`, real RLS error | `insert-check-true`, `xwrite-phases-open` |
| Stealing a B row is refused | `A-STEAL-*`, real permission error | `column-grant-tenant-id`, `table-update-grant` |
| A phase cannot point at B's project | `A-XFK-insert`, `A-BOTH-XFK`, real foreign key error | `composite-fk-dropped` |
| A non-owner member cannot write | `A-MEMBER-*`, with `A-OWNWRITE-*` and `A-MEMBER-SEES-THE-ROW` as controls | `write-update-using-true`, `write-delete-using-true`, `owner-helper-widened` |
| Clients cannot write `tenants` or `tenant_members`; nobody adds themselves | `A-NOWRITE-*`, `A-SELFADD-*`, `A-SELFPROMOTE` | `tenants-client-write`, `members-self-add`, `members-self-promote` |
| `TRUNCATE` is refused | `A-TRUNCATE-*`, 8 assertions | `truncate-granted` |
| A user who owns both tenants cannot change `tenant_id` | `A-BOTH-TENANT-*`, `A-BOTH-UPSERT-TENANT`, control `A-BOTH-WRITES-BOTH` | `column-grant-tenant-id`, `table-update-grant` |
| `anon`, a non-member and null claims read nothing | `A-ANON-*`, `A-NONMEMBER-*`, `A-NULLCLAIMS-*`, `A-NOSUBCLAIM-*` | `anon-select-grant`, `uid-not-null-*`, `using-true-*` |
| The privilege gate reports nothing, on effective privileges | gate, zero rows, before and after the assertions | `to-public-policy`, `private-usage-anon`, `public-function-added`, and others |
| `0002` refuses a bad apply and rolls back | 8 source mutations and the unmapped row: the named reason raised, and no tenants table, no `private`, the 3 old policies, the rows as they were | `src-*`, `unmapped-row` |
| The retired SQL cannot recreate a permissive policy | both files re-run on both starts: catalogue byte-equal; validator: no SQL after stripping comments | `retired-policy-recreated`, text mutation `retired-policy-restored` |

**Through `authenticator` too.** The assertions switch role from a superuser session. Two extra checks log in as
`authenticator`, the way PostgREST connects, and show the same outcome.

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
3. **The preflight is stricter than the delta in two ways.** Every row must be byte-equal to the seed, because sign-up
   was open and the delta's own review called out stranger-written rows. And `phases` must still be empty, as audited.
   A legitimate change to either stops the apply until it is looked at.
4. **`0002` re-creates its keys on every run** rather than branching. That is fewer paths, and fine at this table size.
5. **`created_at` on `phases` has no client update grant,** which is narrower than the delta requires.

## Carried, not done

- **Default privileges stay in place for future objects in `public`.** Changing them is out of the approved design,
  and it breaks no criterion: the gate reports any such object, and the harness proves that with `public-function-added`.
  But nothing stops the next migration exposing a new table or function unless it revokes for itself, and the gate
  runs in the harness, not on live.
- **`src/data/projects.ts` is now orphaned.** Its only importer was `fetchProjects`. Deleting it needs a writePath this
  phase does not have. The fix is one line in a later phase's writePaths, or the lead's stacking commit.
- **`docs/00_Baseline_State.md` §5.1 still describes the old risk.** It is outside writePaths, and stays true until
  the live apply.
- **Input map.** Add this validator to `speed/input-map.cjs` if that time becomes a problem.

## Not modelled, and what the owner's apply should expect

- **Supabase's event triggers** do not exist on the local cluster. `pgrst_ddl_watch` and its neighbours run during the
  apply. The preflight lists them. If one fails, the transaction rolls back and nothing changes.
- **A tool that wraps the script in its own transaction** turns the inner `begin` into a warning. The check still runs
  before the commit.
- **`supabase_read_only_user` is assumed able to read `auth.users`.** If it cannot, the preflight errors rather than
  passes.
- **Publication ownership.** On live no table is in `supabase_realtime`, so `0002` issues no `alter publication`. The
  preflight prints the owner.

## What this phase does not prove

Stated in the delta, and true here: **no product flow uses these tables yet**, so the boundary is exercised by the
harness alone. The live claims (sign-up disabled, no permissive policy, tables out of realtime, anon reads nothing) are
an owner step after the apply. **Workers can still reach any tenant's secrets and files** outside the kernel, as the
owner's Windows user, and nothing here changes that.

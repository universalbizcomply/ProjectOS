# PROJECTOS-TENANT-EXIT-PROOF1A — Stage 2 exit proof

**Phase:** PROJECTOS-TENANT-EXIT-PROOF1A, phase 7 of V4 Stage 2, under `docs/changes/delta_spec.md` ("Exit proof").
**Tree proved:** branch `projectos-tenant-stack3` at `e17dc831` (PRINCIPAL1A, CREDENTIALS1A and CONNECTOR-CONTRACT1A
stacked on plan v1.35). **Evidence only:** no source, test, validator, schema or authority record changed. This file is
the only change. Not pushed, not merged, phase not closed. ECC DATABASE and ECC SECURITY reviewed `ac9aaded`: both
APPROVE WITH CHANGES, no CRITICAL or HIGH. Their findings and what was done are under "Review round".
**Spend:** $0. No network, no live database, no credential, no allowlist entry, nothing written to PolyGo, the agency
repository or ProjectOS's main checkout.

## The result

| Criterion | Result |
|---|---|
| Every database claim passes on a throwaway cluster, and each named mutation fails it | **Met.** Exact migration bytes, both starts, the three real project ids. 174 assertions pass; 43 of 43 named mutations fail by their own assertion or gate finding |
| Live, read-only checks after the owner's apply | **Met,** by the lead's run, below |
| Every kernel claim passes against the real committed registry, and removing each rule fails it | **Met on the agent route. On the credential route, met on stand-ins, and on the real installation for the registry and receipt rules only (post-merge, 2026-11-03, under "Post-merge check").** The agent route ran on the real bytes with unchanged code. The credential half (K1, K2-session, K5, K6, K8-vault) never ran on the real bytes with unchanged code: variant (a) changed one registry field and (b) one line of code. Both also passed the install root and state directory in explicitly, where production derives them: `installationStateDir()` (`credential-metadata.cjs:427`) returns null under the faked `LOCALAPPDATA`, and the install root has two derivations, `nodeRuntimeRoot.ts:67` and `projectos-credential-router.cjs:157`, neither exercised. 25 removals: 23 killed by exactly the declared change, 2 shown to be masked, as declared, by an earlier rule |
| The evidence states each limit in "What Stage 2 does not prove" | **Met,** below |
| Required validators | 7 of 7 PASS |

**This is not a boundary against a hostile worker.** Everything runs as the owner's Windows user. Stage 2 stops the
kernel's own routes and the database from crossing tenants. A process that goes round the kernel is not stopped.

## What the proof ran on, and what was synthetic

- **The registry is the real committed one.** `projectos/security/tenant-registry.json` at `e17dc831`, blob
  `8f7b7437c648defc54d8d2005ab76691f51948fb`, byte for byte, committed into a throwaway installation repository. The
  three projects are the real checkouts, bound by the kernel's own reads of their git origin, worktree list and
  `.projectops/project-config.json`:
  - `projectos` at `C:/dev/ProjectOS`: owner-personal, develop, `governed-root`;
  - `polygo` at `C:/dev/Polygo/polygo`: owner-personal, develop, `governed-root`;
  - `seo-agency` at `C:/dev/SEOAgency`: agency-business, business, `governed-root`.
- **The owner's real receipt does not exist yet.** The real installation state holds no `tenant-registry-receipt.json`,
  no `tenant-registry-changes.jsonl` and no grant receipt, checked by listing it before and after. The proof used a
  **synthetic receipt and admission line, written into a throwaway state directory** by the kernel's own
  `appendDurableLine` and `writeTenantReceipt`. Nothing was written to `%LOCALAPPDATA%\ProjectOS` or ProgramData. The
  owner's act is still the one line in PRINCIPAL1A's evidence, for the same blob `8f7b7437…`.
- **The real installation could not be used.** `C:/dev/ProjectOS` is at `main` (`fdad2987`), whose registry is an
  older blob (`9a49b921…`), and a synthetic credential grant cannot be committed there. So the installation was a
  throwaway repository holding the tip's records.
- **The credential side needed one changed field.** The credential authority refuses any installation the registry's
  `projectos` line does not name (`INSTALLATION_NOT_MAIN_CHECKOUT`), and the real line names `C:/dev/ProjectOS`. On the
  real bytes it refused, as designed. So the credential claims ran twice:
  - **(a)** unchanged code, with the `projectos` line's `governedRoot` pointed at the throwaway installation, which
    is then the `projectos` checkout. Its blob differs per throwaway world, because the root does; every other byte
    is the real file's.
  - **(b)** the real bytes, with that one comparison removed from a scratch copy of `credential-metadata.cjs`.

  Both gave the same outcome on every case.
- **Secrets are synthetic.** Every value lived in the in-memory credential store. The Windows Credential Manager was
  never reached. Grants and grant receipts are synthetic, in throwaway repositories and state.
- **Code under test:** a scratch copy of the tip from `git archive e17dc831`, with `core/dist` and `agent/dist` copied
  in. Both dists were rebuilt into scratch and compared: 101 core and 119 agent JavaScript files, 0 differences.
- **This worktree's agent does not load its own core.** `agent/node_modules` is a junction to
  `host-review-path1b`, whose core `dist/index.js` differs from the tip's and has no `connectorContract.js`. The scratch
  copy loads the tip's core, so every kernel removal below hit the code it names. **The same junction means `vitest` in
  this worktree's `agent` tests another tree's core.** Its green suites say nothing about this branch's core until the
  junction is replaced or the branch is merged.

## 1. Database

**What ran.**

- `val-projectos-tenant-rls1a`, unchanged, in this worktree: PASS on PostgreSQL 17.10. The harness in it covers both
  starts, 159 assertions, 43 database and 205 text mutations.
- A scratch copy of `control-center/supabase/test/` at the tip, moved onto the three real ids:
  - the fixture's `fx-alpha` became `polygo` and `fx-beta` became `seo-agency`, and a `projectos` row and phase were
    added;
  - 15 assertions were added, which read the three projects by the tenant the committed registry gives each;
  - the fresh start's expected seed count went from 0 to 2;
  - one control mutation was added.

  The migrations and `privilege-gate.sql` were not touched. Their sha256 equal the tip's and RLS1A's table:
  `0001` `11fc5de0…`, `0002` `7d1520b3…`, `0003` `094d74db…`.

  The cluster was throwaway, on 127.0.0.1, run from the local PostgreSQL 17 binaries. The installed PostgreSQL
  service was not touched.

**Result:** 197 checks pass, 0 fail, 174 assertions on each start, gate clean.

- Applied twice by a non-superuser `postgres` on a fresh and a live-shaped start. The second apply changed nothing in
  the catalogue and re-created no key.
- `0003` was applied twice too.
- Both tenants are seeded.

| Delta claim | Assertions (controls first) | Removal that fails it |
|---|---|---|
| A member of A sees A's rows, and none of B's, in all four tables | `A-CTRL-*`, `A-XREAD-*`, and on the real ids `A-REAL-SAME-TENANT-projectos`, `-polygo`, `-phases`, `-MEMBER-both`, `A-REAL-CROSS-seo-agency`; reverse `A-REAL-OWN-seo-agency`, `A-REAL-CROSS-projectos`, `-polygo`, `-owner-phases` | `using-true-projects` 13 assertions (4 of them `A-REAL-CROSS-*`), `-phases` 10, `-tenants` 8, `-tenant-members` 10, `true-or-helper` 13 |
| A refusal is not a policy that shows nothing | the same controls | added `deny-all-read-projects` (`using (false)`): 20 assertions fail: 19 controls (`A-REAL-SAME-TENANT-*`, `A-REAL-OWN-seo-agency`, `A-CTRL-*` and the write controls) and one refusal, `A-MALFORMED-SUB-projects`, which expects the uuid error a `false` policy never reaches. Every other refusal still passes, so a refusal alone would have proved nothing |
| Update and delete of B's rows change nothing; inserting with B's `tenant_id`, stealing a B row, pointing a phase at B's project are refused | `A-XWRITE-*` with `A-XWRITE-CTRL-*`, `A-STEAL-*`, `A-XFK-*` | `xwrite-projects-open` 24, `xwrite-phases-open` 25, `insert-check-true` 5, `column-grant-tenant-id` 3, `table-update-grant` 5, `composite-fk-dropped` 2 |
| A non-owner member cannot write; clients cannot write `tenants` or `tenant_members`; `TRUNCATE` is refused | `A-MEMBER-*` with `A-OWNWRITE-*`, `A-NOWRITE-*`, `A-SELFADD-*`, `A-SELFPROMOTE`, `A-TRUNCATE-*` | `write-update-using-true`, `write-delete-using-true`, `owner-helper-widened` 15, `owner-anywhere-owns-all` 7, `tenants-client-write`, `members-self-add`, `members-self-promote`, `truncate-granted` 8 |
| A user who owns both tenants still cannot change `tenant_id` | `A-BOTH-TENANT-*`, `A-BOTH-UPSERT-*`, with control `A-BOTH-WRITES-BOTH` | `column-grant-tenant-id`, `column-grant-id`, `table-update-grant` |
| `anon`, an authenticated non-member and null claims read nothing | `A-ANON-*`, `A-NONMEMBER-*`, `A-NULLCLAIMS-*`, `A-NOSUBCLAIM-*`, `A-MALFORMED-SUB-*`; also through a real `authenticator` login | `anon-select-grant`, `uid-not-null-*`, `using-true-*`, `malformed-sub-falls-open` |
| The privilege gate reports nothing, on effective privileges | gate empty before and after the assertions | every gate-named mutation below |

**The five mutations the delta names**, each in a rolled-back transaction on the live-shaped start:

| Mutation | Assertions failed | Gate finding |
|---|---|---|
| `using(true)` (`using-true-projects`) | 13, including `A-XREAD-projects`, `A-NONMEMBER-projects`, `A-REAL-CROSS-seo-agency` | `ALWAYS_TRUE` |
| `auth.uid() is not null` (`uid-not-null-projects`) | 10, including `A-NONMEMBER-projects`, `A-REAL-CROSS-seo-agency` | `EXPRESSION_DIFFERS` |
| a `to public` policy (`to-public-policy`) | **0** | `NOT_TO_AUTHENTICATED` |
| USAGE on `private` for `anon` (`private-usage-anon`) | **0** | `anon\|schema\|private\|USAGE` |
| an added public function (`public-function-added`) | **0** | `EXECUTE` on `tenant_leak()` |

**Three of the five are caught by the gate alone.** The grant wall makes them invisible to behaviour, so no assertion can
fail. The gate's finding is named per mutation and the validator requires that exact finding, not "something failed".

## Live, read-only

Run by the lead, 2026-11-02 06:31 UTC, on project `vzbzkziksxvyfqrdrwqx`, through the Management API with
`read_only: true` on every SQL call and the owner's personal access token held in process memory only. Script:
`live-exit-check.cjs` in the session scratchpad; output `live-apply-evidence/exit-proof-live.json` there. Selected fields
only were read or printed.

| Check | Result |
|---|---|
| The committed `live-postapply.sql`, hash-pinned `821f6815…` | 10 of 10 pass, verdict `POSTAPPLY/all ok=true` |
| Sign-up disabled (`config/auth`) | `disable_signup: true` |
| No permissive policy on any public table | 10 policies, none whose `USING` or `WITH CHECK` is `true` |
| Public tables out of realtime | none in `supabase_realtime` |
| Row-level security on every public table | `phases`, `projects`, `tenant_members`, `tenants`: enabled, not forced. Forcing it would not stop a role with `BYPASSRLS`, so the real limit is the list of roles RLS does not bind, under "What Stage 2 does not prove" |

**The lead's rerun, 2026-11-02 07:39 UTC**, same route, with these rows replacing the first run's anon row and adding
the rest:

| Check | Result |
|---|---|
| The anon key itself works (control) | `/auth/v1/settings` returned `200` |
| Anon reads nothing | all four tables returned `401` with Postgres code `42501` |
| Schemas exposed through the API | `public`, `graphql_public` |
| `SECURITY DEFINER` functions in an exposed schema | none, apart from `public` and `private`, which the gate covers |
| Row counts | projects 12, phases 0, tenants 2, tenant_members 2 |
| Post-apply check, sign-up, policies, realtime | unchanged: 10 of 10, sign-up disabled, 10 policies none permissive, none in realtime |

This is the live state on the dates above, not a guarantee of it later: a dashboard change is not seen until this is
run again.

## 2. Kernel

**How each claim was judged.** One script drives the kernel's own routes:

- `runStartTenantRefusal`, the entry refusal of `projectos run --execute`;
- `handleBridgeRpc`, the MCP bridge;
- `projectos tenant show`, through the real `cli.run`;
- `createRequesterAuthority().fromRun` on the run's own handle;
- the vault, the operation gate and the session router.

Each case records an outcome code. The clean tree then gave the baseline.

Each removal changed the scratch copy of the tip, ran the same script in a fresh world, restored the bytes and checked
them. **A removal counts as killed only when exactly the declared cases change, to exactly the declared outcomes,
and every other case stays as it was.** Where an earlier check hides a rule, the removal is run in two stages, and
the masking itself is shown.

Real repositories are read only, by the kernel's own reads. A second process standing in `C:/dev/SEOAgency` and
holding only polygo's run handle was read back as `polygo:owner-personal`: the handle, not cwd, is the requester.

### K1. A tenant secret goes to a second project in the same tenant, and is refused across tenants

The reference is `ProjectOS/tenant.owner-personal/staging/supabase/<credential>`, reach `tenant`. It runs through the
operation gate on each project's own kernel run, with a synthetic grant naming that project.

| Case | Clean |
|---|---|
| polygo's run | `RELEASED`: the child process saw the value |
| projectos's run, the second project in the tenant | `RELEASED` |
| seo-agency's run, holding a grant naming this same reference | `REFUSED:TENANT_MISMATCH` |
| the agency's own tenant secret, from seo-agency | `RELEASED` |
| the agency's tenant secret, from polygo | `REFUSED:TENANT_MISMATCH` |

**Only the tenant rule decides.** The credential has no project, and the refused run holds a good permit and grant.
**Removal `K1-tenant-class-rule`** (`boundaryRefusal`'s tenant-class line made `return null`) turned both refusals into
`RELEASED` and changed nothing else.

### K2. With the project check disabled, a session and a bridge read across tenants are still refused

**Session** (`router.start`, profile `staging-writer`, each project's `gh-token` at project reach, polygo's run):

| Stage | Cross-tenant (seo-agency) | Same tenant (projectos) | Reverse (seo-agency's run, polygo) |
|---|---|---|---|
| Clean | `CROSS_PROJECT_REFUSED` | `CROSS_PROJECT_REFUSED` | `CROSS_PROJECT_REFUSED` |
| `K2s-tenant-rule-alone`: tenant rule removed, project check on | no change: **masked**, as declared | no change | no change |
| `K2s-project-check-off`: both project lines in the vault removed | **`TENANT_MISMATCH`** | **`PROJECTED`**, so the check really is off | **`TENANT_MISMATCH`** |
| `K2s-project-check-and-tenant-rule-off` | **`PROJECTED`**: the value reached another tenant's child | `PROJECTED` | `PROJECTED` |

**Bridge** (`project-state`, bridge bound to polygo; `checkBridgeRequest`'s bound-project test removed in the core):

| Stage | seo-agency | projectos | Reverse (bound to seo-agency, asks polygo) |
|---|---|---|---|
| Clean | refused, not bound | refused, not bound | refused, not bound |
| `K2b-tenant-rule-alone` | no change: **masked**, as declared | no change | no change |
| `K2b-project-check-off` | **`TENANT_MISMATCH`** | **`ANSWERED`** | **`TENANT_MISMATCH`** |
| `K2b-project-check-and-tenant-rule-off` (`crossTenantRefusal` compares nothing) | **`ANSWERED`** | `ANSWERED` | `ANSWERED` |

`erp-system` gave `TENANT_UNKNOWN` at stage 2 in both rows, so an unlisted id is refused by name too.

**What the bridge answered with both rules gone:** `project: PolyGo (polygo)`. It reads only the root it is bound to, so
a third, structural layer stays. The read was admitted and recorded as a crossing all the same.

**No production case lets the tenant rule decide alone.** In the vault the project check runs first, and for a
project-class credential and a session it always answers before the tenant rule does (`vault.cjs:186`, `:336`), as
the bridge's bound-project check does there. So the staging above proves what the delta words, that the tenant rule
holds with the project check disabled, and the masked rows show it never decides in today's code. Only K1's
tenant-class credential reaches it first.

### K3. A child envelope naming the same project and another tenant is refused (R3)

The parent is a real admitted `run-start` for polygo. The child is minted for `implement`, through the core's
`mintEnvelope`.

| Case | Clean | `K3-r3-tenant-field` (`tenant` taken out of R3's equal-fields list) |
|---|---|---|
| child under the real binding | `MINTED`, owner-personal | unchanged |
| child under a real binding from a registry that moves polygo to agency-business, domain kept | `REFUSED:R3`: "the child's tenant 'agency-business' is not its parent's 'owner-personal'" | **`MINTED`, agency-business** |
| the good child with only `tenant` edited, given to `checkChildEnvelope` | `REFUSED:R3` | **`ACCEPTED`** |

**No production route mints a child today.** `admitBoundary` mints roots only. R3 is proved at the core, which is the
only place a child can come from.

### K4. A tenant named in agent text, argv or the environment changes nothing (R2)

| Case | Clean | Removal that introduces the reader, and the result |
|---|---|---|
| `tenant show --tenant agency-business --domain business --as owner` | output byte-equal to plain `tenant show` | `K4-show-reads-argv`: **changed** |
| `PROJECTOS_TENANT`, `TENANT`, `TENANT_ID` and two token names set to agency-business: `tenant show`, and the envelope of a real `run-start` | byte-equal; the envelope says `owner-personal:develop` | `K4-derivation-reads-env`: **changed**, and the envelope **`agency-business:develop`** |
| bridge arguments `tenant`, `domain` (agent text through the MCP bridge) | answered; the envelope says `owner-personal:develop` | `K4-bridge-reads-agent-text`: **`TENANT_MISMATCH`** |
| `.projectops/tenant.json`, an `AGENT_NOTES.md` and a `tenant` field in `project-config.json`, written into the throwaway `projectos` checkout only | byte-equal | `K4-derivation-reads-project-file`: **changed** |

The project-file case was not run against the real repositories, because they are not written.

**The argv removal is weak.** Nothing in `tenant show` or the derivation reads flags at all, so the removal had to add a
reader by hand. It shows the comparison would see one; it does not show a rule that could be removed.

### K5. The operation path refuses a requester outside the reference's project

The reference is `ProjectOS/polygo/staging/supabase/<credential>`, with a synthetic grant for each requester naming it.

| Case | Clean | `K5-operation-project-rule` (`belongsToProject` line removed) |
|---|---|---|
| polygo's own run | `RELEASED` | unchanged |
| projectos's run (same tenant: only the project rule can refuse) | `CROSS_PROJECT_REFUSED` | **`RELEASED`** |
| seo-agency's run | `CROSS_PROJECT_REFUSED` | `TENANT_MISMATCH`: the tenant rule still holds |

**It fails on the code before this work.** The gate and vault were exported from `0c50ebbf` (CREDENTIALS1A's base) and
given the same requester and permit: they started the command with polygo's synthetic value in its environment
(`STARTED-WITH-ANOTHER-PROJECTS-SECRET`).

### K6. An account-wide token is not projected into another tenant's session

An owner-account token is stored under seo-agency's name (`gh-token`, reach `account`, tenants `[owner-personal]`). A
session is then started from seo-agency's own run.

| Case | Clean | `K6-session-reach-rule` (the session reach line made `return null`) |
|---|---|---|
| account token, agency session | `REACH_WIDER_THAN_PROJECT`, nothing spawned | **`PROJECTED`** |
| the same name at project reach | `PROJECTED` | unchanged |

The project check passes here, because the name is seo-agency's. Only the reach rule stands in the way.

### K7. An unlisted project, a duplicate registry entry and an unconfirmed registry are each refused by name

| Case | Clean | Removal |
|---|---|---|
| `C:/dev/ERP system` (real, `erp-system`, not listed), derived | `TENANT_UNKNOWN` | `K7-unlisted-falls-to-default` (a default tenant instead of the refusal): **bound to owner-personal** |
| the same, through `run --execute`'s entry | `TENANT_UNKNOWN` | `REFUSED:ENVELOPE_R1`: a later rule, because that repository has no commit |
| a throwaway unlisted repository with a commit and an origin, through the run entry | `TENANT_UNKNOWN` | **`ADMITTED`** |
| polygo against the real registry plus a duplicate polygo line | `TENANT_REGISTRY_DUPLICATE` | `K7-duplicate-rule`: `TENANT_MISMATCH`, because the duplicate's root also catches it |
| seo-agency, a sound line, against that same file | `TENANT_REGISTRY_DUPLICATE` (whole file) | **bound**, so the whole-file rule was what refused it |
| real bytes committed under the name "Not The Owner", no receipt | `TENANT_REGISTRY_NO_RECEIPT` | `K7-receipt-rule`: **bound** |
| a commit by "Murad" moving seo-agency to owner-personal, receipt for the old blob | `TENANT_REGISTRY_NO_RECEIPT` | **seo-agency bound to owner-personal** |

**The same rules in the credential authority** (`credential-metadata.cjs`: `registryProblem`, `:365-392`, and the
receipt read, `:513`), through `issueConsoleRun` and through `fromRun` on a real kernel run's handle. That route reads
the registry with its own copy of the rules, so it is proved on its own:

| Case | Clean | Removal |
|---|---|---|
| console run for polygo, duplicate polygo line | `TENANT_REGISTRY_DUPLICATE` | `K7c-authority-duplicate-rule` (the project, repository and root check made `if (false)`): **accepted**, polygo, owner-personal |
| console run for seo-agency, a sound line in that file | `TENANT_REGISTRY_DUPLICATE` | **accepted**, seo-agency, agency-business |
| polygo's real run handle, read against that file | `TENANT_REGISTRY_DUPLICATE` | **accepted** |
| console run, real bytes under "Not The Owner", no receipt | `TENANT_REGISTRY_NO_RECEIPT` | `K7c-authority-receipt-rule` (the receipt check made `if (false)`): **accepted** |
| polygo's real run handle, same installation, no receipt | `TENANT_REGISTRY_NO_RECEIPT` | **accepted** |
| console run for seo-agency after a commit moved it, stale receipt | `TENANT_REGISTRY_NO_RECEIPT` | **accepted, as owner-personal** |
| control: the same installation with its receipt | accepted, polygo, owner-personal | unchanged |

The tenant-id duplicate check at `:374` was not exercised.

**The third clause is replaced, lead-decided, and unmet as the delta wrote it.** The delta asks for "a non-owner last
commit" to be refused (`delta_spec.md:43`, `:223`). The lead replaced that check with the receipt (ADR-T1 §3), under the
owner's full-authority grant, because every commit on this machine is named Murad. **This replacement was shown to the
owner on 2026-11-03, before their receipt. No ruling on it has been given yet.** Authorship is not judged at all: the same "Not The Owner" commit with a receipt binds normally, on both
routes. What is proved is that a registry blob with no receipt is refused by name, whoever committed it. That includes a
tenant moved by a commit under the owner's name.

**Every receipt in this proof was made by a direct call,** `writeTenantReceipt` and `appendDurableLine` for the
registry and `confirmGrant` for each grant, with no terminal. That is the forgery ADR-T1 §10 names, and it worked
for grant receipts exactly as for the registry's.

### K8. A refusal that cannot be recorded stops the operation

The record's lock is held, as a process that died holding it would leave it.

| Case | Clean | Removal |
|---|---|---|
| polygo `run --execute` admission | `ENVELOPE_NOT_RECORDED` plus `REFUSAL_NOT_RECORDED`, no run | `K8-held-lock-reads-as-written` and `K8-door-ignores-the-recorder`: **`ADMITTED`** with no line |
| unlisted run refusal | `TENANT_UNKNOWN` plus `REFUSAL_NOT_RECORDED` | held lock read as written: the refusal goes silent |
| bridge read admission | `ENVELOPE_R4`, not answered | door removed: stopped by the outcome line; door and `bridgeOutcome` removed: **`ANSWERED`** |
| bridge refusal | refused, with `REFUSAL_NOT_RECORDED` | held lock read as written: refused, silent |
| vault session release | `ENVELOPE_NOT_RECORDED` | `K8-authority-lock-reads-as-written`, `K8-vault-release-ignores-the-recorder`: **`GRANTED`** with no line |
| vault refusal | `REFUSAL_NOT_RECORDED` | authority lock, `K8-vault-refusal-ignores-the-recorder`: `CROSS_PROJECT_REFUSED` with no line |

Positive controls with no lock: a run was admitted with its line, and a release was granted with its line.

## 3. Required validators

Each ran in its own process, in this worktree, at `e17dc831`, one after another. My scratch rebuild of the two dists
ran alongside the first of them; nothing else did. Afterwards `git status` was clean.

| Validator | Result | Time |
|---|---|---|
| `val-projectos-tenant-contract1a` | PASS, 346 named mutations killed | 2 s |
| `val-projectos-tenant-rls1a` | PASS, 205 text and 43 database mutations, 159 assertions on 2 starts, PostgreSQL 17.10 | 99 s |
| `val-projectos-tenant-principal1a` | PASS, 210 | 2 s |
| `val-projectos-tenant-credentials1a` | PASS, 279, each by its own rule | 13 s |
| `val-projectos-tenant-csp1a` | PASS, 106 | 4 s |
| `val-projectos-connector-contract1a` | PASS, 38 rules, 293 mutations | 13 s |
| `validate-no-secrets` | PASS | 1 s |

Full `validate-all` and the suites were not run: the lead runs them.

## Hard limits, kept and checked

- **No write to the real state.** `%LOCALAPPDATA%\ProjectOS` (303 files) and `ProgramData\ProjectOS` (3) were listed by
  name, size and modification time before and after: identical. Around the fourth removal round, 2026-11-03, the listing
  went from 303 files to 305. The two added files are `installation-state\tenant-registry-receipt.json` and
  `tenant-registry-changes.jsonl`, both stamped 10:05:05 UTC. They are the owner's own `tenant receipt`, typed at their
  terminal while the round ran, and not the proof's. Nothing else was added, removed or changed. `ProgramData` stayed at 3.
- **No fallback to the real state, as far as this detects.** Every proof process ran with `LOCALAPPDATA` pointed at an
  empty throwaway directory and every state directory passed explicitly, and that directory was still empty at the end.
  That detects only defaults built from `LOCALAPPDATA`. `platformStop.ts:183` derives its directory from the
  operating system's home, which this does not redirect, and **reads** of the real state were not excluded, only
  writes ruled out by the listing above.
- **Real repositories untouched.** `C:/dev/ProjectOS`, `C:/dev/Polygo/polygo` and `C:/dev/SEOAgency` have the same HEAD,
  refs, worktree list, porcelain status and index modification time before and after. Git was asked with
  `--no-optional-locks`.
- **Nothing else crossed a limit.** No network, no live database, no credential, no allowlist entry, no push or merge.
  Closure authority, the owner floor, gatekeeper composition and write grants were not touched. The Agency corpus was
  not read.
- **Where the proof material is.** All of it is in
  `C:\Users\murad\AppData\Local\Temp\claude\c--dev-ProjectOS\a856e2c0-f3aa-4d40-9c5b-3bedecfe1b9c\scratchpad\tenant-exit-proof1a\`.
  - `proof/`: `kernel-proof.mjs` sha256 `10c8f1bf…`, `run-removals.cjs` `c5c6168b…` (both as run in round 4, in
    `results/round4-script-hashes.txt`), `db-three-project.cjs` `8ff24d78…`.
  - `results/`: the outputs.
  - They are not committed, by instruction.

## Review round, at `ac9aaded`

- **ECC DATABASE:** APPROVE WITH CHANGES.
- **ECC SECURITY:** APPROVE WITH CHANGES, no CRITICAL or HIGH. It reran K1, K2-session, K7 and the masked stages from a
  fresh archive, and all matched.

Findings as relayed by the lead, who decided them. This file does not hold the reviewers' own reports.

| # | Finding | Disposition |
|---|---|---|
| P | K7 covered only the agent route | **Run.** The credential authority's duplicate and receipt rules, with a removal each, under K7. Both killed |
| 1 | The kernel row overclaimed: the credential half never ran on real bytes with unchanged code, and both variants passed the root and state directory explicitly | **Fixed.** The row says so, and the post-merge rerun on the real installation is a stated gate |
| 2 | K7's third clause | **Marked replaced, lead-decided, unmet as written; shown to the owner 2026-11-03, no ruling yet.** Receipts made by direct calls, grant receipts included, are now in the limits |
| 3 | K2: the tenant rule never decides alone in production | **Said,** under K2 |
| 4 | K4: the argv removal is weak | **Said,** under K4 |
| 5 | "No fallback" overclaimed | **Narrowed** to what it detects: `LOCALAPPDATA` defaults, writes only |
| 6 | `A-MALFORMED-SUB-projects` counted as a control; "live holds 12 rows" had no query | **Fixed;** the row counts now cite the live rerun |
| 7 | Missing limits | **Added:** the unbound router verbs, the plaintext handle, linked worktrees, the roles RLS does not bind, the `supabase_admin` defaults, the gate's scope, and the database reviewer's three LOW slips |
| 8 | Live rows | **Replaced and added** from the lead's 07:39 rerun; the RLS row reworded |
| 9 | Review dispositions | This table |
| 10 | This worktree's `vitest` tests another tree's core | **Said,** under "What the proof ran on" |

The LOW slips are carried, not fixed: this phase changes no source.

## Failures on the way, all mine and all in the proof scripts

- **The first database run failed 3 of my 15 new assertions.** They ran while still logged in as tenant B's owner,
  so they saw nothing. Fixed by logging out first. The system was not at fault.
- **A synthetic grant could not be read.** `git show <commit>:./<path>` fails with "Filename too long" under the long
  scratch path, and the authority then refuses as `CREDENTIAL_GRANT_NOT_FOUND`, which is fail-closed. The world path
  was shortened. Carried as a LOW: a deep installation root would refuse every grant.
- **The first removal round reported 3 rows as unexpected,** and each was my expectation, not the code:
  - with both session rules gone, the held-lock refusal case becomes an admission that cannot be recorded
    (`ENVELOPE_NOT_RECORDED`), which is correct;
  - `ERP system` has no commit, so its run stops at R1;
  - a duplicate's own root also refuses it.

  The table was corrected, a committed unlisted repository and the whole-file case were added, and every removal
  was run again. After the review added the credential authority's K7 cases, every removal was run a third time.
- **The third round reported both credential-authority removals as unexpected.** The fault was in the script, not the
  code: each `from-run` case read a state that lacked the run's admission line, or the duplicate's receipt. With the
  receipt rule removed it answered `RUN_HANDLE_UNKNOWN`. With the duplicate rule removed it answered
  `TENANT_REGISTRY_NO_RECEIPT`. The script now copies the kernel's own admission line for that handle into each state
  the authority reads, so only the rule under test can refuse. **Every removal was then run a fourth time, on
  2026-11-03, on the final scripts: 23 killed, 2 masked as declared, 0 other.** That fourth run is the one reported
  above. Its log is `results/removals-round4.log`; the third round's is kept as `removals-round3.log`.

## Post-merge check on the real installation, 2026-11-03 10:48 UTC

The stack was fast-forwarded onto the plan branch and `main` was fast-forwarded locally to `44ba28bb`. The registry at
that commit is blob `8f7b7437…`, and the owner's receipt names it. Both dists were rebuilt in `C:/dev/ProjectOS`. Then,
from that main checkout, with unchanged code and nothing passed in that production derives itself:

| Route | Call | Answer |
|---|---|---|
| Agent | `projectos tenant show`, run in `C:/dev/ProjectOS` | `projectos`, tenant `owner-personal`, domain `develop`, bound by `governed-root`, blob `8f7b7437…` at `44ba28bb`, receipt `typed-terminal` 2026-11-03T10:05:05.905Z |
| Credential | Authority built exactly as `projectos-credential-router.cjs:214` builds it: install root from the router file's own location (`C:/dev/ProjectOS`) and `installationStateDir()` (the real `installation-state`). `fromRun` was given a well-formed handle that no run was ever admitted under | `RUN_HANDLE_UNKNOWN`. `bindRun` reads the registry first, so the main-checkout, whole-file and receipt rules all passed on the real bytes |
| Credential, control | The same call with the real root and an empty state directory | `TENANT_REGISTRY_NO_RECEIPT` |
| Credential, control | The same call with a linked worktree (`host-review-path1b`) as root and the real state | `INSTALLATION_NOT_MAIN_CHECKOUT` |
| Credential | `operationGrantRefusal` for polygo | "no committed credential-release grant exists for this phase in the installation": fails closed |
| Credential | a requester that is not a handle | `REQUESTER_REQUIRED` |

**The real state was not written.** `installation-state` was listed by name, size and modification time before and after
the credential calls: unchanged. The empty control directory stayed empty. The script and its output are
`real-install-check.cjs`, `real-install-check.json` and `real-install-controls.json`, in the scratchpad of session
`77b6fbca-0e82-4298-926e-8b308a5a6d02`.

**What this closes and what it does not.** The registry and receipt half of the gate is met on the real installation,
with production's own derivation of the root and the state. Two things are still not run on the real installation:

- **Cross-tenant release with a live requester.** That needs a console run, which appends an admission line to the real
  state. So it is proved on stand-ins only (K1, K2-session, K5, K6, K8-vault, above).
- **The released half.** It needs a real committed and receipted `credential-release` grant. That is an owner act, and
  none exists.

`nodeRuntimeRoot.ts:67` was not traced separately: the agent route ran from the main checkout, and its answer names that
root.

## What Stage 2 does not prove

- **This is not a boundary against a hostile worker.** A worker can still reach any tenant's secrets and files outside
  the kernel, as the owner's Windows user (F7, ADR-T1 §10). Stage 2 stops the kernel's routes and the database.
  - The real fixes are Host service custody for secrets and Stage 4.3 isolation for files.
  - **No second party's data or credentials go on this machine until both are done** and the owner decides (D4,
    ADR-T1 §11). This green proof does not lift that.
- **The registry's owner check never rested on more than a git name,** and is now a console receipt. A receipt proves
  that a person or a process confirmed a blob at a console. A process that drives a console, or writes the receipt and
  its line directly, is not stopped, and the file lives outside every repository, so a forgery is not a diff.
- **No product flow uses the tenant tables yet** (F2). The database boundary is proved by the harness. Live holds 12
  projects, 0 phases, 2 tenants and 2 memberships, by the lead's 07:39 rerun under "Live, read-only". All 12 projects
  are owner-personal and none is seo-agency, by RLS1A's audit.
- **RLS binds client roles only.** It is no limit on `postgres`, `service_role`, `supabase_admin`, or anyone holding the
  personal access token or the service key. Forcing RLS would not change that, because those roles bypass it.
- **`supabase_admin`'s default privileges in `public` stay open** (`live-postapply.sql:293`). A table that role makes in
  `public` is exposed. Migrations must run as `postgres`, and the guards enforce that.
- **The privilege gate looks at `public` and `private` only.** Three LOW slips found by the database reviewer would pass
  it:
  - a default ACL in schema `private` (`0003_default_privileges.sql:61-65` checks `public` and global entries only);
  - a `SECURITY DEFINER` trigger on one of the four tables;
  - `grant service_role to authenticated`, hidden because the gate's role checks do not follow membership through
    `NOINHERIT` (`privilege-gate.sql:144-149`).
- **More of the credential router is unbound.** `credentials doctor`, `session status` and `session stop` are unbound
  like `credentials status` (`projectos-credential-router.cjs:396`, `:473`, `:481`).
- **The run handle is a plaintext envelope id,** readable by any process of this user from the installation state.
- **Linked worktrees bind, and were not exercised here.** The agent route reads a registry from whatever install root it
  is given (`governedContext.ts:488-509`), so a worktree's registry change is stopped only by the blob receipt.
- **Receipts are files any process of this user can write,** for the registry and for credential grants alike. Every
  receipt in this proof was made that way (K7).
- **Eight of the nine connector scenarios** are defined and first run in Stage 5. Only cross-tenant denial is proved,
  in CONNECTOR-CONTRACT1A.
- **One owner sees both tenants,** by membership. The owner's account owns both in the harness, as on live.
- **What decides the work is where it started.** cwd selects the checkout. No worker receives a run handle yet. The
  broker checks the project, not the run.
- **Only provider-side scope, expiry and revocation are real credential boundaries.** `credentials status` still lists
  every tenant's reference names and fingerprints.
- **Gaps of this proof:**
  - no production route mints a child envelope, so R3 is proved at the core;
  - the bridge answers only for its bound root;
  - the delta's "non-owner last commit" is not judged at all, as stated under K7;
  - no production case lets the tenant rule decide alone, as stated under K2;
  - the credential route never ran on the real bytes with unchanged code, as stated under "The result".

## Not proved here: the fix, who, and what it costs

| Not proved | Fix | Who | Cost |
|---|---|---|---|
| ~~The owner's real tenant receipt~~ **Done 2026-11-03 10:05:05 UTC:** the owner typed it at their terminal for blob `8f7b7437…`. The receipt and its admission line are in the real `installation-state`, envelope `ENV-5eab0280715f2a9cd73460fe` | — | Owner | Done |
| **GATE, registry and receipt half MET 2026-11-03** (under "Post-merge check"). Still open: cross-tenant release with a live requester on the real installation, and the released half | After merge and receipt, rerun `kernel-proof.mjs` with `C:/dev/ProjectOS` as the installation, with the root and state directory derived the way production derives them (`nodeRuntimeRoot.ts:67`, `projectos-credential-router.cjs:157`, `installationStateDir()`). That last derivation is the real state, so the rerun must write there only what the owner accepts. The refusal half needs no commit; the released half needs a real grant, an owner act | Lead, then owner for a grant | Minutes; the grant is a protected act |
| PostgreSQL 17.6, the live version | The proof ran on 17.10. Run the harness on 17.6 binaries if exact parity is wanted | Lead | About an hour to fetch, a minute to run |
| The gate's blind spots: `private` default ACLs, definer triggers, role membership through `NOINHERIT` | One check each in `privilege-gate.sql` and `live-postapply.sql` | Lead, in a phase granted those files | Small; LOW |
| A deep installation root refusing every grant | Read grants without the `<commit>:./<path>` stat, in a phase granted `credential-metadata.cjs` | Lead | Small; LOW |

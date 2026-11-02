# PROJECTOS-TENANT-CREDENTIALS1A — who may have a credential, asked of a run handle

**Phase:** PROJECTOS-TENANT-CREDENTIALS1A, plan v1.35 (activated at `70ffbca8`), under `docs/changes/delta_spec.md`.
**Branch:** `projectos-tenant-credentials1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-credentials1a`, based on the
reviewed but unmerged `projectos-tenant-principal1a` at `0c50ebbf`. Not pushed, not merged, phase not closed, no phase
record created.
**State:** implementation complete, and every finding of both review rounds, at `151bfd8b` and `a78ddf92`, is answered
below. The last round was not re-reviewed: the lead reads this diff. Nothing here touched a live service, a provider, spend, a real stored secret or the real Windows
Credential Manager: every store is a test double, every value and every grant is synthetic.

## The lead's first grant decision is WITHDRAWN

**At `151bfd8b` the grant for an operation release was the phase's committed `secrets-handling` gate. That was the
lead's decision, and it was wrong.** Both reviewers reproduced it: any `APPROVE` record for a caller-named phase released
a production credential, and those records are scoped to the gatekeeper key. A gatekeeper `secrets-handling` gate is
never a credential grant now.

**A release needs a committed `credential-release` grant, and that grant's blob needs a receipt.
No grant exists yet, so operation release fails closed. Creating one is an owner act,** and nothing here writes one.
Only synthetic grants in throwaway test installations exist.

The record, at `projectos/security/credential-grants/<PHASE>.credential-release.json` in the installation:

```json
{
  "schemaVersion": "1.0.0",
  "kind": "credential-release-grant",
  "phaseId": "<the phase the permit names>",
  "projectId": "<the requester's project>",
  "references": ["ProjectOS/<project>/<environment>/<provider>/<credential>"],
  "action": "<the provider action, as the permit names it>",
  "command": ["<the executable's absolute path>", "<each argument, exactly>"],
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "grantedBy": "<who granted it>"
}
```

Then the owner confirms that exact blob, once, at a real terminal on the main checkout:

```
projectos credentials grant-receipt --blob <sha>
```

It shows what the grant names and asks for the first 12 characters of the blob. The receipt goes to
`credential-grant-receipts/<blob>.json` in the installation state, outside every repository, with its admission line in
`credential-grant-changes.jsonl`, the shape `tenant receipt` uses. A commit with no receipt, or a changed grant, which is a
new blob, releases nothing. **A receipt proves a console confirmation and nothing more.** It is not the owner's signature.
It stops an agent with no terminal on this route and a commit alone. It does not stop a process that drives a console, or
writes the receipt and its line directly: same-user files are writable under F7.

`command` is what `run` will execute, the resolved executable then the arguments: a different executable or argument
releases nothing. The path is compared without regard to case or slashes on Windows, and the arguments exactly.

Exactly those fields. It is read from committed bytes at the installation's HEAD, unmodified, with replacement objects off
and hashed to its blob. A record for another phase, project, credential or action, a stale or unreadable date, a missing
or extra field, an uncommitted file, or one committed only in the project releases nothing, each by test. It sits in the
installation rather than in the project because a project's work can write its own repository (F8). This location is my
reading of "committed": say if you want it elsewhere. A phase id containing `token` or `secret` would be ignored by
`.gitignore`, so such a grant needs `git add -f`, and until then it fails closed.

## The lead's remaining decisions, for the owner to overrule

1. **`credential-release` stays P5.**
2. **Session auto-load is kept for PROJECT-class credentials only,** for their own project in their own tenant, with
   project reach, recorded through an envelope. It has no owner step. It never releases a tenant-class or platform-class
   credential, and an account-wide token is never projected into a session.
3. **A platform credential serves every tenant through the broker and is released to none.**

ADR-T1 §6 and §10 and `action-registry.json` now record this. **Only provider-side scope, expiry and revocation are real
boundaries.** The rest prevents accidents until Stage 4.

## Review round, at `151bfd8b`

- **Agency `secrets-credential-hygiene-engineer`: BLOCK.**
- **ECC SECURITY: APPROVE WITH CHANGES.**

Findings as relayed by the lead, who decided them. This file does not hold the reviewers' own reports. Both reproduced the
CRITICAL, and the fault was the lead's grant decision, not the build.

**Fail-first:** `tenantCredentialsReview.test.ts` was written before any fix and run at `151bfd8b`, with its fixtures and
the test-only grant helper: **39 of 46 failed, 7 passed.** Some failed only because `endAdmittedRuns` or a new field did
not exist. The grant, replace-ref, console, reach, expiry, budget and audit tests failed on behaviour. Of the 7, one was
undiscriminating (masking, with no audit line at all), so it now also asserts the mask is written; the others are positive
controls and the zero-budget defaults, which pin behaviour that must stay.

| # | Finding | Disposition |
|---|---|---|
| CRITICAL 1 | The grant was any phase's `APPROVE` | **Withdrawn and replaced,** above. `operationGrantRefusal`, TCR-26 |
| HIGH 2 | The broker's `git()` allowed replace refs, so a replace ref plus a matching file forged `ownerApproved`, `authoringPermitted` and `installationAllows` | **Fixed.** `--no-replace-objects` on the one spawn, and `readCommitted` hashes bytes to their blob, so `readCommittedBlob` is gone. Tests plant the real forgery, with a positive control. See the sweep below |
| HIGH 3 | `--run` gave console authority with no terminal, and `--owner-confirm` needed none | **Fixed.** Console authority is held in memory by the process that minted it, set only by `issueConsoleRun`, and a console handle is refused by `fromRun` (`RUN_HANDLE_CONSOLE_ONLY`). `--owner-confirm` needs a TTY on both ends on all four verbs. The vault reads that bit, not `via` |
| HIGH 4 | Reach survived `--replace` | **Fixed.** A provision records only what it states, so a new value clears reach. A metadata-only rotation keeps it |
| HIGH 5 | The operation path skipped reach and expiry; auto-load admitted tenant and account reach | **Fixed.** `fitnessRefusal` on both paths. Auto-load takes project reach only. An operation refuses a reach outside the requester's tenant. A Supabase personal access token is account-wide whatever it declares: it moved to operation class and off `staging-writer`, because the profile table may not offer an operation-class credential |
| HIGH 6 | Handles never ended | **Fixed.** An exit hook writes the `run-start` execution line, proved by a real process through vite-node, so a kernel handle lasts as long as its run. **A process killed outright writes nothing, and that handle lasts to its 12-hour expiry.** The code and ADR-T1 now say what a console line is worth, below |
| HIGH 7 | The audit lacked command, exit, session id and reach change | **Fixed.** `operation-start` and `operation-end` lines, the session id, `reachBefore` and `reachAfter`. A credential-shaped argument is masked. A failed start line stops the command. A failed end line is reported as `AUDIT_NOT_RECORDED`, because the command has already run |
| MEDIUM 8 | `run-start` had a budget of zero | **Fixed.** The committed `phaseHardStopAtMicroUsd` from `.projectops/gatekeeper.json` at the checkout's HEAD, with replacement objects off. No committed cap is zero |
| MEDIUM 9 | `tenantRegistryProblem` lacked the core's checks | **Fixed.** Tenant id shape and domain, tested |
| 10 | Add credential gave a generic failure; the host fixture had no registry | **Fixed.** `refusal_sentence` shows the router's first stderr line, never the value, bounded. The host's `the_real_broker_…` test ran and passes |
| 11 | Comments overclaimed | **Fixed.** `vault.cjs` and `operation-gate.cjs` headers, ADR-T1 §6 and §10, `action-registry.json`. TCR-25 |
| CARRY | `status` leaks reference names and fingerprints | Accepted under D4, in ADR-T1 §10. Stage 4 owes mandatory expiry, an owner, a revocation path and service custody |

## Final recheck, at `a78ddf92`

- **ECC SECURITY recheck: BLOCK.**
- **Agency recheck: APPROVE WITH CHANGES.**

Findings as relayed by the lead, who confirmed the HIGH in code. The CRITICAL fix held, and every grant variant was refused.

**Fail-first:** `tenantCredentialsRecheck.test.ts` was written before any fix and run at `a78ddf92` with the updated
worlds: **37 of 40 failed, 3 passed.** Some failed only because `confirmGrant` or `isAccountWide` did not exist. The
worktree, clone, no-receipt, typed-answer, MCP and command tests failed on behaviour. Two of the 3 were positive controls.
The third, no-terminal, passed because the old router had no such verb, so it now asserts its own message.

| # | Finding | Disposition |
|---|---|---|
| HIGH 1 | A linked worktree of the installation wrote its own grant | **Fixed, in `requireSources` as asked.** `--git-dir`, `--git-common-dir` and `<root>/.git` must be one directory, and the registry's `projectos` line must name this root, compared as normalised paths. A real `git worktree add`, a real clone and a repointed registry all give `INSTALLATION_NOT_MAIN_CHECKOUT`. It breaks one route: **running the router from a development worktree**, so the check stayed here. The registry must now list `projectos`, and the real one does |
| HIGH 2 | "Owner act" was unenforced | **Fixed.** `credentials grant-receipt`, above. `receiptStands` is one reader for both receipts, so they cannot drift |
| MEDIUM 3 | A TTY is spoofable | **Fixed.** `--owner-confirm`, a declared reach, the platform key and the receipt each need an answer typed at the terminal, shown working in a real ConPTY. `deps.terminal` stays the seam. **This raises the bar and is not a boundary:** a process that drives a console can type too, and console authority stays acceptable only under D4 |
| MEDIUM 4 | `staging-writer` failed open for Supabase | **Fixed.** Declared variables come from what each adapter would set for the credentials the profile permits, and `allowedServers` is the project's providers that the profile offers. `supabase` left `staging-writer`. A server with no projected credential, or a placeholder for a token the session will not hold, refuses the session. `SUPABASE_PROJECT_REF` is not a credential and stays. `staging-writer.template.json` and `mcp.template.json` need no change for this to hold: **carried**, below |
| MEDIUM 5 | The grant's `action` was a label | **Fixed.** `command`, above, passed by `run` as `[executable, ...args]` |
| LOW 6 | `supabase-pat` was not caught | **Fixed.** `isAccountWide` also matches `pat`, `personal-access-token` and `access-token` as name segments. **A name can still lie:** a classic GitHub token stored as `gh-token` reads as nothing here |

**Carried, each with an owner and a stage:**

| Item | Owner | Stage |
|---|---|---|
| A grant is reusable until it expires: it covers a command, not one run of it | Lead to design, owner to approve | Stage 4, with mandatory expiry |
| A value swapped outside ProjectOS keeps its declared reach, because the metadata cannot see the store change | Lead | Stage 4 service custody |
| A forged governed-root `run-start` line is accepted, as any process of this user can write one (F7) | Lead | Stage 4 service custody |
| `staging-writer.template.json` and `mcp.template.json` still name Supabase, so a project built from them is refused at session start | Lead | The next phase granted `templates/` |

### The committed-bytes sweep (finding 2)

| Where | Reader | State |
|---|---|---|
| `projectos/security/gatekeeper-transport-broker.cjs` | `git()`, `readCommitted` | **Fixed** |
| `projectos/credentials/credential-metadata.cjs` | `git`, `readCommitted` | Already had both |
| `projectos/security/broker.cjs`, `operation-broker.cjs`; the rest of `projectos/credentials/` | No git read | Nothing to fix |
| `projectos/scripts/_watchdog-lib.cjs:64`, `watchdog-sentinel-package.cjs:32` | Plain `git show` | **Same class, not fixed: outside writePaths.** They copy watchdog source into products and decide no credential. One flag each |
| `projectos/agent/src`: `planApproval.ts:1282`, `ownerGateReceipts.ts`, `verifiedBrokerSource` | Plain `git show` | **Same class, outside the sweep's directories and writePaths.** The broker's bytes are verified through one of these. A later phase should take them |

## What stays unwired

`projectos/core/src` and most of `projectos/agent/src` are outside this phase:

| Item | State | Fix, who, cost |
|---|---|---|
| **No worker receives a handle** | The handle exists and survives: it is the run-start envelope's id, on the kernel's own durable line. Nothing passes it to a child, and nothing a worker does calls the credential router today | `commands/run.ts` and `loop/workers.ts` are protected (Zone 3). When a worker first needs a credential, pass `admittedRunEnvelopeOf(ctx).envelopeId` to it |
| **The broker cannot tell which run asked** | The request carries no handle, so the check is on the project, not on the requester. A run bound to one tenant can still name another tenant's allowlisted project, as far as this check goes. Only `projectos` is allowlisted today | `brokeredHttpPort.ts` and `host_ports.rs` send the handle, and the broker reads the line from `TRUSTED_STATE_DIR` as `fromRun` does. Both callers are outside this phase |

## Behaviour that changes at merge

- **The router must run from the main checkout.** `projectos credentials`, `session start` and `operation run`, with
  `--run` or `--project`, give `INSTALLATION_NOT_MAIN_CHECKOUT` from a linked worktree, a clone, or anywhere the registry's
  `projectos` line does not name. A development worktree cannot use them, by design.

- **the Control Center's Add credential is refused.** `set_credential.rs` runs `credentials set --from-env` with no
  terminal and no handle, so it gets `REQUESTER_REQUIRED`, and it now shows that sentence, which says to use a real
  terminal. Allowing it would be the unbound write this phase exists to stop: any process can set an environment
  variable. Giving the host a run to pass is the later fix.
- **`credentials set`, `delete`, `reach`, `session start` and `operation run` need `--run <handle>`, or a real terminal
  on both ends and `--project <id>`.** `operation run` also needs `--phase`, and `--owner-confirm` asks for a typed answer on every verb, `projects` included.
- **Every credential a release touches needs a declared reach, or nothing releases it.** Nothing stored has one, so every
  session with a credential stops with `REACH_UNDECLARED` until the owner runs, once per credential, at a console:
  `projectos credentials reach --ref <reference> --project <id> --reach project|tenant|account [--reach-tenants a,b]`.
  No secret is re-entered. `credentials doctor` lists each one. Replacing a value clears it.
- **A Supabase personal access token no longer loads into any session,** so a session's Supabase MCP server has no token.
  `staging-writer.template.json` and `docs/credential-router.md` still list it, and are outside the writePaths.
- **Operation release fails closed** until the owner commits a grant and confirms its blob.
- **A reach, and any change to the platform key, need a typed answer.**
- **An MCP config naming a server the profile does not offer refuses the session,** on every profile.
- **The tenant registry needs its receipt** on this route too, the one PRINCIPAL1A's evidence asks for before merge.

## How the requester works

**The requester is a kernel-issued run handle that survives process boundaries, never cwd.** The handle is the `run-start`
envelope's id. The kernel already writes that admission line durably to `envelope-records.jsonl`, in the installation
state, so no new issuing step exists in `agent/src`. `createRequesterAuthority().fromRun(handle)` finds the one allowed
admission, refuses a run that has ended or expired, reads the committed registry and its receipt, holds the line's tenant
and domain to the registry, and brands a frozen requester in a private `WeakMap`. A process in another tenant's root that
holds the handle is that run, proved by a real second process standing in `gamma`'s root.

**A command with no run mints one,** as CONTRACT1A requires. `issueConsoleRun` writes a real `run-start` line under the
kernel's lock, `via: console`, and goes through `fromRun`, so one route reads every requester. It is reached only after
the router sees a TTY on both ends. The authority dies with that process, and `fromRun` refuses a console handle. **`via: console` is a label under F7**: it shows what a tenant receipt shows, a person or a process at a console.

**the handle names a record and is not a secret.** The line can be read by any process of this Windows user, which can
also copy another tenant's handle or write a line. That is ADR-T1 §10's first limit. Stage 2 stops the kernel's routes being told who is
asking. It does not stop a process that goes round them.

**The core cannot be loaded here.** It is TypeScript, and this layer is synchronous CommonJS that runs with no build. So
`credential-metadata.cjs` repeats the record shape, the whole-file judgement, the idempotency key and the record lock,
and the broker, which runs from stdin and can require nothing of ours, repeats the whole-file judgement again. Tests hold
them to the core: `parseEnvelope`, `deriveIdempotencyKey`, `parseTenantRegistry`, and the real registry through all three.
The requester code sits in `credential-metadata.cjs` because the plan names that file and no new one. Say if you want it
in its own module.

**The binding terms, one by one:**

| Term | How it is met |
|---|---|
| A run handle that survives process boundaries, never cwd | Above. TCR-2 refuses `process.cwd()` in every function on the route |
| A linked-worktree binding alone releases nothing | `via: linked-worktree` is refused for auto-load by name. An operation still needs its grant, read from the installation's main checkout. So a project worktree's commit grants nothing, and neither, since the recheck, does a commit on a worktree of the installation, which could until then. Real `git worktree add`, real kernel run |
| A receipt is never a credential-release grant | The receipt is a precondition of reading the registry. With a receipt, a good permit and no grant, nothing is released, by test. The broker reads no receipt |
| No JWT or OAuth requester | `RUN_HANDLE_RE` refuses both shapes, by test. TCR-18 refuses the words on this path |
| `run-start` has a budget | Met in review: the committed per-phase cap |
| A crossing cannot reach the broker, so the broker has its own check | `tenantOfProject`, on both request kinds |

## Delivered

| Commit | Content |
|---|---|
| `4dd636fa`, `a8bd6704`, `bfde8cd7`, `0e87f0ad`, `151bfd8b` | The first build, as reviewed |
| `0a8651d0` | The grant, console authority, reach, expiry, audit: `credentials/*`, the router, `session-profiles.cjs` |
| `7610dd9d` | The broker: replace refs, hashing, the registry's shape checks |
| `71375c9b` | `governedContext.ts`: the end line and the budget |
| `b77fad6b` | `set_credential.rs`, the host fixture, `action-registry.json`, ADR-T1 |
| `84513641` | `tenantCredentialsReview.test.ts`, `runEndChild.ts`, the older tests and validators |
| `fac3ec87` | The recheck: installation identity, grant receipt, typed confirmation, MCP, `command`, account-wide names |
| `47e0b24a`, `29efb3b2` | `tenantCredentialsRecheck.test.ts`, the worlds, the validators |
| _this commit_ | This file |

## Acceptance criteria

1. **The operation path refuses a requester outside the reference's project, and that test fails on the code before
   this phase:** met. See below.
2. **A plain-string requester is refused; only a kernel-minted context passes, tested:** met, at all six doors, for a
   project id, a tenant id, a copy, a JSON round trip, `null` and `undefined`. The live requester passes in the same test.
3. **A tenant secret is released to a second project in the same tenant and refused across tenants; only the tenant
   rule can decide this:** met. It runs on the operation path, because auto-load never releases one. A tenant-class
   credential has no project, and the other tenant holds a grant naming it, so only the tenant rule is left.
4. **A project id starting with `tenant.`, in any case, is refused, and provision, remove and present are bound, tested
   with synthetic entries:** met. The registry refuses it whole, the router refuses a connection calling itself one, and
   no requester can be minted for one. `rotateMetadata` is bound too.
5. **The platform credential is released to no tenant session, tested:** met, and asserted by the rule's own code,
   because the operation-class rule would otherwise refuse it first. The operation path is refused too, at the vault,
   with its own project's run, a good permit and a grant naming it.
6. **An operation release needs a committed grant naming the project, the exact references, the action and an expiry; a
   record for another phase, project, credential or a stale date releases nothing, tested:** met, above.
7. **An account-wide token is not projected into another tenant's session, tested:** met. The owner's account token stored
   under the agency project's name passes the project check, so only the reach rule stops it, and project reach loads.
8. **Validator pin and named mutations, each killed by its own rule:** met, 279 of 279, 31 rules and TCR-T. `behaviour()` also runs the
   criteria on every pass.

### The operation test fails on the old code, on behaviour

`refuses a requester outside the reference's project, and runs nothing` loads the gate and vault from `CRED_UNDER_TEST`.
Pointed at the tree exported from `0c50ebbf`, with the requester still minted by the new authority:

```
FAIL test/tenantCredentials.test.ts > the operation path > refuses a requester outside the reference's project, and runs nothing
AssertionError: expected [ [ …(3) ] ] to have a length of +0 but got 1
```

The old gate started the command, with another project's synthetic secret in its environment. On this tree it passes.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so a pass says the pins fire, not that a behaviour test fails. So mutations were
applied to the real source, the proof each should trip was run with an exact filter, the failing test was recorded, and
the file restored.

- **The recheck: 38 mutations swept on the final source, 34 killed by a named test.** Four survive, correctly, each pinned
  by its rule: `worktree-is-an-installation`, because `<root>/.git` still refuses a worktree;
  `receipt-for-an-uncommitted-blob`, because the listing and the read come from one HEAD; `receipt-not-read-back`, because a
  write that fails throws first; `receipt-needs-no-terminal`, because the reader refuses with no terminal too.
- **That sweep found five more weak proofs, all fixed, each mutation run again and killed.** The registry's root rule was
  hiding the git rule, so two tests now use a registry naming the worktree, and a `.git` file pointing at the installation.
  A wrong answer at the receipt command, an answer with no terminal, and a same-length argument had no test.
- **The review round's sweep was not repeated.** 107 mutations, before the recheck: 104 caught by behaviour, 103 by a named test, and
  `profile-offers-the-pat` by `session-profiles.cjs`'s own load-time assertion, which stops the module loading. The other
  128 have only their text pin. Many are evidence, registration and word pins, but some are real code mutations and
  were not tried.
- **Three survive, correctly, and each is pinned by its rule:** `grant-any-gate-file`, because a gate lacks a grant's
  fields, so reading one still refuses. `console-authority-reads-the-label`, because `fromRun` already refuses console
  lines, so `via` and the in-memory bit agree on every route today. `broker-reads-through-replace-refs`, because the hash
  refuses alone: the two are layers, and the fail-first run shows the forgery passing with neither.
- **The sweeps found six weak proofs, all fixed, each mutation run again and killed.** First build: the handle table
  accepted either of two refusals, and the no-terminal test passed on an expired clock rather than its rule. Review round:
  a blank grantor, a date in another format and a phase id climbing to a well-formed record had no test, and my
  `reach-inherited-on-replace` mutation also stopped the first provision recording reach, so it proved nothing.
- **Two mistakes of mine, stated.** I read these files as CRLF from a bad `grep` and converted them; the first commit check
  showed whole-file diffs, and they went back to LF before anything was committed. And the session's scratchpad is shared:
  another agent's `sweep.cjs` overwrote mine, and I ran it once by name. It stopped at its own control, before any
  mutation, but it overwrote that agent's `sweep.out`. My later files are in a private folder.

The validator also runs `behaviour()` on every pass: the plan's criteria, over a real git world and in-memory stores.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Test typecheck | `npx tsc -p tsconfig.test.json --noEmit` in `projectos/agent` | 0 errors |
| Full agent suite, nothing else running | `vitest run` in `projectos/agent`, at `29efb3b2` | 109 files, 3424 tests, all pass |
| Review and recheck tests | `tenantCredentialsReview.test.ts`, `tenantCredentialsRecheck.test.ts` | 50 and 45 tests, all pass; 39 of 46 failed at `151bfd8b`, 37 of 40 at `a78ddf92` |
| Typed confirmation | The real router in a real ConPTY, `conpty.ps1`, inside the recheck test | A wrong answer refused, the right one through |
| Host crate | `cargo test the_real_broker_accepts` in `gatekeeper-review-composition`, target directory inside this worktree and removed after, at `84513641`; the broker has not changed since | 1 passed. The real broker reaches its credential stage |
| `refusal_sentence` | `rustc --test` on that function and its tests, extracted | 4 passed. The Control Center crate itself was not built |
| This phase's validator | `node projectos/validators/val-projectos-tenant-credentials1a.cjs` | PASS, 279 named mutations killed |
| Validators reading a touched file | Each in its own process through `run()`, nothing else running | 25 PASS, 1 FAIL. Includes the five the plan requires, `val-projectos-trust-boundary1a`, `val-projectos-closure-transport1a`, `val-projectos-kernel-followup1a`, `val-projectos-tenant-principal1a`, `val-projectos-tenant-contract1a`, `val-projectos-tenant-rls1a` and `val-projectos-boot-continue1a`. **The one FAIL is not this phase's:** `val-cd-b4-sealed-expected-window-facts1a` names `fn session_digest` in `ipc_session.rs`, which this branch does not touch. It was run because it mentions `set_credential` |

**Not run:** full `validate-all`, which is the lead's. Core and Control Center suites: nothing in `core` changed, and the only
`control-center` change is the Rust above. A real kernel run in the installed app.

`@projectos/core` resolves through a junction to another worktree, as PRINCIPAL1A's evidence says, so these tests ran
against that tree's core build.

## What this phase does not do

- **A worker can still reach any tenant's secrets** and files, outside the kernel, as the owner's Windows user (F7).
  `windows-credential-store.*` is unchanged, and TCR-23 holds it to its hash. D4's hard rule stands: no other party's
  data or credentials on this machine until Host service custody and Stage 4.3 isolation are done, and the owner decides.
- **`status` stays unbound.** It holds no value, and the sidecar calls `credentials status --project <id> --json` with no
  run, so it still lists every tenant's reference names and fingerprints. Accepted under D4, carried to Stage 4.
- **No execution line for a release.** The admission is recorded, with the vault's `use` line. The exit code is not.
- **A release key is derived and not claimed,** so a duplicate release is not stopped by it.
- **A killed process leaves a live handle** until its 12-hour expiry, and a line that cannot be written at exit does too.
- **Budget is a per-call ceiling,** and it is read from the checkout, which a linked worktree can commit.
- **The broker asks no receipt.** `TRUSTED_STATE_DIR` is where spend is counted and is not always where a receipt lives, and
  a receipt grants nothing. A registry commit alone can change what the broker reads. It moves no spend: the allowlist is
  asked first, and `projectos run` refuses an unconfirmed registry.
- **The Windows target-name case was not tested live.** ADR-T1 expects it here, and the hard rule forbids the real store
  for this phase. A folding test double shows the rule does not depend on the answer.
- **The provider guard knows no `google` or `openai`,** so a tenant-class Google credential is refused at `run` by
  provider intent until a connector registers one. That is Stage 5's.
- **`projectos/docs/credential-router.md`** does not yet show the new flags, and is outside the writePaths.

## Decisions for the lead to challenge

1. **The grant lives in the installation,** not beside the gates in `.projectops`.
2. **A grant names one phase and one project.** A tenant secret needs a grant per project using it.
2a. **What is typed is what is confirmed:** the reference, the profile, the project or the checkout, not a fixed word.
2b. **`<root>/.git` is required as well as the two directories you named,** so a `.git` file pointing at another repository
   does not pass by having one directory.
2c. **A grant's executable is the resolved absolute path,** so `node` in a grant matches nothing.
3. **The handle is the existing run-start id, not a new secret token.** It is readable by any process of this user.
4. **A killed run's handle lasts 12 hours.** The window is pinned by earlier tests, and I left it.
5. **Moving the Supabase token to operation class** is how "account-wide" reached the profile table, and it costs sessions
   their Supabase MCP token.
6. **An undeclared reach refuses,** on both paths.
7. **A run may touch its own credentials; reach and the platform key need a console.**
8. **`--project` at a console may name any listed project.** The owner holds both tenants.
9. **Three copies of the whole-file rule.** The broker cannot load a shared one. Tests hold them together.

## Carried forward

- **The agent's committed readers** in the sweep table, and the watchdog scripts, for replace refs.
- **`val-projectos-tenant-contract1a` pins ADR-T1 §6's "OPEN" line,** so it stays and reads as history, followed by what
  decided it. The fix, when that validator is next granted, is to pin the new wording.
- **`docs/06_Plan.md`** is the lead's.
- **`speed/input-map.cjs`** has no entry for this validator, like the two before it. It maps the three older validators
  to `projectos/credentials` only, so a change to `session-router` or the broker does not invalidate them. The fix is a
  path each, in a phase that owns the file.
- **`syntheticWorld` lives in this validator,** and the three older ones require it, because `validators/lib` is outside
  the writePaths. It belongs in `lib`.

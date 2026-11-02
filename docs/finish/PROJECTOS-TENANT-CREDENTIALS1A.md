# PROJECTOS-TENANT-CREDENTIALS1A — who may have a credential, asked of a run handle

**Phase:** PROJECTOS-TENANT-CREDENTIALS1A, plan v1.34, under `docs/changes/delta_spec.md`.
**Branch:** `projectos-tenant-credentials1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-credentials1a`, based on the
reviewed but unmerged `projectos-tenant-principal1a` at `0c50ebbf`. Not pushed, not merged, phase not closed, no phase
record created.
**State:** implementation complete, **not yet reviewed**. The plan requires ECC SECURITY and Agency
`secrets-credential-hygiene-engineer`. Nothing here touched a live service, a provider, spend, a real stored secret or
the real Windows Credential Manager: every store is a test double and every value is synthetic.

## Decided by the lead, for the owner to overrule

Each of these is the lead's decision for the owner to overrule, taken under the owner's full authority because it is
reversible:

1. **`credential-release` stays P5.** The operation grant source is the phase's committed
   `.projectops/gates/<PHASE>.secrets-handling.json` owner record, the route the broker already uses, read from
   committed bytes at the project's registered root.
2. **Session auto-load is kept for PROJECT-class credentials only,** for their own project in their own tenant, and
   each load is recorded through an envelope. It has no owner step today. It never releases a tenant-class or
   platform-class credential, and an account-wide token is never projected into another tenant's session.
3. **A platform credential serves every tenant through the broker and is released to none.**

ADR-T1 §6 still says OPEN, and the `credential-release` note in `action-registry.json` says the same. Neither file is in
this phase's writePaths. The fix is one line in each, once the owner has seen the decision.

## What this phase needed that the plan's writePaths do not hold

**The binding terms are met for the requester and not yet wired to a running worker.** `projectos/agent/src` and
`projectos/core/src` are outside this phase, so three things stop short, each with its fix:

| Item | State | Fix, who, cost |
|---|---|---|
| **`run-start` still has a budget of zero** | A binding term, and **unmet**. `admitBoundary` passes `budget: 0`, in `agent/src/governedContext.ts`. It blocks nothing here, because `credential-release` is unpaid, but `mintCrossing` would refuse a paid `broker-call` from such a run | A grant for `governedContext.ts`: `BoundaryRequest` gains `budget`, `runStartTenantRefusal` passes it. The owner names the figure, because a figure here would be invented. Three lines and a test |
| **No worker receives a handle** | The handle exists and survives: it is the run-start envelope's id, on the kernel's own durable line. Nothing passes it to a child, and nothing a worker does calls the credential router today | `commands/run.ts` and `loop/workers.ts` are protected (Zone 3). When a worker first needs a credential, pass `admittedRunEnvelopeOf(ctx).envelopeId` to it |
| **The broker cannot tell which run asked** | The request carries no handle, so the check is on the project, not on the requester. A run bound to one tenant can still name another tenant's allowlisted project, as far as this check goes. Only `projectos` is allowlisted today | `brokeredHttpPort.ts` and `host_ports.rs` send the handle, and the broker reads the line from `TRUSTED_STATE_DIR` as `fromRun` does. Both callers are outside this phase |

## Behaviour that changes at merge

- **the Control Center's Add credential is refused.** `set_credential.rs` runs `credentials set --from-env` with no
  terminal and no handle, so it gets `REQUESTER_REQUIRED`, and the Rust prints its generic "may already exist" sentence.
  Allowing it would be the unbound write this phase exists to stop: any process can set an environment variable. The
  route that works today is a real terminal with `--project`. The fix is in `control-center/src-tauri`, outside this
  phase: the host needs a run to pass, and a sentence that names the refusal.
- **`credentials set`, `delete`, `reach`, `session start` and `operation run` need `--run <handle>`, or a real terminal
  on both ends and `--project <id>`.** `operation run` also needs `--phase`.
- **Every session credential needs a declared reach, or no session loads it.** Nothing stored has one, so every session
  with a credential stops with `REACH_UNDECLARED` until the owner runs, once per credential, at a console:
  `projectos credentials reach --ref <reference> --project <id> --reach project|tenant|account [--reach-tenants a,b]`.
  No secret is re-entered. `credentials doctor` lists each one. This is my reading of "declared rather than assumed".
- **`operation run` needs a committed `secrets-handling` record** for the named phase.
- **The tenant registry needs its receipt** on this route too, the one PRINCIPAL1A's evidence asks for before merge.
- **A Rust test will fail until its fixture is updated.**
  `the_real_broker_accepts_the_host_authored_request_up_to_its_credential_stage`, in
  `projectos/host/gatekeeper-review-composition/src/host_ports_tests.rs`, runs the real broker in a fixture with an
  allowlist and no tenant registry, so the broker now stops at `TENANT_REGISTRY_UNREADABLE` before its credential stage.
  `projectos/host/**` is protected. The fix is one `write(...)` of a registry line in that fixture. **I read this and did
  not run it**: no Rust was built. `agent/test`'s three broker test files had the same gap and are updated.

## How the requester works

**The requester is a kernel-issued run handle that survives process boundaries, never cwd.** The handle is the `run-start`
envelope's id. The kernel already writes that admission line durably to `envelope-records.jsonl`, in the installation
state, so no new issuing step exists in `agent/src`. `createRequesterAuthority().fromRun(handle)` finds the one allowed
admission, refuses a run that has ended or expired, reads the committed registry and its receipt, holds the line's tenant
and domain to the registry, and brands a frozen requester in a private `WeakMap`. A process in another tenant's root that
holds the handle is that run, proved by a real second process standing in `gamma`'s root.

**A command with no run mints one,** as CONTRACT1A requires. `issueConsoleRun` writes a real `run-start` line under the
kernel's lock, `via: console`, and goes through `fromRun`, so one route reads every requester. It is reached only after
the router sees a TTY on both ends. It shows what a tenant receipt shows: a person or a process at a console.

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
| A linked-worktree binding alone releases nothing | `via: linked-worktree` is refused for auto-load by name. An operation still needs its grant, read at the registered root, so the worktree's own commit grants nothing. Real `git worktree add`, real kernel run |
| A receipt is never a credential-release grant | The receipt is a precondition of reading the registry. With a receipt, a good permit and no gate record, nothing is released, by test. The broker reads no receipt |
| No JWT or OAuth requester | `RUN_HANDLE_RE` refuses both shapes, by test. TCR-18 refuses the words on this path |
| `run-start` has a budget | **Not met.** See the table above |
| A crossing cannot reach the broker, so the broker has its own check | `tenantOfProject`, on both request kinds |

## Delivered

| Commit | Content |
|---|---|
| `4dd636fa` | `reference.cjs`, `credential-metadata.cjs`, `vault.cjs`, `operation-gate.cjs`, `session-router/router.cjs`, `projectos-credential-router.cjs` |
| `a8bd6704` | `gatekeeper-transport-broker.cjs` |
| `bfde8cd7` | The three older validators, `val-projectos-tenant-credentials1a`, registration, the tests and test worlds |
| `0e87f0ad` | Two proofs the sweep showed to be weak |
| _this commit_ | This file |

`session-profiles.cjs` is in the writePaths and did not need changing: reach is judged in the vault, on the credential.

## Acceptance criteria

1. **The operation path refuses a requester outside the reference's project, and that test fails on the code before
   this phase:** met. See below.
2. **A plain-string requester is refused; only a kernel-minted context passes, tested:** met, at all six doors, for a
   project id, a tenant id, a copy, a JSON round trip, `null` and `undefined`. The live requester passes in the same test.
3. **A tenant secret is released to a second project in the same tenant and refused across tenants; only the tenant
   rule can decide this:** met. It runs on the operation path, because auto-load never releases one. A tenant-class
   credential has no project, so nothing else can decide. All three requesters are real kernel runs.
4. **A project id starting with `tenant.`, in any case, is refused, and provision, remove and present are bound, tested
   with synthetic entries:** met. The registry refuses it whole, the router refuses a connection calling itself one, and
   no requester can be minted for one. `rotateMetadata` is bound too.
5. **The platform credential is released to no tenant session, tested:** met, and asserted by the rule's own code,
   because the operation-class rule would otherwise refuse it first. The operation path is refused too, at the vault,
   with its own project's run, a good permit and a committed record.
6. **An account-wide token is not projected into another tenant's session, tested:** met. The owner's account token stored
   under the agency project's name passes the project check, so only the reach rule stops it. The same shape loads in the
   one tenant it reaches.
7. **Validator pin and named mutations, each killed by its own rule:** met, 177 of 177, 23 rules and TCR-T. `behaviour()` also runs the criteria on every pass.

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

- **76 mutations were swept, and 75 are killed by a named behavioural test** that passes unmutated in the full suite
  below. The kills include the project, tenant, class, reach, worktree, grant, audit, envelope, handle and broker rules.
  The other 101 have only their text pin. Many are evidence, registration and word pins, but some are real code mutations
  and were not tried.
- **`tenant-taken-from-the-line` survives correctly.** The line was already held equal to the registry, so taking either
  alters nothing, and TCR-2 is its only catch.
- **The sweep found two weak proofs, both fixed in `0e87f0ad`, each mutation run again and killed.** The handle table
  accepted either of two refusals, so the shape rule could go unnoticed. The no-terminal test used a real clock with a
  fixed-clock requester, so with the terminal rule removed it still got `REQUESTER_REQUIRED`, from expiry: it passed for
  the wrong reason.
- **A mistake of mine, stated:** I read these files as CRLF from a bad `grep`, and converted them. The first commit check
  showed whole-file diffs, and they were put back to LF before anything was committed.

The validator also runs `behaviour()` on every pass: the plan's criteria, over a real git world and in-memory stores.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Test typecheck | `npx tsc -p tsconfig.test.json --noEmit` in `projectos/agent` | 0 errors |
| Full agent suite, nothing else running | `vitest run` in `projectos/agent`, the tree of `0e87f0ad` | 107 files, 3333 tests, all pass |
| This phase's test file | `vitest run test/tenantCredentials.test.ts` | 97 tests, all pass |
| This phase's validator | `node projectos/validators/val-projectos-tenant-credentials1a.cjs` | PASS, 177 named mutations killed |
| Validators reading a touched file | Each in its own process through `run()`, nothing else running | 22 PASS, 0 FAIL. Includes the five the plan requires, `val-projectos-trust-boundary1a`, `val-projectos-closure-transport1a`, `val-projectos-kernel-followup1a`, `val-projectos-tenant-principal1a`, `val-projectos-tenant-contract1a` and `val-projectos-tenant-rls1a` |

**Not run:** full `validate-all`, which is the lead's. Any Rust: the one host test named above is expected to fail. Core and
Control Center suites: nothing in `core` or `control-center` changed. A real kernel run in the installed app.

`@projectos/core` resolves through a junction to another worktree, as PRINCIPAL1A's evidence says, so these tests ran
against that tree's core build.

## What this phase does not do

- **A worker can still reach any tenant's secrets** and files, outside the kernel, as the owner's Windows user (F7).
  `windows-credential-store.*` is unchanged, and TCR-23 holds it to its hash. D4's hard rule stands: no other party's
  data or credentials on this machine until Host service custody and Stage 4.3 isolation are done, and the owner decides.
- **`status` stays unbound.** It holds no value, and the sidecar calls `credentials status --project <id> --json` with no
  run, so it still lists every tenant's reference names and their presence. Binding `present` alone does not close that.
  The fix is in `host.mjs`, outside this phase.
- **No execution line for a release.** The admission is recorded, with the vault's `use` line. The exit code is not.
- **A release key is derived and not claimed,** so a duplicate release is not stopped by it.
- **The broker asks no receipt.** `TRUSTED_STATE_DIR` is where spend is counted and is not always where a receipt lives, and
  a receipt grants nothing. A registry commit alone can change what the broker reads. It moves no spend: the allowlist is
  asked first, and `projectos run` refuses an unconfirmed registry.
- **The Windows target-name case was not tested live.** ADR-T1 expects it here, and the hard rule forbids the real store
  for this phase. A folding test double shows the rule does not depend on the answer.
- **The provider guard knows no `google` or `openai`,** so a tenant-class Google credential is refused at `run` by
  provider intent until a connector registers one. That is Stage 5's.
- **`projectos/docs/credential-router.md`** does not yet show the new flags, and is outside the writePaths.

## Decisions for the lead to challenge

1. **The handle is the existing run-start id, not a new secret token.** It needs no change to `agent/src`, and it is
   readable by any process of this user. A hash-recorded secret would need the kernel to mint one.
2. **`status` left open beside a bound `present`.** See above.
3. **An undeclared reach refuses,** so every session stops until the owner declares each credential once.
4. **`reach` is a set of tenants for an account,** not a boolean: only "which tenants does this reach" can be judged.
5. **A run may touch its own credentials; reach and the platform key need a console.** A console is what a tenant receipt
   shows, nothing more, so a process that drives one passes.
6. **Add credential breaks at merge.** I refused rather than exempt `--from-env`.
7. **`--project` at a console may name any listed project.** The owner holds both tenants. An agent with a real console is
   the same limit as the receipt.
8. **The vault audit is append-only, not `appendDurableLine`.** It has its own file, so nothing rewrites it. The envelope
   record does take the kernel's lock, because the kernel replaces that file.
9. **Three copies of the whole-file rule.** The broker cannot load a shared one. Tests hold them together.

## Carried forward

- **ADR-T1 §6 and §10, `action-registry.json`'s note:** record the lead's decision once the owner has seen it.
- **`docs/06_Plan.md`** is the lead's.
- **`speed/input-map.cjs`** has no entry for this validator, like the two before it. It maps the three older validators
  to `projectos/credentials` only, so a change to `session-router` or the broker does not invalidate them. The fix is a
  path each, in a phase that owns the file.
- **`syntheticWorld` lives in this validator,** and the three older ones require it, because `validators/lib` is outside
  the writePaths. It belongs in `lib`.

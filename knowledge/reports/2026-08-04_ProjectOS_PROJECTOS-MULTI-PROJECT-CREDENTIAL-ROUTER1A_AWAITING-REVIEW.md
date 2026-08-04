# PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A |
| **Priority** | P0 — ProjectOS V3 closure-blocking |
| **Date** | 2026-08-04 |
| **Master repository** | `C:\dev\ProjectOS` — **not modified** |
| **Worktree** | `C:\dev\ProjectOS-worktrees\credential-router1a` |
| **Branch** | `projectos-v3-credential-router1a` (see *Deviation 1*) |
| **Base commit** | `60def85194e2459eb0ea88a36c2a8f94474c5867` |
| **Commit** | one local commit on top of the base above — **not pushed**. Its hash cannot be embedded in a file that is part of the commit; it is reported in the session output and is stamped into the Reports Index row at closure, per this repository's convention. |
| **Decision requested** | **APPROVED TO PUSH** |

---

## 1. Deviations from the brief (read first)

**Deviation 1 — branch name.** The brief specified the branch `projectos-v3/credential-router1a`. Git
cannot create it: `projectos-v3` already exists as a branch, so `refs/heads/projectos-v3` is a file and
`refs/heads/projectos-v3/credential-router1a` would require it to be a directory:

```
fatal: cannot lock ref 'refs/heads/projectos-v3/credential-router1a':
       'refs/heads/projectos-v3' exists; cannot create 'refs/heads/projectos-v3/credential-router1a'
```

Renaming or deleting the master branch was prohibited, so the nearest valid name was used:
**`projectos-v3-credential-router1a`**. The worktree path is exactly as specified. Rename on request.

**Deviation 2 — master head moved twice during the phase.** The brief pinned `EXPECTED MASTER HEAD
60def85…`, which was correct at the start. While this phase ran, a concurrent desktop session committed
`1fcf416 fix(desktop): recover auth bootstrap failures` and then `fb203c6 fix(desktop): prevent host status
tile overflow` to `projectos-v3`. This worktree is based on the pinned `60def85` as instructed and includes
neither. **No code overlap** — both commits touch only `projectos/control-center/**`, their own tests, two
reports and the Reports Index. The single merge point is the **Reports Index**, where all three phases add
a row near the top; that is an ordinary textual merge, not a semantic conflict. This is precisely the
cross-session interference this capability exists to reduce.

**Deviation 3 — line endings in the worktree.** `git worktree add` checked every tracked file out with
CRLF (system-level `core.autocrlf=true`), while the master checkout holds LF. Three unrelated validators
that match on `\n`-anchored patterns therefore failed in the fresh worktree for reasons unrelated to this
work. The worktree was re-checked-out with LF (`core.autocrlf` set to `false` locally for the operation,
then **restored to its original unset state**), which resolved all three. The master checkout was verified
clean before and after. See *§13, Deviation 3* for the recommended permanent fix.

---

## 2. What was built

A four-layer capability that makes provider identity **per session** rather than per machine, so ProjectOS,
BizComply V2, two JD Testing sessions and two PolyGo sessions can run at once without contaminating one
another.

| Layer | Purpose |
|---|---|
| **L1 — connection profile + owner registry** | Which project is this checkout, and which provider identities does it pin? |
| **L2 — vault over Windows Credential Manager** | Where does the secret live, and who may have it? |
| **L3 — session router** | What does this one child process get to see? |
| **L4 — operation gate** | How does a high-risk credential run exactly one command? |

### The trust anchor

`.projectops/connections.json` lives **inside** the checkout it describes, so on its own it is a
self-assertion: any directory can `git init`, point `origin` at a public repository and declare
`projectId: "polygo"`. If the vault's project binding were checked only against that file, both sides of
the comparison would be attacker-chosen.

The other half of the comparison is the **owner project registry** —
`%LOCALAPPDATA%\ProjectOS\projects.json`, written only by `projectos projects register --owner-confirm`.
It pins, per project: the canonical checkout roots that may claim the id, the GitHub repository, the
Supabase project ref per environment, and the Vercel organisation and project id per environment. A
session is admitted only when the in-checkout profile agrees with the registry on every pinned fact, and a
project with no registry entry cannot start a session at all.

This was **added during the phase in response to the security review** (finding CRITICAL-2); the first
implementation compared the checkout only against its own file.

---

## 3. Existing capability reuse

| Verdict | Component | Notes |
|---|---|---|
| **EXISTING AND REUSED** | `security/redaction.cjs` | The vault registers every released value with it; the operation gate scrubs output through it. Not reimplemented. |
| **EXISTING AND REUSED** | `guards/provider-context-guards.cjs` | The operation gate classifies provider intent through `evaluateProviderIntent` — prohibited actions and production-frozen refusals come from the existing table, not a new one. |
| **EXISTING AND REUSED** | `approval/approval-queue.cjs` | `operation run` enqueues a redacted approval item via `requestPermit` before anything executes. |
| **EXISTING AND REUSED** | Validator conventions (`run()` → error array), `validators/lib/scratch.cjs`, report + Reports Index conventions | All three new validators follow them exactly. |
| **EXISTING BUT REQUIRES EXTENSION** | `launcher/session-launcher.cjs` | Plans a launch and deliberately never executes. This capability executes, so it composes rather than modifies — the launcher is untouched. |
| **EXISTING BUT NOT SUITABLE** | `security/broker.cjs`, `security/operation-broker.cjs` | Structurally restricted to `synthetic/…` namespaces (`assertSyntheticNamespace` refuses anything else) and in-memory only. They cannot back a real OS credential store. The vault therefore re-implements the grant/redeem/audit protocol against a real store rather than weakening the synthetic guard. **This is a real increase in maintenance surface and is flagged as a carry-forward.** |
| **MISSING AND REQUIRED** | Owner project registry, credential references + risk classification, Windows Credential Manager adapter, metadata sidecar, session profiles, environment projection, writer leases, identity preflight, provider adapters, owner CLI | Built here. |
| **OUT OF SCOPE** | Real project installation, live provider access, Windows service/host changes, `ProjectOSHost` configuration | Untouched. |

---

## 4. Exact commit boundary

**Added (34)**

```
projectos/credentials/reference.cjs
projectos/credentials/credential-shapes.cjs
projectos/credentials/vault.cjs
projectos/credentials/credential-metadata.cjs
projectos/credentials/memory-credential-store.cjs
projectos/credentials/windows-credential-store.cjs
projectos/credentials/windows-credential-store.ps1
projectos/credentials/operation-gate.cjs
projectos/session-router/project-registry.cjs
projectos/session-router/session-profiles.cjs
projectos/session-router/writer-lease.cjs
projectos/session-router/identity-preflight.cjs
projectos/session-router/env-projection.cjs
projectos/session-router/repository-facts.cjs
projectos/session-router/router.cjs
projectos/providers/registry.cjs
projectos/providers/github.provider.cjs
projectos/providers/supabase.provider.cjs
projectos/providers/vercel.provider.cjs
projectos/schemas/connection-profile.schema.json
projectos/schemas/capability-policy.schema.json
projectos/schemas/session-profile.schema.json
projectos/templates/projectops/connections.template.json
projectos/templates/projectops/capability-policy.template.json
projectos/templates/projectops/mcp.template.json
projectos/templates/projectops/sessions/readonly-reviewer.template.json
projectos/templates/projectops/sessions/staging-writer.template.json
projectos/templates/projectops/sessions/proof-runner.template.json
projectos/scripts/projectos-credential-router.cjs
projectos/validators/val-projectos-credential-vault1a.cjs
projectos/validators/val-projectos-session-router1a.cjs
projectos/validators/val-projectos-credential-router-adversarial1a.cjs
projectos/docs/credential-router.md
knowledge/reports/2026-08-04_ProjectOS_PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A_AWAITING-REVIEW.md
```

**Modified (3)**

```
projectos/validators/validate-all.cjs          (+3 lines: register the three new validators)
package.json                                   (+5 script entries; no dependency change)
knowledge/ProjectOS Reports Index.md           (+1 row)
```

Nothing outside these paths is touched. **No dependency, no lockfile, no Rust crate, no host code, no
Control Centre code, no other project.**

---

## 5. Windows secret-store implementation

`windows-credential-store.ps1` is the only component that touches a real OS secret store. It P/Invokes
`CredWriteW` / `CredReadW` / `CredDeleteW` / `CredEnumerateW` from `advapi32.dll` for generic credentials
persisted per user (`CRED_PERSIST_LOCAL_MACHINE`), storing the value as a UTF-16LE blob and zeroing the
unmanaged buffer before returning.

Secret-handling rules enforced, not merely documented:

- The value is **never** a parameter and never appears on a command line — `set` reads it from
  `PROJECTOS_CREDENTIAL_VALUE`, which the Node adapter places on the **child only**.
- The child receives a **minimal** environment (the handful of variables PowerShell needs). The parent's
  environment — which may carry another project's session credentials — is not forwarded.
- `list` returns target **names** only; there is no code path that enumerates values.
- The target name is validated against the reference charset in **both** the Node adapter and the script.
- A store error message never carries the child's stderr verbatim (the child saw the value).
- `CredEnumerate`'s wildcard filter has no notion of a `/` boundary, so listings are re-filtered on the
  segment boundary in the script **and** re-checked by project in the vault — `ProjectOS/poly*` must not
  disclose `ProjectOS/polygo2/…`.

### Live synthetic integration test (real Credential Manager, real cleanup)

Run against this machine's actual credential store with a clearly synthetic, namespaced target:

```
STEP 1 exists-before  exit=3  expect 3
STEP 2 set            exit=0  expect 0
STEP 3 get            exit=0  roundTripMatches=True
STEP 4 exists-after   exit=0  expect 0
STEP 5 list           entries=ProjectOS/synthetic-projectos-test/development/github/gh-token
                      listContainsValue=False
STEP 6 delete         exit=0  expect 0
STEP 7 exists-final   exit=3  nothing left behind
```

And the full Node vault over that same real store:

```
PASS  provisioned A into Credential Manager  fingerprint 994d97b39e79
PASS  provisioned B into Credential Manager  fingerprint f36b9d1f90f1
PASS  round trip through the real store returns the exact value
PASS  cross-project authorisation refused against the real store
PASS  no value appears in the status report
PASS  no value appears in the audit trail
PASS  metadata file on disk carries no value
PASS  cleanup removed A / removed B / A is gone / B is gone
RESULT: ALL PASS — nothing left in the credential store
```

PowerShell parse check: `PS PARSE OK; tokens=435`.

**Only synthetic values were ever stored, and both runs verified the store was empty afterwards.**

---

## 6. Project session router

Order is fixed, and each step can only narrow what follows:

1. read the checkout's real facts (canonical root, branch, origin) — read-only, no credential;
2. resolve the session profile and the credentials it may hold — an allowlist of names, never a class;
3. ask the vault which are present / expired — metadata only;
4. acquire the checkout's writer lease if the profile is a writer;
5. run the identity preflight — `READY` or **one** blocker;
6. mint session grants and build a fresh child environment — provider variables scrubbed **first**;
7. spawn the child.

`process.env` is never modified. The projected environment is a fresh null-prototype object handed to
`spawn` and then dropped. Session records on disk hold references and fingerprints only.

**Every failure after step 4 releases the lease** — a session that never started must not block a checkout.

### Profiles

| Profile | Environments | Credentials | Writes | Lease | Auto-loadable |
|---|---|---|---|---|---|
| `readonly-reviewer` | dev, staging | `gh-token` | none | no | yes |
| `staging-writer` | dev, staging | `gh-token`, `supabase-access-token`, `vercel-token` | repo, provider, migrate | yes | yes |
| `proof-runner` | dev, staging | `gh-token` | none | no | yes |
| `production-readonly` | production | `gh-token` | none | no | yes |
| `production-operation` | production | **none** | repo, provider, deploy, migrate | yes | **no** |

`production-operation` requires an owner-confirmed **session permit** naming this project, environment and
profile, and projects no credential at all.

### Preflight result set

`READY`, or exactly one of: `REPOSITORY MISMATCH`, `GITHUB IDENTITY MISMATCH`, `SUPABASE PROJECT MISMATCH`,
`VERCEL PROJECT MISMATCH`, `CREDENTIAL MISSING`, `CREDENTIAL EXPIRED`, `WRITE LEASE CONFLICT`,
`OWNER PERMIT REQUIRED`, `PRODUCTION PROFILE REFUSED`. No partial success, no continue-anyway path. A
declared provider with **no** observation is a mismatch, never a pass.

---

## 7. Provider adapters

All three plan verification and evaluate observations; **none contacts a provider in this phase**.

**GitHub** — session-local `GH_TOKEN`/`GH_REPO`; `gh auth switch|login|logout|refresh` refused by name and
**enforced at session start** (the router vetoes the command before any credential is redeemed); API
identity and the raw git-push principal are treated as separate facts and neither is inferred from the
other; a remote that disagrees with the profile is `REPOSITORY MISMATCH`.

**Supabase** — project ref pinned per environment; the MCP server is available for development and staging
only and has **no** production path; the access token may be session-scoped; `db-password` and
`service-role-key` are operation-scoped and vetoed from session projection by the adapter itself.

**Vercel** — organisation and project ids pinned per environment; a production deploy requires a specific
owner permit (`PRODUCTION PROFILE REFUSED` otherwise); a token-shaped command argument is refused.

New providers are added by registering an adapter that satisfies the registry contract; the vault, session
router and operation gate do not change. The registry publishes the **union** of every provider's variable
names, which is the scrub list — that union is why a JD Testing session cannot inherit a PolyGo session's
`SUPABASE_ACCESS_TOKEN`.

---

## 8. Concurrent session control

**One writer per checkout. Any number of readers. Two writers require two git worktrees.**

The lease key is the SHA-256 of the **canonical** checkout path (`realpath`, case-folded on Windows), so a
junction, a symlink, a `..` detour or a differently-cased spelling all resolve to one key. Acquisition —
first take **and reclaim** — goes through an atomic exclusive create (`wx`), so the filesystem picks
exactly one winner; the earlier implementation overwrote a stale lease non-atomically and could hand two
racing acquirers the same checkout (security review HIGH-2, fixed).

A lease is reclaimed only when its heartbeat has expired **and** its PID is dead. **No process is ever
signalled or killed.** A lease record carries project, canonical root, worktree path, branch, session id,
PID, start time, heartbeat/expiry and phase id — and nothing else.

`stop` releases the lease and forgets the session. If the release fails, the session record is **kept** and
the failure reported, because the record is the only thing that still names the lease (code review HIGH,
fixed — it previously deleted the record and reported success).

---

## 9. Security and threat review

Three independent reviews were run against the implementation (ECC `security-reviewer`, ECC
`code-reviewer`, ECC `typescript-reviewer`). Findings and disposition:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| S-1 | CRITICAL | Backing store is readable by any code running as the same OS user, bypassing the vault | **Accepted limitation, documented.** Inherent to a per-user Windows credential store: `CredRead` is available to that user. The trust boundary is the OS user, not the process. Stronger isolation requires the credentials to live under the ProjectOS Windows host service account — a separate workstream. Recorded in *§13* and in `docs/credential-router.md`. |
| S-2 | CRITICAL | Project identity self-asserted from a file inside the checkout being authenticated | **FIXED** — owner project registry added (`session-router/project-registry.cjs`), wired into the preflight as a mandatory, fail-closed anchor. Proven by invariants 21–23 and mutations M19–M22. |
| S-3 | HIGH | `status --project X` could disclose a sibling project by string prefix | **FIXED** — segment-boundary filter in the PowerShell listing **and** an independent project re-check in `vault.status`. Mutation M24. |
| S-4 | HIGH | Writer-lease reclaim not atomic; two writers could both believe they hold the checkout | **FIXED** — reclaim now goes through the same exclusive create. |
| S-5 | HIGH | Exact-string redaction is the only barrier on operation output | **MITIGATED** — operation output is now **withheld by default**; `--show-output` is an explicit opt-in. Mutation M26. |
| S-6 | MEDIUM | `--note` content never inspected; 120 chars easily hides a token | **FIXED** — notes are scanned for credential shapes and refused. Mutation M25. |
| S-7 | MEDIUM | No detector for a raw Vercel token (no distinctive prefix) | **FIXED** — replaced the regex-only approach with a structural rule: any key matching `*_TOKEN/KEY/SECRET/PASSWORD/PAT/CREDENTIAL` must hold a bare `${VAR}`. Mutation M30. |
| S-8 | MEDIUM | Lease `sessionId` is a caller-asserted string readable from the lease file | **Accepted limitation, documented** — same OS-user trust boundary as S-1. |
| S-9 | LOW | `mode: 0o600` is a no-op on NTFS | **Documented.** The files are non-secret; protection is the inherited `%LOCALAPPDATA%\ProjectOS` ACL. |
| S-10 | LOW | Fingerprints unsalted, so reuse is correlatable across projects | **Documented as intentional** — that correlation is how `doctor` can surface credential reuse. |
| S-11 | LOW | `--env-var PATH` would deliver the secret as `PATH` | **FIXED** — reserved-name list. Mutation M27. |
| C-1 | HIGH | `production-operation` unreachable: the preflight required `permit.profile`, which nothing minted | **FIXED** — `mintProfilePermit` added and wired through `session start --owner-confirm`. Positive **and** negative paths now proven (invariant 24). |
| C-2 | HIGH | `credentials set` threw `ReferenceError` on every successful run (`void readValue`) | **FIXED** — dead line removed. Reproduced by two reviewers independently. |
| C-3 | HIGH | `stop()` swallowed a lease-release failure and reported success, stranding the checkout | **FIXED** (see §8). |
| C-4 | HIGH | `start()` leaked the lease if grant redemption or spawn failed after a successful `prepare()` | **FIXED** — try/catch releases before rethrowing. |
| C-5 | HIGH | GitHub's "forbidden commands" guarantee was never called from the spawn path | **FIXED** — the router vetoes the command before redeeming any credential. Mutation M23, invariant 25. |
| C-6 | MEDIUM | The approval queue was documented but never wired | **FIXED** — `operation run` enqueues via `requestPermit`. |
| C-7 | MEDIUM | Session-safe credential names duplicated in two hand-maintained lists | **FIXED** — profiles are asserted against the fail-closed classification at module load. |
| C-8 | LOW | GitHub adapter's differing arity forced three copies of a `name === "github"` branch | **FIXED** — uniform 3-argument contract; all three branches deleted. |
| C-9 | LOW | `evaluateDeploy` / `assertCommandArgumentsClean` exported but never called | **FIXED** — both wired into the operation gate and the router veto. |
| T-1 | HIGH | `spawnSync` cannot launch `.cmd` shims on Windows; `result.error` ignored; grant burned on `ENOENT` | **FIXED** — the executable is resolved (PATH + PATHEXT) **before** the grant is minted; a spawn failure returns a distinct `COMMAND NOT EXECUTABLE`. Mutation M28. |
| T-2 | HIGH | The router's child-exit cleanup could never fire from the CLI, which exited first | **FIXED** — `session start` now awaits the child; the honest limit is documented in the code. |
| T-3 | MEDIUM | Backspace in the hidden prompt corrupted astral characters | **FIXED** — code-point array. |
| T-4 | MEDIUM | Unsynchronised read-modify-write on the metadata sidecar | **FIXED** — exclusive-create lock with a bounded synchronous back-off. |
| T-5 | MEDIUM | `--action` unvalidated, so `undefined !== undefined` satisfied the permit binding check | **FIXED** — required in the CLI. |
| T-6 | MEDIUM | `connection.projectId` unvalidated, so `formatReference` threw outside the closed blocker set | **FIXED** — validated in the provider registry. |

Reviewers additionally **confirmed sound** (no bypass found): grant identity via `WeakSet` (a hand-built
look-alike is refused), single-use and TTL enforcement, check ordering that denies a cross-project caller
any existence oracle, the scrub-before-add environment projection, prototype-pollution resistance via
`Object.create(null)`, and — verified by direct reproduction — `process.kill(pid, 0)` semantics,
`openSync("wx")` atomicity, `PLACEHOLDER_RE.lastIndex` handling, and PowerShell UTF-8 stdout without a BOM.

### Second round — verification pass on the fixes

A further adversarial security pass was run **against the fixed code**, specifically hunting for bypasses
introduced by the fixes. It found seven more real defects, including one CRITICAL that the first round's
own remedy had opened. All seven are fixed.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| V-1 | **CRITICAL** | `--state-dir` relocated the owner registry to a caller-chosen directory — but the Windows Credential Manager is machine-wide and addressed purely by reference string, **not** scoped by state directory. A caller could register a forged checkout as `polygo` in its own registry, pass the preflight against itself, and have the vault release the **real** PolyGo credential from the shared store. The registry fix had moved the trust anchor into the attacker's reach. | **FIXED** — `--state-dir` removed from the CLI entirely. The registry, metadata, leases and session records always resolve to `%LOCALAPPDATA%\ProjectOS`. Validators inject a state directory through the programmatic API, where no real store is involved. Mutation M34. |
| V-2 | HIGH | `resolveExecutable` resolved a relative, separator-bearing command against the **router's** cwd while `spawnSync` ran it in `req.cwd` — a credential handed to a same-named binary in the wrong tree. | **FIXED** — resolves against the command's actual working directory. |
| V-3 | HIGH | The metadata lock's abandonment check was time-only, so a live writer whose critical section exceeded 5 s (roaming profile, AV scan, GC pause) had its lock stolen — reinstating the lost-update race the lock existed to prevent. | **FIXED** — the lock records its PID; reclaim requires expiry **and** a dead holder, mirroring the writer lease. Mutation M33, invariant 13g. |
| V-4 | HIGH | `expiresAt` bypassed the note scan and length cap entirely — free text written verbatim into a file documented as non-secret and printed by `status`. | **FIXED** — a strict ISO-8601 instant is required; anything else is refused outright. Mutation M32, invariant 13f. |
| V-5 | HIGH | The MCP structural rule lost key context through nesting: `{"GH_TOKEN": {"raw": "<secret>"}}` and the array form skipped the check entirely. | **FIXED** — the nearest credential-shaped ancestor key is carried down through objects and arrays. Mutations M30/M31, invariant 13d. |
| V-6 | MEDIUM | A corrupt owner registry made `evaluatePreflight` throw, skipping the lease-release path and stranding the checkout for the lease TTL. | **FIXED** — `prepare()` releases the lease and rethrows. |
| V-7 | MEDIUM | The PowerShell listing mixed a case-**insensitive** `-ne` with a case-**sensitive** `.StartsWith`, so two project ids differing only by case could disclose each other's credential target names. | **FIXED** — ordinal, case-sensitive comparison throughout, consistent with the case-sensitive reference charset. |
| V-8 | LOW | The withheld-output report gave exact byte counts — a length side-channel for a command whose entire output is the credential. | **FIXED** — coarse size buckets. |
| V-9 | LOW | `CREDENTIAL_KEY_RE` was suffix-anchored, so `apiKeyId`/`tokenValue` were never checked structurally. | **FIXED** — broadened, while still not matching `PATHEXT` (invariant 13d asserts both directions). |

The verification pass **confirmed the writer-lease reclaim fix sound** under every interleaving it traced
(fresh-create race, simultaneous-stale-reclaim, third-party-wins-in-between): exactly one caller ever
receives `{ok:true}`.

It also flagged that `--owner-confirm` is a self-assertable CLI flag rather than a proven owner presence.
That is accurate and is **stated as a limitation** rather than fixed here: this CLI is run by the owner at
a terminal, and binding it to the CD-B4 owner-presence subsystem is a separate phase (see §13, item 8).

---

## 10. Synthetic isolation proof

All 20 required proofs are executable invariants in the three validators. Synthetic values only.

| # | Required proof | Where |
|---|---|---|
| 1 | PolyGo cannot retrieve JD Testing credentials | vault inv. 1 |
| 2 | JD Testing cannot retrieve BizComply credentials | vault inv. 2 |
| 3 | Two sessions, different Supabase refs, concurrently | router inv. 1 |
| 4 | Two sessions, different Vercel ids, concurrently | router inv. 2 |
| 5 | `GH_TOKEN` selection is session-local | router inv. 3 |
| 6 | Global provider environment unchanged | router inv. 4 |
| 7 | Missing credential fails closed | vault inv. 5, router inv. 16 |
| 8 | Wrong project identity fails closed | router inv. 6, 6b, 21–23 |
| 9 | Production profile does not auto-load | router inv. 7, 24 |
| 10 | Database password unavailable to the general process | vault inv. 3, 4 |
| 11 | Service-role value available to one authorised command only | vault inv. 6–10 |
| 12 | Secret never in logs | vault inv. 11 |
| 13 | Secret never in reports | vault inv. 12, 13 |
| 14 | Secret never in process arguments | vault inv. 16, 17; adversarial inv. 4 |
| 15 | Second writer on one checkout refused | router inv. 8 |
| 16 | Second writer on a separate worktree permitted | router inv. 9 |
| 17 | Reviewer session remains read-only | router inv. 10 |
| 18 | Session exit removes the injected environment | router inv. 11 |
| 19 | Interrupted session releases or safely expires its lease | router inv. 12, 13, 19 |
| 20 | `gh auth switch` never required or invoked | router inv. 17, 25; adversarial inv. 16 |

Adversarial cases additionally proven: swapped project refs, swapped tokens, a forged project root, a
junction/case-variant root, a stale lease with a live PID (must **not** be reclaimed), token-like log
strings, environment inheritance, child-process spawning, production/staging confusion, corrupt registry
and metadata files, prototype pollution, oversized and junk input at every boundary.

---

## 11. Validators and test results

**New validators (registered in `validate-all.cjs`)**

| Validator | Invariants | Result |
|---|---|---|
| `val-projectos-credential-vault1a` | 20 (+5 sub-cases) | PASS |
| `val-projectos-session-router1a` | 25 (+4 sub-cases) | PASS |
| `val-projectos-credential-router-adversarial1a` | 21 (+11 sub-cases) | PASS |

**Full suite** — `node projectos/validators/validate-all.cjs`, 116 registered modules:

```
[val-projectos-credential-vault1a] PASS
[val-projectos-session-router1a] PASS
[val-projectos-credential-router-adversarial1a] PASS
...
113 modules PASS
validate-all: 4 error(s)
```

The remaining failures are **pre-existing governance drift**, reproduced on the untouched master checkout
at its own HEAD, and are not caused by this phase:

```
[validate-v3.1-crosswalk] FAIL: crosswalk version is not 1.0
[validate-v3.1-crosswalk] FAIL: crosswalk source baseline is not the accepted HEAD
[validate-v3.1-crosswalk] FAIL: current-state currentHead is not the accepted baseline: fdee3d34…
[validate-v3.2-ai-provider-independence] FAIL: V13 current-state nextRecommendedPhase is not the Windows adapter preflight
```

**Mutation / adversarial testing** — 34 injected defects, one at a time, each requiring the corresponding
validator to fail: **34/34 caught.**

```
M01 risk class always session              M16 github identity always matches
M02 cross-project check removed            M17 preflight ignores the repository root
M03 grant single-use removed               M18 preflight ignores credential presence
M04 forged grant accepted                  M19 owner registry check removed
M05 owner confirmation not required        M20 registry admits an unregistered project
M06 metadata accepts value fields          M21 registry admits an unregistered root
M07 secret-shaped argv allowed             M22 registration needs no owner confirmation
M08 operation output not redacted          M23 session command veto removed
M09 inherited provider env not scrubbed    M24 vault trusts the store's prefix scoping
M10 production-operation auto-loadable     M25 credential-shaped notes accepted
M11 writer lease never conflicts           M26 operation output returned without opt-in
M12 lease key not canonicalised            M27 reserved env var names accepted
M13 supabase identity always matches       M28 command resolved after the grant is spent
M14 store value passed in argv             M29 session permit not required for a gated profile
M15 store child inherits full env          M30 mcp credential keys need not be placeholders
M31 nested credential key skips the rule   M33 metadata lock stolen from a live holder
M32 free-text expiry accepted              M34 CLI accepts a caller-chosen state directory
```

Three mutations were initially **missed** and each gap was closed by strengthening the proof rather than
accepting the mutant:

- removing the "missing observation is a mismatch" guard was masked by the subsequent equality check, so
  invariant 6b was added — a declared provider with no observation must block;
- removing the connection-level repository-root check was masked by the new owner-registry check, so
  invariant 15b was added — with a deliberately permissive registry stub, the root check must still block
  on its own;
- the metadata lock-liveness mutant survived because the test's lock recorded this process's own PID and
  hit the self-PID short-circuit, so invariant 13g now uses **another** live process (the parent) as the
  holder, and additionally asserts that a genuinely abandoned lock is still reclaimable.

**Other checks**

- `node --check` on all 20 new `.cjs` files and the CLI — clean.
- All 9 new JSON assets parse.
- PowerShell `Parser::ParseFile` — no errors, 435 tokens.
- Secret scan (`validate-no-secrets`) over the whole tree — PASS.
- Live synthetic Windows Credential Manager integration — PASS, store empty afterwards (see §5).
- Clean-tree proof: `git status --porcelain` shows only the intended paths; one stray zero-byte
  `projectos/nul` created by a shell redirect during development was found and removed before commit.
- **A shipped module was silently excluded by `.gitignore` and was caught at staging.** The repository
  ignores `secret*`, `*token*`, `*.key` and `*.pem` — sensible for secrets, lethal for a source file whose
  name happens to match. `credentials/secret-shapes.cjs` matched `secret*`, so it would have been absent
  from the commit and every clone would have failed at `require` time with all validators still green
  locally. It is renamed to `credentials/credential-shapes.cjs`, and **invariant 1b now runs
  `git check-ignore` over every shipped file** so this class of silent omission cannot recur. The
  `.gitignore` rule was deliberately NOT weakened.
- No validator was weakened; `validate-all.cjs` changes are three added registrations only.

---

## 12. Prohibited-action confirmation

| Action | Status |
|---|---|
| Master checkout `C:\dev\ProjectOS` modified | **NO** — verified clean at start and end |
| `gh auth switch` invoked | **NO** — refused by name and enforced at session start |
| Machine-global credentials changed | **NO** |
| Pushed to any remote | **NO** — local commit only |
| Real credential used, entered or stored | **NO** — synthetic values only |
| Live provider contacted (GitHub / Supabase / Vercel) | **NO** — no network call in this capability |
| PolyGo / JD Testing / BizComply V2 or any other repository touched | **NO** |
| Production system, Supabase project or Vercel project touched | **NO** |
| Windows service installed or `ProjectOSHost` configured | **NO** |
| Dependency, lockfile or package added | **NO** — zero new dependencies |
| Existing validator weakened | **NO** |
| Real project `.projectops` installation performed | **NO** — templates only |

The only machine state written outside the worktree was the synthetic Credential Manager integration test,
which created and then **removed** two clearly-namespaced synthetic credentials
(`ProjectOS/synthetic-projectos-test/…`, `ProjectOS/synthetic-other-test/…`) and verified their absence.

---

## 13. Limitations, risks and carry-forward

1. **The trust boundary is the OS user, not the process** (S-1). Any code running as this user can call
   `CredRead` directly. The vault constrains ProjectOS's own paths; it cannot constrain unrelated local
   code. **Carry-forward:** hold credentials under the `ProjectOSHost` service account so a user-context
   process must ask the service — which is where the CD-B4 host workstream is already heading.
2. **Redaction is exact-string** — a backstop, not a boundary. This is why operation output is withheld by
   default rather than scrubbed and shown.
3. **Provider verification is planned, not performed.** Adapters describe the read-only calls a live phase
   would make and evaluate observations handed to them. **Carry-forward:** a live-verification phase that
   actually performs those calls; until then, an `--observations` file is caller-supplied input and must
   not be treated as evidence.
4. **The vault duplicates the broker's grant/redeem protocol** rather than sharing a base with
   `security/broker.cjs`, because that module is structurally restricted to synthetic namespaces.
   **Carry-forward:** factor a shared grant/audit core if a third consumer appears.
5. **Deviation 3 — repository line-endings.** With no `.gitattributes` and system `core.autocrlf=true`,
   every new worktree is checked out with CRLF while the master checkout holds LF, which silently breaks
   `\n`-anchored validators. **Recommended fix (deliberately NOT made here — it is outside this phase's
   boundary and changes repository-wide behaviour):** add a `.gitattributes` with `* text=auto eol=lf`.
6. **Nothing is installed into any real project.** Every `.projectops` artefact here is a template.
   **Remaining installation phases** are listed in §14.
7. **Windows-only.** `isAvailable()` reports false elsewhere and the CLI refuses rather than substituting a
   weaker store.
8. **`--owner-confirm` is a CLI flag, not a proven owner presence.** It is the owner asserting consent at
   their own terminal, which is the right boundary for this phase but is not the same thing as the
   CD-B4 owner-presence proof used elsewhere in ProjectOS. **Carry-forward:** bind `--owner-confirm` (for
   project registration, session permits and operation permits) to that subsystem, so a script running as
   the owner cannot self-assert consent.
9. **`credential-shapes.cjs` recognises six prefixed token shapes only** — a raw Vercel token, a database
   password or a generic hex API key has no distinctive shape and is not caught. It is explicitly a
   backstop; the load-bearing controls are structural (secrets live in the OS store; configs carry
   placeholders; credential-named keys must hold a bare `${VAR}`; `expiresAt` must be an ISO-8601 instant).
   Do not read a clean scan as proof that no secret is present.

---

## 14. Remaining installation phases

1. **`PROJECTOS-CREDENTIAL-ROUTER-OWNER-ONBOARDING1A`** — owner registers the six real projects and
   provisions real credentials at the hidden prompt. Owner-only; Claude must not be present for values.
2. **`PROJECTOS-CREDENTIAL-ROUTER-PROVIDER-LIVE-VERIFY1A`** — implement and prove the read-only live
   verification calls the adapters currently only plan.
3. **`PROJECTOS-CREDENTIAL-ROUTER-PROJECT-INSTALL1A`** (per project: PolyGo, JD Testing, BizComply V2,
   ProjectOS) — install `.projectops/connections.json`, `capability-policy.json`, session profiles and
   `.mcp.json` from the templates into each repository. Each is a separate governed phase against that
   repository.
4. **`PROJECTOS-CREDENTIAL-ROUTER-SIX-SESSION-LIVE-PROOF1A`** — the six concurrent sessions running for
   real, with the writer-lease rule exercised across real worktrees.
5. **`PROJECTOS-CREDENTIAL-ROUTER-HOST-CUSTODY1A`** — move custody to the `ProjectOSHost` service account
   to close S-1.

---

## 15. Decision requested

**APPROVED TO PUSH**

Alternatives: *SECURITY OR DESIGN AMENDMENT REQUIRED — DO NOT PUSH*, or *IMPLEMENTATION BLOCKED*.

Nothing has been pushed. The local commit sits on `projectos-v3-credential-router1a` in the dedicated
worktree; `C:\dev\ProjectOS` is untouched and clean.

---

## 16. INTEGRATION ADDENDUM — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER-INTEGRATION1A

Added 2026-08-04 when the accepted feature checkpoint was replayed onto current main. Evidence only;
no implementation byte changed.

**Baselines.** Main `projectos-v3` = `02b276c77de4b72919a2aaae5ed4613b4bb24ed4`, aggregate 112/112 PASS.
Feature checkpoint `projectos-v3-credential-router1a` = `f52a5d53d079e72d7d4ddffed1b5aca119919a89`
(parent `60def85194e2459eb0ea88a36c2a8f94474c5867`), 37 paths, 34 additions, 3 modifications. The
checkpoint branch was **not** rewritten, rebased or moved.

**Method.** New branch `projectos-v3-credential-router-integration1a` created from `02b276c`, then
`git cherry-pick --no-commit f52a5d53…`. No merge commit. `projectos-v3` was neither modified nor pushed.

**Divergence and conflicts.** Main advanced eight commits over `60def85`, touching 14 paths. Of the
three files the feature modifies, main had changed **only** `knowledge/ProjectOS Reports Index.md`;
`package.json` and `projectos/validators/validate-all.cjs` were untouched by main, so they applied
cleanly. Exactly **one** conflict resulted, in the Reports Index: three main rows on one side, the
credential-router row on the other. Resolved by hand — all three main rows kept in their original
order, the credential-router row placed above them. No `ours`/`theirs` blanket strategy was used.

**Boundary and byte integrity.** Final diff versus main is exactly **37 paths**. All **34 added paths
are byte-identical to `f52a5d53`** (verified per-path with `git diff --quiet`); this addendum is the
only content added to the feature report. `package.json` 47 → 52 scripts, the five credential-router
scripts and no others, with `dependencies` and `devDependencies` byte-identical to main and no
lockfile change. `validate-all.cjs` gains exactly the three router validators, no duplicates, nothing
removed. Reports Index: one credential-router row (by phase column), every main row preserved, all
rows 7 columns.

**Integrated validation.** Registered validator modules **112 → 115**, exactly the three new router
validators. `val-projectos-credential-vault1a` PASS, `val-projectos-session-router1a` PASS,
`val-projectos-credential-router-adversarial1a` PASS. `validate-no-secrets` PASS,
`validate-forbidden-actions` PASS, `validate-examples` PASS. `node --check` clean on every added
`.cjs`; every added `.json` parses. PowerShell `Parser::ParseFile` on the credential-store adapter:
**0 errors, 461 tokens** (the feature report recorded 435 tokens for the same byte-identical file —
a difference in tokenizer accounting, not in the file). `git diff --check` clean.

**Synthetic Windows Credential Manager E2E, re-run on the integrated tree.** Synthetic values only,
against the real store: initial `ProjectOS` inventory 0 → set → retrieve with `roundTripMatches=True`
→ metadata-only listing shows the target name with `listContainsValue=False` and the inventory rising
0 → 1 → project isolation (a sibling synthetic project's target returns not-found on both `exists` and
`get`) → delete → final inventory back to 0 with the target gone. **Inventory restored; no ProjectOS
synthetic test entry remains.** No real GitHub, Supabase, Vercel, database or service-role credential
was entered at any point.

**Observation found during that E2E — reported, not fixed.** `list -Prefix 'ProjectOS/synthetic-'`
returns an empty set with exit 0 while the entry demonstrably exists. The adapter validates a prefix
as whole path segments and hands `Prefix + '*'` to `CredEnumerate`, which does not match a
partial-segment filter. A whole-segment prefix (`ProjectOS`, or the full project prefix) lists
correctly. The effect is that a partial-segment listing looks empty rather than erroring, which could
mislead an operator into believing no credentials exist. This is pre-existing feature behaviour, not
an integration regression, and the file is byte-identical to `f52a5d53`; fixing it here would break the
byte-integrity requirement, so it is recorded as a carry-forward for the feature owner.

**Trust and authority.** Re-confirmed on the integrated tree: the owner registry resolves only under
`%LOCALAPPDATA%\ProjectOS` with no `--state-dir` escape; the credential value is never a CLI argument
and reaches the adapter solely through a child-scoped environment variable; listings return names only;
the CLI exposes no flag that can supply a value; `gh auth switch` appears nowhere as a dependency. No
fail-closed path was weakened by integration.

**Accepted limitations L1–L5 carry forward unchanged** and still block real credential onboarding,
production credentials, high-risk operation activation and phase closure. Pre-onboarding gates C4–C7
remain mandatory and none was started.

**Programme position unchanged:** `acceptedPhaseCount` 4 / 19, `completionPercentage` 21.1, Phase 13
CLOSED, `EXECUTION_READY` false, `installationAuthority` NotAuthorised, `86ae19c` and `a43898d` OPEN.
`current-state` and the crosswalk were not touched. This phase remains **AWAITING REVIEW**; an
integration-branch push does not close it.

### 16a. Independent reviews run against the integrated tree

**Code review — clean.** 0 CRITICAL, 0 HIGH, 0 MEDIUM. It independently re-derived the integration
arithmetic: 47 → 52 scripts with the previous 47 byte-identical, 112 → 115 validator registrations
with no duplicates, and a Reports Index diff that is a pure insertion (one `+` row, zero `-` lines)
with all 88 data rows at 7 columns. One LOW, cosmetic: the audit-record builder is near-identical in
`vault.cjs`, `operation-gate.cjs`, `security/broker.cjs` and `security/operation-broker.cjs` and could
be factored into one helper. Not a defect; not fixed here, since three of those four files sit outside
this integration's boundary.

**Security review — no new CRITICAL or HIGH.** It re-verified the controls that matter rather than
trusting the feature report: the `--state-dir` trust-anchor escape is genuinely closed (no flag, env
var or config path reintroduces it); provider identity is confirmed before any credential value is
touched; grants are single-use, opaque and TTL-bound, with a `WeakSet` identity check that rejects a
hand-built look-alike; the child environment is built fresh with every provider variable scrubbed and
`process.env` never written; `realpathSync.native` plus case-folding make the checkout-root and lease
comparisons real rather than string-deep; a lease with a live PID is never reclaimed; and the
production profile cannot receive a session-projected credential at all.

It also tested one suspicion empirically instead of reporting it as a finding: whether
`router.cjs`'s `spawn` could be hijacked by a malicious checkout planting `git.exe`/`npm.cmd` in the
session cwd. Planting a fake executable and spawning without a shell on this host resolved the real
binary from `PATH`, so the hijack does not reproduce. Recorded as defence-in-depth hygiene — routing
that spawn through the same `resolveExecutable` used by the operation gate — not as a live defect.

**Two findings recorded, not fixed, because §9 requires the 34 added paths to stay byte-identical to
`f52a5d53` and this prompt authorises only this addendum:**

- **S-1 restated (CRITICAL by classification, already accepted as L1).** Windows Credential Manager
  entries are readable by any code running as the same Windows user via a direct `CredRead`. No policy
  layer above a per-user OS store can prevent that. Already documented in `docs/credential-router.md`
  and in the report's own threat review; restated here so the merge inherits it as a conscious
  acceptance rather than silently.
- **MEDIUM — `validateMcpConfig` is unwired.** `env-projection.cjs` exports `validateMcpConfig` and
  `extractPlaceholders`, and `docs/credential-router.md` describes the router as refusing a session
  when an `.mcp.json` placeholder has no declared variable. Confirmed independently: the only callers
  are the two new validator files; nothing in `router.cjs` or the CLI reads a checkout's `.mcp.json`.
  Nothing insecure is produced — it fails safe by omission — but the documentation currently claims
  enforcement that no runtime path performs. Read it as "the logic exists and is unit-proven", and
  wire it into `start()` in a follow-up phase.

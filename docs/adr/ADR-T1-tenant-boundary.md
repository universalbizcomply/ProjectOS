# ADR-T1 — Tenant boundary: who the work is for, and what that does not yet stop

**Status:** ACCEPTED by the owner, 2026-11-01: decision D10, "Accept it (Recommended)", recorded in `docs/changes/delta_spec.md`.
Written in phase PROJECTOS-TENANT-CONTRACT1A (plan v1.28, V4 Stage 2). The design was approved by the
owner in the same delta, revision 2, with decisions D1–D6. D10 also confirms the domains: projectos and
polygo in Develop, seo-agency in Business. **Only the owner marks an ADR Accepted.**

**Context:** ADR-K1 fixes the task envelope and the permission classes. It leaves `tenant` and `domain`
as "new, derived". This ADR says what they are derived from, what the kernel and the database refuse
because of them, and what they still cannot stop.

**Read §10 and §11 first.** Stage 2 stops the kernel's own routes and the database. It is not yet a
boundary against a hostile worker.

## 1. Principal

- **The principal is the Windows operator plus the kernel-bound work context:** which project this run
  or session is for. Both come from the kernel.
- **A Supabase identity carries no kernel authority.** Sign-in reaches the cloud tables only. A JWT
  releases no credential, selects no project and passes no gate.
- `principal` and `actor` in the envelope are ADR-K1's. This ADR adds no new role.

## 2. Tenant versus domain

- **Tenant** = whose data and authority.
- **Domain** = Develop, Business, Personal or Phone.
- Each project has exactly one tenant and one domain. A tenant can hold several domains.

Two tenants exist (owner decision D2, "Agency apart, rest mine (Recommended)"):

| Tenant | Holds |
|---|---|
| `owner-personal` | ProjectOS, PolyGo and the owner's other projects |
| `agency-business` | The SEO agency |

The registry lists only the three projects the Stage 2 exit proof needs. An unlisted project is
refused by name (`TENANT_UNKNOWN`) and never defaults to the owner, so a new project needs a
`tenant-registry-change`. The Add Project wizard is not changed until Stage 6.

**D2 names tenants only.** The domain on each registry line is the lead's reading of what the project is,
not an owner decision.

## 3. The registry and its trust basis

`projectos/security/tenant-registry.json` binds `projectId@repository@governedRoot` to a tenant and a
domain. The repository is canonicalised by `parseRemoteUrl`, the rule the installation allowlist uses.

- **Why the installation and not the project.** A project's `.projectops/` is writable by that
  project's own work, so a tenant recorded there could be moved by the work it governs (F8).
- **For `projectos`, the installation is the project.** One checkout wears both hats, so that rationale
  does not hold: a ProjectOS phase can hold a write grant on this very file. Only committed bytes and
  the `tenant-registry-change` limit below stand between its own work and its own tenant.
- **Committed bytes only,** read from the installation's git object store at `HEAD` of the installation
  checkout: `git show HEAD:./projectos/security/tenant-registry.json`, after confirming the path is
  committed and unmodified, the same read the allowlist uses. A working-tree edit has no authority.
- **Whole file before any match.** A duplicate project id, repository or root, or a wildcard in any
  binding field, refuses the entire registry, including its perfect lines. `parseTenantRegistry` is the
  rule; the schema cannot express uniqueness.
- **Changing it is P5.** `tenant-registry-change` is in the action registry, and the intent is that the
  owner made the file's last commit, because the allowlist reader trusts any commit at HEAD.
- **That check cannot do what it says.** `tamperProof` stays false. **All commits on this machine carry
  the name Murad, agent commits included.** So owner-last-commit cannot tell the owner from an agent, and
  `tenant-registry-change` protects nothing beyond repo write access until an owner-only signature or an
  owner-gate receipt naming the registry blob sha exists. **PROJECTOS-TENANT-PRINCIPAL1A chooses one of
  those two.** Re-committing the file changes nothing, whoever does it, and neither does committing under
  another git name. This phase's transcription of the registry is such a commit: the owner's authority for
  its content is D2, not the commit.

The action registry, `projectos/security/action-registry.json`, is ADR-K1 §1 made real. It is held on
the same terms: changing it is the P5 action `action-registry-change`, with a floor in code, and the
limit above applies to it equally. It reads both vocabularies without changing either.

## 4. Derived, never supplied

- `resolveTenant` is the only source of a tenant binding. The binding is branded by a private `WeakSet`,
  so a hand-written copy is refused at run time.
- Worker text, argv, environment variables and route text are ignored (R2): the envelope minting
  code reads a fixed list of request fields, and none of them can say whose the work is.
- A child envelope must equal its parent's `tenant`, `domain`, `project`, `environment` and
  `principal` (R3). The principal is added to ADR-K1's list here: a child acting as someone else is a
  different authority, not a narrower task. Cross-tenant access is never a child. It is the P5 action
  `cross-tenant-access`, and each use is a new root envelope in the data-owning tenant (ADR-K1 §4).
- **Envelope scope for Stage 2:** minted where a tenant can be crossed: run start, credential release,
  broker call, Control Center project selection and MCP bridge read. Other operations are not yet
  enveloped; that is Stage 4.

## 5. Linked worktrees

Governed runs use linked worktrees, and the allowlist refuses them because a `.git` file lets a
directory borrow another repository's history. Copying that refusal would make every worktree run
`TENANT_UNKNOWN`. Trusting the worktree's own claim would repeat F8. So:

1. **A linked worktree has no identity of its own.** It takes the project, tenant and domain of the
   registered root that lists it. It is never a registry entry.
2. **The proof is asked of the registered root:** `git -C <governedRoot> worktree list --porcelain`,
   where `<governedRoot>` comes from the registry. The worktree's own `.git` file, and
   `--git-common-dir` run inside it, are rewritable from inside and count for nothing. A `prunable`
   record counts for nothing either: its directory is gone, and something new at that path was not
   attached by anyone.
3. **The origin must still match** the registered repository. A submodule-style `.git` pointer is not in
   the listing and is refused. A listing means nothing apart from the root that gave it, so one taken
   anywhere else attaches nothing, and a checkout at or under ANOTHER entry's root is refused even when
   listed. The registry refuses a root inside another for the same reason.
4. **It grants tenant identity and nothing else.** The installation allowlist guards gatekeeper spend
   only, not session release, so it does not cover this. **Worktree tenant identity alone must never
   release a secret.** The door's grant port is handed `via`, so a port can refuse a worktree binding.
   PROJECTOS-TENANT-CREDENTIALS1A decides what else a release from a worktree needs.
   The registry is always read from the installation, never from the worktree.

**Limit.** Anything running as the owner's Windows user can run `git worktree add` from the registered
root. The rule proves the repository attached the directory, not that a person meant it. That is the same
one-user reach as §10's first limit.

## 6. Credential classes

The five-segment reference format stays, so no stored secret is re-entered. Enforcement arrives in
PROJECTOS-TENANT-CREDENTIALS1A.

| Class | Reference | Rule |
|---|---|---|
| **Project** | `ProjectOS/<project>/…` | Inherits its project's tenant |
| **Tenant** | `ProjectOS/tenant.<tenantId>/…` | Reserved segment, for example the agency's Google account. Matched case-insensitively, because Windows target names may be. A real project id may not start with `tenant.` in any case, and the registry refuses one |
| **Platform** | The gatekeeper key | Serves every tenant through the broker. Released to none |

Each credential declares its **reach**. An account-wide token is never projected into another tenant's
session (F9). A token's reach is declared per credential rather than assumed, because Supabase token
scope was not confirmed live.

**OPEN, the owner decides at PROJECTOS-TENANT-CREDENTIALS1A.** `credential-release` is P5, and session
release has no owner step today, so nothing can yet answer the door's grant port for it. A P5 grant source
for it must be decided there. This ADR does not invent one.

## 7. The database, the owner and the service role

- **The database boundary holds for clients.** RLS and table grants stop a signed-in or anonymous
  client. Migrations and proof are PROJECTOS-TENANT-RLS1A.
- **Postgres is never authority.** `tenant_id` in the cloud tables is a copy of the binding. Where they
  disagree, the git registry wins, and no kernel decision reads the copy.
- **The owner sees both tenants.** One owner JWT and one owner desktop see both, by membership. That is
  not a cross-tenant breach. It is also not the platform-owner access ADR-K1 §4 rules out: it holds only
  because the owner is a member of both, and a tenant whose owner is someone else would have no such
  membership. Cross-tenant refusal applies to **work bound to a project**, including work the owner
  started.
- **The service role bypasses RLS entirely,** and so does any token that can reach it. RLS is no
  boundary against a holder of either. No kernel route uses the service role for tenant data.
  `service-role-key` stays an operation credential, released for one owner-gated command only.

## 8. The envelope as built

`core/src/taskEnvelope.ts` implements R1–R5 as pure rules. The points the code settles:

- **Provenance is not shape.** The door admits only an envelope this module branded. A persisted envelope
  comes back through `readmitEnvelope`, which derives `tenant`, `domain`, `project`, `environment` and
  `actionClass` again, requires `principal`, `actor`, `subjectHash`, `idempotencyKey` and `parentEnvelopeId`
  to equal what the kernel states, holds `budget` and
  `expiry` to limits the caller must supply, holds `scope` inside the allowed scope, and refuses a record
  already expired.
- **Minted is not admitted.** The brand says the kernel built an envelope; a separate mark, set only after
  the door has written its line, says it was admitted. `mintCrossing` and `recordExecution` require the mark,
  so a run refused under R4 links nothing, and a forged or expired envelope gets no execution line.
- **An envelope budget is a per-call ceiling, and the ledger is the cumulative cap.** A crossing is held to
  its run's budget, and nothing draws the run down, so several crossings may together pass it. There is
  deliberately no second ledger: `gatekeeperCostLedger` already refuses a paid call before dispatch, against
  committed caps.
- **The door gates the class.** P6 is refused always. An unregistered action mints at P5 (R5) and is
  refused by name, and the attempt is recorded. P4 has no grant to give (ADR-K1 §4). P3 and P5 are refused
  unless the grant port confirms a grant, each by its own named rule, so nothing is admitted silently.
  **P3's grant source stays the technical gate, wired by later phases.** Until then the port answers for it.
- **Boundary crossings are roots.** `run-start`, `credential-release`, `broker-call`,
  `project-selection` and `bridge-read` are root envelopes, never children, and R3 is not loosened for
  them. So `environment` can be honest: `broker-call` and `push` are `production`, because each reaches
  something live outside this machine, and `commit` stays `local`. A push is therefore a root too.
- **The link to the run is not optional.** `RUN_LINKED_ACTIONS` names `credential-release`, `broker-call`,
  `commit` and `push`, and the door refuses them unless `mintCrossing` minted them. It requires a branded,
  unexpired run, the same `tenant`, `domain`, `project` and `principal`, and expiry and budget within the
  run's, and it derives the single `run:<envelopeId>` in its scope, so a caller can neither supply nor add
  one, and a credential release can always be traced to the run that asked. A persisted crossing loses
  its link and is minted again. `run-start`, `project-selection` and `bridge-read` stay plain roots.
- **Only v2 exists.** ADR-K1 describes v1 for Stage 1, but no v1 envelope was ever built, so there is no
  default to fall back on.
- **`action` is added to ADR-K1 §2's table, and it is the one addition.** §2 hashes it without listing it,
  and a record naming a class but not the action is not an audit. `registered` and the binding's `via` go
  on the record line, never on the envelope, because the owner accepted ADR-K1.
- **The kernel supplies `principal`, `actor`, `subjectHash`, `scope` and `budget` to pure code.** That
  they are derived rather than relayed from a worker is proved at the call sites, which arrive in
  PROJECTOS-TENANT-PRINCIPAL1A. The pure code proves shape and no widening.

Until then the records and rules exist and **nothing enforces them at run time.**

The action registry also lists the five Stage 2 boundary actions, because PROJECTOS-TENANT-PRINCIPAL1A
mints envelopes for them and has no write path to the registry. Each has a floor in code. `run-start` is P2
because what a run spends is enveloped separately: its paid calls are P3 `broker-call` roots, which keeps
ADR-K1 §3 true.

## 9. Accepted limits for one owner

- **Account-wide `stop-work`.** `projectos stop` and the bridge's `stop-work` halt every tenant on this
  Windows account, so work bound to one tenant can stop another's. This is accepted while one owner
  holds both tenants, because stopping is always safe and both are his. It must be scoped, or restricted
  to the owner, before a second party's agent reaches the bridge.
- **One user.** Everything runs as one Windows user, for one owner, on one machine. There is no second
  human principal, no per-tenant Windows account and no per-tenant process isolation. Tenancy here
  separates the owner's own contexts from each other. It does not yet separate two parties.

## 10. What Stage 2 does not prove

- **A worker can still reach any tenant's secrets and files** outside the kernel, as the owner's Windows
  user (F7). Candidate code runs as the owner in validator checks, and secrets are generic Credential
  Manager entries readable by any process of that user, including every tenant's secrets and the
  gatekeeper key. Writes are bound to the plan; reads are not. Stage 2 stops the kernel's routes and the
  database. The real fixes are Host service custody for secrets and Stage 4.3 isolation for files.
- **The registry's owner check rests on a git name,** which cannot tell the owner from an agent (§3).
- **No product flow uses the tenant tables yet** (F2). The database boundary is proved by the harness.
- **Eight of the nine connector scenarios** are defined in Stage 2 and first run in Stage 5.
- **One owner sees both tenants,** by membership (§7).

## 11. The owner's hard rule

**No other party's data or credentials go on this machine until Stage 4 isolation and service-held
secrets are done.**

This is D4, "Accept for now, with a rule (Recommended)". §10's first limit is accepted only on that
condition. A green exit proof does not lift it: only Host service custody for secrets, plus Stage 4.3
isolation for files, plus the owner's own decision, does.

## 12. Alternatives rejected

- **The tenant inside the project's own config.** It is writable by the work it governs (F8).
- **Refusing linked worktrees outright.** It would stop every worktree run for a risk the
  registered-root listing answers (§5).
- **Trusting a worktree's `.git` file or `--git-common-dir`.** Both are rewritable from inside it.
- **A default tenant for unlisted projects.** The default would be the owner's, so a mistake would be
  invisible.
- **Matching the first registry line.** A contradiction further down the file would never be seen.
- **Keying tenant on the Supabase identity.** One owner holds both tenants, so the JWT cannot say which
  project the work is for.
- **Signing every authority commit now.** It would stop the transcribed-decision commits that keep owner
  acts near zero. Revisit before Stage 5. A narrower owner-only signature on the registry stays open to
  PROJECTOS-TENANT-PRINCIPAL1A (§3).

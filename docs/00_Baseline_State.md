# 00 — Baseline State (brownfield audit)

Audited 2026-10-28 at commit `2baff14` (branch `projectos-autonomy-bootstrap1a`, equal to `main`).
This is a map of what exists. It is not a design. Where something does not exist, it says so.

ProjectOS is a local-first governance runtime for AI-built software. A worker (the Claude Code CLI)
implements approved plan phases. The ChatGPT gatekeeper reviews each phase. ProjectOS carries every
phase through checks, review, commit, push and closure, and keeps protected actions with the owner.

## 1. Tech stack and versions

Manifest ranges are shown, with lockfile-resolved versions in parentheses where known.

| Area | Technology | Version |
|---|---|---|
| Runtime | Node.js | 24.x (24.14.1 recorded). There is **no** `engines` field, `.nvmrc` or `.node-version`. |
| Language | TypeScript, `strict`, target ES2022, module NodeNext (agent, core, daemon) / ESNext with Bundler resolution (control-center) | ^5.7.2 (5.9.3) |
| CLI and loop | `@projectos/agent` 0.1.0 (ESM, bin `projectos`) | depends on `@projectos/core` via `file:../core` |
| Kernel | `@projectos/core` 0.1.0 (pure TypeScript, no I/O) | — |
| Tests | Vitest, `@vitest/coverage-v8` | ^2.1.8 (2.1.9) |
| Desktop UI | React, react-dom | ^18.3.1 (18.3.1) |
| Bundler | Vite, `@vitejs/plugin-react` | ^5.4.11 (5.4.21), ^4.3.4 |
| Desktop shell | Tauri 2: `@tauri-apps/api`, `@tauri-apps/cli`, `plugin-opener`; Rust `tauri` 2 | ^2.1.1 (2.11.1), ^2.1.0 (2.11.4), ^2.2.5 (2.5.4); Rust tauri 2.11.5 |
| Desktop E2E | WebdriverIO, `@wdio/tauri-service` | ^9.30.1, ^1.3.0 |
| Cloud data (optional) | `@supabase/supabase-js` | ^2.47.10 (2.110.1) |
| Host service | Rust, 40 standalone crates under `projectos/host/` (edition 2021, no workspace, no `rust-toolchain`) | rustc 1.96.1 recorded; `windows` 0.61.3, `windows-sys` 0.59, `serde` 1, `sha2` 0.10, `zeroize` 1 |
| Validators | CommonJS scripts, `projectos/validators/` (154 files) | 147 registered in `validate-all.cjs` |
| Watchdog | TypeScript (Deno typecheck, `node --test`), Postgres schema | `@projectos/watchdog-core` 0.1.1 |
| Other packages | `@projectos/bridge-daemon` 0.1.0, `projectos-vscode` 0.1.0 (VS Code ^1.90.0), `projectos-dashboard-hosting` (Vercel) | — |

There is no CI (`.github/` is absent). Gating is done by validators, tests and git hooks.

## 2. Data: records, then SQL

### 2a. Governed JSON records (the system of record)

ProjectOS's own state is **versioned JSON in git** under `.projectops/`, read from the committed tree
(`git show HEAD:`) wherever authority matters. The full field list is in `05_Schema.md`. Relationships:

```
project-config.json ──planMemory──▶ plan-<obj>-<digest>.json ──phases[]──▶ phases/<PHASE>.json
objectives/<id> ─▶ drafts/<id> ─▶ plan-decisions/PLANDEC-* ─(activate)─▶ plan-*.json + current-state-*.json
phases/<PHASE> ─▶ execution/<session>.{brief,session,invocation,evidence,findings,effects}.json
            ─▶ GKREQ-* question ─▶ gatekeeper-ledger.json (spend) + gatekeeper-decisions/GKDEC-GKREQ-*
            ─▶ validation/<sha>.json + closure/<PHASE>.json (G4 evidence)
            ─▶ CLREQ-* question ─▶ closure/decisions/<PHASE>.json (CLDEC-*) + closure/waits/<PHASE>.json (ignored)
            ─▶ phase advance --to closed (owner or delegated) ─▶ consumedAt stamped
authority/closure-delegation.json, gates/<PHASE>.<gate>.json, gatekeeper.json: owner-committed authority
```

### 2b. SQL (two optional Postgres/Supabase schemas)

| Schema | Source | Tables | Row-Level Security |
|---|---|---|---|
| Control Center cloud | `projectos/control-center/supabase/schema.sql`, `interactive.sql` | `public.projects` (PK `id text`), `public.phases` (PK `id uuid`, FK `project_id → projects.id` on delete cascade, unique `(project_id, phase_id)`) | Enabled. **Policies are `to authenticated using (true) with check (true)`: every signed-in user may read and write every row** (see Risks). |
| Watchdog | `projectos/watchdog/sql/migrations/0001_watchdog_schema_v1.sql` | `watchdog.schema_migrations`, `meta`, `run`, `check_result`, `incident`, `notification`, `job`, `release_identity`, `sentinel_liveness`, `config` | Enabled on all ten tables with **no policies**, and all privileges revoked from `public`, `anon`, `authenticated` and `service_role`. Access only through `public.watchdog_*` SECURITY DEFINER functions (`search_path ''`), executable by `service_role`. |

The Control Center uses Supabase only if it is configured. Otherwise it falls back to a static seed
(`src/data/supabase.ts`). The governed runtime never reads Supabase.

## 3. Entry points, authentication and dependencies

### 3a. Active entry points ("API routes")

- **CLI** (`projectos/agent/bin/projectos.js` → `src/cli.ts`). Main commands:
  - `run --dry-run|--execute [--continue]`;
  - `continue --execute|--dry-run` (the router);
  - `closure prepare|request|resume|status --id`;
  - `phase new|advance|show|list|sync-state|closure-eligibility`;
  - `plan [draft|drafts|show|decide|approve|activate]`;
  - `reconcile`, `approve`, `close` (always refuses), `status`, `doctor`, `validate`, `report`,
    `workforce`, `mcp`, `init`, `install`.

  The full table is in `02_AppFlow.md`.
- **npm scripts** (repo root):
  - `credentials|session|providers|operation` → `projectos/scripts/projectos-credential-router.cjs`
    (credential input only from a hidden TTY prompt);
  - `validate*`, `report:*`, `watchdog:*` and others.
- **Tauri commands** (`control-center/src-tauri/src/app.rs`): `daemon_request_snapshot`,
  `daemon_governed_command`, `daemon_status`, `identity_status`, `installed_host_status`,
  `register_project`, `set_credential`, `pick_folder`, `pick_file`, `inspect_folder`,
  `prepare_folder`, `import_project_file`, `list_project_files`.
- **Governed verbs** (`control-center/src/governed/governedCommands.ts`, a closed set mapped to typed
  flags, never argv): `refresh`, `phase.start|advance|stop|resume|close`, `approval.request|decide`,
  `report.write`, `plan.draft|decide|activate`, `project.select`, `run.start|resume|stop`.
- **Host service**: `ProjectOSHost.exe`, a Windows SCM service (`host/service-host`).
  - It answers read-only status on one local named pipe.
  - The protected review exchange is **dormant**: no production capability mint.
- **External calls**:
  - OpenAI `POST /v1/responses`, only through the trusted broker;
  - the Claude Code CLI (worker);
  - git;
  - PowerShell → Windows Credential Manager;
  - GitHub REST (watchdog sentinel);
  - Resend email (watchdog);
  - Supabase (Control Center).

### 3b. Authentication and authority flow

1. **Owner identity.** The owner is `governance.owner` in the active plan (`resolveRecordedOwner`).
   An owner commit is judged by git identity (`closureWait.ts` `ownerCommitIdentityProblems`). A git
   name is not proof of a person, and the code says so (`tamperProof: false`).
2. **Plan authority.** Plans are approved like this:
   - `plan draft` records an objective and draft;
   - `plan decide` writes PLANDEC-* (committed), binding the draft and its digest;
   - `plan activate` / `plan approve` materialises the plan and recomputes PLAN READY.
3. **Delegation.** The committed `authority/closure-delegation.json` carries scopes from
   `DELEGABLE_SCOPES`:
   - `phase-closure`, `programme-closure`, `gatekeeper-review-decisions`, `technical-continuation`;
   - `closure-decision-commit`, which counts only if the owner made the last commit to the record.
4. **Owner floor.**
   - `ABSOLUTE_OWNER_ONLY` = phase-closure, secrets-handling, payment-or-live-charge.
   - Commit and push are released only by a proven technical delegation.
5. **Gatekeeper.** Three routes:
   - interactive (owner relay);
   - unattended through the ProjectOSHost attestation;
   - unattended through the trusted installation broker, on the committed opt-in
     `"route": "installation-broker"`.

   Configuring both unattended routes is refused.
6. **Credential.** The agent process never holds the OpenAI key (`unprovisionedResolver`). The broker:
   - runs from committed bytes;
   - checks `installation-project-allowlist.json` and the phase's committed
     `gates/<PHASE>.secrets-handling.json`;
   - reads the key from Windows Credential Manager and calls a fixed endpoint.
7. **Closure.** G4 facts come from git (`closureGate.ts`). A decision is committed by the owner, or by
   ProjectOS under `closure-decision-commit` for in-call answers only. Then
   `phase advance --to closed --delegated`.
8. **Control Center sign-in (optional).** Supabase email and password (`Login.tsx`). This authorises
   only the cloud tables in 2b. It grants nothing in the governed runtime.
9. **Host IPC.** The pipe is local-only and admits exactly the enrolled owner SID. Facts come from the
   Host, never from the wire.

### 3c. File dependency graph (layering)

```
bin/projectos.js ─▶ cli.ts ─▶ commands/* (run ⇄ closure → phase)
   ─▶ loop/* (runner → brief, workers, verification, pinnedValidators, outcome,
              gatekeeperTurn | interactiveGatekeeper, technicalContinuation, selection, degradedMode)
   ─▶ loop/transports/* (brokeredHttpPort, nodeHttpPort, openaiResponses, closureResponses)
   ─▶ @projectos/core (barrel index.ts; ~50 agent files import it)
Hubs: system.ts (48 importers), context.ts (35), governedContext.ts (17), flags.ts (15),
      gatekeeperConfig.ts (11); core types.ts (22), closureAuthority.ts, gatekeeperTransport.ts.
Control Center: React renderer ─▶ Tauri commands (Rust) ─▶ sidecar/host.mjs ─▶ @projectos/agent
      (in-process; only run.start/run.resume spawn the CLI).
Broker: brokeredHttpPort.ts ─▶ git show HEAD:projectos/security/gatekeeper-transport-broker.cjs ─▶ node.
```

## 4. Critical core files — NEVER modify without explicit owner approval

| Area | Files | Why |
|---|---|---|
| Closure authority | `projectos/core/src/closureAuthority.ts`, `closureEligibility.ts`, `closureDecision.ts`, `closureTransport.ts`; `projectos/agent/src/closureGate.ts`, `closureWait.ts`, `commands/closure.ts`, `commands/phase.ts` | Who may close a phase, on what evidence, and with which committed decision |
| Owner floor and permissions | `projectos/core/src/ownerOnlyActions.ts`, `permissions.ts`, `phase.ts`, `ownerGateReceipt.ts`, `technicalContinuation.ts`, `gatekeeperDecision.ts`, `gatekeeperMode.ts`, `gatekeeperTransport.ts` | The actions only the owner may take, and the lifecycle |
| Gatekeeper composition and spend | `projectos/agent/src/commands/run.ts` (`composeGatekeeper`, `brokerRouteOptedIn`, `trustedBroker`, `dispatchContinueRoute`), `loop/gatekeeperConfig.ts`, `loop/gatekeeperHandoff.ts`, `loop/technicalContinuation.ts` | Route choice, delegation reading, spend admission, ProjectOS's own commits |
| Broker and credentials | `projectos/security/gatekeeper-transport-broker.cjs`, `installation-project-allowlist.json`, `trust-boundary.json`, `broker.cjs`, `operation-broker.cjs`, `redaction.cjs`; `projectos/credentials/*`; `projectos/scripts/projectos-credential-router.cjs`; `agent/src/loop/credentialResolver.ts`, `installation/projectAllowlist.ts`, `installation/brokerAnsweredState.ts`; `control-center/src-tauri/src/set_credential.rs` | The key never reaches the agent; who may spend it |
| Write grants and judges | `projectos/agent/src/loop/workers.ts`, `pinnedValidators.ts`, `verification.ts`, `correctionBoundary.ts`, `candidateIdentity.ts`, `localCandidateCommit.ts` | What a worker may write; validators judge from the base commit |
| Governance engines and plans | `projectos/agent/src/governanceEngines.ts`, `nodeGovernanceEngines.ts`, `planApproval.ts`, `planDecision.ts`, `planAuthoringPermission.ts`; `projectos/validators/plan-governance-engine.cjs`, `plan-discovery-engine.cjs`; `projectos/schemas/project-plan.schema.json`, `current-project-state.schema.json` | How plans become authority |
| Validators (pinned rules) | `projectos/validators/validate-all.cjs`, `val-projectos-boot-continue1a.cjs`, `val-projectos-closure-transport1a.cjs`, `val-projectos-trust-boundary1a.cjs`, `val-projectos-gatekeeper-contract1a.cjs`, `val-projectos-live-gate-owner-floor1a.cjs`, `val-projectos-technical-continuation1a.cjs`, `validate-no-secrets.cjs`, `validate-forbidden-actions.cjs` and the credential validators | They pin the rules above |
| Authority records | `.projectops/authority/*`, `.projectops/gates/*`, `.projectops/plan-decisions/*`, `.projectops/closure/decisions/*`, `.projectops/plan-withdrawals/*`, `.projectops/gatekeeper.json`, `.projectops/project-config.json`, active `plan-*.json` | Owner authority; count only when committed |
| Rust host | `projectos/host/**` (in particular `service-host`, `host-authority`, `windows-local-ipc`, `gatekeeper-attestation`, `trusted-roots`, `crypto`, `windows-acl-policy`, `core`) | Service trust, IPC admission, attestation, ACLs, the only `unsafe` |
| Control Center boundary | `projectos/control-center/src/governed/governedCommands.ts`, `sidecar/host.mjs` | Closed verb set; the only CLI spawn |
| SQL | `projectos/watchdog/sql/**`, `projectos/control-center/supabase/*.sql` | Database privileges and RLS |
| Owner directive | root `CLAUDE.md` (local, excluded from git) | Owner's working rules |

## 5. Known risks found by this audit (not fixed; each needs an owner decision)

1. **Supabase RLS is effectively open to any authenticated user.** In
   `control-center/supabase/*.sql`, `public.projects` and `public.phases` allow ALL operations with
   `using (true) with check (true)`. If sign-up is open on that Supabase project, any new account can
   read and rewrite them. Fix: restrict to the owner's `auth.uid()`.
2. **No engines or toolchain pins.** Node and Rust versions are recorded only in reports. Fix: an
   `engines` field and a `rust-toolchain.toml`.
3. **Six validators exist but are not registered** in `validate-all.cjs`:
   `val-host-state-activation-wiring-10h`, `val-watchdog-conformance`, `validate-claude-worker`,
   `validate-speed-validation-cache`, `validate-v2-closure-evidence`, `validate-wsl2-provider`.
4. **The Tauri CSP is `null`** (`tauri.conf.json`).
5. **CSS drift in the Control Center.**
   - Variables used but never defined: `--os-accent`, `--os-line`, `--os-ink`, `--os-ink-dim`,
     `--os-inset`, `--os-mono`, `--warn-ink`.
   - Hard-coded dark colours in older screens.
   - A duplicate `.ocp-btn` rule.
   - An unstyled `os-primary` class.
   - A stale README view list.
6. **Open from the finish plans:**
   - D11: a plan with only worker self-review lets partial work close.
   - The key rotation is due at completion.
   - The `seo-agency` allowlist entry is temporary.
   - Authority commits are unsigned.

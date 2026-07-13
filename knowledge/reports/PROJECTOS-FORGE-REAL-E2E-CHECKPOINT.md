# ProjectOS Forge — Real E2E Checkpoint

> Durable resume record for the Forge Real-E2E activation (owner 12-gate plan) + the HARDEN1A security
> correction. Read this + git + the latest activation report on resume. Local-only until owner authorises a
> push. Remote must stay `4c3f076`.

**Last updated:** 2026-07-12 (HARDEN1B) · **Branch:** `projectos-v3`

## HARDEN1B (2026-07-12) — OS containment + trusted FS ledger + process termination (IN PROGRESS, local)

ChatGPT's HARDEN1B directive addressed the residual gaps HARDEN1A documented as accepted (OS sandbox) plus
worker-controlled-git trust, process termination, executable consistency, tool enforcement, evidence honesty.
New modules (all `projectos/bridge/`): `sandbox-provider.cjs` (fail-closed OS-sandbox contract + mock; NO
unrestricted fallback — real run w/o provider = BLOCKED OS-SANDBOX-NOT-CONFIGURED), `workspace-ledger.cjs`
(`git archive`→**.git-free** workspace via per-blob `git show`; trusted FS snapshot + diff = the authoritative
manifest, NEVER git status/diff/index/worker `.git`), `process-control.cjs` (bounded repeated tree-termination;
TERMINATED-CONFIRMED / TERMINATION-UNCONFIRMED / EMERGENCY-STOP-REQUIRED; unconfirmed ⇒ no reconcile, no
cleanup, evidence preserved), `executable-check.cjs` (ONE shared checker for capability-check + adapter — real
resolve+invoke, shim reject, existence-only fails), `invocation-profile.cjs` (fail-closed tool profile;
unverified/unknown-version ⇒ BLOCKED WORKER-TOOL-RESTRICTION-NOT-PROVEN; first-proof = inspect+edit only).
Rewrote `claude-worker.cjs` (sandbox→profile→exec→baseline→materialise→FS-before→spawn→**confirm death
first**→FS-after→trusted diff→path enforce→monitored-state reconcile "no residual drift detected"→dispose→
schema-v2 result). Rewrote `worker-policy.cjs` result = **schema v2** (honest fields: projectOsCommandsExecuted
/ workerCommandsObserved / workerCommandsObservationStatus / workerToolsPermitted+Verified / sandboxProvider+
Policy / canonicalVisibility / networkPolicy / processTerminationStatus / residualDriftStatus / filesInspection
Status; controls split technicallyEnforced|policyRequested|delegated|notVerified|outOfScope; **resultHash**;
**deep freeze**; buildResult THROWS on forbidden decision; validateResult{real} requires non-null identity).
Rewrote `owner-capability-check.cjs` (states READY-FOR-SYNTHETIC-VALIDATION / BLOCKED-OS-SANDBOX / -EXECUTABLE
/ -TOOL-RESTRICTION / -PROCESS-CONTROL / READY-FOR-REAL-WORKER-PROOF; security-vs-synthetic split; shared exec
check fixes the claude.cmd false-READY). Language corrected: NO "canonical untouched" — "no residual drift
detected across monitored state". Rewrote `validate-claude-worker.cjs` = **48 invariants (§11 + round-2), PASS, 0
env-skip**. `npm run validate` ALL PASS (61); diff-check clean; **zero workspace residue**. Capability check
here → BLOCKED-OS-SANDBOX (correct).

**HARDEN1B review round 1 (security+silent-failure+architect) → fixes applied:** security H1 (recursive
descendant enumeration both platforms + unknown≠dead under strict + terminationDetail surfaced), H2 (unified
`requireReal` so a real exe can't run under a mock), M1 (per-run controls — termination-confirm only enforced
when confirmed), M2 (mode-change detected), M3 (permittedCommands must be empty for first proof), M4 (network
allowlist needs concrete non-wildcard entries), L1 (header: ls-tree/show not git-archive), L2 (realpath shim
check). silent-failure 4×CRITICAL: #1 unknown-descendants-as-dead → fail-closed under strict; #2 null-pid
`kill(-0)` group-kill → posInt guards + spawn-error handled pre-terminate; #5 unreadable/new dir + special +
escapes folded into changedPaths (enforcement can't pass over); #10 no catch → added pipeline catch that sets
preserve + returns blocked("internal-error") (evidence never destroyed). Plus: pid-reuse false EMERGENCY-STOP
fixed (clean close = confirmed without re-probe), permittedExecutables cross-check, provider attest() hook,
gitMetaDigest READDIR-ERR sentinel, symlink-materialise fallback recorded, killTree dedup, validateResult{real}
on real runs, ledgerSummary in required, per-invariant validator isolation, resultHash "integrity" language.
Round-2 re-verification (security+silent-failure on the changed files) running. END STATUS target: IMPLEMENTED
LOCALLY — AWAITING CHATGPT REVIEW. No push/real-worker/Docker/install.

## Repository state (verified)

- Local HEAD advances per commit; before HARDEN1A: `68c6e82` (1B adapter `b3d8421` + review-bundle
  `68c6e82`). Remote `origin/projectos-v3` = `4c3f076` (frozen). Ahead 31 → grows with the HARDEN1A commit.
  Working tree clean between actions. Recovery branch `forge-baseline-2026-07-12`. No amended/rewritten
  history (the 1B commit was amended once pre-push to strip a stray subject prefix; nothing since).

## Environment capability matrix (this sandbox — unchanged)

`node projectos/bridge/owner-capability-check.cjs` →
claude **BLOCKED** (session-present-but-no-spawnable-cli) · docker **BLOCKED** (no binary) · supabase
**BLOCKED** (cli-error) · OVERALL **BLOCKED-OWNER-MACHINE-CAPABILITY**. node 24.14.1, local Postgres 18.4 ✓.

## HARDEN1A — FINAL design (after the ChatGPT + 5-agent ECC review round)

**Superseded interim note:** an intermediate disposable-*worktree* design was built, then rejected by review:
a worktree shares the canonical `.git` (objects/refs/hooks/config), and the untrusted worker controls the
`.git` it was being audited through (security C1/C2/C3). **Final design = throwaway `git clone
--no-hardlinks` (separate `.git`, `origin` removed, detached HEAD) + canonical-untouched proof by
ProjectOS-computed FILESYSTEM hashing (not git-status the worker could fake).** Files:

- **`projectos/bridge/worker-policy.cjs`** (NEW, pure) — trusted-policy binding (request carries CONTENT
  only; any control field → `request-policy-tamper`), minimal-env allowlist (no `process.env` spread;
  token-named vars dropped), ONE shared secret-shape source (prompt reject + output scrub), case-insensitive
  (Win/mac) allowed-path rules (cross-project `projectos/` + `.git` + abs/UNC/`..`/NUL guarded),
  `buildResult` (**throws** on a forbidden gate decision/field) + `validateResult`, `isUnsafeShim`.
- **`projectos/bridge/claude-worker.cjs`** (REWRITTEN, clone model) — orchestrator:
  fail-closed capability (no `claudeArgs` → BLOCKED; `.cmd/.bat` bin on win32 → BLOCKED) → canonical baseline
  **strict** verify → **`canonicalSnapshot` BEFORE** (tracked-file content hashes + clean status + git-meta
  content digest) → **`git clone --no-hardlinks` + remove origin + detach** → spawn worker IN THE CLONE with
  minimal env, argv+`shell:false`, timeout (tree-kill + **confirmed death**), output caps →
  **`canonicalSnapshot` AFTER, UNCONDITIONAL + FIRST** (even on killed paths) → drift ⇒ BLOCKED
  `canonical-mutated` (overrides) → enumerate clone changes (**strict**, both rename sides) → per-path
  enforce (allowlist/forbidden/`projectos/`/`.git`/symlink-escape) → **trusted change manifest**
  (path→content sha256; patchHash = hash of manifest; derivation failure ⇒ BLOCKED) → dispose clone, capture
  **real residue** → structured validated result (**no apply, no commit, no gate decision**).
- **`projectos/bridge/owner-capability-check.cjs`** (NEW) — read-only PASS/BLOCKED detection of claude CLI /
  Docker / Supabase + **owner-friendly presentation** (plain language, ordered next actions, no jargon, no
  creds/install/path-assumption).
- **`projectos/validators/validate-claude-worker.cjs`** (REWRITTEN) — **34 invariants** vs a synthetic CLI
  stand-in + REAL throwaway repos. Opt-in (spawns + git); this phase's MANDATORY security evidence.
  Standalone: **PASS (34 invariants)**.

## Defects found + fixed during HARDEN1A (5-agent ECC review + the validator)

Security: C1 worker rewrites its own `.git`→fake reconciliation; C2 hooks hashed by filename only; C3/H3
shared object/ref store lets worker create canonical branches/tags; H4 `policy.tools` never enforced (full
default tool access); M5 case-insensitive path bypass; dead ternary; UNC. Code: canonical check skipped on
killed paths; unguarded `execFileSync`→reject not fail-safe; no `maxBuffer`; patch failure silently
"success"; `.cmd` shim re-enters cmd.exe on win32; kill unconfirmed; `filesInspected` unpopulated. Silent-
failure: `gitTrim` null-collapse → false "no drift" (CRITICAL); canonical check happy-path-only; residue
hardcoded empty; `buildResult` silent coercion. Architect: git-level-only overstated header; asserts checks
not performed; duplicate forbidden-field/secret lists; shared-common-dir refs uncovered; no audit record on
non-happy outcomes. **ALL of the above addressed** by the clone rewrite + FS-hash canonical proof +
strict-fail-closed git + unconditional-first reconciliation + fail-closed tools + shim reject + real
residue + throwing `buildResult` + audit-on-every-outcome + honest header. Deferred (documented follow-ups):
route the result through `desktop-bridge` as a single approval choke point (arch-M1); a gated CI lane for the
opt-in validator (arch-M5).

## Validation

- `validate-claude-worker.cjs` standalone: **PASS (34 invariants)** — incl. direct-canonical-write,
  hook-content-edit, ref-creation, config-edit, fake-clone-`.git`-cannot-hide, fail-closed-tools, unsafe-
  shim, confirmed-kill, case-insensitive-forbidden, abs/UNC-reject.
- `npm run validate` → **ALL PASS (61 validators)**; `git diff --check` clean; **no clone residue**.

## Reviews (HARDEN1A)

- Round 1 (old worktree code): security + code + architect + silent-failure — surfaced the CRITICAL/HIGH set
  above, driving the clone rewrite. Round 2 (rewrite re-verification): security + silent-failure re-run on
  the new files. UI UX Pro Max / Claude Design: **UNAVAILABLE** in this environment — not fabricated; owner-
  facing capability-check UX done manually per ECC design rules. Findings + fixes in the review bundle report.

## Safety ledger (HARDEN1A)

Production: NO · Deploy: NO · Provider: NO · Real secrets: NO · Sends: NO · Payments: NO · Metered AI API:
NO · Network: NO · Pushed: NO · System software installed: NO (Docker/CLI absence recorded, not installed).

## Next exact safe action (resume here)

**On an OWNER MACHINE where `owner-capability-check.cjs` prints OVERALL READY-FOR-REAL-E2E** (Docker Desktop
running + spawnable `claude` CLI + Supabase CLI): wire `claudeBin`/`claudeArgs` to the real CLI + a trusted
`policy`/`operation`, run the real controlled-change + interruption/resume proofs through the worktree
adapter (Gate 1), then Gate 2 (real Supabase + auth + RLS + two-user isolation) and Gate 3 (reference-app
command → blueprint → synthetic-labelled owner approval → real generation via the worker → real
browser→Supabase round-trip), then Gates 4–12. Do NOT push. No production. Claude does not self-approve/close.

## HARDEN1C (2026-07-13) — provable readiness + operation-bound attestation + safe process ownership (IN PROGRESS)

Replaced declaration-based gates with operation-bound, technically-verified readiness. NEW modules
(projectos/bridge/): `attestation.cjs` (structured operation-bound attestation contract + verify + synthetic;
canaries, evidenceHash; boolean {enforced:true} fails), `invocation-detector.cjs` (tool-restriction DETECTION
record bound to exe content hash + CLI version + provider + policy; negative-capability test DENIED BY
TECHNICAL CONTROL; manual verified:true fails), `runtime-config.cjs` (SINGLE shared checkReadiness path for
capability-check + adapter; 9 checks; NO env markers), `owner-readiness-report.cjs` (self-contained offline
HTML readiness report — designed via ui-ux-pro-max: technical dark/light palette, SVG-not-emoji, icon+text
badges not colour-only, 4.5:1, security-first hierarchy). REWROTE `sandbox-provider.cjs` (provider-owned
OPERATION HANDLE lifecycle: spawn/status/enumerate/terminate/confirm/preserve/dispose + probeProcessControl
readiness + structured attest; PID handle forbidden for real runs), `claude-worker.cjs` (verify attestation +
detection record; spawn via operation handle; confirm via handle not reused PID; termination ENUM;
first-proof network-disabled gate; NOT APPLICABLE/NOT EXECUTED on early paths), `owner-capability-check.cjs`
(9 checks / 11 states via shared path, no env markers, --html). MODIFIED `worker-policy.cjs` (termination
enum + operationHandle* / processControl* fields; enforce not-overstated). REMOVED dead `invocation-profile.cjs`.
`validate-claude-worker.cjs` = **42 invariants PASS** (§11 41 + owner-UX). `npm run validate` ALL PASS (61);
diff-check clean; 0 residue; capability (no config) → BLOCKED-SANDBOX-IMPLEMENTATION. ui-ux-pro-max AVAILABLE +
used; "Claude Design" (named product) not present → frontend-design equivalent. ECC 3-agent round running.
END STATUS target: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. No push/real-worker/Docker/install.

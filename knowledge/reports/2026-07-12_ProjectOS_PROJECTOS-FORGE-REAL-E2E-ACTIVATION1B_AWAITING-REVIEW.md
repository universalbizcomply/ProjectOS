# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B — Owner-Machine Real E2E Report

**Programme:** ProjectOS Forge Real E2E · **Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B`
**End status:** **BLOCKED — REQUIRED OWNER-MACHINE CAPABILITY UNAVAILABLE.** Awaiting ChatGPT/Murad review.
**Not pushed. Not closed. No production/provider/send/payment/secret.**

---

## 1. Executive result

The execution environment for this session is **not** the intended owner machine — it is the same
non-interactive sandbox as 1A. **The two hard prerequisites are absent: the `claude` CLI and Docker.** So
the core of 1B — a real local Claude Code worker round-trip (Gate 1), Docker-backed local Supabase (Gate 2),
and the one-command reference app produced *through the real worker* (Gate 3) — **cannot be proven here and
was not faked.** What **was** achievable and delivered: the **governed Claude-CLI worker adapter** (the
connector that will invoke the real CLI on your machine) with its safeguards proven against a synthetic CLI
stand-in. This is honest partial Gate-1 *architecture*, not a real-worker proof.

## 2. Starting repository state (verified)

origin `universalbizcomply/ProjectOS`; branch `projectos-v3`; HEAD `4663530`; remote `origin/projectos-v3`
= **`4c3f076`** (frozen); **29 ahead / 0 behind**; working tree clean; `git diff --check` clean; recovery
branch `forge-baseline-2026-07-12` present; corrective commit `44c6dfa` present; no amended/rewritten
history. Identity/branch/history all as expected → proceeded.

## 3. Previous phase (1A) acceptance

1A PARTIAL ACCEPTED (per owner): real scaffold/materialise/install (+ dependency-pin defect → `44c6dfa`)/
build/Postgres/API round-trip/browser round-trip/teardown; plain Postgres is valid partial runtime proof,
**not** a substitute for the Supabase proof. That distinction is preserved here.

## 4. Environment capability matrix

| node | npm | git | npm-net | local Postgres | **Docker** | **claude CLI** | supabase CLI | playwright | tauri |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24.14.1 | 11.11 | 2.55 | ✓ | 18.4 ✓ | **✗ (not installed)** | **✗ (not on PATH / npm-global / install dirs)** | 2.103 (Docker-backed) | ✗ | ✗ |

OS Windows 11 (26200), MSYS. No tokens/credentials printed. Per the phase rule, missing Docker/CLI are
recorded as **OWNER-MACHINE TOOLING BLOCKED**; no system software was installed.

## 5–7. Claude CLI / Docker / Supabase discovery

- **Claude CLI:** not on PATH, not an npm global, not in the checked install locations. This process runs
  *inside* a Claude Code session, but no spawnable `claude` executable is exposed to the shell. Real worker
  invocation is **BLOCKED**. (No credential extraction was attempted.)
- **Docker:** not installed; daemon absent. **Supabase local (`supabase start`) BLOCKED.** Supabase CLI is
  present but Docker-backed.

## 8. Exact files changed (this phase, in the repo)

- NEW `projectos/bridge/claude-worker.cjs` — governed Claude-CLI worker adapter.
- NEW `projectos/validators/validate-claude-worker.cjs` — 13 safeguard invariants (opt-in).
- NEW `knowledge/reports/PROJECTOS-FORGE-REAL-E2E-CHECKPOINT.md`, this report, index row.
(The 1A scratch app + node_modules live in a gitignored temp workspace — the repo is not polluted.)

## 9. Exact commits

One primary phase commit (this). No amends. Remote unchanged.

## 10–14. Real worker adapter architecture + bindings (delivered)

`runClaudeWorker(req, config)` — model: **ProjectOS → governed adapter → owner-authenticated `claude` CLI
(print mode) → verified repo → validated response/evidence.** No API key, no metered client, no credential
handling.
- **Repo binding:** repoRoot comes ONLY from a trusted `projectRoots` registry keyed by `projectId`
  (own-property lookup, prototype-pollution-safe) — never from the request/document.
- **Branch binding:** `git -C repoRoot rev-parse --abbrev-ref HEAD` must equal the expected branch.
- **Clean-tree policy:** optional `requireClean` refuses a dirty tree.
- **Allowed-path enforcement:** after the run, changed files are derived from **NUL-delimited porcelain
  (`-z`, both sides of a rename)** and any path outside `allowedPaths` or under `projectos/` is refused.
- **No shell:** spawns with an argv array + `shell:false`; prompt is a single argv value; a prompt starting
  with `-` is refused. **Bounded:** hard timeout (process-group / `taskkill /T` tree-kill), stdout+stderr
  size caps. **Redaction:** registered-secret redaction + a generic secret-shape scrub of output. The CLI
  binary comes from trusted config. The adapter cannot approve/close a phase.

## 15–18. Real worker proofs (A controlled-change / B interruption-resume / timeout-cancel)

**BLOCKED for the REAL CLI** (no `claude` on this machine). The adapter's **safeguards are proven** against
a synthetic CLI stand-in + a real throwaway git repo (`validate-claude-worker.cjs`, 13 invariants, PASS):
empty-prompt / unknown-project / branch-mismatch / dirty-tree refused; unconfigured CLI → BLOCKED;
allowed-path change → COMPLETED with the change reported; forbidden-path (and `projectos/`) change refused;
**staged rename of protected source caught on its origin**; timeout kills+refuses; output-overflow
kills+refuses; registered + generic secret scrub; no metered API / `shell:false` (source-scanned). The
real controlled-change + interruption/resume + timeout proofs against the actual CLI are owner-machine steps.

## 19–45. Supabase / auth / RLS / reference app / browser journey / responsive / screenshots

**ALL BLOCKED** — depend on Docker (Supabase) and the real worker (reference app generation). Not built
manually, to avoid falsely claiming Forge/worker generation. (1A's local-Postgres round-trip stands as the
prior partial runtime proof, explicitly not relabelled as Supabase.)

## 46–49. Defects found / root causes / fixes / regression tests

- **Security HIGH (adapter):** a staged rename reported only the destination → a worker could move/delete
  ProjectOS source undetected. **Fixed:** two-sided `--porcelain -z` validation (checks the rename origin);
  new invariant 12. **MEDIUM:** quoted-path porcelain brittleness → resolved by `-z` (unquoted). **MEDIUM:**
  arg-injection → a `-`-leading prompt is refused + argv-array spawn. **LOW:** generic secret scrub of
  output (invariant 13); bounded stderr drain; POSIX process-group kill.
- (Carried from 1A: the exact-`.0` version-pin defect → F2 caret ranges, `44c6dfa`.)

## 50–55. Validation / reviews

- `npm run validate` → **ALL PASS (61 validators)**; `git diff --check` clean. (The worker adapter validator
  is **opt-in** — it drives process control + a real temp git repo, like the existing desktop smoke harness —
  and is intentionally NOT in `validate-all`; run standalone: **PASS, 13 invariants**.)
- **Security review (agent):** core containment confirmed (no shell/argv injection; prototype-pollution-safe
  repo binding; timeout+output caps; no metered API). One **HIGH** (rename-origin bypass) + MEDIUM/LOW — all
  fixed. No open HIGH/CRITICAL.
- **Code / ECC (self):** the adapter extends the existing bridge family (no parallel execution system); it is
  a plan-only connector until an owner machine wires the real CLI. Owner authority preserved; Claude does not
  self-approve/close; PLAN READY not granted; the Postgres-vs-Supabase distinction is kept honest; every
  blocker classified.

## 56–63. No-X proofs / tree / remote / push

No secret disclosure · No provider · No production · No send · No payment · **No metered AI API** (adapter
source-scanned). Working tree clean after the commit. Remote unchanged `4c3f076`. **Pushed: NO.**

## 64–68. Residue / risks / carry-forward / next / memory

- Residue: none in the repo (scratch app in gitignored temp). Risks: R1 (manual owner-confirmation) stands;
  redaction is exact-string + generic-shape (transformed copies not caught — documented).
- **Exact next decision required:** re-run 1B **on an owner machine with Docker Desktop running + the
  `claude` CLI available** — Gate 1 (wire `claudeBin` to the real CLI + real controlled-change + interruption
  proofs), Gate 2 (real Supabase + auth + RLS + two-user isolation), Gate 3 (reference-app command →
  blueprint → synthetic-labelled owner approval → real generation → real browser→Supabase round-trip). Then
  Gates 4–12.
- Checkpoint `PROJECTOS-FORGE-REAL-E2E-CHECKPOINT.md` + memory `projectos-forge` updated.

---

**END STATUS: BLOCKED — REQUIRED OWNER-MACHINE CAPABILITY UNAVAILABLE (`claude` CLI + Docker absent).
Governed worker adapter delivered + safeguards proven; real worker/Supabase/reference-app await an owner
machine. Not pushed, not closed.**

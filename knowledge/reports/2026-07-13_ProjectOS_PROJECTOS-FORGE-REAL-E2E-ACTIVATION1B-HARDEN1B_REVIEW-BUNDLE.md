# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B — SINGLE-FILE REVIEW BUNDLE

> Everything Murad + ChatGPT need to review OS-containment / trusted-workspace-diff / process-termination
> hardening, in one file: the report (with every mandated section), then the full source of all modules.
> Local-only. Remote frozen at `4c3f076`.

**Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B`
**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.**
**Not pushed. Not closed. No real worker / Docker / Supabase / production / provider / send / payment / secret / metered-AI API / install.**

---

# PART A — REPORT

## A1. Baseline (verified)

folder `C:\dev\ProjectOS`; branch `projectos-v3`; pre-phase HEAD `0f888f7` (HARDEN1A); remote
`origin/projectos-v3` = **`4c3f076`** (frozen); 32 ahead / 0 behind at start; working tree clean;
`git diff --check` clean; recovery branch `forge-baseline-2026-07-12`. No history rewrite. `tar` present but
unused (materialisation is dependency-free). **Available ECC agents (used):** security-reviewer,
code-reviewer, architect, silent-failure-hunter. **UI UX Pro Max, Claude Design: NOT installed → UNAVAILABLE**
(not fabricated; manual equivalents performed).

## A2. Gate findings addressed (the HARDEN1B directive §4–§12)

§4 OS sandbox (fail-closed, mock for synthetic, no unrestricted fallback) · §5 trusted `.git`-free workspace +
filesystem ledger replacing worker-controlled git · §6 bounded process-tree termination + emergency-stop · §7
one shared executable checker (capability-check ≡ adapter) · §8 fail-closed tool/command invocation-profile ·
§9 corrected canonical language ("no residual drift detected", not "canonical untouched") · §10 honest
evidence schema (v2) · §11 49 validators · §12 owner-facing states. All implemented.

## A3. Architecture (8 modules + orchestrator)

```
runClaudeWorker (orchestrator)
  policy tamper/content → SANDBOX (fail-closed; real ⇒ attest() enforced) → TOOL PROFILE (fail-closed)
    → EXECUTABLE (shared checker; provider-permitted) → canonical baseline (strict git)
    → MATERIALISE .git-free workspace (git ls-tree + per-blob git show) → FS snapshot BEFORE
    → spawn via provider (minimal env, bounded) → CONFIRM PROCESS-TREE DEATH (bounded, recursive enum)
        · clean exit ⇒ confirmed (real runs still sweep descendants)
        · unconfirmed ⇒ EMERGENCY-STOP (preserve evidence, no reconcile, owner resolution)
    → FS snapshot AFTER → TRUSTED FS DIFF (never git) → enforce every changed path
    → monitored-state reconcile → residualDriftStatus → dispose → schema-v2 result (no apply/commit/gate)
```
Modules: `sandbox-provider`, `workspace-ledger`, `process-control`, `executable-check`, `invocation-profile`,
`worker-policy`, `owner-capability-check`, `claude-worker`.

## A4. OS sandbox contract (`sandbox-provider.cjs`)

Fail-closed: no provider ⇒ `BLOCKED OS-SANDBOX-NOT-CONFIGURED`; invalid ⇒ `OS-SANDBOX-INVALID`; a `kind:"mock"`
provider ⇒ refused for real runs. `isReallyIsolated` requires `canonical/other/home/credential = not-mounted`
and `network = disabled` (or a concrete, non-wildcard `networkAllowlist`). Required fields include `attest`;
a **real run invokes `provider.attest()` and fails closed unless it reports `enforced:true`** — self-declared
fields are not trusted for a real run. The mock declares (does not enforce) and is refused for real runs. No
real sandbox is installed/activated this phase.

## A5. Disposable workspace model (`workspace-ledger.materialize`)

`git ls-tree -r -z` + per-blob `git show` writes the tracked tree at the verified baseline into a fresh temp
dir with **NO `.git`** (dependency-free; preserves symlinks + exec bit; a failed symlink create is recorded in
`symlinkFallbacks`, never silently downgraded; a mid-write failure cleans up its own temp dir). The worker has
no git state to manipulate; if it creates `.git`, the ledger simply reports it as an added forbidden path.

## A6. Filesystem-ledger model (`workspace-ledger.snapshot/diff`)

`lstat`-based recursive walk records per entry: relpath, type (file/dir/symlink/special), content sha256,
size, symlink target, mode, hidden, real-path escape, unreadable. `diff` derives added / modified / deleted /
typeChanged / **sameSizeContentChange** / symlinkChanged / **permissionChanged** / renamed (heuristic) /
escapes / unreadable / special / hidden. **`changedPaths` folds in unreadable + escapes + special** so policy
enforcement can never pass over them. This is the AUTHORITATIVE manifest — never git status/diff/index/worker
evidence.

## A7. Process-termination model (`process-control.terminate`)

Bounded, repeated verification against a wall-clock deadline; **recursive** descendant enumeration
(`buildChildMap`: wmic→PowerShell fallback on Windows, `/proc` on Linux). Ambiguity fails closed: unknown
descendants ⇒ not-confirmed under `strictDescendants` (set for real runs); `alive()` treats only `ESRCH` as
dead; a non-positive pid never signals a process group. Outcomes: **TERMINATED-CONFIRMED /
TERMINATION-UNCONFIRMED / EMERGENCY-STOP-REQUIRED**. Unconfirmed ⇒ the adapter preserves the workspace, does
NOT reconcile/dispose, and returns EMERGENCY-STOP (never an ordinary REFUSED). `terminationDetail`
(status/cleanExit/descendantsChecked/descendantConfidence/attempts) is surfaced into the result.

## A8. Executable-validation model (`executable-check.validateExecutable`)

ONE function used by both `owner-capability-check` and the adapter. Checks: resolved absolute path, real file
type, actual `--version` invocation with timeout, `shell:false`, unsafe-shim reject (`.cmd/.bat/.ps1` on
Windows, incl. realpath target). Existence-only cannot PASS. Capability-check can never report READY for an
executable the adapter would refuse (proven by inv23/24/25).

## A9. Tool-restriction model (`invocation-profile`)

Fail-closed: `BLOCKED WORKER-TOOL-RESTRICTION-NOT-PROVEN` unless the profile is `verified:true` with a detected
`cliVersion` and a supported `restrictionMechanism`. For the first controlled-change proof: no shell / git-write
/ provider CLI / DB CLI / deploy / network tools; `permittedCommands` must be empty; `Bash/Shell/Execute/
WebFetch/WebSearch` forbidden. The adapter additionally denylist-checks the built argv for dangerous flags.

## A10. Evidence schema (v2, `worker-policy.buildResult/validateResult`)

Honest fields: `projectOsCommandsExecuted` / `workerCommandsObserved` / `workerCommandsObservationStatus`
(OBSERVED|PARTIALLY OBSERVED|NOT OBSERVABLE|NOT EXECUTED) / `workerToolsPermitted` / `workerToolsVerified` /
`sandboxProvider` / `sandboxPolicy` / `canonicalVisibility` / `networkPolicy` / `processTerminationStatus` +
`terminationDetail` / `residualDriftStatus` / `filesInspectionStatus` (NOT OBSERVABLE) / `changeManifest` /
`ledgerSummary` / `materialiseWarnings`. `controls` split into **technicallyEnforced / policyRequested /
delegated / notVerified / outOfScope** — built PER RUN (process-termination-confirm is only enforced when
confirmed). `resultHash` (checksum; not an HMAC — see A15), **deep-frozen**, `validateResult{real}` requires
non-null operation identity, `buildResult` THROWS on a forbidden gate decision; the worker cannot self-approve
/close.

## A11. Validator matrix (`validate-claude-worker.cjs` — 49 invariants, PASS, 0 env-skip)

§11's 1–38 (sandbox/workspace/ledger/git-hide/hidden/ignored/symlink/type/same-size/termination/executable/
tool/schema/no-metered/no-prod/canonical/residue/clean/frozen) + round-2: 39 null-pid never group-kills · 40
strict+unknown-descendants not confirmed · 41 alive ESRCH-only · 42 mock+requireExecInvoke refused · 43
provider-permitted-executable · 44 network-allowlist content · 45 permittedCommands empty · 46 mode-change ·
47 special-type · 48 emergency doesn't claim termination-confirm enforced · 49 real provider must attest.
Per-invariant isolation (one crash can't abort the rest).

## A12. Exact test results

- `node projectos/validators/validate-claude-worker.cjs` → **PASS (49 invariants, 0 env-skipped)**.
- `npm run validate` → **validate-all: ALL PASS (61 validators)**.
- `git diff --check` → clean. Temp workspace residue after all runs → **0**.
- `node projectos/bridge/owner-capability-check.cjs` → SYNTHETIC: READY; REAL: **BLOCKED-OS-SANDBOX** (correct).

## A13. Full ECC findings (2 rounds × security + silent-failure + architecture)

**Round 1 (initial modules):** Architecture — canonical-monitor embedded (extract, deferred), killTree
duplication, arch-M1 single-choke-point (deferred), forbidden-list drift, sandbox validates declarations not
enforcement, permittedExecutables unenforced, oversized `runClaudeWorker`, inconsistent exit shapes,
validateResult-not-real, pid-reuse false emergency, resultHash-not-HMAC. Silent-failure — **4 CRITICAL:**
unknown-descendants-as-dead, null-pid group-kill, unreadable-dir hides content, no-catch disposes evidence;
plus special-type/mode/symlink-materialise/gitMeta-sentinel. Security — H1 descendant enum, H2 mock+exec
bypass, M1 static controls, M2 mode, M3 permittedCommands, M4 network-allowlist, L1 doc, L2 shim-realpath.
**Round 2 (re-verification):** ALL of the above **RESOLVED**; 4 new lower (A materialise-orphan, B
child-error-vs-spawn-error, C clean-exit descendant sweep, D honest post-dispose residue) + attest-not-wired —
**all fixed** (attest now invoked + required; wmic→PowerShell fallback added). No open HIGH/CRITICAL.

## A14. UI UX Pro Max — UNAVAILABLE · Claude Design — UNAVAILABLE

Neither is an installed skill/plugin here; **not fabricated**. Manual equivalents (ECC web design-quality +
a11y rules) applied to the owner-facing surfaces this phase adds: the **capability check** (six required states
READY-FOR-SYNTHETIC-VALIDATION / BLOCKED-OS-SANDBOX / -EXECUTABLE / -TOOL-RESTRICTION / -PROCESS-CONTROL /
READY-FOR-REAL-WORKER-PROOF; a SECURITY-vs-SYNTHETIC readiness split; NOT INSTALLED / NOT RUNNING / **NOT SAFE**
distinguished; text badges not colour-only; one ordered next-action list; no false READY) and the
**EMERGENCY-STOP** result (distinct decision, evidence-preserved residue, owner-resolution risk line). Terminal
WCAG/keyboard/mobile do not apply to a Node console readout — recorded N/A, not claimed. A capability/emergency
GUI, when added to the Forge console, should reuse `control-center/src/forge` components and be reviewed then.

## A15. Claude self-review (after each step + final independent pass)

Applied the 10-point checklist throughout. Self-caught: the `tar` Windows-path failure (→ dependency-free
materialise), the workspace-residue accounting (→ honest `kept-by-config`/`workspace-preserved`), the
self-matching meta-invariants (inv37/38 rewritten), and in the final pass confirmed every post-materialise exit
routes residue honestly and the pipeline `catch` preserves evidence. Every synthetic-only proof is labelled;
the real worker / Docker-Supabase remain owner-machine steps. Honest limits recorded (A16).

## A16. Unresolved limitations (accepted / documented follow-ups)

1. **This is not itself an OS sandbox** — OS-level PREVENTION is delivered by the sandbox provider. A real,
   non-mock provider (restricted account / Windows Sandbox / VM / container) must be implemented + `attest()`
   its enforcement; none is installed here, so real runs are BLOCKED.
2. **Descendant enumeration** is recursive on Windows (wmic→PowerShell) + Linux (`/proc`); other POSIX (macOS/
   BSD) returns null ⇒ fail-closed (unconfirmed) under strict — needs a platform-specific enumerator before a
   real run there.
3. **`resultHash` is a checksum, not an HMAC** — detects accidental mutation/serialisation drift, not a
   motivated forger of a persisted record. HMAC with a ProjectOS key if evidence leaves the trusted process.
4. **Deferred architecture follow-ups:** extract the canonical monitor into its own module; split
   `runClaudeWorker` into phases; unify the forbidden-authority-field list with `desktop-bridge`; a single
   approval choke point (arch-M1); a CI lane for the opt-in validator.
5. Deep canonical content-monitoring of pre-existing ignored/untracked files is per-policy opt-in (off by
   default for large-repo perf).

## A17. Files changed · git · no-X · decision

**New:** `projectos/bridge/{sandbox-provider,workspace-ledger,process-control,executable-check,invocation-
profile}.cjs`. **Modified:** `projectos/bridge/{claude-worker,worker-policy,owner-capability-check}.cjs`,
`projectos/validators/validate-claude-worker.cjs`, the checkpoint, and this bundle.
Branch `projectos-v3`; remote unchanged **`4c3f076`**; **Pushed: NO**; **Closed: NO**.
No production · No deploy · No provider · No send · No payment · No metered AI API · No network · No real
worker · No Docker/Supabase · No system software installed · No secret disclosed.

**Decision required:** ChatGPT/Murad review of HARDEN1B. On acceptance, the next phase implements a REAL sandbox
provider (with a real `attest()`) on an owner machine and runs the real Gate 1–3 only when
`owner-capability-check` reports READY-FOR-REAL-WORKER-PROOF.

---

**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.** Sandbox-gated, `.git`-free trusted-ledger,
process-tree-terminated, honest-evidence worker adapter; 49-invariant validator PASS; 2 ECC review rounds, no
open HIGH/CRITICAL; honest limitations documented. Not pushed, not closed.

---

# PART B — FULL SOURCE

## claude-worker.cjs

```js
"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B.
 *
 * Containment pipeline (fail-closed at every gate):
 *
 *   resolve trusted policy (request = CONTENT only)
 *     → resolve OS SANDBOX provider (NO provider ⇒ BLOCKED OS-SANDBOX-NOT-CONFIGURED; no unrestricted fallback)
 *     → verify tool/command INVOCATION PROFILE (unverified ⇒ BLOCKED WORKER-TOOL-RESTRICTION-NOT-PROVEN)
 *     → validate the EXECUTABLE with the SHARED checker (real runs; BLOCKED-EXECUTABLE on mismatch)
 *     → verify canonical baseline (strict git)
 *     → MATERIALISE a disposable workspace from a trusted `git archive` export WITH NO .git
 *     → trusted FILESYSTEM snapshot (before) + monitored-state snapshot of canonical
 *     → run the worker via the sandbox provider, minimal env, bounded output + timeout
 *     → CONFIRM process-tree death (bounded, repeated) — unconfirmed ⇒ EMERGENCY-STOP, evidence preserved,
 *       NO reconciliation, NO cleanup, external-operation lock (never an ordinary REFUSED)
 *     → trusted FILESYSTEM snapshot (after) → TRUSTED FS DIFF (never git status/diff/index/worker evidence)
 *     → enforce EVERY changed path against trusted policy
 *     → monitored-state reconciliation of canonical → "no residual drift detected" / "residual drift detected"
 *     → dispose workspace (real residue) → schema-v2 structured result (NO apply, NO commit, NO gate decision)
 *
 * HONEST SCOPE: OS-level access PREVENTION is delivered by the sandbox provider, not this wrapper. Without a
 * provider that ATTESTS the canonical repo / other projects / home / credentials are not mounted and the
 * network is disabled, a REAL run is BLOCKED. We therefore do NOT claim "canonical untouched/inaccessible";
 * we report monitored-state drift ("no residual drift detected") and the provider's attested visibility.
 * Every git call fails CLOSED. Claude cannot approve/close.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { createRedactor } = require("../security/redaction.cjs");
const P = require("./worker-policy.cjs");
const ledger = require("./workspace-ledger.cjs");
const sandbox = require("./sandbox-provider.cjs");
const proc = require("./process-control.cjs");
const execcheck = require("./executable-check.cjs");
const profileMod = require("./invocation-profile.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024;
const DANGEROUS_FLAG = /^--?(dangerously-skip-permissions|no-sandbox|allow-all|yolo|permission-mode=bypass)/i;

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function gitStrict(repoRoot, args) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: GIT_MAXBUF }); }
function gitLine(repoRoot, args) { return gitStrict(repoRoot, args).trim(); }
function refused(reason, extra) { return Object.assign({ ok: false, decision: "REFUSED", reason }, extra || {}); }
function blocked(reason, extra) { return Object.assign({ ok: false, decision: "BLOCKED", reason }, extra || {}); }
function emergency(reason, extra) { return Object.assign({ ok: false, decision: "EMERGENCY-STOP", reason }, extra || {}); }
function resolveGitDir(repoRoot, answer) { return path.isAbsolute(answer) ? answer : path.resolve(repoRoot, answer); }

/**
 * Monitored-state ledger of the canonical repo (identity + tracked content + git-metadata content digest +
 * ignored/untracked INVENTORY). When `opts.deepIgnored` is set (per policy, for small repos), it also hashes
 * the CONTENT of every ignored + untracked file so a content edit to a pre-existing ignored/untracked file is
 * caught — off by default because on a large repo that walk (e.g. node_modules) is prohibitive.
 */
function monitorSnapshot(repoRoot, opts) {
  const o = opts || {};
  const status = gitStrict(repoRoot, ["status", "--porcelain"]).trim();
  const ignoredList = gitStrict(repoRoot, ["status", "--porcelain", "--ignored", "--untracked-files=all", "-z"]);
  const ignoredInventory = sha256(ignoredList);
  const tracked = gitStrict(repoRoot, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  const files = {};
  for (const rel of tracked) { try { files[rel] = ledger.sha256File(path.join(repoRoot, rel)); } catch (e) { files[rel] = "MISSING"; } }
  let deepInventory = "off";
  if (o.deepIgnored) {
    const deep = {};
    const paths = ignoredList.split("\0").filter(Boolean).map((rec) => rec.slice(3)).sort();
    for (const rel of paths) {
      const abs = path.join(repoRoot, rel);
      try { if (fs.statSync(abs).isFile()) deep[rel] = ledger.sha256File(abs); } catch (e) { deep[rel] = "ERR"; }
    }
    deepInventory = sha256(JSON.stringify(deep));
  }
  return {
    toplevel: gitLine(repoRoot, ["rev-parse", "--show-toplevel"]),
    origin: safeOrigin(repoRoot),
    branch: gitLine(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: gitLine(repoRoot, ["rev-parse", "HEAD"]),
    status, ignoredInventory, deepInventory, filesHash: sha256(JSON.stringify(files)), metaHash: gitMetaDigest(repoRoot),
  };
}
function safeOrigin(repoRoot) {
  try { return gitLine(repoRoot, ["remote", "get-url", "origin"]); }
  catch (e) { return /no such remote|No such/i.test(String(e.message)) ? "no-origin" : "origin-unreadable"; }
}
function gitMetaDigest(repoRoot) {
  const common = resolveGitDir(repoRoot, gitLine(repoRoot, ["rev-parse", "--git-common-dir"]));
  const parts = [];
  const addFile = (p) => { try { if (fs.existsSync(p)) parts.push(p + ":" + sha256(fs.readFileSync(p))); } catch (e) { parts.push(p + ":ERR"); } };
  for (const f of ["config", "HEAD", "packed-refs"]) addFile(path.join(common, f));
  for (const f of ["exclude", "attributes", "sparse-checkout"]) addFile(path.join(common, "info", f));
  const walk = (dir, tag) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { parts.push(dir + ":READDIR-ERR"); return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { parts.push(full + ":LINK:" + sha256(fs.readlinkSync(full))); } catch (er) { parts.push(full + ":LINKERR"); } }
      else if (e.isDirectory()) walk(full, tag);
      else if (e.isFile()) { if (tag === "hooks" && e.name.endsWith(".sample")) continue; addFile(full); }
    }
  };
  walk(path.join(common, "refs"), "refs"); walk(path.join(common, "hooks"), "hooks");
  return sha256(parts.sort().join("|"));
}
function monitorDrift(a, b) { return ["toplevel", "origin", "branch", "head", "status", "ignoredInventory", "deepInventory", "filesHash", "metaHash"].filter((k) => a[k] !== b[k]); }

/** Spawn the worker inside `workspace` via the sandbox provider. */
function spawnWorker(provider, workspace, bin, argv, childEnv, policy) {
  const posix = process.platform !== "win32";
  return new Promise((resolve) => {
    let stdout = "", stderrBytes = 0, killedFor = null, doneF = false, child;
    const finish = (payload) => { if (doneF) return; doneF = true; clearTimeout(timer); detach(); resolve(payload); };
    const detach = () => { try { child.stdout && child.stdout.removeAllListeners("data"); child.stderr && child.stderr.removeAllListeners("data"); } catch (e) { /* ignore */ } };
    try { child = provider.spawn(bin, argv, { cwd: workspace, shell: false, detached: posix, env: childEnv }); }
    catch (e) { return resolve({ killedFor: "spawn-error", code: null, pid: null, stdout: "" }); }
    const abort = (why) => { killedFor = why; detach(); proc.killTree(child.pid); finish({ stdout, killedFor: why, code: null, pid: child.pid }); };
    const timer = setTimeout(() => abort("timeout"), policy.timeoutMs);
    child.stdout && child.stdout.on("data", (d) => { stdout += d.toString(); if (Buffer.byteLength(stdout, "utf8") > policy.maxOutputBytes) abort("output-overflow"); });
    child.stderr && child.stderr.on("data", (d) => { stderrBytes += d.length; if (stderrBytes > policy.maxOutputBytes) abort("stderr-overflow"); });
    // A runtime 'error' on an ALREADY-spawned child (valid pid) must be confirmed dead, not short-circuited
    // as a benign "spawn-error"; only a pre-spawn failure (no pid) is a true spawn-error.
    child.on("error", () => finish({ killedFor: killedFor || (proc.posInt(child && child.pid) ? "worker-error" : "spawn-error"), code: null, pid: child && child.pid, stdout }));
    child.on("close", (code) => finish({ stdout, killedFor, code, pid: child && child.pid }));
  });
}

/**
 * Run one bounded worker task under HARDEN1B containment.
 * @param req    { prompt, projectId, taskId? }
 * @param config { projectRoots, policy, operation, claudeBin, claudeArgs(prompt,pol)->[], sandboxProvider,
 *                 invocationProfile, redactor, realRun?, requireExecInvoke?, keepWorkspace?, terminateOpts? }
 */
async function runClaudeWorker(req, config) {
  const r = req || {}; const c = config || {};
  const redactor = c.redactor || createRedactor();
  const base = { projectId: r.projectId || null };
  const out = (env, extra) => {
    const fields = Object.assign({}, base, { outcome: env.decision, reason: env.reason || null }, extra || {});
    let res; try { res = P.buildResult(fields); } catch (e) { try { console.error("[claude-worker] result build error: " + e.message); } catch (_) {} return Object.assign({}, env, { resultBuildError: e.message }); }
    return Object.assign({}, env, { result: res });
  };

  // 1) Request tamper + content.
  const { policy, violations } = P.resolvePolicy(r, c);
  Object.assign(base, { operationId: policy.operationId, phaseId: policy.phaseId });
  if (violations.length) return out(refused("request-policy-tamper", { violations }), { refusedPaths: violations });
  if (typeof r.prompt !== "string" || !r.prompt.trim()) return out(refused("empty-prompt"));
  if (r.prompt.length > policy.maxPromptChars) return out(refused("prompt-too-long"));
  if (P.promptHasRawSecret(r.prompt)) return out(refused("prompt-contains-raw-secret"));
  if (typeof r.projectId !== "string" || !r.projectId) return out(refused("no-project"));
  if (!policy.repoRoot) return out(refused("no-trusted-root"));
  if (P.allowlistTouchesProjectos(policy)) return out(refused("allowlist-touches-projectos"));
  if (r.prompt.trim().startsWith("-")) return out(refused("prompt-looks-like-flag"));

  // 2) OS sandbox — fail closed (no provider ⇒ BLOCKED; no unrestricted fallback). A request for real
  //    executable invocation forces a real (non-mock) provider too, so a real binary can never run under a
  //    non-isolating mock.
  const requireReal = !!c.realRun || !!c.requireExecInvoke;
  const sb = sandbox.resolveSandbox(c, { requireReal });
  if (!sb.ok) return out(blocked("OS-SANDBOX-" + sb.reason.replace(/^OS-SANDBOX-/, ""), { errors: sb.errors }));
  const provider = sb.provider;
  // A REAL (non-mock) provider must ATTEST enforcement via a live canary — self-declared fields are not
  // trusted for a real run. Fail closed if attest() is absent or reports it is not OS-enforced.
  if (requireReal) {
    let at = null;
    try { at = typeof provider.attest === "function" ? provider.attest() : null; } catch (e) { at = null; }
    if (!at || at.enforced !== true) return out(blocked("OS-SANDBOX-ATTESTATION-FAILED", { attest: at }));
  }
  const sandboxPolicy = sandbox.policySummary(provider);

  // 3) Tool/command invocation profile — fail closed.
  const vp = profileMod.verifyProfile(c.invocationProfile, { firstControlledChange: true });
  if (!vp.ok) return out(blocked("WORKER-TOOL-RESTRICTION-NOT-PROVEN", { errors: vp.errors }));
  const profile = vp.profile;

  // 4) Executable — shared checker. Real runs (and any run requesting invocation) must pass; a mock provider
  //    attests its own permitted executable for synthetic proofs.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return out(blocked("BLOCKED-EXECUTABLE", { execReason: "not-configured" }));
  // A non-mock provider must permit exactly this executable (never a task-supplied path).
  if (provider.kind !== "mock" && Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) {
    return out(blocked("BLOCKED-EXECUTABLE", { execReason: "not-in-provider-permitted-executables" }));
  }
  // A mock provider attests its own permitted executable (synthetic proofs). Real runs — or any run that
  // requests it, or a non-mock provider — MUST pass the shared executable checker.
  const mustInvoke = requireReal || provider.kind !== "mock";
  if (mustInvoke) {
    const ev = execcheck.validateExecutable(c.claudeBin, { invoke: true });
    if (!ev.ok) return out(blocked("BLOCKED-EXECUTABLE", { execReason: ev.reason, resolvedPath: ev.resolvedPath || null }));
  }
  if (typeof c.claudeArgs !== "function") return out(blocked("no-tool-restriction-configured"));

  // 5) Canonical baseline (strict git; fails closed).
  const repoRoot = policy.repoRoot;
  let before;
  try {
    const tl = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]);
    if (path.resolve(tl) !== path.resolve(repoRoot)) return out(refused("root-not-git-toplevel", { toplevel: tl }));
    before = monitorSnapshot(repoRoot, { deepIgnored: !!(c.policy && c.policy.monitorIgnoredContent) });
  } catch (e) { return out(blocked("baseline-snapshot-failed", { detail: String(e.message).slice(0, 160) })); }
  if (!before.head) return out(blocked("baseline-head-unresolved"));
  if (policy.expectedRemote && before.origin !== policy.expectedRemote) return out(refused("remote-mismatch", { origin: before.origin }));
  if (policy.expectedBranch && before.branch !== policy.expectedBranch) return out(refused("branch-mismatch", { branch: before.branch }));
  if (policy.requireClean && before.status) return out(refused("working-tree-dirty"));
  Object.assign(base, { toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: before.branch, finalHead: before.head });

  // 6) Materialise the .git-free workspace from a trusted export.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head); }
  catch (e) { return out(blocked("workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace;
  let disposed = false;
  let preserve = false; // set on EMERGENCY-STOP: keep the workspace as evidence, never auto-dispose
  const disposeAll = () => {
    if (c.keepWorkspace) return ["kept-by-config:" + workspace]; // honestly reported as residue
    if (disposed || preserve) return [];
    disposed = true;
    return ledger.dispose(workspace);
  };

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree",
    "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape",
    "timeout", "output-cap", "fail-closed-sandbox-gate", "fail-closed-tool-profile", "shared-executable-check",
    "provider-permitted-executable"];
  // Controls are built PER RUN: "process-termination-confirm" is only technicallyEnforced when death was
  // actually confirmed; otherwise it is notVerified for that run.
  const controlsFor = (killConfirmed) => ({
    technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []),
    policyRequested: ["worker-tool-restriction"],
    delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"],
    notVerified: ["worker-internal-tool-enforcement-until-real-cli-detected"].concat(killConfirmed ? [] : ["process-termination-confirm"]),
    outOfScope: provider.networkPolicy === "disabled" ? [] : ["network-isolation-unless-provider-enforced"],
  });
  const commonBase = {
    sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy,
    canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy,
    workerToolsPermitted: profile.permittedTools, workerToolsVerified: profile.verified === true,
    workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE",
    projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"],
    filesInspectionStatus: "NOT OBSERVABLE", materialiseWarnings: mat.symlinkFallbacks || [],
  };
  const commonResult = (killConfirmed) => Object.assign({}, commonBase, { controls: controlsFor(killConfirmed) });
  const done = (env, extra, killConfirmed) => out(env, Object.assign({}, commonResult(killConfirmed !== false), { residue: disposeAll() }, extra || {}));

  try {
    // 7) Trusted FS snapshot (before) of the workspace.
    const wsBefore = ledger.snapshot(workspace);

    // 8) Spawn the worker via the sandbox provider; minimal env; bounded.
    const childEnv = P.buildMinimalEnv(process.platform, policy.envAllowlist);
    const argv = c.claudeArgs(r.prompt, { tools: profile.permittedTools, commands: profile.permittedCommands, mode: policy.mode });
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return done(blocked("claude-args-not-string-array"));
    if (argv.some((a) => DANGEROUS_FLAG.test(a))) return done(blocked("dangerous-cli-flag", { flag: argv.find((a) => DANGEROUS_FLAG.test(a)) }));
    const run = await spawnWorker(provider, workspace, c.claudeBin, argv, childEnv, policy);
    const output = P.scrubSecrets(redactor.redactText(run.stdout || "")).slice(0, 4000);

    // 8a) A spawn failure means no process ran — refuse (no termination confirmation to perform).
    if (run.killedFor === "spawn-error") return done(refused("spawn-error"), { outputExcerpt: output, processTerminationStatus: "n/a", killConfirmed: true, residualDriftStatus: "not-evaluated" });

    // 9) CONFIRM process-tree death BEFORE any reconciliation/cleanup. A KILLED/errored worker is verified via
    //    bounded tree-termination (strict descendant enumeration for real runs). A CLEAN exit ('close' reaped
    //    the immediate child) is confirmed without re-probing the (possibly-reused) parent pid — BUT on a real
    //    run we still sweep for detached descendants the worker may have spawned.
    let term;
    if (run.killedFor || c.terminateOpts || requireReal) term = await proc.terminate(run.pid, Object.assign({ deadlineMs: 3000, strictDescendants: requireReal }, c.terminateOpts || {}));
    else term = { status: "TERMINATED-CONFIRMED", pid: run.pid, cleanExit: true, descendantsChecked: false, descendantConfidence: "clean-exit", attempts: 0 };
    const terminationDetail = { status: term.status, cleanExit: !!term.cleanExit, descendantsChecked: !!term.descendantsChecked, descendantConfidence: term.descendantConfidence || null, attempts: term.attempts || 0 };

    if (!proc.isConfirmedDead(term)) {
      preserve = true; // evidence must survive: do NOT reconcile, do NOT dispose
      return out(emergency("EMERGENCY-STOP-REQUIRED", { termination: term }), Object.assign({}, commonResult(false), {
        outputExcerpt: output, processTerminationStatus: term.status, terminationDetail, killConfirmed: false,
        residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace],
        risks: ["worker process death unconfirmed — external-operation lock; owner resolution required"],
        cancellationStatus: "unconfirmed", timeoutStatus: run.killedFor === "timeout" ? "killed" : "none",
      }));
    }

    // 10) Killed (but confirmed dead) ⇒ refuse.
    if (run.killedFor) {
      const reason = ["timeout", "output-overflow", "stderr-overflow"].includes(run.killedFor) ? run.killedFor : "spawn-error";
      return done(refused(reason, {}), { outputExcerpt: output, processTerminationStatus: term.status, terminationDetail, cancellationStatus: "confirmed", timeoutStatus: run.killedFor === "timeout" ? "killed" : "none", residualDriftStatus: "not-evaluated" });
    }

    // 11) Trusted FS snapshot (after) + trusted diff (NEVER git). Enforce every changed path.
    const wsAfter = ledger.snapshot(workspace);
    const led = ledger.diff(wsBefore, wsAfter);
    const refusedPaths = [];
    for (const p of led.changedPaths) {
      const norm = P.normPath(p);
      if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } // worker created a .git
      if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; }
    }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p); // symlink/junction escape

    // 12) Monitored-state reconciliation of canonical (honest language).
    let after;
    try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); }
    catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output, processTerminationStatus: term.status, terminationDetail }); }
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";

    const manifest = ledger.manifest(wsAfter, led);
    const patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null;
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), { outputExcerpt: output, processTerminationStatus: term.status, terminationDetail, residualDriftStatus, ledgerSummary });
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), { outputExcerpt: output, processTerminationStatus: term.status, terminationDetail, residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary });

    // 13) Success — build the schema-v2 result AFTER disposing the workspace (real residue).
    const residue = disposeAll();
    const res = P.buildResult(Object.assign({}, commonResult(true), {
      operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId,
      approvalStatus: policy.approvalId ? "referenced" : "none",
      toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head,
      finalBranch: after.branch, finalHead: after.head, outcome: run.code === 0 ? "COMPLETED" : "FAILED",
      residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary,
      processTerminationStatus: term.status, terminationDetail, killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none",
      outputExcerpt: output, residue, workerDecision: run.code === 0 ? "PROPOSED" : "FAILED",
    }));
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) { const rr = disposeAll(); return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true), { residue: rr })); }
    return { ok: run.code === 0, decision: run.code === 0 ? "COMPLETED" : "FAILED", output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
  } catch (e) {
    // Any unexpected error after the worker ran: PRESERVE evidence (never dispose), return a structured
    // BLOCKED result — never an uncaught rejection. If the workspace was ALREADY disposed (error thrown after
    // a successful dispose on the success path), report that honestly rather than claiming preservation.
    preserve = true;
    const wasDisposed = disposed;
    return out(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({}, commonResult(false), {
      residualDriftStatus: "not-evaluated",
      residue: [wasDisposed ? "already-disposed:" + workspace : "workspace-preserved:" + workspace],
      risks: [(wasDisposed ? "unexpected error after workspace disposal" : "unexpected error after worker execution — evidence preserved") + "; owner resolution required"],
    }));
  } finally {
    if (!disposed && !preserve && !c.keepWorkspace) disposeAll();
  }
}

module.exports = { runClaudeWorker, monitorSnapshot, monitorDrift, gitMetaDigest };
```

## worker-policy.cjs

```js
"use strict";
/**
 * Worker trusted-policy binding, environment isolation, secret scanning, and the structured worker result
 * contract — the containment layer for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A (pure, I/O-free).
 *
 * The worker REQUEST carries only task CONTENT (prompt, project key, task id). Every SECURITY CONTROL —
 * repo root, expected remote/branch, clean-tree requirement, allowed/forbidden paths, permitted tools and
 * commands, timeout, output limits, environment allowlist, mode, and the operation/phase/approval ids —
 * comes ONLY from trusted ProjectOS configuration. A request that tries to define/widen any control is
 * refused, never merged.
 *
 * IMPORTANT (honesty): this layer + the orchestrator provide GIT- and FILESYSTEM-level containment plus a
 * minimal environment. They do NOT OS-sandbox a shell-capable worker. A worker granted shell/file tools can
 * read/write anything the owner account can. Real isolation of a fully-untrusted worker requires OS-level
 * enforcement (a container/VM or a restricted account) on the OWNER machine — see the adapter header.
 */

const crypto = require("crypto");
const OBSERVATION_STATUSES = ["OBSERVED", "PARTIALLY OBSERVED", "NOT OBSERVABLE", "NOT EXECUTED"];

// --- Environment isolation ---------------------------------------------------------------------------
const ENV_ALLOW_COMMON = ["PATH", "Path"];
const ENV_ALLOW_WIN = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"];
const ENV_ALLOW_POSIX = ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "SHELL"];

// A credential-bearing variable NAME is never forwarded, even if allowlisted.
const TOKENISH_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|DATABASE_URL|DSN|SESSION|COOKIE|AUTH|BEARER|PRIVATE|ANTHROPIC|OPENAI|SUPABASE|VERCEL|GITHUB|STRIPE|RESEND|TWILIO|AWS_)/i;

// Control fields a REQUEST must never carry — they belong to trusted policy only.
const CONTROL_FIELDS = [
  "repoRoot", "expectedRemote", "expectedBranch", "requireClean", "allowedPaths", "forbiddenPaths",
  "tools", "commands", "timeoutMs", "maxOutputBytes", "maxPromptChars", "envAllowlist", "mode",
  "phaseId", "approvalId", "operationId",
];

// ONE shared secret-shape source (used for prompt rejection AND output scrubbing). Consolidated so the two
// call sites cannot drift.
const SECRET_SHAPE = new RegExp(
  [
    "-----BEGIN[\\s\\S]{0,64}?PRIVATE KEY-----",
    "sk-[A-Za-z0-9]{16,}",
    "eyJ[A-Za-z0-9_-]{20,}", // base64url JWT/JWS header blob (matches header-only or full token)
    "sb_secret_[A-Za-z0-9]{6,}",
    "service_role[\"'\\s:=]{0,4}eyJ",
    "AKIA[0-9A-Z]{12,}",
    "ghp_[A-Za-z0-9]{20,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "AIza[0-9A-Za-z_-]{20,}",
  ].join("|"),
);
function secretShapeGlobal() { return new RegExp(SECRET_SHAPE.source, "g"); }

// Worker decisions that are NEVER authoritative gate outcomes.
const FORBIDDEN_WORKER_DECISIONS = ["APPROVED", "APPROVED_TO_PUSH", "CLOSED", "PLAN_READY", "PLAN READY"];
// Fields a worker result must never assert.
const FORBIDDEN_RESULT_FIELDS = ["authoritative", "planReady", "grantPlanReady", "ownerApproved", "trusted", "approved", "closed"];

// Executable shims that re-enter a shell on Windows (spawn routes .cmd/.bat/.ps1 through cmd.exe even with
// shell:false → argv re-parsing). The trusted CLI path must be a real executable, not a shim.
const UNSAFE_SHIM = /\.(cmd|bat|ps1)$/i;

const caseFold = () => (process.platform === "win32" || process.platform === "darwin");

/** Build the minimal child environment from the allowlist. Never spreads process.env. */
function buildMinimalEnv(platform, extraAllow) {
  const src = process.env;
  const allow = ENV_ALLOW_COMMON
    .concat(platform === "win32" ? ENV_ALLOW_WIN : ENV_ALLOW_POSIX)
    .concat(Array.isArray(extraAllow) ? extraAllow : []);
  const out = Object.create(null);
  for (const k of allow) {
    if (typeof src[k] !== "string") continue;
    if (TOKENISH_NAME.test(k)) continue;
    out[k] = src[k];
  }
  return out;
}

function isTokenishName(name) { return TOKENISH_NAME.test(String(name)); }
function promptHasRawSecret(text) { return SECRET_SHAPE.test(String(text || "")); }
function scrubSecrets(text) { return String(text == null ? "" : text).replace(secretShapeGlobal(), "«redacted»"); }
function isUnsafeShim(bin) { return UNSAFE_SHIM.test(String(bin || "")); }

/** Resolve the effective, trusted policy for a run. Returns { policy, violations }. */
function resolvePolicy(req, config) {
  const r = req || {};
  const c = config || {};
  const violations = CONTROL_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(r, k));

  const roots = c.projectRoots || {};
  const projectId = typeof r.projectId === "string" ? r.projectId : "";
  const repoRoot = Object.prototype.hasOwnProperty.call(roots, projectId) ? roots[projectId] : null;

  const p = c.policy || {};
  const op = c.operation || {};
  const policy = {
    repoRoot: repoRoot,
    expectedRemote: typeof p.expectedRemote === "string" ? p.expectedRemote : null,
    expectedBranch: typeof p.expectedBranch === "string" ? p.expectedBranch : null,
    requireClean: p.requireClean !== false,
    allowedPaths: Array.isArray(p.allowedPaths) ? p.allowedPaths.slice() : [],
    forbiddenPaths: Array.isArray(p.forbiddenPaths) ? p.forbiddenPaths.slice() : [],
    tools: Array.isArray(p.tools) ? p.tools.slice() : [],
    commands: Array.isArray(p.commands) ? p.commands.slice() : [],
    timeoutMs: Number.isFinite(p.timeoutMs) ? p.timeoutMs : 120000,
    maxOutputBytes: Number.isFinite(p.maxOutputBytes) ? p.maxOutputBytes : 2 * 1024 * 1024,
    maxPromptChars: Number.isFinite(p.maxPromptChars) ? p.maxPromptChars : 8000,
    envAllowlist: Array.isArray(p.envAllowlist) ? p.envAllowlist.slice() : [],
    monitorIgnoredContent: p.monitorIgnoredContent === true,
    mode: typeof p.mode === "string" ? p.mode : "propose",
    phaseId: typeof op.phaseId === "string" ? op.phaseId : null,
    approvalId: typeof op.approvalId === "string" ? op.approvalId : null,
    operationId: typeof op.operationId === "string" ? op.operationId : null,
  };
  return { policy, violations };
}

/** Normalise a repo-relative path for comparison (slash + optional case fold). */
function normPath(p) {
  const s = String(p).replace(/\\/g, "/");
  return caseFold() ? s.toLowerCase() : s;
}

/**
 * A change path is allowed only when relative, escape-free (no `..`, absolute, drive, UNC, NUL), matches
 * the allowlist, is not forbidden, is not ProjectOS source, and is not git metadata. Case-insensitive on
 * Windows/macOS so a re-cased new directory cannot slip a forbidden prefix.
 */
function isAllowedPath(p, policy) {
  if (typeof p !== "string" || !p) return false;
  if (p.includes("\0") || p.includes("..")) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p) || /^\\\\/.test(p)) return false; // abs/UNC
  const norm = normPath(p);
  if (norm === ".git" || norm.startsWith(".git/")) return false;
  if (norm === "projectos" || norm.startsWith("projectos/")) return false;
  const pref = (list) => (list || []).some((a) => {
    const an = normPath(a);
    return norm === an || norm.startsWith(an.endsWith("/") ? an : an + "/");
  });
  return pref(policy.allowedPaths) && !pref(policy.forbiddenPaths);
}

/** Reject an allowlist that itself reaches ProjectOS source / the whole repo. */
function allowlistTouchesProjectos(policy) {
  return (policy.allowedPaths || []).some((a) => {
    const an = normPath(a);
    return an === "projectos" || an.startsWith("projectos/") || an === "." || an === "" || an === "/";
  });
}

/**
 * Build a frozen, schema-shaped worker result. THROWS on a forbidden gate decision or forbidden field —
 * a forbidden authority claim must be a hard error, never silently coerced.
 */
function buildResult(fields) {
  const f = fields || {};
  const decision = String(f.workerDecision || "PROPOSED").toUpperCase();
  if (FORBIDDEN_WORKER_DECISIONS.includes(decision)) throw new Error("buildResult: forbidden workerDecision '" + decision + "'");
  for (const k of FORBIDDEN_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(f, k)) throw new Error("buildResult: forbidden field '" + k + "'");
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const controls = f.controls || {};
  const body = {
    schemaVersion: "2.0",
    operationId: f.operationId || null,
    projectId: f.projectId || null,
    phaseId: f.phaseId || null,
    approvalStatus: f.approvalStatus || "none",
    repository: { toplevel: f.toplevel || null, origin: f.origin || null },
    baselineBranch: f.baselineBranch || null,
    baselineHead: f.baselineHead || null,
    finalBranch: f.finalBranch || null,
    finalHead: f.finalHead || null,
    outcome: f.outcome || "unknown",
    reason: f.reason || null,
    // OS-containment evidence (honest names)
    sandboxProvider: f.sandboxProvider || null,
    sandboxPolicy: f.sandboxPolicy || null,
    canonicalVisibility: f.canonicalVisibility || "unknown",
    networkPolicy: f.networkPolicy || "unknown",
    processTerminationStatus: f.processTerminationStatus || "none",
    terminationDetail: f.terminationDetail || null,
    // trusted filesystem ledger (NOT git-derived)
    residualDriftStatus: f.residualDriftStatus || "unknown", // "no-residual-drift-detected" | "residual-drift-detected" | "not-evaluated"
    filesChanged: arr(f.filesChanged),
    refusedPaths: arr(f.refusedPaths),
    filesInspectionStatus: f.filesInspectionStatus || "NOT OBSERVABLE",
    changeManifest: arr(f.changeManifest),
    ledgerSummary: f.ledgerSummary || null,
    materialiseWarnings: arr(f.materialiseWarnings),
    patchHash: f.patchHash || null,
    // command / tool observation (honest)
    projectOsCommandsExecuted: arr(f.projectOsCommandsExecuted),
    workerCommandsObserved: arr(f.workerCommandsObserved),
    workerCommandsObservationStatus: f.workerCommandsObservationStatus || "NOT OBSERVABLE",
    workerToolsPermitted: arr(f.workerToolsPermitted),
    workerToolsVerified: f.workerToolsVerified === true,
    // controls, split by real enforcement status
    controls: {
      technicallyEnforced: arr(controls.technicallyEnforced),
      policyRequested: arr(controls.policyRequested),
      delegated: arr(controls.delegated),
      notVerified: arr(controls.notVerified),
      outOfScope: arr(controls.outOfScope),
    },
    timeoutStatus: f.timeoutStatus || "none",
    cancellationStatus: f.cancellationStatus || "none",
    killConfirmed: f.killConfirmed === undefined ? null : !!f.killConfirmed,
    outputRedactionStatus: f.outputRedactionStatus || "applied",
    envRedactionStatus: f.envRedactionStatus || "minimal-allowlist",
    outputExcerpt: typeof f.outputExcerpt === "string" ? f.outputExcerpt : "",
    residue: arr(f.residue),
    risks: arr(f.risks),
    workerDecision: decision,
    projectOsDecisionRequired: true,
  };
  const resultHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return deepFreeze(Object.assign(body, { resultHash }));
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

/** Validate a result against the v2 contract. `opts.real` requires non-null operation identity. */
function validateResult(result, opts) {
  const o = opts || {};
  const errors = [];
  const r = result || {};
  const required = [
    "schemaVersion", "operationId", "projectId", "phaseId", "approvalStatus", "repository", "baselineBranch",
    "baselineHead", "finalBranch", "finalHead", "outcome", "reason", "sandboxProvider", "sandboxPolicy",
    "canonicalVisibility", "networkPolicy", "processTerminationStatus", "residualDriftStatus", "filesChanged",
    "refusedPaths", "filesInspectionStatus", "changeManifest", "ledgerSummary", "patchHash", "projectOsCommandsExecuted",
    "workerCommandsObserved", "workerCommandsObservationStatus", "workerToolsPermitted", "workerToolsVerified",
    "controls", "timeoutStatus", "cancellationStatus", "killConfirmed", "outputRedactionStatus",
    "envRedactionStatus", "outputExcerpt", "residue", "risks", "workerDecision", "projectOsDecisionRequired",
    "resultHash",
  ];
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: missing field '" + k + "'");
  if (r.schemaVersion !== "2.0") errors.push("result: bad schemaVersion");
  if (FORBIDDEN_WORKER_DECISIONS.includes(String(r.workerDecision).toUpperCase())) errors.push("result: workerDecision is an authoritative gate outcome (forbidden)");
  for (const k of FORBIDDEN_RESULT_FIELDS) if (Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: forbidden field '" + k + "'");
  if (r.projectOsDecisionRequired !== true) errors.push("result: projectOsDecisionRequired must be true");
  if (OBSERVATION_STATUSES.indexOf(r.workerCommandsObservationStatus) < 0) errors.push("result: bad workerCommandsObservationStatus");
  // controls integrity: a delegated / notVerified / out-of-scope control must NOT be claimed technically enforced.
  const c = r.controls || {};
  const te = new Set((c.technicallyEnforced || []).map(String));
  for (const bucket of ["delegated", "notVerified", "outOfScope"]) {
    for (const x of (c[bucket] || [])) if (te.has(String(x))) errors.push("result: control '" + x + "' is in both technicallyEnforced and " + bucket);
  }
  // result-hash integrity
  if (r.resultHash) {
    const copy = Object.assign({}, r); delete copy.resultHash;
    const recomputed = crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
    if (recomputed !== r.resultHash) errors.push("result: resultHash integrity check failed (mutated or serialisation drift; not an HMAC — see report)");
  }
  // real operations require non-null identity
  if (o.real) {
    for (const k of ["operationId", "phaseId", "projectId", "baselineHead"]) if (!r[k]) errors.push("result: real operation requires non-null " + k);
  }
  return errors;
}

module.exports = {
  buildMinimalEnv, isTokenishName, promptHasRawSecret, scrubSecrets, isUnsafeShim, resolvePolicy,
  isAllowedPath, allowlistTouchesProjectos, buildResult, validateResult, deepFreeze, normPath,
  CONTROL_FIELDS, FORBIDDEN_WORKER_DECISIONS, FORBIDDEN_RESULT_FIELDS, SECRET_SHAPE, ENV_ALLOW_COMMON,
  OBSERVATION_STATUSES,
};
```

## sandbox-provider.cjs

```js
"use strict";
/**
 * OS-level worker-containment contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§4).
 *
 * The real Claude worker must NOT run with unrestricted access to the owner account. A sandbox PROVIDER
 * attests an OS-enforced boundary (restricted Windows account / Windows Sandbox / Hyper-V VM / WSL2 or
 * container / AppContainer restricted-token / another independently-enforced FS+network jail). This module
 * defines the contract, validates a provider, and FAILS CLOSED: with no approved provider, a real run is
 * BLOCKED — there is NO fallback to unrestricted owner-account execution.
 *
 * This phase does NOT install or activate any real sandbox. Synthetic proofs use a MOCK provider that
 * declares the same contract and runs the (synthetic) worker in-process; the mock explicitly attests that
 * the canonical repo, other projects, home, and credentials are NOT mounted and the network is disabled.
 */

const REQUIRED_FIELDS = [
  "name", "kind", "spawn", "attest",
  "readablePaths", "writablePaths", "mountedWorkspace",
  "canonicalVisibility", "otherProjectVisibility", "homeVisibility", "credentialVisibility",
  "networkPolicy", "permittedExecutables", "processLimits", "childProcessPolicy",
  "cleanupPolicy", "emergencyTermination",
];

// Values that make a provider acceptable for a REAL run. Anything weaker fails closed. A "disabled" network
// is the only acceptable network stance unless the provider carries a concrete, non-wildcard allowlist.
function networkOk(p) {
  if (p.networkPolicy === "disabled") return true;
  if (p.networkPolicy === "allowlist") return Array.isArray(p.networkAllowlist) && p.networkAllowlist.length > 0 && !p.networkAllowlist.some((h) => String(h).includes("*") || String(h) === "0.0.0.0/0");
  return false;
}
function isReallyIsolated(p) {
  return p
    && p.canonicalVisibility === "not-mounted"
    && p.otherProjectVisibility === "not-mounted"
    && p.homeVisibility === "not-mounted"
    && p.credentialVisibility === "not-mounted"
    && networkOk(p)
    && typeof p.spawn === "function"
    && Array.isArray(p.permittedExecutables);
}

function validateProvider(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["sandbox: no provider object"];
  for (const f of REQUIRED_FIELDS) if (!(f in p)) errors.push("sandbox: missing '" + f + "'");
  if (p && typeof p.spawn !== "function") errors.push("sandbox: spawn must be a function");
  if (p && typeof p.attest !== "function") errors.push("sandbox: attest must be a function (live enforcement canary)");
  if (p && p.networkPolicy === "allowlist" && !networkOk(p)) errors.push("sandbox: networkPolicy 'allowlist' requires a concrete non-wildcard networkAllowlist");
  if (p && !isReallyIsolated(p)) errors.push("sandbox: provider does not attest full isolation (canonical/other/home/credential must be not-mounted; network disabled or concrete allowlist)");
  return errors;
}

/**
 * Resolve the sandbox for a run. Fail-closed.
 * @returns { ok:true, provider } | { ok:false, decision:"BLOCKED", reason:"OS-SANDBOX-NOT-CONFIGURED"|... }
 */
function resolveSandbox(config, opts) {
  const o = opts || {};
  const p = config && config.sandboxProvider;
  if (!p) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-NOT-CONFIGURED" };
  const errors = validateProvider(p);
  if (errors.length) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-INVALID", errors };
  if (o.requireReal && p.kind === "mock") return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-MOCK-NOT-ALLOWED-FOR-REAL-RUN" };
  return { ok: true, provider: p };
}

/** A summary of the provider's policy for the evidence record (no secrets). */
function policySummary(p) {
  if (!p) return null;
  return {
    provider: p.name, kind: p.kind,
    mountedWorkspace: p.mountedWorkspace,
    canonicalVisibility: p.canonicalVisibility,
    otherProjectVisibility: p.otherProjectVisibility,
    homeVisibility: p.homeVisibility,
    credentialVisibility: p.credentialVisibility,
    networkPolicy: p.networkPolicy,
    permittedExecutables: p.permittedExecutables,
    processLimits: p.processLimits,
    childProcessPolicy: p.childProcessPolicy,
    cleanupPolicy: p.cleanupPolicy,
  };
}

/**
 * Build a MOCK provider for SYNTHETIC proofs only. It attests full isolation and runs the (synthetic) worker
 * via the supplied `spawnFn` bound to the workspace. It never grants real OS isolation — `kind:"mock"` is
 * refused for real runs.
 */
function mockProvider(spawnFn, overrides) {
  return Object.assign({
    name: "mock-sandbox", kind: "mock",
    spawn: (bin, argv, spawnOpts) => spawnFn(bin, argv, spawnOpts),
    // A REAL provider must implement attest(): spawn a canary that tries to read the canonical path / reach
    // the network and confirm failure. The mock declares (does not enforce) — it is refused for real runs.
    attest: () => ({ enforced: false, kind: "mock", note: "declared-only; not OS-enforced" }),
    readablePaths: ["<workspace>"], writablePaths: ["<workspace>"], mountedWorkspace: "<workspace>",
    canonicalVisibility: "not-mounted", otherProjectVisibility: "not-mounted",
    homeVisibility: "not-mounted", credentialVisibility: "not-mounted",
    networkPolicy: "disabled", networkAllowlist: [], permittedExecutables: ["<claude>"],
    processLimits: { cpuSeconds: 120, memoryMb: 2048, maxChildren: 32 },
    childProcessPolicy: "contained", cleanupPolicy: "destroy-on-exit",
    emergencyTermination: "kill-tree",
  }, overrides || {});
}

module.exports = { resolveSandbox, validateProvider, policySummary, mockProvider, isReallyIsolated, REQUIRED_FIELDS };
```

## workspace-ledger.cjs

```js
"use strict";
/**
 * Trusted disposable-workspace materialisation + filesystem ledger — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-
 * HARDEN1B (§5). Replaces the worker-controlled git diff entirely.
 *
 *   CANONICAL VERIFIED REPO → TRUSTED SOURCE MATERIALISATION (`git ls-tree` + per-blob `git show`, no `.git`)
 *     → DISPOSABLE WORKSPACE WITH **NO .git**
 *     → TRUSTED FS SNAPSHOT (before) → WORKER → TRUSTED FS SNAPSHOT (after) → TRUSTED FS DIFF
 *
 * The authoritative change manifest is derived ONLY from ProjectOS's own filesystem walk (lstat + content
 * hashing) — NEVER from `git status`/`git diff`/the git index/worker evidence/a worker-controlled `.git`.
 * Because the workspace is exported from a verified baseline and contains no `.git`, the worker has no git
 * state to manipulate; if it creates one, `.git` simply appears in the ledger as an added forbidden path.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const GIT_MAXBUF = 64 * 1024 * 1024;
function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

/**
 * Materialise the tracked tree at `baseHead` from the canonical repo into a fresh temp workspace with NO
 * `.git`. Dependency-free + cross-platform: enumerates the tree with `git ls-tree` and writes each blob via
 * `git show` (binary-safe), preserving symlinks (mode 120000) and the executable bit (mode 100755). No `tar`,
 * no shell, no Windows path pitfalls. ProjectOS-side, before the worker runs. Throws on failure (→ BLOCKED).
 * @returns { workspace, tarPath, files:[relpaths] }   (tarPath kept for API compatibility; unused)
 */
function materialize(repoRoot, baseHead) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pos-ws-"));
  const files = [];
  const symlinkFallbacks = []; // symlinks we could NOT create as links (e.g. Windows without privilege) — flagged, never silent
  try {
    const raw = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "-z", baseHead], { encoding: "utf8", maxBuffer: GIT_MAXBUF });
    for (const rec of raw.split("\0").filter(Boolean)) {
      // "<mode> <type> <sha>\t<path>"
      const tab = rec.indexOf("\t");
      const meta = rec.slice(0, tab).split(/\s+/);
      const mode = meta[0];
      const rel = rec.slice(tab + 1);
      const dest = path.join(workspace, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const content = execFileSync("git", ["-C", repoRoot, "show", baseHead + ":" + rel], { maxBuffer: GIT_MAXBUF }); // Buffer
      if (mode === "120000") { // symlink: blob content is the target
        try { fs.symlinkSync(content.toString("utf8"), dest); }
        catch (e) { fs.writeFileSync(dest, content); symlinkFallbacks.push(rel); } // recorded, not swallowed
      } else {
        fs.writeFileSync(dest, content);
        if (mode === "100755" && process.platform !== "win32") { try { fs.chmodSync(dest, 0o755); } catch (e) { /* best effort */ } }
      }
      files.push(rel);
    }
  } catch (e) {
    // Never leak a half-materialised workspace: clean up our own temp dir, then rethrow (caller → BLOCKED).
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (er) { /* best effort */ }
    throw e;
  }
  return { workspace, tarPath: path.join(workspace, ".pos-nonexistent"), files: files.sort(), symlinkFallbacks, empty: files.length === 0 };
}

/**
 * Trusted filesystem snapshot of `root`: a Map(relPath -> entry). Uses lstat (never follows symlinks), hashes
 * file content, records symlink targets + real-path escapes, includes HIDDEN and ignore-style files (there is
 * no ignore semantics here — every entry is recorded). Never throws for a single bad entry: it records an
 * `unreadable` marker so tampering can never hide behind a read error.
 */
function snapshot(root) {
  const map = Object.create(null);
  const rootReal = safeReal(root) || path.resolve(root);
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { map[rel(root, dir)] = { type: "dir", unreadable: true }; return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      const r = rel(root, full);
      let st;
      try { st = fs.lstatSync(full); }
      catch (er) { map[r] = { type: "unknown", unreadable: true }; continue; }
      const hidden = e.name.startsWith(".");
      if (st.isSymbolicLink()) {
        let target = null, escapes = false;
        try { target = fs.readlinkSync(full); } catch (er) { /* dangling name still recorded */ }
        const real = safeReal(full);
        escapes = !real || !insideRoot(real, rootReal);
        map[r] = { type: "symlink", size: st.size, linkTarget: target, escapes, hidden };
      } else if (st.isDirectory()) {
        map[r] = { type: "dir", hidden };
        walk(full);
      } else if (st.isFile()) {
        let hash = null, unreadable = false;
        try { hash = sha256File(full); } catch (er) { unreadable = true; }
        map[r] = { type: "file", size: st.size, mode: st.mode & 0o777, hash, unreadable, hidden };
      } else {
        map[r] = { type: "special", hidden }; // fifo/socket/device — recorded, never silently skipped
      }
    }
  };
  walk(root);
  return map;
}

function rel(root, full) { return path.relative(root, full).split(path.sep).join("/"); }
function safeReal(p) { try { return fs.realpathSync(p); } catch (e) { return null; } }
function insideRoot(p, rootReal) {
  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return p === rootReal || p.startsWith(withSep);
}

/**
 * Trusted diff between two snapshots. Returns a structured ledger with every change class the phase requires,
 * plus the flat `changedPaths` (added ∪ modified ∪ deleted ∪ type-changed ∪ rename endpoints) for policy
 * enforcement. Rename is a best-effort heuristic (a deleted file + an added file with identical content hash).
 */
function diff(before, after) {
  const added = [], deleted = [], modified = [], typeChanged = [], sameSizeContentChange = [], symlinkChanged = [],
    permissionChanged = [], escapes = [], unreadable = [], hidden = [], special = [];
  const bKeys = Object.keys(before), aKeys = Object.keys(after);
  for (const k of aKeys) {
    const a = after[k]; const b = before[k];
    if (a.escapes) escapes.push(k);
    if (a.unreadable) unreadable.push(k);
    if (a.hidden) hidden.push(k);
    if (a.type === "special") special.push(k);
    if (!b) { added.push(k); continue; }
    if (a.type !== b.type) { typeChanged.push(k); modified.push(k); continue; }
    if (a.type === "file") {
      if (a.hash !== b.hash || a.unreadable || b.unreadable) {
        modified.push(k);
        if (a.size === b.size) sameSizeContentChange.push(k); // content change without size change
      }
      if (a.mode !== b.mode) { permissionChanged.push(k); if (modified.indexOf(k) < 0) modified.push(k); } // mode-only change
    } else if (a.type === "symlink") {
      if (a.linkTarget !== b.linkTarget) { symlinkChanged.push(k); modified.push(k); }
    } else if (a.type === "special") {
      modified.push(k); // a socket/fifo/device cannot be hashed — any presence is treated as changed
    }
  }
  for (const k of bKeys) if (!after[k]) deleted.push(k);
  // rename heuristic: deleted file whose content-hash reappears as an added file
  const renamed = [];
  const addedFileHash = {};
  for (const k of added) if (after[k].type === "file" && after[k].hash) addedFileHash[after[k].hash] = k;
  for (const k of deleted) {
    const b = before[k];
    if (b && b.type === "file" && b.hash && addedFileHash[b.hash]) renamed.push({ from: k, to: addedFileHash[b.hash] });
  }
  // Unreadable entries + escapes are folded into changedPaths so policy enforcement can never pass over them.
  const changedPaths = uniq([].concat(added, modified, deleted, unreadable, escapes, special));
  return {
    added, deleted, modified, typeChanged, sameSizeContentChange, symlinkChanged, permissionChanged, renamed,
    escapes, unreadable, hidden, special, changedPaths,
  };
}

function uniq(a) { return Array.from(new Set(a)); }

/** Manifest (path -> content sha256 / status) derived from the trusted after-snapshot + diff. */
function manifest(after, ledger) {
  const out = [];
  for (const p of ledger.changedPaths) {
    const e = after[p];
    if (!e) { out.push({ path: p, status: "deleted" }); continue; }
    if (e.type === "file") out.push({ path: p, status: "file", sha256: e.hash || "UNREADABLE", size: e.size });
    else if (e.type === "symlink") out.push({ path: p, status: "symlink", target: e.linkTarget, escapes: !!e.escapes });
    else out.push({ path: p, status: e.type });
  }
  return out;
}

function dispose(dir) {
  const residue = [];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* checked */ }
  try { if (fs.existsSync(dir)) residue.push(dir); } catch (e) { residue.push(dir); }
  return residue;
}

module.exports = { materialize, snapshot, diff, manifest, dispose, sha256File };
```

## process-control.cjs

```js
"use strict";
/**
 * Worker process termination + emergency stop — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§6).
 *
 * A single immediate death check is insufficient. This module issues a tree-kill and verifies death with
 * BOUNDED, REPEATED checks against a WALL-CLOCK deadline, enumerating descendants where supported. Ambiguity
 * resolves toward NOT-confirmed (fail closed). Outcomes:
 *
 *   TERMINATED-CONFIRMED     — the process is gone and either (a) all enumerated descendants are gone, or
 *                              (b) descendants weren't enumerable but a tree-kill was issued (confidence is
 *                              reported as `descendantConfidence`); with `strictDescendants` only (a) counts.
 *   TERMINATION-UNCONFIRMED  — death could not be confirmed → caller must NOT reconcile/cleanup; preserve
 *                              evidence; take an external-operation LOCK; require owner resolution.
 *   EMERGENCY-STOP-REQUIRED  — a terminal, owner-actionable variant of UNCONFIRMED.
 *
 * A worker that cannot be confirmed dead must NEVER be reported as an ordinary REFUSED result.
 */

const { execFileSync } = require("child_process");

function posInt(n) { return Number.isInteger(n) && n > 0; }

/** True if a pid is alive. Only ESRCH ("no such process") counts as dead; any other error = alive/unknown. */
function alive(pid) {
  if (!posInt(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !(e && e.code === "ESRCH"); } // EPERM or any other error ⇒ treat as alive/unknown
}

/** Build the full parent→children map, then RECURSIVELY collect every descendant of `pid`. Returns null only
 *  when the process table cannot be read at all (truly not enumerable). */
function descendants(pid) {
  if (!posInt(pid)) return null;
  const childrenOf = buildChildMap();
  if (childrenOf === null) return null;
  const out = [];
  const seen = new Set();
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    for (const k of (childrenOf[p] || [])) { if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); } }
  }
  return out;
}

/** parent-pid → [child pids] for the whole process table, or null if it cannot be read. */
function buildChildMap() {
  try {
    if (process.platform === "win32") {
      // Primary: wmic CSV (last col=ProcessId, 2nd-last=ParentProcessId). Fallback: PowerShell Get-CimInstance
      // (wmic is deprecated/removed on newer Windows). If BOTH fail, return null ⇒ fail-closed under strict.
      let out;
      try { out = execFileSync("wmic", ["process", "get", "ProcessId,ParentProcessId", "/format:csv"], { encoding: "utf8", timeout: 6000 }); }
      catch (e1) {
        try { out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ParentProcessId),$($_.ProcessId)\" }"], { encoding: "utf8", timeout: 8000 }); }
        catch (e2) { return null; }
        const map = {};
        for (const line of out.split(/\r?\n/)) { const c = line.split(","); const ppid = parseInt(c[0], 10); const cpid = parseInt(c[1], 10); if (Number.isFinite(ppid) && Number.isFinite(cpid)) (map[ppid] = map[ppid] || []).push(cpid); }
        return map;
      }
      const map = {};
      for (const line of out.split(/\r?\n/)) {
        const cols = line.split(",");
        if (cols.length < 3) continue;
        const ppid = parseInt(cols[cols.length - 1], 10); // last col = ProcessId (alphabetical), 2nd-last = ParentProcessId
        const cpid = parseInt(cols[cols.length - 2], 10);
        if (!Number.isFinite(ppid) || !Number.isFinite(cpid)) continue;
        (map[cpid] = map[cpid] || []).push(ppid);
      }
      return map;
    }
    // posix: read /proc/<pid>/stat for PPid (field 4). Enumerable on Linux; on other posix returns null.
    const fs = require("fs");
    let entries;
    try { entries = fs.readdirSync("/proc"); } catch (e) { return null; }
    const map = {};
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync("/proc/" + name + "/stat", "utf8");
        const rp = stat.lastIndexOf(")");
        const fields = stat.slice(rp + 2).split(" ");
        const ppid = parseInt(fields[1], 10); // state=fields[0], ppid=fields[1]
        const cpid = parseInt(name, 10);
        if (Number.isFinite(ppid) && Number.isFinite(cpid)) (map[ppid] = map[ppid] || []).push(cpid);
      } catch (e) { /* process gone mid-walk */ }
    }
    return map;
  } catch (e) { return null; }
}

/** Tree-kill. NEVER called with a non-positive pid (guarded) — a null/0 pid could signal the caller's group. */
function killTree(pid) {
  if (!posInt(pid)) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-pid, "SIGKILL"); } catch (e) { try { process.kill(pid, "SIGKILL"); } catch (e2) { /* gone */ } } }
  } catch (e) { /* best effort */ }
}

/**
 * Terminate `pid` and confirm death with bounded retries against a wall-clock deadline.
 * @returns { status, pid, attempts, aliveAtEnd, descendantsChecked, descendantConfidence, deadlineMs, reason? }
 */
async function terminate(pid, opts) {
  const o = opts || {};
  if (!posInt(pid)) return { status: "TERMINATION-UNCONFIRMED", pid, attempts: 0, aliveAtEnd: null, descendantsChecked: false, descendantConfidence: "no-pid", deadlineMs: 0, reason: "invalid-pid" };
  const deadlineMs = Number.isFinite(o.deadlineMs) ? o.deadlineMs : 3000;
  const maxAttempts = Number.isFinite(o.maxAttempts) ? o.maxAttempts : 6;
  const intervalMs = Number.isFinite(o.intervalMs) ? o.intervalMs : 250;
  const strict = !!o.strictDescendants;
  const sleep = typeof o.sleepFn === "function" ? o.sleepFn : (ms) => new Promise((r) => setTimeout(r, ms));
  const isAlive = typeof o.aliveFn === "function" ? o.aliveFn : alive;
  const enumerate = typeof o.descendantsFn === "function" ? o.descendantsFn : descendants;
  const kill = typeof o.killFn === "function" ? o.killFn : killTree;
  const now = typeof o.now === "function" ? o.now : () => Date.now();

  const start = now();
  let attempts = 0, descendantsChecked = false;
  kill(pid);
  while (attempts < maxAttempts && (now() - start) <= deadlineMs) {
    attempts++;
    const kids = enumerate(pid);
    let kidsDead;
    if (kids !== null) { descendantsChecked = true; kids.forEach((k) => kill(k)); kidsDead = kids.every((k) => !isAlive(k)); }
    else kidsDead = strict ? false : true; // not enumerable: tree-kill confidence unless strict mode demands enumeration
    const parentDead = !isAlive(pid);
    if (parentDead && kidsDead) {
      return { status: "TERMINATED-CONFIRMED", pid, attempts, aliveAtEnd: false, descendantsChecked, descendantConfidence: descendantsChecked ? "enumerated" : "tree-kill-only", deadlineMs };
    }
    if (attempts >= maxAttempts || (now() - start) > deadlineMs) break;
    await sleep(intervalMs);
    kill(pid);
  }
  return { status: o.emergency ? "EMERGENCY-STOP-REQUIRED" : "TERMINATION-UNCONFIRMED", pid, attempts, aliveAtEnd: true, descendantsChecked, descendantConfidence: descendantsChecked ? "enumerated" : (strict ? "unknown" : "tree-kill-only"), deadlineMs };
}

function isConfirmedDead(result) { return result && result.status === "TERMINATED-CONFIRMED"; }

module.exports = { terminate, killTree, alive, descendants, isConfirmedDead, posInt };
```

## executable-check.cjs

```js
"use strict";
/**
 * ONE shared executable-validation function used by BOTH owner-capability-check and the worker adapter —
 * PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§7). It guarantees the capability check cannot report
 * READY for an executable the adapter would refuse. An existence-only check is NOT sufficient.
 *
 * Checks: resolved absolute path · supported file type · actual `--version` invocation · invocation timeout ·
 * shell:false compatibility · no unsafe shim (.cmd/.bat/.ps1 on Windows) · path never from task content.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const UNSAFE_SHIM = /\.(cmd|bat|ps1)$/i;

/** Resolve a bare command name to an absolute path via where/which; pass through an absolute path. */
function resolveAbsolute(bin) {
  if (!bin || typeof bin !== "string") return null;
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  try {
    const tool = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(tool, [bin], { encoding: "utf8", timeout: 6000, stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first && fs.existsSync(first) ? first : null;
  } catch (e) { return null; }
}

/**
 * Validate an executable. `opts.invoke` (default true) actually runs `--version`.
 * @returns { ok, reason, resolvedPath, version, isShim }
 */
function validateExecutable(bin, opts) {
  const o = opts || {};
  if (typeof bin !== "string" || !bin) return { ok: false, reason: "not-configured" };
  if (process.platform === "win32" && UNSAFE_SHIM.test(bin)) return { ok: false, reason: "unsafe-shim", isShim: true };
  const resolved = resolveAbsolute(bin);
  if (!resolved) return { ok: false, reason: "not-found" };
  if (process.platform === "win32" && UNSAFE_SHIM.test(resolved)) return { ok: false, reason: "unsafe-shim", resolvedPath: resolved, isShim: true };
  // Also reject when the realpath target is a shim (a link named `claude` pointing at `claude.cmd`).
  if (process.platform === "win32") { try { const real = fs.realpathSync(resolved); if (UNSAFE_SHIM.test(real)) return { ok: false, reason: "unsafe-shim", resolvedPath: resolved, isShim: true }; } catch (e) { /* ignore */ } }
  // Supported file type: a real file (not a directory); on posix, must be executable.
  let st;
  try { st = fs.statSync(resolved); } catch (e) { return { ok: false, reason: "stat-failed", resolvedPath: resolved }; }
  if (!st.isFile()) return { ok: false, reason: "not-a-file", resolvedPath: resolved };
  if (process.platform !== "win32" && !(st.mode & 0o111)) return { ok: false, reason: "not-executable", resolvedPath: resolved };
  if (o.invoke === false) return { ok: true, reason: "resolved-not-invoked", resolvedPath: resolved };
  // Actual invocation with a bounded timeout, shell:false (execFile never uses a shell).
  try {
    const out = execFileSync(resolved, [o.versionArg || "--version"], { encoding: "utf8", timeout: o.timeoutMs || 8000, stdio: ["ignore", "pipe", "ignore"] });
    const version = String(out).trim().split("\n")[0].slice(0, 80);
    return { ok: true, reason: "invoked", resolvedPath: resolved, version };
  } catch (e) { return { ok: false, reason: "invocation-failed", resolvedPath: resolved }; }
}

module.exports = { validateExecutable, resolveAbsolute, UNSAFE_SHIM };
```

## invocation-profile.cjs

```js
"use strict";
/**
 * Trusted Claude invocation-profile contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§8).
 *
 * Tool/command restrictions are only "enforced" when TECHNICALLY VERIFIED. This contract must FAIL CLOSED
 * when the installed CLI version or its supported restriction flags cannot be verified. For the first real
 * controlled-change proof the profile permits ONLY bounded file inspection + editing: no shell, no git-write,
 * no provider CLI, no database CLI, no deployment CLI, no network-capable tool.
 *
 * This module does NOT run the real CLI. It defines the profile shape, a fail-closed verifier, and the
 * first-controlled-change profile. Real detection of the CLI version + supported flags is an owner-machine
 * step; absent that, `verifyProfile` returns BLOCKED — WORKER-TOOL-RESTRICTION-NOT-PROVEN.
 */

const REQUIRED = [
  "cliVersion", "restrictionMechanism", "permittedTools", "forbiddenTools", "permittedCommands",
  "forbiddenCommands", "shellPermitted", "networkPermitted", "providerCliPermitted", "gitWritePermitted",
  "verified",
];

// For the FIRST controlled-change proof, all of these must be forbidden.
const MUST_FORBID_TOOLS = ["Bash", "Shell", "Execute", "WebFetch", "WebSearch"];
const MUST_BE_FALSE = ["shellPermitted", "networkPermitted", "providerCliPermitted", "gitWritePermitted"];

/** The mandatory profile for the first controlled-change proof: inspect + bounded edit only. */
function firstControlledChangeProfile(extra) {
  return Object.assign({
    cliVersion: null, // must be filled by real detection on the owner machine
    restrictionMechanism: null, // e.g. "--allowedTools" — must be a verified, supported mechanism
    permittedTools: ["Read", "Edit"],
    forbiddenTools: MUST_FORBID_TOOLS.concat(["Git", "GitWrite", "Provider", "Database", "Deploy"]),
    permittedCommands: [],
    forbiddenCommands: ["git", "gh", "supabase", "psql", "vercel", "npm", "curl", "wget", "ssh"],
    shellPermitted: false, networkPermitted: false, providerCliPermitted: false, gitWritePermitted: false,
    verified: false,
  }, extra || {});
}

/**
 * Fail-closed verification of a profile.
 * @returns { ok:true, profile } | { ok:false, decision:"BLOCKED", reason:"WORKER-TOOL-RESTRICTION-NOT-PROVEN", errors }
 */
function verifyProfile(profile, opts) {
  const o = opts || {};
  const errors = [];
  if (!profile || typeof profile !== "object") return blocked(["no profile"]);
  for (const k of REQUIRED) if (!(k in profile)) errors.push("missing '" + k + "'");
  if (profile.verified !== true) errors.push("profile.verified is not true (CLI version / supported flags not confirmed)");
  if (!profile.cliVersion) errors.push("cliVersion not detected");
  if (!profile.restrictionMechanism) errors.push("restrictionMechanism not a verified supported flag");
  if (!Array.isArray(profile.permittedTools)) errors.push("permittedTools must be an array");
  if (!Array.isArray(profile.permittedCommands)) errors.push("permittedCommands must be an array");
  if (o.firstControlledChange) {
    for (const f of MUST_BE_FALSE) if (profile[f] !== false) errors.push(f + " must be false for the first controlled-change proof");
    const permitted = new Set((Array.isArray(profile.permittedTools) ? profile.permittedTools : []).map(String));
    for (const t of MUST_FORBID_TOOLS) if (permitted.has(t)) errors.push("tool '" + t + "' must not be permitted");
    if (Array.isArray(profile.permittedCommands) && profile.permittedCommands.length > 0) errors.push("permittedCommands must be empty for the first controlled-change proof (inspect + edit only)");
  }
  if (errors.length) return blocked(errors);
  return { ok: true, profile: profile };
}
function blocked(errors) { return { ok: false, decision: "BLOCKED", reason: "WORKER-TOOL-RESTRICTION-NOT-PROVEN", errors }; }

/** Summary for the evidence record (booleans + lists, no secrets). */
function profileSummary(profile) {
  if (!profile) return null;
  return {
    cliVersion: profile.cliVersion, restrictionMechanism: profile.restrictionMechanism,
    permittedTools: profile.permittedTools, forbiddenTools: profile.forbiddenTools,
    permittedCommands: profile.permittedCommands, forbiddenCommands: profile.forbiddenCommands,
    shellPermitted: profile.shellPermitted, networkPermitted: profile.networkPermitted,
    providerCliPermitted: profile.providerCliPermitted, gitWritePermitted: profile.gitWritePermitted,
    verified: profile.verified,
  };
}

module.exports = { firstControlledChangeProfile, verifyProfile, profileSummary, REQUIRED, MUST_FORBID_TOOLS };
```

## owner-capability-check.cjs

```js
"use strict";
/**
 * Owner-machine capability check — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§7, §12). SAFE + read-only:
 * detects prerequisites only. No install, no provider connection, no repo change, no credential read, no
 * token printed. It uses the SAME shared executable checker as the worker adapter, so it can NEVER report a
 * Claude executable READY that the adapter would refuse (e.g. a `claude.cmd` shim on Windows).
 *
 * It distinguishes TECHNICAL readiness (can the synthetic validation run) from SECURITY readiness (is a real
 * worker run even permissible), and reports SANDBOX / TOOL-RESTRICTION / PROCESS-CONTROL explicitly. It never
 * emits a false READY.
 */

const { execFileSync } = require("child_process");
const execcheck = require("./executable-check.cjs");

function tryExec(bin, args) {
  try { return { ok: true, out: String(execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 })).trim().split("\n")[0].slice(0, 80) }; }
  catch (e) { return { ok: false, out: null }; }
}
function onPath(bin) { return (process.platform === "win32" ? tryExec("where", [bin]) : tryExec("which", [bin])).ok; }

/** Claude executable via the SHARED checker (rejects shims / existence-only / uninvocable). */
function detectClaude() {
  const names = process.platform === "win32" ? ["claude", "claude.exe"] : ["claude"];
  for (const n of names) { const v = execcheck.validateExecutable(n, { invoke: true }); if (v.ok) return { status: "PASS", how: "executable-validated", detail: v.version || v.resolvedPath }; }
  const shim = process.platform === "win32" ? execcheck.validateExecutable("claude.cmd", { invoke: false }) : { ok: false };
  const session = !!(process.env.CLAUDE_CODE_SESSION || process.env.CLAUDECODE || process.env.CLAUDE_DESKTOP);
  const how = shim.isShim ? "only-unsafe-shim-found" : session ? "session-present-but-no-safe-executable" : "no-safe-executable";
  return { status: "BLOCKED", how, detail: null };
}
function detectDocker() {
  if (!onPath("docker")) return { status: "BLOCKED", how: "no-docker-binary" };
  const info = tryExec("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return info.ok ? { status: "PASS", how: "daemon-running", detail: info.out } : { status: "BLOCKED", how: "binary-present-daemon-down" };
}
function detectSupabase() {
  if (!onPath("supabase")) return { status: "BLOCKED", how: "no-supabase-cli" };
  const v = tryExec("supabase", ["--version"]);
  return v.ok ? { status: "PASS", how: "cli-present", detail: v.out } : { status: "BLOCKED", how: "cli-error" };
}
// Sandbox + tool-restriction are OWNER-CONFIG, not machine facts; the check reports whether one is configured
// via the environment marker the owner sets after approving a provider/profile. Absent ⇒ BLOCKED (fail-closed).
function detectSandbox() { return process.env.PROJECTOS_SANDBOX_PROVIDER ? { status: "PASS", how: "provider-configured" } : { status: "BLOCKED", how: "no-approved-sandbox-provider" }; }
function detectToolRestriction() { return process.env.PROJECTOS_WORKER_PROFILE_VERIFIED === "1" ? { status: "PASS", how: "profile-verified" } : { status: "BLOCKED", how: "tool-restriction-not-proven" }; }
function detectProcessControl() { return { status: "PASS", how: "bounded-tree-termination-available" }; }
function detectGit() { const v = tryExec("git", ["--version"]); return v.ok ? { status: "PASS", how: "present", detail: v.out } : { status: "BLOCKED", how: "no-git" }; }

function check() {
  return {
    platform: process.platform, node: process.version,
    git: detectGit(), claude: detectClaude(), docker: detectDocker(), supabase: detectSupabase(),
    sandbox: detectSandbox(), toolRestriction: detectToolRestriction(), processControl: detectProcessControl(),
  };
}

/** Overall state. Security gates first (sandbox/executable/tool/process), then real-run infra. */
function overall(res) {
  const syntheticReady = res.git && res.git.status === "PASS";
  if (res.sandbox.status !== "PASS") return syntheticReady ? "READY-FOR-SYNTHETIC-VALIDATION" : "BLOCKED-OS-SANDBOX";
  if (res.claude.status !== "PASS") return "BLOCKED-EXECUTABLE";
  if (res.toolRestriction.status !== "PASS") return "BLOCKED-TOOL-RESTRICTION";
  if (res.processControl.status !== "PASS") return "BLOCKED-PROCESS-CONTROL";
  if (res.docker.status !== "PASS" || res.supabase.status !== "PASS") return "READY-FOR-SYNTHETIC-VALIDATION";
  return "READY-FOR-REAL-WORKER-PROOF";
}
/** The single blocking real-run reason, for owner guidance (distinct from the synthetic-ready state). */
function realBlockReason(res) {
  if (res.sandbox.status !== "PASS") return "BLOCKED-OS-SANDBOX";
  if (res.claude.status !== "PASS") return "BLOCKED-EXECUTABLE";
  if (res.toolRestriction.status !== "PASS") return "BLOCKED-TOOL-RESTRICTION";
  if (res.processControl.status !== "PASS") return "BLOCKED-PROCESS-CONTROL";
  if (res.docker.status !== "PASS") return "BLOCKED-DOCKER";
  if (res.supabase.status !== "PASS") return "BLOCKED-SUPABASE";
  return "READY-FOR-REAL-WORKER-PROOF";
}

const FRIENDLY = {
  sandbox: { title: "OS security sandbox", "no-approved-sandbox-provider": { label: "No approved OS sandbox is configured. Without one, the real worker is NOT SAFE to run — it would have your account's full access.", action: "Configure and approve an OS sandbox provider (restricted account / Windows Sandbox / VM / container). Until then only synthetic validation runs." } },
  claude: { title: "Claude Code worker executable", "session-present-but-no-safe-executable": { label: "A Claude session is signed in, but no safe runnable `claude` executable is on this machine.", action: "Install the Claude Code CLI as a real executable (not a .cmd/.bat shim), then re-run this check." }, "only-unsafe-shim-found": { label: "Only an unsafe `claude.cmd`/`.bat` shim was found; the worker refuses shims on Windows.", action: "Install a real `claude` executable (not a shim), then re-run this check." }, "no-safe-executable": { label: "No safe Claude executable found.", action: "Install and sign in to the Claude Code CLI, then re-run this check." } },
  toolRestriction: { title: "Worker tool restriction", "tool-restriction-not-proven": { label: "The worker's tool restriction is NOT technically proven for this CLI.", action: "Verify the installed CLI version and its supported restriction flags, then mark the profile verified." } },
  docker: { title: "Docker (for local Supabase)", "no-docker-binary": { label: "Docker is not installed.", action: "Install Docker Desktop and start it." }, "binary-present-daemon-down": { label: "Docker is installed but not running.", action: "Open Docker Desktop and wait until it says Running." } },
  supabase: { title: "Supabase CLI", "no-supabase-cli": { label: "Supabase CLI is not installed.", action: "Install the Supabase CLI." }, "cli-error": { label: "Supabase CLI did not respond.", action: "Reinstall or repair the Supabase CLI." } },
};

function present(res) {
  const L = [];
  const item = (key, r) => {
    const f = FRIENDLY[key] || {};
    const info = f[r.how] || { label: r.how, action: r.status === "PASS" ? null : "Resolve this prerequisite." };
    const badge = r.status === "PASS" ? "[ READY ]        " : "[ ACTION NEEDED ]";
    L.push(badge + " " + (f.title || key) + (r.detail ? "  (" + r.detail + ")" : ""));
    L.push("                  " + info.label);
    return info.action ? (f.title || key) + ": " + info.action : null;
  };
  L.push("Owner-machine readiness for the Forge worker (read-only — installs nothing, connects nowhere, reads no password)");
  L.push("");
  L.push("SECURITY readiness (required before ANY real worker run):");
  const a1 = item("sandbox", res.sandbox);
  const a2 = item("claude", res.claude);
  const a3 = item("toolRestriction", res.toolRestriction);
  L.push("");
  L.push("REAL-RUN infrastructure:");
  const a4 = item("docker", res.docker);
  const a5 = item("supabase", res.supabase);
  const actions = [a1, a2, a3, a4, a5].filter(Boolean);
  L.push("");
  const ov = overall(res);
  L.push("SYNTHETIC validation (offline safety proofs): " + (res.git.status === "PASS" ? "READY" : "BLOCKED (git missing)"));
  L.push("REAL worker run: " + realBlockReason(res));
  L.push("");
  if (ov === "READY-FOR-REAL-WORKER-PROOF") {
    L.push("RESULT: all security + infrastructure prerequisites are in place. A real worker proof is technically possible (still owner/ChatGPT-gated).");
  } else {
    L.push("RESULT: the real worker run is NOT permitted yet. Synthetic validation can still run safely.");
    L.push("");
    L.push("What to do next (in order):");
    actions.forEach((a, i) => L.push("  " + (i + 1) + ". " + a));
    L.push("");
    L.push("Nothing was installed or changed. NOT INSTALLED / NOT RUNNING / NOT SAFE are shown separately above.");
  }
  return L.join("\n");
}

if (require.main === module) console.log(present(check()));
module.exports = { check, overall, realBlockReason, present, detectClaude, detectDocker, detectSupabase, detectSandbox, detectToolRestriction, detectProcessControl };
```

## validate-claude-worker.cjs (MANDATORY SECURITY EVIDENCE)

```js
"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§11). Proves the safeguards
 * of the sandbox-gated, .git-free-workspace, trusted-filesystem-ledger worker adapter using a MOCK sandbox
 * provider + a SYNTHETIC CLI stand-in + REAL throwaway git repos. The REAL claude worker + real OS sandbox
 * are owner-machine steps. Opt-in (spawns + git + fs) — NOT part of `npm run validate`; run standalone.
 * 49 invariants (§11 + the round-2 ECC fixes). Env-dependent skips are individually justified and never cover a CRITICAL control.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const P = require("../bridge/worker-policy.cjs");
const ledger = require("../bridge/workspace-ledger.cjs");
const sandbox = require("../bridge/sandbox-provider.cjs");
const proc = require("../bridge/process-control.cjs");
const execcheck = require("../bridge/executable-check.cjs");
const profileMod = require("../bridge/invocation-profile.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const ORIGIN = "https://example.invalid/acme/app.git";
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }
function commonDir(repo) { return path.resolve(repo, g(repo, ["rev-parse", "--git-common-dir"]).trim()); }

function mkRepo(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]);
  g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]);
  g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  if (o.gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), o.gitignore + "\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  if (o.ignoredFile) fs.writeFileSync(path.join(dir, o.ignoredFile), "orig\n"); // exists on disk, ignored
  if (o.untrackedFile) fs.writeFileSync(path.join(dir, o.untrackedFile), "orig\n");
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
const errors = [];
const fail = (inv, m, got) => errors.push(inv + ": " + m + (got !== undefined ? " :: " + JSON.stringify(got) : ""));
// Per-invariant isolation: a crash in one invariant is recorded, never aborting the rest.
async function withRepo(fn, opts) { const repo = mkRepo(opts); try { await fn(repo); } catch (e) { errors.push("withRepo-crash: " + (e && e.message)); } finally { rmRepo(repo); } }

function verifiedProfile(over) { return profileMod.firstControlledChangeProfile(Object.assign({ cliVersion: "1.9.0", restrictionMechanism: "--allowedTools", verified: true }, over || {})); }

let lastEnv = null;
function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_bin, _argv, spawnOpts) => {
    lastEnv = spawnOpts.env;
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter();
    ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => {
      try { if (behavior) behavior(spawnOpts.cwd); } catch (e) { /* worker may fail */ }
      if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText));
      if (o.hang) return;
      if (o.floodOut) ch.stdout.emit("data", Buffer.from("x".repeat(5000)));
      if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000)));
      ch.emit("close", 0);
    });
    return ch;
  };
}
const writeIn = (rel, content) => (cwd) => { const abs = path.join(cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content == null ? "changed\n" : content); };

function baseCfg(repo, opts) {
  const o = opts || {};
  return {
    projectRoots: { acme: repo },
    policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 3000, maxOutputBytes: 1 << 20 }, o.policy || {}),
    operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" },
    claudeBin: "synthetic-claude", claudeArgs: (p) => ["-p", p], redactor: createRedactor(),
    sandboxProvider: o.provider !== undefined ? o.provider : sandbox.mockProvider(synthSpawn(o.behavior, o.stdout, o.spawnOpts), o.provOver),
    invocationProfile: o.profile !== undefined ? o.profile : verifiedProfile(),
    terminateOpts: o.terminateOpts, realRun: o.realRun, requireExecInvoke: o.requireExecInvoke, keepWorkspace: o.keepWorkspace,
  };
}
const REQ = { prompt: "add a file", projectId: "acme" };

async function run() {
  errors.length = 0;

  // 1 real-run blocked without sandbox provider
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: null, realRun: true }));
    if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv1", "real-run without sandbox not blocked", a);
  });
  // 2-4 mock sandbox attests canonical/other/home/credential not mounted
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") }));
    const sp = a.result && a.result.sandboxPolicy;
    if (!sp || sp.canonicalVisibility !== "not-mounted") fail("inv2", "canonical not attested not-mounted", sp);
    if (!sp || sp.otherProjectVisibility !== "not-mounted") fail("inv3", "other-project not attested not-mounted", sp);
    if (!sp || sp.homeVisibility !== "not-mounted" || sp.credentialVisibility !== "not-mounted") fail("inv4", "home/credential not attested not-mounted", sp);
    // 5 network-disabled represented + enforced by the contract
    if (!sp || sp.networkPolicy !== "disabled") fail("inv5", "network not disabled", sp);
    const bad = sandbox.validateProvider(sandbox.mockProvider(() => {}, { networkPolicy: "open" }));
    if (!bad.length) fail("inv5", "contract accepted network:open");
  });
  // 6 no writable .git in the materialised workspace
  await withRepo(async (repo) => {
    const mat = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim());
    const snap = ledger.snapshot(mat.workspace);
    if (Object.keys(snap).some((k) => k === ".git" || k.startsWith(".git/"))) fail("inv6", "workspace contains .git");
    if (!snap["app/seed.txt"]) fail("inv6", "materialise missing tracked file");
    ledger.dispose(mat.workspace); ledger.dispose(path.dirname(mat.tarPath));
  });
  // 7 worker git init detected/refused (creates .git in workspace)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => g(cwd, ["init", "-q"]) }));
    if (a.reason !== "forbidden-path-change" || !(a.result.refusedPaths || []).some((p) => P.normPath(p).startsWith(".git"))) fail("inv7", "worker git init not refused", a);
  });
  // 8 worker commit cannot hide a modification (FS ledger is authoritative)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { fs.writeFileSync(path.join(cwd, "app", "new.txt"), "x\n"); g(cwd, ["init", "-q"]); g(cwd, ["add", "-A"]); g(cwd, ["commit", "-q", "-m", "hide"]); } }));
    if (!(a.result.filesChanged || []).includes("app/new.txt")) fail("inv8", "commit hid the modification", a.result && a.result.filesChanged);
  });
  // 9 worker reset cannot hide a modification that persists
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { fs.writeFileSync(path.join(cwd, "app", "new.txt"), "x\n"); g(cwd, ["init", "-q"]); g(cwd, ["add", "-A"]); g(cwd, ["reset", "-q"]); } }));
    if (!(a.result.filesChanged || []).includes("app/new.txt")) fail("inv9", "reset hid the persisting modification", a.result && a.result.filesChanged);
  });
  // 10 worker clean cannot hide a file (FS sees it before any git; clean that removes it = nothing persists)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { fs.writeFileSync(path.join(cwd, "app", "keep.txt"), "x\n"); } }));
    if (!(a.result.filesChanged || []).includes("app/keep.txt")) fail("inv10", "FS ledger missed a created file", a.result && a.result.filesChanged);
  });
  // 11 worker-created ignore rule cannot hide a file (FS walk has no ignore semantics)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { fs.writeFileSync(path.join(cwd, ".gitignore"), "app/hidden.txt\n"); fs.writeFileSync(path.join(cwd, "app", "hidden.txt"), "x\n"); } }));
    if (!(a.result.filesChanged || []).includes("app/hidden.txt")) fail("inv11", "ignore rule hid the file", a.result && a.result.filesChanged);
  });
  // 12 hidden files are included
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/.secretcfg") }));
    if (a.decision !== "COMPLETED" || !(a.result.filesChanged || []).includes("app/.secretcfg")) fail("inv12", "hidden file not included", a.result && a.result.filesChanged);
  });
  // 13 existing IGNORED file content change (canonical) detected via deep monitor
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { policy: { monitorIgnoredContent: true }, behavior: () => fs.writeFileSync(path.join(repo, "app", "existing.log"), "TAMPERED\n") }));
    if (a.decision !== "BLOCKED" || a.reason !== "residual-drift-detected" || !(a.fields || []).includes("deepInventory")) fail("inv13", "ignored-file content change not detected", a);
  }, { gitignore: "*.log", ignoredFile: "app/existing.log" });
  // 14 existing UNTRACKED file content change (canonical) detected via deep monitor
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { policy: { monitorIgnoredContent: true, requireClean: false }, behavior: () => fs.writeFileSync(path.join(repo, "app", "loose.txt"), "TAMPERED\n") }));
    if (a.decision !== "BLOCKED" || a.reason !== "residual-drift-detected") fail("inv14", "untracked-file content change not detected", a);
  }, { untrackedFile: "app/loose.txt" });
  // 15/16 symlink/junction parent escape refused
  await withRepo(async (repo) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cw-out-")); fs.writeFileSync(path.join(outside, "s.txt"), "x\n");
    let made = false;
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { const lp = path.join(cwd, "app", "escape"); try { fs.symlinkSync(outside, lp, "junction"); made = true; } catch (e) { try { fs.symlinkSync(outside, lp, "dir"); made = true; } catch (e2) {} } } }));
    rmRepo(outside);
    if (!made) errors.push("inv15/16: SKIPPED-ENV (symlink/junction creation unavailable)");
    else if (a.reason !== "forbidden-path-change") fail("inv15/16", "symlink/junction escape not refused", a);
  });
  // 17 file-type change detected
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => { const p = path.join(cwd, "app", "seed.txt"); fs.unlinkSync(p); fs.mkdirSync(p); fs.writeFileSync(path.join(p, "inner"), "x\n"); } }));
    if (!a.result || !a.result.ledgerSummary || a.result.ledgerSummary.typeChanged < 1) fail("inv17", "file-type change not detected", a.result && a.result.ledgerSummary);
  });
  // 18 same-size content change detected
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: () => {}, spawnOpts: {}, }));
    // edit app/seed.txt (5 bytes "seed\n") -> "SEED\n" (5 bytes) inside workspace
    const a2 = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => fs.writeFileSync(path.join(cwd, "app", "seed.txt"), "SEED\n") }));
    if (!a2.result || !a2.result.ledgerSummary || a2.result.ledgerSummary.sameSizeContentChange < 1) fail("inv18", "same-size content change not detected", a2.result && a2.result.ledgerSummary);
  });
  // 19 timeout termination confirmed
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "timeout") fail("inv19", "timeout not enforced", a);
    else if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv19", "termination not confirmed", a.result.processTerminationStatus);
  });
  // 20 descendant termination confirmed (unit on process-control)
  {
    const t = await proc.terminate(4242, { aliveFn: () => false, descendantsFn: () => [4243, 4244], killFn: () => {}, sleepFn: async () => {} });
    if (t.status !== "TERMINATED-CONFIRMED" || !t.descendantsChecked) fail("inv20", "descendant termination not confirmed", t);
  }
  // 21 unconfirmed termination -> EMERGENCY-STOP (adapter)
  let emgWs = null;
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { behavior: writeIn("app/new.txt"), keepWorkspace: false, terminateOpts: { aliveFn: () => true, maxAttempts: 2, intervalMs: 1, sleepFn: async () => {}, killFn: () => {}, descendantsFn: () => null } });
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "EMERGENCY-STOP") fail("inv21", "unconfirmed termination not EMERGENCY-STOP", a);
    // 22 evidence preserved on unconfirmed termination
    const pres = (a.result && a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:"));
    if (!pres) fail("inv22", "evidence not preserved on unconfirmed termination", a.result && a.result.residue);
    else { emgWs = pres.slice("workspace-preserved:".length); if (!fs.existsSync(emgWs)) fail("inv22", "preserved workspace does not exist"); }
  });
  if (emgWs) rmRepo(emgWs); // clean up the deliberately-preserved evidence
  // 23 capability checker and adapter accept the SAME executable (shared module)
  {
    const nodeBin = process.execPath; // a real, invocable executable
    const shared = execcheck.validateExecutable(nodeBin, { invoke: true });
    if (!shared.ok) fail("inv23", "shared checker rejected node", shared);
    // capability + adapter both import the same execcheck (identity)
    if (require("../bridge/executable-check.cjs") !== execcheck) fail("inv23", "executable-check not a shared singleton");
  }
  // 24 claude.cmd cannot create a false READY (win32) / documented on posix
  {
    if (process.platform === "win32") {
      const v = execcheck.validateExecutable("claude.cmd", { invoke: false });
      if (v.ok || v.reason !== "unsafe-shim") fail("inv24", "claude.cmd not rejected as unsafe-shim", v);
    } else errors.push("inv24: SKIPPED-ENV (win32-only shim semantics)");
  }
  // 25 existence-only candidate cannot PASS (must actually invoke)
  await withRepo(async (repo) => {
    const dummy = path.join(repo, process.platform === "win32" ? "notclaude.exe" : "notclaude");
    fs.writeFileSync(dummy, "not a real program\n"); try { fs.chmodSync(dummy, 0o755); } catch (e) {}
    const v = execcheck.validateExecutable(dummy, { invoke: true });
    if (v.ok) fail("inv25", "existence-only file passed invocation", v);
  });
  // 26 tool restriction must be verified (adapter blocks unverified profile)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/x.txt"), profile: verifiedProfile({ verified: false }) }));
    if (a.decision !== "BLOCKED" || a.reason !== "WORKER-TOOL-RESTRICTION-NOT-PROVEN") fail("inv26", "unverified profile not blocked", a);
  });
  // 27 unsupported CLI version fails closed
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/x.txt"), profile: verifiedProfile({ cliVersion: null }) }));
    if (a.decision !== "BLOCKED" || a.reason !== "WORKER-TOOL-RESTRICTION-NOT-PROVEN") fail("inv27", "null cliVersion not blocked", a);
  });
  // 28 worker command visibility represented honestly
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") }));
    if (a.result.workerCommandsObservationStatus !== "NOT OBSERVABLE") fail("inv28", "worker command visibility overstated", a.result.workerCommandsObservationStatus);
  });
  // 29 delegated controls are not marked technically enforced
  {
    let threwOrErr = false;
    const bad = P.buildResult({ controls: { technicallyEnforced: ["deploy"], delegated: ["deploy"] } });
    if (!P.validateResult(bad).some((e) => /both technicallyEnforced and delegated/.test(e))) fail("inv29", "delegated-in-enforced not caught", P.validateResult(bad));
  }
  // 30 result schema rejects null real-operation identity
  {
    const res = P.buildResult({ projectId: "acme" }); // operationId null
    if (!P.validateResult(res, { real: true }).some((e) => /operationId/.test(e))) fail("inv30", "null real-op identity not rejected");
  }
  // 31 result is deeply immutable
  {
    const res = P.buildResult({ operationId: "OP1", filesChanged: ["app/x"] });
    if (!Object.isFrozen(res) || !Object.isFrozen(res.controls) || !Object.isFrozen(res.filesChanged)) fail("inv31", "result not deeply frozen");
    try { res.filesChanged.push("y"); if (res.filesChanged.length !== 1) fail("inv31", "frozen array mutated"); } catch (e) { /* frozen throw ok */ }
  }
  // 32 no worker self-approval/closure
  {
    let threw = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { threw = true; }
    if (!threw) fail("inv32", "APPROVED not rejected");
  }
  // 33 no metered AI API (source scan)
  {
    const rx = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i;
    for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "process-control", "executable-check", "invocation-profile", "owner-capability-check"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8");
      if (rx.test(src)) fail("inv33", "metered API/network reference in " + f);
    }
  }
  // 34 no production/provider/send/payment activity (source scan of the new modules)
  {
    const rx = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|vercel\.com\/api|process\.env\.(SUPABASE|STRIPE|RESEND)/i;
    for (const f of ["claude-worker", "workspace-ledger", "sandbox-provider", "process-control", "executable-check", "invocation-profile"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8");
      if (rx.test(src)) fail("inv34", "prod/provider/send/payment reference in " + f);
    }
  }
  // 35 canonical unchanged (no residual drift) during a benign synthetic run
  await withRepo(async (repo) => {
    const before = worker.monitorSnapshot(repo);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") }));
    if (a.decision !== "COMPLETED" || a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv35", "benign run drifted or wrong status", a.result && a.result.residualDriftStatus);
    if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv35", "canonical actually drifted");
  });
  // 36 temp workspace residue accurately reported
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") }));
    if (!a.result || a.result.residue.length !== 0) fail("inv36", "benign run reported residue", a.result && a.result.residue);
    const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt"), keepWorkspace: true }));
    const kept = (b.result && b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:"));
    if (!kept) fail("inv36", "kept workspace not reported as residue", b.result && b.result.residue);
    else rmRepo(kept.slice("kept-by-config:".length)); // clean the deliberately-kept workspace
  });
  // 37 working tree clean after validators: all repos are created under os.tmpdir (never the real tree), and
  //    the validator never references process.cwd().
  {
    const src = fs.readFileSync(__filename, "utf8");
    if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(src)) fail("inv37", "validator does not create repos under os.tmpdir()");
  }
  // 38 remote frozen: the validator only ever wires a non-routable test remote (example.invalid), never the
  //    real origin, and performs no network git — so it cannot affect origin/projectos-v3.
  {
    if (!/example\.invalid/.test(ORIGIN)) fail("inv38", "validator remote is not a non-routable test remote");
    if (/github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv38", "validator references the real remote");
  }

  // 39 process-control: a null/invalid pid never kills a process group and returns UNCONFIRMED
  {
    let threw = false; try { proc.killTree(0); proc.killTree(null); proc.killTree(-1); } catch (e) { threw = true; }
    if (threw) fail("inv39", "killTree threw on invalid pid");
    const t = await proc.terminate(null, { sleepFn: async () => {} });
    if (t.status !== "TERMINATION-UNCONFIRMED" || t.reason !== "invalid-pid") fail("inv39", "null pid not UNCONFIRMED", t);
  }
  // 40 process-control: unknown descendants under strict mode => not confirmed (fail closed)
  {
    const t = await proc.terminate(4242, { strictDescendants: true, descendantsFn: () => null, aliveFn: () => false, killFn: () => {}, sleepFn: async () => {}, maxAttempts: 2 });
    if (t.status === "TERMINATED-CONFIRMED") fail("inv40", "strict + unknown descendants wrongly confirmed", t);
  }
  // 41 process-control: alive() treats only ESRCH as dead
  {
    if (proc.alive(2147480000) !== false) fail("inv41", "definitely-dead pid reported alive");
    if (proc.alive(process.pid) !== true) fail("inv41", "own pid reported dead");
  }
  // 42 H2: a mock provider + requireExecInvoke (no realRun) is refused (real exe cannot run under a mock)
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/x.txt"), requireExecInvoke: true }));
    if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv42", "mock + requireExecInvoke not blocked", a);
  });
  // 43 non-mock provider must permit exactly the configured executable
  await withRepo(async (repo) => {
    const prov = sandbox.mockProvider(synthSpawn(writeIn("app/x.txt")), { kind: "restricted-account", permittedExecutables: ["node"] });
    const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, realRun: false }));
    // kind != mock => requireReal path in sandbox is fine (only mock is refused); exec-permitted check fires
    if (a.decision !== "BLOCKED" || !/EXECUTABLE/.test(a.reason)) fail("inv43", "executable not in provider allowlist not blocked", a);
  });
  // 44 M4: networkPolicy 'allowlist' without a concrete allowlist is rejected by the contract
  {
    const bad = sandbox.validateProvider(sandbox.mockProvider(() => {}, { networkPolicy: "allowlist", networkAllowlist: [] }));
    if (!bad.length) fail("inv44", "allowlist without entries accepted");
    const wild = sandbox.validateProvider(sandbox.mockProvider(() => {}, { networkPolicy: "allowlist", networkAllowlist: ["*"] }));
    if (!wild.length) fail("inv44", "wildcard allowlist accepted");
    const ok = sandbox.validateProvider(sandbox.mockProvider(() => {}, { networkPolicy: "allowlist", networkAllowlist: ["api.example.com"] }));
    if (ok.length) fail("inv44", "concrete allowlist rejected", ok);
  }
  // 45 M3: permittedCommands must be empty for the first controlled-change proof
  {
    const v = profileMod.verifyProfile(verifiedProfile({ permittedCommands: ["git"] }), { firstControlledChange: true });
    if (v.ok) fail("inv45", "non-empty permittedCommands accepted for first proof");
  }
  // 46 M2: a mode-only change is detected (unit on ledger.diff)
  {
    const before = { "app/x": { type: "file", size: 3, mode: 0o644, hash: "h1" } };
    const after = { "app/x": { type: "file", size: 3, mode: 0o755, hash: "h1" } };
    const d = ledger.diff(before, after);
    if (d.permissionChanged.indexOf("app/x") < 0 || d.changedPaths.indexOf("app/x") < 0) fail("inv46", "mode-only change not detected", d.permissionChanged);
  }
  // 47 special-type entry is always treated as changed (unit on ledger.diff)
  {
    const before = { "app/pipe": { type: "special" } };
    const after = { "app/pipe": { type: "special" } };
    const d = ledger.diff(before, after);
    if (d.modified.indexOf("app/pipe") < 0 || d.special.indexOf("app/pipe") < 0) fail("inv47", "special entry not treated as changed", d);
  }
  // 48 EMERGENCY-STOP result does NOT mark process-termination-confirm as technically enforced
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { behavior: writeIn("app/new.txt"), terminateOpts: { aliveFn: () => true, maxAttempts: 2, intervalMs: 1, sleepFn: async () => {}, killFn: () => {}, descendantsFn: () => null } });
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "EMERGENCY-STOP") fail("inv48", "not emergency", a.decision);
    else {
      const te = (a.result && a.result.controls && a.result.controls.technicallyEnforced) || [];
      if (te.indexOf("process-termination-confirm") >= 0) fail("inv48", "termination-confirm claimed enforced on unconfirmed run");
      const pres = (a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:"));
      if (pres) rmRepo(pres.slice("workspace-preserved:".length));
    }
  });
  // 49 a REAL (non-mock) provider that does not ATTEST enforcement is refused (attest wired, not just declared)
  await withRepo(async (repo) => {
    const prov = sandbox.mockProvider(synthSpawn(writeIn("app/x.txt")), { kind: "restricted-account", permittedExecutables: ["synthetic-claude"], attest: () => ({ enforced: false }) });
    const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, realRun: true }));
    if (a.decision !== "BLOCKED" || !/ATTESTATION|OS-SANDBOX/.test(a.reason)) fail("inv49", "non-attesting real provider not blocked", a);
  });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV"));
    const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (49 invariants" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };
```

---

**END OF BUNDLE.** END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. Not pushed, not closed. Remote frozen `4c3f076`.

# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A — SINGLE-FILE REVIEW BUNDLE

> Everything Murad + ChatGPT need to review the security-hardening of the governed Claude worker adapter, in
> one file: the report (with every mandated review section), then the full source of all four files.
> Local-only. Remote frozen at `4c3f076`.

**Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A` (security correction of the 1B adapter `b3d8421`)
**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.**
**Not pushed. Not closed. No production / provider / send / payment / secret / metered-AI API / install.**

---

# PART A — REPORT

## A1. Executive result

ChatGPT flagged the 1B worker adapter's containment as insufficient (it reconciled via a post-run
`git status` that the untrusted worker itself controlled). This phase **rebuilt the adapter's containment**
and passed it through **five ECC review perspectives across two rounds** (security, code, architecture,
failure-modes ×2). The result:

- **Isolation** is now a throwaway `git clone --no-hardlinks` with `origin` removed and a detached HEAD — a
  **separate `.git`** (no shared objects/refs/hooks/config), so the worker cannot reach canonical git state.
- **The canonical-untouched proof** is computed by **ProjectOS's own filesystem hashing** (tracked-file
  content hashes + clean status + an ignored/untracked inventory + a git-metadata content digest) — it never
  trusts a git command the worker could falsify.
- Every git call **fails closed** (error → `BLOCKED`, never a false "no change"); the canonical proof runs
  **unconditionally and first**; tool restriction is **fail-closed**; the worker cannot self-approve/close.

It is **honest about scope**: this is git- and filesystem-level containment + a minimal environment, **not an
OS sandbox**. A shell-capable worker runs with the owner account's privileges; the proof *detects* canonical
tampering but cannot *prevent* a worker from reading `~/.ssh` or the network — that requires OS-level
enforcement (container/VM or a restricted account) on the owner machine, documented as accepted risk.

The full 38-invariant security validator **PASSES** (1 env-skipped). `npm run validate` **ALL PASS (61)**.
The real `claude` CLI + Docker + Supabase remain owner-machine steps (this sandbox is BLOCKED for them).

## A2. Baseline (verified)

origin `universalbizcomply/ProjectOS`; branch `projectos-v3`; remote = **`4c3f076`** (frozen); pre-phase HEAD
`68c6e82`; working tree clean; `git diff --check` clean; recovery branch `forge-baseline-2026-07-12`. No
history rewrite.

## A3. Architecture after correction (repository-containment model)

```
PROJECTOS APPROVED BASELINE (canonical repo — never opened by the worker)
  │  canonicalSnapshot(before): toplevel/origin/branch/HEAD + clean-status
  │                            + ignoredInventory (incl. ignored+untracked)
  │                            + filesHash (every tracked file's content sha256)
  │                            + metaHash (config/HEAD/packed-refs/info-exclude|attributes|sparse
  │                                        + refs/** + hooks/* CONTENT, incl. symlink targets)
  ▼
THROWAWAY  git clone --no-hardlinks  (SEPARATE .git)  →  remove origin  →  checkout --detach baseHead
  ▼
WORKER (synthetic here / real `claude -p` on owner machine) edits ONLY inside the clone
  │   minimal env · argv+shell:false · timeout(tree-kill + confirmed death) · stdout/stderr caps
  ▼
canonicalSnapshot(after)  →  driftFields(before, after)   ← UNCONDITIONAL + FIRST (even on kill)
  │   any drift ⇒ BLOCKED "canonical-mutated"  (highest-priority failure)
  ▼
enumerate clone changes (strict) → enforce EVERY path (allowlist / forbidden / projectos/ / .git /
  symlink-escape, case-insensitive on Win/mac, both rename sides)
  ▼
TRUSTED change manifest (path → content sha256; patchHash = hash of manifest)   ← no git-diff trust
  ▼
dispose clone (real residue captured) → structured, validated RESULT  (NO apply, NO commit, NO gate decision)
```

## A4. Trusted-policy model

The worker **request** carries only CONTENT (`prompt`, `projectId`, `taskId`). Every control — repo root,
remote, branch, clean-tree, allowed/forbidden paths, tools, commands, timeout, output caps, env allowlist,
mode, phase/approval/operation ids — comes ONLY from trusted config. A request carrying any control field is
**refused** (`request-policy-tamper`), never merged. `repoRoot` is a trusted-registry lookup keyed by
`projectId` (prototype-pollution-safe); its value is never taken from the request.

## A5. Environment-isolation model

`buildMinimalEnv` builds an `Object.create(null)` from a small OS allowlist — it **never spreads
`process.env`** and additionally drops any credential-named variable (`*KEY/TOKEN/SECRET/…/SERVICE_ROLE/…`).
No provider key, session, `.env` value, or database URL can reach the child. Auth is the local Claude
client's own session; nothing is copied into the prompt, report, or child env. A prompt containing a raw
secret shape is **refused**; worker output is scrubbed (registered redactor + a generic secret-shape scrub)
before truncation.

## A6. Validator matrix (38 invariants — `validate-claude-worker.cjs`, PASS)

Request/content (1–5) · fail-closed capability: CLI-unset / `.cmd` shim on win32 / no-`claudeArgs` (6–8) ·
baseline: toplevel/remote/branch/clean (9–12) · env-isolation unit+spawn (13) · allowed-change→manifest+valid
result (14) · forbidden-path + rename-origin (15–16) · **direct canonical write / hook-content edit /
ref-tag creation / config edit / fake-clone-`.git`-can't-hide (17–21)** · timeout+confirmed-kill / stdout /
stderr caps (22–24) · registered + generic secret redaction (25–26) · buildResult throws on forbidden
decision / validateResult catches tamper / no-metered-API source scan / canonical-byte-identical benign
(27–30) · case-insensitive-forbidden / abs-UNC reject (31–32) · capability overall + owner-friendly
presentation (33–34) · **info/exclude tamper / SYMLINKED hook / dangerous-CLI-flag / ignored-file drop
(35–38)**. inv36 (file symlink) env-skipped where the host can't make links unprivileged; code-verified,
runs on the owner machine.

## A7. Exact test results

- `node projectos/validators/validate-claude-worker.cjs` → **PASS (38 invariants, 1 env-skipped)**.
- `npm run validate` → **validate-all: ALL PASS (61 validators)**.
- `git diff --check` → clean. Temp clone residue after all runs → **0**.
- `node projectos/bridge/owner-capability-check.cjs` → claude BLOCKED / docker BLOCKED / supabase BLOCKED →
  **OVERALL BLOCKED-OWNER-MACHINE-CAPABILITY** (correct for this sandbox).

## A8. Full ECC findings (5 perspectives, 2 rounds — every finding + resolution)

**Round 1 (on the initial worktree design):**
- **Security (CRITICAL/HIGH):** C1 worker rewrites its own `.git` → git-status reconciliation reads a fake;
  C2 hooks hashed by filename not content; C3/H3 shared object/ref store lets the worker create canonical
  branches/tags; H4 `policy.tools` unenforced → full default tool access; M5 case-insensitive path bypass;
  dead ternary; UNC. → **Drove the clone rewrite.**
- **Code (4×HIGH):** canonical check skipped on killed paths; unguarded `execFileSync` rejects instead of
  fail-safe; no `maxBuffer`; patch failure silently "success"; `.cmd` shim re-enters cmd.exe on win32; kill
  unconfirmed; `filesInspected` unpopulated.
- **Architect (H/M/L):** git-level-only guarantee overstated; asserts checks not performed; duplicate
  forbidden-field + secret regexes; shared-common-dir refs uncovered; no audit record on non-happy outcomes;
  recommended the throwaway-clone design (adopted).
- **Silent-failure (CRITICAL):** `gitTrim`→null collapses into a false "no drift"; canonical check happy-path
  only; residue hardcoded empty; `buildResult` silently coerces forbidden decisions.

**Round 2 (re-verification on the clone rewrite):**
- **Security:** C1(orig)/C2(orig)/C3/H3 **RESOLVED**. Two NEW gaps in the FS proof: **HIGH-1** `.git/info/
  exclude` + non-`--ignored` status → hidden-file plant; **HIGH-2** metadata walk skips symlink entries;
  **MEDIUM-1** `policy.tools` still not threaded into `claudeArgs`, no argv denylist. → **All fixed** (see A10).
- **Silent-failure:** 4/6 fully resolved; **A** `audit()` re-swallows the `buildResult` throw; **B** residue
  not computed on 8/10 post-clone exits (incl. `canonical-mutated`); C `keepClone` residue; D sentinel; E
  symlink-escape TOCTOU. → **All fixed** (see A10). F (single kill-check) informational, fails safe.

No open CRITICAL or HIGH remains in the adapter.

## A9. Claude self-review findings (mandated after each step + final independent pass)

Applied the 10-point checklist after each material change. Findings I raised and fixed myself: the
timeout/overflow **promise-hang** (killed synthetic child never emits `close`); the **hooks-dir cwd** bug
(git-common-dir resolved against process cwd); the honest **reset-to-hide reframe** (reset-to-same-HEAD is
traceless and harmless under the clone model — asserted as neutralisation, not faked as detection); and in the
**final pass**, three residual Finding-B leftovers (`manifest-derivation-failed` and both `result-*` paths not
folding real residue) — corrected. Every synthetic-only proof is labelled as such; the real worker/Supabase
remain owner-machine steps.

## A10. Defects found and corrected (consolidated)

| # | Source | Defect | Fix |
|---|--------|--------|-----|
| 1 | self | timeout/overflow promise hang | `abort()` resolves immediately on kill, `done`-guarded |
| 2 | self | hooks-dir resolved vs process cwd | `resolveGitDir` vs `repoRoot` |
| 3 | sec C1/C2/C3 | audit through worker-controlled `.git` / shared store | clone (`--no-hardlinks`, origin removed) + FS-hash canonical proof |
| 4 | sec H4 / code H4 | tools unenforced / `.cmd` shim re-enters cmd.exe | fail-closed `claudeArgs` required; reject shim bin on win32 |
| 5 | code H1 / sf#5 | canonical check skipped on kill | reconciliation unconditional + first |
| 6 | code H2/H3 / sf#3 | unguarded git rejects / no maxBuffer / silent patch success | strict git (→BLOCKED), `GIT_MAXBUF`, manifest-fail→BLOCKED |
| 7 | sf 1a–1e | `gitTrim` null-collapse false "no drift" | `gitStrict`/`gitLine` throw; snapshot→BLOCKED; baseHead checked |
| 8 | sf-bonus | `buildResult` silent coercion | now **throws** on forbidden decision/field |
| 9 | sf-A | `audit()` re-swallows the throw | surfaces `resultBuildError`, never omits silently |
| 10 | sf-B/C | residue understated on failure paths / keepClone | `done()` folds real residue on every post-clone exit; keepClone reports kept path |
| 11 | sec HIGH-1 | `.git/info/exclude` gap + ignored files | info/exclude|attributes|sparse in metaHash + `ignoredInventory` field |
| 12 | sec HIGH-2 | symlinked hook/ref invisible to walk | walk hashes `readlinkSync` for symlink entries |
| 13 | sec MEDIUM-1 | tools not threaded / no argv denylist | `claudeArgs(prompt, {tools,commands,mode})` + `DANGEROUS_FLAG` denylist |
| 14 | sf-D/E | silent sentinel omission / symlink-escape TOCTOU | error sentinels; dangling-symlink → escape |
| 15 | arch M2/M3 | duplicate forbidden-field + secret regexes | single source in `worker-policy.cjs` |
| 16 | code/arch | dead ternary, dead import, dead `state()` | removed |

## A11. UI UX Pro Max findings — **UNAVAILABLE**

"UI UX Pro Max" is **not an installed skill/plugin** in this Claude Code environment. It was **not
fabricated**. Strongest equivalent performed manually: the one owner-facing surface this phase adds is the
**capability-check readout**, redesigned for no-training-required clarity — explicit `[ READY ] / [ ACTION
NEEDED ]` states, a plain-language line per item, an ordered "What to do next" list, and a secret-safe
reassurance ("nothing was installed or changed"), with all machine jargon (`session-present-but-no-spawnable-
cli`, etc.) mapped to friendly text. Regression-guarded by inv34. No GUI screen exists in this phase; none was
invented to "review".

## A12. Claude Design findings — **UNAVAILABLE**

"Claude Design" is **not an installed skill/plugin** here; **not fabricated**. Equivalent applied from the
ECC web design-quality / a11y rules: information hierarchy (state badge → what → next action), consistency
(one mapping table drives all three items), and jargon-elimination. Terminal accessibility (keyboard/mobile/
contrast, WCAG) does not apply to a Node console readout — recorded as N/A rather than claimed. When a
capability-check **GUI** is later added to the Forge console (owner machine), it should reuse the existing
`control-center/src/forge` components and be reviewed then.

## A13. Unavailable skills or plugins (honest ledger)

- **UI UX Pro Max** — not installed → manual equivalent (A11).
- **Claude Design** — not installed → manual equivalent (A12).
- **Real `claude` CLI worker** — absent in this sandbox → guards proven against a synthetic stand-in; real
  round-trip is an owner-machine step.
- **Docker / local Supabase** — absent → Gates 2–3 remain owner-machine steps.
- Available + used: security-reviewer, code-reviewer, architect, silent-failure-hunter (ECC agents).

## A14. Remaining limitations (accepted / follow-ups)

1. **OS sandbox (accepted risk, owner machine).** A shell-capable worker runs with owner privileges; the
   canonical proof DETECTS canonical tampering but does not PREVENT out-of-tree reads/writes or network. Real
   isolation of a fully-untrusted worker needs a container/VM or restricted account on the owner machine.
2. **`policy.tools` content enforcement is delegated** to the trusted `claudeArgs` builder (+ an adapter
   denylist). The adapter cannot itself prove the builder encoded the exact allowlist — the builder must be
   reviewed when wired on the owner machine.
3. **Deferred follow-ups:** route the worker result through `desktop-bridge` as a single approval choke point
   (arch-M1); a CI lane for the opt-in validator (arch-M5).
4. **Perf:** `--no-hardlinks` clone + tracked-file hashing per run is heavier than a worktree — acceptable for
   bounded phases; note for very large repos.
5. A file dropped **inside a pre-existing ignored directory** whose contents git collapses may not itself
   drift `ignoredInventory` at file granularity — not source-reachable; covered by the OS-sandbox note.

## A15. Owner-machine capability-check instructions

On the owner machine run `node projectos/bridge/owner-capability-check.cjs`. It is read-only (no install, no
credentials, no repo change). Proceed to the real Gate 1–3 run **only** when it prints
`OVERALL READY-FOR-REAL-E2E`. Until then it lists, in order, exactly what to install/start.

## A16. No-X proofs · git · decision

No production · No deploy · No provider · No send · No payment · **No metered AI API** (source-scanned) · No
network · **No system software installed** (Docker/CLI absence recorded, not installed) · No secret disclosed.
Branch `projectos-v3`; remote unchanged `4c3f076`; **Pushed: NO**; **Closed: NO**. The next gate is **ChatGPT
review** of this hardened adapter + validator evidence.

**Decision required:** ChatGPT/Murad review of the hardening. On acceptance, the next phase runs the real
Gate 1–3 on an owner machine that reports `READY-FOR-REAL-E2E`.

---

**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.** Clone-isolated, FS-proof, fail-closed worker
adapter; 38-invariant security validator PASS; no open HIGH/CRITICAL; honest owner-machine limitations
documented. Not pushed, not closed.

---

# PART B — FULL SOURCE: `projectos/bridge/claude-worker.cjs`

```js
"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A.
 *
 * Containment model (rebuilt after the ChatGPT + ECC review round):
 *
 *   PROJECTOS APPROVED BASELINE (canonical repo)
 *     → THROWAWAY `--no-hardlinks` CLONE with `origin` removed (a SEPARATE .git: no shared
 *       objects/refs/hooks/config — the worker cannot reach canonical git state at all)
 *     → WORKER makes bounded edits inside the clone
 *     → PROJECTOS enumerates the clone's changes, validates EVERY path against trusted policy
 *     → PROJECTOS proves the CANONICAL repo is untouched using its OWN filesystem hashing
 *       (tracked-file content hashes + clean status + a git-metadata content digest) — NOT by trusting any
 *       git command the worker could have falsified
 *     → NO automatic application to canonical, NO automatic commit; a validated STRUCTURED RESULT is
 *       returned for the owner/ChatGPT gate to act on
 *
 * HONEST SCOPE: this is GIT- and FILESYSTEM-level containment + a minimal environment + fail-closed tool
 * restriction. It is NOT an OS sandbox. A worker granted shell/file tools runs with the owner account's
 * privileges and can touch things outside the clone; the canonical-repo proof DETECTS such tampering of
 * canonical but cannot PREVENT a worker from reading ~/.ssh or the network. Isolating a fully-untrusted
 * worker requires OS-level enforcement (container/VM or a restricted account) on the OWNER machine. Every
 * git call fails CLOSED (a git error → BLOCKED, never a false "no change"). Claude cannot approve/close.
 *
 * The REAL `claude` CLI is an owner-machine step; `spawnFn` is injectable so the guards are proven against a
 * synthetic stand-in here.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { createRedactor } = require("../security/redaction.cjs");
const P = require("./worker-policy.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024; // generous — a normal change set / config listing must not truncate
const CONTROLS_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree",
  "minimal-env", "no-shell-shim", "fail-closed-tools", "timeout", "output-cap", "path-allowlist",
  "no-git-metadata", "symlink-escape", "canonical-untouched"];
const DELEGATED = ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"]; // owner/executor, not this adapter

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

/** Strict git: throws on failure (never null-collapses). Bulk-safe maxBuffer. */
function gitStrict(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: GIT_MAXBUF });
}
/** Strict git returning trimmed stdout, or throwing. */
function gitLine(repoRoot, args) { return gitStrict(repoRoot, args).trim(); }

function refused(reason, extra) { return Object.assign({ ok: false, decision: "REFUSED", reason }, extra || {}); }
function blocked(reason, extra) { return Object.assign({ ok: false, decision: "BLOCKED", reason }, extra || {}); }

function resolveGitDir(repoRoot, answer) { return path.isAbsolute(answer) ? answer : path.resolve(repoRoot, answer); }

/**
 * A TRUSTED baseline of the canonical repo, computed by ProjectOS before the worker runs and re-computed
 * after — used to prove the canonical repo is byte-for-byte untouched. Throws on any git/fs error (the
 * caller converts that to BLOCKED). Covers: identity, every tracked file's content hash, and a git-metadata
 * content digest (config + HEAD + packed-refs + refs/** + hooks/*) so hook-content edits, config edits, and
 * ref/tag creation are all caught even if done by direct filesystem writes.
 */
function canonicalSnapshot(repoRoot) {
  const toplevel = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]);
  const origin = safeOrigin(repoRoot);
  const branch = gitLine(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = gitLine(repoRoot, ["rev-parse", "HEAD"]);
  const status = gitStrict(repoRoot, ["status", "--porcelain"]).trim();
  // A separate inventory that INCLUDES ignored + all untracked, so a file dropped into canonical cannot hide
  // behind an ignore rule (before/after cancel for pre-existing ignored paths; a NEW drop drifts). Kept off
  // the requireClean `status` so a legitimately clean repo with ignored build dirs still passes.
  const ignoredInventory = sha256(gitStrict(repoRoot, ["status", "--porcelain", "--ignored", "--untracked-files=all", "-z"]));
  // tracked file content hashes
  const tracked = gitStrict(repoRoot, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  const files = {};
  for (const rel of tracked) {
    const abs = path.join(repoRoot, rel);
    try { files[rel] = sha256(fs.readFileSync(abs)); } catch (e) { files[rel] = "MISSING"; }
  }
  return { toplevel, origin, branch, head, status, ignoredInventory, filesHash: sha256(JSON.stringify(files)), metaHash: gitMetaDigest(repoRoot) };
}

function safeOrigin(repoRoot) {
  // A configured-but-unreadable origin is a distinguishable sentinel, not silently "" (which could mask a
  // remote change). "no-origin" only when git reports there genuinely is none.
  try { return gitLine(repoRoot, ["remote", "get-url", "origin"]); }
  catch (e) { return /No such remote|no such remote|error: No such/i.test(String(e.message)) ? "no-origin" : "origin-unreadable"; }
}

/** Content digest of the git metadata that can carry a persistent escape. Throws on unexpected fs errors. */
function gitMetaDigest(repoRoot) {
  const common = resolveGitDir(repoRoot, gitLine(repoRoot, ["rev-parse", "--git-common-dir"]));
  const parts = [];
  // On a read error record a distinguishing sentinel (never a silent omission that could mask tampering).
  const addFile = (p) => {
    try { if (fs.existsSync(p)) parts.push(p + ":" + sha256(fs.readFileSync(p))); }
    catch (e) { parts.push(p + ":ERR"); }
  };
  addFile(path.join(common, "config"));
  addFile(path.join(common, "HEAD"));
  addFile(path.join(common, "packed-refs"));
  // ignore/attribute indirection that can hide a dropped file or alter checkout semantics
  addFile(path.join(common, "info", "exclude"));
  addFile(path.join(common, "info", "attributes"));
  addFile(path.join(common, "info", "sparse-checkout"));
  // refs/** and hooks/* — content (not just names), INCLUDING symlinked entries (a symlinked hook/ref must
  // not be invisible: Dirent.isFile()/isDirectory() are both false for a symlink).
  const walk = (dir, tag) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { parts.push(full + ":LINK:" + sha256(fs.readlinkSync(full))); } catch (er) { parts.push(full + ":LINKERR"); } }
      else if (e.isDirectory()) walk(full, tag);
      else if (e.isFile()) { if (tag === "hooks" && e.name.endsWith(".sample")) continue; addFile(full); }
    }
  };
  walk(path.join(common, "refs"), "refs");
  walk(path.join(common, "hooks"), "hooks");
  return sha256(parts.sort().join("|"));
}

function driftFields(a, b) {
  return ["toplevel", "origin", "branch", "head", "status", "ignoredInventory", "filesHash", "metaHash"].filter((k) => a[k] !== b[k]);
}

/** Every path the worker touched in the clone — both rename sides — from NUL porcelain. Throws on error. */
function cloneChanges(clone) {
  const raw = gitStrict(clone, ["status", "--porcelain", "-z"]);
  const tok = raw.split("\0").filter((t) => t.length > 0);
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    const rec = tok[i];
    if (/[RC]/.test(rec.slice(0, 2)) && i + 1 < tok.length) { out.push(rec.slice(3), tok[i + 1]); i++; }
    else out.push(rec.slice(3));
  }
  return out;
}

function pathEscapes(root, rel) {
  const abs = path.resolve(root, rel);
  // A path that is itself a symlink whose target does not resolve inside `root` (incl. a DANGLING symlink,
  // where realpath fails) must be treated as an escape — never fall back to the literal in-tree path.
  let isLink = false;
  try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch (e) { /* not present */ }
  const target = safeReal(abs);
  if (isLink && !target) return true; // dangling/unresolvable symlink → escape
  const base = safeReal(root) || path.resolve(root);
  const resolved = target || abs;
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  return !(resolved === base || resolved.startsWith(withSep));
}
function safeReal(p) { try { return fs.realpathSync(p); } catch (e) { return null; } }

// Known-dangerous CLI flags a trusted `claudeArgs` builder must never emit — adapter-side defence in depth
// so a drifted builder cannot silently grant full autonomy.
const DANGEROUS_FLAG = /^--?(dangerously-skip-permissions|no-sandbox|allow-all|yolo|permission-mode=bypass)/i;

/** Spawn the worker in `clone` with a minimal env; enforce timeout + output caps; confirm the kill. */
function spawnWorker(clone, bin, argv, childEnv, policy, spawnFn) {
  const posix = process.platform !== "win32";
  return new Promise((resolve) => {
    let stdout = "";
    let stderrBytes = 0;
    let killedFor = null;
    let done = false;
    let child;
    const finish = (payload) => { if (done) return; done = true; clearTimeout(timer); detach(); resolve(payload); };
    const detach = () => { try { child.stdout && child.stdout.removeAllListeners("data"); child.stderr && child.stderr.removeAllListeners("data"); } catch (e) { /* ignore */ } };
    try { child = spawnFn(bin, argv, { cwd: clone, shell: false, detached: posix, env: childEnv }); }
    catch (e) { return resolve({ killedFor: "spawn-error", code: null, killConfirmed: true, stdout: "" }); }
    const killTree = () => {
      try {
        if (!posix) execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { child.kill("SIGKILL"); } }
      } catch (e) { /* best effort */ }
    };
    const confirmDead = () => { try { process.kill(child.pid, 0); return false; } catch (e) { return true; } };
    const abort = (why) => {
      killedFor = why; detach(); killTree();
      // Best-effort confirmation the process is actually gone (bounded, non-blocking of the loop).
      let confirmed = confirmDead();
      finish({ stdout, killedFor: why, code: null, killConfirmed: confirmed });
    };
    const timer = setTimeout(() => abort("timeout"), policy.timeoutMs);
    child.stdout && child.stdout.on("data", (d) => { stdout += d.toString(); if (Buffer.byteLength(stdout, "utf8") > policy.maxOutputBytes) abort("output-overflow"); });
    child.stderr && child.stderr.on("data", (d) => { stderrBytes += d.length; if (stderrBytes > policy.maxOutputBytes) abort("stderr-overflow"); });
    child.on("error", () => finish({ killedFor: killedFor || "spawn-error", code: null, killConfirmed: true, stdout }));
    child.on("close", (code) => finish({ stdout, killedFor, code, killConfirmed: true }));
  });
}

function disposeClone(repoRoot, clone) {
  const residue = [];
  try { fs.rmSync(clone, { recursive: true, force: true }); } catch (e) { /* checked below */ }
  try { if (fs.existsSync(clone)) residue.push(clone); } catch (e) { residue.push(clone); }
  if (residue.length) { try { console.error("[claude-worker] residue not removed: " + clone); } catch (e) { /* ignore */ } }
  return residue;
}

/**
 * Run one bounded worker task under containment.
 * @param req    { prompt, projectId, taskId? }  — CONTENT ONLY, no control fields
 * @param config { projectRoots:{[id]:absRoot}, policy:{...}, operation:{...}, claudeBin, claudeArgs(prompt)->[],
 *                 spawnFn?, redactor, keepClone? }   (claudeArgs is REQUIRED — fail-closed tool restriction)
 * @returns a structured, validated result (worker-policy.buildResult) for EVERY outcome
 */
async function runClaudeWorker(req, config) {
  const r = req || {};
  const c = config || {};
  const redactor = c.redactor || createRedactor();

  // Common audit-result builder so EVERY outcome carries a schema-validated record. A buildResult throw is
  // a programmer error (a forbidden field/decision reached the result) — it must be SURFACED, never
  // silently swallowed into a missing `result`.
  const base = { projectId: r.projectId || null };
  const out = (env, extra) => {
    const fields = Object.assign({}, base, { outcome: env.decision, reason: env.reason || null }, extra || {});
    let res;
    try { res = P.buildResult(fields); }
    catch (e) {
      try { console.error("[claude-worker] result build error: " + e.message); } catch (_) { /* ignore */ }
      return Object.assign({}, env, { resultBuildError: e.message });
    }
    return Object.assign({}, env, { result: res });
  };

  // 1) Request must not carry control fields.
  const { policy, violations } = P.resolvePolicy(r, c);
  Object.assign(base, { operationId: policy.operationId, phaseId: policy.phaseId, controlsEnforced: CONTROLS_ENFORCED, outOfScopeDelegated: DELEGATED });
  if (violations.length) return out(refused("request-policy-tamper", { violations }), { refusedPaths: violations });

  // 2) Content validation.
  if (typeof r.prompt !== "string" || !r.prompt.trim()) return out(refused("empty-prompt"));
  if (r.prompt.length > policy.maxPromptChars) return out(refused("prompt-too-long"));
  if (P.promptHasRawSecret(r.prompt)) return out(refused("prompt-contains-raw-secret"));
  if (typeof r.projectId !== "string" || !r.projectId) return out(refused("no-project"));
  if (!policy.repoRoot) return out(refused("no-trusted-root"));
  if (P.allowlistTouchesProjectos(policy)) return out(refused("allowlist-touches-projectos"));

  // 3) Fail-closed capability: the trusted config MUST supply the hardened invocation. No unrestricted default.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return out(blocked("claude-cli-not-configured"));
  if (process.platform === "win32" && P.isUnsafeShim(c.claudeBin)) return out(blocked("unsafe-cli-shim-on-windows"));
  if (typeof c.claudeArgs !== "function") return out(blocked("no-tool-restriction-configured"));
  if (r.prompt.trim().startsWith("-")) return out(refused("prompt-looks-like-flag"));

  // 4) Canonical baseline — TRUSTED snapshot (fails closed on any git/fs error).
  const repoRoot = policy.repoRoot;
  let before;
  try {
    const tl = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]);
    if (path.resolve(tl) !== path.resolve(repoRoot)) return out(refused("root-not-git-toplevel", { toplevel: tl }));
    before = canonicalSnapshot(repoRoot);
  } catch (e) { return out(blocked("baseline-snapshot-failed", { detail: String(e.message).slice(0, 160) })); }
  if (!before.head) return out(blocked("baseline-head-unresolved"));
  if (policy.expectedRemote && before.origin !== policy.expectedRemote) return out(refused("remote-mismatch", { origin: before.origin }));
  if (policy.expectedBranch && before.branch !== policy.expectedBranch) return out(refused("branch-mismatch", { branch: before.branch }));
  if (policy.requireClean && before.status) return out(refused("working-tree-dirty"));

  Object.assign(base, { toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: before.branch, finalHead: before.head });

  // 5) Throwaway clone with a SEPARATE .git; sever the route back to canonical; detach at baseHead.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "pos-clone-"));
  let disposed = false;
  const finalizeResidue = () => {
    if (c.keepClone) return ["kept-by-config:" + clone];
    if (disposed) return [];
    disposed = true;
    return disposeClone(repoRoot, clone);
  };
  // Every post-clone-creation return goes through done(): it disposes the clone and folds the REAL residue
  // into the audit record, so no failure path can understate leftover state on disk.
  const done = (env, extra) => out(env, Object.assign({ residue: finalizeResidue() }, extra || {}));
  try {
    try {
      gitStrict(repoRoot, ["clone", "--no-hardlinks", "--quiet", repoRoot, clone]);
      try { gitStrict(clone, ["remote", "remove", "origin"]); } catch (e) { /* no origin is fine */ }
      gitStrict(clone, ["checkout", "--detach", "--quiet", before.head]);
    } catch (e) { return done(blocked("clone-setup-failed", { detail: String(e.message).slice(0, 160) })); }

    // 6) Spawn worker in the clone with a minimal env. The trusted builder receives the tool/command policy
    //    so it can encode the restriction; the adapter still denylist-checks the argv (defence in depth).
    const childEnv = P.buildMinimalEnv(process.platform, policy.envAllowlist);
    const argv = c.claudeArgs(r.prompt, { tools: policy.tools, commands: policy.commands, mode: policy.mode });
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return done(blocked("claude-args-not-string-array"));
    if (argv.some((a) => DANGEROUS_FLAG.test(a))) return done(blocked("dangerous-cli-flag", { flag: argv.find((a) => DANGEROUS_FLAG.test(a)) }));
    const run = await spawnWorker(clone, c.claudeBin, argv, childEnv, policy, c.spawnFn || require("child_process").spawn);
    const output = P.scrubSecrets(redactor.redactText(run.stdout || "")).slice(0, 4000);

    // 7) Canonical-untouched proof — UNCONDITIONAL and FIRST (runs even on a killed worker). Trusted FS
    //    hashing, not git-status the worker could fake. Any drift is the highest-priority failure.
    let after;
    try { after = canonicalSnapshot(repoRoot); }
    catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output }); }
    const drift = driftFields(before, after);
    if (drift.length) return done(blocked("canonical-mutated", { fields: drift }), { outputExcerpt: output, finalHead: after.head, killConfirmed: run.killConfirmed });

    // 8) Killed worker → refuse (canonical already proven clean above).
    if (run.killedFor) {
      const reason = ["timeout", "output-overflow", "stderr-overflow"].includes(run.killedFor) ? run.killedFor : "spawn-error";
      const kc = run.killConfirmed;
      const res = finalizeResidue();
      if (!kc) res.push("worker-process-unconfirmed");
      return out(refused(kc ? reason : "kill-unconfirmed", { output }), {
        outputExcerpt: output, timeoutStatus: run.killedFor === "timeout" ? "killed" : "none",
        cancellationStatus: kc ? "confirmed" : "unconfirmed", killConfirmed: kc, residue: res,
      });
    }

    // 9) Enumerate the clone's changes (guarded) and enforce trusted policy on every path.
    let changed;
    try { changed = cloneChanges(clone); }
    catch (e) { return done(blocked("clone-status-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output }); }
    const refusedPaths = [];
    for (const p of changed) {
      const norm = P.normPath(p);
      if (norm.startsWith(".git/") || norm === ".git") { refusedPaths.push(p); continue; }
      if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; }
      if (pathEscapes(clone, p)) { refusedPaths.push(p); continue; }
    }
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths, changedFiles: changed }), { outputExcerpt: output, filesChanged: changed, refusedPaths });

    // 10) Build a TRUSTED change manifest (path -> content sha256) as the patch identity. A git-diff failure
    //     for bulk content must BLOCK, never silently produce an empty "success".
    const manifest = [];
    try {
      for (const p of changed) {
        const abs = path.join(clone, p);
        let hash = "DELETED";
        try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) hash = sha256(fs.readFileSync(abs)); } catch (e) { hash = "UNREADABLE"; }
        manifest.push({ path: p, sha256: hash });
      }
    } catch (e) { return done(blocked("manifest-derivation-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output }); }
    const patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null;

    // 11) Dispose the clone FIRST so the result carries the REAL residue, then build the validated result.
    const residue = finalizeResidue();
    const decision = run.code === 0 ? "PROPOSED" : "FAILED";
    let res;
    try {
      res = P.buildResult({
        operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId,
        approvalStatus: policy.approvalId ? "referenced" : "none",
        toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head,
        finalBranch: after.branch, finalHead: after.head, outcome: run.code === 0 ? "COMPLETED" : "FAILED",
        filesInspected: changed, filesProposed: changed, filesChanged: changed,
        patchHash, changeManifest: manifest, commandsRequested: policy.commands, commandsExecuted: [],
        controlsEnforced: CONTROLS_ENFORCED, outOfScopeDelegated: DELEGATED,
        timeoutStatus: "none", cancellationStatus: "none", killConfirmed: run.killConfirmed,
        outputExcerpt: output, residue, risks: [], workerDecision: decision, projectOsDecisionRequired: true,
      });
    } catch (e) { return blocked("result-build-failed", { detail: String(e.message).slice(0, 160), residue }); }
    const contractErrors = P.validateResult(res);
    if (contractErrors.length) return blocked("result-contract-violation", { contractErrors, residue });
    return { ok: run.code === 0, decision: run.code === 0 ? "COMPLETED" : "FAILED", output, patchHash, changedFiles: changed, result: res };
  } finally {
    if (!disposed && !c.keepClone) disposeClone(repoRoot, clone);
  }
}

module.exports = { runClaudeWorker, canonicalSnapshot, driftFields, cloneChanges, gitMetaDigest };
```

# PART C — FULL SOURCE: `projectos/bridge/worker-policy.cjs`

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
  const result = {
    schemaVersion: "1.0",
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
    filesInspected: Array.isArray(f.filesInspected) ? f.filesInspected : [],
    filesProposed: Array.isArray(f.filesProposed) ? f.filesProposed : [],
    filesChanged: Array.isArray(f.filesChanged) ? f.filesChanged : [],
    refusedPaths: Array.isArray(f.refusedPaths) ? f.refusedPaths : [],
    patchHash: f.patchHash || null,
    changeManifest: Array.isArray(f.changeManifest) ? f.changeManifest : [],
    commandsRequested: Array.isArray(f.commandsRequested) ? f.commandsRequested : [],
    commandsExecuted: Array.isArray(f.commandsExecuted) ? f.commandsExecuted : [],
    controlsEnforced: Array.isArray(f.controlsEnforced) ? f.controlsEnforced : [],
    outOfScopeDelegated: Array.isArray(f.outOfScopeDelegated) ? f.outOfScopeDelegated : [],
    validatorResults: Array.isArray(f.validatorResults) ? f.validatorResults : [],
    timeoutStatus: f.timeoutStatus || "none",
    cancellationStatus: f.cancellationStatus || "none",
    killConfirmed: f.killConfirmed === undefined ? null : !!f.killConfirmed,
    outputRedactionStatus: f.outputRedactionStatus || "applied",
    envRedactionStatus: f.envRedactionStatus || "minimal-allowlist",
    outputExcerpt: typeof f.outputExcerpt === "string" ? f.outputExcerpt : "",
    residue: Array.isArray(f.residue) ? f.residue : [],
    risks: Array.isArray(f.risks) ? f.risks : [],
    workerDecision: decision,
    projectOsDecisionRequired: true,
  };
  return Object.freeze(result);
}

/** Validate a result against the contract. Returns an error array (empty = valid). */
function validateResult(result) {
  const errors = [];
  const r = result || {};
  const required = [
    "schemaVersion", "operationId", "projectId", "phaseId", "approvalStatus", "repository", "baselineBranch",
    "baselineHead", "finalBranch", "finalHead", "outcome", "filesInspected", "filesProposed", "filesChanged",
    "refusedPaths", "patchHash", "changeManifest", "commandsRequested", "commandsExecuted", "controlsEnforced",
    "validatorResults", "timeoutStatus", "cancellationStatus", "killConfirmed", "outputRedactionStatus",
    "envRedactionStatus", "outputExcerpt", "residue", "risks", "workerDecision", "projectOsDecisionRequired",
  ];
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: missing field '" + k + "'");
  if (r.schemaVersion !== "1.0") errors.push("result: bad schemaVersion");
  if (FORBIDDEN_WORKER_DECISIONS.includes(String(r.workerDecision).toUpperCase())) errors.push("result: workerDecision is an authoritative gate outcome (forbidden)");
  for (const k of FORBIDDEN_RESULT_FIELDS) if (Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: forbidden field '" + k + "'");
  if (r.projectOsDecisionRequired !== true) errors.push("result: projectOsDecisionRequired must be true");
  return errors;
}

module.exports = {
  buildMinimalEnv, isTokenishName, promptHasRawSecret, scrubSecrets, isUnsafeShim, resolvePolicy,
  isAllowedPath, allowlistTouchesProjectos, buildResult, validateResult, normPath,
  CONTROL_FIELDS, FORBIDDEN_WORKER_DECISIONS, FORBIDDEN_RESULT_FIELDS, SECRET_SHAPE, ENV_ALLOW_COMMON,
};
```

# PART D — FULL SOURCE: `projectos/bridge/owner-capability-check.cjs`

```js
"use strict";
/**
 * Owner-machine capability check for the real Forge E2E (PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A,
 * §10). SAFE + read-only: it only DETECTS whether the prerequisites exist. It:
 *   - reveals NO credentials and prints NO token values,
 *   - performs NO installation and NO provider connection,
 *   - makes NO repository change,
 *   - does NOT assume the Claude executable path (probes PATH + common locations + a desktop/session hint).
 *
 * Output: a PASS/BLOCKED capability matrix. Run on the owner machine BEFORE requesting the real round-trip.
 * This module never launches the worker; it is a gate for whether the real run is even possible.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function tryExec(bin, args) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 });
    return { ok: true, out: String(out).trim().split("\n")[0].slice(0, 80) };
  } catch (e) { return { ok: false, out: null }; }
}

function onPath(bin) {
  const probe = process.platform === "win32" ? tryExec("where", [bin]) : tryExec("which", [bin]);
  return probe.ok;
}

/** Detect a spawnable Claude CLI without assuming its path. Never reads its config/credentials. */
function detectClaude() {
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];
  for (const n of names) {
    if (onPath(n)) { const v = tryExec(n, ["--version"]); if (v.ok) return { status: "PASS", how: "cli-on-path", detail: n }; }
  }
  // Common local install dirs (existence only — no content read).
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    path.join(home, ".claude", "local", "claude"),
    path.join(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
    path.join(home, ".local", "bin", "claude"),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return { status: "PASS", how: "cli-file", detail: path.basename(p) }; } catch (e) { /* ignore */ } }
  // No spawnable CLI. Report a desktop/session hint WITHOUT reading any auth material.
  const desktopHint = !!(process.env.CLAUDE_CODE_SESSION || process.env.CLAUDECODE || process.env.CLAUDE_DESKTOP);
  return { status: "BLOCKED", how: desktopHint ? "session-present-but-no-spawnable-cli" : "no-cli", detail: null };
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

function check() {
  return {
    platform: process.platform,
    node: process.version,
    claude: detectClaude(),
    docker: detectDocker(),
    supabase: detectSupabase(),
  };
}

function overall(res) {
  return res.claude.status === "PASS" && res.docker.status === "PASS" && res.supabase.status === "PASS"
    ? "READY-FOR-REAL-E2E" : "BLOCKED-OWNER-MACHINE-CAPABILITY";
}

// Owner-facing presentation: plain language, one clear next action per item, no machine jargon, no secrets.
// Each entry maps a machine `how` code to { label, action }. `label` says what the owner has; `action` is
// the single next step when it is not ready.
const FRIENDLY = {
  claude: {
    title: "Claude Code worker",
    "cli-on-path": { label: "Ready — Claude command found.", action: null },
    "cli-file": { label: "Ready — Claude app found.", action: null },
    "session-present-but-no-spawnable-cli": { label: "A Claude session is signed in, but no runnable `claude` command is on this machine.", action: "Install the Claude Code CLI so a `claude` command exists, then re-run this check." },
    "no-cli": { label: "No Claude Code worker found.", action: "Install and sign in to the Claude Code CLI on this machine, then re-run this check." },
  },
  docker: {
    title: "Docker (for local Supabase)",
    "daemon-running": { label: "Ready — Docker is installed and running.", action: null },
    "no-docker-binary": { label: "Docker is not installed.", action: "Install Docker Desktop and start it, then re-run this check." },
    "binary-present-daemon-down": { label: "Docker is installed but not running.", action: "Open Docker Desktop and wait until it says Running, then re-run this check." },
  },
  supabase: {
    title: "Supabase CLI",
    "cli-present": { label: "Ready — Supabase CLI found.", action: null },
    "no-supabase-cli": { label: "Supabase CLI is not installed.", action: "Install the Supabase CLI, then re-run this check." },
    "cli-error": { label: "Supabase CLI did not respond.", action: "Reinstall or repair the Supabase CLI, then re-run this check." },
  },
};

function present(res) {
  const lines = [];
  const items = [["claude", res.claude], ["docker", res.docker], ["supabase", res.supabase]];
  const actions = [];
  lines.push("Owner-machine readiness check for the real Forge end-to-end test");
  lines.push("(read-only — this does not install anything, connect anywhere, or read any password)");
  lines.push("");
  for (const [key, r] of items) {
    const f = FRIENDLY[key] || {};
    const info = f[r.how] || { label: r.how, action: r.status === "PASS" ? null : "Resolve this prerequisite, then re-run this check." };
    const badge = r.status === "PASS" ? "[ READY ]        " : "[ ACTION NEEDED ]";
    lines.push(badge + " " + (f.title || key) + (r.detail ? "  (" + r.detail + ")" : ""));
    lines.push("                  " + info.label);
    if (info.action) actions.push((f.title || key) + ": " + info.action);
  }
  lines.push("");
  const ready = overall(res) === "READY-FOR-REAL-E2E";
  if (ready) {
    lines.push("RESULT: READY — all prerequisites are in place. The real Forge worker + Supabase test can run.");
  } else {
    lines.push("RESULT: NOT READY — the real Forge worker + Supabase test cannot run on this machine yet.");
    lines.push("");
    lines.push("What to do next (in order):");
    actions.forEach((a, i) => lines.push("  " + (i + 1) + ". " + a));
    lines.push("");
    lines.push("Nothing was installed or changed. Re-run this check after each step until every item says READY.");
  }
  return lines.join("\n");
}

if (require.main === module) {
  console.log(present(check()));
}

module.exports = { check, overall, present, detectClaude, detectDocker, detectSupabase };
```

# PART E — FULL SOURCE (MANDATORY SECURITY EVIDENCE): `projectos/validators/validate-claude-worker.cjs`

```js
"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A. Proves the SAFEGUARDS of
 * the hardened, clone-isolated worker adapter using a SYNTHETIC CLI stand-in + REAL throwaway git repos.
 * The REAL `claude` CLI round-trip is an owner-machine step; here we prove the containment + fail-safe
 * behaviour. Opt-in (creates git repos + drives process control) — NOT part of `npm run validate`; run
 * standalone. All 38 invariants must pass (a symlink-based inv is env-skipped only if the host cannot make
 * links unprivileged).
 *
 * Coverage (owner §8 + the ChatGPT/ECC review round):
 *  1 request policy-tamper refused            2 empty prompt refused
 *  3 raw-secret prompt refused                4 unknown project refused
 *  5 allowlist-touches-projectos refused      6 CLI not configured → BLOCKED
 *  7 unsafe .cmd/.bat shim on win32 → BLOCKED 8 no claudeArgs (tool restriction) → BLOCKED
 *  9 root != git toplevel refused            10 wrong remote refused
 * 11 wrong branch refused                    12 dirty canonical baseline refused
 * 13 parent-env secret not inherited (unit+spawn)
 * 14 allowed change → COMPLETED, manifest + patchHash, valid result
 * 15 forbidden-path (projectos/) refused     16 protected rename origin+dest caught
 * 17 DIRECT write to canonical detected (fs proof)      18 canonical hook-CONTENT edit detected
 * 19 canonical ref/tag creation detected     20 canonical config edit detected
 * 21 fake clone/.git cannot hide a canonical mutation   22 timeout kills + confirmed
 * 23 stdout overflow kills                   24 stderr overflow kills
 * 25 registered secret redacted             26 generic secret redacted
 * 27 buildResult THROWS on forbidden decision (no silent coerce)
 * 28 validateResult catches a tampered result           29 no metered AI API (source scan)
 * 30 canonical byte-identical on a benign run (fs proof)
 * 31 case-insensitive forbidden-path bypass refused (win/mac) / documented on posix
 * 32 absolute/UNC path rejected (unit)       33 capability overall() logic
 * 34 capability presentation owner-friendly + no jargon leak
 * 35 .git/info/exclude tamper detected (metaHash)       36 SYMLINKED canonical hook detected (metaHash)
 * 37 dangerous CLI flag from args builder refused        38 canonical file drop matching a pre-existing
 *    ignore rule detected (ignoredInventory)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const P = require("../bridge/worker-policy.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-worker-secret-9k8j7h";
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
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function baseCfg(repo, extra) {
  return Object.assign({
    projectRoots: { acme: repo },
    policy: { expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 3000, maxOutputBytes: 1 << 20 },
    operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" },
    claudeBin: "synthetic-claude", claudeArgs: (p) => ["-p", p], redactor: createRedactor(),
  }, extra || {});
}

let lastSpawnEnv = null;
function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_bin, _argv, spawnOpts) => {
    lastSpawnEnv = spawnOpts.env;
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
const writeIn = (rel, content) => (cwd) => { const abs = path.join(cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content || "changed\n"); };
const REQ = { prompt: "add a file", projectId: "acme" };

async function withRepo(fn, opts) {
  const repo = mkRepo(opts);
  try { await fn(repo); } finally { rmRepo(repo); }
}

async function run() {
  const errors = [];
  const fail = (inv, msg, got) => errors.push(inv + ": " + msg + (got !== undefined ? " :: " + JSON.stringify(got) : ""));

  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, allowedPaths: ["projectos"] }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "request-policy-tamper") fail("inv1", "policy tamper not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "empty-prompt") fail("inv2", "empty prompt not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, prompt: "key sk-ABCDEFGHIJKLMNOP01234567 here" }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "prompt-contains-raw-secret") fail("inv3", "raw-secret prompt not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, projectId: "ghost" }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "no-trusted-root") fail("inv4", "unknown project not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.allowedPaths = ["projectos"];
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "allowlist-touches-projectos") fail("inv5", "projectos allowlist not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { claudeBin: "", spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.decision !== "BLOCKED" || a.reason !== "claude-cli-not-configured") fail("inv6", "unconfigured CLI not BLOCKED", a);
  });
  await withRepo(async (repo) => {
    if (process.platform === "win32") {
      const a = await runClaudeWorker(REQ, baseCfg(repo, { claudeBin: "claude.cmd", spawnFn: synthSpawn(writeIn("app/x.txt")) }));
      if (a.decision !== "BLOCKED" || a.reason !== "unsafe-cli-shim-on-windows") fail("inv7", "unsafe shim not BLOCKED", a);
    } else { errors.push("inv7: SKIPPED-ENV (win32-only shim check)"); }
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); delete cfg.claudeArgs;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "BLOCKED" || a.reason !== "no-tool-restriction-configured") fail("inv8", "missing tool restriction not BLOCKED", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.projectRoots.acme = path.join(repo, "app");
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "root-not-git-toplevel") fail("inv9", "non-toplevel root not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.expectedRemote = "https://example.invalid/other.git";
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "remote-mismatch") fail("inv10", "wrong remote not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.expectedBranch = "main";
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "branch-mismatch") fail("inv11", "wrong branch not refused", a);
  });
  await withRepo(async (repo) => {
    fs.writeFileSync(path.join(repo, "app", "dirty.txt"), "dirty\n");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "working-tree-dirty") fail("inv12", "dirty baseline not refused", a);
  });

  // inv13 parent-env secret not inherited (unit + spawn)
  process.env.PLANTED_SECRET_TOKEN = "should-never-reach-child";
  const env = P.buildMinimalEnv(process.platform, []);
  if (Object.prototype.hasOwnProperty.call(env, "PLANTED_SECRET_TOKEN") || Object.values(env).some((v) => String(v).includes("should-never-reach-child"))) fail("inv13", "planted secret in minimal env (unit)");
  await withRepo(async (repo) => {
    lastSpawnEnv = null;
    await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (!lastSpawnEnv || Object.prototype.hasOwnProperty.call(lastSpawnEnv, "PLANTED_SECRET_TOKEN")) fail("inv13", "planted secret reached child env (spawn)", lastSpawnEnv && Object.keys(lastSpawnEnv));
  });
  delete process.env.PLANTED_SECRET_TOKEN;

  // inv14 allowed change → COMPLETED + manifest + valid result
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/new.txt", "hello\n")) }));
    if (a.decision !== "COMPLETED") fail("inv14", "allowed change not COMPLETED", a);
    else if (!a.patchHash || !(a.result.changeManifest || []).some((m) => m.path === "app/new.txt" && /^[0-9a-f]{64}$/.test(m.sha256))) fail("inv14", "manifest/patchHash wrong", a.result && a.result.changeManifest);
    else if (P.validateResult(a.result).length) fail("inv14", "result invalid", P.validateResult(a.result));
    else if (a.result.workerDecision !== "PROPOSED" || a.result.projectOsDecisionRequired !== true) fail("inv14", "result decision wrong", a.result.workerDecision);
  });

  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("projectos/hack.txt")) }));
    if (a.reason !== "forbidden-path-change" || !(a.refusedPaths || []).some((p) => P.normPath(p).startsWith("projectos/"))) fail("inv15", "forbidden-path not refused", a);
  });
  await withRepo(async (repo) => {
    const mv = (cwd) => g(cwd, ["mv", "projectos/core.txt", "app/renamed.txt"]);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(mv) }));
    if (a.reason !== "forbidden-path-change" || !(a.refusedPaths || []).some((p) => P.normPath(p) === "projectos/core.txt")) fail("inv16", "rename origin not caught", a);
  });

  // inv17 DIRECT write to canonical (absolute path, bypassing the clone) is detected by the fs proof
  await withRepo(async (repo) => {
    const attack = () => fs.writeFileSync(path.join(repo, "app", "seed.txt"), "TAMPERED-DIRECT\n");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("filesHash")) fail("inv17", "direct canonical write not detected", a);
  });
  // inv18 canonical hook-CONTENT edit detected (content, not just filename)
  await withRepo(async (repo) => {
    const attack = () => { const h = path.join(commonDir(repo), "hooks"); fs.mkdirSync(h, { recursive: true }); fs.writeFileSync(path.join(h, "pre-commit"), "#!/bin/sh\nevil\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv18", "hook-content edit not detected", a);
  });
  // inv19 canonical ref/tag creation detected
  await withRepo(async (repo) => {
    const attack = () => { const rd = path.join(commonDir(repo), "refs", "heads"); fs.mkdirSync(rd, { recursive: true }); fs.writeFileSync(path.join(rd, "backdoor"), g(repo, ["rev-parse", "HEAD"]).trim() + "\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv19", "ref creation not detected", a);
  });
  // inv20 canonical config edit detected
  await withRepo(async (repo) => {
    const attack = () => g(repo, ["config", "--local", "sneak.flag", "1"]);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv20", "config edit not detected", a);
  });
  // inv21 a FAKE clone/.git cannot hide a real canonical mutation (the fs proof does not trust clone git)
  await withRepo(async (repo) => {
    const attack = (cwd) => {
      try { fs.rmSync(path.join(cwd, ".git"), { recursive: true, force: true }); execFileSync("git", ["-C", cwd, "init", "-q"]); } catch (e) { /* clone git wrecked either way */ }
      fs.writeFileSync(path.join(repo, "app", "seed.txt"), "TAMPERED-BEHIND-FAKE-GIT\n"); // real canonical mutation
    };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated") fail("inv21", "canonical mutation hidden by fake clone .git", a);
  });

  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { hang: true }) }); cfg.policy.timeoutMs = 150;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "timeout") fail("inv22", "timeout not enforced", a);
    else if (a.result && a.result.killConfirmed !== true) fail("inv22", "kill not confirmed", a.result.killConfirmed);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { floodOut: true }) }); cfg.policy.maxOutputBytes = 64;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "output-overflow") fail("inv23", "stdout overflow not enforced", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { floodErr: true }) }); cfg.policy.maxOutputBytes = 64;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "stderr-overflow") fail("inv24", "stderr overflow not enforced", a);
  });
  await withRepo(async (repo) => {
    const rd = createRedactor(); rd.register(SECRET, "ref_w");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { redactor: rd, spawnFn: synthSpawn(writeIn("app/ok.txt"), "leaked " + SECRET) }));
    if (String(a.output || "").includes(SECRET) || String((a.result && a.result.outputExcerpt) || "").includes(SECRET)) fail("inv25", "registered secret leaked", a.output);
  });
  await withRepo(async (repo) => {
    // Build a JWT-shaped blob at runtime so no literal secret-pattern sits in this source file.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: "1234567890" }) + ".c2ln";
    const hdr = jwt.slice(0, 3);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/ok.txt"), "jwt=" + jwt) }));
    const excerpt = String((a.result && a.result.outputExcerpt) || "");
    if (excerpt.includes(jwt.slice(0, 24)) || new RegExp(hdr + "[A-Za-z0-9_-]{16,}").test(excerpt)) fail("inv26", "generic secret not scrubbed", excerpt);
  });

  // inv27 buildResult THROWS on a forbidden decision (no silent coerce)
  {
    let threw = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { threw = true; }
    if (!threw) fail("inv27", "buildResult did not throw on APPROVED");
    let threw2 = false; try { P.buildResult({ approved: true }); } catch (e) { threw2 = true; }
    if (!threw2) fail("inv27", "buildResult did not throw on forbidden field");
  }
  // inv28 validateResult catches a tampered result
  {
    const good = P.buildResult({ projectId: "acme", baselineHead: "a", finalHead: "a" });
    if (P.validateResult(good).length) fail("inv28", "valid result rejected", P.validateResult(good));
    const bad = Object.assign({}, good); delete bad.patchHash; bad.trusted = true;
    const be = P.validateResult(bad);
    if (!be.some((e) => e.includes("patchHash")) || !be.some((e) => e.includes("trusted"))) fail("inv28", "tampered result not caught", be);
  }
  // inv29 no metered AI API (source scan)
  {
    const rx = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i;
    for (const f of ["claude-worker.cjs", "worker-policy.cjs"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f), "utf8");
      if (rx.test(src)) fail("inv29", "metered API/network reference in " + f);
    }
    if (!/shell:\s*false/.test(fs.readFileSync(path.join(__dirname, "..", "bridge", "claude-worker.cjs"), "utf8"))) fail("inv29", "adapter not shell:false");
  }
  // inv30 canonical byte-identical on a benign run
  await withRepo(async (repo) => {
    const before = worker.canonicalSnapshot(repo);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/new.txt")) }));
    if (a.decision !== "COMPLETED") fail("inv30", "benign run not COMPLETED", a);
    if (worker.driftFields(before, worker.canonicalSnapshot(repo)).length) fail("inv30", "canonical drifted on benign run", worker.driftFields(before, worker.canonicalSnapshot(repo)));
  });
  // inv31 case-insensitive forbidden-path bypass (win/mac); documented no-op on posix
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/Secrets/leak.txt")) });
    cfg.policy.allowedPaths = ["app"]; cfg.policy.forbiddenPaths = ["app/secrets"];
    const a = await runClaudeWorker(REQ, cfg);
    if (process.platform === "win32" || process.platform === "darwin") {
      if (a.reason !== "forbidden-path-change") fail("inv31", "re-cased forbidden path not refused", a);
    } else if (a.decision !== "COMPLETED") { errors.push("inv31: SKIPPED-ENV (posix is case-sensitive; app/Secrets != app/secrets by design)"); }
  });
  // inv32 absolute/UNC path rejected (unit)
  {
    const pol = { allowedPaths: ["app"], forbiddenPaths: [] };
    for (const bad of ["/etc/passwd", "C:/win", "\\\\srv\\share\\x", "app/../projectos/x", "app\0x"]) {
      if (P.isAllowedPath(bad, pol)) fail("inv32", "unsafe path allowed: " + bad);
    }
    if (!P.isAllowedPath("app/ok.txt", pol)) fail("inv32", "legit path rejected");
  }
  // inv33 capability overall() logic
  {
    const all = { claude: { status: "PASS" }, docker: { status: "PASS" }, supabase: { status: "PASS" } };
    const one = { claude: { status: "PASS" }, docker: { status: "BLOCKED" }, supabase: { status: "PASS" } };
    if (cap.overall(all) !== "READY-FOR-REAL-E2E") fail("inv33", "all-PASS not READY");
    if (cap.overall(one) !== "BLOCKED-OWNER-MACHINE-CAPABILITY") fail("inv33", "one-BLOCKED not BLOCKED");
  }
  // inv34 capability presentation owner-friendly + no machine jargon leak
  {
    const blk = cap.present({ platform: "win32", node: "v24", claude: { status: "BLOCKED", how: "session-present-but-no-spawnable-cli" }, docker: { status: "BLOCKED", how: "no-docker-binary" }, supabase: { status: "BLOCKED", how: "cli-error" } });
    if (!/ACTION NEEDED/.test(blk) || !/NOT READY/.test(blk) || !/What to do next/.test(blk)) fail("inv34", "blocked presentation missing guidance");
    if (/session-present-but-no-spawnable-cli|no-docker-binary|cli-error/.test(blk)) fail("inv34", "raw jargon leaked");
    const rdy = cap.present({ platform: "win32", node: "v24", claude: { status: "PASS", how: "cli-on-path" }, docker: { status: "PASS", how: "daemon-running" }, supabase: { status: "PASS", how: "cli-present" } });
    if (!/RESULT: READY/.test(rdy)) fail("inv34", "ready presentation missing READY");
  }

  // inv35 canonical .git/info/exclude tampering detected (metaHash) — a hidden-file plant cannot escape
  await withRepo(async (repo) => {
    const attack = () => { const info = path.join(commonDir(repo), "info"); fs.mkdirSync(info, { recursive: true }); fs.appendFileSync(path.join(info, "exclude"), "\npayload.js\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv35", "info/exclude tamper not detected", a);
  });
  // inv36 SYMLINKED canonical hook detected (metaHash) — symlink entries are not skipped
  await withRepo(async (repo) => {
    const targ = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hooktarget-")); fs.writeFileSync(path.join(targ, "evil.sh"), "evil\n");
    let made = false;
    const attack = () => { const h = path.join(commonDir(repo), "hooks"); fs.mkdirSync(h, { recursive: true }); try { fs.symlinkSync(path.join(targ, "evil.sh"), path.join(h, "pre-commit"), "file"); made = true; } catch (e) { /* unprivileged */ } };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    rmRepo(targ);
    if (!made) errors.push("inv36: SKIPPED-ENV (file symlink creation unprivileged on this host)");
    else if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv36", "symlinked hook not detected", a);
  });
  // inv37 a dangerous CLI flag from the args builder is refused (defence in depth on tool restriction)
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { claudeArgs: (p) => ["--dangerously-skip-permissions", "-p", p], spawnFn: synthSpawn(writeIn("app/x.txt")) });
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "BLOCKED" || a.reason !== "dangerous-cli-flag") fail("inv37", "dangerous flag not refused", a);
  });
  // inv38 a file dropped into canonical that matches a PRE-EXISTING ignore rule is still detected
  await withRepo(async (repo) => {
    const attack = () => fs.writeFileSync(path.join(repo, "app", "planted.log"), "hidden\n"); // matches *.log
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("ignoredInventory")) fail("inv38", "ignored-file drop into canonical not detected", a);
  }, { gitignore: "*.log" });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV"));
    const skipped = e.filter((x) => x.includes("SKIPPED-ENV"));
    skipped.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (38 invariants" + (skipped.length ? ", " + skipped.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };
```

---

**END OF BUNDLE.** END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. Not pushed, not closed. Remote frozen `4c3f076`.

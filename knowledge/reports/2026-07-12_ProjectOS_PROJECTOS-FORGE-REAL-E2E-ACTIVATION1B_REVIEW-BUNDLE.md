# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B — SINGLE-FILE REVIEW BUNDLE

> Everything Murad + ChatGPT need to review 1B, in one file: the evidence report, the full worker-adapter
> source, and the full validator source. Nothing else needs opening. Local-only. Remote frozen at `4c3f076`.

**Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B` · **Commit:** `b3d8421` (30 ahead of `4c3f076`, NOT pushed)
**END STATUS: BLOCKED — REQUIRED OWNER-MACHINE CAPABILITY UNAVAILABLE (`claude` CLI + Docker absent).**
**Not pushed. Not closed. No production / provider / send / payment / secret / metered-AI API.**

---

# PART A — EVIDENCE REPORT

## A1. Executive result

This session runs in the same non-interactive sandbox as 1A — **not** the intended owner machine. The two
hard prerequisites for 1B are absent: the **`claude` CLI** and **Docker**. So the core of 1B — a real local
Claude Code worker round-trip (Gate 1), Docker-backed local Supabase (Gate 2), and the one-command reference
app produced *through the real worker* (Gate 3) — **cannot be proven here and was not faked.** What **was**
achievable and delivered: the **governed Claude-CLI worker adapter** (the connector that will invoke the real
CLI on your machine) with its safeguards proven against a synthetic CLI stand-in. Honest partial Gate-1
*architecture*, not a real-worker proof.

## A2. Starting repository state (verified)

origin `universalbizcomply/ProjectOS`; branch `projectos-v3`; remote `origin/projectos-v3` = **`4c3f076`**
(frozen); 30 ahead / 0 behind after this commit; working tree clean; `git diff --check` clean; recovery
branch `forge-baseline-2026-07-12` present; corrective commit `44c6dfa` present; no amended/rewritten history
(the 1B commit itself was amended once, pre-any-push, only to strip a stray `@ ` subject prefix).

## A3. Previous phase (1A) acceptance

1A PARTIAL ACCEPTED (per owner): real scaffold/materialise/install (+ dependency-pin defect → `44c6dfa`)/
build/Postgres/API round-trip/browser round-trip/teardown; plain Postgres is a valid partial runtime proof,
**not** a substitute for the Supabase proof. That distinction is preserved here.

## A4. Environment capability matrix

| node | npm | git | npm-net | local Postgres | **Docker** | **claude CLI** | supabase CLI | playwright | tauri |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24.14.1 | 11.11 | 2.55 | ✓ | 18.4 ✓ | **✗ (not installed)** | **✗ (not on PATH / npm-global / install dirs)** | 2.103 (Docker-backed) | ✗ | ✗ |

OS Windows 11 (26200), MSYS. No tokens/credentials printed. Per the phase rule, missing Docker/CLI are
recorded as **OWNER-MACHINE TOOLING BLOCKED**; no system software was installed.

## A5. Claude CLI / Docker / Supabase discovery

- **Claude CLI:** not on PATH, not an npm global, not in the checked install locations. This process runs
  *inside* a Claude Code session, but no spawnable `claude` executable is exposed to the shell. Real worker
  invocation is **BLOCKED**. No credential extraction was attempted.
- **Docker:** not installed; daemon absent. **Supabase local (`supabase start`) BLOCKED.** Supabase CLI is
  present but Docker-backed.

## A6. Files changed (this phase, in the repo)

- NEW `projectos/bridge/claude-worker.cjs` — governed Claude-CLI worker adapter (**full source: Part B**).
- NEW `projectos/validators/validate-claude-worker.cjs` — 13 safeguard invariants (**full source: Part C**).
- NEW `knowledge/reports/PROJECTOS-FORGE-REAL-E2E-CHECKPOINT.md`, `..._ACTIVATION1B_AWAITING-REVIEW.md`, this
  bundle, and the index row.
(The 1A scratch app + node_modules live in a gitignored temp workspace — the repo is not polluted.)

## A7. Worker-adapter architecture + bindings (delivered)

Model: **ProjectOS → governed adapter → owner-authenticated `claude` CLI (print mode) → verified repo →
validated response/evidence.** No API key, no metered client, no credential handling.
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

## A8. Worker proofs (controlled-change / interruption-resume / timeout-cancel)

**BLOCKED for the REAL CLI** (no `claude` on this machine). The adapter's **safeguards are proven** against a
synthetic CLI stand-in + a real throwaway git repo (`validate-claude-worker.cjs`, 13 invariants, PASS):
empty-prompt / unknown-project / branch-mismatch / dirty-tree refused; unconfigured CLI → BLOCKED;
allowed-path change → COMPLETED with the change reported; forbidden-path (and `projectos/`) change refused;
**staged rename of protected source caught on its origin**; timeout kills+refuses; output-overflow
kills+refuses; registered + generic secret scrub; no metered API / `shell:false` (source-scanned). The real
controlled-change + interruption/resume + timeout proofs against the actual CLI are owner-machine steps.

## A9. Supabase / auth / RLS / reference app / browser journey / responsive / screenshots

**ALL BLOCKED** — depend on Docker (Supabase) and the real worker (reference-app generation). Not built
manually, to avoid falsely claiming Forge/worker generation. (1A's local-Postgres round-trip stands as the
prior partial runtime proof, explicitly not relabelled as Supabase.)

## A10. Defects found / fixes

- **Security HIGH (adapter):** a staged rename reported only the destination → a worker could move/delete
  ProjectOS source undetected. **Fixed:** two-sided `--porcelain -z` validation (checks the rename origin);
  invariant 12. **MEDIUM:** quoted-path porcelain brittleness → resolved by `-z` (unquoted). **MEDIUM:**
  arg-injection → a `-`-leading prompt is refused + argv-array spawn. **LOW:** generic secret scrub of output
  (invariant 13); bounded stderr drain; POSIX process-group kill.
- (Carried from 1A: the exact-`.0` version-pin defect → F2 caret ranges, `44c6dfa`.)

## A11. Validation / reviews

- `npm run validate` → **ALL PASS (61 validators)**; `git diff --check` clean. The worker-adapter validator
  is **opt-in** — it drives process control + a real temp git repo (like the existing desktop smoke harness)
  and is intentionally NOT in `validate-all`; run standalone: **PASS, 13 invariants**.
- **Security review (agent):** core containment confirmed (no shell/argv injection; prototype-pollution-safe
  repo binding; timeout+output caps; no metered API). One HIGH (rename-origin bypass) + MEDIUM/LOW — all
  fixed. No open HIGH/CRITICAL.
- **Code / ECC (self):** the adapter extends the existing bridge family (no parallel execution system); it is
  a plan-only connector until an owner machine wires the real CLI. Owner authority preserved; Claude does not
  self-approve/close; PLAN READY not granted; Postgres-vs-Supabase distinction kept honest; every blocker
  classified.

## A12. No-X proofs / next

No secret disclosure · No provider · No production · No send · No payment · **No metered AI API** (adapter
source-scanned) · Working tree clean · Remote unchanged `4c3f076` · **Pushed: NO** · System software installed:
NO (Docker/CLI absence recorded, not installed).

**Exact next decision required:** re-run 1B **on an owner machine with Docker Desktop running + the `claude`
CLI available** — Gate 1 (wire `claudeBin` to the real CLI + real controlled-change + interruption proofs),
Gate 2 (real Supabase + auth + RLS + two-user isolation), Gate 3 (reference-app command → blueprint →
synthetic-labelled owner approval → real generation via the worker → real browser→Supabase round-trip). Then
Gates 4–12.

---

# PART B — FULL SOURCE: `projectos/bridge/claude-worker.cjs`

```js
"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION (Gate 1 architecture).
 *
 * Invokes the owner's LOCALLY-AUTHENTICATED Claude Code CLI in non-interactive ("print") mode to perform a
 * bounded, allowlisted change inside a VERIFIED repository — with NO Anthropic/OpenAI API key, NO metered
 * API, NO credential copying, and NO raw broad-autonomy shell. It relies entirely on the CLI's own
 * existing session; this adapter never touches auth material.
 *
 * Hard safeguards, all BEFORE and AROUND the spawn:
 *  - repoRoot is resolved/verified INSIDE a trusted allowedRoot (never taken from the prompt/document);
 *  - the working branch must equal the expected branch;
 *  - a clean-tree policy is enforced when required;
 *  - the CLI binary path comes from TRUSTED config, never from the task/document;
 *  - the process is spawned with an argv array (no shell) → no shell injection;
 *  - a hard timeout kills the process (tree-kill on Windows);
 *  - stdout is capped (kills on overflow) so a runaway worker can't flood;
 *  - the response is redacted (secrets scrubbed) and validated;
 *  - after the run, the ACTUAL changed files are derived from git and checked against an allowlist —
 *    a change outside the allowed paths, or to ProjectOS's own source, is a failure.
 *  Claude cannot approve/close a phase; this adapter only executes a bounded task and returns evidence.
 *
 * NOTE: the REAL invocation requires the `claude` CLI on the machine. Where it is absent (e.g. this
 * sandbox) the adapter's guards are proven against a synthetic CLI stand-in; the real round-trip is an
 * owner-machine step. `spawnFn` is injectable for exactly this.
 */

const { execFileSync } = require("child_process");
const path = require("path");
const { createRedactor } = require("../security/redaction.cjs");

const DEFAULTS = Object.freeze({ timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024, maxPromptChars: 8000 });
// Defence-in-depth: mask obvious secret shapes in worker output even if they were never registered for
// redaction (the CLI may echo secrets it read from files we don't know about).
const GENERIC_SECRET = /(-----BEGIN[\s\S]{0,64}?PRIVATE KEY-----|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{12,})/g;

function resolveInside(target, allowedRoot) {
  const root = path.resolve(allowedRoot);
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootSep)) return null;
  return resolved;
}

function gitIn(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

/**
 * Every path touched in the working tree — BOTH sides of a rename/copy — from NUL-delimited porcelain
 * (`-z` is unquoted, so no C-quoting can hide a path). A staged rename that moves a protected file out of
 * the allowlist must be caught on its ORIGIN, not only its destination.
 */
function changedFiles(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "-z"], { encoding: "utf8" });
  const tok = out.split("\0").filter((t) => t.length > 0);
  const paths = [];
  for (let i = 0; i < tok.length; i++) {
    const rec = tok[i];
    const xy = rec.slice(0, 2);
    paths.push(rec.slice(3)); // the record's path (dest for a rename)
    if (/[RC]/.test(xy) && i + 1 < tok.length) { paths.push(tok[i + 1]); i++; } // origin of a rename/copy
  }
  return paths;
}

function isAllowedPath(p, allowedPaths) {
  if (p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return allowedPaths.some((a) => p === a || p.startsWith(a.endsWith("/") ? a : a + "/"));
}

/**
 * Run one bounded worker task.
 * @param req    { prompt, projectId, expectedBranch, allowedPaths[], requireClean? }
 * @param config TRUSTED: { projectRoots:{[id]:absRoot}, claudeBin, claudeArgs?(prompt)->[], spawnFn?,
 *               timeoutMs?, maxOutputBytes?, maxPromptChars?, redactor? }
 * @returns { ok, decision, reason?, changedFiles?, refusedPaths?, output?, exitCode? }
 */
function runClaudeWorker(req, config) {
  const r = req || {};
  const c = config || {};
  const redactor = c.redactor || createRedactor();
  const timeoutMs = c.timeoutMs || DEFAULTS.timeoutMs;
  const maxOutputBytes = c.maxOutputBytes || DEFAULTS.maxOutputBytes;
  const maxPromptChars = c.maxPromptChars || DEFAULTS.maxPromptChars;

  if (typeof r.prompt !== "string" || !r.prompt.trim()) return { ok: false, decision: "REFUSED", reason: "empty-prompt" };
  if (r.prompt.length > maxPromptChars) return { ok: false, decision: "REFUSED", reason: "prompt-too-long" };
  if (typeof r.projectId !== "string" || !r.projectId) return { ok: false, decision: "REFUSED", reason: "no-project" };

  // Repo root ONLY from the trusted registry, never from the request/document.
  const roots = c.projectRoots || {};
  const rootBase = Object.prototype.hasOwnProperty.call(roots, r.projectId) ? roots[r.projectId] : null;
  if (!rootBase) return { ok: false, decision: "REFUSED", reason: "no-trusted-root" };
  const repoRoot = resolveInside(".", rootBase);
  if (!repoRoot) return { ok: false, decision: "REFUSED", reason: "root-escape" };

  // Branch verification.
  let branch;
  try { branch = gitIn(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]); }
  catch (e) { return { ok: false, decision: "REFUSED", reason: "not-a-git-repo" }; }
  if (r.expectedBranch && branch !== r.expectedBranch) return { ok: false, decision: "REFUSED", reason: "branch-mismatch:" + branch };

  // Clean-tree policy.
  if (r.requireClean) {
    const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
    if (dirty) return { ok: false, decision: "REFUSED", reason: "working-tree-dirty" };
  }

  // The CLI binary is trusted config; never derived from the task/document.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return { ok: false, decision: "BLOCKED", reason: "claude-cli-not-configured" };
  // Reject a prompt that starts with "-" so it can never be reinterpreted as a CLI flag (defence in depth
  // on top of `-p` consuming it as a value).
  if (r.prompt.trim().startsWith("-")) return { ok: false, decision: "REFUSED", reason: "prompt-looks-like-flag" };
  const argv = typeof c.claudeArgs === "function" ? c.claudeArgs(r.prompt) : ["-p", r.prompt];
  const spawnFn = c.spawnFn || require("child_process").spawn;
  const posix = process.platform !== "win32";

  // Spawn with an argv array (no shell), bounded output + timeout. On POSIX, detach into its own process
  // group so a tree-kill reaches grandchildren the real CLI may spawn.
  let stdout = "";
  let killedFor = null;
  const child = spawnFn(c.claudeBin, argv, { cwd: repoRoot, shell: false, detached: posix });
  const killTree = () => {
    try {
      if (!posix) execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { child.kill("SIGKILL"); } }
    } catch (e) { /* best effort */ }
  };
  const timer = setTimeout(() => { killedFor = "timeout"; killTree(); }, timeoutMs);

  return new Promise((resolve) => {
    child.stdout && child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) { killedFor = "output-overflow"; killTree(); }
    });
    // Drain stderr (bounded) so a chatty worker can't block on a full stderr pipe.
    let stderrBytes = 0;
    child.stderr && child.stderr.on("data", (d) => { stderrBytes += d.length; if (stderrBytes > maxOutputBytes) { killedFor = "stderr-overflow"; killTree(); } });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, decision: "REFUSED", reason: "spawn-error:" + e.code }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedFor) return resolve({ ok: false, decision: "REFUSED", reason: killedFor });
      // Derive the ACTUAL changed files (both sides of a rename) and enforce the allowlist (never
      // touching ProjectOS source).
      let changed = [];
      try { changed = changedFiles(repoRoot); } catch (e) { /* ignore */ }
      const allowed = Array.isArray(r.allowedPaths) ? r.allowedPaths : [];
      const refusedPaths = changed.filter((p) => !isAllowedPath(p, allowed) || p.startsWith("projectos/"));
      const output = redactor.redactText(stdout).replace(GENERIC_SECRET, "«redacted»").slice(0, 4000);
      if (refusedPaths.length) return resolve({ ok: false, decision: "REFUSED", reason: "forbidden-path-change", refusedPaths, changedFiles: changed, output, exitCode: code });
      resolve({ ok: code === 0, decision: code === 0 ? "COMPLETED" : "FAILED", changedFiles: changed, output, exitCode: code });
    });
  });
}

module.exports = { runClaudeWorker, resolveInside, isAllowedPath, DEFAULTS };
```

---

# PART C — FULL SOURCE: `projectos/validators/validate-claude-worker.cjs`

```js
"use strict";
/**
 * Proves the governed Claude Code worker adapter's SAFEGUARDS (Gate 1 architecture) using a SYNTHETIC CLI
 * stand-in + a real throwaway git repo. The REAL `claude` CLI invocation is an owner-machine step; here we
 * prove the wrapper's guards. Opt-in (creates a temp git repo + drives process control) — NOT part of
 * `npm run validate`; run standalone for evidence.
 *
 * Invariants:
 *  1  empty prompt refused                     2  unknown project (no trusted root) refused
 *  3  wrong branch refused                      4  dirty tree + requireClean refused
 *  5  unconfigured CLI → BLOCKED (not a fake)   6  allowed-path change → COMPLETED, change reported
 *  7  forbidden-path change (or projectos/) refused, path listed
 *  8  timeout kills + refuses                   9  output overflow kills + refuses
 * 10  secret in worker output is redacted      11  no metered AI API / spawns with shell:false (source)
 * 12  a staged rename of protected source out of the allowlist is caught on its ORIGIN (two-sided)
 * 13  an unregistered secret shape in worker output is generically scrubbed
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-worker-secret-9k8j7h";

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "checkout", "-q", "-B", "work"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

// Synthetic `claude` stand-in: a fake child that (optionally) edits a file then closes / floods / hangs.
function fakeSpawn(behavior) {
  return (_bin, _argv, opts) => {
    const ch = new EventEmitter();
    ch.stdout = new EventEmitter();
    ch.pid = 2147480000; // non-existent pid; taskkill is a harmless no-op
    process.nextTick(() => behavior(ch, opts.cwd));
    return ch;
  };
}
const writeThenClose = (relPath, stdoutText) => (ch, cwd) => {
  fs.mkdirSync(path.dirname(path.join(cwd, relPath)), { recursive: true });
  fs.writeFileSync(path.join(cwd, relPath), "changed\n");
  if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText));
  ch.emit("close", 0);
};

async function run() {
  const errors = [];
  const repo = mkRepo();
  try {
    const base = { projectId: "acme", allowedPaths: ["app"] };
    const cfg = (extra) => ({ projectRoots: { acme: repo }, claudeBin: "synthetic-claude", spawnFn: fakeSpawn(writeThenClose("app/new.txt")), redactor: createRedactor(), timeoutMs: 1000, maxOutputBytes: 1 << 20, ...extra });

    const a1 = await runClaudeWorker({ ...base, prompt: "" }, cfg());
    if (a1.decision !== "REFUSED" || a1.reason !== "empty-prompt") errors.push("inv1: empty prompt not refused");

    const a2 = await runClaudeWorker({ ...base, prompt: "x", projectId: "ghost" }, cfg());
    if (a2.decision !== "REFUSED" || a2.reason !== "no-trusted-root") errors.push("inv2: unknown project not refused");

    const a3 = await runClaudeWorker({ ...base, prompt: "x", expectedBranch: "main" }, cfg());
    if (a3.decision !== "REFUSED" || !String(a3.reason).startsWith("branch-mismatch")) errors.push("inv3: wrong branch not refused");

    fs.writeFileSync(path.join(repo, "app", "dirty.txt"), "dirty\n");
    const a4 = await runClaudeWorker({ ...base, prompt: "x", requireClean: true }, cfg());
    if (a4.decision !== "REFUSED" || a4.reason !== "working-tree-dirty") errors.push("inv4: dirty tree not refused");
    fs.rmSync(path.join(repo, "app", "dirty.txt"));

    const a5 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ claudeBin: "" }));
    if (a5.decision !== "BLOCKED" || a5.reason !== "claude-cli-not-configured") errors.push("inv5: unconfigured CLI not BLOCKED");

    const a6 = await runClaudeWorker({ ...base, prompt: "add file" }, cfg());
    if (a6.decision !== "COMPLETED" || !(a6.changedFiles || []).some((p) => p === "app/new.txt")) errors.push("inv6: allowed-path change not COMPLETED/reported: " + JSON.stringify(a6));
    execFileSync("git", ["-C", repo, "checkout", "-q", "--", "."]); execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const a7 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ spawnFn: fakeSpawn(writeThenClose("projectos/hack.txt")) }));
    if (a7.decision !== "REFUSED" || a7.reason !== "forbidden-path-change" || !(a7.refusedPaths || []).some((p) => p.startsWith("projectos/"))) errors.push("inv7: forbidden-path change not refused: " + JSON.stringify(a7));
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const a8 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ timeoutMs: 120, spawnFn: fakeSpawn((ch) => { setTimeout(() => ch.emit("close", 0), 500); }) }));
    if (a8.decision !== "REFUSED" || a8.reason !== "timeout") errors.push("inv8: timeout not enforced: " + JSON.stringify(a8));

    const a9 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ maxOutputBytes: 64, spawnFn: fakeSpawn((ch) => { ch.stdout.emit("data", Buffer.from("x".repeat(500))); setTimeout(() => ch.emit("close", 0), 20); }) }));
    if (a9.decision !== "REFUSED" || a9.reason !== "output-overflow") errors.push("inv9: output overflow not enforced: " + JSON.stringify(a9));

    const rd = createRedactor(); rd.register(SECRET, "ref_w");
    const a10 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ redactor: rd, spawnFn: fakeSpawn(writeThenClose("app/ok.txt", "leaked " + SECRET)) }));
    if (String(a10.output || "").includes(SECRET)) errors.push("inv10: secret leaked in worker output");
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    // inv12: a STAGED RENAME that moves ProjectOS source out of the allowlist must be caught on its ORIGIN.
    const renameWorker = fakeSpawn((ch, cwd) => {
      execFileSync("git", ["-C", cwd, "mv", "projectos/core.txt", "app/renamed.txt"]);
      ch.emit("close", 0);
    });
    const a12 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ spawnFn: renameWorker }));
    if (a12.decision !== "REFUSED" || a12.reason !== "forbidden-path-change" || !(a12.refusedPaths || []).some((p) => p === "projectos/core.txt")) {
      errors.push("inv12: staged rename of protected source not caught on its origin: " + JSON.stringify(a12));
    }
    execFileSync("git", ["-C", repo, "reset", "-q", "--hard"]); execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    // inv13: an UNREGISTERED secret shape in worker output is generically scrubbed.
    const a13 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ redactor: createRedactor(), spawnFn: fakeSpawn(writeThenClose("app/ok.txt", "jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")) }));
    if (/eyJ[A-Za-z0-9_-]{12,}/.test(String(a13.output || ""))) errors.push("inv13: unregistered secret shape not scrubbed from output");
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const src = fs.readFileSync(path.join(__dirname, "..", "bridge", "claude-worker.cjs"), "utf8");
    // Real-usage patterns only (not the words "Anthropic/OpenAI" in the docstring that DISCLAIMS them).
    if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\//i.test(src)) errors.push("inv11: adapter references a metered API / network");
    if (!/shell:\s*false/.test(src)) errors.push("inv11: adapter does not spawn with shell:false");
  } catch (e) {
    errors.push("claude-worker validator crashed: " + e.message);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  return errors;
}

if (require.main === module) {
  run().then((e) => {
    if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + e.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS");
  });
}
module.exports = { run };
```

---

**END STATUS: BLOCKED — REQUIRED OWNER-MACHINE CAPABILITY UNAVAILABLE (`claude` CLI + Docker absent).
Governed worker adapter delivered + 13 safeguards proven; real worker / Supabase / reference-app await an
owner machine. Not pushed, not closed. Remote frozen `4c3f076`.**

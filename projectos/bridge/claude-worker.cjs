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

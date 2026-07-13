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

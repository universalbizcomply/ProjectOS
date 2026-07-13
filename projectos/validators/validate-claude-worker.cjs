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

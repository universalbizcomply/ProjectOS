"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D (§13). Proves exact
 * invocation binding, workspace-bound attestation, the provider streaming contract, mandatory operation
 * disposal, post-operation evidence, readiness/adapter parity, and the process-scope probe — using a MOCK
 * sandbox provider + synthetic records + REAL throwaway git repos. Real claude worker + real OS sandbox are
 * owner-machine steps. Opt-in — NOT part of `npm run validate`; run standalone. 50 invariants (§13 + round-2 ECC).
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
const attestation = require("../bridge/attestation.cjs");
const detector = require("../bridge/invocation-detector.cjs");
const opEvidence = require("../bridge/operation-evidence.cjs");
const runtime = require("../bridge/runtime-config.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const ORIGIN = "https://example.invalid/acme/app.git";
const EXE_HASH = "exe-hash-1", CLI_VER = "1.9.0", POLICY_VER = "policy-1";
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }
function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]); g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]); g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true }); fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true }); fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
const errors = [];
const fail = (inv, m, got) => errors.push(inv + ": " + m + (got !== undefined ? " :: " + JSON.stringify(got) : ""));
async function withRepo(fn) { const repo = mkRepo(); try { await fn(repo); } catch (e) { errors.push("withRepo-crash: " + (e && e.message) + (e && e.stack ? " @" + e.stack.split("\n")[1] : "")); } finally { rmRepo(repo); } }

function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_b, _a, so) => {
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => { try { if (behavior) behavior(so.cwd); } catch (e) {} if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText)); if (o.hang) return; if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000))); ch.emit("close", o.exit == null ? 0 : o.exit); });
    return ch;
  };
}
const writeApp = (rel) => (cwd) => { fs.writeFileSync(path.join(cwd, "app", rel), "x\n"); };
function mkProvider(o) { o = o || {}; return sandbox.mockProvider(o.spawnFn !== undefined ? o.spawnFn : synthSpawn(o.behavior, o.stdout, o.spawnOpts), o.provOver); }
function mkRecord(providerId, o) { return detector.syntheticRecord({ executableContentHash: EXE_HASH, cliVersion: CLI_VER, operationMode: "first-controlled-change", sandboxProviderId: providerId, policyVersion: POLICY_VER }, o || {}); }
function baseCfg(repo, o) {
  o = o || {}; const provider = o.provider !== undefined ? o.provider : mkProvider(o);
  return { projectRoots: { acme: repo }, policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 2000, maxOutputBytes: 1 << 20 }, o.policy || {}), operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" }, claudeBin: "synthetic-claude", claudeArgs: o.claudeArgs, redactor: createRedactor(), sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts), executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER, realRun: o.realRun, keepWorkspace: o.keepWorkspace };
}
const REQ = { prompt: "add a file", projectId: "acme" };
const wsCtx = { providerId: "mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "WS1", workspacePathHash: "wph", materialisationManifestHash: "mmh", executableResolvedPathInsideSandbox: "/sandbox/bin/claude" };
const IS = detector.INVOCATION_STATUS;

async function run() {
  errors.length = 0;
  const rec = mkRecord("mock-provider");
  const built = detector.buildArgv(rec, "the prompt");

  // 1 arbitrary claudeArgs cannot control the real invocation (ProjectOS builds argv from the record)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), claudeArgs: () => ["--evil", "boom"] })); if (a.decision !== "COMPLETED") fail("inv1", "run failed", a); else { const b = detector.buildArgv(a.result && { argumentTemplate: ["--allowedTools", "{tools}", "-p", "{prompt}"], permittedTools: ["Read", "Edit"] } || {}, "add a file"); if (!a.result.invocationArgvHash) fail("inv1", "no argv hash"); if (a.result.invocationRestrictionStatus !== IS.APPLIED_VERIFIED) fail("inv1", "restriction not applied despite malicious claudeArgs", a.result.invocationRestrictionStatus); } });
  // 2 restriction mechanism appears in final argv
  if (built.argv.indexOf("--allowedTools") < 0) fail("inv2", "mechanism absent from built argv");
  // 3 permitted tools in final argv exactly match the record
  { const mi = built.argv.indexOf("--allowedTools"); if (built.argv[mi + 1] !== rec.permittedTools.join(",")) fail("inv3", "permitted tools not exactly encoded"); }
  // 4 a record whose template omits the restriction mechanism is refused
  { const bad = mkRecord("mock-provider", { argumentTemplate: ["-p", "{prompt}"] }); if (detector.verifyDetectionRecord(bad, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }).ok) fail("inv4", "template without mechanism accepted"); }
  // 5 extra unknown argument refused
  if (detector.verifyInvocation(built.argv.concat(["--extra"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv5", "extra arg not NOT-VERIFIED");
  // 6 bypass flag refused
  if (detector.verifyInvocation(["--dangerously-skip-permissions"].concat(built.argv), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv6", "bypass flag not refused");
  // 7 shell-capable arg refused
  if (detector.verifyInvocation(built.argv.concat(["Bash"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv7", "shell tool not refused");
  // 8 network-tool arg refused
  if (detector.verifyInvocation(built.argv.concat(["WebFetch"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv8", "network tool not refused");
  // 9 git-write arg refused
  if (detector.verifyInvocation(built.argv.concat(["Git"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv9", "git-write tool not refused");
  // 10 argv hash bound to the operation evidence
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !a.result.invocationArgvHash) fail("inv10", "no argv hash on result"); });
  // 11 attestation occurs after workspace materialisation (workspaceId is a real materialised id)
  // 12 workspace ID is NOT operation ID
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !/^ws-/.test(a.result.workspaceId || "")) fail("inv11", "workspaceId not a materialised id", a.result && a.result.workspaceId); if (a.result && a.result.workspaceId === "OP1") fail("inv12", "workspaceId equals operationId"); });
  // 13 actual workspace is attested (a benign run passes the workspace-bound attestation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.decision !== "COMPLETED") fail("inv13", "workspace-bound attestation did not pass on a benign run", a.reason); });
  // 14 wrong workspace path refused (unit)
  if (attestation.verifyAttestation(attestation.syntheticAttestation(wsCtx), Object.assign({}, wsCtx, { workspacePathHash: "OTHER" })).ok) fail("inv14", "wrong workspace path accepted");
  // 15 wrong materialisation hash refused (unit)
  if (attestation.verifyAttestation(attestation.syntheticAttestation(wsCtx), Object.assign({}, wsCtx, { materialisationManifestHash: "OTHER" })).ok) fail("inv15", "wrong materialisation hash accepted");
  // 16/17 cleanup/termination canaries are NOT operation cleanup/termination evidence (separate modules)
  { const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2, disposalStatus: "disposed", terminationStatus: "TERMINATED-CONFIRMED" }); if (!("disposalStatus" in oev) || !("terminationStatus" in oev)) fail("inv16/17", "operation evidence lacks its own disposal/termination fields"); if ("cleanupCanary" in oev || "emergencyTerminationCanary" in oev) fail("inv16/17", "operation evidence borrowed a capability canary"); }
  // 18 a provider that does NOT expose handle.child still works (streaming contract only)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt") }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "COMPLETED") fail("inv18", "streaming-only provider run failed", a.reason); const h = prov.spawnOperation({ operationId: "x", bin: "b", argv: [], cwd: ".", env: {} }); if ("child" in h) fail("inv18", "handle exposes .child (should be internal _child)"); prov.terminateOperation(h); });
  // 19 streaming contract delivers output
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), stdout: "hello-from-worker" })); if (!a.result || String(a.result.outputExcerpt).indexOf("hello-from-worker") < 0) fail("inv19", "streaming output not delivered", a.result && a.result.outputExcerpt); });
  // 20 streaming stderr overflow terminates
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { floodErr: true } }); cfg.policy.maxOutputBytes = 64; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "stderr-overflow") fail("inv20", "stderr overflow not handled", a.reason); });
  // 21 streaming timeout terminates
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "timeout") fail("inv21", "timeout not handled", a.reason); });
  // 22 streaming interruption (provider waitForOperationExit reports worker-error) is refused
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.resolve({ exitStatus: null, killedFor: "worker-error" }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision === "COMPLETED") fail("inv22", "interruption treated as success", a.decision); });
  // 23 successful operation is disposed
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.operationDisposalStatus !== "disposed") fail("inv23", "success not disposed", a.result.operationDisposalStatus); });
  // 24 confirmed FAILED operation is disposed
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), spawnOpts: { exit: 1 } })); if (a.result.operationDisposalStatus !== "disposed") fail("inv24", "failed op not disposed", a.result.operationDisposalStatus); if (a.decision !== "FAILED" && a.decision !== "COMPLETED") { /* exit1 => FAILED */ } });
  // 25 timeout operation is disposed after confirmed termination
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.result.operationDisposalStatus !== "disposed") fail("inv25", "timeout op not disposed", a.result.operationDisposalStatus); });
  // 26 disposal failure blocks completion
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt"), provOver: { disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "BLOCKED" || a.reason !== "OPERATION-DISPOSAL-FAILED") fail("inv26", "disposal failure did not block", a); });
  // 27 unconfirmed termination preserves evidence and does not dispose
  let emgWs = null;
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt"), provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "EMERGENCY-STOP") fail("inv27", "unconfirmed not emergency", a.decision); else { if (a.result.operationDisposalStatus !== "not-disposed-evidence-preserved") fail("inv27", "disposed on unconfirmed", a.result.operationDisposalStatus); const pres = (a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (!pres) fail("inv27", "workspace not preserved"); else emgWs = pres.slice("workspace-preserved:".length); } });
  if (emgWs) { if (!fs.existsSync(emgWs)) fail("inv27", "preserved workspace gone"); rmRepo(emgWs); }
  // 28 post-operation evidence generated after exit; 29 operation-bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !a.result.operationEvidenceHash) fail("inv28", "no operation evidence hash"); });
  { const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2 }); if (opEvidence.verifyOperationEvidence(oev, { operationId: "OTHER", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h" }).ok) fail("inv29", "op evidence not operation-bound"); }
  // 30 an ACTUAL returned PID handle is rejected for real readiness
  { const prov = mkProvider({ provOver: { kind: "restricted-account", pidFallback: true } }); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, wsCtx); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv30", "pid handle passed ownership readiness", r.checks.processOwnershipVerified); }
  // 31 CLI/record version mismatch blocks readiness (tool restriction)
  { const prov = mkProvider(); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: "9.9.9", policyVersion: POLICY_VER }, wsCtx); if (r.checks.toolRestrictionVerified.status !== "BLOCKED") fail("inv31", "version mismatch not blocked", r.checks.toolRestrictionVerified); }
  // 32 readiness must never be MORE permissive than the adapter: on a config the adapter blocks for network,
  //    the readiness network check also blocks, and readiness is never READY-FOR-REAL (parity on the axis).
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { networkPolicy: "allowlist", networkAllowlist: ["api.example.com"] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); const r = cap.check({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, wsCtx); if (a.reason !== "BLOCKED-NETWORK-POLICY") fail("inv32", "adapter reason wrong", a.reason); if (r.checks.networkDisabled.status !== "BLOCKED") fail("inv32", "readiness network check not blocked", r.checks.networkDisabled); if (r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF") fail("inv32", "readiness READY where adapter blocks"); });
  // 33 unrelated sentinel survives; 34 contained terminated
  { const p = sandbox.probeProcessControl(mkProvider()); if (!p.ok || !p.evidence || p.evidence.sentinelSurvived !== true) fail("inv33/34", "process-scope probe failed", p); }
  // 35 operation enumeration excluding an unrelated process (a provider that leaks the sentinel is blocked)
  { const prov = mkProvider({ provOver: { enumerateOperationProcesses: () => [2147480001] } }); if (sandbox.probeProcessControl(prov).ok) fail("inv35", "enumeration including sentinel not blocked"); }
  // 36 symlink fallback blocks a real run (env-dependent: only when the host cannot make symlinks)
  await withRepo(async (repo) => {
    // seed a symlink blob in the repo
    let seeded = false; try { const lp = path.join(repo, "app", "link"); fs.symlinkSync("seed.txt", lp); g(repo, ["add", "-A"]); g(repo, ["commit", "-q", "-m", "link"]); seeded = true; } catch (e) { /* cannot create link on this host */ }
    if (!seeded) { errors.push("inv36: SKIPPED-ENV (host cannot create symlinks; real-run equivalence path unexercised)"); return; }
    // materialise for a real run — on a host that cannot recreate the link, fallback ⇒ NOT-EQUIVALENT
    try { const m = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim(), { realRun: true }); ledger.dispose(m.workspace); errors.push("inv36: SKIPPED-ENV (host recreated the symlink; no fallback to block)"); }
    catch (e) { if (!/NOT-EQUIVALENT/.test(String(e.message))) fail("inv36", "real-run symlink fallback did not block", e.message); }
  });
  // 37 workerToolsVerified defaults NOT VERIFIED and APPLIED requires the control
  { const res = P.buildResult({ operationId: "OP1", workerToolsVerified: "APPLIED AND VERIFIED", controls: { technicallyEnforced: [] } }); if (!P.validateResult(res).some((e) => /APPLIED without/.test(e))) fail("inv37", "APPLIED accepted without the control"); if (P.buildResult({ operationId: "OP1" }).workerToolsVerified !== "NOT VERIFIED") fail("inv37", "default not NOT VERIFIED"); }
  // 38 exact final argv → APPLIED AND VERIFIED on a benign run
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.invocationRestrictionStatus !== IS.APPLIED_VERIFIED || a.result.workerToolsVerified !== IS.APPLIED_VERIFIED) fail("inv38", "restriction not APPLIED AND VERIFIED", a.result.invocationRestrictionStatus); });
  // 39 evidence hashes validate
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (P.validateResult(a.result).length) fail("inv39", "result invalid", P.validateResult(a.result)); const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2 }); if (opEvidence.hashEvidence(oev) !== oev.evidenceHash) fail("inv39", "op evidence hash invalid"); });
  // 40 worker cannot self-approve
  { let t = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { t = true; } if (!t) fail("inv40", "APPROVED not rejected"); }
  // 41 no metered AI API; 42 no prod/provider/send/payment (source scan)
  { const m = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; const pr = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i;
    for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "operation-evidence", "runtime-config", "owner-capability-check", "executable-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (m.test(src)) fail("inv41", "metered API in " + f);
      // worker-policy legitimately NAMES providers (TWILIO/STRIPE/…) in its TOKENISH denylist to BLOCK them.
      if (f !== "worker-policy" && pr.test(src)) fail("inv42", "prod/provider/send/payment in " + f); } }
  // 43 .git-free ledger passing (no .git; worker git init refused)
  await withRepo(async (repo) => { const mat = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim()); const snap = ledger.snapshot(mat.workspace); if (Object.keys(snap).some((k) => k === ".git" || k.startsWith(".git/"))) fail("inv43", "workspace has .git"); ledger.dispose(mat.workspace); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => g(cwd, ["init", "-q"]) })); if (a.reason !== "forbidden-path-change") fail("inv43", "git init not refused", a.reason); });
  // 44 canonical monitored state stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv44", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv44", "canonical drifted"); });
  // 45 residue reported accurately
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.residue.length !== 0) fail("inv45", "benign residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv45", "kept not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 46 validator uses tmpdir only; 47 remote frozen
  { if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(fs.readFileSync(__filename, "utf8"))) fail("inv46", "not tmpdir-only"); if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv47", "wrong remote"); }
  // 48 argument-template ALLOWLIST: a template smuggling a space-separated bypass flag is refused
  { const bad = mkRecord("mock-provider", { argumentTemplate: ["--permission-mode", "bypassPermissions", "--allowedTools", "{tools}", "-p", "{prompt}"] }); if (detector.verifyDetectionRecord(bad, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }).ok) fail("inv48", "template with an extra bypass flag accepted"); }
  // 49 a benign PROMPT that contains a tool name ("Git") is NOT falsely blocked (H1: prompt is data)
  { const b = detector.buildArgv(rec, "please fix Git,Deploy references"); if (detector.verifyInvocation(b.argv, rec, "please fix Git,Deploy references").status !== IS.APPLIED_VERIFIED) fail("inv49", "benign prompt containing tool names falsely blocked"); }
  // 50 disposal failure is the HEADLINE even on a killed (timeout) run
  await withRepo(async (repo) => { const prov = mkProvider({ spawnOpts: { hang: true }, provOver: { disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) } }); const cfg = baseCfg(repo, { provider: prov }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "OPERATION-DISPOSAL-FAILED") fail("inv50", "disposal failure not headline on killed run", a.reason); });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV")); const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (50 invariants" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };

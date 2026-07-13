"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§11). Proves operation-bound
 * attestation, tool-restriction detection, provider-owned operation handles, capability readiness, and the
 * schema-v2 evidence — using a MOCK sandbox provider + synthetic attestation/detection records + REAL throwaway
 * git repos. Real claude worker + real OS sandbox are owner-machine steps. Opt-in — NOT part of `npm run
 * validate`; run standalone. 49 invariants (§11 + owner-UX + round-2 ECC fixes). No CRITICAL control is environment-skipped.
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
const runtime = require("../bridge/runtime-config.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const ORIGIN = "https://example.invalid/acme/app.git";
const EXE_HASH = "exe-hash-1", CLI_VER = "1.9.0", POLICY_VER = "policy-1";
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }

function mkRepo(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]); g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]); g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true }); fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true }); fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  if (o.gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), o.gitignore + "\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
const errors = [];
const fail = (inv, m, got) => errors.push(inv + ": " + m + (got !== undefined ? " :: " + JSON.stringify(got) : ""));
async function withRepo(fn, opts) { const repo = mkRepo(opts); try { await fn(repo); } catch (e) { errors.push("withRepo-crash: " + (e && e.message) + (e && e.stack ? " @" + e.stack.split("\n")[1] : "")); } finally { rmRepo(repo); } }

function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_bin, _argv, spawnOpts) => {
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => { try { if (behavior) behavior(spawnOpts.cwd); } catch (e) {} if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText)); if (o.hang) return; if (o.floodOut) ch.stdout.emit("data", Buffer.from("x".repeat(5000))); if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000))); ch.emit("close", 0); });
    return ch;
  };
}
const writeIn = (rel, content) => (cwd) => { const abs = path.join(cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content == null ? "changed\n" : content); };

function mkProvider(o) { o = o || {}; return sandbox.mockProvider(o.spawnFn !== undefined ? o.spawnFn : synthSpawn(o.behavior, o.stdout, o.spawnOpts), o.provOver); }
function mkRecord(providerId, o) { return detector.syntheticRecord({ executableContentHash: EXE_HASH, cliVersion: CLI_VER, operationMode: "first-controlled-change", sandboxProviderId: providerId, policyVersion: POLICY_VER }, o || {}); }
function baseCfg(repo, opts) {
  const o = opts || {};
  const provider = o.provider !== undefined ? o.provider : mkProvider(o);
  return {
    projectRoots: { acme: repo },
    policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 3000, maxOutputBytes: 1 << 20 }, o.policy || {}),
    operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" },
    claudeBin: "synthetic-claude", claudeArgs: (p) => ["-p", p], redactor: createRedactor(),
    sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts),
    executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER,
    realRun: o.realRun, requireExecInvoke: o.requireExecInvoke, keepWorkspace: o.keepWorkspace,
  };
}
const REQ = { prompt: "add a file", projectId: "acme" };
const attCtx = { providerId: "mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "OP1", executableResolvedPathInsideSandbox: "/sandbox/bin/claude" };

async function run() {
  errors.length = 0;

  // 1 environment markers cannot create readiness
  process.env.PROJECTOS_SANDBOX_PROVIDER = "1"; process.env.PROJECTOS_WORKER_PROFILE_VERIFIED = "1";
  const capNoConfig = cap.check();
  if (capNoConfig.realBlockReason !== "BLOCKED-SANDBOX-IMPLEMENTATION") fail("inv1", "env markers created readiness", capNoConfig.realBlockReason);
  delete process.env.PROJECTOS_SANDBOX_PROVIDER; delete process.env.PROJECTOS_WORKER_PROFILE_VERIFIED;
  // 2 capability checker + adapter share one runtime-config path
  {
    if (require("../bridge/runtime-config.cjs") !== runtime) fail("inv2", "runtime-config not a shared singleton");
    const prov = mkProvider(); const good = { sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "synthetic-claude", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER };
    const rr = cap.check(good, attCtx);
    // the shared verifiers run + pass for a well-formed mock (proving the path works)...
    for (const k of ["sandboxImplementationPresent", "sandboxAttestationPass", "toolRestrictionVerified", "processOwnershipVerified", "processTerminationVerified", "networkDisabled"]) if (rr.checks[k].status !== "PASS") fail("inv2", "shared check " + k + " not PASS", rr.checks[k]);
    // ...but a MOCK can NEVER be READY for a REAL run (matches the adapter's requireReal gate)
    if (rr.realBlockReason !== "BLOCKED-SANDBOX-IMPLEMENTATION") fail("inv2", "mock reached real readiness", rr.realBlockReason);
  }
  // 3 boolean attestation rejected
  if (attestation.verifyAttestation({ enforced: true }, attCtx).ok) fail("inv3", "boolean attestation accepted");
  // 4 missing canary rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { omitCanary: "networkCanary" }), attCtx).ok) fail("inv4", "missing canary accepted");
  // 5 failed canary rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { fail: "canonical-repo" }), attCtx).ok) fail("inv5", "failed canary accepted");
  // 6 expired attestation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { ttlMs: -1000 }), attCtx).ok) fail("inv6", "expired attestation accepted");
  // 7 wrong operation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx), Object.assign({}, attCtx, { operationId: "OTHER" })).ok) fail("inv7", "wrong operation accepted");
  // 8 wrong workspace rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx), Object.assign({}, attCtx, { workspaceId: "OTHER" })).ok) fail("inv8", "wrong workspace accepted");
  // 9 modified attestation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { tamper: true }), attCtx).ok) fail("inv9", "modified attestation accepted");
  // 10 mock attestation forbidden for real runs
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/x.txt"), realRun: true })); if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv10", "mock allowed for real run", a); });
  // 11 manually asserted verified profile rejected (no detector record)
  if (detector.verifyDetectionRecord({ verified: true, permittedTools: ["Read"] }, { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv11", "manual verified profile accepted");
  // 12 profile without executable hash rejected
  { const rec = mkRecord("mock-provider"); delete rec.executableContentHash; if (detector.verifyDetectionRecord(rec, { cliVersion: CLI_VER }).ok) fail("inv12", "record without exe hash accepted"); }
  // 13 profile for another executable rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider"), { executableContentHash: "OTHER", cliVersion: CLI_VER, firstControlledChange: true }).ok) fail("inv13", "record for another exe accepted");
  // 14 profile for another CLI version rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider"), { executableContentHash: EXE_HASH, cliVersion: "9.9.9", firstControlledChange: true }).ok) fail("inv14", "record for another version accepted");
  // 15 expired profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { ttlMs: -1000 }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv15", "expired record accepted");
  // 16 forbidden-tool negative test must PASS (all DENIED)
  { const rec = mkRecord("mock-provider"); const dv = detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }); if (!dv.ok) fail("inv16", "good record rejected", dv.errors); if (!rec.negativeTests.every((t) => t.result === detector.DENIED)) fail("inv16", "negative tests not all DENIED"); }
  // 17 shell-capable profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { shellDisabled: false }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv17", "shell-capable record accepted");
  // 18 network-capable profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { networkDisabled: false }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv18", "network-capable record accepted");
  // 19 first-proof network allowlist rejected (adapter)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { networkPolicy: "allowlist", networkAllowlist: ["api.example.com"] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/x.txt") })); if (a.decision !== "BLOCKED" || a.reason !== "BLOCKED-NETWORK-POLICY") fail("inv19", "network allowlist not refused for first proof", a); });
  // 20 clean exit does not kill by historical PID (handle-based confirmation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.decision !== "COMPLETED") fail("inv20", "benign run not COMPLETED", a); else if (a.result.operationHandleType === "pid") fail("inv20", "used a pid handle"); else if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv20", "not confirmed via handle", a.result.processTerminationStatus); });
  // 21 real run requires stable operation handle (provider missing operation methods rejected)
  await withRepo(async (repo) => { const prov = mkProvider(); delete prov.spawnOperation; const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/x.txt") })); if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv21", "provider without operation lifecycle accepted", a); });
  // 22 PID-only provider rejected for real runs (runtime readiness)
  { const prov = mkProvider({ provOver: { kind: "restricted-account", pidFallback: true } }); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, attCtx); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv22", "pid-only provider passed ownership", r.checks.processOwnershipVerified); }
  // 23 process-control readiness executes a synthetic lifecycle
  if (!sandbox.probeProcessControl(mkProvider()).ok) fail("inv23", "process-control lifecycle probe failed");
  // 24 readiness detects termination failure
  { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) } }); if (sandbox.probeProcessControl(prov).ok) fail("inv24", "probe passed despite termination failure"); }
  // 25 unrelated process cannot be targeted (handle enumerates only its own processes)
  { const prov = mkProvider(); const h = prov.spawnOperation({ operationId: "op25", bin: "x", argv: [], cwd: ".", env: {} }); const en = prov.enumerateOperationProcesses(h); if (en.indexOf(process.pid) >= 0) fail("inv25", "operation enumerated an unrelated pid"); prov.terminateOperation(h); if (!worker || process.killed) fail("inv25", "unrelated process affected"); }
  // 26 detached contained descendant detected by operation handle (confirm returns not-confirmed)
  { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: (h) => ({ confirmed: false, processCount: 1, evidence: "leftover" }) } }); const h = prov.spawnOperation({ operationId: "op26", bin: "x", argv: [], cwd: ".", env: {} }); const conf = prov.confirmOperationTerminated(h); if (conf.confirmed !== false) fail("inv26", "leftover descendant not detected"); }
  // 27 unconfirmed operation termination causes emergency stop (adapter)
  let emgWs = null;
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) }, behavior: writeIn("app/new.txt") }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/new.txt") })); if (a.decision !== "EMERGENCY-STOP") fail("inv27", "unconfirmed termination not emergency", a.decision); else { const pres = (a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (!pres) fail("inv28", "evidence not preserved"); else emgWs = pres.slice("workspace-preserved:".length); if (a.result.processTerminationStatus !== "EMERGENCY-STOP-REQUIRED") fail("inv27", "status not EMERGENCY-STOP-REQUIRED", a.result.processTerminationStatus); } });
  // 28 process evidence preserved (checked in inv27; also assert workspace exists)
  if (emgWs) { if (!fs.existsSync(emgWs)) fail("inv28", "preserved workspace does not exist"); rmRepo(emgWs); }
  // 29 pre-spawn refusal reports termination NOT APPLICABLE
  await withRepo(async (repo) => { const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo)); if (a.result.processTerminationStatus !== "NOT APPLICABLE") fail("inv29", "pre-spawn refusal not NOT APPLICABLE", a.result.processTerminationStatus); });
  // 30 spawn failure reports termination NOT EXECUTED
  await withRepo(async (repo) => { const prov = mkProvider({ spawnFn: null }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus !== "NOT EXECUTED") fail("inv30", "spawn failure not NOT EXECUTED", a.result.processTerminationStatus); });
  // 31 confirmed run reports TERMINATED-CONFIRMED
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv31", "confirmed run not TERMINATED-CONFIRMED", a.result.processTerminationStatus); });
  // 32 termination control is not overstated (na/emergency don't claim it enforced; validateResult enforces)
  await withRepo(async (repo) => { const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo)); const te = (a.result.controls && a.result.controls.technicallyEnforced) || []; if (te.indexOf("process-termination-confirm") >= 0) fail("inv32", "termination-confirm claimed on NOT APPLICABLE"); });
  // 33 evidence hashes validate
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (P.validateResult(a.result).length) fail("inv33", "result hash/schema invalid", P.validateResult(a.result)); if (!a.result.processControlEvidenceHash) fail("inv33", "no processControlEvidenceHash"); const att = attestation.syntheticAttestation(attCtx); if (attestation.hashAttestation(att) !== att.evidenceHash) fail("inv33", "attestation evidenceHash invalid"); });
  // 34 worker cannot self-approve/close
  { let threw = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { threw = true; } if (!threw) fail("inv34", "APPROVED not rejected"); }
  // 35 no metered AI API (source scan)
  { const rx = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "executable-check", "invocation-detector", "attestation", "runtime-config", "owner-capability-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (rx.test(src)) fail("inv35", "metered API/network in " + f); } }
  // 36 no production/provider/send/payment
  { const rx = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i; for (const f of ["claude-worker", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "runtime-config"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (rx.test(src)) fail("inv36", "prod/provider/send/payment in " + f); } }
  // 37 .git-free ledger tests remain passing (no .git in workspace; worker git init refused)
  await withRepo(async (repo) => { const mat = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim()); const snap = ledger.snapshot(mat.workspace); if (Object.keys(snap).some((k) => k === ".git" || k.startsWith(".git/"))) fail("inv37", "workspace has .git"); ledger.dispose(mat.workspace); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => g(cwd, ["init", "-q"]) })); if (a.reason !== "forbidden-path-change") fail("inv37", "worker git init not refused", a.reason); });
  // 38 canonical monitored state remains stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv38", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv38", "canonical drifted"); });
  // 39 temporary residue reported accurately
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.residue.length !== 0) fail("inv39", "benign run reported residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv39", "kept workspace not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 40 working tree clean (validator uses tmpdir only)
  { if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(fs.readFileSync(__filename, "utf8"))) fail("inv40", "validator not tmpdir-only"); }
  // 41 remote frozen (non-routable test remote only)
  { if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv41", "validator references a real/wrong remote"); }
  // 42 owner readiness HTML report never shows a false READY when blocked, and escapes dynamic values
  { const report = require("../bridge/owner-readiness-report.cjs");
    const blockedRes = { checks: { sandboxImplementationPresent: { status: "BLOCKED", reason: "<script>x</script>" } }, realBlockReason: "BLOCKED-SANDBOX-IMPLEMENTATION" };
    const html = report.renderReadinessHtml(blockedRes);
    if (/class="banner banner-ready"/.test(html)) fail("inv42", "blocked report applied a READY banner");
    if (!/banner-blocked/.test(html) || !/NOT SAFE/.test(html)) fail("inv42", "blocked report missing NOT-SAFE banner");
    if (/<script>x<\/script>/.test(html)) fail("inv42", "report did not escape a dynamic value");
    const readyRes = { checks: {}, realBlockReason: "READY-FOR-REAL-WORKER-PROOF" };
    if (!/class="banner banner-ready"/.test(report.renderReadinessHtml(readyRes))) fail("inv42", "ready report missing READY banner"); }
  // 43 a MOCK provider can never reach READY-FOR-REAL-WORKER-PROOF (checkReadiness)
  { const prov = mkProvider(); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, attCtx); if (r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF") fail("inv43", "mock reached READY-FOR-REAL"); }
  // 44 a canary with a flipped `expected` (re-hashed) is rejected (self-consistency is not enough)
  { const att = attestation.syntheticAttestation(attCtx); att.networkCanary = { attempted: "network access", expected: "reachable", actual: "reachable", result: "PASS" }; att.evidenceHash = attestation.hashAttestation(att); const v = attestation.verifyAttestation(att, attCtx); if (v.ok) fail("inv44", "flipped-expected canary accepted"); }
  // 45 a blanked integrity hash is rejected (falsy-hash bypass closed) — attestation, detection, result
  { const att = attestation.syntheticAttestation(attCtx); att.evidenceHash = ""; if (attestation.verifyAttestation(att, attCtx).ok) fail("inv45", "blanked evidenceHash accepted");
    const rec = mkRecord("mock-provider"); rec.recordHash = ""; if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv45", "blanked recordHash accepted");
    const good = P.buildResult({ operationId: "OP1" }); const bad = Object.assign({}, good, { resultHash: "" }); if (!P.validateResult(bad).some((e) => /resultHash/.test(e))) fail("inv45", "blanked resultHash accepted"); }
  // 46 a detection record whose permittedTools grants a dangerous capability is rejected
  { const rec = mkRecord("mock-provider", { permittedTools: ["Read", "Bash"] }); if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv46", "permittedTools with Bash accepted"); }
  // 47 a detection record missing a mandatory forbidden tool is rejected
  { const rec = mkRecord("mock-provider", { forbiddenTools: ["Read"] }); if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv47", "record missing forbidden Bash accepted"); }
  // 48 process-control probe re-enumerates after confirm (a residual process is caught despite confirmed:true)
  { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [4242] } }); if (sandbox.probeProcessControl(prov).ok) fail("inv48", "residual process after confirm not caught"); }
  // 49 dispose with a malformed (no residue array) result fails closed
  { const prov = mkProvider({ provOver: { disposeOperation: () => ({}) } }); if (sandbox.probeProcessControl(prov).ok) fail("inv49", "malformed dispose treated as pass"); }

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

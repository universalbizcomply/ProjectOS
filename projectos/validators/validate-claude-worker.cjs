"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E (§17). Proves provider
 * preparation + workspace custody, ACTUAL sandbox-executable identity (host ≠ sandbox), attestation binding,
 * the exact 4-argument invocation grammar, the single fail-closed operation finaliser (§8/§9/§10), provider-wait
 * cancellation (§11), the readiness REAL-probe model (§12/§13), capability-derived vs operation-observed evidence
 * (§14/§15), persisted evidence, and the deterministic symlink-equivalence branch (§16) — using a MOCK sandbox
 * provider + synthetic records + REAL throwaway git repos. Real claude worker + real OS sandbox are owner-machine
 * steps. Opt-in — NOT part of `npm run validate`. 55 invariants (51 §17 + 4 ECC round-2 regressions).
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

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const ORIGIN = "https://example.invalid/acme/app.git";
const EXE_HASH = "exe-hash-1", CLI_VER = "1.9.0", POLICY_VER = "policy-1";
const MPH = sandbox.mountPolicyHash(sandbox.MOUNT_POLICY_FIRST_PROOF);
const SB_EXE = "/sandbox/bin/claude";
const IS = detector.INVOCATION_STATUS;
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }
function mkRepo() {
  const dir = scratch.owned("claude-worker");
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
function cleanPreserved(a) { try { const p = (a.result && a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (p) rmRepo(p.slice("workspace-preserved:".length)); } catch (e) {} }

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
  return { projectRoots: { acme: repo }, policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 2000, maxOutputBytes: 1 << 20 }, o.policy || {}), operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" }, claudeBin: "synthetic-claude", redactor: createRedactor(), sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts), executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER, realRun: o.realRun, keepWorkspace: o.keepWorkspace };
}
const REQ = { prompt: "add a file", projectId: "acme" };
// A full attestation binding context (all §6 REQUIRED_CTX fields).
const attCtx = { providerId: "mock-provider", providerVersion: "mock-0", providerImplementationHash: "mock-impl-hash", preparedOperationId: "prep-OP1-mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "ws-1", workspacePathHash: "wph", materialisationManifestHash: "mmh", workspacePathInsideSandbox: "/sandbox/workspace/ws-1", mountPolicyHash: MPH, preExecutionLedgerHash: "pelh", executableResolvedPathInsideSandbox: SB_EXE, sandboxExecutablePath: SB_EXE, sandboxExecutableHash: EXE_HASH, sandboxExecutableVersion: CLI_VER };
const attFull = () => attestation.syntheticAttestation(attCtx, { providerImplementationHash: "mock-impl-hash", providerVersion: "mock-0" });
const prepCtx = { operationId: "OP1", workspaceId: "ws-1", hostWorkspacePathHash: "hwph", materialisationManifestHash: "mmh", preExecutionLedgerHash: "pelh", mountPolicyHash: MPH, providerId: "mock-provider" };
const mkPrep = () => mkProvider().prepareOperation({ operationId: "OP1", workspaceId: "ws-1", hostWorkspacePathHash: "hwph", materialisationManifestHash: "mmh", preExecutionLedgerHash: "pelh", networkPolicy: "disabled", mountPolicy: sandbox.MOUNT_POLICY_FIRST_PROOF });

async function run() {
  errors.length = 0;
  const rec = mkRecord("mock-provider");
  const built = detector.buildArgv(rec, "the prompt");
  const bind = { executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER };

  // ── §5 host vs sandbox executable identity ──────────────────────────────────────────────────────────
  // 1 host and sandbox executable identities are DISTINCT concepts
  { const prov = mkProvider(); const prep = mkPrep(); const sp = prov.resolveExecutable(prep, "/host/bin/claude"); const id = sandbox.buildExecutableIdentity({ hostRequestedExecutable: "claude", hostResolvedPath: "/host/bin/claude", hostContentHash: "host-h", sandboxResolvedPath: sp, sandboxContentHash: prov.hashExecutable(prep, sp), sandboxReportedVersion: prov.getExecutableVersion(prep, sp), providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }); if (id.hostResolvedPath === id.sandboxResolvedPath) fail("inv1", "host and sandbox paths not distinct"); if (id.hostContentHash === id.sandboxContentHash && id.hostContentHash != null) fail("inv1", "host and sandbox hashes conflated"); }
  // 2 actual sandbox executable is resolved
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutablePath !== SB_EXE) fail("inv2", "sandbox executable not resolved", a.result.sandboxExecutablePath); });
  // 3 actual sandbox executable hash is bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutableHash !== EXE_HASH || !a.result.sandboxExecutableIdentityHash) fail("inv3", "sandbox exe hash not bound", a.result.sandboxExecutableHash); });
  // 4 actual sandbox executable version is bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutableVersion !== CLI_VER) fail("inv4", "sandbox exe version not bound", a.result.sandboxExecutableVersion); });
  // 5 a DIFFERENT sandbox executable is refused
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { hashExecutable: () => "OTHER-HASH" } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.reason !== "BLOCKED-SANDBOX-EXECUTABLE-IDENTITY") fail("inv5", "different sandbox exe not refused", a.reason); });

  // ── §4 provider preparation + workspace custody ─────────────────────────────────────────────────────
  // 6 workspace is prepared BEFORE attestation (a prepare failure blocks before attestation is even reached)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { prepareOperation: (req) => { const b = mkProvider().prepareOperation(req); b.homeMounted = true; b.preparationEvidenceHash = sandbox.hashPrepared(b); return b; } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.reason !== "BLOCKED-WORKSPACE-MOUNT") fail("inv6", "prepare failure not surfaced before attestation", a.reason); });
  // 7 actual sandbox workspace path is bound (into the result + attestation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (!/^\/sandbox\/workspace\//.test(a.result.sandboxWorkspacePath || "")) fail("inv7", "sandbox workspace path not bound", a.result.sandboxWorkspacePath); });
  // 8 workspacePathInsideSandbox mismatch is refused (unit)
  if (attestation.verifyAttestation(attFull(), Object.assign({}, attCtx, { workspacePathInsideSandbox: "/other" })).ok) fail("inv8", "workspacePathInsideSandbox mismatch accepted");
  // 9 mount-policy mismatch is refused (unit)
  { const prep = mkPrep(); if (sandbox.verifyPreparedOperation(prep, Object.assign({}, prepCtx, { mountPolicyHash: "OTHER" })).ok) fail("inv9", "mount-policy mismatch accepted"); }
  // 10 pre-execution ledger mismatch is refused (unit)
  { const prep = mkPrep(); if (sandbox.verifyPreparedOperation(prep, Object.assign({}, prepCtx, { preExecutionLedgerHash: "OTHER" })).ok) fail("inv10", "pre-execution ledger mismatch accepted"); }
  // 11 spawn uses the ATTESTED prepared operation (operation evidence echoes the prepared-operation id)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const oe = a.persistedEvidence && a.persistedEvidence.operationEvidence; if (!oe || oe.preparedOperationId !== a.result.preparedOperationId || !a.result.preparedOperationId) fail("inv11", "spawn/evidence not bound to the prepared operation", oe && oe.preparedOperationId); });
  // 12 spawn uses the VERIFIED SANDBOX executable (not the host path)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt") }); let seenBin = null; const orig = prov.spawnOperation.bind(prov); prov.spawnOperation = (req) => { seenBin = req.bin; return orig(req); }; const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (seenBin !== SB_EXE) fail("inv12", "spawn did not use the sandbox executable path", seenBin); if (a.decision !== "COMPLETED") fail("inv12", "run failed", a.reason); });

  // ── §7 exact invocation grammar ─────────────────────────────────────────────────────────────────────
  // 13 exact four-argument grammar enforced (a 5-arg command refused)
  if (detector.verifyGrammar(built.argv.concat(["--x"]), rec, "the prompt", bind).ok) fail("inv13", "5-arg command accepted");
  // 14 duplicate restriction mechanism refused
  if (detector.verifyGrammar(["--allowedTools", "--allowedTools", "-p", "p"], rec, "p", bind).ok) fail("inv14", "duplicate mechanism accepted");
  // 15 duplicate prompt is refused (prompt must be the single final argument; a 5-arg form is rejected)
  if (detector.verifyGrammar(["--allowedTools", rec.permittedTools.join(","), "-p", "p", "p"], rec, "p", bind).ok) fail("inv15", "duplicate prompt accepted");
  // 16 unknown restriction mechanism refused
  { const r2 = mkRecord("mock-provider", { restrictionMechanism: "--yolo", argumentTemplate: ["--yolo", "{tools}", "-p", "{prompt}"] }); const b2 = detector.buildArgv(r2, "p"); if (detector.verifyGrammar(b2.argv, r2, "p", bind).ok) fail("inv16", "unknown mechanism accepted"); }

  // ── §8/§9/§10 single fail-closed finaliser ──────────────────────────────────────────────────────────
  // 17 provider error after handle creation ENTERS the finaliser (terminated+disposed, not bypassed)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.reject(new Error("wait boom")) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv17", "provider error did not enter finaliser", a.result.processTerminationStatus); });
  // 18 provider error cannot report NOT EXECUTED when an operation may exist
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.reject(new Error("wait boom")) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus === "NOT EXECUTED") fail("inv18", "provider error reported NOT EXECUTED"); });
  // 19 PID-handle rejection CONFIRMS termination; 20 disposes safely. (A real run needs a real host binary, so
  //    use the node executable; the mock sandbox still measures its own SANDBOX executable identity.)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { kind: "restricted-account", pidFallback: true, permittedExecutables: [process.execPath] } }); const cfg = baseCfg(repo, { provider: prov, behavior: writeApp("n.txt"), realRun: true }); cfg.claudeBin = process.execPath; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "BLOCKED-PROCESS-OWNERSHIP") fail("inv19", "pid handle not rejected", a.reason); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv19", "pid rejection did not confirm termination", a.result.processTerminationStatus); if (a.result.operationDisposalStatus !== "disposed") fail("inv20", "pid rejection did not dispose", a.result.operationDisposalStatus); });
  // 21 unexpected post-spawn error enters emergency stop when unconfirmed
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => { throw new Error("confirm boom"); } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv21", "unexpected error not emergency", a.decision); cleanPreserved(a); });
  // 22 confirmed=true plus non-empty enumeration is REJECTED (emergency)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [999] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (a.decision !== "EMERGENCY-STOP" || a.emergencyReason !== "termination-contradiction-processes-remain") fail("inv22", "confirm+processes not rejected", a); cleanPreserved(a); });
  // 23 malformed enumeration enters emergency stop
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { enumerateOperationProcesses: () => "not-an-array" } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv23", "malformed enumeration not emergency", a.decision); cleanPreserved(a); });
  // 24 provider terminal status is required (confirm true but status still running ⇒ emergency)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { operationStatus: () => ({ state: "running" }), confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (a.decision !== "EMERGENCY-STOP" || a.emergencyReason !== "provider-status-not-terminal") fail("inv24", "non-terminal status accepted", a); cleanPreserved(a); });
  // 25 operation disposal cannot occur before confirmed zero processes (contradiction ⇒ no dispose call)
  await withRepo(async (repo) => { let disposedCalled = false; const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [999], disposeOperation: () => { disposedCalled = true; return { disposed: true, residue: [] }; } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (disposedCalled) fail("inv25", "disposed before confirmed zero processes"); cleanPreserved(a); });

  // ── §11 provider wait cancellation ──────────────────────────────────────────────────────────────────
  // 26 host timeout cancels the provider wait (provider wait resolves only on abort)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: (h, opts) => new Promise((res) => { if (opts && opts.signal) opts.signal.addEventListener("abort", () => res({ exitStatus: null, killedFor: "host-cancelled" }), { once: true }); }) } }); const cfg = baseCfg(repo, { provider: prov }); cfg.policy.timeoutMs = 50; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "timeout") fail("inv26", "host timeout did not cancel provider wait", a.reason); });
  // 27 completed provider wait clears the host timeout (a benign run returns promptly, not after the backstop). The
  // backstop is set far above the run's real git cost and the run must finish in under half of it: a fixed 1500 ms
  // against a 2000 ms backstop measured this machine's git speed (2.7 s observed, COMPLETED), not the backstop.
  await withRepo(async (repo) => { const BACKSTOP = 30000; const cfg = baseCfg(repo, { behavior: writeApp("n.txt") }); cfg.policy.timeoutMs = BACKSTOP; const t0 = Date.now(); const a = await runClaudeWorker(REQ, cfg); const dt = Date.now() - t0; if (a.decision !== "COMPLETED") fail("inv27", "benign run failed", a.reason); if (dt >= BACKSTOP / 2) fail("inv27", "benign run waited on the host backstop", dt); });
  // 28 no provider callback runs after disposal (an aborted wait settles; the operation is disposed cleanly)
  { const prov = mkProvider(); const h = prov.spawnOperation({ operationId: "x", bin: "b", argv: [], cwd: ".", env: {} }); h._child = {}; h._alive = true; const ac = new AbortController(); const wp = prov.waitForOperationExit(h, { timeoutMs: 60000, signal: ac.signal }); ac.abort(); const settled = await Promise.race([wp.then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]); if (settled !== true) fail("inv28", "aborted provider wait did not settle (callback would run after disposal)"); prov.disposeOperation(h); }

  // ── §12/§13 readiness real probe ────────────────────────────────────────────────────────────────────
  const rdy = (over) => runtime.checkReadiness({ sandboxProvider: mkProvider({ provOver: over || {} }), detectionRecord: mkRecord("mock-provider"), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, {});
  // 29 readiness materialises a real probe workspace
  { const r = rdy(); if (!r.probeEvidence || r.probeEvidence.materialisedOk !== true) fail("inv29", "readiness did not materialise a real probe workspace", r.probeEvidence); }
  // 30 readiness does not use placeholder workspace evidence
  { const r = rdy(); const s = JSON.stringify(r); if (s.indexOf("readiness-probe-ws") >= 0 || s.indexOf("readiness-probe-path") >= 0 || s.indexOf("readiness-probe-manifest") >= 0) fail("inv30", "readiness used placeholder workspace evidence"); }
  // 31 null ownership handle blocks readiness
  { const r = rdy({ spawnOperation: () => null }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv31", "null handle passed ownership", r.checks.processOwnershipVerified); }
  // 32 missing handleType blocks readiness
  { const r = rdy({ spawnOperation: () => ({ operationId: "x" }) }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv32", "missing handleType passed ownership"); }
  // 33 ownership probe crash blocks readiness
  { const r = rdy({ spawnOperation: () => { throw new Error("boom"); } }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv33", "crashed probe passed ownership"); }
  // 34 probe operation is cleaned in finally
  { const r = rdy(); if (!r.probeEvidence || (r.probeEvidence.cleanup.probeOperation !== "disposed" && r.probeEvidence.cleanup.probeOperation !== "none")) fail("inv34", "probe operation not cleaned", r.probeEvidence && r.probeEvidence.cleanup); }
  // 35 sentinel is cleaned in finally
  { const r = rdy(); if (!r.probeEvidence || r.probeEvidence.cleanup.sentinel !== "cleaned") fail("inv35", "sentinel not cleaned", r.probeEvidence && r.probeEvidence.cleanup); }
  // 36 probe cleanup failure blocks readiness
  { const r = rdy({ disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) }); if (r.checks.processOwnershipVerified.status !== "BLOCKED" && r.checks.processTerminationVerified.status !== "BLOCKED") fail("inv36", "probe cleanup failure did not block readiness", r.checks.processOwnershipVerified); }

  // ── §14/§15 capability-derived vs operation-observed evidence ────────────────────────────────────────
  const oevGood = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "ws-1", providerId: "p", providerVersion: "v", preparedOperationId: "prep", operationHandleType: "mock", operationHandleIdRedacted: "op-x", executableContentHash: EXE_HASH, executableIdentityHash: "idh", argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, exitStatus: 0, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, disposalStatus: "disposed", residue: [], canonicalDenialCapability: "denied", networkDenialCapability: "denied" });
  const oevCtx = { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah" };
  // 37 capability-derived evidence is labelled
  if (!oevGood.capabilityDerived || !("canonicalDenialCapability" in oevGood.capabilityDerived) || !("networkDenialCapability" in oevGood.capabilityDerived)) fail("inv37", "capability-derived evidence not labelled");
  // 38 operation-observed evidence is labelled (and is not a capability canary)
  if (!oevGood.operationObserved || oevGood.operationObserved.terminationResult !== "TERMINATED-CONFIRMED" || !("residue" in oevGood.operationObserved)) fail("inv38", "operation-observed evidence not labelled");
  // 39 confirmed termination requires process count zero
  { const bad = opEvidence.buildOperationEvidence(Object.assign({}, { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 2, disposalStatus: "disposed", residue: [] })); if (opEvidence.verifyOperationEvidence(bad, oevCtx).ok) fail("inv39", "confirmed termination with processCount>0 accepted"); }
  // 40 disposed operation requires empty residue
  { const bad = opEvidence.buildOperationEvidence(Object.assign({}, { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, disposalStatus: "disposed", residue: ["leftover"] })); if (opEvidence.verifyOperationEvidence(bad, oevCtx).ok) fail("inv40", "disposed with residue accepted"); }
  // 41 complete evidence objects are persisted
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const p = a.persistedEvidence; if (!p || !p.providerPreparation || !p.executableIdentity || !p.operationEvidence || !p.capabilityAttestationHash || !p.detectionRecordHash) fail("inv41", "evidence objects not fully persisted", p && Object.keys(p)); });
  // 42 persisted evidence hashes recompute
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const p = a.persistedEvidence; if (opEvidence.hashEvidence(p.operationEvidence) !== p.operationEvidence.evidenceHash) fail("inv42", "operation evidence hash does not recompute"); if (sandbox.hashPrepared(p.providerPreparation) !== p.providerPreparation.preparationEvidenceHash) fail("inv42", "prepared-operation hash does not recompute"); });

  // ── §16 deterministic symlink equivalence ───────────────────────────────────────────────────────────
  // 43 deterministic symlink failure blocks a real execution (injected failure — NO env skip)
  await withRepo(async (repo) => {
    const blob = execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: "seed.txt" }).toString().trim();
    g(repo, ["update-index", "--add", "--cacheinfo", "120000," + blob + ",app/link"]); g(repo, ["commit", "-q", "-m", "link"]);
    const head = g(repo, ["rev-parse", "HEAD"]).trim();
    const failSym = () => { throw new Error("forced-symlink-fail"); };
    // synthetic mode records the fallback + writes a substitute
    const m1 = ledger.materialize(repo, head, { symlinkSync: failSym });
    if (!(m1.symlinkFallbacks || []).length || !fs.existsSync(path.join(m1.workspace, "app", "link"))) fail("inv43", "synthetic fallback not recorded/substituted");
    ledger.dispose(m1.workspace);
    // real mode fails closed, removes the partial workspace, writes NO substitute
    let threw = null, dest = null;
    try { ledger.materialize(repo, head, { realRun: true, symlinkSync: (t, d) => { dest = d; failSym(); } }); } catch (e) { threw = e.message; }
    if (!/NOT-EQUIVALENT/.test(String(threw))) fail("inv43", "real-run symlink failure did not block", threw);
    if (dest && fs.existsSync(dest)) fail("inv43", "a regular-file substitute was written in a real run");
    if (dest && fs.existsSync(path.dirname(dest))) fail("inv43", "partial workspace not removed");
  });
  // 44 workspace-ledger source is present in full for the review bundle
  { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", "workspace-ledger.cjs"), "utf8"); if (src.length < 2000 || src.indexOf("WORKSPACE-MATERIALISATION-NOT-EQUIVALENT") < 0) fail("inv44", "workspace-ledger source missing/short for the bundle"); }

  // ── governance + hygiene ────────────────────────────────────────────────────────────────────────────
  // 45 worker cannot self-approve or close
  { let a = false, cl = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { a = true; } try { P.buildResult({ workerDecision: "CLOSED" }); } catch (e) { cl = true; } if (!a || !cl) fail("inv45", "worker self-approve/close not rejected"); }
  // 46 no metered AI API; 47 no prod/provider/send/payment (source scan)
  { const m = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; const pr = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i;
    for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "operation-evidence", "runtime-config", "owner-capability-check", "owner-readiness-report", "executable-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (m.test(src)) fail("inv46", "metered API in " + f);
      if (f !== "worker-policy" && pr.test(src)) fail("inv47", "prod/provider/send/payment in " + f); } }
  // 48 canonical monitored state remains stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv48", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv48", "canonical drifted"); });
  // 49 all temporary residue is accounted for
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.residue.length !== 0) fail("inv49", "benign residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv49", "kept workspace not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 50 working tree stays clean — the validator writes ONLY under the OS tmpdir. Since 1d25cc8 its repos come from
  // lib/scratch.cjs (scratch.owned), so the pin is: every repo is scratch-owned, and an owned dir really lands in tmpdir.
  { const self = fs.readFileSync(__filename, "utf8"); const lib = fs.readFileSync(path.join(__dirname, "lib", "scratch.cjs"), "utf8");
    if (!/const dir = scratch\.owned\("claude-worker"\);/.test(self) || /mkdtempSync\(/.test(self.replace(/\/[^/\n]*mkdtempSync[^/\n]*\//g, ""))) fail("inv50", "validator repos are not all scratch-owned (could dirty the working tree)");
    if (!/mkdtempSync\(path\.join\(tempRoot\(\)/.test(lib) || !/realpathSync\(os\.tmpdir\(\)\)/.test(lib)) fail("inv50", "lib/scratch.cjs no longer creates under the OS tmpdir");
    const probe = scratch.owned("claude-worker-inv50"); const rel = path.relative(fs.realpathSync(os.tmpdir()), probe); scratch.cleanup(probe);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) fail("inv50", "a scratch-owned dir is not under the OS tmpdir", probe); }
  // 51 remote remains frozen — the validator never references a real remote
  { if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv51", "validator references a real remote"); }

  // ── ECC round-2 regression invariants ───────────────────────────────────────────────────────────────
  // 52 a NON-MOCK provider's bare-PID handle is rejected even WITHOUT the realRun flag (security fix)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { kind: "restricted-account", pidFallback: true, permittedExecutables: [process.execPath] } }); const cfg = baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") }); cfg.claudeBin = process.execPath; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "BLOCKED-PROCESS-OWNERSHIP") fail("inv52", "non-mock pid handle not rejected without realRun", a.reason); });
  // 53 EMERGENCY-STOP reports preservation FAILED (not a fabricated "preserved") when preserve throws
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }), preserveOperationEvidence: () => { throw new Error("preserve boom"); } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv53", "not emergency", a.decision); else if (a.result.operationDisposalStatus !== "not-disposed-evidence-preservation-failed") fail("inv53", "preservation failure fabricated as preserved", a.result.operationDisposalStatus); cleanPreserved(a); });
  // 54 verifyExecutableIdentity fails closed on an INCOMPLETE context (missing binding fields)
  { const prep = mkPrep(); const id = sandbox.buildExecutableIdentity({ hostRequestedExecutable: "c", hostResolvedPath: "/h", hostContentHash: "hh", sandboxResolvedPath: SB_EXE, sandboxContentHash: EXE_HASH, sandboxReportedVersion: CLI_VER, providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }); if (sandbox.verifyExecutableIdentity(id, {}).ok) fail("inv54", "exe-identity accepted an incomplete context"); if (!sandbox.verifyExecutableIdentity(id, { expectedContentHash: EXE_HASH, cliVersion: CLI_VER, providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }).ok) fail("inv54", "exe-identity rejected a complete valid context"); }
  // 55 a workspace-disposal failure on a KILLED run escalates to the WORKSPACE-DISPOSAL-FAILED headline
  await withRepo(async (repo) => { const origDispose = ledger.dispose; ledger.dispose = (d) => { origDispose(d); return ["forced-residue:" + d]; }; try { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "WORKSPACE-DISPOSAL-FAILED") fail("inv55", "workspace disposal failure not escalated on a killed run", a.reason); } finally { ledger.dispose = origDispose; } });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV")); const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (55 invariants: 51 §17 + 4 ECC round-2" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };

"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C.
 *
 * Operation-bound, technically-verified pipeline (fail-closed at every gate):
 *   policy tamper/content
 *     → SANDBOX (fail-closed; real ⇒ non-mock) → FIRST-PROOF NETWORK must be DISABLED (allowlist refused)
 *     → STRUCTURED OPERATION-BOUND ATTESTATION verified (canaries; not a boolean) → EXECUTABLE (shared checker,
 *       provider-permitted) → TOOL-RESTRICTION DETECTION RECORD verified (bound to exe hash + version)
 *     → canonical baseline (strict git) → MATERIALISE .git-free workspace → FS snapshot BEFORE
 *     → provider.spawnOperation (STABLE operation handle, not a bare PID) → bounded output/timeout
 *     → CONFIRM via the operation HANDLE (clean exit never kills a reused PID) — unconfirmed ⇒ EMERGENCY-STOP
 *       (preserve evidence, no reconcile) → FS snapshot AFTER → TRUSTED FS DIFF → enforce every path
 *     → monitored-state reconcile → dispose → schema-v2 result (termination as an ENUM; no apply/commit/gate)
 *
 * HONEST SCOPE: OS-level PREVENTION is delivered by the sandbox provider (verified via operation-bound
 * canary attestation), not this wrapper. No real provider is installed here ⇒ real runs BLOCKED. Claude cannot
 * approve/close.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { createRedactor } = require("../security/redaction.cjs");
const P = require("./worker-policy.cjs");
const ledger = require("./workspace-ledger.cjs");
const sandbox = require("./sandbox-provider.cjs");
const attestation = require("./attestation.cjs");
const detector = require("./invocation-detector.cjs");
const opEvidence = require("./operation-evidence.cjs");
const execcheck = require("./executable-check.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024;

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
// Version match at TOKEN boundaries (so "21.9.0" does NOT satisfy a want of "1.9.0").
function verMatch(detected, want) { if (!detected || !want) return true; const w = String(want).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp("(^|[^0-9.])" + w + "([^0-9.]|$)").test(String(detected)); }
function gitStrict(repoRoot, args) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: GIT_MAXBUF }); }
function gitLine(repoRoot, args) { return gitStrict(repoRoot, args).trim(); }
function refused(reason, extra) { return Object.assign({ ok: false, decision: "REFUSED", reason }, extra || {}); }
function blocked(reason, extra) { return Object.assign({ ok: false, decision: "BLOCKED", reason }, extra || {}); }
function emergency(reason, extra) { return Object.assign({ ok: false, decision: "EMERGENCY-STOP", reason }, extra || {}); }
function resolveGitDir(repoRoot, answer) { return path.isAbsolute(answer) ? answer : path.resolve(repoRoot, answer); }

function monitorSnapshot(repoRoot, opts) {
  const o = opts || {};
  const status = gitStrict(repoRoot, ["status", "--porcelain"]).trim();
  const ignoredList = gitStrict(repoRoot, ["status", "--porcelain", "--ignored", "--untracked-files=all", "-z"]);
  const tracked = gitStrict(repoRoot, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  const files = {}; let unverifiable = 0;
  for (const rel of tracked) { try { files[rel] = ledger.sha256File(path.join(repoRoot, rel)); } catch (e) { files[rel] = "MISSING"; unverifiable++; } }
  let deepInventory = "off";
  if (o.deepIgnored) {
    const deep = {}; const paths = ignoredList.split("\0").filter(Boolean).map((rec) => rec.slice(3)).sort();
    for (const rel of paths) { const abs = path.join(repoRoot, rel); try { if (fs.statSync(abs).isFile()) deep[rel] = ledger.sha256File(abs); } catch (e) { deep[rel] = "ERR"; } }
    deepInventory = sha256(JSON.stringify(deep));
  }
  return { toplevel: gitLine(repoRoot, ["rev-parse", "--show-toplevel"]), origin: safeOrigin(repoRoot), branch: gitLine(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]), head: gitLine(repoRoot, ["rev-parse", "HEAD"]), status, ignoredInventory: sha256(ignoredList), deepInventory, filesHash: sha256(JSON.stringify(files)), metaHash: gitMetaDigest(repoRoot), unverifiable };
}
function safeOrigin(repoRoot) { try { return gitLine(repoRoot, ["remote", "get-url", "origin"]); } catch (e) { return /no such remote|No such/i.test(String(e.message)) ? "no-origin" : "origin-unreadable"; } }
function gitMetaDigest(repoRoot) {
  const common = resolveGitDir(repoRoot, gitLine(repoRoot, ["rev-parse", "--git-common-dir"]));
  const parts = [];
  const addFile = (p) => { try { if (fs.existsSync(p)) parts.push(p + ":" + sha256(fs.readFileSync(p))); } catch (e) { parts.push(p + ":ERR"); } };
  for (const f of ["config", "HEAD", "packed-refs"]) addFile(path.join(common, f));
  for (const f of ["exclude", "attributes", "sparse-checkout"]) addFile(path.join(common, "info", f));
  const walk = (dir, tag) => { let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { parts.push(dir + ":READDIR-ERR"); return; } for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) { const full = path.join(dir, e.name); if (e.isSymbolicLink()) { try { parts.push(full + ":LINK:" + sha256(fs.readlinkSync(full))); } catch (er) { parts.push(full + ":LINKERR"); } } else if (e.isDirectory()) walk(full, tag); else if (e.isFile()) { if (tag === "hooks" && e.name.endsWith(".sample")) continue; addFile(full); } } };
  walk(path.join(common, "refs"), "refs"); walk(path.join(common, "hooks"), "hooks");
  return sha256(parts.sort().join("|"));
}
function monitorDrift(a, b) { return ["toplevel", "origin", "branch", "head", "status", "ignoredInventory", "deepInventory", "filesHash", "metaHash"].filter((k) => a[k] !== b[k]); }

async function runClaudeWorker(req, config) {
  const r = req || {}; const c = config || {};
  const redactor = c.redactor || createRedactor();
  const base = { projectId: r.projectId || null };
  const out = (env, extra) => {
    const fields = Object.assign({}, base, { outcome: env.decision, reason: env.reason || null }, extra || {});
    let res; try { res = P.buildResult(fields); } catch (e) { try { console.error("[claude-worker] result build error: " + e.message); } catch (_) {} return Object.assign({}, env, { resultBuildError: e.message }); }
    return Object.assign({}, env, { result: res });
  };
  // Pre-spawn refusals: no process ever existed ⇒ termination NOT APPLICABLE.
  const na = (env, extra) => out(env, Object.assign({ processTerminationStatus: "NOT APPLICABLE" }, extra || {}));

  // 1) Request tamper + content.
  const { policy, violations } = P.resolvePolicy(r, c);
  Object.assign(base, { operationId: policy.operationId, phaseId: policy.phaseId });
  if (violations.length) return na(refused("request-policy-tamper", { violations }), { refusedPaths: violations });
  if (typeof r.prompt !== "string" || !r.prompt.trim()) return na(refused("empty-prompt"));
  if (r.prompt.length > policy.maxPromptChars) return na(refused("prompt-too-long"));
  if (P.promptHasRawSecret(r.prompt)) return na(refused("prompt-contains-raw-secret"));
  if (typeof r.projectId !== "string" || !r.projectId) return na(refused("no-project"));
  if (!policy.repoRoot) return na(refused("no-trusted-root"));
  if (P.allowlistTouchesProjectos(policy)) return na(refused("allowlist-touches-projectos"));
  if (r.prompt.trim().startsWith("-")) return na(refused("prompt-looks-like-flag"));

  // 2) Sandbox (fail-closed). requireReal forces a non-mock provider.
  const requireReal = !!c.realRun || !!c.requireExecInvoke;
  const sb = sandbox.resolveSandbox(c, { requireReal });
  if (!sb.ok) return na(blocked("OS-SANDBOX-" + sb.reason.replace(/^OS-SANDBOX-/, ""), { errors: sb.errors }));
  const provider = sb.provider;
  const sandboxPolicy = sandbox.policySummary(provider);

  // 3) FIRST-PROOF NETWORK POLICY: must be disabled (no allowlist / DNS / localhost / registries / remotes).
  if (provider.networkPolicy !== "disabled") return na(blocked("BLOCKED-NETWORK-POLICY", { networkPolicy: provider.networkPolicy }));

  // 4) Executable FIRST (so identity is verified against the REAL binary, not a config claim): shared checker;
  //    provider must permit exactly this executable; the resolved binary's content hash + version must match
  //    the values the detection record + attestation are bound to.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-configured" }));
  if (provider.kind !== "mock" && Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-in-provider-permitted-executables" }));
  let exeResolved = provider.kind === "mock" ? "/sandbox/bin/claude" : null;
  if (requireReal || provider.kind !== "mock") {
    let ev; try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-check-crashed", detail: String(e.message).slice(0, 120) })); }
    if (!ev.ok) return na(blocked("BLOCKED-EXECUTABLE", { execReason: ev.reason, resolvedPath: ev.resolvedPath || null }));
    exeResolved = ev.resolvedPath;
    // bind the actual binary: hash it and compare to the record/attestation's declared executableContentHash
    let realHash = null; try { realHash = sha256(fs.readFileSync(ev.resolvedPath)); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-unreadable" })); }
    if (c.executableContentHash && realHash !== c.executableContentHash) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-content-hash-mismatch" }));
    if (c.cliVersion && ev.version && !verMatch(ev.version, c.cliVersion)) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "cli-version-mismatch", detail: ev.version }));
  }
  // NB: a caller `claudeArgs` function is intentionally NOT consulted — ProjectOS builds the final argv itself
  // from the verified detection record (§3). An arbitrary callback can never control the real invocation.

  // 5) TOOL-RESTRICTION DETECTION RECORD verified (bound to exe hash + version + provider + policy + template).
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider.providerId, policyVersion: c.policyVersion, now: c.now, firstControlledChange: true });
  if (!dv.ok) return na(blocked("WORKER-TOOL-RESTRICTION-NOT-PROVEN", { errors: dv.errors }));
  const permittedTools = (c.detectionRecord && c.detectionRecord.permittedTools) || [];

  // 6) Canonical baseline (strict git; fails closed).
  const repoRoot = policy.repoRoot;
  let before;
  try { const tl = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]); if (path.resolve(tl) !== path.resolve(repoRoot)) return na(refused("root-not-git-toplevel", { toplevel: tl })); before = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); }
  catch (e) { return na(blocked("baseline-snapshot-failed", { detail: String(e.message).slice(0, 160) })); }
  if (!before.head) return na(blocked("baseline-head-unresolved"));
  if (policy.expectedRemote && before.origin !== policy.expectedRemote) return na(refused("remote-mismatch", { origin: before.origin }));
  if (policy.expectedBranch && before.branch !== policy.expectedBranch) return na(refused("branch-mismatch", { branch: before.branch }));
  if (policy.requireClean && before.status) return na(refused("working-tree-dirty"));
  Object.assign(base, { toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: before.branch, finalHead: before.head });

  // 7) Materialise the .git-free workspace FIRST (before attestation). A real-run symlink fallback that is not
  //    type-equivalent to the baseline fails closed (§11). workspaceId is UNIQUE and SEPARATE from operationId.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head, { realRun: requireReal }); }
  catch (e) { const eq = /NOT-EQUIVALENT/.test(String(e.message)); return na(blocked(eq ? "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT" : "workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace; const workspaceId = mat.workspaceId;
  let disposed = false, preserve = false;
  const disposeAll = () => { if (c.keepWorkspace) return ["kept-by-config:" + workspace]; if (disposed || preserve) return []; disposed = true; return ledger.dispose(workspace); };

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree", "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape", "timeout", "output-cap", "fail-closed-sandbox-gate", "workspace-bound-attestation", "detection-record-verification", "exact-invocation-binding", "shared-executable-check", "provider-permitted-executable", "first-proof-network-disabled", "provider-operation-handle", "mandatory-operation-disposal"];
  const wsFields = { workspaceId, materialisationManifestHash: mat.materialisationManifestHash, materialiseWarnings: mat.symlinkFallbacks || [] };
  const controlsFor = (killConfirmed, toolsApplied) => ({ technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []).concat(toolsApplied ? ["exact-invocation-restriction-applied"] : []), policyRequested: ["worker-tool-restriction"], delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"], notVerified: killConfirmed ? [] : ["process-termination-confirm"], outOfScope: [] });
  const commonBase = () => Object.assign({ sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy, canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy, workerToolsPermitted: permittedTools, workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE", projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"], filesInspectionStatus: "NOT OBSERVABLE", processControlProvider: provider.providerId }, wsFields);
  const commonResult = (kc, toolsApplied) => Object.assign(commonBase(), { controls: controlsFor(kc, toolsApplied), workerToolsVerified: toolsApplied ? "APPLIED AND VERIFIED" : "NOT VERIFIED" });
  // Post-materialise refusal that always disposes the workspace (no process ran ⇒ termination NOT APPLICABLE).
  const postMat = (env, extra, toolsApplied) => out(env, Object.assign({}, commonResult(false, toolsApplied), { processTerminationStatus: "NOT APPLICABLE", residue: disposeAll() }, extra || {}));

  // 8) STRUCTURED provider CAPABILITY attestation — bound to the ACTUAL materialised workspace + real exe + op.
  const attCtx = { providerId: provider.providerId, operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, workspaceId, workspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, executableResolvedPathInsideSandbox: exeResolved, now: c.now };
  let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
  const av = attestation.verifyAttestation(att, attCtx);
  if (!av.ok) return postMat(blocked("BLOCKED-SANDBOX-ATTESTATION", { errors: av.errors }));
  const providerCapabilityAttestationHash = att && att.evidenceHash;

  // 9) EXACT INVOCATION BINDING: ProjectOS builds the FINAL argv ITSELF from the verified record (never a
  //    caller function) and verifies it exactly encodes the restriction. Not APPLIED-AND-VERIFIED ⇒ refuse.
  const built = detector.buildArgv(c.detectionRecord, r.prompt);
  const inv = detector.verifyInvocation(built.argv, c.detectionRecord, r.prompt);
  const invocationArgvHash = inv.argvHash; const invocationRestrictionStatus = inv.status;
  if (inv.status !== detector.INVOCATION_STATUS.APPLIED_VERIFIED) return postMat(blocked("INVOCATION-RESTRICTION-NOT-APPLIED", { invocationRestrictionStatus: inv.status, errors: inv.errors }), { invocationRestrictionStatus: inv.status, invocationArgvHash, providerCapabilityAttestationHash });
  const argv = built.argv;

  const wsBefore = ledger.snapshot(workspace);
  const preExecutionLedgerHash = ledger.hashSnapshot(wsBefore);
  const evBase = { invocationArgvHash, invocationRestrictionStatus, providerCapabilityAttestationHash, preExecutionLedgerHash };
  const startTs = Date.now();
  let handle = null;
  try {
    // 10) Spawn via the provider-owned operation (stable handle).
    try { handle = provider.spawnOperation({ bin: c.claudeBin, argv, cwd: workspace, env: P.buildMinimalEnv(process.platform, policy.envAllowlist), operationId: policy.operationId }); }
    catch (e) { return postMat(blocked("operation-spawn-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({ processTerminationStatus: "NOT EXECUTED" }, evBase), true); }
    const handleType = handle && handle.handleType;
    const handleIdRedacted = handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null;
    if (handleType === "pid" && requireReal) { try { provider.terminateOperation(handle); } catch (e) {} return postMat(blocked("BLOCKED-PROCESS-OWNERSHIP", { reason2: "pid-handle-forbidden-for-real-runs" }), Object.assign({ processTerminationStatus: "NOT EXECUTED", operationHandleType: handleType }, evBase), true); }

    // 11) Wait + read output ONLY through the provider streaming contract (never handle.child).
    // Adapter-side timeout BACKSTOP (defence in depth): even if a provider ignores its own timeoutMs, the
    // adapter terminates + resolves rather than hanging forever.
    let run;
    try {
      const hostTimeout = new Promise((rz) => setTimeout(() => rz({ exitStatus: null, killedFor: "timeout" }), (policy.timeoutMs || 120000) + 2000));
      run = await Promise.race([provider.waitForOperationExit(handle, { timeoutMs: policy.timeoutMs, maxOutputBytes: policy.maxOutputBytes }), hostTimeout]);
      if (run && run.killedFor === "timeout") { try { provider.terminateOperation(handle); } catch (e) {} }
    } catch (e) { run = { exitStatus: null, killedFor: "provider-error" }; }
    let rawOut = ""; try { rawOut = provider.readOperationOutput(handle, policy.maxOutputBytes); } catch (e) { /* ignore */ }
    const output = P.scrubSecrets(redactor.redactText(rawOut || "")).slice(0, 4000);
    const exitTs = Date.now();
    const opBase = { operationId: policy.operationId, workspaceId, providerId: provider.providerId, providerVersion: provider.providerVersion, operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, executableContentHash: c.executableContentHash, argvHash: invocationArgvHash, startTimestamp: startTs, exitTimestamp: exitTs };

    if (run.killedFor === "spawn-error" || run.killedFor === "provider-error") return postMat(refused(run.killedFor), Object.assign({ processTerminationStatus: "NOT EXECUTED", outputExcerpt: output, operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted }, evBase), true);

    // 12) Terminate (if killed) + CONFIRM via the operation handle.
    if (run.killedFor) { try { provider.terminateOperation(handle); } catch (e) {} }
    let conf; try { conf = provider.confirmOperationTerminated(handle); } catch (e) { conf = { confirmed: false, processCount: null }; }
    const processCount = conf && conf.processCount;
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted, handleType, processCount, confirmed: conf && conf.confirmed, providerEvidence: conf && conf.evidence }));
    const canary = (n) => (att && att[n] && att[n].actual) || "not-evaluated";

    // Unconfirmed ⇒ EMERGENCY-STOP: do NOT dispose destructively; preserve operation + workspace evidence.
    if (!conf || conf.confirmed !== true) {
      preserve = true; try { provider.preserveOperationEvidence(handle); } catch (e) {}
      const opEv = opEvidence.buildOperationEvidence(Object.assign({}, opBase, { exitStatus: run.exitStatus, terminationStatus: "TERMINATION-UNCONFIRMED", operationProcessCount: processCount, networkDenialResult: canary("networkCanary"), canonicalAccessDenialResult: canary("canonicalPathCanary"), otherProjectAccessDenialResult: canary("otherProjectPathCanary"), credentialAccessDenialResult: canary("credentialPathCanary"), outputRedactionResult: "applied", disposalStatus: "not-disposed-evidence-preserved", residue: ["operation-preserved"] }));
      return out(emergency("EMERGENCY-STOP-REQUIRED"), Object.assign({}, commonResult(false, true), evBase, { operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, operationProcessCountObserved: processCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: opEv.evidenceHash, operationDisposalStatus: "not-disposed-evidence-preserved", operationResidue: ["operation-preserved"], outputExcerpt: output, processTerminationStatus: "EMERGENCY-STOP-REQUIRED", killConfirmed: false, residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace], risks: ["operation termination unconfirmed — external-operation lock; owner resolution required"], cancellationStatus: "unconfirmed" }));
    }

    // 13) MANDATORY disposal after confirmed termination. A malformed / non-empty-residue disposal is a failure.
    let descendants = []; try { descendants = provider.enumerateOperationProcesses(handle) || []; } catch (e) { descendants = []; }
    let disp; try { disp = provider.disposeOperation(handle); } catch (e) { disp = null; }
    const operationResidue = disp && Array.isArray(disp.residue) ? disp.residue : ["disposal-result-malformed"];
    const disposalOk = !!disp && disp.disposed === true && Array.isArray(disp.residue) && disp.residue.length === 0;
    const operationDisposalStatus = disposalOk ? "disposed" : "disposal-failed";
    const buildOpEv = (term) => opEvidence.buildOperationEvidence(Object.assign({}, opBase, { exitStatus: run.exitStatus, terminationStatus: term, operationProcessCount: processCount, containedDescendants: descendants, networkDenialResult: canary("networkCanary"), canonicalAccessDenialResult: canary("canonicalPathCanary"), otherProjectAccessDenialResult: canary("otherProjectPathCanary"), credentialAccessDenialResult: canary("credentialPathCanary"), outputRedactionResult: "applied", disposalStatus: operationDisposalStatus, residue: operationResidue }));
    const opFields = () => ({ operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, operationProcessCountObserved: processCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: buildOpEv("TERMINATED-CONFIRMED").evidenceHash, operationDisposalStatus, operationResidue });
    const done = (env, extra) => out(env, Object.assign({}, commonResult(true, true), evBase, opFields(), { residue: disposeAll() }, extra || {}));

    // Disposal failure is the HEADLINE outcome on EVERY post-confirmation branch (not buried in metadata behind
    // a timeout/drift/forbidden reason): a leftover sandbox operation must never be under-reported.
    if (!disposalOk) return done(blocked("OPERATION-DISPOSAL-FAILED", { operationResidue }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Killed (but confirmed dead + disposed) ⇒ refuse.
    if (run.killedFor) { const reason = ["timeout", "output-overflow", "stderr-overflow"].includes(run.killedFor) ? run.killedFor : "worker-error"; return done(refused(reason), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", cancellationStatus: "confirmed", timeoutStatus: run.killedFor === "timeout" ? "killed" : "none", residualDriftStatus: "not-evaluated" }); }

    // 14) Trusted FS diff + path enforcement (clean exit only).
    const wsAfter = ledger.snapshot(workspace); const led = ledger.diff(wsBefore, wsAfter);
    const refusedPaths = [];
    for (const p of led.changedPaths) { const norm = P.normPath(p); if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; } }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p);

    // 15) Monitored-state reconciliation.
    let after; try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); } catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED" }); }
    if (after.unverifiable > 0 || before.unverifiable > 0) return done(blocked("monitored-state-unverifiable", { unverifiable: after.unverifiable + before.unverifiable }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";
    const manifest = ledger.manifest(wsAfter, led);
    const patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null;
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, ledgerSummary });
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary });

    // 16) Dispose the WORKSPACE and gate on it: a workspace that could not be deleted (source-tree left on
    //     disk) must NOT be reported COMPLETED. `kept-by-config` is an owner-requested keep, not a failure.
    const residue = disposeAll();
    const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
    if (realResidue.length) return out(blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue }), Object.assign({}, commonResult(true, true), evBase, opFields(), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, residue }));

    // 17) Success.
    let res; try {
      res = P.buildResult(Object.assign({}, commonResult(true, true), evBase, opFields(), { operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, approvalStatus: policy.approvalId ? "referenced" : "none", toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: after.branch, finalHead: after.head, outcome: run.exitStatus === 0 ? "COMPLETED" : "FAILED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, processTerminationStatus: "TERMINATED-CONFIRMED", killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none", outputExcerpt: output, residue, workerDecision: run.exitStatus === 0 ? "PROPOSED" : "FAILED" }));
    } catch (e) { return out(blocked("result-build-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, commonResult(true, true), { residue })); }
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true, true), { residue }));
    return { ok: run.exitStatus === 0, decision: run.exitStatus === 0 ? "COMPLETED" : "FAILED", output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
  } catch (e) {
    preserve = true; const wasDisposed = disposed;
    try { if (handle) provider.preserveOperationEvidence(handle); } catch (er) {}
    return out(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({}, commonResult(false, true), { processTerminationStatus: "TERMINATION-UNCONFIRMED", residualDriftStatus: "not-evaluated", residue: [wasDisposed ? "already-disposed:" + workspace : "workspace-preserved:" + workspace], risks: ["unexpected error — evidence preserved; owner resolution required"] }));
  } finally { if (!disposed && !preserve && !c.keepWorkspace) disposeAll(); }
}

module.exports = { runClaudeWorker, monitorSnapshot, monitorDrift, gitMetaDigest };

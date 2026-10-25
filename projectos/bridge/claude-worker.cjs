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

  // 4) HOST executable presence. §5: the host executable and the SANDBOX executable are DISTINCT concepts. Here
  //    we only prove a REAL host binary exists (resolvable, not a shim, invocable) and capture its identity for
  //    the record. The authoritative content-hash + version BINDING is enforced against the SANDBOX executable
  //    identity measured INSIDE the sandbox (step 10) — never the host path.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-configured" }));
  if (provider.kind !== "mock" && Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-in-provider-permitted-executables" }));
  let exeResolved = provider.kind === "mock" ? "/sandbox/bin/claude" : null;
  let hostExeHash = null;
  if (requireReal || provider.kind !== "mock") {
    let ev; try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-check-crashed", detail: String(e.message).slice(0, 120) })); }
    if (!ev.ok) return na(blocked("BLOCKED-EXECUTABLE", { execReason: ev.reason, resolvedPath: ev.resolvedPath || null }));
    exeResolved = ev.resolvedPath;
    try { hostExeHash = sha256(fs.readFileSync(ev.resolvedPath)); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-unreadable" })); }
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

  // 7) Materialise the .git-free workspace FIRST (before prepare/attestation). A real-run symlink fallback that
  //    is not type-equivalent to the baseline fails closed (§11/§16). workspaceId is UNIQUE and ≠ operationId.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head, { realRun: requireReal }); }
  catch (e) { const eq = /NOT-EQUIVALENT/.test(String(e.message)); return na(blocked(eq ? "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT" : "workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace; const workspaceId = mat.workspaceId;
  let disposed = false, preserve = false;
  const disposeAll = () => { if (c.keepWorkspace) return ["kept-by-config:" + workspace]; if (disposed || preserve) return []; disposed = true; return ledger.dispose(workspace); };

  // Mutable evidence holders — assigned as the pre-spawn gates pass; read by evFields()/commonResult() at return.
  const wsBefore = ledger.snapshot(workspace);
  const preExecutionLedgerHash = ledger.hashSnapshot(wsBefore);
  let prep = null, exeIdentity = null, att = null;
  let sandboxExePath = null, sandboxExeHash = null, sandboxExeVersion = null;
  let providerCapabilityAttestationHash = null, invocationArgvHash = null;
  let invocationRestrictionStatus = "NOT VERIFIED", invocationGrammarStatus = "NOT VERIFIED";
  let capabilityDerivedObj = { canonicalDenialCapability: "not-evaluated", otherProjectDenialCapability: "not-evaluated", credentialDenialCapability: "not-evaluated", networkDenialCapability: "not-evaluated" };
  const mountPolicy = sandbox.MOUNT_POLICY_FIRST_PROOF;
  const expectedMountPolicyHash = sandbox.mountPolicyHash(mountPolicy);
  const canaryOf = (a, n) => (a && a[n] && a[n].actual) || "not-evaluated";

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree", "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape", "timeout", "output-cap", "fail-closed-sandbox-gate", "provider-prepared-operation", "workspace-mount-custody", "sandbox-executable-identity", "workspace-bound-attestation", "detection-record-verification", "exact-invocation-binding", "exact-invocation-grammar", "shared-executable-check", "provider-permitted-executable", "first-proof-network-disabled", "provider-operation-handle", "provider-wait-cancellation", "single-fail-closed-finaliser", "mandatory-operation-disposal"];
  const evFields = () => ({
    invocationArgvHash, invocationRestrictionStatus, invocationGrammarStatus, providerCapabilityAttestationHash, preExecutionLedgerHash,
    preparedOperationId: prep && prep.preparedOperationId, preparedOperationVerified: !!prep,
    mountPolicyHash: prep && prep.mountPolicyHash, sandboxWorkspacePath: prep && prep.sandboxWorkspacePath,
    sandboxExecutablePath: sandboxExePath, sandboxExecutableHash: sandboxExeHash, sandboxExecutableVersion: sandboxExeVersion,
    sandboxExecutableIdentityHash: exeIdentity && exeIdentity.identityEvidenceHash,
  });
  const wsFields = { workspaceId, materialisationManifestHash: mat.materialisationManifestHash, materialiseWarnings: mat.symlinkFallbacks || [] };
  const controlsFor = (killConfirmed, toolsApplied) => ({ technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []).concat(toolsApplied ? ["exact-invocation-restriction-applied"] : []), policyRequested: ["worker-tool-restriction"], delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"], notVerified: killConfirmed ? [] : ["process-termination-confirm"], outOfScope: [] });
  const commonBase = () => Object.assign({ sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy, canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy, workerToolsPermitted: permittedTools, workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE", projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"], filesInspectionStatus: "NOT OBSERVABLE", processControlProvider: provider.providerId }, wsFields, evFields());
  const commonResult = (kc, toolsApplied) => Object.assign(commonBase(), { controls: controlsFor(kc, toolsApplied), workerToolsVerified: toolsApplied ? "APPLIED AND VERIFIED" : "NOT VERIFIED" });
  // Post-materialise refusal that always disposes the workspace (no process ran ⇒ termination NOT APPLICABLE).
  const postMat = (env, extra, toolsApplied) => out(env, Object.assign({}, commonResult(false, toolsApplied), { processTerminationStatus: "NOT APPLICABLE", residue: disposeAll() }, extra || {}));

  // 8) §4 PROVIDER PREPARATION + WORKSPACE CUSTODY — the provider mounts the EXACT workspace and returns a
  //    descriptor bound to this operation. Verified fail-closed: nothing but the workspace mounted, network
  //    disabled, every identity+hash matches, integrity valid. A caller-supplied hash alone is never accepted.
  try { prep = provider.prepareOperation({ operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, workspaceId, hostWorkspacePath: workspace, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash, networkPolicy: provider.networkPolicy, executableIdentity: null, mountPolicy }); }
  catch (e) { prep = null; }
  const pv = sandbox.verifyPreparedOperation(prep, { operationId: policy.operationId, workspaceId, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash, mountPolicyHash: expectedMountPolicyHash, providerId: provider.providerId, now: c.now });
  if (!pv.ok) { const mount = pv.errors.some((e) => /mounted|networkPolicy|does not match/.test(e)); prep = (prep && typeof prep === "object") ? prep : null; return postMat(blocked(mount ? "BLOCKED-WORKSPACE-MOUNT" : "BLOCKED-PROVIDER-PREPARATION", { errors: pv.errors })); }

  // 9) §5 ACTUAL SANDBOX EXECUTABLE IDENTITY — resolve/hash/version the executable INSIDE the sandbox (never
  //    the host path). The detection record + attestation bind to the SANDBOX hash+version, not the host's.
  try { sandboxExePath = provider.resolveExecutable(prep, c.claudeBin); } catch (e) { sandboxExePath = null; }
  try { sandboxExeHash = sandboxExePath ? provider.hashExecutable(prep, sandboxExePath) : null; } catch (e) { sandboxExeHash = null; }
  try { sandboxExeVersion = sandboxExePath ? provider.getExecutableVersion(prep, sandboxExePath) : null; } catch (e) { sandboxExeVersion = null; }
  exeIdentity = sandbox.buildExecutableIdentity({ hostRequestedExecutable: c.claudeBin, hostResolvedPath: exeResolved, hostContentHash: hostExeHash, sandboxResolvedPath: sandboxExePath, sandboxContentHash: sandboxExeHash, sandboxReportedVersion: sandboxExeVersion, providerId: provider.providerId, preparedOperationId: prep.preparedOperationId });
  const eiv = sandbox.verifyExecutableIdentity(exeIdentity, { expectedContentHash: c.executableContentHash, cliVersion: c.cliVersion, providerId: provider.providerId, preparedOperationId: prep.preparedOperationId });
  if (!eiv.ok) return postMat(blocked("BLOCKED-SANDBOX-EXECUTABLE-IDENTITY", { errors: eiv.errors }));

  // 10) §6 STRUCTURED provider CAPABILITY attestation — produced against the PREPARED operation, bound to the
  //     prepared-op id, sandbox workspace path, mount policy, pre-execution ledger, and SANDBOX executable id.
  const attCtx = {
    providerId: provider.providerId, providerVersion: provider.providerVersion, providerImplementationHash: provider.providerImplementationHash,
    preparedOperationId: prep.preparedOperationId, operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId,
    workspaceId, workspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash,
    workspacePathInsideSandbox: prep.sandboxWorkspacePath, mountPolicyHash: expectedMountPolicyHash, preExecutionLedgerHash,
    executableResolvedPathInsideSandbox: sandboxExePath, sandboxExecutablePath: sandboxExePath, sandboxExecutableHash: sandboxExeHash, sandboxExecutableVersion: sandboxExeVersion, now: c.now,
  };
  try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
  const av = attestation.verifyAttestation(att, attCtx);
  if (!av.ok) return postMat(blocked("BLOCKED-SANDBOX-ATTESTATION", { errors: av.errors }));
  providerCapabilityAttestationHash = att && att.evidenceHash;
  capabilityDerivedObj = { canonicalDenialCapability: canaryOf(att, "canonicalPathCanary"), otherProjectDenialCapability: canaryOf(att, "otherProjectPathCanary"), credentialDenialCapability: canaryOf(att, "credentialPathCanary"), networkDenialCapability: canaryOf(att, "networkCanary") };

  // 11) §3/§7 EXACT INVOCATION BINDING + GRAMMAR: ProjectOS builds the FINAL argv itself and enforces both the
  //     exact 4-argument grammar and the applied-restriction check. Either failing ⇒ refuse.
  const built = detector.buildArgv(c.detectionRecord, r.prompt);
  const bindCtx = { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, policyVersion: c.policyVersion };
  const gram = detector.verifyGrammar(built.argv, c.detectionRecord, r.prompt, bindCtx);
  invocationGrammarStatus = gram.ok ? "PASS" : "FAIL";
  const inv = detector.verifyInvocation(built.argv, c.detectionRecord, r.prompt);
  invocationArgvHash = inv.argvHash; invocationRestrictionStatus = inv.status;
  if (!gram.ok) return postMat(blocked("BLOCKED-INVOCATION-GRAMMAR", { errors: gram.errors }), { invocationGrammarStatus });
  if (inv.status !== detector.INVOCATION_STATUS.APPLIED_VERIFIED) return postMat(blocked("INVOCATION-RESTRICTION-NOT-APPLIED", { invocationRestrictionStatus: inv.status, errors: inv.errors }));
  const argv = built.argv;

  // Redacted, non-secret persistence bundle (§14). Contains identifiers/hashes/paths only — never the prompt.
  const persistBundle = (oev) => ({ providerPreparation: prep, capabilityAttestationHash: providerCapabilityAttestationHash, executableIdentity: exeIdentity, detectionRecordHash: c.detectionRecord && c.detectionRecord.recordHash, invocationArgvHash, invocationGrammarStatus, invocationRestrictionStatus, operationEvidence: oev, capabilityDerived: capabilityDerivedObj, operationObserved: oev && oev.operationObserved });

  const startTs = Date.now();

  // ── §8 SINGLE FAIL-CLOSED OPERATION FINALISER ──────────────────────────────────────────────────────
  // Every result AFTER operation creation funnels through finalize() — no post-spawn branch bypasses it. §9:
  // a provider error once a handle exists is NEVER "NOT EXECUTED". §10: a confirmed termination additionally
  // requires enumeration=0 + terminal status + a bound handle. §11: the host-timeout race cancels the provider
  // wait (AbortSignal) and clears its own timer.
  const opBaseFor = (handle, exitTs, exitStatus) => ({ operationId: policy.operationId, workspaceId, providerId: provider.providerId, providerVersion: provider.providerVersion, preparedOperationId: prep.preparedOperationId, operationHandleType: handle && handle.handleType, operationHandleIdRedacted: handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null, executableContentHash: c.executableContentHash, executableIdentityHash: exeIdentity && exeIdentity.identityEvidenceHash, argvHash: invocationArgvHash, startTimestamp: startTs, exitTimestamp: exitTs, exitStatus, canonicalDenialCapability: capabilityDerivedObj.canonicalDenialCapability, otherProjectDenialCapability: capabilityDerivedObj.otherProjectDenialCapability, credentialDenialCapability: capabilityDerivedObj.credentialDenialCapability, networkDenialCapability: capabilityDerivedObj.networkDenialCapability });

  const emergencyStop = (handle, reason, opBaseObj, output, extraProc) => {
    preserve = true;
    // The preservation call outcome is REAL, not assumed — a failed preserve must not report "evidence preserved".
    let preserved = false, preserveErr = null;
    try { const pr = provider.preserveOperationEvidence(handle); preserved = !!(pr && pr.preserved); } catch (e) { preserved = false; preserveErr = String(e && e.message).slice(0, 80); }
    const disposalStatus = preserved ? "not-disposed-evidence-preserved" : "not-disposed-evidence-preservation-failed";
    const opResidue = preserved ? ["operation-preserved"] : ["operation-preserved:PRESERVATION-FAILED"];
    const procCount = extraProc && extraProc.processCount != null ? extraProc.processCount : null;
    const oev = opEvidence.buildOperationEvidence(Object.assign({}, opBaseObj, { outcome: "EMERGENCY-STOP", terminationStatus: "TERMINATION-UNCONFIRMED", operationProcessCount: procCount, disposalStatus, residue: opResidue }));
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted: opBaseObj.operationHandleIdRedacted, reason, processCount: procCount, preserved }));
    const risks = ["operation termination " + reason + " — external-operation lock; owner resolution required"];
    if (!preserved) risks.push("operation-evidence PRESERVATION FAILED" + (preserveErr ? " (" + preserveErr + ")" : "") + " — forensic evidence may be incomplete");
    const envlp = out(emergency("EMERGENCY-STOP-REQUIRED", { emergencyReason: reason }), Object.assign({}, commonResult(false, true), { operationHandleType: opBaseObj.operationHandleType, operationHandleIdRedacted: opBaseObj.operationHandleIdRedacted, operationProcessCountObserved: procCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: oev.evidenceHash, operationDisposalStatus: disposalStatus, operationResidue: opResidue, outputExcerpt: output || "", processTerminationStatus: "EMERGENCY-STOP-REQUIRED", killConfirmed: false, residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace], risks, cancellationStatus: "unconfirmed" }));
    envlp.persistedEvidence = persistBundle(oev);
    return envlp;
  };

  // Termination proof + disposal (§10). Returns { emergency } or { ok, ...facts }.
  const proveTerminationAndDispose = (handle, killFirst) => {
    if (killFirst) { try { provider.terminateOperation(handle); } catch (e) { return { emergency: "termination-exception" }; } }
    let conf; try { conf = provider.confirmOperationTerminated(handle); } catch (e) { return { emergency: "confirmation-exception" }; }
    let procs; try { procs = provider.enumerateOperationProcesses(handle); } catch (e) { return { emergency: "enumeration-exception" }; }
    if (!Array.isArray(procs)) return { emergency: "malformed-enumeration", processCount: null };
    let st; try { st = provider.operationStatus(handle); } catch (e) { return { emergency: "operation-status-exception" }; }
    if (!st || (st.state !== "running" && st.state !== "exited")) return { emergency: "malformed-operation-status" };
    const confirmedTrue = !!conf && conf.confirmed === true;
    const enumCount = procs.length;
    if (!confirmedTrue) return { emergency: "termination-unconfirmed", processCount: (conf && conf.processCount != null) ? conf.processCount : enumCount };
    if (enumCount > 0) return { emergency: "termination-contradiction-processes-remain", processCount: enumCount }; // confirm=true but processes remain
    if (st.state !== "exited") return { emergency: "provider-status-not-terminal", processCount: enumCount };
    if (!handle || handle.operationId !== policy.operationId) return { emergency: "operation-handle-not-bound", processCount: enumCount };
    // Phase 5 satisfied (0 processes). Phase 7/8: dispose + verify.
    let descendants = []; try { descendants = provider.enumerateOperationProcesses(handle) || []; } catch (e) { descendants = []; }
    let disp; try { disp = provider.disposeOperation(handle); } catch (e) { disp = null; }
    const operationResidue = disp && Array.isArray(disp.residue) ? disp.residue : ["disposal-result-malformed"];
    const disposalOk = !!disp && disp.disposed === true && Array.isArray(disp.residue) && disp.residue.length === 0;
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted: handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null, processCount: 0, confirmed: true, providerEvidence: conf && conf.evidence }));
    return { ok: true, conf, descendants, disp, operationResidue, disposalOk, pcEvidenceHash, processCount: 0 };
  };

  const REFUSE_MAP = { "timeout": "timeout", "host-timeout": "timeout", "host-cancelled": "timeout", "output-overflow": "output-overflow", "stderr-overflow": "stderr-overflow", "worker-error": "worker-error", "provider-error": "worker-error", "spawn-error": "worker-error" };

  async function finalize(handle, o) {
    o = o || {};
    const handleType = handle && handle.handleType;
    let run, output = "";
    if (o.forceKillNoRun) { run = { exitStatus: null, killedFor: o.killedFor || "ownership-forced-kill" }; }
    else {
      // §11: race the provider wait against a host-timeout backstop; the backstop ABORTS the provider wait and
      // clears its own timer so no provider promise or timer survives finalisation.
      const ac = new AbortController(); let hostTimer = null;
      const hostTimeout = new Promise((rz) => { hostTimer = setTimeout(() => { try { ac.abort(); } catch (e) {} rz({ exitStatus: null, killedFor: "host-timeout" }); }, (policy.timeoutMs || 120000) + 2000); });
      try { run = await Promise.race([provider.waitForOperationExit(handle, { timeoutMs: policy.timeoutMs, maxOutputBytes: policy.maxOutputBytes, signal: ac.signal }), hostTimeout]); }
      catch (e) { run = { exitStatus: null, killedFor: "provider-error" }; }
      finally { if (hostTimer) clearTimeout(hostTimer); }
      if (run && run.killedFor === "host-timeout") { try { provider.terminateOperation(handle); } catch (e) {} }
      try { const raw = provider.readOperationOutput(handle, policy.maxOutputBytes); output = P.scrubSecrets(redactor.redactText(raw || "")).slice(0, 4000); } catch (e) { output = ""; }
    }
    const exitTs = Date.now();
    const killedFor = run && run.killedFor;
    const opBaseObj = opBaseFor(handle, exitTs, run && run.exitStatus);

    // §9/§10: terminate (if killed OR ownership-forced) + prove termination. Any exception / unconfirmed / a
    // confirm=true-but-processes-remain contradiction ⇒ EMERGENCY-STOP (never NOT EXECUTED, never plain BLOCKED).
    const t = proveTerminationAndDispose(handle, !!killedFor || !!o.forceKillNoRun);
    if (t.emergency) return emergencyStop(handle, t.emergency, opBaseObj, output, { processCount: t.processCount });

    const outcomeFor = (kind) => kind; // COMPLETED | FAILED | TERMINATED | BLOCKED
    const opFieldsFor = (outcome) => {
      const oev = opEvidence.buildOperationEvidence(Object.assign({}, opBaseObj, { outcome, terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, containedDescendants: t.descendants, disposalStatus: t.disposalOk ? "disposed" : "disposal-failed", residue: t.operationResidue }));
      return { oev, fields: { operationHandleType: handleType, operationHandleIdRedacted: opBaseObj.operationHandleIdRedacted, operationProcessCountObserved: 0, processControlEvidenceHash: t.pcEvidenceHash, operationEvidenceHash: oev.evidenceHash, operationDisposalStatus: t.disposalOk ? "disposed" : "disposal-failed", operationResidue: t.operationResidue } };
    };
    // Every non-success finaliser branch disposes the workspace HERE and escalates a leftover source tree to the
    // WORKSPACE-DISPOSAL-FAILED headline (unless the operation-disposal headline already dominates) — a source
    // tree left on disk is never buried under a plain REFUSED/BLOCKED on the killed/timeout/ownership paths.
    const done = (env, of, extra) => {
      const residue = disposeAll();
      const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
      const finalEnv = (realResidue.length && env.reason !== "OPERATION-DISPOSAL-FAILED") ? blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue, underlyingReason: env.reason }) : env;
      const e = out(finalEnv, Object.assign({}, commonResult(true, true), evFields(), of.fields, { residue }, extra || {}));
      e.persistedEvidence = persistBundle(of.oev);
      return e;
    };

    // Disposal failure is the HEADLINE on EVERY post-confirmation branch — a leftover operation is never buried.
    if (!t.disposalOk) return done(blocked("OPERATION-DISPOSAL-FAILED", { operationResidue: t.operationResidue }), opFieldsFor(o.forceKillNoRun ? "BLOCKED" : "TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Ownership rejection (real-run PID handle): confirmed-terminated + disposed safely, but BLOCKED.
    if (o.pidReject) return done(blocked("BLOCKED-PROCESS-OWNERSHIP", { reason2: "pid-handle-forbidden-for-real-runs" }), opFieldsFor("BLOCKED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Killed (but confirmed dead + disposed) ⇒ refuse.
    if (killedFor) { const reason = REFUSE_MAP[killedFor] || "worker-error"; return done(refused(reason), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", cancellationStatus: "confirmed", timeoutStatus: (killedFor === "timeout" || killedFor === "host-timeout" || killedFor === "host-cancelled") ? "killed" : "none", residualDriftStatus: "not-evaluated" }); }

    // Clean exit ⇒ trusted FS diff + path enforcement + monitored-state reconciliation. The operation is ALREADY
    // confirmed-terminated + disposed here; a post-execution ledger I/O error must fail closed as an ordinary
    // BLOCKED (workspace disposed by done()), NOT propagate to the outer catch and fabricate a false EMERGENCY.
    let wsAfter, led, manifest, patchHash;
    try { wsAfter = ledger.snapshot(workspace); led = ledger.diff(wsBefore, wsAfter); manifest = ledger.manifest(wsAfter, led); patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null; }
    catch (e) { return done(blocked("post-execution-ledger-failed", { detail: String(e.message).slice(0, 160) }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" }); }
    const refusedPaths = [];
    for (const p of led.changedPaths) { const norm = P.normPath(p); if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; } }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p);

    let after; try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); } catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED" }); }
    if (after.unverifiable > 0 || before.unverifiable > 0) return done(blocked("monitored-state-unverifiable", { unverifiable: after.unverifiable + before.unverifiable }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, ledgerSummary });
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary });

    // §8 phase 9: dispose the WORKSPACE and gate on it — a source tree left on disk must NOT be COMPLETED.
    const successOutcome = (run && run.exitStatus === 0) ? "COMPLETED" : "FAILED";
    const of = opFieldsFor(successOutcome);
    const residue = disposeAll();
    const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
    if (realResidue.length) { const e = out(blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue }), Object.assign({}, commonResult(true, true), of.fields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, residue })); e.persistedEvidence = persistBundle(of.oev); return e; }

    // §8 phase 10/11: verify the operation evidence before returning success.
    const oevOk = opEvidence.verifyOperationEvidence(of.oev, { operationId: policy.operationId, workspaceId, providerId: provider.providerId, executableContentHash: c.executableContentHash, argvHash: invocationArgvHash });
    if (!oevOk.ok) { const e = out(blocked("operation-evidence-invalid", { errors: oevOk.errors }), Object.assign({}, commonResult(true, true), of.fields, { residue })); e.persistedEvidence = persistBundle(of.oev); return e; }

    // Success.
    let res; try {
      res = P.buildResult(Object.assign({}, commonResult(true, true), of.fields, { operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, approvalStatus: policy.approvalId ? "referenced" : "none", toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: after.branch, finalHead: after.head, outcome: successOutcome, residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, processTerminationStatus: "TERMINATED-CONFIRMED", killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none", outputExcerpt: output, residue, workerDecision: successOutcome === "COMPLETED" ? "PROPOSED" : "FAILED" }));
    } catch (e) { const en = out(blocked("result-build-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, commonResult(true, true), { residue })); return en; }
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true, true), { residue }));
    const envlp = { ok: successOutcome === "COMPLETED", decision: successOutcome, output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
    envlp.persistedEvidence = persistBundle(of.oev);
    return envlp;
  }

  let handle = null;
  try {
    // Spawn via the provider-owned operation using the VERIFIED SANDBOX executable path (never the host path).
    try { handle = provider.spawnOperation({ bin: sandboxExePath, argv, cwd: workspace, env: P.buildMinimalEnv(process.platform, policy.envAllowlist), operationId: policy.operationId, preparedOperationId: prep.preparedOperationId }); }
    catch (e) { return postMat(blocked("operation-spawn-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({ processTerminationStatus: "NOT EXECUTED" }, evFields()), true); }
    // PID-handle rejection: teardown safely THROUGH the finaliser (terminate + confirm + dispose). Forbidden for
    // ANY non-mock provider (not only when realRun is set) — a bare, reusable OS PID can never own an operation.
    if (handle && handle.handleType === "pid" && (requireReal || provider.kind !== "mock")) return await finalize(handle, { forceKillNoRun: true, killedFor: "ownership-forced-kill", pidReject: true });
    return await finalize(handle);
  } catch (e) {
    // §9: an unexpected adapter exception once a handle exists is EMERGENCY-STOP (never NOT EXECUTED / plain BLOCKED).
    if (handle) return emergencyStop(handle, "unexpected-adapter-exception:" + String(e && e.message).slice(0, 80), opBaseFor(handle, Date.now(), null), "");
    return postMat(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({ processTerminationStatus: "NOT APPLICABLE" }, evFields()), true);
  } finally { if (!disposed && !preserve && !c.keepWorkspace) disposeAll(); }
}

module.exports = { runClaudeWorker, monitorSnapshot, monitorDrift, gitMetaDigest };

"use strict";
const MODULES = [
  "validate-no-secrets", "validate-project-config", "validate-phase-manifest",
  "validate-evidence-pack", "validate-forbidden-actions", "validate-examples",
  "validate-review-agents", "validate-ecc-routing",
  "validate-report-request", "validate-report-index", "validate-report-output", "validate-phase-reporter",
  "validate-staging-deploy-request", "validate-staging-deploy-guard", "validate-staging-deploy-output",
  "validate-proof-request", "validate-proof-plan", "validate-proof-output", "validate-proof-factory",
  "validate-drift-request", "validate-drift-snapshot", "validate-drift-output", "validate-drift-detector",
  "validate-ci-governance-policy", "validate-ci-workflow-template", "validate-ci-output", "validate-ci-governance",
  "validate-dashboard-config", "validate-dashboard-data", "validate-dashboard-output", "validate-dashboard-safety", "validate-dashboard",
  "validate-project-plan", "validate-current-project-state", "validate-active-execution-session",
  "validate-plan-ready-gate", "validate-plan-status", "validate-plan-version", "validate-plan-staleness", "validate-plan-no-secrets",
  "validate-plan-discovery-import",
  "validate-projectos-recovery-plan-authority1a",
  "validate-secret-broker",
  "validate-secret-operation-broker",
  "validate-session-launcher",
  "validate-desktop-bridge",
  "validate-e2e-runner",
  "validate-approval-queue",
  "validate-provider-context-guards",
  "validate-desktop-e2e",
  "validate-reliability-hardening",
  "validate-forge-blueprint",
  "validate-forge-scaffold",
  "validate-forge-provisioner",
  "validate-forge-generation",
  "validate-forge-verify",
  "validate-forge-snapshot",
  "validate-forge-deploy",
  "validate-forge-integrations",
  "validate-forge-e2e",
  "validate-shared-runtime-no-tauri",
  "validate-runtime-no-raw-string-events",
  "validate-windows-runtime-primitives-boundary",
  "validate-host-identity-boundary",
  "validate-host-authority-contract-boundary",
  "validate-host-authority-windows-boundary",
  "val-windows-service-identity-proof-3kideb",
  "val-windows-service-control-capability-b1",
  "val-windows-local-ipc-capability-b1",
  "val-windows-service-proof-runner-capability-b1",
  "val-windows-service-control-capability-b2",
  "val-host-authority-pipe-security-contract1a",
  "val-windows-local-ipc-capability-b3",
  "val-cd-b4-binding-consumer-surface1a",
  "val-windows-service-proof-runner-capability-b4",
  "val-cd-b4-effect-witness-contract1a",
  "val-cd-b4-elevation-observation-engine1a",
  "val-cd-b4-operation-phase-binding1a",
  "val-cd-b4-protected-plan-store1a",
  "val-cd-b4-protected-plan-reducer-permit1a",
  "val-cd-b4-plan-durable-store1a",
  "val-cd-b4-repository-baseline-adapter1a",
  "val-cd-b4-repository-authority-integration1a",
  "val-cd-b4-owner-presence-integration1a",
  "val-cd-b4-elevation-integration1a",
  "val-cd-b4-effect-grant-integration1a",
  "val-cd-b4-runtime-instance-authority1a",
  "val-cd-b4-ipc-session-authority1a",
  "val-cd-b4-runtime-ipc-permit-integration1a",
  "val-cd-b4-production-trusted-clock1a",
  "val-cd-b4-production-runtime-provider1a",
  "val-cd-b4-production-ipc-provider1a",
  "val-cd-b4-production-owner-presence-provider1a",
  "val-cd-b4-windows-user-verification-adapter1a",
  "val-cd-b4-control-centre-window-observation-bridge1a",
  "val-cd-b4-provider-authority-seam1a",
  "val-cd-b4-sealed-expected-window-facts1a",
  "val-cd-b4-owner-presence-capability-bridge1a",
  "val-cd-b4-host-authority-acquisition1a",
  "val-cd-b4-canonical-installation-identity1a",
  "val-cd-b4-host-authority-observer1a",
  "val-cd-b4-installer-canonical-identity-writer1a",
  "val-cd-b4-installer-id-source-closeout1b",
  "val-cd-b4-elevated-installer-composition1a",
  "val-cd-b4-installer-readiness1a",
  "val-cd-b4-projectoshost-service-runtime1a",
  "val-cd-b4-installed-host-status-contract1a",
  "val-cd-b4-record-file-acl-correction1a",
  "val-cd-b4-release-currentness1a",
  "val-projectoshost-build-provenance1a",
  "val-projectoshost-ipc-operation-contract1a",
  "val-projectoshost-ipc-peer-authentication1a",
  "val-projectoshost-ipc-kernel-peer-capture1a",
  "val-projectoshost-ipc-peer-contract-reconciliation1a",
  "val-projectoshost-configured-owner-enrolment-record1a",
  "val-projectos-packaged-runtime-contract1a",
  "val-projectos-release-workspace-freshness1a",
  "val-projectos-validator-scratch-lifecycle1a",
  "val-projectos-credential-vault1a",
  "val-projectos-session-router1a",
  "val-projectos-credential-router-adversarial1a",
  "val-projectos-v3-owner-presence-confirmation-ux1a",
  "val-projectos-v3-active-phase-consistency1a",
  "val-projectos-v3-webdriver-e2e-isolation1a",
  "val-projectos-v3-validation-evidence1a",
  "validate-zero-relay-continuity",
  "val-projectos-v3-zero-relay-failure-matrix1a",
  "validate-v3.1-crosswalk",
  "validate-v3.2-ai-provider-independence",
  "val-projectos-gatekeeper-contract1a",
  "val-projectos-trust-boundary1a",
  "val-projectos-provider-key-shapes1a",
  "val-projectos-file-inbox-inert1a",
  "val-projectos-live-worker-truth1a",
  "val-projectos-gate-decision-evidence1a",
  "val-projectos-portfolio-read-only1a",
  "val-projectos-work-record-not-authority1a",
  "val-projectos-worker-lifecycle-bounded1a",
  "val-projectos-live-gate-owner-floor1a",
  "val-projectos-technical-continuation1a",
  "val-projectos-closure-transport1a",
  // RUN-TO-COMPLETION HOST ATTESTATION §10I — first-start durable store custody.
  "val-host-store-custody-10i",
  "val-projectos-host-review-path1a",
  "val-projectos-host-review-path1b",
  "val-projectos-agent-workforce1a",
  // PROJECTOS-BOOT-CONTINUE1A — safe continuation across approved phases.
  "val-projectos-boot-continue1a",
  // ProjectOS Watchdog Core (merged from main).
  "val-watchdog-core1a",
  // PROJECTOS-KERNEL-HYGIENE1A — validators that existed in the tree but were never run here.
  "val-host-state-activation-wiring-10h",
  "validate-v2-closure-evidence",
  "validate-wsl2-provider",
  "val-projectos-kernel-role-review1a",
  "val-projectos-kernel-cost-cap1a",
  // PROJECTOS-KERNEL-PLATFORM-STOP1A — the platform emergency stop.
  "val-projectos-kernel-platform-stop1a",
  // PROJECTOS-KERNEL-FOLLOWUP1A — the registry pin and Codex reviewer rules; the cache validator once cached-runner was resynced.
  "val-projectos-kernel-followup1a",
  "validate-speed-validation-cache",
  // PROJECTOS-TENANT-CONTRACT1A — ADR-T1, the tenant and action registries, the pure envelope rules.
  "val-projectos-tenant-contract1a",
  // PROJECTOS-TENANT-RLS1A — the tenant boundary in the database, proved on a throwaway local cluster.
  "val-projectos-tenant-rls1a",
  // PROJECTOS-PORT-FOUNDATION1A — the credit rule: every file in a port directory is original or credited.
  "val-projectos-port-credit1a",
  // PROJECTOS-PORT-SEARCH1A — cited search: an uncited result is refused, indexed text stays data, no vectors yet.
  "val-projectos-port-search1a",
  // PROJECTOS-PORT-MEMORY1A — capped memory: every write a proposal the owner decides, scanned before a prompt.
  "val-projectos-port-memory1a",
  // PROJECTOS-PORT-APPROVALS1A — an approval bound to run, tool and arguments; taint; evidence receipts.
  "val-projectos-port-approvals1a",
  // PROJECTOS-TENANT-CSP1A — the strict Control Center CSP and narrowed window capability, proved in a real webview.
  "val-projectos-tenant-csp1a",
  // PROJECTOS-PORT-SKILLS1A — skill rules: an agent only proposes; a validator pass, an independent review and a hash pin promote.
  "val-projectos-port-skills1a",
  // PROJECTOS-PORT-CONTEXT1A — context accounting and compaction: decisions kept, source text stays untrusted.
  "val-projectos-port-context1a",
  // PROJECTOS-TENANT-PRINCIPAL1A — the tenant read from committed bytes and minted at real crossings.
  "val-projectos-tenant-principal1a",
  // PROJECTOS-TENANT-CREDENTIALS1A — a requester is a kernel-issued run handle; tenant and platform classes; reach; bound mutators.
  "val-projectos-tenant-credentials1a",
  // PROJECTOS-PORT-ROUTINES1A — routine floors: 15-minute minimum, 20 enabled, off after 10 failures, P2 ceiling unattended, one key per occurrence.
  "val-projectos-port-routines1a",
  // PROJECTOS-PORT-PROVIDERS1A — the model broker: a budget on every call, a backoff floor, committed prices, a closed registry, loopback only.
  "val-projectos-port-providers1a",
  // PROJECTOS-PORT-MCP1A — governed MCP connectors: a server pinned by hash, sampling off, elicitation to the owner, per-tool spend, output untrusted; zero live connectors.
  "val-projectos-port-mcp1a",
  // PROJECTOS-PORT-AGENTS1A — agent records, same-tenant routes and messages, delegation never past the parent, queue-state rules, and no second queue.
  "val-projectos-port-agents1a",
  // PROJECTOS-PORT-RESEARCH1A — cited research: an SSRF guard on every fetch, a budget on every paid search, a step cap, no uncited answer.
  "val-projectos-port-research1a",
  // PROJECTOS-PORT-COMPUTER1A - exec grants bound to argv, cwd and hash; exact allowlists; a typed default-deny action policy; no child_process; browser and computer use refuse until Stage 4.3.
  "val-projectos-port-computer1a",
  // PROJECTOS-WORKER-CODEX-IMPLEMENTER1A - a Codex implementer kind so implementer and reviewer providers swap by configuration: the one workspace-write sandbox the adapter sets, nothing widens it, write scope judged on the candidate before and after the run (Codex has no per-path grant), no credential in or out, never reviews or resumes, bounded, nothing in the loop depends on VS Code.
  "val-projectos-worker-codex-implementer1a",
  // PROJECTOS-MEMORY-OWNER-COMMANDS1A - the owner commands for memory: a typed terminal confirmation bound to the item, hash, tenant and project; no decision without a terminal; no deletion of a cited item; the deletion ledger before the removal; the index written only under the installation state; the project from the registry, never an argument; stored text fenced.
  "val-projectos-memory-owner-commands1a",
  // PROJECTOS-MEMORY-STORES1A - the six memory classes on existing stores; one index file per tenant and project; an injected clock and file system; no credential, over-cap body or hidden text reaches a prompt; one proposal door; a worker's direct write to the memory or skill store is refused.
  "val-projectos-memory-stores1a",
  // PROJECTOS-MEMORY-PROVENANCE1A - committed decisions outrank recollection; decisions, plan memory and approved memory are read from committed bytes and a differing working copy is refused; a citation from an index built before HEAD is marked stale; retention per class; deleting approved memory is the P5 action memory-delete, owner only, and every deletion is recorded.
  "val-projectos-memory-provenance1a",
  // PROJECTOS-CONTEXT-MANAGER1A - retrieval is keyed on the admitted run envelope and recorded in a loop-written ledger; stored text reaches the worker only as a fenced, scanned, capped file named by the brief and gone before the checks; approved decisions are always loaded; compaction is deterministic and stops on overLimit; the evidence names what the worker was shown; run.ts changes by exactly one option.
  "val-projectos-context-manager1a",
  // PROJECTOS-SKILLS-ADOPT1A — the kernel sets a skill's origin; promotion needs the skill validator, an independent review that a verifier vouched for and a hash pin; the loader adds only committed, pinned, unchanged skills to the context file, as fenced data after every decision; nothing in a skill is run; the bounded-repeat evasions are closed.
  "val-projectos-skills-adopt1a",
  // PROJECTOS-RESUME1A - a new worker continues a half-done phase from retrieved state: the work record read for four closed fields; earlier findings and evidence labelled worker-authored and ranked below every decision; the dirty paths and hashes the loop observed, a path outside the phase write paths refusing the run; evidence marked stale after HEAD moves; the work record stays non-authority.
  "val-projectos-resume1a",
  // PROJECTOS-CONNECTOR-CONTRACT1A — the connector rules with no connector: registry, release gate, receipt, error vocabulary.
  "val-projectos-connector-contract1a",
  // PROJECTOS-MEMORY-EXIT-PROOF1A - the Stage 3 exit proof over the recorded live run: a cut-off phase resumed by one fresh continue, the retrieval ledger, worker text never ranked as a decision, spend under the cap; a manifest pins every evidence file.
  "val-projectos-memory-exit-proof1a"
];

// RETIRED: validator files that are deliberately NOT run by this suite, each with its recorded reason.
// Every `val-*.cjs` / `validate-*.cjs` file in this directory must be in MODULES or here — the registry
// check below fails the suite otherwise, so a new validator cannot silently go unrun. Retiring one
// never weakens it: the file and its rules stay as they are, and it can still be run directly.
const RETIRED = [
  { name: "val-watchdog-conformance",
    reason: "Per-product tool: requires --target <product checkout> and checks that product's vendored " +
      "watchdog core, not this repository; run() without a target returns an error by design. Run it " +
      "with `npm run watchdog:conformance -- --target <checkout>`." },
  { name: "validate-claude-worker",
    reason: "Opt-in owner-machine security evidence: its own header says it is NOT part of `npm run validate`, " +
      "which is this suite. Its run() is async, and this synchronous runner (and cached-runner) cannot await " +
      "it: a Promise would read as a vacuous PASS, so it is reported as a CRASH instead. It PASSES standalone " +
      "(55 invariants) since PROJECTOS-KERNEL-FOLLOWUP1A repaired inv50 (scratch-owned repos under the OS " +
      "tmpdir, after 1d25cc8) and inv27 (timed against the backstop, not this machine's git speed). Run it " +
      "with `node projectos/validators/validate-claude-worker.cjs`." },
];

const scratch = require("./lib/scratch.cjs");
const validationRecord = require("./lib/validation-record.cjs");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

// Registry completeness: every validator file is either registered or retired with a reason, never both
// and never neither. Engines (`plan-*-engine.cjs`) and `lib/` are not validators and do not match.
function registryProblems() {
  const problems = [];
  const files = fs.readdirSync(__dirname)
    .filter((f) => /^(val|validate)-.+\.cjs$/.test(f) && f !== "validate-all.cjs")
    .map((f) => f.slice(0, -".cjs".length));
  const retiredNames = RETIRED.map((r) => r.name);
  if (new Set(MODULES).size !== MODULES.length) problems.push("MODULES lists a validator more than once");
  for (const f of files) {
    if (!MODULES.includes(f) && !retiredNames.includes(f)) problems.push(f + " is neither registered nor retired");
  }
  for (const r of RETIRED) {
    if (MODULES.includes(r.name)) problems.push(r.name + " is both registered and retired");
    if (!files.includes(r.name)) problems.push(r.name + " is retired but no such validator file exists");
    if (typeof r.reason !== "string" || r.reason.trim().length < 20) problems.push(r.name + " is retired without a real reason");
  }
  return problems;
}
const REGISTRY_PROBLEMS = registryProblems();

// Opt-in evidence production. The default run is unchanged — developers run this suite constantly on
// dirty trees, and writing a tracked record every time would be residue. `--record-evidence` is what
// the closure workflow uses at the evidence subject commit.
const RECORD_EVIDENCE = process.argv.slice(2).includes("--record-evidence");

// REGISTERED MODULE COUNT vs the AGGREGATE COMMAND. These are different numbers and have been
// conflated in prose before ("124/124" for a 123-module registry). The registry length is the only
// module count; `validate-all` itself is the wrapper and is never a module.
const REGISTERED_MODULE_COUNT = MODULES.length;

const results = [];
let total = 0;
for (const m of MODULES) {
  let errs;
  // Release this validator's scratch as soon as it finishes — on pass, fail or crash. Without this,
  // every validator's directory stays alive until process exit and peak disk is the whole suite at once.
  // A result that is not an array (an async run() returns a Promise) is a CRASH, never a silent PASS.
  try {
    errs = require("./" + m + ".cjs").run();
    if (!Array.isArray(errs)) throw new Error("run() did not return an array of errors (async or malformed validator)");
  }
  catch (e) {
    console.error("[" + m + "] CRASH: " + e.message);
    total += 1; scratch.cleanupAll();
    // A crash is a FAILING result, never a missing one: an absent entry would read as "not required".
    results.push({ name: m, passed: false, errorCount: 1 });
    continue;
  }
  finally { scratch.cleanupAll(); }
  if (errs.length) { errs.forEach(x => console.error("[" + m + "] FAIL: " + x)); total += errs.length; }
  else console.log("[" + m + "] PASS");
  results.push({ name: m, passed: errs.length === 0, errorCount: errs.length });
}

// The registry is not a module, so its failure is not a result entry; it fails the run and withholds
// the evidence record, which would otherwise read as passed while the run exits non-zero.
REGISTRY_PROBLEMS.forEach((p) => console.error("[validate-all registry] FAIL: " + p));
total += REGISTRY_PROBLEMS.length;

if (RECORD_EVIDENCE) {
  if (REGISTRY_PROBLEMS.length) {
    console.error("validate-all: evidence NOT recorded — the validator registry is incomplete");
  } else {
    const w = validationRecord.writeRecord(ROOT, results, REGISTERED_MODULE_COUNT, new Date().toISOString());
    if (w.written) console.log("validate-all: evidence recorded at " + path.relative(ROOT, w.path).replace(/\\/g, "/"));
    else console.error("validate-all: evidence NOT recorded — " + w.reason);
  }
}

console.log(
  "validate-all: " + REGISTERED_MODULE_COUNT + " registered module(s), " +
  results.filter((r) => r.passed).length + " PASS, " + results.filter((r) => !r.passed).length + " FAIL, " +
  RETIRED.length + " retired"
);
if (total) { console.error("validate-all: " + total + " error(s)"); process.exit(1); }
console.log("validate-all: ALL PASS");
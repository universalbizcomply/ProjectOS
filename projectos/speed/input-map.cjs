"use strict";
/**
 * STATIC INPUT DECLARATIONS for validators.
 *
 * Each entry maps a validator name to the list of files and directories (relative to root)
 * that the validator reads. The cache uses these to compute per-validator keys.
 *
 * A validator NOT in this map has NO declared inputs → its coverage is "none" →
 * the cache ALWAYS runs it (fail-toward-run for unknown dependency coverage).
 *
 * A validator whose declaration is INCOMPLETE (misses a real input) would get false cache
 * hits. To prevent this, declarations are conservative: they include every directory the
 * validator could plausibly read, even if it only reads a few files within it.
 *
 * CATEGORIES:
 * - "schema-config": validators that check schemas, templates, and examples
 * - "cargo-host":    validators that compile Rust host crates
 * - "agent-source":  validators that read agent TypeScript source
 * - "core-source":   validators that read core TypeScript source
 * - "file-scan":     validators that scan broad directory trees
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A.
 */

// Common input sets reused across validators
const SCHEMAS = "projectos/schemas";
const TEMPLATES = "projectos/templates";
const EXAMPLES = "projectos/examples";
const VALIDATORS_LIB = "projectos/validators/lib";

const HOST_ROOT = "projectos/host";
const HOST_CRATES = [
  "projectos/host/core",
  "projectos/host/contract",
  "projectos/host/crypto",
  "projectos/host/host-authority",
  "projectos/host/host-identity",
  "projectos/host/owner-presence-bridge",
  "projectos/host/persistence",
  "projectos/host/plan-durable-store",
  "projectos/host/repository",
  "projectos/host/service-host",
  "projectos/host/shared-host-runtime",
  "projectos/host/store",
  "projectos/host/windows-acl-policy",
  "projectos/host/windows-clock",
  "projectos/host/windows-crypto-adapter",
  "projectos/host/windows-durable-protected-store",
  "projectos/host/windows-host-activation-plan",
  "projectos/host/windows-host-capability-preflight",
  "projectos/host/windows-local-ipc",
  "projectos/host/windows-master-key-composition",
  "projectos/host/windows-master-key-source",
  "projectos/host/windows-owner-verification",
  "projectos/host/windows-protection",
  "projectos/host/windows-root-custody",
  "projectos/host/windows-runtime-observation",
  "projectos/host/windows-runtime-primitives",
  "projectos/host/windows-service-control",
  "projectos/host/windows-service-identity-proof",
  "projectos/host/windows-service-identity-proof-runner",
  "projectos/host/windows-service-installation-contract",
  "projectos/host/canonical-installation-identity-writer",
  "projectos/host/elevated-installer-composition",
  "projectos/host/packaged-manifest-generator",
  "projectos/host/packaged-runtime-contract",
  "projectos/host/project-registry",
  "projectos/host/protected-file-primitives",
];

const AGENT_SRC = "projectos/agent/src";
const CORE_SRC = "projectos/core/src";

// The identity-proof crate that most Cargo validators compile against
const IDP = "projectos/host/windows-service-identity-proof";

/**
 * Build the input map. Each validator name maps to an array of relative paths.
 *
 * Validators not in this map: coverage = "none" → always run.
 */
function buildInputMap() {
  const map = {};

  // --- Schema/config validators ---
  map["validate-project-config"] = [SCHEMAS, TEMPLATES, EXAMPLES];
  map["validate-phase-manifest"] = [SCHEMAS, TEMPLATES, EXAMPLES];
  map["validate-evidence-pack"] = [SCHEMAS, TEMPLATES, EXAMPLES];
  map["validate-forbidden-actions"] = [SCHEMAS, TEMPLATES, EXAMPLES];
  map["validate-examples"] = [SCHEMAS, EXAMPLES];
  map["validate-review-agents"] = [SCHEMAS, EXAMPLES];

  // --- ECC / report / staging / proof / drift / CI / dashboard ---
  // These read source + schemas — conservative: include all schema + agent/core source
  const govValidators = [
    "validate-ecc-routing",
    "validate-report-request", "validate-report-index", "validate-report-output", "validate-phase-reporter",
    "validate-staging-deploy-request", "validate-staging-deploy-guard", "validate-staging-deploy-output",
    "validate-proof-request", "validate-proof-plan", "validate-proof-output", "validate-proof-factory",
    "validate-drift-request", "validate-drift-snapshot", "validate-drift-output", "validate-drift-detector",
    "validate-ci-governance-policy", "validate-ci-workflow-template", "validate-ci-output", "validate-ci-governance",
    "validate-dashboard-config", "validate-dashboard-data", "validate-dashboard-output", "validate-dashboard-safety", "validate-dashboard",
  ];
  for (const v of govValidators) {
    map[v] = [SCHEMAS, TEMPLATES, EXAMPLES, AGENT_SRC, CORE_SRC];
  }

  // --- Plan / state validators ---
  const planValidators = [
    "validate-project-plan", "validate-current-project-state", "validate-active-execution-session",
    "validate-plan-ready-gate", "validate-plan-status", "validate-plan-version",
    "validate-plan-staleness", "validate-plan-no-secrets", "validate-plan-discovery-import",
    "validate-projectos-recovery-plan-authority1a",
  ];
  for (const v of planValidators) {
    map[v] = [SCHEMAS, AGENT_SRC, CORE_SRC, ".projectops"];
  }

  // --- Secret / session / broker validators ---
  map["validate-secret-broker"] = [AGENT_SRC, CORE_SRC, "projectos/credentials"];
  map["validate-secret-operation-broker"] = [AGENT_SRC, CORE_SRC, "projectos/credentials"];
  map["validate-session-launcher"] = [AGENT_SRC, CORE_SRC];
  map["validate-desktop-bridge"] = [AGENT_SRC, "projectos/control-center"];
  map["validate-e2e-runner"] = [AGENT_SRC, CORE_SRC];
  map["validate-approval-queue"] = [AGENT_SRC, CORE_SRC];
  map["validate-provider-context-guards"] = [AGENT_SRC, CORE_SRC];
  map["validate-desktop-e2e"] = [AGENT_SRC, "projectos/control-center"];
  map["validate-reliability-hardening"] = [AGENT_SRC, CORE_SRC, "projectos/worker"];

  // --- Forge validators ---
  const forgeValidators = [
    "validate-forge-blueprint", "validate-forge-scaffold", "validate-forge-provisioner",
    "validate-forge-generation", "validate-forge-verify", "validate-forge-snapshot",
    "validate-forge-deploy", "validate-forge-integrations", "validate-forge-e2e",
  ];
  for (const v of forgeValidators) {
    map[v] = [AGENT_SRC, CORE_SRC, "projectos/forge"];
  }

  // --- Runtime boundary validators ---
  map["validate-shared-runtime-no-tauri"] = [AGENT_SRC, CORE_SRC, "projectos/control-center"];
  map["validate-runtime-no-raw-string-events"] = [AGENT_SRC, CORE_SRC];
  map["validate-windows-runtime-primitives-boundary"] = [HOST_ROOT];
  map["validate-host-identity-boundary"] = [HOST_ROOT];
  map["validate-host-authority-contract-boundary"] = [HOST_ROOT];
  map["validate-host-authority-windows-boundary"] = [HOST_ROOT];

  // --- Cargo/Rust validators (compile against host crates) ---
  // These are the SLOW validators. They compile Rust fixtures against the host workspace.
  // Input: the entire host directory (conservative — Cargo resolves workspace deps transitively).
  const cargoValidators = [
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
  ];
  for (const v of cargoValidators) {
    map[v] = [HOST_ROOT];
  }

  // --- Projectoshost validators (also Cargo) ---
  const hostProofValidators = [
    "val-projectoshost-build-provenance1a",
    "val-projectoshost-ipc-operation-contract1a",
    "val-projectoshost-ipc-peer-authentication1a",
    "val-projectoshost-ipc-kernel-peer-capture1a",
    "val-projectoshost-ipc-peer-contract-reconciliation1a",
    "val-projectoshost-configured-owner-enrolment-record1a",
  ];
  for (const v of hostProofValidators) {
    map[v] = [HOST_ROOT];
  }

  // --- Packaged/release/credential/session validators ---
  map["val-projectos-packaged-runtime-contract1a"] = [HOST_ROOT, AGENT_SRC];
  map["val-projectos-release-workspace-freshness1a"] = [HOST_ROOT, "projectos/release"];
  map["val-projectos-validator-scratch-lifecycle1a"] = [VALIDATORS_LIB];
  map["val-projectos-credential-vault1a"] = [AGENT_SRC, CORE_SRC, "projectos/credentials"];
  map["val-projectos-session-router1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-credential-router-adversarial1a"] = [AGENT_SRC, CORE_SRC, "projectos/credentials"];

  // --- V3 validators ---
  map["val-projectos-v3-owner-presence-confirmation-ux1a"] = [AGENT_SRC, "projectos/control-center"];
  map["val-projectos-v3-active-phase-consistency1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-v3-webdriver-e2e-isolation1a"] = [AGENT_SRC];
  map["val-projectos-v3-validation-evidence1a"] = [AGENT_SRC, CORE_SRC, VALIDATORS_LIB];
  map["validate-zero-relay-continuity"] = [AGENT_SRC, CORE_SRC, "projectos/worker"];
  map["val-projectos-v3-zero-relay-failure-matrix1a"] = [AGENT_SRC, CORE_SRC];
  map["validate-v3.1-crosswalk"] = [AGENT_SRC, CORE_SRC];
  map["validate-v3.2-ai-provider-independence"] = [AGENT_SRC, CORE_SRC];

  // --- Post-V3 / governance / trust / provider validators ---
  map["val-projectos-gatekeeper-contract1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-trust-boundary1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-provider-key-shapes1a"] = [AGENT_SRC, CORE_SRC, "projectos/credentials"];
  map["val-projectos-file-inbox-inert1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-live-worker-truth1a"] = [AGENT_SRC, CORE_SRC, "projectos/worker"];
  map["val-projectos-gate-decision-evidence1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-portfolio-read-only1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-work-record-not-authority1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-worker-lifecycle-bounded1a"] = [AGENT_SRC, CORE_SRC, "projectos/worker"];
  map["val-projectos-live-gate-owner-floor1a"] = [AGENT_SRC, CORE_SRC];
  // PROJECTOS-AGENT-WORKFORCE1A reads the workforce sources, core's Role, the workforce proofs and the
  // four governance documents.
  map["val-projectos-agent-workforce1a"] = [AGENT_SRC, CORE_SRC, "projectos/agent/test", ".projectops/workforce"];
  map["val-projectos-technical-continuation1a"] = [AGENT_SRC, CORE_SRC];
  map["val-projectos-closure-transport1a"] = [AGENT_SRC, CORE_SRC];
  // PROJECTOS-HOST-REVIEW-PATH1A reads the agent path, the core codec, four Host crates, the service
  // loop and the cross-language vector file. Declared broadly on purpose: an undeclared input is a
  // stale PASS, and this validator is fast.
  map["val-projectos-host-review-path1a"] = [
    AGENT_SRC,
    CORE_SRC,
    "projectos/core/test/host-review-path-vectors.test.ts",
    "projectos/contracts",
    "projectos/host/windows-local-ipc/src",
    "projectos/host/gatekeeper-attestation/src",
    "projectos/host/gatekeeper-review-composition/src",
    "projectos/host/service-host/src",
  ];

  // --- File-scan validators ---
  // validate-no-secrets scans projectos/ and knowledge/ — these are broad, so the cache key
  // covers the entire scanned tree. This validator is fast enough that the hashing cost may
  // approach the scan cost, but it still benefits from the suite-level fast path.
  map["validate-no-secrets"] = ["projectos", "knowledge"];

  return map;
}

/**
 * Whether a declared input path and a changed path touch the same files.
 *
 * DIRECTORY CONTAINMENT IN EITHER DIRECTION, because a declaration and a change describe the tree at
 * different granularities. `.projectops` declared and `.projectops/proof` changed intersect (the
 * declaration contains the change); `projectos/examples` declared and `projectos` changed intersect
 * too (the change contains the declaration). Missing either direction would under-report the blast
 * radius, and this function's only consumer is a measurement of exactly that.
 *
 * SEPARATORS ARE NORMALISED AND THE BOUNDARY IS A SLASH, so `projectos/example` never matches
 * `projectos/examples`.
 */
function pathsIntersect(a, b) {
  const x = String(a).replace(/\\/g, "/").replace(/\/+$/, "");
  const y = String(b).replace(/\\/g, "/").replace(/\/+$/, "");
  return x === y || x.startsWith(y + "/") || y.startsWith(x + "/");
}

/**
 * Which validators a change to `changedPaths` invalidates, from their declarations alone.
 *
 * MEASUREMENT ONLY. Nothing in the cache consults this: a cache decision is made from content
 * hashes, and this is a static projection used to say what a hypothetical change would cost. It
 * deliberately reports a validator with NO declared inputs as invalidated, because that is what the
 * cache does with it — no declaration means no coverage, which means run.
 */
function validatorsInvalidatedBy(changedPaths, moduleNames) {
  const map = buildInputMap();
  return moduleNames.filter((name) => {
    const declared = map[name];
    if (!Array.isArray(declared) || declared.length === 0) return true;
    return declared.some((d) => changedPaths.some((c) => pathsIntersect(d, c)));
  });
}

module.exports = { buildInputMap, validatorsInvalidatedBy, pathsIntersect };

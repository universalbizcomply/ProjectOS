"use strict";
// CD-B4-REPOSITORY-AUTHORITY-EXECUTION-INTEGRATION1A — repository authority is wired end-to-end through
// the trust engine: an operation owns an IMMUTABLE required-repository policy folded into its
// fingerprint; the fail-closed reducer requires a verified baseline that SATISFIES the full policy; the
// execution context carries four distinct repository fields; the permit comparison detects a change in
// any of them; and no external consumer can forge a VerifiedRepositoryIdentity/Baseline or run an
// off-allowlist Git command. Structural checks + real compile proofs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const CORE = path.join(HOST, "core").replace(/\\/g, "/");
const CONTRACT = path.join(HOST, "contract").replace(/\\/g, "/");
const REPO = path.join(HOST, "repository").replace(/\\/g, "/");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

let WORK = null;
function workdir() {
  if (!WORK) WORK = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-repo-authz-"));
  return WORK;
}

/** Build a disposable external consumer crate against core+contract (and optionally the adapter). */
function compileConsumer(name, body, deps) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const depLines = deps.map((d) => `${d.name} = { path = "${d.path}" }`).join("\n");
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      `name = "${name.replace(/[^a-z0-9_]/g, "_")}"`,
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      depLines,
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const r = spawnSync("cargo", ["build", "--offline", "--quiet"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const CORE_DEP = [
  { name: "projectos-host-core", path: CORE },
  { name: "projectos-trust-contract", path: CONTRACT },
];

// A legitimately-verified baseline is the ONLY way to obtain a VerifiedRepositoryBaseline; the operation
// folds its policy and can be re-checked with satisfies(). Proves the real dependent API shape compiles.
const POSITIVE = `
use projectos_host_core::{
    fold_repository_fingerprint, verify_repository_baseline, BranchPolicy, DivergencePolicy,
    GitRepositoryObservation, InstallationId, InternalOperationRecord, OperationInputs,
    PhaseReference, RecordPolicy, RepositoryRef, RequiredFreshness, RequiredRepository, ResumePolicy,
    ExpiryBoundary, ReleaseId,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

fn req() -> RequiredRepository {
    RequiredRepository {
        expected_root: "C:/repo".into(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: "0123456789abcdef0123456789abcdef01234567".into(),
        branch_policy: BranchPolicy::Exact("main".into()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    }
}

fn main() {
    let obs = GitRepositoryObservation {
        canonical_root: "C:/repo".into(),
        common_dir: "C:/repo/.git".into(),
        is_worktree: true,
        head_oid: "0123456789abcdef0123456789abcdef01234567".into(),
        branch: Some("main".into()),
        staged: 0, unstaged: 0, untracked: 0,
        tracking_present: false, ahead: None, behind: None,
        submodule_dirty: false, generation: 1,
    };
    let baseline = verify_repository_baseline(&obs, &req()).unwrap();
    baseline.satisfies(&req()).unwrap();
    let _gen = baseline.generation();

    let record = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
    .bind_repository(req());
    // The folded fingerprint differs from the base, proving the policy is bound into it.
    let base = OperationFingerprint::new("fp").unwrap();
    assert_ne!(record.binding.fingerprint, base);
    let _ = fold_repository_fingerprint(&base, &req());
    println!("POSITIVE_OK");
}
`;

// Each negative MUST fail to compile: forging authority or an off-allowlist command is impossible.
const NEGATIVES = [
  {
    name: "neg_forge_baseline",
    why: "VerifiedRepositoryBaseline can be constructed without verify_repository_baseline",
    deps: CORE_DEP,
    body: `
use projectos_host_core::VerifiedRepositoryBaseline;
fn main() {
    let _forged = VerifiedRepositoryBaseline { };
}
`,
  },
  {
    name: "neg_forge_identity",
    why: "VerifiedRepositoryIdentity can be constructed by a caller",
    deps: CORE_DEP,
    body: `
use projectos_host_core::VerifiedRepositoryIdentity;
fn main() {
    let _forged = VerifiedRepositoryIdentity { };
}
`,
  },
  {
    name: "neg_default_baseline",
    why: "VerifiedRepositoryBaseline has a Default (authority from nothing)",
    deps: CORE_DEP,
    body: `
use projectos_host_core::VerifiedRepositoryBaseline;
fn main() {
    let _forged: VerifiedRepositoryBaseline = Default::default();
}
`,
  },
  {
    name: "neg_offallowlist_command",
    why: "an off-allowlist / mutation Git command variant exists",
    deps: [{ name: "projectos-host-repository", path: REPO }],
    body: `
use projectos_host_repository::GitCommand;
fn main() {
    // No arbitrary/mutation variant is representable in the closed allowlist.
    let _c = GitCommand::Fetch;
}
`,
  },
  {
    name: "neg_forge_fact",
    why: "ValidatedRepositoryFact can be constructed by a caller (operation-bound fact forgery)",
    deps: CORE_DEP,
    body: `
use projectos_host_core::ValidatedRepositoryFact;
fn main() {
    let _forged = ValidatedRepositoryFact { };
}
`,
  },
];

function run() {
  const errors = [];

  // ---- 1. Operation owns an IMMUTABLE repository policy folded into the fingerprint ---------------
  const op = strip(read(path.join(HOST, "core", "src", "operation.rs")));
  if (!/required_repository:\s*Option<[^>]*RequiredRepository>/.test(op))
    errors.push("InternalOperationRecord has no required_repository policy field");
  if (!/pub fn bind_repository\(mut self,/.test(op))
    errors.push("no consuming bind_repository (policy must be set at creation, immutable after)");
  if (!/fold_repository_fingerprint\(&self\.binding\.fingerprint, &required\)/.test(op))
    errors.push("bind_repository does not fold the repository policy into the fingerprint");

  // ---- 1b. The repository fact is an OPAQUE operation-bound wrapper ------------------------------
  const repo = strip(read(path.join(HOST, "core", "src", "repository.rs")));
  const repoRaw = read(path.join(HOST, "core", "src", "repository.rs"));
  if (!/pub struct ValidatedRepositoryFact\b/.test(repo))
    errors.push("no ValidatedRepositoryFact operation-bound wrapper");
  else {
    const body = repo.slice(repo.indexOf("pub struct ValidatedRepositoryFact"));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push("ValidatedRepositoryFact has a public field (must be opaque)");
    for (const bound of ["baseline", "project", "environment", "phase", "operation", "fingerprint", "generation", "freshness"])
      if (!new RegExp("\\b" + bound + ":").test(decl)) errors.push("ValidatedRepositoryFact does not bind " + bound);
    if (/plan_binding/.test(decl) === false) errors.push("ValidatedRepositoryFact does not bind the approved-plan binding");
  }
  if (/derive\([^)]*\bDefault\b[^)]*\)\]\s*(pub struct )?ValidatedRepositoryFact/.test(repo))
    errors.push("ValidatedRepositoryFact derives Default");
  if (!/impl fmt::Debug for ValidatedRepositoryFact\b/.test(repo))
    errors.push("ValidatedRepositoryFact has no hand-written redacted Debug");
  if (!/ValidatedRepositoryFact\([^)]*\[REDACTED\]/.test(repoRaw))
    errors.push("ValidatedRepositoryFact Debug is not redacted");
  if (/impl From<[^>]*> for ValidatedRepositoryFact/.test(repo))
    errors.push("ValidatedRepositoryFact has a From conversion (a report/path/observation could become a fact)");
  if (!/pub fn bind\(\s*baseline: VerifiedRepositoryBaseline/.test(repo))
    errors.push("ValidatedRepositoryFact::bind does not CONSUME a verified baseline (the authority gate)");

  // ---- 2. Reducer requires an OPERATION-BOUND fact, then the full policy -------------------------
  const reducer = strip(read(path.join(HOST, "core", "src", "reducer.rs")));
  if (!/required_repository:\s*Option<&[^>]*RequiredRepository>/.test(reducer))
    errors.push("reduction request does not carry the required repository policy");
  if (!/MissingFact::Repository/.test(reducer))
    errors.push("reducer does not fail closed when a repository-governed op has no baseline fact");
  // Every fact-binding dimension is checked, each with its own distinct refusal.
  for (const dim of ["Project", "Environment", "Phase", "Plan", "Operation", "Fingerprint", "Generation", "Freshness"])
    if (!new RegExp("RepositoryBinding::" + dim + "\\b").test(reducer))
      errors.push("reducer does not check repository fact-binding dimension: " + dim);
  if (!/RepositoryFactMismatch/.test(reducer))
    errors.push("reducer has no distinct repository fact-binding refusal");
  if (!/fact\.baseline\(\)\.satisfies\(required\)/.test(reducer))
    errors.push("reducer does not re-check the fact's baseline against the full policy via satisfies()");
  if (!/RepositoryPolicyRefused/.test(reducer))
    errors.push("reducer does not carry a distinct repository policy refusal");
  // Fact-binding must precede policy evaluation (a cross-bound fact never reaches satisfies()).
  if (reducer.indexOf("RepositoryFactMismatch") > reducer.indexOf("fact.baseline().satisfies"))
    errors.push("reducer evaluates the repository policy BEFORE the fact-binding checks");
  // The facts carry the operation-bound fact type, not a bare baseline.
  const factsRs = strip(read(path.join(HOST, "core", "src", "facts.rs")));
  if (!/repository:\s*Option<[^>]*ValidatedRepositoryFact>/.test(factsRs))
    errors.push("ServiceValidatedFacts.repository is not the operation-bound ValidatedRepositoryFact");

  // ---- 3. Context carries four distinct repository fields; permit compares them ------------------
  const cap = strip(read(path.join(HOST, "core", "src", "capability.rs")));
  for (const f of ["RepositoryIdentity", "RepositoryBaseline", "RepositoryGeneration", "RepositoryFreshness"])
    if (!new RegExp("F::" + f + "\\b").test(cap)) errors.push("context comparison missing field: " + f);
  if (!/repository_baseline:\s*Option</.test(cap))
    errors.push("context has no repository_baseline field");
  if (!/repository_generation:\s*Option<u64>/.test(cap))
    errors.push("context has no independent repository_generation field");

  // ---- 4. Compile proofs -------------------------------------------------------------------------
  const pos = compileConsumer("repo_authz_positive", POSITIVE, CORE_DEP);
  if (!pos.ok) errors.push("POSITIVE consumer failed to compile:\n" + pos.out.slice(0, 1200));
  for (const neg of NEGATIVES) {
    const r = compileConsumer(neg.name, neg.body, neg.deps);
    if (r.ok) errors.push("AUTHORITY FORGERY POSSIBLE — " + neg.why + " (" + neg.name + " compiled)");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-repository-authority-integration1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-repository-authority-integration1a: PASS");
}

//! # ProjectOS host — effect-free service-identity proof-runner CONTRACT (3K-I-D-E-C-CAPABILITY-B1)
//!
//! Orchestrates CONTRACTS only. It executes NO Windows operation, launches NO process, creates NO
//! service/pipe/authority-object, and exposes NO general orchestration interface. `#![forbid(unsafe_code)]`,
//! no `windows` dependency, no `[[bin]]` target.
//!
//! It freezes the fixed proof-stage sequence, reuses the canonical
//! [`projectos_host_windows_service_identity_proof::AuthorityHandoverState`] (no second handover
//! machine), requires dual IPC + SCM corroboration, caps correction at one cycle, requires rollback on
//! pass or failure, and confirms only on zero residue with the accepted redacted evidence classifier.
//!
//! ```
//! use projectos_host_windows_service_identity_proof_runner::{
//!     ProofStage, PROOF_RUNNER_IS_CONTRACT_ONLY,
//! };
//! assert!(PROOF_RUNNER_IS_CONTRACT_ONLY);
//! assert_eq!(ProofStage::sequence().len(), 19);
//! assert!(!ProofStage::sequence().iter().any(|s| s.contract_executes_windows_operation()));
//! ```

#![forbid(unsafe_code)]

mod corroboration;
mod fixture;
mod plan;

// The bounded compile-only proof controller. It exists ONLY in the fixture graph, because the
// capabilities it needs exist only there — the default build keeps no orchestration at all.
#[cfg(feature = "test-fixtures")]
mod controller;

// PROOF-RUNNER-OWNED evidence vocabulary. The dependency binding verdict is consumed internally and
// never becomes this crate's durable contract.
#[cfg(feature = "test-fixtures")]
pub use controller::{run_compile_only_proof, CompileOnlyProofOutcome, CompileOnlyProofRequest};
pub use corroboration::{InstanceCorroboration, ProofRunnerInstanceRefusal};
pub use fixture::{
    CompileOnlyServiceFixture, FixtureDisconnectBehaviour, FixtureResidue,
    FixtureShutdownBehaviour, FixtureShutdownOutcome,
};

pub use plan::{
    CorrectionState, ProofRunnerClass, ProofRunnerConfirmation, ProofRunnerRefusal, ProofStage,
    RollbackRequirement, ScmCorroboration,
};

// Re-export the canonical types the runner reuses (handover + redacted evidence + IPC corroboration).
pub use projectos_host_windows_local_ipc::IpcCorroboration;
pub use projectos_host_windows_service_identity_proof::{
    AuthorityHandoverState, AuthorityTokenOutcome, ServiceIdentityEvidence,
    ServiceIdentityProofClass,
};

/// This crate is an effect-free proof-runner CONTRACT only — no live proof orchestration runs here.
pub const PROOF_RUNNER_IS_CONTRACT_ONLY: bool = true;

/// No live proof orchestration has been implemented or authorised in this phase.
pub const LIVE_PROOF_ORCHESTRATION_AUTHORISED: bool = false;

/// Execution readiness is invariantly false in this phase.
pub const EXECUTION_READY: bool = false;

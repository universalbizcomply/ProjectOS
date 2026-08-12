//! Build the exact packaged runtime the trust manifest will attest.
//!
//! THREE STEPS, IN THIS ORDER, and the order is the point:
//!
//!   1. `assemble` — copy the pinned runtime and the single daemon bundle into a fresh payload root,
//!      refusing any runtime whose bytes are not the pinned ones;
//!   2. `closure`  — prove the assembled payload does not reach back into the development tree, the
//!      working directory or `node_modules`;
//!   3. `manifest` — hash what was actually assembled and emit the unsigned manifest plus exactly
//!      the bytes an owner-held key will later sign.
//!
//! Generating before checking closure would produce a manifest attesting a payload that cannot run
//! on its own, which is worse than no manifest: it is a signature over something broken.
//!
//! THE MANIFEST DESCRIBES REAL BYTES. Every digest is computed by reading the assembled payload off
//! disk. A caller says what the build is CALLED; it cannot say what the build IS. There is no input
//! for a hash, for the runtime version, for the architecture, or for either payload path — those are
//! derived from the bytes or fixed by the packaging contract.
//!
//! ONE CANONICALISATION. The signing bytes come from `projectos_host_identity::canonical_bytes` —
//! the same function the production verifier uses. Two implementations of "which bytes are signed"
//! is how a signature scheme quietly becomes decorative: they agree on every case anyone tested and
//! differ on the one that matters.
//!
//! IT NEVER SIGNS. No key is generated, read, embedded or referenced beyond a key IDENTIFIER, and
//! the signature field is emitted empty. An unsigned manifest is structurally distinguishable from a
//! signed one and cannot establish production identity — `evaluate()` refuses an empty signature.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

#![forbid(unsafe_code)]

pub mod assemble;
pub mod closure;
pub mod manifest;

pub use assemble::{assemble_payload, AssembleError, AssembledPayload};
pub use closure::{verify_closure, ClosureFinding, ClosureReport};
pub use manifest::{generate_unsigned_manifest, GeneratedManifest, GeneratorError, ManifestInputs};

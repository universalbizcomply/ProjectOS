//! THE PROTECTED INSTALLATION BOUNDARY — the production mint that §10E deliberately left absent.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10F.
//!
//! ## The one claim this module is allowed to make
//!
//! ```text
//! TRUSTED HOST ROOT
//!   + AUTHORITATIVE OWNER / DACL OBSERVATION
//!   + THE EXACT ACCEPTED ACL POLICY
//!   + SUCCESSFUL VERIFICATION
//!   = PROTECTED INSTALLATION BOUNDARY ACCEPTANCE
//! ```
//!
//! Nothing weaker mints it. Directory existence, an installer success flag, a configuration file, an
//! environment variable, the working directory, a caller's assertion, an IPC request field, a project
//! file, a record stored INSIDE the boundary being judged, a previous report and a previous gate
//! decision are all absent from this module — not rejected by a check that could be removed, but
//! absent as inputs. The only argument [`ProtectedInstallationBoundaryAcceptance::verify`] takes is a
//! [`TrustedHostStateRoot`], which has no path-taking constructor in any build.
//!
//! ## What is observed, and by what
//!
//! The owner and DACL of the ACTUAL resolved Host state root, read from Windows through the accepted
//! ACL primitive: a handle opened with `FILE_FLAG_OPEN_REPARSE_POINT`, `GetSecurityInfo` on that
//! object, and the observation discarded unless the pathname still denotes the object that was
//! admitted. No second ACL framework is written here — this module composes an accepted policy and
//! asks an accepted verifier, and owns neither.
//!
//! ## Which policy, and why the caller cannot choose it
//!
//! The ONE production composition already accepted by the installer's own effect path:
//! [`AclCompositionPlan::production`] bound to the owner-decided
//! [`ServiceIdentityStrategy::VirtualServiceAccount`] (`NT SERVICE\ProjectOSHost`, C5), with the
//! service SID resolved LIVE through the approved Windows lookup rather than inferred from its name.
//! [`verify`](ProtectedInstallationBoundaryAcceptance::verify) takes no policy parameter, so the
//! policy that judges the boundary cannot be supplied by the thing being judged, and the same
//! composition the installer applies is the composition the Host verifies. If the two could differ,
//! acceptance would mean nothing.
//!
//! ## What acceptance does NOT claim
//!
//! It claims resistance to an ordinary NON-PRIVILEGED local actor, and nothing more. A local
//! administrator, SYSTEM, a kernel-level compromise and offline disk access all defeat this boundary
//! by Windows' own security model — `BUILTIN\Administrators` holds an explicit `FullControl` ACE in
//! the accepted policy, deliberately and honestly, because excluding it would not exclude an
//! administrator and would only make the host unserviceable.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! These live HERE rather than on the crate root deliberately. They prove things about `verify`,
//! which exists only on Windows; stated at the crate root they would still report `compile_fail`
//! off-Windows, but for the useless reason that nothing they name exists there.
//!
//! The mint takes a SEALED ROOT AND NOTHING ELSE — a caller cannot supply the path it judges:
//! ```compile_fail
//! use projectos_host_trusted_roots::ProtectedInstallationBoundaryAcceptance;
//! let _ = ProtectedInstallationBoundaryAcceptance::verify(std::path::Path::new("C:\\Windows"));
//! ```
//! …and cannot supply the policy that judges it, which is the whole point of there being one:
//! ```compile_fail
//! use projectos_host_trusted_roots::{ProtectedInstallationBoundaryAcceptance, TrustedHostStateRoot};
//! use projectos_host_windows_acl_policy::{AclPolicy, AclPrincipal};
//! fn f(r: &TrustedHostStateRoot) {
//!     let mine = AclPolicy::strict(AclPrincipal::CurrentInteractiveUser, Vec::new());
//!     let _ = ProtectedInstallationBoundaryAcceptance::verify(r, &mine);
//! }
//! ```
//! A governed project root is NOT a Host state boundary and cannot be offered as one — the Host
//! ProgramData ACL is never applied to, or asserted of, a governed repository:
//! ```compile_fail
//! use projectos_host_trusted_roots::{ProtectedInstallationBoundaryAcceptance, TrustedGovernedProjectRoot};
//! fn f(g: &TrustedGovernedProjectRoot) {
//!     let _ = ProtectedInstallationBoundaryAcceptance::verify(g);
//! }
//! ```

use projectos_host_identity::canonical_record::EXPECTED_SERVICE_NAME;
use projectos_host_windows_acl_policy::{
    resolve_account_sid, AclPolicy, AclPolicyError, AclViolation, WindowsAclPolicyService,
};
use projectos_host_windows_activation_plan::acl_plan::{
    AclCompositionOutcome, AclCompositionPlan, ApprovedServicePrincipal,
};
use projectos_host_windows_activation_plan::service_identity::{
    ServiceIdentityPlan, ServiceIdentityStrategy,
};

use crate::activation::ProtectedInstallationBoundaryAcceptance;
use crate::host_state::TrustedHostStateRoot;
use crate::refusal::TrustedRootRefusal;

/// Why the protected installation boundary was NOT accepted.
///
/// SEMANTIC ONLY. No SID, no account name, no path, no security-descriptor byte and no OS error code
/// appears in any variant or in `Debug` — the accepted primitives redact all of it, and this type
/// keeps that property rather than re-introducing the leak at the boundary layer.
///
/// UNKNOWN IS NOT ACCEPTED. Every variant refuses, including the ones that mean "could not tell".
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum BoundaryRefusal {
    /// The trusted root itself stopped being trustworthy — before, or after, the observation.
    ///
    /// Carried WHOLE rather than flattened: a reparse point substituted for the root, a replaced
    /// object, a redirection and a missing root are four different repairs.
    Root(TrustedRootRefusal),

    /// The service identity could not be established authoritatively.
    ///
    /// The account SID did not resolve, the resolved principal did not bind to the owner-decided
    /// strategy, or the accepted composition refused to produce a policy. An unresolved service
    /// identity means the policy cannot even be STATED, so there is nothing to verify against and
    /// no honest outcome but refusal.
    ServiceIdentityUnresolved,

    /// The security descriptor could not be read, or could not be interpreted.
    ///
    /// Access denied, an unavailable descriptor, a malformed descriptor, or any other Windows
    /// failure. Uncertainty about effective authority fails CLOSED.
    BoundaryUnreadable,

    /// The boundary was read and does NOT match the accepted policy.
    ///
    /// The findings are the accepted verifier's own fieldless classifications, in detection order:
    /// they name the defect and never the trustee.
    NonConforming(Vec<AclViolation>),
}

/// Translate the accepted ACL primitive's classification into a boundary refusal.
///
/// The custody-shaped failures are reported as ROOT failures, because that is what they are: the
/// object stopped being the one that was resolved. Everything else — including a variant a future
/// version of the accepted crate adds — is unreadable, never readable-and-fine.
fn from_acl(err: AclPolicyError) -> BoundaryRefusal {
    match err {
        AclPolicyError::UnsupportedPlatform => {
            BoundaryRefusal::Root(TrustedRootRefusal::PlatformUnsupported)
        }
        AclPolicyError::EmptyPath
        | AclPolicyError::RelativePath
        | AclPolicyError::UnsupportedNamespace => {
            BoundaryRefusal::Root(TrustedRootRefusal::UnsafePath)
        }
        AclPolicyError::NotFound => BoundaryRefusal::Root(TrustedRootRefusal::RootMissing),
        AclPolicyError::NotADirectory | AclPolicyError::NotAFile => {
            BoundaryRefusal::Root(TrustedRootRefusal::RootNotADirectory)
        }
        AclPolicyError::ReparsePointRefused => {
            BoundaryRefusal::Root(TrustedRootRefusal::ReparsePointRefused)
        }
        AclPolicyError::PathReplaced => {
            BoundaryRefusal::Root(TrustedRootRefusal::RootIdentityDrift)
        }
        _ => BoundaryRefusal::BoundaryUnreadable,
    }
}

/// Compose the ONE accepted production policy, resolving the service SID through Windows.
///
/// NOTHING HERE IS INFERRED FROM A STRING. `NT SERVICE\ProjectOSHost` is a NAME; the authority it
/// denotes is the SID Windows returns for it, and the accepted `from_resolved_sid` constructor is
/// the only route that binds an owner-decided strategy to a SID rather than guessing one. The
/// well-known table is deliberately NOT consulted for this strategy — it refuses, because a virtual
/// service account's per-service SID exists only once the service does.
fn accepted_production_policy() -> Result<AclPolicy, BoundaryRefusal> {
    const STRATEGY: ServiceIdentityStrategy = ServiceIdentityStrategy::VirtualServiceAccount;

    let account = format!("NT SERVICE\\{EXPECTED_SERVICE_NAME}");
    let sid =
        resolve_account_sid(&account).map_err(|_| BoundaryRefusal::ServiceIdentityUnresolved)?;
    let principal = ApprovedServicePrincipal::from_resolved_sid(STRATEGY, sid)
        .map_err(|_| BoundaryRefusal::ServiceIdentityUnresolved)?;
    // The owner decision (C5) is a repository fact, not a runtime input: the same two lines the
    // installer's effect path uses to state it are the two lines used here.
    let identity = ServiceIdentityPlan::analysed().with_owner_decision(STRATEGY);

    match AclCompositionPlan::production().compose_with_resolved_principal(&identity, &principal) {
        AclCompositionOutcome::Composed(policy) => Ok(policy),
        // Undecided identity, a mismatched principal, or any future outcome variant: all refuse.
        _ => Err(BoundaryRefusal::ServiceIdentityUnresolved),
    }
}

impl ProtectedInstallationBoundaryAcceptance {
    /// THE PRODUCTION MINT. Accept the protected installation boundary, or refuse.
    ///
    /// ## The sequence, which this function owns end to end
    ///
    /// 1. REVALIDATE the trusted root — the chain, the held handle, and that the object still lives
    ///    where the installation composed it;
    /// 2. RESOLVE the service identity authoritatively and COMPOSE the accepted production policy —
    ///    an unresolved SID stops here, because a policy that cannot be stated cannot be met;
    /// 3. OBSERVE the real owner and DACL of that root through the accepted ACL primitive;
    /// 4. VERIFY the observation against the composed policy — every violation refuses;
    /// 5. REVALIDATE the root AGAIN, so the descriptor just judged belongs to the same object §10E
    ///    resolved rather than to one substituted during the observation;
    /// 6. only then mint.
    ///
    /// ## Why this cannot self-attest
    ///
    /// Every input is either a sealed capability the caller cannot construct
    /// ([`TrustedHostStateRoot`]) or a fact obtained from Windows during this call (the service SID,
    /// the owner, the DACL). Nothing stored inside the boundary is consulted to decide whether the
    /// boundary is trustworthy, and no argument exists through which a caller could pre-decide the
    /// answer.
    ///
    /// ## What the second revalidation does and does not close
    ///
    /// STATED WITHOUT FLATTERY. The accepted ACL primitive already opens its own custody handle,
    /// reads the descriptor from THAT handle, and discards the observation unless the pathname still
    /// denotes the admitted object. The revalidation on either side of it narrows the window
    /// further — a root replaced, re-aimed or turned into a reparse point around the observation is
    /// detected — but it does not make the sequence atomic, and no lock is claimed. What is claimed
    /// is that a boundary whose object changed identity is refused rather than accepted.
    ///
    /// # Errors
    /// [`BoundaryRefusal`] naming the first failure. There is no partial acceptance and no retry:
    /// a non-conforming boundary is reported, never repaired, because repairing it is a privileged
    /// effect this crate does not perform.
    pub fn verify(root: &TrustedHostStateRoot) -> Result<Self, BoundaryRefusal> {
        // 1. The root must still be the root.
        root.revalidate().map_err(BoundaryRefusal::Root)?;

        // 2. The policy is composed BEFORE anything is read, so an unresolved service identity
        //    refuses without an observation ever being taken.
        let policy = accepted_production_policy()?;

        // 3 + 4. Authoritative observation, judged by the accepted verifier.
        let verification = WindowsAclPolicyService::new()
            .verify_directory(root.path(), &policy)
            .map_err(from_acl)?;
        if !verification.is_conforming() {
            return Err(BoundaryRefusal::NonConforming(
                verification.violations().to_vec(),
            ));
        }

        // 5. The descriptor just judged must belong to the object §10E resolved.
        root.revalidate().map_err(BoundaryRefusal::Root)?;

        // 6. Only now.
        Ok(Self::mint())
    }
}

//! THE ONE ROUTE FROM A RUNNING HOST TO ITS DURABLE STATE — RUN-TO-COMPLETION HOST ATTESTATION §10H.
//!
//! ## The chain, in the only order it runs
//!
//! ```text
//! TrustedHostStateRoot::resolve(&ApprovedKnownFolderAnchor)          §10E  which directory
//!   -> ProtectedInstallationBoundaryAcceptance::verify(&root)         §10F  is its boundary real
//!   -> ActivatedHostStateRoot::activate(root, &acceptance)            §10E  resolved AND accepted
//!   -> HostOwnedDelegationStateRoot::from_activated(&activated)       §10B  root handoff, revalidated
//!   -> HostOwnedRequestReplayRoot::from_activated(&activated)         §10C  root handoff, revalidated
//!   -> DurableDelegationStateFileStore::open                          §10B  lifecycle authority
//!   -> DurableRequestReplayFileStore::open                            §10C  replay authority
//! ```
//!
//! Every link already existed and none is changed here. What did not exist was a production CALLER,
//! so a running ProjectOSHost held no durable delegation or replay authority at all.
//! [`activate_installed_host_state`] is that caller.
//!
//! §10I: EACH STORE OPEN IS CUSTODY, THEN THE ENGINE, THEN CUSTODY AGAIN. Inside both `open`s the
//! store directory is created — or found — with the committed owner and protected DACL, every
//! existing object is judged against it, the engine opens with every creation routed through that
//! custody, and the result is judged again. A store that cannot be governed refuses its link here,
//! so the Host never reaches Running on ambient security state.
//!
//! ## It takes nothing
//!
//! No path, no anchor, no policy, no SID, no verdict and no store. The anchor is the approved Known
//! Folder resolver, the boundary is judged by the §10F mint against the frozen production policy,
//! and the stores are opened on the roots those two produce. argv, the environment and the working
//! directory are not consulted here, and none of the links below accepts them.
//!
//! ## Fail closed, whole
//!
//! The first link that refuses stops the chain, and the caller receives a
//! [`HostStateActivationRefusal`] naming it — never a partial state. The two store roots are both
//! handed off BEFORE either store is opened, so a root that changed after acceptance opens nothing;
//! and a delegation store opened before the replay store refused is dropped with the refusal, which
//! releases its single-writer lock. There is no fallback to an unprotected directory, the working
//! directory, an environment-selected root, an in-memory store or a fixture: none of those is an
//! input, so there is nothing to fall back to.
//!
//! ## What it does not claim
//!
//! It is not atomic, and no lock spans the chain. The root is revalidated on both sides of the
//! boundary observation inside `verify`, and again at each `from_activated` handoff; after that the
//! stores are ordinary paths, protected by the durable engine's own open-time checks and by the
//! single-writer lock handle each store holds inside its leaf for as long as it lives. Carrying the
//! custody handle into the store roots is the recorded §10B/§10C carry-forward and is not done here.
//!
//! It activates the HOST STATE root only. The governed project root the canonical budget ledger
//! (§10D) needs is a different root, chosen per project by the installed-project registry, and is
//! not a start-up fact.

use projectos_host_trusted_roots::{
    ActivatedHostStateRoot, ApprovedKnownFolderAnchor, BoundaryRefusal, InstallationAnchorSource,
    ProtectedInstallationBoundaryAcceptance, TrustedHostStateRoot, TrustedRootRefusal,
};

use crate::operation_contract::request_replay::durable_store::{
    DurableRequestReplayFileStore, HostOwnedRequestReplayRoot,
};
use crate::operation_contract::request_replay::{ReplayRefusal, RequestReplayLedger};
use crate::owner_programme_delegation::durable_store::{
    DelegationStoreRefusal, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
};
use crate::owner_programme_delegation::DurableDelegationStateStore;

#[cfg(test)]
mod tests;

/// Why the Host's durable state was not activated.
///
/// EVERY VARIANT IS A REFUSAL, and every one leaves nothing open: no store, no lock, no partial
/// state. The inner values are the owning crates' own semantic refusals — no path, SID, descriptor
/// byte or OS error code appears in any of them.
///
/// Deliberately exhaustive: a caller that maps refusals to operator-visible codes must be made to
/// handle a new link by the compiler, not discover it at runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostStateActivationRefusal {
    /// The Host state root did not resolve. Nothing was verified and nothing was opened.
    RootUnresolved(TrustedRootRefusal),
    /// The root resolved, but the live protected-boundary verification refused it. Nothing was
    /// opened.
    BoundaryNotAccepted(BoundaryRefusal),
    /// The boundary was accepted, but at the handoff to a store root the root no longer denoted the
    /// object, or no longer lived at the location, that resolution captured. Nothing was opened.
    RootChangedAfterAcceptance(TrustedRootRefusal),
    /// The durable delegation lifecycle store refused to open. The replay store was not attempted.
    DelegationStoreUnavailable(DelegationStoreRefusal),
    /// The durable request-replay store refused to open. The delegation store opened before it was
    /// dropped with this refusal, releasing its lock.
    ReplayStoreUnavailable(ReplayRefusal),
}

/// The Host's durable security state, reached through the whole activation chain and held open.
///
/// Holding one means: the Host state root was resolved from the approved anchor, its protected
/// boundary was verified live against the accepted production policy, the root was activated, and
/// both durable stores opened beneath it. Each store holds its single-writer lock for as long as
/// this value lives, so there is no second delegation or replay authority for the same root — in
/// this process or any other. Dropping it releases both.
///
/// PRIVATE FIELDS AND NO PUBLIC CONSTRUCTOR. [`activate_installed_host_state`] is the only
/// production route to one; a caller holding the parts cannot assemble it:
/// ```compile_fail
/// use projectos_host_windows_local_ipc::ActivatedHostDurableState;
/// fn f() -> ActivatedHostDurableState {
///     ActivatedHostDurableState { root: todo!(), delegation: todo!(), replay: todo!() }
/// }
/// ```
#[derive(Debug)]
pub struct ActivatedHostDurableState {
    /// Retained so the root can be re-proven for as long as the stores live.
    root: ActivatedHostStateRoot,
    delegation: DurableDelegationStateFileStore,
    replay: DurableRequestReplayFileStore,
}

impl ActivatedHostDurableState {
    /// The two durable seams `compose_protected_operation` takes, borrowed together.
    ///
    /// Returned as a pair because the composition reads the delegation store while it holds the
    /// replay ledger mutably, and two separate accessors could not both be borrowed at once.
    pub fn stores_for_composition(
        &mut self,
    ) -> (
        &dyn DurableDelegationStateStore,
        &mut dyn RequestReplayLedger,
    ) {
        (&self.delegation, &mut self.replay)
    }

    /// Re-check that the activated root is still the object resolution captured.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first divergence.
    pub fn revalidate(&self) -> Result<(), TrustedRootRefusal> {
        self.root.revalidate()
    }

    /// RECORD one owner-signed delegation as `Active` in THIS state's durable registry.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B, criterion 21. A thin forwarding of
    /// [`crate::activate_owner_programme_delegation`] to the store this activation opened, so the
    /// service-entry resolver never holds the concrete store — the same reason
    /// [`Self::stores_for_composition`] lends trait objects. All the authority gates live in the
    /// forwarded function; this adds none and removes none.
    ///
    /// # Errors
    /// [`crate::DelegationActivationRefusal`] naming the gate or store rule that refused.
    pub fn activate_delegation(
        &mut self,
        record: &crate::SignedOwnerProgrammeDelegation,
        attested: &projectos_host_identity::AttestedInstallationProgramme,
    ) -> Result<(), crate::DelegationActivationRefusal> {
        crate::activate_owner_programme_delegation(&mut self.delegation, record, attested)
    }

    /// The activated Host state root's path — READ-ONLY EXPOSURE, no custody, no store.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B, criterion 21. The service-entry resolver derives the fixed
    /// activation-input leaves (the owner-delegation record, the gatekeeper inbox/outbox/attestation
    /// directories, the Host plan-store leaf) beneath exactly this root, and before this accessor it
    /// had no production way to learn it. Handing out the PATH grants nothing the path did not
    /// already grant: every store beneath it still opens only through its own governed custody.
    #[must_use]
    pub fn host_state_root(&self) -> &std::path::Path {
        self.root.path()
    }
}

/// THE PRODUCTION ROUTE. Activate the installed Host's durable state, or refuse.
///
/// Takes no argument, in any build. The anchor is [`ApprovedKnownFolderAnchor`] and the boundary is
/// judged by [`ProtectedInstallationBoundaryAcceptance::verify`]; neither can be substituted from
/// outside this module:
/// ```compile_fail
/// let _ = projectos_host_windows_local_ipc::activate_installed_host_state(
///     std::path::Path::new("C:\\attacker"),
/// );
/// ```
/// The route itself is nameable and its signature is the whole contract:
/// ```
/// use projectos_host_windows_local_ipc::{
///     activate_installed_host_state, ActivatedHostDurableState, HostStateActivationRefusal,
/// };
/// let _route: fn() -> Result<ActivatedHostDurableState, HostStateActivationRefusal> =
///     activate_installed_host_state;
/// ```
///
/// # Errors
/// [`HostStateActivationRefusal`] naming the first link that refused.
pub fn activate_installed_host_state(
) -> Result<ActivatedHostDurableState, HostStateActivationRefusal> {
    activate(
        &ApprovedKnownFolderAnchor,
        ProtectedInstallationBoundaryAcceptance::verify,
    )
}

/// ACTIVATE THE GOVERNED PROJECT'S LEDGER ROOT — PROJECTOS-HOST-REVIEW-PATH1B, criterion 21.
///
/// The canonical budget ledger's root is the GOVERNED PROJECT root (§10D), which is a different
/// root class from the Host state root above, resolved through the canonical installed-project
/// registry and judged by the SAME live boundary rule. Doing that here — and only here — keeps the
/// §10H invariant intact: service-host still cannot name a root, an acceptance or the trusted-roots
/// crate, so there is still exactly one module that can turn directories into authority.
///
/// Takes a project id and NOTHING else: the anchor is the approved Known Folder resolver, the
/// registry is the canonical one, and the boundary is verified live per call. Returns the sealed
/// ledger root BY VALUE — `CanonicalGatekeeperLedger::open` consumes one per opening, so a caller
/// opening a ledger per exchange calls this per exchange, and every call re-proves the chain.
///
/// # Errors
/// [`HostStateActivationRefusal`] reusing the existing refusal classes: the roots that did not
/// resolve report as [`HostStateActivationRefusal::RootUnresolved`], the boundary as
/// [`HostStateActivationRefusal::BoundaryNotAccepted`], and the handoff as
/// [`HostStateActivationRefusal::RootChangedAfterAcceptance`].
#[cfg(windows)]
pub fn activate_governed_project_ledger_root(
    project_id: &str,
) -> Result<
    crate::operation_contract::host_composition::canonical_ledger::HostOwnedGatekeeperProjectRoot,
    HostStateActivationRefusal,
> {
    use projectos_host_trusted_roots::{
        ActivatedGovernedProjectRoot, CanonicalProjectRegistry, TrustedGovernedProjectRoot,
    };
    let trusted_state = TrustedHostStateRoot::resolve(&ApprovedKnownFolderAnchor)
        .map_err(HostStateActivationRefusal::RootUnresolved)?;
    let accepted = ProtectedInstallationBoundaryAcceptance::verify(&trusted_state)
        .map_err(HostStateActivationRefusal::BoundaryNotAccepted)?;
    let trusted_project = TrustedGovernedProjectRoot::resolve(&CanonicalProjectRegistry, project_id)
        .map_err(HostStateActivationRefusal::RootUnresolved)?;
    let activated = ActivatedGovernedProjectRoot::activate(trusted_project, &accepted);
    crate::operation_contract::host_composition::canonical_ledger::HostOwnedGatekeeperProjectRoot::from_activated(&activated)
        .map_err(HostStateActivationRefusal::RootChangedAfterAcceptance)
}

/// How the boundary is judged. In production this is exactly
/// [`ProtectedInstallationBoundaryAcceptance::verify`].
///
/// A parameter rather than a direct call only so this module's tests can drive the SAME chain over a
/// disposable anchor — once with the real verifier, which must refuse, and once with the
/// trusted-roots fixture acceptance for the shape below the gate. It cannot widen anything: the
/// acceptance type is sealed, so whatever is passed must itself have obtained one from `verify` or,
/// in a fixture graph no shipped build compiles, from `fixture`.
type BoundaryVerification =
    fn(&TrustedHostStateRoot) -> Result<ProtectedInstallationBoundaryAcceptance, BoundaryRefusal>;

/// The chain. Private: the only production caller is [`activate_installed_host_state`].
fn activate<S: InstallationAnchorSource>(
    anchor: &S,
    verify: BoundaryVerification,
) -> Result<ActivatedHostDurableState, HostStateActivationRefusal> {
    // 1. WHICH DIRECTORY. The sealed anchor, the frozen segments, a reparse-checked walk.
    let trusted = TrustedHostStateRoot::resolve(anchor)
        .map_err(HostStateActivationRefusal::RootUnresolved)?;

    // 2. IS ITS BOUNDARY REAL. Read live and judged before anything beneath it is touched.
    let accepted = verify(&trusted).map_err(HostStateActivationRefusal::BoundaryNotAccepted)?;

    // 3. RESOLVED AND ACCEPTED.
    let root = ActivatedHostStateRoot::activate(trusted, &accepted);

    // 4. BOTH HANDOFFS BEFORE EITHER OPEN, so a root that moved after acceptance opens nothing.
    let delegation_root = HostOwnedDelegationStateRoot::from_activated(&root)
        .map_err(HostStateActivationRefusal::RootChangedAfterAcceptance)?;
    let replay_root = HostOwnedRequestReplayRoot::from_activated(&root)
        .map_err(HostStateActivationRefusal::RootChangedAfterAcceptance)?;

    // 5. THE STORES. A refusal here drops whatever opened before it, releasing its lock.
    let delegation = DurableDelegationStateFileStore::open(&delegation_root)
        .map_err(HostStateActivationRefusal::DelegationStoreUnavailable)?;
    let replay = DurableRequestReplayFileStore::open(&replay_root)
        .map_err(HostStateActivationRefusal::ReplayStoreUnavailable)?;

    Ok(ActivatedHostDurableState {
        root,
        delegation,
        replay,
    })
}

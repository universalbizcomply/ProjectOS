//! THE HOST STORES' GOVERNED OPEN — RUN-TO-COMPLETION HOST ATTESTATION §10I.
//!
//! Both durable stores open the same way, so the sequence is written once:
//!
//! ```text
//! HostStoreCustody::establish(store)          the store directory exists with the committed
//!                                             descriptor, and EVERY object already in it conforms
//!   -> DurableProtectedStore::open_governed    the engine, with every creation routed through that
//!                                             custody — layout, lock, staging, recovery's writes
//!   -> GovernedHostStore::verify_contents      everything the engine laid out or recovery wrote is
//!                                             judged again
//!   -> only then is the store handed back
//! ```
//!
//! Custody comes FIRST, so the engine never reads, recovers or cleans a store whose descriptor is
//! unknown; the re-judgement comes LAST, so a store is never handed back on the strength of a check
//! made before the engine touched it. A refusal at any step drops whatever opened, releasing the
//! single-writer lock. Nothing on any path re-secures an existing object.

use std::fs::File;
use std::path::Path;

use projectos_host_trusted_roots::{
    GovernedHostStore, HostStateStore, HostStoreCustody, StoreCustodyRefusal,
};
use projectos_host_windows_durable_protected_store::{
    DurableProtectedStore, DurableStoreError, ObjectCreation,
};

/// Why a governed store did not open. The custody detail stays inside this module: the stores'
/// own refusal types are fieldless by design.
#[derive(Debug)]
pub(crate) enum GovernedOpenRefusal {
    /// The Host state root, or the store directory's spelling, is not usable.
    StateRootUnusable,
    /// Custody could not be established, or a store object does not carry the committed descriptor.
    CustodyRefused,
    /// The durable engine refused.
    Engine(DurableStoreError),
}

/// The engine's creation hook, answered by the store's established custody.
struct GovernedCreation(GovernedHostStore);

impl ObjectCreation for GovernedCreation {
    fn create_directory(&self, path: &Path) -> std::io::Result<()> {
        self.0.create_directory(path)
    }

    fn create_file(&self, path: &Path) -> std::io::Result<File> {
        self.0.create_file(path)
    }
}

/// Establish custody, open the engine governed by it, and judge the result — or refuse.
pub(crate) fn open_governed_store(
    custody: &HostStoreCustody,
    store: HostStateStore,
) -> Result<DurableProtectedStore, GovernedOpenRefusal> {
    let governed = custody.establish(store).map_err(classify)?;
    let dir = governed
        .path()
        .to_str()
        .ok_or(GovernedOpenRefusal::StateRootUnusable)?
        .to_owned();
    let engine =
        DurableProtectedStore::open_governed(&dir, Box::new(GovernedCreation(governed.clone())))
            .map_err(GovernedOpenRefusal::Engine)?;
    governed.verify_contents().map_err(classify)?;
    Ok(engine)
}

/// A custody refusal, as the stores classify it. `StoreCustodyRefusal` is `#[non_exhaustive]`, and
/// every variant not named here — including a future one — is a custody refusal, never an open.
fn classify(refusal: StoreCustodyRefusal) -> GovernedOpenRefusal {
    match refusal {
        StoreCustodyRefusal::StateRootUnusable | StoreCustodyRefusal::PlatformUnsupported => {
            GovernedOpenRefusal::StateRootUnusable
        }
        _ => GovernedOpenRefusal::CustodyRefused,
    }
}

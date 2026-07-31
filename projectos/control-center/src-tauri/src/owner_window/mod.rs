//! Control Centre owner-window bridge (CD-B4-CONTROL-CENTRE-WINDOW-OBSERVATION-BRIDGE1A).
//!
//! Produces an UNTRUSTED observation of the designated `"main"` window and maintains deterministic
//! lifecycle state. It mints NO trusted binding, registers NO Tauri command, and exposes NO window fact
//! to the renderer. The trusted binding is minted only by the adapter's sealed verifier in a later
//! composition phase, which re-checks every fact.

pub(crate) mod lifecycle;
pub(crate) mod observation;

pub(crate) use lifecycle::OwnerWindowLifecycleState;
#[allow(unused_imports)]
pub(crate) use observation::{
    capture_owner_window_observation, resolve_designated_label, ObservationError,
    OwnerWindowContext,
};

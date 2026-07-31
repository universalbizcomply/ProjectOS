//! Deterministic owner-window lifecycle state.
//!
//! A single monotonic epoch is advanced on EVERY lifecycle transition of the designated `"main"` window —
//! creation, a (possibly prevented) close request, and destruction. An observation binds the epoch at
//! capture time; any later transition changes the epoch and invalidates that observation, so a matching
//! numeric handle alone can never restore validity. Pure and fully unit-testable; it touches no Windows
//! API and no Tauri type.

// The transition methods are driven by the run loop; the query surface is consulted by the producer and
// the (later) composition phase and exercised by tests. Allow dead_code so the complete-but-not-yet-fully
// -consumed surface does not warn in the default build.
#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Deterministic lifecycle state for the single designated owner window.
#[derive(Debug)]
pub struct OwnerWindowLifecycleState {
    /// Advanced on every create / close-request / destroy transition. `0` means no window yet.
    epoch: AtomicU64,
    /// Monotonic capture id, so each capture attempt is distinguishable.
    capture_generation: AtomicU64,
    /// Set once the host begins shutting down; late capture results are then refused.
    shutting_down: AtomicBool,
    /// Whether the designated main window is currently present.
    main_present: AtomicBool,
}

impl Default for OwnerWindowLifecycleState {
    fn default() -> Self {
        Self::new()
    }
}

impl OwnerWindowLifecycleState {
    /// A fresh state: no window, generation 0, not shutting down.
    #[must_use]
    pub fn new() -> Self {
        Self {
            epoch: AtomicU64::new(0),
            capture_generation: AtomicU64::new(0),
            shutting_down: AtomicBool::new(false),
            main_present: AtomicBool::new(false),
        }
    }

    /// The main window was created (or recreated): advance the epoch and mark it present. A recreated
    /// window therefore gets a new epoch and cannot reuse a prior observation.
    pub fn on_window_created(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.main_present.store(true, Ordering::SeqCst);
    }

    /// A close was requested. Outstanding observations are invalidated immediately by advancing the epoch;
    /// the native window is NOT assumed destroyed, and a prevented close therefore requires a fresh
    /// observation (which will read the new epoch).
    pub fn on_close_requested(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// The window was destroyed: advance the epoch and clear presence.
    pub fn on_destroyed(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.main_present.store(false, Ordering::SeqCst);
    }

    /// Begin shutdown; late capture results are refused from here on.
    pub fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
    }

    /// The current lifecycle epoch.
    #[must_use]
    pub fn current_epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    /// Allocate the next monotonic capture generation.
    pub fn next_capture_generation(&self) -> u64 {
        self.capture_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether the host is shutting down.
    #[must_use]
    pub fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    /// Whether the designated main window is currently present.
    #[must_use]
    pub fn is_main_present(&self) -> bool {
        self.main_present.load(Ordering::SeqCst)
    }

    /// Whether an observation captured at `captured_epoch` is still current (same epoch, not shutting
    /// down). A matching numeric handle is irrelevant — only the epoch and shutdown state decide.
    #[must_use]
    pub fn is_current(&self, captured_epoch: u64) -> bool {
        !self.is_shutting_down() && self.current_epoch() == captured_epoch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_establishes_and_advances_epoch() {
        let s = OwnerWindowLifecycleState::new();
        assert_eq!(s.current_epoch(), 0);
        assert!(!s.is_main_present());
        s.on_window_created();
        assert_eq!(s.current_epoch(), 1);
        assert!(s.is_main_present());
    }

    #[test]
    fn close_request_invalidates_without_clearing_presence() {
        let s = OwnerWindowLifecycleState::new();
        s.on_window_created();
        let e = s.current_epoch();
        assert!(s.is_current(e));
        s.on_close_requested();
        assert!(!s.is_current(e)); // outstanding observation invalidated
        assert!(s.is_main_present()); // native window not assumed destroyed
    }

    #[test]
    fn destroy_advances_epoch_and_clears_presence() {
        let s = OwnerWindowLifecycleState::new();
        s.on_window_created();
        let e = s.current_epoch();
        s.on_destroyed();
        assert!(!s.is_current(e));
        assert!(!s.is_main_present());
    }

    #[test]
    fn recreate_cannot_reuse_a_prior_epoch() {
        let s = OwnerWindowLifecycleState::new();
        s.on_window_created();
        let first = s.current_epoch();
        s.on_destroyed();
        s.on_window_created(); // recreated
        assert_ne!(s.current_epoch(), first);
        assert!(!s.is_current(first));
    }

    #[test]
    fn shutdown_invalidates_everything() {
        let s = OwnerWindowLifecycleState::new();
        s.on_window_created();
        let e = s.current_epoch();
        s.begin_shutdown();
        assert!(!s.is_current(e));
        assert!(s.is_shutting_down());
    }

    #[test]
    fn capture_generations_are_monotonic() {
        let s = OwnerWindowLifecycleState::new();
        assert_eq!(s.next_capture_generation(), 1);
        assert_eq!(s.next_capture_generation(), 2);
        assert_ne!(s.next_capture_generation(), s.next_capture_generation());
    }
}

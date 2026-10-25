//! The service lifecycle state machine.
//!
//! Deliberately FFI-free so the transitions can be proven without an SCM. `scm.rs` drives this and
//! translates each published state into a `SERVICE_STATUS`; nothing here talks to Windows.

/// The states this service publishes. Exactly the four the contract requires — a service never
/// publishes "unknown" or "unavailable"; those belong to an OBSERVER watching from outside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceRunState {
    /// Accepted the start request; not yet serving.
    StartPending,
    /// Serving.
    Running,
    /// Accepted a stop request; winding down.
    StopPending,
    /// Terminal. A stopped service never runs again in this process.
    Stopped,
}

/// Why a transition was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionRefusal {
    /// The requested transition is not legal from the current state.
    IllegalTransition,
    /// The service is already stopped. Terminal: it can never be restarted in-process.
    AlreadyStopped,
}

/// Where a published state is sent.
///
/// Implemented by the real SCM reporter and by the console recorder. The distinction matters: only
/// one of them is authoritative, and [`Self::is_scm_authoritative`] is how the difference is stated
/// rather than assumed.
pub trait StatusSink {
    /// Publish a state. Returns false if the sink could not publish it.
    fn publish(&mut self, state: ServiceRunState) -> bool;

    /// Whether this sink reports to the real Service Control Manager.
    ///
    /// Console mode returns false and CANNOT be made to return true: it holds no service status
    /// handle, so nothing it does is visible to the SCM or can be mistaken for it.
    fn is_scm_authoritative(&self) -> bool;
}

/// The lifecycle. It owns the current state and permits only legal moves.
#[derive(Debug)]
pub struct ServiceLifecycle<S: StatusSink> {
    state: ServiceRunState,
    sink: S,
    stop_requested: bool,
}

impl<S: StatusSink> ServiceLifecycle<S> {
    /// Begin at `StartPending` and publish it immediately, so the SCM sees progress before any work.
    pub fn begin(mut sink: S) -> Self {
        sink.publish(ServiceRunState::StartPending);
        Self {
            state: ServiceRunState::StartPending,
            sink,
            stop_requested: false,
        }
    }

    /// The current published state.
    #[must_use]
    pub fn state(&self) -> ServiceRunState {
        self.state
    }

    /// Whether a stop has been requested.
    #[must_use]
    pub fn stop_requested(&self) -> bool {
        self.stop_requested
    }

    /// Whether the sink reports to the real SCM.
    #[must_use]
    pub fn is_scm_authoritative(&self) -> bool {
        self.sink.is_scm_authoritative()
    }

    /// `StartPending` -> `Running`.
    ///
    /// # Errors
    /// [`TransitionRefusal`] if the service is not start-pending, or is already stopped.
    pub fn running(&mut self) -> Result<(), TransitionRefusal> {
        self.move_to(ServiceRunState::Running, &[ServiceRunState::StartPending])
    }

    /// Accept a stop request from any live state. Idempotent: a second request is not an error, since
    /// the SCM may legitimately send one again.
    ///
    /// # Errors
    /// [`TransitionRefusal::AlreadyStopped`] once the service has stopped.
    pub fn request_stop(&mut self) -> Result<(), TransitionRefusal> {
        if self.state == ServiceRunState::Stopped {
            return Err(TransitionRefusal::AlreadyStopped);
        }
        self.stop_requested = true;
        if self.state == ServiceRunState::StopPending {
            return Ok(());
        }
        self.move_to(
            ServiceRunState::StopPending,
            &[ServiceRunState::StartPending, ServiceRunState::Running],
        )
    }

    /// `StopPending` -> `Stopped`. Terminal.
    ///
    /// # Errors
    /// [`TransitionRefusal`] if a stop was never requested, or the service already stopped.
    pub fn stopped(&mut self) -> Result<(), TransitionRefusal> {
        self.move_to(ServiceRunState::Stopped, &[ServiceRunState::StopPending])
    }

    fn move_to(
        &mut self,
        next: ServiceRunState,
        from: &[ServiceRunState],
    ) -> Result<(), TransitionRefusal> {
        if self.state == ServiceRunState::Stopped {
            return Err(TransitionRefusal::AlreadyStopped);
        }
        if !from.contains(&self.state) {
            return Err(TransitionRefusal::IllegalTransition);
        }
        self.state = next;
        self.sink.publish(next);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A recording sink. Not authoritative — exactly what console mode gets.
    #[derive(Debug, Default)]
    struct Recorder {
        published: Vec<ServiceRunState>,
    }

    impl StatusSink for Recorder {
        fn publish(&mut self, state: ServiceRunState) -> bool {
            self.published.push(state);
            true
        }
        fn is_scm_authoritative(&self) -> bool {
            false
        }
    }

    fn begin() -> ServiceLifecycle<Recorder> {
        ServiceLifecycle::begin(Recorder::default())
    }

    #[test]
    fn the_full_start_to_stop_sequence_is_published_in_order() {
        let mut l = begin();
        assert_eq!(l.state(), ServiceRunState::StartPending);
        l.running().expect("running");
        assert_eq!(l.state(), ServiceRunState::Running);
        l.request_stop().expect("stop requested");
        assert_eq!(l.state(), ServiceRunState::StopPending);
        assert!(l.stop_requested());
        l.stopped().expect("stopped");
        assert_eq!(l.state(), ServiceRunState::Stopped);
        assert_eq!(
            l.sink.published,
            vec![
                ServiceRunState::StartPending,
                ServiceRunState::Running,
                ServiceRunState::StopPending,
                ServiceRunState::Stopped,
            ]
        );
    }

    #[test]
    fn a_stop_during_start_still_reaches_a_clean_stop() {
        // A stop may arrive before the service ever reported Running.
        let mut l = begin();
        l.request_stop().expect("stop while start-pending");
        assert_eq!(l.state(), ServiceRunState::StopPending);
        l.stopped().expect("stopped");
        assert_eq!(l.state(), ServiceRunState::Stopped);
    }

    #[test]
    fn a_repeated_stop_request_is_accepted_without_changing_state() {
        let mut l = begin();
        l.running().unwrap();
        l.request_stop().unwrap();
        l.request_stop()
            .expect("a second stop request is not an error");
        assert_eq!(l.state(), ServiceRunState::StopPending);
        assert_eq!(
            l.sink
                .published
                .iter()
                .filter(|s| **s == ServiceRunState::StopPending)
                .count(),
            1,
            "the state is published once, not re-published"
        );
    }

    #[test]
    fn stopped_is_terminal() {
        let mut l = begin();
        l.running().unwrap();
        l.request_stop().unwrap();
        l.stopped().unwrap();
        for r in [l.running(), l.request_stop(), l.stopped()] {
            assert_eq!(r.unwrap_err(), TransitionRefusal::AlreadyStopped);
        }
        assert_eq!(l.state(), ServiceRunState::Stopped);
    }

    #[test]
    fn illegal_transitions_are_refused() {
        // Running -> Running, and Stopped without a stop request.
        let mut l = begin();
        l.running().unwrap();
        assert_eq!(
            l.running().unwrap_err(),
            TransitionRefusal::IllegalTransition
        );
        assert_eq!(
            l.stopped().unwrap_err(),
            TransitionRefusal::IllegalTransition
        );
        assert_eq!(l.state(), ServiceRunState::Running);
    }

    #[test]
    fn a_console_sink_is_never_scm_authoritative() {
        let l = begin();
        assert!(!l.is_scm_authoritative());
    }
}

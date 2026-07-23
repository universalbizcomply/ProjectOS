//! The COMPILE-ONLY ServiceFixture and its shutdown/residue model.
//!
//! This is not a service. It has no binary target, no `main`, and it never spawns a process, executes
//! a command, touches the filesystem, opens a pipe, queries the SCM, reaches the network or reads a
//! credential. It models, in memory, only the behaviour the proof needs from the far side: answering
//! `ControllerHello` with `ServiceReady`, refusing a replayed or wrong-role transcript, acknowledging a
//! bounded `ShutdownRequest`, and reporting whether it left residue.
//!
//! Handshake CONFIRMATION is deliberately NOT modelled here. It comes from the accepted opaque
//! state-machine contract in local-ipc, so this fixture cannot assert that a handshake succeeded.
//!
//! The fixture establishes no service authority. Its cooperation is a precondition of the proof, never
//! evidence for it.

/// What the fixture does when the bounded shutdown is requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FixtureShutdownBehaviour {
    /// Answers `ShutdownAcknowledged` — the only behaviour a positive proof accepts.
    Acknowledge,
    /// Never answers. The proof must refuse rather than assume success.
    WithholdAcknowledgement,
}

/// Whether the transport disconnected after shutdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FixtureDisconnectBehaviour {
    /// Disconnects cleanly.
    Disconnect,
    /// Leaves the transport connected. The proof must refuse.
    RemainConnected,
}

/// The closed residue classification the proof requires to be exactly `Zero`.
///
/// `Reserved` and `Occupied` model the B3 quarantine-capacity states: a slot reserved for an issued
/// operation, or one holding a transferred handle. Neither is clean, so neither may confirm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FixtureResidue {
    /// Nothing retained anywhere — the only value a positive proof accepts.
    Zero,
    /// An I/O operation is still pending.
    PendingIo,
    /// An operation was quarantined (its handle was transferred and not confirmed terminal).
    QuarantinedIo,
    /// A quarantine slot is reserved.
    QuarantineReserved,
    /// A quarantine slot is occupied.
    QuarantineOccupied,
    /// The controller retained a resource.
    ControllerResidue,
    /// The fixture retained a resource.
    FixtureResidue,
    /// Residue could not be determined — fails closed exactly like non-zero.
    Indeterminate,
}

impl FixtureResidue {
    /// Only an exactly-zero residue is clean. Anything else — including "unknown" — refuses.
    #[must_use]
    pub fn is_zero(self) -> bool {
        matches!(self, Self::Zero)
    }
}

/// The closed result of the bounded shutdown exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FixtureShutdownOutcome {
    /// The fixture answered `ShutdownAcknowledged`.
    Acknowledged,
    /// No acknowledgement arrived within the bounded exchange.
    NotAcknowledged,
}

/// A compile-only ServiceFixture.
///
/// Its behaviours are fixed at construction so a test can model an uncooperative or unclean peer
/// WITHOUT the controller ever accepting a caller-supplied success value: the controller still has to
/// observe the outcome through this seam.
#[derive(Debug)]
pub struct CompileOnlyServiceFixture {
    shutdown: FixtureShutdownBehaviour,
    disconnect: FixtureDisconnectBehaviour,
    residue: FixtureResidue,
}

impl CompileOnlyServiceFixture {
    /// A cooperative, clean fixture: acknowledges shutdown, disconnects, leaves no residue.
    #[must_use]
    pub fn cooperative() -> Self {
        Self {
            shutdown: FixtureShutdownBehaviour::Acknowledge,
            disconnect: FixtureDisconnectBehaviour::Disconnect,
            residue: FixtureResidue::Zero,
        }
    }

    /// A fixture with explicitly chosen behaviours, for negative modelling.
    #[must_use]
    pub fn with_behaviour(
        shutdown: FixtureShutdownBehaviour,
        disconnect: FixtureDisconnectBehaviour,
        residue: FixtureResidue,
    ) -> Self {
        Self {
            shutdown,
            disconnect,
            residue,
        }
    }

    /// Answer a bounded `ShutdownRequest`. In-memory only; issues no I/O.
    #[must_use]
    pub fn request_shutdown(&self) -> FixtureShutdownOutcome {
        match self.shutdown {
            FixtureShutdownBehaviour::Acknowledge => FixtureShutdownOutcome::Acknowledged,
            FixtureShutdownBehaviour::WithholdAcknowledgement => {
                FixtureShutdownOutcome::NotAcknowledged
            }
        }
    }

    /// Whether the transport disconnected. In-memory only.
    #[must_use]
    pub fn disconnected(&self) -> bool {
        matches!(self.disconnect, FixtureDisconnectBehaviour::Disconnect)
    }

    /// The residue this fixture leaves behind.
    #[must_use]
    pub fn classify_residue(&self) -> FixtureResidue {
        self.residue
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cooperative_fixture_is_clean() {
        let f = CompileOnlyServiceFixture::cooperative();
        assert_eq!(f.request_shutdown(), FixtureShutdownOutcome::Acknowledged);
        assert!(f.disconnected());
        assert!(f.classify_residue().is_zero());
    }

    #[test]
    fn only_zero_residue_is_clean() {
        assert!(FixtureResidue::Zero.is_zero());
        for r in [
            FixtureResidue::PendingIo,
            FixtureResidue::QuarantinedIo,
            FixtureResidue::QuarantineReserved,
            FixtureResidue::QuarantineOccupied,
            FixtureResidue::ControllerResidue,
            FixtureResidue::FixtureResidue,
            FixtureResidue::Indeterminate,
        ] {
            assert!(!r.is_zero(), "{r:?} must not count as clean");
        }
    }

    #[test]
    fn an_uncooperative_fixture_withholds_acknowledgement() {
        let f = CompileOnlyServiceFixture::with_behaviour(
            FixtureShutdownBehaviour::WithholdAcknowledgement,
            FixtureDisconnectBehaviour::RemainConnected,
            FixtureResidue::PendingIo,
        );
        assert_eq!(
            f.request_shutdown(),
            FixtureShutdownOutcome::NotAcknowledged
        );
        assert!(!f.disconnected());
        assert!(!f.classify_residue().is_zero());
    }

    #[test]
    fn fixture_output_carries_no_identity() {
        let rendered = format!("{:?}", CompileOnlyServiceFixture::cooperative());
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
    }
}

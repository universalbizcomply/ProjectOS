//! Closed process state model (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! `TRUST_ELIGIBLE` is deliberately ABSENT from this enum: trust eligibility is a later-phase
//! concept and must be unreachable here. The maximum state this phase can reach is
//! `RUNNING_UNTRUSTED`. No state name implies the child is secure or trusted.

use serde::Serialize;

/// Closed lifecycle state. No externally visible RUNNING state exists before process creation
/// succeeded, job membership was verified, handles were retained, and output observation is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProcessState {
    NotStarted,
    PreparingJob,
    PreparingPipes,
    CreatingProcess,
    /// Process exists AND `IsProcessInJob` confirmed membership AND handles are retained.
    CreatedInJob,
    /// Output drains + exit observer are active. Highest state reachable in this phase.
    RunningUntrusted,
    ShutdownRequested,
    Terminating,
    Terminated,
    Crashed,
    Blocked,
}

impl ProcessState {
    /// Terminal states — no further transition is meaningful.
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            ProcessState::Terminated | ProcessState::Crashed | ProcessState::Blocked
        )
    }

    /// Whether a live OS process is expected to exist in this state.
    pub const fn process_expected(self) -> bool {
        matches!(
            self,
            ProcessState::CreatedInJob
                | ProcessState::RunningUntrusted
                | ProcessState::ShutdownRequested
                | ProcessState::Terminating
        )
    }

    /// Owner-facing projection. Deliberately never reports "secure" or "trusted" — this phase
    /// cannot establish either.
    pub const fn owner_status(self) -> &'static str {
        match self {
            ProcessState::NotStarted => "STOPPED",
            ProcessState::PreparingJob
            | ProcessState::PreparingPipes
            | ProcessState::CreatingProcess => "STARTING",
            ProcessState::CreatedInJob | ProcessState::RunningUntrusted => "RUNNING_READ_ONLY",
            ProcessState::ShutdownRequested | ProcessState::Terminating => "STOPPING",
            ProcessState::Terminated => "STOPPED",
            ProcessState::Crashed => "CRASHED",
            ProcessState::Blocked => "BLOCKED",
        }
    }
}

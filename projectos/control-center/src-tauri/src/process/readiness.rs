//! Deterministic daemon readiness (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! WHY THIS EXISTS. `InProcessTransport::connect()` emits `{"kind":"snapshot",…}` synchronously at
//! startup — but `requestSnapshot()` and every bus event emit the SAME `kind`, with no protocol
//! version and no instance id. So "the first valid daemon message" cannot distinguish *ready* from
//! an *ordinary snapshot*, and — worse — cannot distinguish a NEW daemon's first snapshot from a
//! STALE daemon's routine output, which would let a dying process mark a replacement owner ready.
//!
//! Readiness is therefore an EXPLICIT, typed, versioned, instance-bound lifecycle message:
//!   {"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"<id>","status":"read-only"}
//!
//! Readiness is NOT trust, NOT identity verification, and does NOT enable protected approvals.
//! Process creation, "process running", timer registration and snapshot output can never satisfy it.

use serde::Deserialize;

use super::errors::ProcessError;

/// The only accepted lifecycle protocol version.
pub(crate) const LIFECYCLE_PROTOCOL_VERSION: u32 = 1;
/// The only accepted ready `type`.
pub(crate) const LIFECYCLE_READY_TYPE: &str = "lifecycle.ready";
/// The only accepted ready `status`.
pub(crate) const LIFECYCLE_READY_STATUS: &str = "read-only";
/// Hard cap on any single line we will even attempt to parse as lifecycle.
pub(crate) const MAX_LIFECYCLE_LINE_BYTES: usize = 4 * 1024;

/// Closed ready schema. `deny_unknown_fields` means a tampered or extended message is rejected
/// rather than partially honoured.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LifecycleReady {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u32,
    daemon_instance_id: String,
    status: String,
}

/// Classification of one stdout line during startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineClass {
    /// A valid, instance-matched `lifecycle.ready`.
    Ready,
    /// Anything else that is not lifecycle-shaped (ordinary transport output, etc.).
    NotLifecycle,
}

/// Decide whether a line is THE ready message for `expected_instance`.
///
/// Returns `Err` only for a line that IS lifecycle-shaped but invalid (wrong version, wrong
/// instance, bad status) — those are hard failures, never "keep waiting". An ordinary snapshot is
/// simply `NotLifecycle`.
pub(crate) fn classify_line(
    line: &str,
    expected_instance: &str,
) -> Result<LineClass, ProcessError> {
    if line.len() > MAX_LIFECYCLE_LINE_BYTES {
        // Oversize: cannot be our bounded ready line. Not lifecycle; the drain bounds it anyway.
        return Ok(LineClass::NotLifecycle);
    }
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return Ok(LineClass::NotLifecycle);
    }
    // Cheap discriminator first: ordinary transport messages use `kind`, never `type`.
    if !trimmed.contains("\"type\"") || !trimmed.contains(LIFECYCLE_READY_TYPE) {
        return Ok(LineClass::NotLifecycle);
    }
    let parsed: LifecycleReady = match serde_json::from_str(trimmed) {
        Ok(p) => p,
        // Lifecycle-shaped but malformed/unknown-field ⇒ reject, do not keep waiting.
        Err(_) => return Err(ProcessError::LifecycleMessageMalformed),
    };
    if parsed.kind != LIFECYCLE_READY_TYPE {
        return Ok(LineClass::NotLifecycle);
    }
    if parsed.protocol_version != LIFECYCLE_PROTOCOL_VERSION {
        return Err(ProcessError::LifecycleProtocolMismatch);
    }
    if parsed.status != LIFECYCLE_READY_STATUS {
        return Err(ProcessError::LifecycleMessageMalformed);
    }
    if parsed.daemon_instance_id != expected_instance {
        // A stale daemon (or a wrong one) announcing readiness at our owner.
        return Err(ProcessError::DaemonInstanceMismatch);
    }
    Ok(LineClass::Ready)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "host1-1";

    fn ready_line(id: &str) -> String {
        format!(
            r#"{{"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"{id}","status":"read-only"}}"#
        )
    }

    #[test]
    fn exact_ready_message_accepted() {
        assert_eq!(classify_line(&ready_line(ID), ID), Ok(LineClass::Ready));
    }

    #[test]
    fn ordinary_snapshot_never_satisfies_readiness() {
        // This is the REAL line InProcessTransport::connect() emits at startup.
        let snapshot = r#"{"kind":"snapshot","snapshot":{"health":{},"workers":[],"phases":[],"projects":[],"notifications":[]}}"#;
        assert_eq!(classify_line(snapshot, ID), Ok(LineClass::NotLifecycle));
    }

    #[test]
    fn ordinary_event_never_satisfies_readiness() {
        let ev = r#"{"kind":"event","event":{"id":"1","at":"t","type":"x","project":"p","phase":"f","actor":"a"}}"#;
        assert_eq!(classify_line(ev, ID), Ok(LineClass::NotLifecycle));
    }

    #[test]
    fn wrong_instance_id_rejected() {
        assert_eq!(
            classify_line(&ready_line("host1-2"), ID),
            Err(ProcessError::DaemonInstanceMismatch)
        );
    }

    #[test]
    fn wrong_protocol_version_rejected() {
        let l = r#"{"type":"lifecycle.ready","protocolVersion":2,"daemonInstanceId":"host1-1","status":"read-only"}"#;
        assert_eq!(
            classify_line(l, ID),
            Err(ProcessError::LifecycleProtocolMismatch)
        );
    }

    #[test]
    fn wrong_status_rejected() {
        let l = r#"{"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"host1-1","status":"read-write"}"#;
        assert_eq!(
            classify_line(l, ID),
            Err(ProcessError::LifecycleMessageMalformed)
        );
    }

    #[test]
    fn missing_instance_id_rejected() {
        let l = r#"{"type":"lifecycle.ready","protocolVersion":1,"status":"read-only"}"#;
        assert_eq!(
            classify_line(l, ID),
            Err(ProcessError::LifecycleMessageMalformed)
        );
    }

    #[test]
    fn unknown_field_rejected() {
        let l = r#"{"type":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"host1-1","status":"read-only","trusted":true}"#;
        assert_eq!(
            classify_line(l, ID),
            Err(ProcessError::LifecycleMessageMalformed)
        );
    }

    #[test]
    fn unknown_lifecycle_type_is_not_ready() {
        let l = r#"{"type":"lifecycle.other","protocolVersion":1,"daemonInstanceId":"host1-1","status":"read-only"}"#;
        // Not our ready type → not lifecycle-ready. It must not transition readiness.
        assert_ne!(classify_line(l, ID), Ok(LineClass::Ready));
    }

    #[test]
    fn malformed_lifecycle_json_rejected() {
        let l = r#"{"type":"lifecycle.ready","protocolVersion":"#;
        assert_eq!(
            classify_line(l, ID),
            Err(ProcessError::LifecycleMessageMalformed)
        );
    }

    #[test]
    fn non_json_line_is_not_lifecycle() {
        assert_eq!(
            classify_line("worker starting", ID),
            Ok(LineClass::NotLifecycle)
        );
        assert_eq!(classify_line("", ID), Ok(LineClass::NotLifecycle));
    }

    #[test]
    fn oversized_line_is_not_lifecycle() {
        let big = format!(
            "{{\"type\":\"lifecycle.ready\",\"pad\":\"{}\"}}",
            "x".repeat(MAX_LIFECYCLE_LINE_BYTES)
        );
        assert_eq!(classify_line(&big, ID), Ok(LineClass::NotLifecycle));
    }

    #[test]
    fn a_snapshot_claiming_to_be_ready_by_kind_is_rejected() {
        // Defence: an attacker-shaped line using `kind` instead of `type` must not pass.
        let l = r#"{"kind":"lifecycle.ready","protocolVersion":1,"daemonInstanceId":"host1-1","status":"read-only"}"#;
        assert_eq!(classify_line(l, ID), Ok(LineClass::NotLifecycle));
    }
}

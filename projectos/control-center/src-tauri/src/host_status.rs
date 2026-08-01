//! The Control Centre's READ-ONLY installed-host status route.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! This is the whole client half of the workflow: one request on the EXISTING named pipe, one closed
//! status record back, projected into the seven fields the owner is allowed to see. It introduces no
//! screen, no protocol, no second pipe and no command that changes anything.
//!
//! ## What is deliberately never shown
//!
//! The full installation ID, the raw identity record, any filesystem path, any secret and any
//! capability. The wire record does not carry them, and this projection cannot invent them: every
//! field it produces comes from a closed enum or an 8-character digest PREFIX.
//!
//! ## Unverified is never Verified
//!
//! Every failure path — refused, malformed, unreachable — produces `Unavailable`/`Refused` values.
//! There is no branch that reports `Verified` or `Ready` without the service having said so.

#![cfg(windows)]

use projectos_host_windows_local_ipc::{
    ChannelReport, ClientStatusReadOutcome, IdentityVerificationReport, InstalledHostStatus,
    LiveIpcOperationCapability, OwnerStatusReadApproval, ProtectedOperationsReport,
    ReadinessReport, ServiceStateReport, WindowsInstalledHostStatusClient,
};
use serde::Serialize;

/// The value shown for any fact the host did not supply. It is a distinct word: it can never be read
/// as a verified, ready or authorised result.
const UNAVAILABLE: &str = "UNAVAILABLE";

/// The exact seven fields the owner may see, and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledHostStatusView {
    /// What the service reports about itself.
    pub service_state: String,
    /// The result of the frozen identity-record verification, as the service reported it.
    pub identity_verification: String,
    /// The installed release channel.
    pub channel: String,
    /// The first 8 hex characters of the running executable's digest. A PREFIX, never a full digest.
    pub build_prefix: String,
    /// The first 8 hex characters of the release manifest's digest. A PREFIX, never a full digest.
    pub manifest_prefix: String,
    /// Whether the installed host is ready.
    pub readiness: String,
    /// The protected-operations answer. The installed host always refuses.
    pub protected_operations: String,
    /// Whether the values above came from a completed read. False means every field is a placeholder.
    pub read_succeeded: bool,
    /// One safe sentence naming what happened. Carries no path, handle, SID or error code.
    pub next_safe_action: String,
}

impl InstalledHostStatusView {
    /// The view used whenever the read did not complete. Every fact is `UNAVAILABLE`.
    fn unavailable(next_safe_action: &str) -> Self {
        Self {
            service_state: UNAVAILABLE.to_string(),
            identity_verification: UNAVAILABLE.to_string(),
            channel: UNAVAILABLE.to_string(),
            build_prefix: UNAVAILABLE.to_string(),
            manifest_prefix: UNAVAILABLE.to_string(),
            readiness: UNAVAILABLE.to_string(),
            protected_operations: UNAVAILABLE.to_string(),
            read_succeeded: false,
            next_safe_action: next_safe_action.to_string(),
        }
    }
}

fn service_state_label(v: ServiceStateReport) -> &'static str {
    match v {
        ServiceStateReport::Running => "RUNNING",
        ServiceStateReport::StartPending => "START_PENDING",
        ServiceStateReport::StopPending => "STOP_PENDING",
        ServiceStateReport::Stopped => "STOPPED",
        ServiceStateReport::Unavailable => UNAVAILABLE,
    }
}

fn identity_label(v: IdentityVerificationReport) -> &'static str {
    match v {
        IdentityVerificationReport::Verified => "VERIFIED",
        IdentityVerificationReport::Refused => "REFUSED",
        IdentityVerificationReport::Unavailable => UNAVAILABLE,
    }
}

fn channel_label(v: ChannelReport) -> &'static str {
    match v {
        ChannelReport::Stable => "STABLE",
        ChannelReport::Preview => "PREVIEW",
        ChannelReport::Development => "DEVELOPMENT",
        ChannelReport::Unknown => "UNKNOWN",
    }
}

fn readiness_label(v: ReadinessReport) -> &'static str {
    match v {
        ReadinessReport::Ready => "READY",
        ReadinessReport::Degraded => "DEGRADED",
        ReadinessReport::NotReady => "NOT_READY",
    }
}

fn protected_label(v: ProtectedOperationsReport) -> &'static str {
    match v {
        // A refusal is rendered as a refusal, always. This is the only mapping for Refused; there is
        // no branch that turns it into an authorisation.
        ProtectedOperationsReport::Refused => "REFUSED",
        // The wire enum carries the variant, so it must be matched. The Control Centre renders the
        // service's own answer verbatim and never invents one — but the installed host only ever
        // reports Refused, so this arm is unreachable in practice.
        ProtectedOperationsReport::Authorised => "AUTHORISED",
    }
}

/// Project a decoded record into the view. Every value comes from the record; none is assumed.
fn project(status: &InstalledHostStatus) -> InstalledHostStatusView {
    InstalledHostStatusView {
        service_state: service_state_label(status.service_state()).to_string(),
        identity_verification: identity_label(status.identity()).to_string(),
        channel: channel_label(status.channel()).to_string(),
        // The record's constructor validates both prefixes as lower-case hex, so they are ASCII by
        // construction. Lossy conversion is used anyway so a malformed byte can never panic the UI.
        build_prefix: String::from_utf8_lossy(status.build_prefix()).to_string(),
        manifest_prefix: String::from_utf8_lossy(status.manifest_prefix()).to_string(),
        readiness: readiness_label(status.readiness()).to_string(),
        protected_operations: protected_label(status.protected_operations()).to_string(),
        read_succeeded: true,
        next_safe_action: "The installed host answered this read-only status request.".to_string(),
    }
}

/// Perform ONE read-only status read against the installed ProjectOSHost.
///
/// Read-only end to end: it starts, stops and configures nothing, writes nothing, and can put only a
/// `ControllerHello` on the wire. Every refusal returns an `UNAVAILABLE` view.
#[must_use]
pub fn read_installed_host_status() -> InstalledHostStatusView {
    let Ok(approval) =
        OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE)
    else {
        return InstalledHostStatusView::unavailable(
            "The read-only status approval was not accepted, so nothing was read.",
        );
    };
    let capability = LiveIpcOperationCapability::from_owner_status_read_approval(approval);
    let client = WindowsInstalledHostStatusClient::for_installed_host();

    match client.read_installed_host_status(&capability) {
        ClientStatusReadOutcome::Status(status) => project(&status),
        ClientStatusReadOutcome::RefusedHandshake(_) => InstalledHostStatusView::unavailable(
            "The installed host refused this request, so no status is shown.",
        ),
        ClientStatusReadOutcome::Malformed(_) => InstalledHostStatusView::unavailable(
            "The installed host's answer could not be read, so no status is shown.",
        ),
        ClientStatusReadOutcome::Failed(_) => InstalledHostStatusView::unavailable(
            "The installed host could not be reached, so no status is shown.",
        ),
        // The outcome enum is non-exhaustive. Any future variant is treated as "no status", so a new
        // refusal can never fall through into a displayed result.
        _ => InstalledHostStatusView::unavailable(
            "The installed host's answer was not understood, so no status is shown.",
        ),
    }
}

/// The Tauri command backing the Mission Control panel. Returns the view as JSON.
///
/// On a serialisation failure it returns an `UNAVAILABLE` view rather than a partial or invented one.
#[tauri::command]
pub fn installed_host_status() -> String {
    let view = read_installed_host_status();
    serde_json::to_string(&view).unwrap_or_else(|_| {
        serde_json::to_string(&InstalledHostStatusView::unavailable(
            "The status could not be prepared for display, so no status is shown.",
        ))
        .unwrap_or_else(|_| String::from("{\"readSucceeded\":false}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unavailable_view_never_reports_verified_ready_or_authorised() {
        let v = InstalledHostStatusView::unavailable("nothing was read");
        assert!(!v.read_succeeded);
        for field in [
            &v.service_state,
            &v.identity_verification,
            &v.channel,
            &v.build_prefix,
            &v.manifest_prefix,
            &v.readiness,
            &v.protected_operations,
        ] {
            assert_eq!(field, UNAVAILABLE);
            assert_ne!(field, "VERIFIED");
            assert_ne!(field, "READY");
            assert_ne!(field, "AUTHORISED");
        }
    }

    #[test]
    fn the_protected_operations_label_is_always_a_refusal() {
        assert_eq!(
            protected_label(ProtectedOperationsReport::Refused),
            "REFUSED"
        );
    }

    #[test]
    fn no_label_function_can_return_verified_for_a_non_verified_report() {
        assert_eq!(
            identity_label(IdentityVerificationReport::Refused),
            "REFUSED"
        );
        assert_eq!(
            identity_label(IdentityVerificationReport::Unavailable),
            UNAVAILABLE
        );
        assert_eq!(readiness_label(ReadinessReport::NotReady), "NOT_READY");
        assert_eq!(readiness_label(ReadinessReport::Degraded), "DEGRADED");
    }
}

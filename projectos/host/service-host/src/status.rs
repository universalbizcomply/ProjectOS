//! Building the READ-ONLY installed-host status record.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! Every fact is observed, never asserted. The identity result comes from the frozen `verify_record`
//! contract, so a record that does not verify is reported as `Refused` — this module has no way to
//! claim `Verified` without the reader having said so. Protected operations are always `Refused`;
//! nothing here can authorise one.
//!
//! It is read-only: it reads its own executable and the installed identity record, and writes nothing.

use projectos_host_identity::canonical_record::{
    verify_record, InstallationIdentityRecordV1, RecordInstallationEvidence, RECORD_FILE_NAME,
    RECORD_SUBDIRECTORY,
};
use projectos_host_identity::sha256_hex;
use projectos_host_windows_local_ipc::{
    ChannelReport, IdentityVerificationReport, InstalledHostStatus, ProtectedOperationsReport,
    ReadinessReport, ServiceStateReport, STATUS_PREFIX_LEN,
};

/// The all-zero prefix used when a fact is genuinely unavailable.
///
/// It is lower-case hex so the record stays well-formed, and it is paired with an `Unavailable` /
/// `Refused` enum so it can never be mistaken for a real digest.
const UNAVAILABLE_PREFIX: [u8; STATUS_PREFIX_LEN] = *b"00000000";

/// Take the first [`STATUS_PREFIX_LEN`] characters of a lower-case hex string.
///
/// Returns the unavailable prefix if the input is too short or is not lower-case hex, so a malformed
/// value can never be presented as a genuine prefix.
fn prefix_of(hex: &str) -> [u8; STATUS_PREFIX_LEN] {
    let bytes = hex.as_bytes();
    if bytes.len() < STATUS_PREFIX_LEN {
        return UNAVAILABLE_PREFIX;
    }
    let mut out = [0u8; STATUS_PREFIX_LEN];
    out.copy_from_slice(&bytes[..STATUS_PREFIX_LEN]);
    if out
        .iter()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
    {
        out
    } else {
        UNAVAILABLE_PREFIX
    }
}

/// The build identity prefix: the first 8 hex characters of this executable's own SHA-256.
///
/// Read-only, and it hashes the image this process was started from — it cannot be told to hash
/// something else.
fn build_prefix() -> [u8; STATUS_PREFIX_LEN] {
    let Ok(path) = std::env::current_exe() else {
        return UNAVAILABLE_PREFIX;
    };
    let Ok(bytes) = std::fs::read(path) else {
        return UNAVAILABLE_PREFIX;
    };
    prefix_of(&sha256_hex(&bytes))
}

/// The installed record's location, derived from the frozen contract segments beneath the resolved
/// ProgramData anchor. No path is taken from a caller, an argument or the environment.
fn record_path() -> Option<std::path::PathBuf> {
    let root = projectos_windows_runtime_primitives::known_folder::resolve_program_data().ok()?;
    Some(
        root.join(projectos_host_identity::canonical_record::EXPECTED_PRODUCT)
            .join(projectos_host_identity::canonical_record::HOST_STATE_DIRECTORY_SEGMENT)
            .join(RECORD_SUBDIRECTORY)
            .join(RECORD_FILE_NAME),
    )
}

/// Read and verify the installed canonical identity record.
///
/// Returns the verification outcome together with the record it verified, if any. A missing,
/// unparseable or unverifiable record yields `Refused` / `Unavailable` and NO record — there is no
/// path that reports success without `verify_record` having accepted it.
fn read_and_verify() -> (
    IdentityVerificationReport,
    Option<InstallationIdentityRecordV1>,
) {
    let Some(path) = record_path() else {
        return (IdentityVerificationReport::Unavailable, None);
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return (IdentityVerificationReport::Unavailable, None);
    };
    let Ok(record) = serde_json::from_slice::<InstallationIdentityRecordV1>(&bytes) else {
        // Present but unparseable is a REFUSAL, not an absence: something is there and it is wrong.
        return (IdentityVerificationReport::Refused, None);
    };
    // The frozen reader contract decides. It recomputes the digest, checks every frozen binding and
    // refuses the placeholder digest.
    match verify_record(&record, RecordInstallationEvidence::Matched) {
        Ok(_verified) => (IdentityVerificationReport::Verified, Some(record)),
        Err(_) => (IdentityVerificationReport::Refused, Some(record)),
    }
}

/// Map the record's channel string onto the closed report enum. An unrecognised value is `Unknown`.
fn channel_of(record: Option<&InstallationIdentityRecordV1>) -> ChannelReport {
    match record.map(|r| r.channel.as_str()) {
        Some("stable") => ChannelReport::Stable,
        Some("preview") => ChannelReport::Preview,
        Some("development") => ChannelReport::Development,
        _ => ChannelReport::Unknown,
    }
}

/// Observe the current installed-host status.
///
/// `service_state` is what the service itself is publishing, passed in by the caller that owns the
/// lifecycle — this module does not guess it.
#[must_use]
pub fn observe(service_state: ServiceStateReport) -> InstalledHostStatus {
    let (identity, record) = read_and_verify();

    // Readiness follows the identity result. A host whose identity does not verify is NOT ready, and
    // there is no branch that reports Ready without a Verified identity.
    let readiness = match identity {
        IdentityVerificationReport::Verified => {
            if service_state == ServiceStateReport::Running {
                ReadinessReport::Ready
            } else {
                ReadinessReport::Degraded
            }
        }
        IdentityVerificationReport::Refused | IdentityVerificationReport::Unavailable => {
            ReadinessReport::NotReady
        }
    };

    let manifest_prefix = record.as_ref().map_or(UNAVAILABLE_PREFIX, |r| {
        prefix_of(&r.release_manifest_digest)
    });

    InstalledHostStatus::new(
        service_state,
        identity,
        channel_of(record.as_ref()),
        readiness,
        // FROZEN: this phase authorises no protected operation, so the answer is always Refused.
        ProtectedOperationsReport::Refused,
        build_prefix(),
        manifest_prefix,
    )
    // Both prefixes are produced by `prefix_of`, which only ever returns lower-case hex, so this
    // cannot fail. Falling back to a fully-unavailable record keeps the service from panicking even
    // if that ever stopped being true.
    .unwrap_or_else(|_| {
        InstalledHostStatus::new(
            service_state,
            IdentityVerificationReport::Unavailable,
            ChannelReport::Unknown,
            ReadinessReport::NotReady,
            ProtectedOperationsReport::Refused,
            UNAVAILABLE_PREFIX,
            UNAVAILABLE_PREFIX,
        )
        .expect("the unavailable prefixes are lower-case hex")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_or_non_hex_value_never_becomes_a_prefix() {
        assert_eq!(prefix_of("abc"), UNAVAILABLE_PREFIX);
        assert_eq!(prefix_of(""), UNAVAILABLE_PREFIX);
        assert_eq!(prefix_of("ABCDEF01"), UNAVAILABLE_PREFIX, "upper case");
        assert_eq!(prefix_of("zzzzzzzz"), UNAVAILABLE_PREFIX);
        assert_eq!(prefix_of("0a1b2c3d9999"), *b"0a1b2c3d");
    }

    #[test]
    fn an_unrecognised_channel_is_unknown_not_guessed() {
        assert_eq!(channel_of(None), ChannelReport::Unknown);
    }

    #[test]
    fn protected_operations_are_always_refused() {
        // Whatever the service state, this phase authorises nothing.
        for s in [
            ServiceStateReport::Running,
            ServiceStateReport::Stopped,
            ServiceStateReport::StartPending,
        ] {
            assert_eq!(
                observe(s).protected_operations(),
                ProtectedOperationsReport::Refused
            );
        }
    }

    #[test]
    fn readiness_is_never_ready_without_a_verified_identity() {
        let s = observe(ServiceStateReport::Running);
        if s.identity() != IdentityVerificationReport::Verified {
            assert_ne!(s.readiness(), ReadinessReport::Ready);
        }
    }
}

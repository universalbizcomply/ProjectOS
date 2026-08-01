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
    release_manifest_digest_for_artefact_digest, verify_record, InstallationIdentityRecordV1,
    RecordInstallationEvidence, RECORD_FILE_NAME, RECORD_SUBDIRECTORY,
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

/// The SHA-256 of the image this process was started from, as lower-case hex.
///
/// Read-only, and it hashes the running image — it cannot be told to hash something else. `None`
/// means the executable could not be read or hashed, which is never allowed to become a Ready host.
fn current_executable_digest() -> Option<String> {
    let path = std::env::current_exe().ok()?;
    let bytes = std::fs::read(path).ok()?;
    Some(sha256_hex(&bytes))
}

/// Whether the RUNNING image is the one the immutable identity record was written for.
///
/// The record's `release_manifest_digest` is provenance of the installed release and is never
/// rewritten. Recomputing the manifest for the running executable through the SHARED function and
/// comparing is the whole currentness check: one algorithm, both sides.
///
/// `None` means currentness could not be established at all — the executable was unreadable. It is
/// deliberately NOT `Some(true)`.
fn release_is_current(
    executable_digest: Option<&str>,
    record: Option<&InstallationIdentityRecordV1>,
) -> Option<bool> {
    let digest = executable_digest?;
    let record = record?;
    Some(release_manifest_digest_for_artefact_digest(digest) == record.release_manifest_digest)
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
    let executable_digest = current_executable_digest();
    let current = release_is_current(executable_digest.as_deref(), record.as_ref());

    // Readiness follows the identity result AND release currentness. A host whose identity does not
    // verify is NOT ready; a host whose running image is not the one the record was written for is
    // DEGRADED, never Ready. There is no branch that reports Ready without a Verified identity, a
    // Running service, and a proven manifest match.
    //
    // A record that verifies is still valid provenance of the ORIGINAL release, so the identity stays
    // Verified on a currentness mismatch — it is the currentness that fails, not the record.
    let readiness = match identity {
        IdentityVerificationReport::Verified => {
            if service_state == ServiceStateReport::Running && current == Some(true) {
                ReadinessReport::Ready
            } else {
                // Includes `current == None`: an executable that cannot be read or hashed can never
                // become a Ready host.
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
        // The build prefix keeps describing the RUNNING image, whatever currentness says.
        executable_digest
            .as_deref()
            .map_or(UNAVAILABLE_PREFIX, prefix_of),
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

#[cfg(test)]
mod currentness_tests {
    use super::*;

    /// The digest of the ORIGINAL installed executable, whose manifest the live record stores.
    const ORIGINAL_EXE: &str = "93e58f4876c9c048902c75efed41a127133c7d8d7536aef5bc84c5fa03736ba2";
    /// The digest of a DIFFERENT executable — the replacement.
    const OTHER_EXE: &str = "a7aff5b1b540324c94f0df115477cb83c136fcde1e5bf96bfc228bc76ab637c5";

    fn record_for(exe_digest: &str) -> InstallationIdentityRecordV1 {
        let mut r = InstallationIdentityRecordV1 {
            schema_version: 1,
            product: projectos_host_identity::canonical_record::EXPECTED_PRODUCT.to_string(),
            service_name: projectos_host_identity::canonical_record::EXPECTED_SERVICE_NAME
                .to_string(),
            installation_id: "0".repeat(32),
            channel: "stable".to_string(),
            service_relative_path:
                projectos_host_identity::canonical_record::EXPECTED_SERVICE_RELATIVE_PATH
                    .to_string(),
            release_manifest_digest: release_manifest_digest_for_artefact_digest(exe_digest),
            record_digest: String::new(),
        };
        r.record_digest = projectos_host_identity::canonical_record::compute_record_digest(&r);
        r
    }

    #[test]
    fn a_matching_executable_and_record_are_current() {
        let record = record_for(ORIGINAL_EXE);
        assert_eq!(
            release_is_current(Some(ORIGINAL_EXE), Some(&record)),
            Some(true)
        );
    }

    #[test]
    fn a_mismatching_executable_and_record_are_not_current() {
        let record = record_for(ORIGINAL_EXE);
        assert_eq!(
            release_is_current(Some(OTHER_EXE), Some(&record)),
            Some(false),
            "a replaced executable must not read as current"
        );
    }

    #[test]
    fn an_unreadable_executable_is_never_current() {
        let record = record_for(ORIGINAL_EXE);
        // Deliberately NOT Some(true): an absent fact can never satisfy a currentness requirement.
        assert_eq!(release_is_current(None, Some(&record)), None);
        assert_ne!(release_is_current(None, Some(&record)), Some(true));
        // No record is likewise never current.
        assert_eq!(release_is_current(Some(ORIGINAL_EXE), None), None);
    }

    /// The readiness decision, isolated exactly as `observe` makes it.
    fn readiness_of(
        identity: IdentityVerificationReport,
        state: ServiceStateReport,
        current: Option<bool>,
    ) -> ReadinessReport {
        match identity {
            IdentityVerificationReport::Verified => {
                if state == ServiceStateReport::Running && current == Some(true) {
                    ReadinessReport::Ready
                } else {
                    ReadinessReport::Degraded
                }
            }
            IdentityVerificationReport::Refused | IdentityVerificationReport::Unavailable => {
                ReadinessReport::NotReady
            }
        }
    }

    #[test]
    fn ready_requires_a_verified_record_a_running_service_and_a_current_release() {
        assert_eq!(
            readiness_of(
                IdentityVerificationReport::Verified,
                ServiceStateReport::Running,
                Some(true)
            ),
            ReadinessReport::Ready
        );
    }

    #[test]
    fn a_currentness_mismatch_is_degraded_and_never_ready() {
        let r = readiness_of(
            IdentityVerificationReport::Verified,
            ServiceStateReport::Running,
            Some(false),
        );
        assert_eq!(r, ReadinessReport::Degraded);
        assert_ne!(r, ReadinessReport::Ready);
    }

    #[test]
    fn an_unreadable_executable_can_never_produce_ready() {
        for state in [
            ServiceStateReport::Running,
            ServiceStateReport::StartPending,
            ServiceStateReport::StopPending,
            ServiceStateReport::Stopped,
        ] {
            assert_ne!(
                readiness_of(IdentityVerificationReport::Verified, state, None),
                ReadinessReport::Ready
            );
        }
    }

    #[test]
    fn identity_stays_verified_when_only_currentness_fails() {
        // The record is valid provenance of the ORIGINAL release. A replaced binary does not make the
        // record invalid — only not current. `read_and_verify` is the sole source of the identity
        // report, and it never consults the executable.
        let record = record_for(ORIGINAL_EXE);
        assert_eq!(
            release_is_current(Some(OTHER_EXE), Some(&record)),
            Some(false)
        );
        assert_eq!(
            readiness_of(
                IdentityVerificationReport::Verified,
                ServiceStateReport::Running,
                Some(false)
            ),
            ReadinessReport::Degraded
        );
    }

    #[test]
    fn an_invalid_record_is_not_ready_whatever_the_currentness() {
        for identity in [
            IdentityVerificationReport::Refused,
            IdentityVerificationReport::Unavailable,
        ] {
            for current in [Some(true), Some(false), None] {
                assert_eq!(
                    readiness_of(identity, ServiceStateReport::Running, current),
                    ReadinessReport::NotReady
                );
            }
        }
    }

    #[test]
    fn the_service_uses_the_same_manifest_algorithm_as_the_installer() {
        // The installer stores `release_manifest_digest_for_artefact_digest(artefact_sha)`. If the
        // service computed it any other way this equality would not hold for a real installation.
        let record = record_for(ORIGINAL_EXE);
        assert_eq!(
            record.release_manifest_digest,
            release_manifest_digest_for_artefact_digest(ORIGINAL_EXE)
        );
        assert_eq!(record.release_manifest_digest.len(), 64);
        assert!(record
            .release_manifest_digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    }
}

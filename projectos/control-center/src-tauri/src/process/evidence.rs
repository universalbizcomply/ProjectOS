//! Persisted daemon lifecycle evidence (WINDOWS-HOST-ABNORMAL-OVERLAP-RECOVERY-BARRIER1B).
//!
//! This is the ONLY persisted lifecycle artifact. It is HOST-authored (never daemon-authored): the
//! pid and creation time come from the kernel at `CreateProcessW`, not from any child claim. The
//! record's presence is never authority — it only points the recovery barrier at the kernel object
//! (`OpenProcess` + creation-time match) that IS the evidence.
//!
//! Atomicity contract (proven for the pinned toolchain, rustc 1.96.1): `std::fs::rename` on Windows
//! is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` with a `SetFileInformationByHandle(FileRenameInfoEx,
//! REPLACE_IF_EXISTS | POSIX_SEMANTICS)` fallback — a reader of the canonical name sees one complete
//! old record or one complete new record, never a partial one. The temp file is created in the SAME
//! directory (same volume ⇒ metadata rename), fully written, then `sync_all` (FlushFileBuffers)
//! before replacement. Power-loss rename durability is deliberately NOT load-bearing: power loss
//! kills every process, so after reboot no recorded pid+creation-time can match a live process.
//!
//! THREAT BOUNDARY (binding): this store is crash-safe under the trusted-Windows-account model. It
//! is NOT resistant to deliberate deletion or modification by another process running as the same
//! Windows account — same-account deletion can remove evidence of a still-terminating prior daemon
//! and reintroduce a bounded overlap (bounded by Job termination). No claim of same-account tamper
//! resistance is made or permitted, and no write/protected authority may rely on one. The owner
//! threat-boundary decision is DEFERRED.

#![cfg(windows)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::errors::ProcessError;

/// The only evidence schema version this build reads or writes.
pub const EVIDENCE_SCHEMA_VERSION: u32 = 1;
/// Bounded replace retry against transient sharing violations (AV/indexer class).
const REPLACE_RETRY_ATTEMPTS: u32 = 5;
const REPLACE_RETRY_DELAY_MS: u64 = 100;
/// Hard cap on a record we will even attempt to parse. A valid record is a few hundred bytes.
const MAX_RECORD_BYTES: u64 = 16 * 1024;

/// Monotonic per-process counter making temp names unique within this host.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Closed evidence states.
///
/// STARTING and RUNNING both mean "a process with this exact pid + creation time may exist" and a
/// replacement must verify against the kernel identically for both — STARTING is never "safe to
/// ignore" and never permission to launch. STOPPED means termination was observed or independently
/// proven.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceState {
    Starting,
    Running,
    Stopped,
}

/// Schema v1. `deny_unknown_fields`: a tampered or extended record is rejected, never partially
/// honoured. `pid`/`creationTimeFiletime` are optional so a STOPPED record carries no process
/// claim; a STARTING/RUNNING record without both is classified stale (no claim to verify).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub schema_version: u32,
    pub channel: String,
    pub user16: String,
    pub install16: String,
    pub host_instance_id: String,
    pub daemon_instance_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_time_filetime: Option<u64>,
    pub state: EvidenceState,
    pub recorded_at_utc: String,
}

/// Non-secret scope correlation: the same digests that scope the global instance mutex. The raw
/// SID and install path never appear in the record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceScope {
    pub channel: String,
    pub user16: String,
    pub install16: String,
}

/// Seconds-since-epoch timestamp string. Informational only — never load-bearing for safety.
fn now_utc_string() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix-{secs}")
}

impl EvidenceRecord {
    /// Whether the record's process-instance identity claim is consistent with its state
    /// (RECOVERY-BARRIER1C). This is THE canonical identity-claim contract; the recovery barrier
    /// keeps an independent defensive check on top of it.
    ///
    /// STARTING / RUNNING assert that a specific process may be executing, so BOTH `pid` and
    /// `creationTimeFiletime` are REQUIRED: without the complete pair there is nothing the kernel
    /// can be asked to confirm, so the claim is unverifiable. Unverifiable is malformed — it must
    /// NEVER be silently reclassified as stale, because doing so would let a replacement host
    /// launch a daemon while an evidenced prior daemon might still be executing.
    ///
    /// STOPPED asserts that termination was observed or independently proven, and therefore
    /// carries NO claim: every writer path (`stopped`, `as_stopped`) clears both fields, so a
    /// stopped record carrying identity is inconsistent evidence and is rejected too.
    pub fn has_valid_identity_claim(&self) -> bool {
        let pid = self.pid.is_some();
        let ctime = self.creation_time_filetime.is_some();
        match self.state {
            EvidenceState::Starting | EvidenceState::Running => pid && ctime,
            EvidenceState::Stopped => !pid && !ctime,
        }
    }

    /// A `starting` record for a just-created, still-suspended child.
    pub fn starting(
        scope: &EvidenceScope,
        host_instance_id: &str,
        daemon_instance_id: &str,
        pid: u32,
        creation_time_filetime: u64,
    ) -> EvidenceRecord {
        EvidenceRecord {
            schema_version: EVIDENCE_SCHEMA_VERSION,
            channel: scope.channel.clone(),
            user16: scope.user16.clone(),
            install16: scope.install16.clone(),
            host_instance_id: host_instance_id.to_string(),
            daemon_instance_id: daemon_instance_id.to_string(),
            pid: Some(pid),
            creation_time_filetime: Some(creation_time_filetime),
            state: EvidenceState::Starting,
            recorded_at_utc: now_utc_string(),
        }
    }

    /// The same identity, advanced to `running`. Writer discipline: starting → running only.
    pub fn as_running(&self) -> EvidenceRecord {
        EvidenceRecord {
            state: EvidenceState::Running,
            recorded_at_utc: now_utc_string(),
            ..self.clone()
        }
    }

    /// The same identity, terminal. A stopped record carries no process claim.
    pub fn as_stopped(&self) -> EvidenceRecord {
        EvidenceRecord {
            state: EvidenceState::Stopped,
            pid: None,
            creation_time_filetime: None,
            recorded_at_utc: now_utc_string(),
            ..self.clone()
        }
    }

    /// A free-standing `stopped` record (used when no starting record is in hand).
    pub fn stopped(
        scope: &EvidenceScope,
        host_instance_id: &str,
        daemon_instance_id: &str,
    ) -> EvidenceRecord {
        EvidenceRecord {
            schema_version: EVIDENCE_SCHEMA_VERSION,
            channel: scope.channel.clone(),
            user16: scope.user16.clone(),
            install16: scope.install16.clone(),
            host_instance_id: host_instance_id.to_string(),
            daemon_instance_id: daemon_instance_id.to_string(),
            pid: None,
            creation_time_filetime: None,
            state: EvidenceState::Stopped,
            recorded_at_utc: now_utc_string(),
        }
    }
}

/// Classification of one read of the canonical record.
#[derive(Debug)]
pub enum ReadOutcome {
    /// No record exists. Safe by construction: the only possible unrecorded child is suspended,
    /// Job-contained and unable to execute daemon work.
    Absent,
    /// A schema-valid, scope-correlated record.
    Valid(EvidenceRecord),
    /// Unreadable, unparseable, oversized, or inconsistent. Fails closed.
    Malformed,
    /// Parseable but a schema version this build does not speak. Fails closed.
    UnsupportedSchema,
    /// Parseable but correlated to a different account/installation/channel. Fails closed.
    WrongScope,
}

/// Resolve the evidence scope from the SAME primitives that scope the instance mutex.
pub fn resolve_scope() -> Result<EvidenceScope, ProcessError> {
    let channel = crate::instance::key::detect_channel().as_str().to_string();
    let install_dir = crate::instance::key::resolve_install_dir()
        .map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
    let install16 = crate::instance::key::install_component(&install_dir)
        .map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
    let sid = crate::instance::security::current_account_sid()
        .map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
    let user16 = crate::instance::key::user_component(sid.sid_bytes())
        .map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
    Ok(EvidenceScope {
        channel,
        user16,
        install16,
    })
}

/// The default per-user recovery directory, validated local-absolute by the same rule that guards
/// runtime resolution.
fn default_dir() -> Result<PathBuf, ProcessError> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or(ProcessError::RecoveryEvidenceWriteFailed)?;
    let base = PathBuf::from(base);
    if !base.is_absolute() || !super::dev_runtime::is_local_absolute(&base) {
        return Err(ProcessError::RecoveryEvidenceWriteFailed);
    }
    Ok(base
        .join("ProjectOS")
        .join("ControlCenter")
        .join("recovery"))
}

/// The single-writer evidence store for one scope. Single-writer is guaranteed by the global
/// instance mutex, which is acquired before any store is constructed or swept.
#[derive(Debug, Clone)]
pub struct EvidenceStore {
    dir: PathBuf,
    scope: EvidenceScope,
}

impl EvidenceStore {
    /// The production store: default per-user directory + resolved scope.
    pub fn resolve() -> Result<EvidenceStore, ProcessError> {
        Ok(EvidenceStore {
            dir: default_dir()?,
            scope: resolve_scope()?,
        })
    }

    /// Store at an explicit directory (still the real scope, so correlation is real). Production
    /// only ever reaches this through `DaemonLifecycleState::with_evidence_dir`, which nothing in
    /// the application calls — the application path is `resolve()`.
    pub fn at_dir(dir: PathBuf) -> Result<EvidenceStore, ProcessError> {
        Ok(EvidenceStore {
            dir,
            scope: resolve_scope()?,
        })
    }

    pub fn scope(&self) -> &EvidenceScope {
        &self.scope
    }

    /// The canonical record file name. The scope is embedded so distinct installations/accounts
    /// can never read each other's records even if the directory is shared.
    fn target_name(&self) -> String {
        format!(
            "lifecycle-evidence.{}.u{}.i{}.json",
            self.scope.channel, self.scope.user16, self.scope.install16
        )
    }

    fn target_path(&self) -> PathBuf {
        self.dir.join(self.target_name())
    }

    /// Best-effort removal of abandoned temp files for THIS scope. Safe because it runs strictly
    /// after authoritative mutex acquisition — no other host can have a temp in flight.
    pub fn sweep_temps(&self) {
        let prefix = format!("{}.tmp-", self.target_name());
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    /// Read and classify the canonical record. Readers only ever open the canonical name, so an
    /// interrupted temp write is invisible here.
    pub fn read(&self) -> ReadOutcome {
        let path = self.target_path();
        match std::fs::metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ReadOutcome::Absent,
            Err(_) => return ReadOutcome::Malformed,
            Ok(m) if m.len() > MAX_RECORD_BYTES => return ReadOutcome::Malformed,
            Ok(_) => {}
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return ReadOutcome::Absent,
            Err(_) => return ReadOutcome::Malformed,
        };
        // Peek the schema version FIRST so a well-formed future record classifies as unsupported
        // rather than malformed (deny_unknown_fields would otherwise mask it).
        #[derive(Deserialize)]
        struct VersionPeek {
            #[serde(rename = "schemaVersion")]
            schema_version: Option<u32>,
        }
        if let Ok(peek) = serde_json::from_str::<VersionPeek>(&text) {
            match peek.schema_version {
                Some(v) if v != EVIDENCE_SCHEMA_VERSION => {
                    return ReadOutcome::UnsupportedSchema;
                }
                None => return ReadOutcome::Malformed,
                _ => {}
            }
        } else {
            return ReadOutcome::Malformed;
        }
        let record: EvidenceRecord = match serde_json::from_str(&text) {
            Ok(r) => r,
            Err(_) => return ReadOutcome::Malformed,
        };
        if record.channel != self.scope.channel
            || record.user16 != self.scope.user16
            || record.install16 != self.scope.install16
        {
            return ReadOutcome::WrongScope;
        }
        // The identity-claim contract is state-aware and load-bearing (RECOVERY-BARRIER1C): an
        // ACTIVE record without a complete, verifiable claim is malformed evidence — never "stale".
        if !record.has_valid_identity_claim() {
            return ReadOutcome::Malformed;
        }
        ReadOutcome::Valid(record)
    }

    /// Atomically persist `record` as the canonical file.
    ///
    /// Same-directory temp (`create_new`, never truncating an existing file) → `write_all` →
    /// `sync_all` (durable flush) → replace-existing rename with bounded retry. On any failure the
    /// temp is best-effort removed and the caller MUST fail closed (a starting-record failure
    /// prevents `ResumeThread`; a running-record failure stops the daemon).
    pub fn write(&self, record: &EvidenceRecord) -> Result<(), ProcessError> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
        let body =
            serde_json::to_string(record).map_err(|_| ProcessError::RecoveryEvidenceWriteFailed)?;
        let seq = TEMP_SEQ.fetch_add(1, Ordering::SeqCst);
        let tmp = self.dir.join(format!(
            "{}.tmp-{}-{}",
            self.target_name(),
            std::process::id(),
            seq
        ));
        let write_result = (|| -> std::io::Result<()> {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)?;
            f.write_all(body.as_bytes())?;
            f.sync_all()?; // FlushFileBuffers: durable before the name transition
            Ok(())
        })();
        if write_result.is_err() {
            let _ = std::fs::remove_file(&tmp);
            return Err(ProcessError::RecoveryEvidenceWriteFailed);
        }
        let target = self.target_path();
        for attempt in 0..REPLACE_RETRY_ATTEMPTS {
            match std::fs::rename(&tmp, &target) {
                Ok(()) => return Ok(()),
                Err(_) if attempt + 1 < REPLACE_RETRY_ATTEMPTS => {
                    std::thread::sleep(std::time::Duration::from_millis(REPLACE_RETRY_DELAY_MS));
                }
                Err(_) => break,
            }
        }
        let _ = std::fs::remove_file(&tmp);
        Err(ProcessError::RecoveryEvidenceWriteFailed)
    }

    /// TEST-ONLY: write raw bytes to the canonical path (malformed/torn-record fixtures).
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn write_raw_for_test(&self, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        std::fs::write(self.target_path(), bytes)
    }

    /// TEST-ONLY: the canonical path, for direct inspection.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn target_path_for_test(&self) -> PathBuf {
        self.target_path()
    }
}

/// Validate a directory the way the store requires (exposed for tests).
#[allow(dead_code)]
fn is_usable_dir(p: &Path) -> bool {
    p.is_absolute() && super::dev_runtime::is_local_absolute(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> EvidenceStore {
        let dir = std::env::temp_dir()
            .join("projectos-evidence-tests")
            .join(format!("{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        EvidenceStore::at_dir(dir).expect("scope must resolve on this machine")
    }

    fn starting(store: &EvidenceStore) -> EvidenceRecord {
        EvidenceRecord::starting(store.scope(), "host-t", "host-t-1", 4242, 133_700_000_000)
    }

    #[test]
    fn absent_record_reads_absent() {
        let s = temp_store("absent");
        assert!(matches!(s.read(), ReadOutcome::Absent));
    }

    #[test]
    fn first_write_then_read_roundtrips() {
        let s = temp_store("roundtrip");
        let r = starting(&s);
        s.write(&r).unwrap();
        match s.read() {
            ReadOutcome::Valid(got) => {
                assert_eq!(got.state, EvidenceState::Starting);
                assert_eq!(got.pid, Some(4242));
                assert_eq!(got.creation_time_filetime, Some(133_700_000_000));
            }
            other => panic!("expected valid, got {other:?}"),
        }
    }

    #[test]
    fn replacement_swaps_complete_records() {
        let s = temp_store("replace");
        let r = starting(&s);
        s.write(&r).unwrap();
        s.write(&r.as_running()).unwrap();
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Running,
                ..
            })
        ));
        s.write(&r.as_stopped()).unwrap();
        match s.read() {
            ReadOutcome::Valid(got) => {
                assert_eq!(got.state, EvidenceState::Stopped);
                assert_eq!(got.pid, None, "stopped carries no process claim");
                assert_eq!(got.creation_time_filetime, None);
            }
            other => panic!("expected valid, got {other:?}"),
        }
    }

    #[test]
    fn malformed_json_reads_malformed() {
        let s = temp_store("malformed");
        s.write_raw_for_test(b"{ not json").unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn truncated_record_reads_malformed() {
        let s = temp_store("torn");
        let r = starting(&s);
        let full = serde_json::to_string(&r).unwrap();
        let torn = &full.as_bytes()[..full.len() / 2];
        s.write_raw_for_test(torn).unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn unknown_field_reads_malformed() {
        let s = temp_store("unknown-field");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s)).unwrap();
        v["trusted"] = serde_json::Value::Bool(true);
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn future_schema_reads_unsupported() {
        let s = temp_store("future-schema");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s)).unwrap();
        v["schemaVersion"] = serde_json::Value::from(2u32);
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert!(matches!(s.read(), ReadOutcome::UnsupportedSchema));
    }

    #[test]
    fn wrong_scope_reads_wrong_scope() {
        let s = temp_store("wrong-scope");
        let mut r = starting(&s);
        r.user16 = "0000000000000000".to_string();
        s.write_raw_for_test(serde_json::to_string(&r).unwrap().as_bytes())
            .unwrap();
        assert!(matches!(s.read(), ReadOutcome::WrongScope));
    }

    /// Persist `r` with the named fields removed.
    fn write_without(s: &EvidenceStore, r: &EvidenceRecord, drop_fields: &[&str]) {
        let mut v: serde_json::Value = serde_json::to_value(r).unwrap();
        for f in drop_fields {
            v.as_object_mut().unwrap().remove(*f);
        }
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
    }

    /// THE identity-claim matrix (RECOVERY-BARRIER1C §3). An ACTIVE record (starting/running)
    /// requires the COMPLETE pid + creation-time pair; anything else is malformed. A STOPPED
    /// record must carry no claim at all.
    #[test]
    fn identity_claim_matrix_is_state_aware() {
        let both: &[&str] = &[];
        let no_ctime: &[&str] = &["creationTimeFiletime"];
        let no_pid: &[&str] = &["pid"];
        let neither: &[&str] = &["pid", "creationTimeFiletime"];

        // 1 + 5: active with both halves → valid.
        for (tag, active) in [
            ("starting-both", starting(&temp_store("x"))),
            ("running-both", starting(&temp_store("x")).as_running()),
        ] {
            let s = temp_store(tag);
            write_without(&s, &active, both);
            assert!(
                matches!(s.read(), ReadOutcome::Valid(_)),
                "{tag} must be valid"
            );
        }

        // 2,3,4 + 6,7,8: active missing either or both halves → malformed.
        for (tag, active) in [
            ("starting", starting(&temp_store("x"))),
            ("running", starting(&temp_store("x")).as_running()),
        ] {
            for (case, fields) in [
                ("neither", neither),
                ("pid-only", no_ctime),
                ("ctime-only", no_pid),
            ] {
                let s = temp_store(&format!("{tag}-{case}"));
                write_without(&s, &active, fields);
                assert!(
                    matches!(s.read(), ReadOutcome::Malformed),
                    "{tag} with {case} must be malformed"
                );
            }
        }

        // 9: stopped with neither → valid.
        let s = temp_store("stopped-neither");
        s.write(&starting(&s).as_stopped()).unwrap();
        assert!(matches!(s.read(), ReadOutcome::Valid(_)));

        // 10: stopped WITH both → malformed. Policy: `stopped` asserts termination and every
        // writer path clears the pair, so a stopped record carrying identity is inconsistent.
        let s = temp_store("stopped-both");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s)).unwrap();
        v["state"] = serde_json::Value::from("stopped");
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));

        // 11: stopped with exactly one half → malformed.
        for (case, fields) in [("pid-only", no_ctime), ("ctime-only", no_pid)] {
            let s = temp_store(&format!("stopped-{case}"));
            let mut v: serde_json::Value = serde_json::to_value(starting(&s)).unwrap();
            v["state"] = serde_json::Value::from("stopped");
            for f in fields {
                v.as_object_mut().unwrap().remove(*f);
            }
            s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
                .unwrap();
            assert!(
                matches!(s.read(), ReadOutcome::Malformed),
                "stopped with {case} must be malformed"
            );
        }
    }

    /// The pure contract, independent of the reader.
    #[test]
    fn has_valid_identity_claim_is_exact() {
        let s = temp_store("pure");
        let st = starting(&s);
        assert!(st.has_valid_identity_claim(), "starting + both");
        assert!(st.as_running().has_valid_identity_claim(), "running + both");
        assert!(st.as_stopped().has_valid_identity_claim(), "stopped + none");

        let mut bad = st.clone();
        bad.creation_time_filetime = None;
        assert!(!bad.has_valid_identity_claim(), "starting + pid only");
        let mut bad = st.clone();
        bad.pid = None;
        assert!(!bad.has_valid_identity_claim(), "starting + ctime only");
        let mut bad = st.clone();
        bad.pid = None;
        bad.creation_time_filetime = None;
        assert!(!bad.has_valid_identity_claim(), "starting + neither");
        let mut bad = bad.clone();
        bad.state = EvidenceState::Running;
        assert!(!bad.has_valid_identity_claim(), "running + neither");

        // Stopped must carry no claim.
        let mut bad = st.clone();
        bad.state = EvidenceState::Stopped;
        assert!(!bad.has_valid_identity_claim(), "stopped + both");
    }

    /// Every writer path emits a self-consistent claim — the invariant the reader relies on.
    #[test]
    fn every_writer_path_emits_a_valid_claim() {
        let s = temp_store("writer-discipline");
        let st = starting(&s);
        assert!(st.has_valid_identity_claim());
        assert!(st.as_running().has_valid_identity_claim());
        assert!(st.as_stopped().has_valid_identity_claim());
        assert!(EvidenceRecord::stopped(s.scope(), "h", "h-1").has_valid_identity_claim());
    }

    #[test]
    fn unknown_state_string_is_malformed() {
        let s = temp_store("state-string");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s)).unwrap();
        v["state"] = serde_json::Value::from("trusted");
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn oversized_record_is_malformed() {
        let s = temp_store("oversized");
        let big = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_RECORD_BYTES as usize));
        s.write_raw_for_test(big.as_bytes()).unwrap();
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn temp_sweep_removes_only_this_scopes_temps() {
        let s = temp_store("sweep");
        let r = starting(&s);
        s.write(&r).unwrap();
        let stray_temp = s
            .target_path_for_test()
            .with_file_name(format!("{}.tmp-999-7", s.target_name()));
        std::fs::write(&stray_temp, b"abandoned").unwrap();
        let unrelated = s.target_path_for_test().with_file_name("unrelated.txt");
        std::fs::write(&unrelated, b"keep").unwrap();
        s.sweep_temps();
        assert!(!stray_temp.exists(), "abandoned temp must be swept");
        assert!(unrelated.exists(), "unrelated files must be untouched");
        assert!(
            matches!(s.read(), ReadOutcome::Valid(_)),
            "canonical intact"
        );
    }

    #[test]
    fn locked_target_write_fails_closed_after_bounded_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let s = temp_store("locked");
        let r = starting(&s);
        s.write(&r).unwrap();
        // Hold the canonical file WITHOUT FILE_SHARE_DELETE (AV/indexer class): replacement must
        // fail closed after bounded retries, and the old record must remain intact.
        let _locker = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1 /* FILE_SHARE_READ only */)
            .open(s.target_path_for_test())
            .unwrap();
        let err = s.write(&r.as_running()).unwrap_err();
        assert_eq!(err, ProcessError::RecoveryEvidenceWriteFailed);
        drop(_locker);
        assert!(
            matches!(
                s.read(),
                ReadOutcome::Valid(EvidenceRecord {
                    state: EvidenceState::Starting,
                    ..
                })
            ),
            "old record must survive a failed replacement"
        );
        // And no temp residue.
        s.sweep_temps();
        let entries: Vec<_> = std::fs::read_dir(s.target_path_for_test().parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(entries.is_empty(), "no temp residue after failure");
    }

    #[test]
    fn record_never_contains_raw_sid_path_or_trust_words() {
        let s = temp_store("privacy");
        let r = starting(&s);
        let json = serde_json::to_string(&r).unwrap();
        let lower = json.to_lowercase();
        for forbidden in ["s-1-5", "c:\\", "secure", "trusted", "node.exe", "host.mjs"] {
            assert!(!lower.contains(forbidden), "leaked {forbidden}: {json}");
        }
    }
}

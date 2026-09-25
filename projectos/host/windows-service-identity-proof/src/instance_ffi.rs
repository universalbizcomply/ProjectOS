//! The ONLY place a [`ServiceInstanceToken`] can come into existence: OS-derived instance observation
//! on a BORROWED live Windows handle (3K-I-D-E-C-CAPABILITY-B4-CROSS-SOURCE-BINDING-CONTRACT1A).
//!
//! Both observations are performed HERE, in the canonical owning crate, rather than in the sibling
//! crates that own the pipe and the SCM handle. A sibling that could hand over a process ID and a
//! creation time could forge the identity, so the sibling supplies only its live handle and this
//! module reads Windows itself.
//!
//! Unsafe is confined to this module (`unsafe_code` is denied crate-wide). Every temporary process
//! handle is adopted into the canonical RAII `OwnedHandle` primitive, so it closes deterministically
//! on every path including early return. No raw process ID, creation time, handle or Win32 error
//! leaves this module: the closed [`ServiceInstanceObservation`] is the entire output.
//!
//! Compiling this module is NOT authority to run it — every entry point demands the sealed
//! [`LiveInstanceObservationCapability`], which has no constructor in any build or feature.

#![cfg(all(windows, feature = "windows-live-instance-observation"))]
#![allow(unsafe_code)]

use core::cell::Cell;

use projectos_windows_runtime_primitives::handles::{adopt, win32};
use windows::Win32::Foundation::{FILETIME, HANDLE};
// READ-ONLY token surface. No privilege is enabled, no token is created, duplicated, assigned or
// retained, and no SID is ever resolved to a name.
use windows::Win32::Security::{
    GetLengthSid, GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, RevertToSelf,
    TokenIntegrityLevel, TokenSessionId, TokenUser, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TOKEN_USER,
};
use windows::Win32::System::Pipes::{GetNamedPipeClientProcessId, ImpersonateNamedPipeClient};
use windows::Win32::System::Services::{
    QueryServiceStatusEx, SC_HANDLE, SC_STATUS_PROCESS_INFO, SERVICE_RUNNING,
    SERVICE_STATUS_PROCESS, SERVICE_WIN32_OWN_PROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentThread, GetProcessTimes, OpenProcess, OpenThreadToken,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::instance::{
    decide_pipe_peer, decide_service, AttemptOutcome, IpcPeerObserved,
    LiveInstanceObservationCapability, PeerIdentityFacts, PeerIntegrityEvidence,
    PeerSessionBinding, PeerUserBinding, PipePeerFacts, Prepared, ScmAfterObserved,
    ScmBeforeObserved, ServiceFacts, ServiceInstanceBindingAttempt, ServiceInstanceObservation,
};

/// Read the connected CLIENT's process ID for a named-pipe SERVER handle.
///
/// The direction is deliberate and was verified against the B3 transport: the proof controller owns
/// the pipe SERVER (`CreateNamedPipeW` + `ConnectNamedPipe`) and the service fixture connects as the
/// CLIENT, so the peer is the client. A failure is reported as "no identity", never as a default.
///
/// # Safety
/// `pipe` must be a valid, still-open named-pipe server handle owned by the caller for this call.
unsafe fn client_process_id(pipe: HANDLE) -> Option<u32> {
    let mut pid: u32 = 0;
    // SAFETY: `pipe` is a valid server handle per this function's contract and `pid` is a valid
    // out-param that outlives the call.
    let ok = unsafe { GetNamedPipeClientProcessId(pipe, &mut pid) };
    if ok.is_err() {
        return None;
    }
    Some(pid)
}

/// Open an observed process with the MINIMUM read-only access sufficient for `GetProcessTimes`.
///
/// `PROCESS_QUERY_LIMITED_INFORMATION` is the least-privileged right that satisfies the call; no
/// elevation is attempted and `SeDebugPrivilege` is never requested. A denial fails closed.
///
/// # Safety
/// The returned handle is adopted into the canonical RAII primitive and closed on drop.
unsafe fn open_for_times(process_id: u32) -> Option<std::os::windows::io::OwnedHandle> {
    // SAFETY: the access mask is the minimum query right, inheritance is disabled, and the process ID
    // was read from Windows moments earlier.
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) };
    let raw = raw.ok()?;
    // SAFETY: `raw` is a freshly-returned owned process handle that is transferred exactly once into
    // the RAII wrapper, which closes it on drop.
    unsafe { adopt(raw) }
}

/// Read the OS-observed process CREATION time. This is what defeats process-ID reuse; a wall-clock
/// reading, a service start checkpoint or an elapsed proof duration would not.
///
/// # Safety
/// `process` must be an open process handle carrying at least `PROCESS_QUERY_LIMITED_INFORMATION`.
unsafe fn process_creation_time(process: &std::os::windows::io::OwnedHandle) -> Option<u64> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: the handle is valid and open for the required access; all four out-params are valid
    // and live for the duration of the call.
    let ok = unsafe {
        GetProcessTimes(
            win32(process),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    if ok.is_err() {
        return None;
    }
    let value = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    if value == 0 {
        return None;
    }
    Some(value)
}

/// One `QueryServiceStatusEx` observation, reduced to the three facts that matter: run state, service
/// type and process ID. Returns `None` when the query itself failed.
///
/// # Safety
/// `service` must be a valid service handle carrying `SERVICE_QUERY_STATUS`.
unsafe fn query_status(service: SC_HANDLE) -> Option<(u32, u32, u32)> {
    let mut buf = [0u8; std::mem::size_of::<SERVICE_STATUS_PROCESS>()];
    let mut needed: u32 = 0;
    // SAFETY: `service` is valid per this function's contract; `buf` is exactly sized for a
    // SERVICE_STATUS_PROCESS and `needed` is a valid out-param.
    let ok = unsafe {
        QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, Some(&mut buf), &mut needed)
    };
    if ok.is_err() {
        return None;
    }
    // SAFETY: the buffer was filled by a successful QueryServiceStatusEx with SC_STATUS_PROCESS_INFO,
    // so it holds an initialised SERVICE_STATUS_PROCESS.
    let status: SERVICE_STATUS_PROCESS =
        unsafe { std::ptr::read_unaligned(buf.as_ptr().cast::<SERVICE_STATUS_PROCESS>()) };
    Some((
        status.dwCurrentState.0,
        status.dwServiceType.0,
        status.dwProcessId,
    ))
}

/// Observe the OS-derived instance identity of the CONFIRMED named-pipe peer (§7).
///
/// The caller passes the outcome of its own bounded handshake; identity is captured only after the
/// handshake is confirmed and the peer is the expected service fixture, and the peer process ID is
/// re-read afterwards so a peer that changed mid-observation cannot yield a token. Every ordering
/// decision and refusal lives in the portable `decide_pipe_peer` core, which is exercised by
/// fake-backed tests that call no Windows API.
///
/// # Safety
/// `pipe` must be a valid named-pipe SERVER handle that the caller keeps open for this call.
pub(crate) unsafe fn observe_named_pipe_peer_instance(
    pipe: HANDLE,
    connected: bool,
    handshake_confirmed: bool,
    role_is_expected_service_fixture: bool,
) -> ServiceInstanceObservation {
    // Facts default to "not established". Anything the sequence does not reach stays unestablished,
    // so the core's ordering — not this gathering code — decides the exact refusal.
    let mut facts = PipePeerFacts {
        connected,
        handshake_confirmed,
        role_is_expected_service_fixture,
        peer_process_id_before: None,
        process_opened: false,
        creation_time: None,
        still_connected: false,
        peer_process_id_after: None,
    };

    if connected && handshake_confirmed && role_is_expected_service_fixture {
        // SAFETY: `pipe` is valid per this function's contract.
        if let Some(before) = unsafe { client_process_id(pipe) } {
            facts.peer_process_id_before = Some(before);
            if before != 0 {
                // SAFETY: `before` was just read from Windows; the handle is adopted into RAII.
                if let Some(process) = unsafe { open_for_times(before) } {
                    facts.process_opened = true;
                    // SAFETY: `process` is open for PROCESS_QUERY_LIMITED_INFORMATION.
                    facts.creation_time = unsafe { process_creation_time(&process) };
                    // Re-read the peer: a still-answering pipe is still connected, and an identical
                    // process ID is the peer-stability proof.
                    // SAFETY: `pipe` is still valid and owned by the caller.
                    if let Some(after) = unsafe { client_process_id(pipe) } {
                        facts.still_connected = true;
                        facts.peer_process_id_after = Some(after);
                    }
                    // `process` closes here via RAII, on this and every earlier path.
                }
            }
        }
    }

    decide_pipe_peer(&facts)
}

// ---------------------------------------------------------------------------------------------
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A — token identity capture.
//
// This is the ONLY place ProjectOS impersonates anything. The window is entered through an RAII guard
// whose `Drop` calls `RevertToSelf` on EVERY exit path — success, ordinary error, early return,
// token-read failure and unwind — and the revert RESULT is recorded rather than assumed, so a capture
// that did not revert cleanly is refused by the portable decision core.
//
// The only work performed while impersonating is the three token reads. No file, registry, ProgramData,
// credential, provider, IPC or protected operation happens inside the window, and no token handle
// escapes the function that opened it.
// ---------------------------------------------------------------------------------------------

/// Bytes reserved for one variable-length token record. A record that does not fit is REFUSED rather
/// than reallocated: there is no growable buffer on this path.
const TOKEN_RECORD_BYTES: usize = 256;

/// An 8-aligned scratch buffer, so a `TOKEN_USER` / `TOKEN_MANDATORY_LABEL` written by Windows at
/// offset 0 is correctly aligned for reading.
#[repr(C, align(8))]
struct TokenRecordBuffer([u8; TOKEN_RECORD_BYTES]);

/// RAII impersonation of the connected pipe client.
///
/// `Drop` calls `RevertToSelf` unconditionally, so the thread cannot leave this scope still carrying
/// the client's token. The revert result is recorded so an unconfirmed revert makes the capture
/// untrusted rather than silently passing.
struct ImpersonatedPipeClient<'a> {
    reverted: &'a Cell<bool>,
}

impl<'a> ImpersonatedPipeClient<'a> {
    /// # Safety
    /// `pipe` must be a valid, connected named-pipe SERVER handle owned by the caller for this scope.
    unsafe fn enter(pipe: HANDLE, reverted: &'a Cell<bool>) -> Option<Self> {
        reverted.set(false);
        // SAFETY: `pipe` is valid per this function's contract. The call changes only THIS thread's
        // effective token.
        unsafe { ImpersonateNamedPipeClient(pipe) }.ok()?;
        Some(Self { reverted })
    }
}

impl Drop for ImpersonatedPipeClient<'_> {
    fn drop(&mut self) {
        // SAFETY: this thread is impersonating because `enter` returned `Some`. `RevertToSelf` takes no
        // arguments and restores the thread's own token; it runs exactly once per guard, on every path.
        self.reverted.set(unsafe { RevertToSelf() }.is_ok());
    }
}

/// Read the three attested facts of an already-open token. The handle is BORROWED and never retained.
///
/// # Safety
/// `token` must be an open token handle carrying at least `TOKEN_QUERY`.
unsafe fn read_token_facts(
    token: HANDLE,
) -> (
    Option<PeerUserBinding>,
    Option<PeerSessionBinding>,
    Option<PeerIntegrityEvidence>,
) {
    let mut user_record = TokenRecordBuffer([0u8; TOKEN_RECORD_BYTES]);
    let mut needed = 0u32;
    // SAFETY: the buffer is 8-aligned, exactly TOKEN_RECORD_BYTES long and outlives the call; `needed`
    // is a live local. `TokenUser` is a read-only query.
    let user = if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(user_record.0.as_mut_ptr().cast()),
            TOKEN_RECORD_BYTES as u32,
            &mut needed,
        )
    }
    .is_ok()
    {
        // SAFETY: on success Windows wrote a TOKEN_USER at offset 0 of an aligned buffer, whose `Sid`
        // points inside that same live buffer.
        let sid = unsafe { (*user_record.0.as_ptr().cast::<TOKEN_USER>()).User.Sid };
        // SAFETY: `sid` is a kernel-written SID inside the live buffer.
        let len = unsafe { GetLengthSid(sid) } as usize;
        if len == 0 || len > user_record.0.len() {
            None
        } else {
            // SAFETY: `sid` addresses `len` initialised bytes inside the live buffer; the slice is only
            // read and does not outlive it.
            let bytes = unsafe { core::slice::from_raw_parts(sid.0.cast::<u8>(), len) };
            PeerUserBinding::from_sid_bytes(bytes)
        }
    } else {
        None
    };

    let mut session_id = 0u32;
    // SAFETY: `TokenSessionId` writes exactly one u32; the out-pointer addresses a live local of that
    // size and `needed` is a live local.
    let session = if unsafe {
        GetTokenInformation(
            token,
            TokenSessionId,
            Some(core::ptr::addr_of_mut!(session_id).cast()),
            core::mem::size_of::<u32>() as u32,
            &mut needed,
        )
    }
    .is_ok()
    {
        Some(PeerSessionBinding::from_session_id(session_id))
    } else {
        None
    };

    let mut label_record = TokenRecordBuffer([0u8; TOKEN_RECORD_BYTES]);
    // SAFETY: same buffer contract as the TokenUser read; `TokenIntegrityLevel` is read-only.
    let integrity = if unsafe {
        GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(label_record.0.as_mut_ptr().cast()),
            TOKEN_RECORD_BYTES as u32,
            &mut needed,
        )
    }
    .is_ok()
    {
        // SAFETY: on success Windows wrote a TOKEN_MANDATORY_LABEL at offset 0 of the aligned buffer,
        // whose `Sid` points inside that same live buffer.
        let sid = unsafe {
            (*label_record.0.as_ptr().cast::<TOKEN_MANDATORY_LABEL>())
                .Label
                .Sid
        };
        // SAFETY: `sid` is a kernel-written SID in the live buffer; the returned pointer addresses a
        // byte inside it.
        let count = unsafe { *GetSidSubAuthorityCount(sid) };
        if count == 0 {
            Some(PeerIntegrityEvidence::Unrecognised)
        } else {
            // SAFETY: the index is in range because `count` is non-zero, and the returned pointer
            // addresses a u32 inside the live SID.
            let rid = unsafe { *GetSidSubAuthority(sid, u32::from(count - 1)) };
            Some(PeerIntegrityEvidence::from_rid(rid))
        }
    } else {
        None
    };

    (user, session, integrity)
}

/// Open the impersonated client's token READ-ONLY, take its facts, and let RAII close it.
///
/// The handle never escapes: it is adopted into the canonical `OwnedHandle` primitive the instant it
/// exists, is never returned, never stored and never duplicated, and closes deterministically on every
/// path including early return and unwind. There is no manual `CloseHandle` on this path.
///
/// # Safety
/// The calling thread must currently be impersonating the pipe client.
unsafe fn read_impersonated_token_facts() -> (
    Option<PeerUserBinding>,
    Option<PeerSessionBinding>,
    Option<PeerIntegrityEvidence>,
) {
    let mut token = HANDLE::default();
    // SAFETY: `GetCurrentThread` returns a pseudo-handle needing no close. `TOKEN_QUERY` is the
    // read-only mask and is the ONLY right requested. `openasself = false` opens the token under the
    // IMPERSONATED context — the client's token, not the service's. The out-pointer addresses a live
    // local.
    if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, false, &mut token) }.is_err() {
        return (None, None, None);
    }
    // SAFETY: `token` was just returned by OpenThreadToken, is owned by this frame and has no other
    // owner, so transferring it into the RAII wrapper yields exactly one close on drop.
    let Some(owned) = (unsafe { adopt(token) }) else {
        return (None, None, None);
    };
    // SAFETY: `owned` holds the token opened immediately above, which carries TOKEN_QUERY.
    unsafe { read_token_facts(win32(&owned)) }
    // `owned` drops HERE, closing the token via RAII on this and every earlier path.
}

/// Gather the peer's token-side identity facts inside an RAII impersonation window.
///
/// PRIVATE. There is no public route to this function: a peer identity can be produced only through the
/// attempt transitions below, so no sibling can call a raw capture entry point.
///
/// The window contains the three token reads and NOTHING else — no file, registry, ProgramData,
/// credential, provider, IPC or protected operation happens while impersonating — and the revert RESULT
/// is recorded rather than assumed.
///
/// # Safety
/// `pipe` must be a valid, connected named-pipe SERVER handle the caller keeps open for this call.
unsafe fn capture_peer_identity_facts(pipe: HANDLE) -> PeerIdentityFacts {
    let reverted = Cell::new(false);
    let mut impersonated = false;
    let mut facts = PeerIdentityFacts {
        impersonated: false,
        impersonation_reverted: false,
        token_user: None,
        token_session: None,
        integrity: None,
    };
    {
        // SAFETY: `pipe` is valid per this function's contract and outlives the guard.
        if let Some(_guard) = unsafe { ImpersonatedPipeClient::enter(pipe, &reverted) } {
            impersonated = true;
            // SAFETY: this thread is impersonating because the guard was entered.
            let (user, session, integrity) = unsafe { read_impersonated_token_facts() };
            facts.token_user = user;
            facts.token_session = session;
            facts.integrity = integrity;
        }
        // The guard drops HERE: `RevertToSelf` has run and its result is recorded in `reverted`.
    }
    facts.impersonated = impersonated;
    facts.impersonation_reverted = reverted.get();
    facts
}

/// Observe the OS-derived instance identity of the RUNNING ProjectOSHost service (§8).
///
/// The service handle is supplied by the crate that owns the SCM authority; the fixed service name is
/// enforced there, at open time. The status is observed BEFORE and AFTER the identity capture and must
/// report running, own-process and the same process ID both times, so a service that started, stopped
/// or was replaced during the window fails closed rather than presenting two instances as one.
///
/// # Safety
/// `service` must be a valid service handle carrying `SERVICE_QUERY_STATUS` for the exact
/// ProjectOSHost service, kept open by the caller for this call.
pub(crate) unsafe fn observe_running_service_instance(
    service: SC_HANDLE,
) -> ServiceInstanceObservation {
    let running = SERVICE_RUNNING.0;
    let own_process = SERVICE_WIN32_OWN_PROCESS.0;

    let mut facts = ServiceFacts {
        first_status_available: false,
        first_running: false,
        first_own_process: false,
        first_process_id: None,
        process_opened: false,
        creation_time: None,
        second_status_available: false,
        second_running: false,
        second_own_process: false,
        second_process_id: None,
    };

    // SAFETY: `service` is valid per this function's contract.
    if let Some((state, service_type, pid)) = unsafe { query_status(service) } {
        facts.first_status_available = true;
        facts.first_running = state == running;
        // A shared-process service cannot be pinned to one instance, so own-process is required.
        facts.first_own_process = service_type & own_process == own_process;
        facts.first_process_id = Some(pid);

        if facts.first_running && facts.first_own_process && pid != 0 {
            // SAFETY: `pid` was just read from Windows; the handle is adopted into RAII.
            if let Some(process) = unsafe { open_for_times(pid) } {
                facts.process_opened = true;
                // SAFETY: `process` is open for PROCESS_QUERY_LIMITED_INFORMATION.
                facts.creation_time = unsafe { process_creation_time(&process) };
                // Second observation: never a cached status from an earlier attempt.
                // SAFETY: `service` is still valid and owned by the caller.
                if let Some((state2, type2, pid2)) = unsafe { query_status(service) } {
                    facts.second_status_available = true;
                    facts.second_running = state2 == running;
                    facts.second_own_process = type2 & own_process == own_process;
                    facts.second_process_id = Some(pid2);
                }
                // `process` closes here via RAII, on this and every earlier path.
            }
        }
    }

    decide_service(&facts)
}

// ---------------------------------------------------------------------------------------------
// Attempt-scoped transitions (Contract1B).
//
// These are the ONLY public routes into an observation. Each CONSUMES the attempt and returns it in
// its next state, so the observation is performed and retained inside one bounded proof attempt and
// no token is ever handed back to the caller. A sibling crate contributes by lending its live handle;
// it never sees, holds or compares an identity.
// ---------------------------------------------------------------------------------------------

impl ServiceInstanceBindingAttempt<Prepared> {
    /// Observe the running ProjectOSHost service BEFORE the peer, and advance the attempt.
    ///
    /// # Safety
    /// `service` must be a valid handle carrying `SERVICE_QUERY_STATUS` for the exact ProjectOSHost
    /// service, kept open by the caller for this call.
    pub unsafe fn observe_scm_before(
        self,
        service: SC_HANDLE,
    ) -> AttemptOutcome<ScmBeforeObserved> {
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe { observe_running_service_instance(service) };
        self.record_scm_before(observation)
    }
}

impl ServiceInstanceBindingAttempt<ScmBeforeObserved> {
    /// Observe the CONFIRMED pipe peer's instance, and advance the attempt. Reachable only after the
    /// SCM-before observation, by construction.
    ///
    /// # Safety
    /// `pipe` must be a valid named-pipe SERVER handle that the caller keeps open for this call.
    pub unsafe fn observe_ipc_peer(
        self,
        pipe: HANDLE,
        connected: bool,
        handshake_confirmed: bool,
        role_is_expected_service_fixture: bool,
    ) -> AttemptOutcome<IpcPeerObserved> {
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe {
            observe_named_pipe_peer_instance(
                pipe,
                connected,
                handshake_confirmed,
                role_is_expected_service_fixture,
            )
        };
        self.record_ipc_peer(observation)
    }

    /// Observe the CONFIRMED pipe peer's instance AND capture its bounded kernel identity, then
    /// advance. ATTEMPT-SCOPED: the identity is decided and stored inside the attempt and is never
    /// returned, so the caller learns only the next opaque state or a closed redacted verdict.
    ///
    /// The caller lends its connected pipe handle and supplies the two HOST-issued identifiers; it
    /// never supplies, sees, holds or compares an identity.
    ///
    /// # Safety
    /// `pipe` must be a valid, connected named-pipe SERVER handle that the caller keeps open for this
    /// call. The callee only reads through it and never retains, duplicates or closes it.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn observe_ipc_peer_identity(
        self,
        _capability: &LiveInstanceObservationCapability,
        pipe: HANDLE,
        connected: bool,
        handshake_confirmed: bool,
        role_is_expected_service_fixture: bool,
        connection_id: u64,
        handshake_generation: u64,
    ) -> AttemptOutcome<IpcPeerObserved> {
        // The accepted §7 process observation, unchanged.
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe {
            observe_named_pipe_peer_instance(
                pipe,
                connected,
                handshake_confirmed,
                role_is_expected_service_fixture,
            )
        };
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let facts = unsafe { capture_peer_identity_facts(pipe) };
        self.record_ipc_peer_identity(observation, &facts, connection_id, handshake_generation)
    }
}

impl ServiceInstanceBindingAttempt<IpcPeerObserved> {
    /// Observe the running service AGAIN after the peer, and advance the attempt. Reachable only
    /// after the peer observation, by construction.
    ///
    /// # Safety
    /// `service` must be a valid handle carrying `SERVICE_QUERY_STATUS` for the exact ProjectOSHost
    /// service, kept open by the caller for this call.
    pub unsafe fn observe_scm_after(self, service: SC_HANDLE) -> AttemptOutcome<ScmAfterObserved> {
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe { observe_running_service_instance(service) };
        self.record_scm_after(observation)
    }

    /// Capture the peer's kernel identity AGAIN and reconcile it against the one this attempt already
    /// recorded. Refuses if the process instance, the exact user, the exact session or either
    /// host-issued identifier diverged; integrity is never compared.
    ///
    /// # Safety
    /// `pipe` must be a valid, connected named-pipe SERVER handle that the caller keeps open for this
    /// call. The callee only reads through it and never retains, duplicates or closes it.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn reobserve_ipc_peer_identity(
        self,
        _capability: &LiveInstanceObservationCapability,
        pipe: HANDLE,
        connected: bool,
        handshake_confirmed: bool,
        role_is_expected_service_fixture: bool,
        connection_id: u64,
        handshake_generation: u64,
    ) -> AttemptOutcome<IpcPeerObserved> {
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe {
            observe_named_pipe_peer_instance(
                pipe,
                connected,
                handshake_confirmed,
                role_is_expected_service_fixture,
            )
        };
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let facts = unsafe { capture_peer_identity_facts(pipe) };
        self.reconcile_ipc_peer_identity(observation, &facts, connection_id, handshake_generation)
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1B — CLIENT-ADMISSION live entry points (ROUTE 1).
//
// The installed product is the REVERSE of the B3 proof direction: ProjectOSHost owns the pipe
// SERVER and the governed Agent connects as the CLIENT. The kernel reads are IDENTICAL either way -
// `GetNamedPipeClientProcessId` plus the impersonated token reads always describe the CLIENT of a
// server handle - so these entry points REUSE the already-audited capture verbatim and add no new
// Windows surface, no new import and no new unsafe block of their own.
//
// What differs is only the PROPOSITION the captured identity is then judged against, and that
// judgement lives entirely in the safe `client_admission` core.
// ---------------------------------------------------------------------------------------------

impl crate::client_admission::ClientPeerAdmissionAttempt<crate::client_admission::ClientPrepared> {
    /// Observe the CONFIRMED pipe client and capture its bounded kernel identity, then advance.
    ///
    /// `role_is_expected_production_client` is the caller's own confirmed-role check. The accepted
    /// `decide_pipe_peer` gate is driven with it exactly as the B3 route drives that gate with its
    /// service-fixture role: a peer's DECLARED role is a protocol assertion, so it gates the
    /// observation and never supplies the identity.
    ///
    /// `connection_id` and `handshake_generation` are HOST-issued and are recorded so a later
    /// reconciliation or admission on this attempt cannot be satisfied by a capture from another
    /// connection. The caller lends its connected handle and never supplies, sees, holds or compares
    /// an identity.
    ///
    /// # Safety
    /// `pipe` must be a valid, connected named-pipe SERVER handle that the caller keeps open for
    /// this call. The callee only reads through it and never retains, duplicates or closes it.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn observe_client_identity(
        self,
        _capability: &crate::client_admission::ClientAdmissionObservationCapability,
        pipe: HANDLE,
        connected: bool,
        handshake_confirmed: bool,
        role_is_expected_production_client: bool,
        connection_id: u64,
        handshake_generation: u64,
    ) -> crate::client_admission::ClientAttemptOutcome<crate::client_admission::ClientObserved>
    {
        // The accepted process observation, unchanged.
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe {
            observe_named_pipe_peer_instance(
                pipe,
                connected,
                handshake_confirmed,
                role_is_expected_production_client,
            )
        };
        // The accepted RAII impersonation window, unchanged: three token reads and nothing else, with
        // `RevertToSelf` on every exit path and the revert RESULT recorded rather than assumed.
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let facts = unsafe { capture_peer_identity_facts(pipe) };
        self.record_client_identity(observation, &facts, connection_id, handshake_generation)
    }
}

impl crate::client_admission::ClientPeerAdmissionAttempt<crate::client_admission::ClientObserved> {
    /// Capture the client's kernel identity AGAIN and reconcile it against the one this attempt
    /// already recorded. Refuses if the process instance, the EXACT user, the EXACT session or
    /// either host-issued identifier diverged; integrity is never compared.
    ///
    /// # Safety
    /// `pipe` must be a valid, connected named-pipe SERVER handle that the caller keeps open for
    /// this call. The callee only reads through it and never retains, duplicates or closes it.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn reobserve_client_identity(
        self,
        _capability: &crate::client_admission::ClientAdmissionObservationCapability,
        pipe: HANDLE,
        connected: bool,
        handshake_confirmed: bool,
        role_is_expected_production_client: bool,
        connection_id: u64,
        handshake_generation: u64,
    ) -> crate::client_admission::ClientAttemptOutcome<crate::client_admission::ClientObserved>
    {
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let observation = unsafe {
            observe_named_pipe_peer_instance(
                pipe,
                connected,
                handshake_confirmed,
                role_is_expected_production_client,
            )
        };
        // SAFETY: the handle contract is forwarded to the caller of this function.
        let facts = unsafe { capture_peer_identity_facts(pipe) };
        self.reconcile_client_identity(observation, &facts, connection_id, handshake_generation)
    }
}

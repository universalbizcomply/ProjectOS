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

use projectos_windows_runtime_primitives::handles::{adopt, win32};
use windows::Win32::Foundation::{FILETIME, HANDLE};
use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
use windows::Win32::System::Services::{
    QueryServiceStatusEx, SC_HANDLE, SC_STATUS_PROCESS_INFO, SERVICE_RUNNING,
    SERVICE_STATUS_PROCESS, SERVICE_WIN32_OWN_PROCESS,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

use crate::instance::{
    decide_pipe_peer, decide_service, AttemptOutcome, IpcPeerObserved, PipePeerFacts, Prepared,
    ScmAfterObserved, ScmBeforeObserved, ServiceFacts, ServiceInstanceBindingAttempt,
    ServiceInstanceObservation,
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
}

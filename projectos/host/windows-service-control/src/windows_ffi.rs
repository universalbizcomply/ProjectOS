//! The ONLY module in this crate permitted to contain `unsafe`. It implements the live Windows SCM
//! backend behind the safe [`crate::adapter::ScmBackend`] seam. It is compiled ONLY under the
//! `windows-live-scm` feature and is NEVER invoked in this phase: no [`crate::adapter::LiveOperationCapability`]
//! is constructible, so the capability-gated adapter methods that reach this backend are unreachable.
//!
//! SCM/service handles are owned by a private [`OwnedScHandle`] that closes exactly once with
//! `CloseServiceHandle` on drop (the canonical `OwnedHandle`/`CloseHandle` primitive is deliberately
//! NOT reused: an `SC_HANDLE` must be closed with `CloseServiceHandle`, not `CloseHandle`). No raw
//! handle, SID, name, path or Win32 error escapes this module; every failure is redacted immediately.

#![cfg(all(windows, feature = "windows-live-scm"))]
#![allow(unsafe_code)]

use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::System::Services::{
    ChangeServiceConfig2W, CloseServiceHandle, ControlService, CreateServiceW, DeleteService,
    OpenSCManagerW, OpenServiceW, QueryServiceConfig2W, QueryServiceStatusEx, StartServiceW,
    SC_HANDLE, SC_MANAGER_CONNECT, SC_MANAGER_CREATE_SERVICE, SC_STATUS_PROCESS_INFO,
    SERVICE_CONFIG_SERVICE_SID_INFO, SERVICE_CONTROL_STOP, SERVICE_DEMAND_START,
    SERVICE_ERROR_NORMAL, SERVICE_QUERY_CONFIG, SERVICE_QUERY_STATUS, SERVICE_RUNNING,
    SERVICE_SID_INFO, SERVICE_SID_TYPE_UNRESTRICTED, SERVICE_START, SERVICE_START_PENDING,
    SERVICE_STATUS, SERVICE_STATUS_PROCESS, SERVICE_STOP, SERVICE_STOPPED, SERVICE_STOP_PENDING,
    SERVICE_WIN32_OWN_PROCESS,
};

use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved, ScmBeforeObserved,
    ServiceInstanceBinding, ServiceInstanceBindingAttempt,
};

use crate::adapter::ScmBackend;
use crate::verification::{
    classify_action_error, classify_open_error, classify_sid_query_error, classify_sid_type,
    ExactNameState, RunStateObservation, ScmActionOutcome, SidPolicyObservation,
};

/// `DELETE` standard access right (0x0001_0000). Part of the stable Win32 ABI; named locally to avoid
/// pulling an unrelated Windows feature.
const STANDARD_DELETE: u32 = 0x0001_0000;
/// Bounded inter-attempt wait for live polling (never runs in tests — the fake backend's wait is a
/// no-op).
const WAIT_MILLIS: u64 = 200;

/// The fixed proof-service name (`ProjectOSHost`), NUL-terminated wide.
fn service_name_wide() -> Vec<u16> {
    "ProjectOSHost"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

/// A SC_HANDLE owned with RAII: closed exactly once via `CloseServiceHandle` on drop.
struct OwnedScHandle(SC_HANDLE);

impl Drop for OwnedScHandle {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            // SAFETY: `self.0` is a valid SC_HANDLE returned by OpenSCManagerW/OpenServiceW/CreateServiceW
            // and not yet closed; Drop runs exactly once (the type is not Clone/Copy), so no double close.
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }
}

/// Extract the redacted Win32 code from a failed call.
fn win32_of(err: &windows::core::Error) -> u32 {
    (err.code().0 as u32) & 0xFFFF
}

/// The live Windows SCM backend. Constructed only from a resolved canonical binary path; never
/// instantiated in this phase.
pub struct WindowsScmBackend {
    /// The service binary path (wide, NUL-terminated), supplied by the accepted canonical creation
    /// request in a later phase. Private; never exposed.
    binary_path_wide: Vec<u16>,
}

impl WindowsScmBackend {
    /// Construct the backend from a resolved binary path. CRATE-PRIVATE; reachable only from a future
    /// gated caller.
    #[allow(dead_code)]
    pub(crate) fn new(binary_path_wide: Vec<u16>) -> Self {
        Self { binary_path_wide }
    }

    /// Contribute the SCM-BEFORE observation to a prepared binding attempt.
    ///
    /// This crate owns the SCM authority and the fixed service name — `open_service` can only ever
    /// open `ProjectOSHost`, with `SERVICE_QUERY_STATUS` alone — but it deliberately does NOT own the
    /// identity. The live service handle is lent to the canonical identity-proof crate, which reads
    /// the status, process ID and process creation time itself, retains the resulting token INSIDE
    /// the attempt, and returns only the attempt in its next state. No token is ever returned here,
    /// so this crate cannot forge, retain, compare or leak a service-instance identity.
    ///
    /// The attempt is consumed, so an SCM-before observation cannot be contributed twice.
    #[allow(dead_code)]
    pub(crate) fn contribute_scm_before(
        &self,
        attempt: ServiceInstanceBindingAttempt<Prepared>,
    ) -> AttemptOutcome<ScmBeforeObserved> {
        let (scm, service) = match Self::open_fixed_service_for_status() {
            Some(pair) => pair,
            None => return AttemptOutcome::Refused(ServiceInstanceBinding::MissingScmObservation),
        };
        let _ = &scm;
        // SAFETY: `service.0` was just opened for SERVICE_QUERY_STATUS on the exact ProjectOSHost
        // service and is kept alive by `service` (RAII `CloseServiceHandle`) for the whole call. The
        // borrowed handle is not retained by the callee.
        unsafe { attempt.observe_scm_before(service.0) }
    }

    /// Contribute the SCM-AFTER observation. Reachable only once the peer has been observed, because
    /// that is the only state this method accepts — the ordering is enforced by the type, not by a
    /// runtime check here.
    #[allow(dead_code)]
    pub(crate) fn contribute_scm_after(
        &self,
        attempt: ServiceInstanceBindingAttempt<IpcPeerObserved>,
    ) -> AttemptOutcome<ScmAfterObserved> {
        let (scm, service) = match Self::open_fixed_service_for_status() {
            Some(pair) => pair,
            None => return AttemptOutcome::Refused(ServiceInstanceBinding::MissingScmObservation),
        };
        let _ = &scm;
        // SAFETY: as above — a freshly-opened, RAII-owned handle for the exact fixed service.
        unsafe { attempt.observe_scm_after(service.0) }
    }

    /// Open the SCM and the exact ProjectOSHost service with query-status rights only. Both handles
    /// are returned so the caller keeps them alive for the borrowed observation.
    fn open_fixed_service_for_status() -> Option<(OwnedScHandle, OwnedScHandle)> {
        let scm = Self::open_scm(SC_MANAGER_CONNECT).ok()?;
        let service = Self::open_service(&scm, SERVICE_QUERY_STATUS).ok()?;
        Some((scm, service))
    }

    /// Open the SCM with the minimum access mask.
    fn open_scm(access: u32) -> Result<OwnedScHandle, u32> {
        // SAFETY: null machine/database names request the local active database; `access` is a minimum
        // rights mask. A returned handle is taken under RAII ownership; on error the code is redacted.
        let result = unsafe { OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), access) };
        match result {
            Ok(h) => Ok(OwnedScHandle(h)),
            Err(e) => Err(win32_of(&e)),
        }
    }

    /// Open the exact ProjectOSHost service with the minimum access mask.
    fn open_service(scm: &OwnedScHandle, access: u32) -> Result<OwnedScHandle, u32> {
        let name = service_name_wide();
        // SAFETY: `scm.0` is a valid SCM handle; `name` is a NUL-terminated wide string alive for the
        // call; `access` is a minimum rights mask. A returned handle is owned via RAII.
        let result = unsafe { OpenServiceW(scm.0, PCWSTR(name.as_ptr()), access) };
        match result {
            Ok(h) => Ok(OwnedScHandle(h)),
            Err(e) => Err(win32_of(&e)),
        }
    }

    /// Query the current run state via `QueryServiceStatusEx`.
    fn query_run_state(service: &OwnedScHandle) -> RunStateObservation {
        let mut buf = [0u8; std::mem::size_of::<SERVICE_STATUS_PROCESS>()];
        let mut needed: u32 = 0;
        // SAFETY: `service.0` is valid; `buf` is a correctly-sized byte buffer for SERVICE_STATUS_PROCESS;
        // `needed` is a valid out-param.
        let ok = unsafe {
            QueryServiceStatusEx(
                service.0,
                SC_STATUS_PROCESS_INFO,
                Some(&mut buf),
                &mut needed,
            )
        };
        if ok.is_err() {
            return RunStateObservation::StateUnavailable;
        }
        // SAFETY: the buffer was filled by a successful QueryServiceStatusEx with a SERVICE_STATUS_PROCESS.
        let status: SERVICE_STATUS_PROCESS =
            unsafe { std::ptr::read_unaligned(buf.as_ptr().cast()) };
        match status.dwCurrentState {
            SERVICE_RUNNING => RunStateObservation::Running,
            SERVICE_STOPPED => RunStateObservation::Stopped,
            SERVICE_START_PENDING => RunStateObservation::StartPending,
            SERVICE_STOP_PENDING => RunStateObservation::StopPending,
            _ => RunStateObservation::Unexpected,
        }
    }

    /// AUTHORITATIVELY re-read the service-SID policy via `QueryServiceConfig2W`
    /// (`SERVICE_CONFIG_SERVICE_SID_INFO`). The raw `dwServiceSidType` is classified immediately; no
    /// raw config buffer, SID or Win32 code escapes.
    fn query_sid_policy(service: &OwnedScHandle) -> SidPolicyObservation {
        // SERVICE_SID_INFO is a single u32; a small fixed buffer is sufficient.
        let mut buf = [0u8; 64];
        let mut needed: u32 = 0;
        // SAFETY: `service.0` is a valid handle opened with SERVICE_QUERY_CONFIG; `buf` is a valid
        // writable buffer and `needed` a valid out-param; the info level matches SERVICE_SID_INFO.
        let ok = unsafe {
            QueryServiceConfig2W(
                service.0,
                SERVICE_CONFIG_SERVICE_SID_INFO,
                Some(&mut buf),
                &mut needed,
            )
        };
        if let Err(e) = ok {
            return classify_sid_query_error(win32_of(&e));
        }
        // SAFETY: on success the buffer holds a SERVICE_SID_INFO whose first field is the u32 SID type.
        let info: SERVICE_SID_INFO = unsafe { std::ptr::read_unaligned(buf.as_ptr().cast()) };
        classify_sid_type(info.dwServiceSidType)
    }
}

impl ScmBackend for WindowsScmBackend {
    fn open_state(&self) -> ExactNameState {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_open_error(code),
        };
        match Self::open_service(&scm, SERVICE_QUERY_STATUS) {
            Ok(_service) => ExactNameState::Present,
            Err(code) => classify_open_error(code),
        }
    }

    fn create(&self) -> ScmActionOutcome {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let name = service_name_wide();
        let account: Vec<u16> = "NT SERVICE\\ProjectOSHost"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: `scm.0` is valid; every wide string is NUL-terminated and alive for the call; no
        // password (null) and no arbitrary dependencies/load-order-group; a demand-start own-process
        // service. A returned handle is owned via RAII.
        let result = unsafe {
            CreateServiceW(
                scm.0,
                PCWSTR(name.as_ptr()),
                PCWSTR(name.as_ptr()),
                SERVICE_START | DELETE_AND_CONFIG_MASK,
                SERVICE_WIN32_OWN_PROCESS,
                SERVICE_DEMAND_START,
                SERVICE_ERROR_NORMAL,
                PCWSTR(self.binary_path_wide.as_ptr()),
                PCWSTR::null(),
                None,
                PCWSTR::null(),
                PCWSTR(account.as_ptr()),
                PCWSTR::null(),
            )
        };
        match result {
            Ok(_service) => ScmActionOutcome::Succeeded,
            Err(e) => classify_action_error(win32_of(&e)),
        }
    }

    fn configure_sid_unrestricted(&self) -> ScmActionOutcome {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let service = match Self::open_service(&scm, SERVICE_QUERY_CONFIG | CHANGE_CONFIG_MASK) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let info = SERVICE_SID_INFO {
            dwServiceSidType: SERVICE_SID_TYPE_UNRESTRICTED,
        };
        // SAFETY: `service.0` is valid; `info` outlives the call and matches SERVICE_CONFIG_SERVICE_SID_INFO.
        let result = unsafe {
            ChangeServiceConfig2W(
                service.0,
                SERVICE_CONFIG_SERVICE_SID_INFO,
                Some((&info as *const SERVICE_SID_INFO).cast()),
            )
        };
        match result {
            Ok(()) => ScmActionOutcome::Succeeded,
            Err(e) => classify_action_error(win32_of(&e)),
        }
    }

    fn sid_policy_observation(&self) -> SidPolicyObservation {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_sid_query_error(code),
        };
        let service = match Self::open_service(&scm, SERVICE_QUERY_CONFIG) {
            Ok(s) => s,
            Err(code) => return classify_sid_query_error(code),
        };
        Self::query_sid_policy(&service)
    }

    fn start(&self) -> ScmActionOutcome {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let service = match Self::open_service(&scm, SERVICE_START) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        // SAFETY: `service.0` is valid; no arguments are passed to the service (None).
        let result = unsafe { StartServiceW(service.0, None) };
        match result {
            Ok(()) => ScmActionOutcome::Succeeded,
            Err(e) => classify_action_error(win32_of(&e)),
        }
    }

    fn run_state(&self) -> RunStateObservation {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(_) => return RunStateObservation::StateUnavailable,
        };
        match Self::open_service(&scm, SERVICE_QUERY_STATUS) {
            Ok(service) => Self::query_run_state(&service),
            Err(_) => RunStateObservation::StateUnavailable,
        }
    }

    fn stop(&self) -> ScmActionOutcome {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let service = match Self::open_service(&scm, SERVICE_STOP) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let mut status = SERVICE_STATUS::default();
        // SAFETY: `service.0` is valid; `status` is a valid writable SERVICE_STATUS; a normal STOP
        // control is requested (never a process termination).
        let result = unsafe { ControlService(service.0, SERVICE_CONTROL_STOP, &mut status) };
        match result {
            Ok(()) => ScmActionOutcome::Succeeded,
            Err(e) => classify_action_error(win32_of(&e)),
        }
    }

    fn delete(&self) -> ScmActionOutcome {
        let scm = match Self::open_scm(SC_MANAGER_CONNECT) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        let service = match Self::open_service(&scm, STANDARD_DELETE) {
            Ok(s) => s,
            Err(code) => return classify_action_error(code),
        };
        // SAFETY: `service.0` is valid; DeleteService marks the exact service for deletion.
        let result = unsafe { DeleteService(service.0) };
        match result {
            Ok(()) => ScmActionOutcome::Succeeded,
            Err(e) => classify_action_error(win32_of(&e)),
        }
    }

    fn wait_between_attempts(&self) {
        std::thread::sleep(Duration::from_millis(WAIT_MILLIS));
    }
}

/// The additional service rights requested at creation so the same handle can be configured/deleted.
const CHANGE_CONFIG_MASK: u32 = 0x0002; // SERVICE_CHANGE_CONFIG
const DELETE_AND_CONFIG_MASK: u32 = CHANGE_CONFIG_MASK | STANDARD_DELETE;

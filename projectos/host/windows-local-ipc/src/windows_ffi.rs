//! The live Windows named-pipe backend — the ONLY module with unsafe. Compiled solely under
//! `all(windows, feature = "windows-live-ipc"))` and INVOKED BY NOTHING in this phase (no sealed
//! capability is constructible).
//!
//! It implements the COMPLETE bounded transport: a protected first-instance message-mode local-only
//! server (consuming host-authority's OPAQUE borrowed security-attributes lease, never storing/freeing/
//! mutating it and never deriving a SID or SDDL); a bounded local client (`WaitNamedPipeW` +
//! `CreateFileW` overlapped + `SetNamedPipeHandleState(PIPE_READMODE_MESSAGE)`, failing closed if
//! message mode cannot be set); bounded overlapped connect/read/write with `ERROR_PIPE_CONNECTED` /
//! `ERROR_IO_PENDING` handling, exact byte-count checks and `ERROR_MORE_DATA` fail-closed; a nonce-bound
//! handshake (a connected pipe is NEVER an authenticated peer); a shutdown request/ack flow; and
//! deterministic `DisconnectNamedPipe` + residue classification.
//!
//! CANCELLATION IS BOUNDED: on timeout the exact operation is cancelled with `CancelIoEx` and then
//! terminalized with `GetOverlappedResultEx` under a fixed cancellation-grace timeout — there is NO
//! unbounded `GetOverlappedResult(.., TRUE)` and no `INFINITE` wait anywhere.
//!
//! ISSUED-I/O UNWIND SAFETY: capacity is admitted BEFORE any pointer reaches Windows, and from the moment
//! an operation is issued the COMPLETE resource graph (admission permit, pipe handle, event, stable
//! `Box<OVERLAPPED>` and I/O buffer) is owned by a single [`IssuedPendingOperation`] guard. Nothing is a
//! separate stack local, so a panic or early unwind cannot drop one piece while Windows still references
//! it: the guard's `Drop` performs a non-allocating, non-waiting, poison-recovering handoff of the whole
//! graph into its OWN pre-reserved quarantine slot. Residue can then never be Zero and shutdown can never
//! be clean.
#![cfg(all(windows, feature = "windows-live-ipc"))]
#![allow(unsafe_code)]

use core::cell::{Cell, RefCell};
use std::sync::{Mutex, MutexGuard, OnceLock};

use projectos_host_authority::ProjectOsHostPipeSecurity;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_NONE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, SetNamedPipeHandleState,
    WaitNamedPipeW, NAMED_PIPE_MODE, PIPE_READMODE_MESSAGE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_MESSAGE, PIPE_WAIT,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResultEx, OVERLAPPED};

use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, ScmBeforeObserved, ServiceInstanceBinding,
    ServiceInstanceBindingAttempt,
};
// PROJECTOS-HOST-REVIEW-PATH1B G3. The canonical CLIENT-ADMISSION attempt, for the direction the
// installed product actually runs in: ProjectOSHost is the pipe SERVER, the governed Agent is the
// CLIENT. Enabled by `windows-live-ipc` alone.
use projectos_host_windows_service_identity_proof::{
    ClientAdmissionObservationCapability, ClientAttemptOutcome, ClientObserved,
    ClientPeerAdmissionAttempt, ClientPrepared,
};

use crate::adapter::{
    BackendState, ConnectionState, EndpointOutcome, HandshakeObservation, HandshakeReceipt,
    IpcBackend, ReceivedFrame, SendOutcome, StatusReceipt,
};
use crate::adapter::{ConfirmedIpcPeerHandshake, LiveIpcOperationCapability};
use crate::contracts::{EndpointFreshness, IpcResidue, IpcShutdownResult, ReplayClassification};
use crate::protocol::{
    decode_installed_host_status, encode_control_frame, encode_installed_host_status,
    parse_single_frame, FrameParseError, InstalledHostStatus, MessageKind, Nonce, MAX_FRAME_SIZE,
    NONCE_LEN,
};
use crate::operation_contract::{
    decode_protected_operation_request, encode_protected_operation_response,
    ProtectedOperationResponse,
};
use crate::review_exchange::ProtectedRequestReceipt;
use crate::verification::{classify_ipc_error, CancellationTerminalState, IpcFailure, PeerRole};

/// The fixed proof-endpoint prefix. The full endpoint is derived internally from this prefix plus a
/// fixed-size ephemeral run identifier; no caller-supplied name or alternate prefix is representable,
/// and the complete endpoint never leaves this module.
const ENDPOINT_PREFIX: &str = r"\\.\pipe\ProjectOS.Test.ServiceIdentityProof.";

/// The ONE fixed PRODUCTION endpoint (PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A). It is a
/// compile-time constant: not caller-supplied, not per-user, not configurable, and there is no second
/// production endpoint. It is selected EXCLUSIVELY by the frozen installed-host run identifier (see
/// [`WindowsPipeBackend::new`]) and is secured by host-authority's four-principal production
/// descriptor (service SID + LocalSystem + Builtin Administrators + exact configured-owner SID),
/// which FAILS CLOSED when no owner is enrolled.
const PRODUCTION_ENDPOINT: &str = r"\\.\pipe\ProjectOS.Host";

/// Bounded pipe I/O buffer sizes and default timeout (milliseconds). No unbounded buffer.
const PIPE_BUFFER_BYTES: u32 = 512;
const PIPE_DEFAULT_TIMEOUT_MS: u32 = 2_000;
/// Bounded wait for a single blocking step (milliseconds). Never an infinite wait.
const WAIT_STEP_MS: u32 = 2_000;
/// The FIXED cancellation-grace window for terminalizing a cancelled operation. Never INFINITE.
const CANCEL_GRACE_MS: u32 = 500;
/// The bounded ceiling on later quarantine terminalization attempts (no unlimited retry).
const QUARANTINE_TERMINALIZATION_ATTEMPTS: u32 = 3;

/// The FIXED maximum number of managed-quarantine entries.
///
/// DERIVATION (architectural, not arbitrary): the transport has exactly ONE fixed proof endpoint and
/// admits exactly ONE proof client (`nMaxInstances = 1`, `FILE_FLAG_FIRST_PIPE_INSTANCE`). Each backend
/// serialises its operations — every helper builds one issued-operation guard, drives it to a terminal
/// state or quarantine, and returns before another can start — so a backend has at most ONE
/// simultaneously pending overlapped operation. The moment a backend quarantines an operation it becomes
/// permanently non-operational (`HandleTransferredToQuarantine` / `BackendUnavailable`) and refuses every
/// further operation, so it contributes at most ONE entry for its whole lifetime. A proof run involves at
/// most TWO live backends (the server role and the client role). Hence
/// `1 pending × 1 entry-per-backend × 2 backends = 2`, and no valid current operation can exceed it.
const MAX_MANAGED_QUARANTINE_ENTRIES: usize = 2;

/// `ERROR_PIPE_CONNECTED` — a client connected between `CreateNamedPipeW` and `ConnectNamedPipe`
/// (race-safe success).
const ERROR_PIPE_CONNECTED: u32 = 535;
/// `ERROR_IO_PENDING` — an overlapped operation is in flight.
const ERROR_IO_PENDING: u32 = 997;
/// `ERROR_MORE_DATA` — the message did not fit the fixed buffer; for this single-frame protocol that is
/// an oversize/malformed frame, NOT a signal to allocate and read more.
const ERROR_MORE_DATA: u32 = 234;
/// `ERROR_OPERATION_ABORTED` — the operation terminated because it was cancelled (confirmed).
const ERROR_OPERATION_ABORTED: u32 = 995;
/// `WAIT_TIMEOUT` — the bounded terminalization window elapsed without a terminal result.
const WAIT_TIMEOUT_CODE: u32 = 258;

/// Read the last Win32 error as a raw code (immediately redacted by the caller).
fn last_error() -> u32 {
    // SAFETY: `GetLastError` reads thread-local error state; always sound.
    unsafe { GetLastError().0 }
}

/// A pipe/event handle owned with RAII: closed exactly once via `CloseHandle` on drop. Prevents double
/// close and exposes no raw handle publicly. Exactly ONE of these exists per raw handle at any time —
/// ownership is always MOVED, never duplicated.
struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: `self.0` is a valid handle this type exclusively owns; `Drop` runs once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// Which operation a pending/quarantined I/O represents (closed, redacted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingOpKind {
    Connect,
    Read,
    Write,
}

/// An address-stable overlapped operation: the `OVERLAPPED` is heap-boxed so Windows retains a stable
/// address for the whole pending lifetime, and it owns its manual-reset event.
struct PendingOp {
    ov: Box<OVERLAPPED>,
    _event: OwnedHandle,
    event_raw: HANDLE,
}

/// The closed result of driving one bounded overlapped operation IN PLACE (the operation is never moved
/// out of its owning guard while it may still be referenced by Windows).
enum OpCompletion {
    /// The operation completed (including the completed-before-cancellation race); byte count attached.
    Completed(u32),
    /// The operation failed terminally, or was confirmed cancelled — redacted.
    Failed(IpcFailure),
    /// Terminal completion could NOT be confirmed within the cancellation grace. The whole graph must be
    /// quarantined; nothing it references may be dropped.
    Unterminalized,
}

impl PendingOp {
    fn new() -> Result<Self, IpcFailure> {
        // SAFETY: null security/name request a default MANUAL-RESET unnamed event; the handle is owned.
        let handle = unsafe { CreateEventW(None, true, false, PCWSTR::null()) };
        let event = match handle {
            Ok(h) if !h.is_invalid() => OwnedHandle(h),
            _ => return Err(classify_ipc_error(last_error())),
        };
        let event_raw = event.0;
        let mut ov = Box::new(OVERLAPPED::default());
        ov.hEvent = event_raw;
        Ok(Self {
            ov,
            _event: event,
            event_raw,
        })
    }

    /// Query terminal completion under a BOUNDED window. `grace_ms` is always a fixed constant; there is
    /// no `INFINITE` and no unbounded blocking query anywhere in this module.
    fn terminalize(&self, handle: HANDLE, grace_ms: u32) -> (CancellationTerminalState, u32) {
        let mut transferred: u32 = 0;
        // SAFETY: `self.ov` is the exact address-stable OVERLAPPED for this operation, still owned here;
        // the query is bounded by `grace_ms`.
        let res = unsafe {
            GetOverlappedResultEx(
                handle,
                &*self.ov as *const OVERLAPPED,
                &mut transferred,
                grace_ms,
                false,
            )
        };
        match res {
            Ok(()) => (
                CancellationTerminalState::CompletedBeforeCancellation,
                transferred,
            ),
            Err(_) => match last_error() {
                WAIT_TIMEOUT_CODE => (
                    CancellationTerminalState::CancellationTerminalizationTimedOut,
                    0,
                ),
                ERROR_OPERATION_ABORTED => (CancellationTerminalState::CancelledConfirmed, 0),
                _ => (CancellationTerminalState::FailedTerminally, 0),
            },
        }
    }

    /// Bounded completion, IN PLACE. Classifies immediate success, `ERROR_PIPE_CONNECTED` and
    /// `ERROR_IO_PENDING`; on the pending path it waits only `WAIT_STEP_MS`, then cancels the EXACT
    /// operation and terminalizes it within `CANCEL_GRACE_MS`. `CancelIoEx` succeeding is NEVER treated as
    /// proof of cancellation. `self` is only borrowed, so the owning guard keeps the whole graph alive.
    fn complete_in_place(
        &mut self,
        handle: HANDLE,
        start_ok: bool,
        timeout: IpcFailure,
    ) -> OpCompletion {
        if !start_ok {
            let code = last_error();
            if code == ERROR_PIPE_CONNECTED {
                return OpCompletion::Completed(0);
            }
            if code != ERROR_IO_PENDING {
                return OpCompletion::Failed(classify_ipc_error(code));
            }
        }
        // SAFETY: `event_raw` is a valid manual-reset event bound to `self.ov`; the wait is bounded.
        let waited = unsafe { WaitForSingleObject(self.event_raw, WAIT_STEP_MS) };
        if waited == WAIT_OBJECT_0 {
            let (state, n) = self.terminalize(handle, 0);
            return match state {
                CancellationTerminalState::CompletedBeforeCancellation => {
                    OpCompletion::Completed(n)
                }
                _ => OpCompletion::Failed(classify_ipc_error(last_error())),
            };
        }
        // Primary timeout: cancel the EXACT operation, then terminalize within the fixed grace.
        // SAFETY: cancels only the operation identified by this exact OVERLAPPED on the owned handle.
        unsafe {
            let _ = CancelIoEx(handle, Some(&*self.ov as *const OVERLAPPED));
        }
        let (state, n) = self.terminalize(handle, CANCEL_GRACE_MS);
        match state {
            // Race: the operation had already completed before the cancellation took effect.
            CancellationTerminalState::CompletedBeforeCancellation => OpCompletion::Completed(n),
            CancellationTerminalState::CancelledConfirmed => OpCompletion::Failed(timeout),
            CancellationTerminalState::FailedTerminally => {
                OpCompletion::Failed(IpcFailure::UnexpectedFailure)
            }
            // NOT terminal — the guard must quarantine the whole graph.
            CancellationTerminalState::CancellationTerminalizationTimedOut => {
                OpCompletion::Unterminalized
            }
        }
    }
}

/// One fixed registry slot. Closed states only.
enum QuarantineSlot {
    /// Free.
    Empty,
    /// Reserved by a live admission permit before any Windows pointer was handed over.
    Reserved,
    /// Holding a quarantined pending operation (complete ownership).
    Occupied(QuarantinedPendingIo),
}

/// A pending operation whose terminal completion could NOT be confirmed. It RETAINS the EXACT pipe
/// handle, the event, the stable OVERLAPPED storage and any I/O buffer, exposes no raw resource, is never
/// dropped as if cleanup succeeded, and forces non-zero residue.
struct QuarantinedPendingIo {
    op: PendingOp,
    /// The EXACT operation handle. Ownership is TRANSFERRED here, so no backend can reuse, disconnect or
    /// close it, and no backend's destruction can free it.
    handle: OwnedHandle,
    /// The read/write buffer the pending operation may still reference — retained, never reallocated.
    _buffer: Option<Box<[u8; MAX_FRAME_SIZE]>>,
    /// The operation kind, retained as required by the quarantine contract (redacted; never surfaced).
    #[allow(dead_code)]
    kind: PendingOpKind,
    attempts: u32,
}

// SAFETY: a quarantined entry has EXCLUSIVE ownership of its handle, event, OVERLAPPED box and buffer —
// no other alias exists once the transfer happens. Windows handles are process-wide and an OVERLAPPED may
// be owned by any single thread, so moving the whole graph into the process-lifetime registry (behind a
// mutex) is sound. Nothing here is shared or copied.
unsafe impl Send for QuarantinedPendingIo {}

/// The PROCESS-LIFETIME managed quarantine, with a STRUCTURALLY FIXED capacity. Unresolved pending-I/O
/// ownership moves here so it SURVIVES destruction of any backend and any unwinding stack frame. There is
/// no `Vec`, no `push`, no `reserve` and no reallocation — the slot array is allocated once and can never
/// grow. Entries are released only after a CONFIRMED terminal result. There is no background thread —
/// draining is explicit and bounded.
struct ManagedQuarantine {
    slots: [QuarantineSlot; MAX_MANAGED_QUARANTINE_ENTRIES],
}

/// Closed, redacted capacity accounting. Invariant: `empty + reserved + occupied == capacity`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ManagedQuarantineCounts {
    /// The fixed capacity.
    pub capacity: usize,
    /// Free slots.
    pub empty: usize,
    /// Slots reserved by a live admission permit.
    pub reserved: usize,
    /// Slots holding an unresolved quarantined operation.
    pub occupied: usize,
}

impl ManagedQuarantineCounts {
    /// Any reserved or occupied slot means pending/unresolved I/O exists.
    #[must_use]
    pub fn has_outstanding(self) -> bool {
        self.reserved != 0 || self.occupied != 0
    }
}

static MANAGED_QUARANTINE: OnceLock<Mutex<ManagedQuarantine>> = OnceLock::new();

fn managed_quarantine() -> &'static Mutex<ManagedQuarantine> {
    MANAGED_QUARANTINE.get_or_init(|| {
        Mutex::new(ManagedQuarantine {
            slots: std::array::from_fn(|_| QuarantineSlot::Empty),
        })
    })
}

/// Acquire the managed-quarantine lock, RECOVERING from mutex poisoning.
///
/// A poisoned mutex means some other thread panicked while holding it — it does NOT mean the quarantined
/// ownership is invalid or unreachable. Poison must never deny access, because denying access would
/// either strand pending-I/O ownership in a droppable owner or make the registry look empty. This helper
/// therefore recovers the guard via `PoisonError::into_inner` and is INFALLIBLE. There is no
/// `unwrap()`/`expect()` on this mutex anywhere, and no panic text or lock diagnostic is ever surfaced.
fn lock_managed_quarantine_recovering_poison() -> MutexGuard<'static, ManagedQuarantine> {
    match managed_quarantine().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Closed capacity accounting, correct under mutex poisoning.
#[must_use]
pub fn managed_quarantine_counts() -> ManagedQuarantineCounts {
    let q = lock_managed_quarantine_recovering_poison();
    let mut empty = 0;
    let mut reserved = 0;
    let mut occupied = 0;
    for slot in q.slots.iter() {
        match slot {
            QuarantineSlot::Empty => empty += 1,
            QuarantineSlot::Reserved => reserved += 1,
            QuarantineSlot::Occupied(_) => occupied += 1,
        }
    }
    ManagedQuarantineCounts {
        capacity: MAX_MANAGED_QUARANTINE_ENTRIES,
        empty,
        reserved,
        occupied,
    }
}

/// The number of slots still outstanding (reserved or occupied). A poisoned registry is RECOVERED, never
/// reported as empty.
#[must_use]
pub fn managed_quarantine_unresolved() -> usize {
    let c = managed_quarantine_counts();
    c.reserved + c.occupied
}

/// A BOUNDED, explicit drain of the managed quarantine. Each occupied entry gets at most
/// [`QUARANTINE_TERMINALIZATION_ATTEMPTS`] tries per call, each bounded by [`CANCEL_GRACE_MS`]; an entry
/// is released (closing its handle exactly once, via `Drop`) ONLY when a terminal state is confirmed.
/// Reserved slots belong to a live operation and are NEVER disturbed. Returns the number of slots still
/// outstanding. Never blocks indefinitely, never fabricates completion, never exposes a raw resource.
#[must_use]
pub fn drain_managed_quarantine() -> usize {
    // Poison is RECOVERED — a poisoned registry still supports bounded terminalization, terminal release,
    // non-terminal retention and truthful outstanding reporting.
    let mut q = lock_managed_quarantine_recovering_poison();
    let mut outstanding = 0;
    for slot in q.slots.iter_mut() {
        match slot {
            QuarantineSlot::Reserved => outstanding += 1,
            QuarantineSlot::Empty => {}
            QuarantineSlot::Occupied(entry) => {
                if entry.attempts >= QUARANTINE_TERMINALIZATION_ATTEMPTS {
                    outstanding += 1; // keep quarantined; never fabricate completion
                    continue;
                }
                entry.attempts += 1;
                let handle = entry.handle.0;
                let (state, _) = entry.op.terminalize(handle, CANCEL_GRACE_MS);
                if state.is_terminal() {
                    // CONFIRMED terminal: release the entry (dropping it closes the handle and event
                    // exactly once and frees the buffer/OVERLAPPED) and return the slot to Empty.
                    *slot = QuarantineSlot::Empty;
                } else {
                    outstanding += 1;
                }
            }
        }
    }
    outstanding
}

/// A private, non-cloneable, non-copyable admission permit for exactly ONE reserved slot. It is acquired
/// BEFORE Windows receives any pointer, is consumed when an entry is installed, and returns its slot on a
/// confirmed terminal completion. There is no public constructor and it exposes no registry reference or
/// handle.
struct QuarantinePermit {
    slot: usize,
    /// `false` = ReservedNotIssued (safe to release on drop); `true` = IssuedPending (Windows may hold a
    /// pointer). An armed permit is only ever released through the issued-operation guard.
    armed: bool,
}

impl QuarantinePermit {
    /// Acquire one free slot, marking it `Reserved`. Returns `None` when the fixed capacity is exhausted —
    /// the caller must then issue NO Windows operation.
    fn acquire() -> Option<Self> {
        let mut q = lock_managed_quarantine_recovering_poison();
        for (i, slot) in q.slots.iter_mut().enumerate() {
            if matches!(slot, QuarantineSlot::Empty) {
                *slot = QuarantineSlot::Reserved;
                return Some(Self {
                    slot: i,
                    armed: false,
                });
            }
        }
        None
    }

    /// Mark the operation as ISSUED: from here only the issued-operation guard may resolve this permit.
    fn arm(&mut self) {
        self.armed = true;
    }

    /// Confirmed terminal completion: return the slot to `Empty` and consume the permit.
    fn release_after_terminal_completion(mut self) {
        {
            let mut q = lock_managed_quarantine_recovering_poison();
            // Never clobber an Occupied slot.
            if matches!(q.slots[self.slot], QuarantineSlot::Reserved) {
                q.slots[self.slot] = QuarantineSlot::Empty;
            }
        }
        self.armed = false; // handled; suppress the Drop path
    }

    /// Install the quarantined operation into this permit's OWN reserved slot and consume the permit.
    /// There is no second, fallible insertion step: the slot was reserved before the I/O was issued.
    /// If the slot is unexpectedly not `Reserved`, FAIL CLOSED by keeping the entry owned in the registry
    /// rather than freeing anything Windows may reference.
    fn install(mut self, entry: QuarantinedPendingIo) {
        {
            let mut q = lock_managed_quarantine_recovering_poison();
            match q.slots[self.slot] {
                // Normal path: our own reservation becomes an occupied entry.
                QuarantineSlot::Reserved | QuarantineSlot::Empty => {
                    q.slots[self.slot] = QuarantineSlot::Occupied(entry);
                }
                // Unexpected transition: never overwrite a live entry and never free this one. Park it in
                // any free slot; if none exists it stays owned by `entry` until this scope ends, which is
                // the fail-closed outcome (capacity is already exhausted, so nothing can be issued).
                QuarantineSlot::Occupied(_) => {
                    let mut parked = Some(entry);
                    for slot in q.slots.iter_mut() {
                        if matches!(slot, QuarantineSlot::Empty) {
                            if let Some(e) = parked.take() {
                                *slot = QuarantineSlot::Occupied(e);
                            }
                            break;
                        }
                    }
                }
            }
        }
        self.armed = false; // ownership installed; suppress the Drop path
    }
}

impl Drop for QuarantinePermit {
    fn drop(&mut self) {
        // Only a permit whose operation was NEVER issued may return its slot. An armed permit is resolved
        // exclusively by the issued-operation guard, so reaching here while armed must NOT free capacity.
        if self.armed {
            return;
        }
        let mut q = lock_managed_quarantine_recovering_poison();
        if matches!(q.slots[self.slot], QuarantineSlot::Reserved) {
            q.slots[self.slot] = QuarantineSlot::Empty;
        }
    }
}

/// The lifecycle of an issued-operation guard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IssueState {
    /// Capacity reserved; Windows holds no pointer yet.
    ReservedNotIssued,
    /// Windows has the OVERLAPPED/buffer pointer; the whole graph must move together.
    IssuedPending,
    /// A terminal result was confirmed; resources may be released normally.
    TerminalConfirmed,
    /// The graph was installed into the pre-reserved quarantine slot.
    InstalledInQuarantine,
}

/// Owns the COMPLETE resource graph of an operation from before it is issued until a terminal result is
/// confirmed or it is quarantined: the admission permit, the EXACT pipe handle, the event + stable
/// `Box<OVERLAPPED>` (inside [`PendingOp`]) and the I/O buffer.
///
/// Because nothing is a separate stack local after the issue point, a panic or early unwind cannot drop
/// one part while Windows still references another: `Drop` hands the whole graph off into the reserved
/// quarantine slot. Not public, not `Clone`, not `Copy`, exposes no raw resource.
struct IssuedPendingOperation {
    state: IssueState,
    permit: Option<QuarantinePermit>,
    op: Option<PendingOp>,
    buffer: Option<Box<[u8; MAX_FRAME_SIZE]>>,
    handle: Option<OwnedHandle>,
    kind: PendingOpKind,
    raw_handle: HANDLE,
}

impl IssuedPendingOperation {
    /// Build the guard BEFORE the operation is issued. It already owns everything Windows will be given.
    fn new(
        permit: QuarantinePermit,
        op: PendingOp,
        handle: OwnedHandle,
        buffer: Option<Box<[u8; MAX_FRAME_SIZE]>>,
        kind: PendingOpKind,
    ) -> Self {
        let raw_handle = handle.0;
        Self {
            state: IssueState::ReservedNotIssued,
            permit: Some(permit),
            op: Some(op),
            buffer,
            handle: Some(handle),
            kind,
            raw_handle,
        }
    }

    /// The raw handle for the Windows call (a copy; the single owner stays inside this guard).
    fn raw_handle(&self) -> HANDLE {
        self.raw_handle
    }

    /// The address-stable OVERLAPPED pointer for the Windows call.
    fn overlapped_ptr(&mut self) -> *mut OVERLAPPED {
        match self.op.as_mut() {
            Some(op) => &mut *op.ov,
            None => core::ptr::null_mut(),
        }
    }

    /// Mark the operation ISSUED. From here `Drop` performs the quarantine handoff.
    fn mark_issued(&mut self) {
        self.state = IssueState::IssuedPending;
        if let Some(p) = self.permit.as_mut() {
            p.arm();
        }
    }

    /// Drive the bounded completion in place — the graph never leaves this guard.
    fn complete_bounded(&mut self, start_ok: bool, timeout: IpcFailure) -> OpCompletion {
        let raw = self.raw_handle;
        match self.op.as_mut() {
            Some(op) => op.complete_in_place(raw, start_ok, timeout),
            None => OpCompletion::Failed(IpcFailure::UnexpectedFailure),
        }
    }

    /// Confirmed terminal completion: release the permit and hand the handle + buffer back to the caller.
    fn finish_terminal(mut self) -> (Option<OwnedHandle>, Option<Box<[u8; MAX_FRAME_SIZE]>>) {
        self.state = IssueState::TerminalConfirmed;
        if let Some(p) = self.permit.take() {
            p.release_after_terminal_completion();
        }
        let handle = self.handle.take();
        let buffer = self.buffer.take();
        // `op` drops here: the operation reached a confirmed terminal state, so its event and OVERLAPPED
        // are no longer referenced by Windows.
        (handle, buffer)
    }

    /// Unconfirmed terminalization: install the COMPLETE graph into the pre-reserved slot.
    fn install_into_quarantine(&mut self) {
        // Non-allocating, non-waiting, poison-recovering handoff.
        let (Some(permit), Some(op), Some(handle)) =
            (self.permit.take(), self.op.take(), self.handle.take())
        else {
            // Nothing left to hand off (already resolved).
            self.state = IssueState::InstalledInQuarantine;
            return;
        };
        permit.install(QuarantinedPendingIo {
            op,
            handle,
            _buffer: self.buffer.take(),
            kind: self.kind,
            attempts: 0,
        });
        self.state = IssueState::InstalledInQuarantine;
    }
}

impl Drop for IssuedPendingOperation {
    fn drop(&mut self) {
        // Only an ISSUED, unresolved operation needs the handoff. Pre-issue drops let the (unarmed) permit
        // return its slot normally; resolved states already released or installed everything.
        if self.state != IssueState::IssuedPending {
            return;
        }
        // Non-panicking, non-allocating, non-waiting ownership handoff into the reserved slot.
        self.install_into_quarantine();
    }
}

/// Which fixed endpoint family a backend is bound to. Derived INTERNALLY from the run identifier in
/// [`WindowsPipeBackend::new`] — no caller supplies a pipe name and no third family exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EndpointBinding {
    /// The run-scoped `ProjectOS.Test.ServiceIdentityProof.<runid>` proof namespace (fixtures).
    TestProof,
    /// The single fixed production endpoint, [`PRODUCTION_ENDPOINT`].
    Production,
}

/// Build the bound endpoint as a NUL-terminated wide string: the fixed production name, or the fixed
/// proof prefix plus the fixed-size ephemeral run identifier. The identifier carries no
/// username/SID/machine/service/path/credential.
fn endpoint_wide(binding: EndpointBinding, run_id: &[u8; 8]) -> Vec<u16> {
    let name = match binding {
        EndpointBinding::Production => String::from(PRODUCTION_ENDPOINT),
        EndpointBinding::TestProof => {
            let mut name = String::from(ENDPOINT_PREFIX);
            for b in run_id {
                name.push_str(&format!("{b:02x}"));
            }
            name
        }
    };
    name.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The live Windows named-pipe backend.
pub struct WindowsPipeBackend {
    run_id: [u8; 8],
    /// The fixed endpoint family this backend is bound to (derived from the run identifier; never
    /// caller-supplied).
    binding: EndpointBinding,
    /// The server pipe handle. It is MOVED into the issued-operation guard for the duration of every
    /// operation and permanently into quarantine if terminalization is unconfirmed, so this backend
    /// structurally cannot close or reuse a handle Windows may still reference.
    server: RefCell<Option<OwnedHandle>>,
    /// The closed backend lifecycle state.
    state: Cell<BackendState>,
    /// The expected single-use handshake nonce. Its value is never exposed.
    nonce: Nonce,
    /// Whether the nonce has been consumed (single use).
    nonce_consumed: Cell<bool>,
    /// Whether the endpoint was created as the first instance (fresh).
    fresh: Cell<bool>,
}

impl WindowsPipeBackend {
    /// Construct the backend for a fixed ephemeral run identifier and its expected single-use nonce.
    #[must_use]
    pub fn new(run_id: [u8; 8]) -> Self {
        // The endpoint family is derived HERE, from the run identifier, never from a caller-supplied
        // name: EXACTLY the frozen installed-host run identifier binds the single fixed production
        // endpoint; every other run identifier stays in the run-scoped test proof namespace.
        let binding = if run_id == crate::protocol::INSTALLED_HOST_STATUS_RUN_ID {
            EndpointBinding::Production
        } else {
            EndpointBinding::TestProof
        };
        // The nonce is derived internally from the fixed-size run identifier; a later trusted boundary
        // supplies it. It is never accepted from an arbitrary public byte vector.
        let mut bytes = [0u8; NONCE_LEN];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = run_id[i % run_id.len()];
        }
        Self {
            run_id,
            binding,
            server: RefCell::new(None),
            state: Cell::new(BackendState::BackendUnavailable),
            nonce: Nonce::from_fixed_bytes(bytes),
            nonce_consumed: Cell::new(false),
            fresh: Cell::new(false),
        }
    }

    /// Observe the OS-derived instance identity of the CONFIRMED pipe peer.
    ///
    /// The B3 transport makes this side the pipe SERVER (`CreateNamedPipeW` + `ConnectNamedPipe`) and
    /// the service fixture the CLIENT, so the peer identity is the client's — that direction is why
    /// the canonical crate uses `GetNamedPipeClientProcessId` rather than its server counterpart.
    ///
    /// The handshake result is passed in rather than re-derived: a peer's DECLARED role is a protocol
    /// assertion, so it gates the observation but never supplies the identity. The identity itself is
    /// read from Windows by the canonical identity-proof crate, which is lent the live handle only for
    /// the duration of the call. No raw process ID is read or held here.
    ///
    /// `connected` reflects this backend's own state: an Operational backend still holding its server
    /// handle. A peer that has actually gone away is caught by the callee, whose peer read fails and
    /// whose post-capture re-read enforces peer stability.
    ///
    /// The attempt is consumed and returned in its next state, so this crate never receives a token:
    /// the identity is read by the canonical crate and retained INSIDE the attempt. Contributing is
    /// possible only from the `ScmBeforeObserved` state, so the peer can never be observed before the
    /// SCM baseline, and never twice.
    #[allow(dead_code)]
    pub(crate) fn contribute_ipc_peer(
        &self,
        attempt: ServiceInstanceBindingAttempt<ScmBeforeObserved>,
        handshake_confirmed: bool,
        confirmed_peer_role: PeerRole,
    ) -> AttemptOutcome<IpcPeerObserved> {
        // A backend whose handle went to quarantine, or which is otherwise not operational, can never
        // present a trustworthy peer.
        if self.state.get() != BackendState::Operational || self.has_quarantined_io() {
            return AttemptOutcome::Refused(ServiceInstanceBinding::MissingIpcObservation);
        }
        let borrowed = self.server.borrow();
        let Some(handle) = borrowed.as_ref().map(|h| h.0) else {
            return AttemptOutcome::Refused(ServiceInstanceBinding::MissingIpcObservation);
        };
        // SAFETY: `handle` is this backend's live server pipe handle. The `borrowed` guard keeps the
        // owning `OwnedHandle` alive for the whole call, and the callee only reads through it and
        // never retains or closes it.
        unsafe {
            attempt.observe_ipc_peer(
                handle,
                true,
                handshake_confirmed,
                confirmed_peer_role == PeerRole::ServiceFixture,
            )
        }
    }

    /// Drive the canonical CLIENT-ADMISSION capture against the CONFIRMED pipe client.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B G3, ROUTE 1. The exact mirror of `contribute_ipc_peer` above,
    /// for the other proposition: not "is the peer the SCM-observed service" but "is the connected
    /// client the EXACT enrolled configured owner". It reuses the canonical crate already-audited
    /// capture verbatim and adds no Windows surface, no import and no unsafe block of its own - the
    /// kernel reads are identical either way, because `GetNamedPipeClientProcessId` plus the
    /// impersonated token reads always describe the CLIENT of a server handle.
    ///
    /// The handle is LENT for the duration of the call: the callee reads through it and never
    /// retains, duplicates or closes it, and the `borrowed` guard keeps the owning handle alive.
    ///
    /// `handshake_confirmed` and the role are the caller OWN confirmed handshake result, passed in
    /// rather than re-derived: a peer DECLARED role is a protocol assertion, so it gates the
    /// observation and never supplies the identity. `connection_id` and `handshake_generation` are
    /// HOST-issued and come from the sealed per-connection verifier.
    ///
    /// The attempt is CONSUMED and returned in its next state, so this crate never receives an
    /// identity: it is read by the canonical crate and retained INSIDE the attempt.
    #[allow(dead_code)]
    pub(crate) fn admit_governed_client(
        &self,
        attempt: ClientPeerAdmissionAttempt<ClientPrepared>,
        capability: &ClientAdmissionObservationCapability,
        handshake_confirmed: bool,
        confirmed_peer_role: PeerRole,
        connection_id: u64,
        handshake_generation: u64,
    ) -> ClientAttemptOutcome<ClientObserved> {
        // A backend whose handle went to quarantine, or which is otherwise not operational, can
        // never present a trustworthy client. Fail closed with the canonical no-observation verdict.
        if self.state.get() != BackendState::Operational || self.has_quarantined_io() {
            return ClientAttemptOutcome::Refused(
                projectos_host_windows_service_identity_proof::ClientAdmissionVerdict::NoClientObservation,
            );
        }
        let borrowed = self.server.borrow();
        let Some(handle) = borrowed.as_ref().map(|h| h.0) else {
            return ClientAttemptOutcome::Refused(
                projectos_host_windows_service_identity_proof::ClientAdmissionVerdict::NoClientObservation,
            );
        };
        // SAFETY: `handle` is this backend live server pipe handle. The `borrowed` guard keeps the
        // owning `OwnedHandle` alive for the whole call, and the callee only reads through it and
        // never retains or closes it.
        unsafe {
            attempt.observe_client_identity(
                capability,
                handle,
                true,
                handshake_confirmed,
                // THE PRODUCTION CLIENT ROLE. The governed Agent connects as the controller; that is
                // the role the accepted handshake confirms, and the only one this gate accepts.
                confirmed_peer_role == PeerRole::Controller,
                connection_id,
                handshake_generation,
            )
        }
    }

    /// Re-observe the client and reconcile it against what the attempt already recorded.
    ///
    /// The second reading is what closes the swap window between the capture and the admission: the
    /// canonical crate refuses if the process instance, the EXACT user, the EXACT session or either
    /// host-issued identifier diverged. Integrity is never compared, so a client that elevates
    /// between the two readings keeps exactly the identity it already had.
    #[allow(dead_code)]
    pub(crate) fn reconcile_governed_client(
        &self,
        attempt: ClientPeerAdmissionAttempt<ClientObserved>,
        capability: &ClientAdmissionObservationCapability,
        handshake_confirmed: bool,
        confirmed_peer_role: PeerRole,
        connection_id: u64,
        handshake_generation: u64,
    ) -> ClientAttemptOutcome<ClientObserved> {
        if self.state.get() != BackendState::Operational || self.has_quarantined_io() {
            return ClientAttemptOutcome::Refused(
                projectos_host_windows_service_identity_proof::ClientAdmissionVerdict::NoClientObservation,
            );
        }
        let borrowed = self.server.borrow();
        let Some(handle) = borrowed.as_ref().map(|h| h.0) else {
            return ClientAttemptOutcome::Refused(
                projectos_host_windows_service_identity_proof::ClientAdmissionVerdict::NoClientObservation,
            );
        };
        // SAFETY: as above - a live server handle, lent for the duration of this call only.
        unsafe {
            attempt.reobserve_client_identity(
                capability,
                handle,
                true,
                handshake_confirmed,
                confirmed_peer_role == PeerRole::Controller,
                connection_id,
                handshake_generation,
            )
        }
    }

    /// Take the server handle OUT of the backend for the duration of an operation.
    fn take_server_handle(&self) -> Option<OwnedHandle> {
        self.server.borrow_mut().take()
    }

    /// Return the handle after a confirmed terminal completion.
    fn restore_server_handle(&self, handle: Option<OwnedHandle>) {
        if let Some(h) = handle {
            *self.server.borrow_mut() = Some(h);
        }
    }

    /// Mark the backend permanently unusable after its handle went to quarantine.
    fn mark_transferred(&self) {
        self.state.set(BackendState::HandleTransferredToQuarantine);
    }

    /// Create the BOUND fixed endpoint (run-scoped proof namespace or the single production
    /// endpoint) as the FIRST message-mode, local-only instance, consuming host-authority's opaque
    /// borrowed security-attributes lease for the single `CreateNamedPipeW` call.
    fn create_first_instance(&self) -> EndpointOutcome {
        // Obtain the opaque security for the BOUND endpoint family. The production endpoint demands
        // the four-principal production descriptor (service SID + SY + BA + exact configured-owner
        // SID, failing closed when no owner is enrolled); the proof namespace keeps the accepted
        // three-principal proof descriptor. Fail closed if not Ready (no weaker fallback).
        let (_status, security) = match self.binding {
            EndpointBinding::Production => ProjectOsHostPipeSecurity::resolve_production(),
            EndpointBinding::TestProof => ProjectOsHostPipeSecurity::resolve(),
        };
        let security = match security {
            Some(s) => s,
            None => return EndpointOutcome::Failed(IpcFailure::SecurityPrincipalUnavailable),
        };
        let lease = security.borrowed_security_attributes();
        let wide = endpoint_wide(self.binding, &self.run_id);
        let open_mode = PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED;
        let pipe_mode =
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
        // SAFETY: `wide` is a NUL-terminated wide string alive for the call; the security-attributes
        // pointer BORROWS `lease` (hence `security`), is used ONLY for this call, and is neither stored,
        // freed nor mutated. `nMaxInstances = 1` enforces a single instance.
        let handle = unsafe {
            let sa: *const SECURITY_ATTRIBUTES = lease.as_security_attributes_ptr();
            CreateNamedPipeW(
                PCWSTR(wide.as_ptr()),
                open_mode,
                pipe_mode,
                1,
                PIPE_BUFFER_BYTES,
                PIPE_BUFFER_BYTES,
                PIPE_DEFAULT_TIMEOUT_MS,
                Some(sa),
            )
        };
        // The borrowed lease is dropped at the end of this scope; the pointer is never used again.
        if handle == INVALID_HANDLE_VALUE {
            let code = last_error();
            return match classify_ipc_error(code) {
                IpcFailure::EndpointAlreadyExists => EndpointOutcome::NotFirstInstance,
                other => EndpointOutcome::Failed(other),
            };
        }
        *self.server.borrow_mut() = Some(OwnedHandle(handle));
        self.fresh.set(true);
        self.state.set(BackendState::Operational);
        EndpointOutcome::FirstInstanceReady
    }

    /// Bounded overlapped `ConnectNamedPipe`, admitted before the call and unwind-safe after it.
    fn accept_connection(&self) -> Result<(), IpcFailure> {
        let handle = self
            .take_server_handle()
            .ok_or(IpcFailure::EndpointUnavailable)?;
        // ADMISSION BEFORE I/O: reserve a quarantine slot before Windows receives any pointer. Without a
        // permit the operation is NEVER issued (and the handle goes straight back).
        let permit = match QuarantinePermit::acquire() {
            Some(p) => p,
            None => {
                self.restore_server_handle(Some(handle));
                return Err(IpcFailure::QuarantineCapacityUnavailable);
            }
        };
        let op = match PendingOp::new() {
            Ok(o) => o,
            Err(e) => {
                self.restore_server_handle(Some(handle));
                return Err(e);
            }
        };
        // From here the COMPLETE graph is owned by one guard.
        let mut issued =
            IssuedPendingOperation::new(permit, op, handle, None, PendingOpKind::Connect);
        let ov = issued.overlapped_ptr();
        issued.mark_issued();
        // SAFETY: the handle is a valid overlapped pipe handle owned by `issued`; `ov` is the
        // address-stable OVERLAPPED bound to a live manual-reset event, also owned by `issued`, and the
        // guard keeps both alive until a terminal state is confirmed or they are quarantined.
        let start_ok = unsafe { ConnectNamedPipe(issued.raw_handle(), Some(ov)) }.is_ok();
        match issued.complete_bounded(start_ok, IpcFailure::ConnectionTimedOut) {
            OpCompletion::Completed(_) => {
                let (handle, _) = issued.finish_terminal();
                self.restore_server_handle(handle);
                Ok(())
            }
            OpCompletion::Failed(f) => {
                let (handle, _) = issued.finish_terminal();
                self.restore_server_handle(handle);
                Err(f)
            }
            OpCompletion::Unterminalized => {
                issued.install_into_quarantine();
                self.mark_transferred();
                Err(IpcFailure::ConnectionTimedOut)
            }
        }
    }

    /// Open the local client end: bounded availability wait, overlapped generic read/write, then enforce
    /// message-read mode (fail closed if it cannot be set — never continue in byte mode).
    fn open_client(&self) -> Result<OwnedHandle, IpcFailure> {
        let wide = endpoint_wide(self.binding, &self.run_id);
        // Bounded availability wait for a busy endpoint; never an unbounded loop.
        // SAFETY: `wide` is a NUL-terminated wide string alive for the call; the wait is bounded.
        let _ = unsafe { WaitNamedPipeW(PCWSTR(wide.as_ptr()), WAIT_STEP_MS) };
        // SAFETY: `wide` is alive for the call; no security attributes for the client open; overlapped.
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                None,
            )
        };
        let client = match handle {
            Ok(h) if !h.is_invalid() => OwnedHandle(h),
            // Access denied / malformed endpoint / policy refusals are NEVER retried.
            _ => return Err(classify_ipc_error(last_error())),
        };
        // Enforce PIPE_READMODE_MESSAGE. Failure fails closed — never continue in byte-read mode.
        let mode: NAMED_PIPE_MODE = PIPE_READMODE_MESSAGE;
        // SAFETY: `client.0` is a valid pipe handle; `mode` is a valid local value for the call.
        let set = unsafe { SetNamedPipeHandleState(client.0, Some(&mode), None, None) };
        if set.is_err() {
            return Err(classify_ipc_error(last_error()));
        }
        Ok(client)
    }

    /// Write one closed frame over a bounded, admitted, unwind-safe overlapped operation, confirming the
    /// EXACT byte count. `flag` carries the closed peer-role discriminant for handshake frames.
    /// Write one ALREADY-ENCODED frame.
    ///
    /// It takes bytes rather than `(kind, flag)` so the same bounded, quarantine-guarded write path
    /// serves both the 1-byte control frames and the fixed-width status record. This is PRIVATE: the
    /// public surface exposes no generic send, only the specific operations below.
    fn write_frame_owned(
        &self,
        handle: OwnedHandle,
        frame: &[u8],
    ) -> (Option<OwnedHandle>, Result<(), IpcFailure>) {
        let len = frame.len();
        if len > MAX_FRAME_SIZE {
            return (Some(handle), Err(IpcFailure::UnexpectedFailure));
        }
        // The outbound bytes live in a HEAP buffer owned by the guard, so they are never moved or dropped
        // while Windows may reference them.
        let mut buf = Box::new([0u8; MAX_FRAME_SIZE]);
        buf[..len].copy_from_slice(frame);
        // ADMISSION BEFORE I/O: no permit, no WriteFile.
        let permit = match QuarantinePermit::acquire() {
            Some(p) => p,
            None => return (Some(handle), Err(IpcFailure::QuarantineCapacityUnavailable)),
        };
        let op = match PendingOp::new() {
            Ok(o) => o,
            Err(e) => return (Some(handle), Err(e)),
        };
        let mut issued =
            IssuedPendingOperation::new(permit, op, handle, Some(buf), PendingOpKind::Write);
        let ov = issued.overlapped_ptr();
        let mut written: u32 = 0;
        issued.mark_issued();
        // SAFETY: the handle and the heap buffer are owned by `issued` for the whole pending lifetime; the
        // buffer slice is valid for `len` bytes; `ov` is the address-stable OVERLAPPED bound to a live
        // event, also owned by `issued`.
        let start_ok = {
            let raw = issued.raw_handle();
            let slice: &[u8] = match issued.buffer.as_ref() {
                Some(b) => &b[..len],
                None => &[],
            };
            unsafe { WriteFile(raw, Some(slice), Some(&mut written), Some(ov)) }.is_ok()
        };
        match issued.complete_bounded(start_ok, IpcFailure::WriteTimedOut) {
            OpCompletion::Completed(transferred) => {
                let (handle, _) = issued.finish_terminal();
                // A partial or contradictory completion fails closed.
                if transferred as usize != len {
                    return (handle, Err(IpcFailure::UnexpectedFailure));
                }
                (handle, Ok(()))
            }
            OpCompletion::Failed(f) => {
                let (handle, _) = issued.finish_terminal();
                (handle, Err(f))
            }
            OpCompletion::Unterminalized => {
                issued.install_into_quarantine();
                (None, Err(IpcFailure::WriteTimedOut))
            }
        }
    }

    /// Read one bounded frame into a FIXED heap buffer owned by the guard (never allocates from an
    /// untrusted length). `ERROR_MORE_DATA` fails closed, never triggering another read.
    #[allow(clippy::type_complexity)]
    fn read_raw_owned(
        &self,
        handle: OwnedHandle,
    ) -> (
        Option<OwnedHandle>,
        Result<(Box<[u8; MAX_FRAME_SIZE]>, usize), IpcFailure>,
    ) {
        let buf = Box::new([0u8; MAX_FRAME_SIZE]);
        // ADMISSION BEFORE I/O: no permit, no ReadFile.
        let permit = match QuarantinePermit::acquire() {
            Some(p) => p,
            None => return (Some(handle), Err(IpcFailure::QuarantineCapacityUnavailable)),
        };
        let op = match PendingOp::new() {
            Ok(o) => o,
            Err(e) => return (Some(handle), Err(e)),
        };
        let mut issued =
            IssuedPendingOperation::new(permit, op, handle, Some(buf), PendingOpKind::Read);
        let ov = issued.overlapped_ptr();
        let mut read: u32 = 0;
        issued.mark_issued();
        // SAFETY: the handle and the heap buffer are owned by `issued` for the whole pending lifetime, so
        // Windows can never write into freed or moved memory; `ov` is the address-stable OVERLAPPED bound
        // to a live event, also owned by `issued`.
        let start_ok = {
            let raw = issued.raw_handle();
            match issued.buffer.as_mut() {
                Some(b) => {
                    unsafe { ReadFile(raw, Some(&mut b[..]), Some(&mut read), Some(ov)) }.is_ok()
                }
                None => false,
            }
        };
        // ERROR_MORE_DATA on the start path is a fixed-frame overflow — fail closed, never re-read.
        let more_data = !start_ok && last_error() == ERROR_MORE_DATA;
        match issued.complete_bounded(start_ok, IpcFailure::ReadTimedOut) {
            OpCompletion::Completed(n) => {
                let (handle, buffer) = issued.finish_terminal();
                if more_data {
                    return (handle, Err(IpcFailure::UnexpectedFailure));
                }
                match buffer {
                    Some(b) => (handle, Ok((b, n as usize))),
                    None => (handle, Err(IpcFailure::UnexpectedFailure)),
                }
            }
            OpCompletion::Failed(f) => {
                let (handle, _) = issued.finish_terminal();
                if more_data {
                    return (handle, Err(IpcFailure::UnexpectedFailure));
                }
                (handle, Err(f))
            }
            OpCompletion::Unterminalized => {
                issued.install_into_quarantine();
                (None, Err(IpcFailure::ReadTimedOut))
            }
        }
    }

    /// Server-side write: takes and restores the server handle around the operation.
    fn write_frame(&self, frame: &[u8]) -> Result<(), IpcFailure> {
        let handle = self
            .take_server_handle()
            .ok_or(IpcFailure::EndpointUnavailable)?;
        let (returned, result) = self.write_frame_owned(handle, frame);
        if returned.is_none() {
            self.mark_transferred();
        }
        self.restore_server_handle(returned);
        result
    }

    /// Server-side read of one raw frame.
    #[allow(clippy::type_complexity)]
    fn read_raw(&self) -> Result<(Box<[u8; MAX_FRAME_SIZE]>, usize), IpcFailure> {
        let handle = self
            .take_server_handle()
            .ok_or(IpcFailure::EndpointUnavailable)?;
        let (returned, result) = self.read_raw_owned(handle);
        if returned.is_none() {
            self.mark_transferred();
        }
        self.restore_server_handle(returned);
        result
    }

    /// Read and parse exactly one frame.
    fn read_frame(&self) -> ReceivedFrame {
        match self.read_raw() {
            Ok((buf, n)) => match parse_single_frame(&buf[..n]) {
                Ok((hdr, _nonce)) => ReceivedFrame::Ok(hdr.kind()),
                Err(e) => ReceivedFrame::Malformed(e),
            },
            Err(IpcFailure::UnexpectedFailure) => {
                ReceivedFrame::Malformed(FrameParseError::OversizedPayload)
            }
            Err(f) => ReceivedFrame::Failed(f),
        }
    }
}

impl IpcBackend for WindowsPipeBackend {
    fn state(&self) -> BackendState {
        self.state.get()
    }

    fn open_endpoint(&self) -> EndpointOutcome {
        // A backend whose handle was transferred to quarantine is permanently unusable.
        if self.state.get() == BackendState::HandleTransferredToQuarantine {
            return EndpointOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        self.create_first_instance()
    }

    fn connect_unauthenticated(&self) -> ConnectionState {
        if !self.state.get().is_operational() {
            return ConnectionState::ConnectFailed(IpcFailure::EndpointUnavailable);
        }
        match self.accept_connection() {
            Ok(()) => ConnectionState::TransportConnectedUnauthenticated,
            Err(f) => ConnectionState::ConnectFailed(f),
        }
    }

    fn send_handshake(&self, kind: MessageKind, role: PeerRole) -> SendOutcome {
        if !self.state.get().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        match self.write_frame(&encode_control_frame(kind, &self.nonce, role.wire())) {
            Ok(()) => SendOutcome::Sent,
            Err(f) => SendOutcome::Failed(f),
        }
    }

    fn receive_handshake(&self) -> HandshakeReceipt {
        if !self.state.get().is_operational() {
            return HandshakeReceipt::Failed(IpcFailure::EndpointUnavailable);
        }
        match self.read_raw() {
            Ok((buf, n)) => match parse_single_frame(&buf[..n]) {
                Ok((hdr, nonce)) => {
                    let replay = if self.nonce_consumed.get() {
                        ReplayClassification::ReplayRefused
                    } else {
                        ReplayClassification::FreshAccepted
                    };
                    let freshness = if self.fresh.get() {
                        EndpointFreshness::Fresh
                    } else {
                        EndpointFreshness::Stale
                    };
                    let nonce_matches = nonce == self.nonce;
                    if nonce_matches {
                        // Single use: consume on the first matching handshake frame.
                        self.nonce_consumed.set(true);
                    }
                    HandshakeReceipt::Observed(HandshakeObservation {
                        kind: hdr.kind(),
                        nonce_matches,
                        role: PeerRole::from_wire(hdr.control_flag()),
                        replay,
                        freshness,
                    })
                }
                Err(e) => HandshakeReceipt::Malformed(e),
            },
            Err(IpcFailure::UnexpectedFailure) => {
                HandshakeReceipt::Malformed(FrameParseError::OversizedPayload)
            }
            Err(f) => HandshakeReceipt::Failed(f),
        }
    }

    fn receive_frame(&self) -> ReceivedFrame {
        if !self.state.get().is_operational() {
            return ReceivedFrame::Failed(IpcFailure::EndpointUnavailable);
        }
        self.read_frame()
    }

    fn send_installed_host_status(&self, status: &InstalledHostStatus) -> SendOutcome {
        if !self.state.get().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        // The record is encoded by the canonical encoder; this method accepts no arbitrary bytes.
        match self.write_frame(&encode_installed_host_status(&self.nonce, status)) {
            Ok(()) => SendOutcome::Sent,
            Err(f) => SendOutcome::Failed(f),
        }
    }

    fn receive_installed_host_status(&self) -> StatusReceipt {
        if !self.state.get().is_operational() {
            return StatusReceipt::Failed(IpcFailure::EndpointUnavailable);
        }
        match self.read_raw() {
            // The STRICT decoder judges the bytes. Nothing here inspects or exposes the payload.
            Ok((buf, n)) => match decode_installed_host_status(&buf[..n]) {
                Ok((status, _nonce)) => StatusReceipt::Ok(status),
                Err(e) => StatusReceipt::Malformed(e),
            },
            Err(IpcFailure::UnexpectedFailure) => {
                StatusReceipt::Malformed(FrameParseError::OversizedPayload)
            }
            Err(f) => StatusReceipt::Failed(f),
        }
    }

    fn receive_protected_operation_request(&self) -> ProtectedRequestReceipt {
        if !self.state.get().is_operational() {
            return ProtectedRequestReceipt::Failed(IpcFailure::EndpointUnavailable);
        }
        match self.read_raw() {
            // The STRICT decoder judges the bytes, and the frame must carry THIS exchange's nonce.
            // Nothing here inspects or exposes the payload.
            Ok((buf, n)) => match decode_protected_operation_request(&buf[..n]) {
                Ok((request, nonce)) if nonce == self.nonce => ProtectedRequestReceipt::Ok(request),
                Ok(_) => ProtectedRequestReceipt::RefusedNonce,
                Err(e) => ProtectedRequestReceipt::Malformed(e),
            },
            Err(IpcFailure::UnexpectedFailure) => {
                ProtectedRequestReceipt::Malformed(FrameParseError::OversizedPayload)
            }
            Err(f) => ProtectedRequestReceipt::Failed(f),
        }
    }

    fn send_protected_operation_response(
        &self,
        response: &ProtectedOperationResponse,
    ) -> SendOutcome {
        if !self.state.get().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        // The record is encoded by the canonical encoder; this method accepts no arbitrary bytes.
        match self.write_frame(&encode_protected_operation_response(&self.nonce, response)) {
            Ok(()) => SendOutcome::Sent,
            Err(f) => SendOutcome::Failed(f),
        }
    }

    fn send_control(&self, kind: MessageKind) -> SendOutcome {
        if !self.state.get().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        match self.write_frame(&encode_control_frame(
            kind,
            &self.nonce,
            PeerRole::RefusedOrUnknown.wire(),
        )) {
            Ok(()) => SendOutcome::Sent,
            Err(f) => SendOutcome::Failed(f),
        }
    }

    fn confirm_shutdown(&self) -> IpcShutdownResult {
        if !self.state.get().is_operational() {
            return IpcShutdownResult::ShutdownFailed;
        }
        // Send ShutdownRequest, then REQUIRE a ShutdownAcknowledged frame. Any other kind or any failure
        // fails closed — closing a handle alone never fabricates a clean shutdown. Both legs are admitted
        // and unwind-safe because they go through the same guarded helpers.
        if self
            .write_frame(&encode_control_frame(
                MessageKind::ShutdownRequest,
                &self.nonce,
                PeerRole::Controller.wire(),
            ))
            .is_err()
        {
            return IpcShutdownResult::ShutdownFailed;
        }
        match self.read_frame() {
            ReceivedFrame::Ok(MessageKind::ShutdownAcknowledged) => {
                IpcShutdownResult::CleanShutdown
            }
            _ => IpcShutdownResult::ShutdownFailed,
        }
    }

    fn close_residue(&self) -> IpcResidue {
        // A transferred handle is owned by the managed quarantine: never disconnect it, never close it,
        // and NEVER treat the missing normal handle as clean closure.
        if self.state.get() == BackendState::HandleTransferredToQuarantine {
            let unresolved = drain_managed_quarantine();
            return if unresolved == 0 {
                IpcResidue::Indeterminate // released elsewhere; this backend still cannot claim Zero
            } else {
                IpcResidue::NonZero
            };
        }
        // Ordered: terminalize first (nothing pending here), then disconnect, then release.
        if drain_managed_quarantine() != 0 {
            return IpcResidue::NonZero;
        }
        let mut server = self.server.borrow_mut();
        let handle = match server.as_ref() {
            Some(h) => h.0,
            None => return IpcResidue::Indeterminate,
        };
        // SAFETY: `handle` is the owned server pipe with no pending operation (nothing is quarantined for
        // it); disconnect is deterministic and happens only after that confirmation.
        let disconnected = unsafe { DisconnectNamedPipe(handle) }.is_ok();
        // Drop the owned server handle (closed exactly once).
        *server = None;
        self.state.set(BackendState::BackendUnavailable);
        if disconnected {
            IpcResidue::Zero
        } else {
            IpcResidue::NonZero
        }
    }

    fn has_quarantined_io(&self) -> bool {
        // ANY Reserved (permit held, operation possibly issued) or Occupied slot counts as outstanding —
        // a reservation alone already forbids Zero residue and clean shutdown.
        self.state.get() == BackendState::HandleTransferredToQuarantine
            || managed_quarantine_counts().has_outstanding()
    }

    fn wait_between_attempts(&self) {
        // Bounded, deterministic no-op wait boundary (no unbounded sleep).
    }
}

/// Keep the compile-only client path referenced so every FFI route is type-checked (the client role is
/// exercised by a later phase; the sealed capability keeps all of this unreachable).
#[allow(dead_code)]
fn _ffi_paths_referenced() -> Result<(), IpcFailure> {
    let b = WindowsPipeBackend::new([0u8; 8]);
    let _ = b.open_endpoint();
    let _ = b.connect_unauthenticated();
    let _ = b.send_handshake(MessageKind::ControllerHello, PeerRole::Controller);
    let _ = b.receive_handshake();
    let _ = b.receive_frame();
    let _ = b.send_control(MessageKind::ShutdownRequest);
    let _ = b.confirm_shutdown();
    let _ = b.close_residue();
    let _ = b.has_quarantined_io();
    b.wait_between_attempts();
    // Closed, redacted quarantine accounting (no raw resource is reachable through these).
    let _ = managed_quarantine_unresolved();
    let _ = managed_quarantine_counts();
    let _ = drain_managed_quarantine();
    // The client role uses the SAME admitted, guarded, unwind-safe helpers.
    let client = b.open_client()?;
    let (client, _) = b.write_frame_owned(
        client,
        &encode_control_frame(
            MessageKind::ControllerHello,
            &b.nonce,
            PeerRole::Controller.wire(),
        ),
    );
    if let Some(c) = client {
        let _ = b.read_raw_owned(c);
    }
    Ok(())
}

/// NARROW PUBLIC FAÇADE — confirmed IPC-peer contribution.
///
/// The ONLY pipe contribution surface a dependent orchestrator sees. The backend it wraps is a
/// PRIVATE field of a PRIVATE type, and there is no public constructor, so a production caller can
/// name this type but can never obtain one — the live path stays exactly as unreachable as before.
/// `windows_ffi` remains a private module and no Win32 function is exposed.
pub struct LiveIpcPeerContributor {
    backend: WindowsPipeBackend,
}

impl LiveIpcPeerContributor {
    /// Contribute the confirmed peer's OS-derived instance to an attempt that has ALREADY observed
    /// SCM-before. The state is the ordering proof: the peer cannot be observed first, and the attempt
    /// is consumed so it cannot be observed twice.
    /// Contribute the confirmed peer, CONSUMING the opaque confirmation.
    ///
    /// The confirmation replaces the former caller-asserted `handshake_confirmed: bool` and
    /// `confirmed_peer_role: PeerRole` parameters: a caller can no longer assert that a handshake
    /// succeeded, because the only way to hold a `ConfirmedIpcPeerHandshake` is to have driven the
    /// verification order to its accepting outcome. Consuming it also means one handshake yields at
    /// most one contribution.
    pub fn contribute_ipc_peer(
        &self,
        _capability: &LiveIpcOperationCapability,
        confirmed: ConfirmedIpcPeerHandshake,
        attempt: ServiceInstanceBindingAttempt<ScmBeforeObserved>,
    ) -> AttemptOutcome<IpcPeerObserved> {
        // The confirmation is proof, not data: it is consumed here and never inspected.
        let _ = confirmed;
        self.backend
            .contribute_ipc_peer(attempt, true, PeerRole::ServiceFixture)
    }
}

// ---------------------------------------------------------------------------------------------
// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A — the CLIENT half of the read-only status workflow.
//
// The installed service is the pipe SERVER (it creates the endpoint under the protected
// service-SID descriptor). The Control Centre is the pipe CLIENT, and this is the ONLY route it
// has. It sends exactly one `ControllerHello` — the existing request, no new kind — reads the
// `ServiceReady` answer, then reads exactly one status record judged by the STRICT decoder.
//
// There is no generic send, no raw-payload accessor, and no second thing this client can ask for.
// ---------------------------------------------------------------------------------------------

/// The CLOSED outcome of one client-side status read. It carries the DECODED record or a specific
/// refusal — never bytes, never a partially trusted frame.
#[cfg(feature = "owner-approved-status-read")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ClientStatusReadOutcome {
    /// The full exchange completed and the record decoded strictly.
    Status(InstalledHostStatus),
    /// The service's answer was not an accepted `ServiceReady` — wrong kind, nonce, or role.
    RefusedHandshake(crate::adapter::HandshakeOutcome),
    /// A frame did not decode. Reported as a refusal; never as an empty or default status.
    Malformed(FrameParseError),
    /// A transport failure — redacted.
    Failed(IpcFailure),
}

/// NARROW PUBLIC FAÇADE — the read-only installed-host status CLIENT.
///
/// Present only under the owner-approved feature, and every method demands the sealed capability, so
/// a build without the owner's transcribed approval has no route here at all. The backend it wraps is
/// a PRIVATE field of a PRIVATE type and no Win32 function is exposed.
#[cfg(feature = "owner-approved-status-read")]
pub struct WindowsInstalledHostStatusClient {
    backend: WindowsPipeBackend,
}

#[cfg(feature = "owner-approved-status-read")]
impl WindowsInstalledHostStatusClient {
    /// Bind the client to the ONE frozen status endpoint.
    ///
    /// The run identifier is the frozen constant, not a parameter: a caller cannot point this client
    /// at a different pipe, and the nonce it will expect is derived from the same bytes the service
    /// derives its own from.
    #[must_use]
    pub fn for_installed_host() -> Self {
        Self {
            backend: WindowsPipeBackend::new(crate::protocol::INSTALLED_HOST_STATUS_RUN_ID),
        }
    }

    /// Perform ONE read-only status exchange and return the decoded record or a specific refusal.
    ///
    /// Order: connect, send `ControllerHello`, verify `ServiceReady`, decode the status. Every step
    /// fails closed; there is no branch that returns a status the strict decoder did not produce.
    #[must_use]
    pub fn read_installed_host_status(
        &self,
        _cap: &LiveIpcOperationCapability,
    ) -> ClientStatusReadOutcome {
        let handle = match self.backend.open_client() {
            Ok(h) => h,
            Err(f) => return ClientStatusReadOutcome::Failed(f),
        };

        // The request is the EXISTING ControllerHello, built by the canonical encoder. No arbitrary
        // bytes and no new message kind are representable here.
        let hello = encode_control_frame(
            MessageKind::ControllerHello,
            &self.backend.nonce,
            PeerRole::Controller.wire(),
        );
        let (handle, sent) = self.backend.write_frame_owned(handle, &hello);
        if let Err(f) = sent {
            return ClientStatusReadOutcome::Failed(f);
        }
        let Some(handle) = handle else {
            // The handle went to quarantine: the operation was never confirmed terminal, so nothing
            // may be read from it and no status may be reported.
            return ClientStatusReadOutcome::Failed(IpcFailure::EndpointUnavailable);
        };

        // The service's answer must be a well-formed ServiceReady bound to the same single-use nonce
        // and declaring the service role. Anything else is a refusal.
        let (handle, ready) = self.backend.read_raw_owned(handle);
        let Some(handle) = handle else {
            return ClientStatusReadOutcome::Failed(IpcFailure::EndpointUnavailable);
        };
        match ready {
            Ok((buf, n)) => match parse_single_frame(&buf[..n]) {
                Ok((hdr, nonce)) => {
                    if hdr.kind() != MessageKind::ServiceReady {
                        return ClientStatusReadOutcome::RefusedHandshake(
                            crate::adapter::HandshakeOutcome::RefusedWrongMessageKind,
                        );
                    }
                    if nonce != self.backend.nonce {
                        return ClientStatusReadOutcome::RefusedHandshake(
                            crate::adapter::HandshakeOutcome::RefusedNonceMismatch,
                        );
                    }
                    if PeerRole::from_wire(hdr.control_flag()) != PeerRole::ServiceFixture {
                        return ClientStatusReadOutcome::RefusedHandshake(
                            crate::adapter::HandshakeOutcome::RefusedRole,
                        );
                    }
                }
                Err(e) => return ClientStatusReadOutcome::Malformed(e),
            },
            Err(f) => return ClientStatusReadOutcome::Failed(f),
        }

        // The status record. The STRICT decoder judges it; nothing here inspects the payload.
        let (_handle, status) = self.backend.read_raw_owned(handle);
        match status {
            Ok((buf, n)) => match decode_installed_host_status(&buf[..n]) {
                Ok((status, nonce)) => {
                    if nonce != self.backend.nonce {
                        return ClientStatusReadOutcome::RefusedHandshake(
                            crate::adapter::HandshakeOutcome::RefusedNonceMismatch,
                        );
                    }
                    ClientStatusReadOutcome::Status(status)
                }
                Err(e) => ClientStatusReadOutcome::Malformed(e),
            },
            Err(f) => ClientStatusReadOutcome::Failed(f),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A — the SERVER half, as the installed service runs it.
//
// The installed ProjectOSHost is the pipe SERVER. This façade exists because the live backend is a
// private type inside a private module: without it the service could name no live transport at all.
// It adds NO logic of its own — it calls exactly the four accepted adapter steps in order and
// returns their closed outcomes.
// ---------------------------------------------------------------------------------------------

/// The CLOSED outcome of one served status exchange.
#[cfg(feature = "owner-approved-status-read")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServeStatusOutcome {
    /// A confirmed controller was answered with exactly one status record.
    StatusServed,
    /// The endpoint was not prepared — including a pipe security that was not Ready.
    RefusedPreparation(crate::adapter::ServerPreparation),
    /// No local client connected.
    RefusedConnection(ConnectionState),
    /// The request was refused: wrong kind, wrong nonce, replayed, stale, wrong role or malformed.
    RefusedHandshake(crate::adapter::HandshakeOutcome),
    /// The record could not be put on the wire — redacted.
    SendFailed(IpcFailure),
    /// THE CAPABILITY IS NOT FOR THIS (PROJECTOS-HOST-REVIEW-PATH1B G5). The capability presented was
    /// minted at a different [`crate::CapabilityScope`], so nothing was prepared, nothing was
    /// accepted, no handshake ran and nothing was observed or served.
    ///
    /// It is a DISTINCT variant, not folded into `RefusedPreparation`: a wrongly scoped capability is
    /// an authority failure of the caller, not an endpoint or security failure of the machine, and an
    /// operator must not have to guess which one happened.
    RefusedCapabilityScope(crate::adapter::CapabilityScope),
}

/// NARROW PUBLIC FAÇADE — the read-only installed-host status SERVER.
///
/// Owner-feature gated and capability-gated, exactly like the client. It grants nothing on its own:
/// the sealed capability is still required for every step.
#[cfg(feature = "owner-approved-status-read")]
pub struct WindowsInstalledHostStatusServer {
    adapter: crate::adapter::LocalIpcAdapter<WindowsPipeBackend>,
}

#[cfg(feature = "owner-approved-status-read")]
impl WindowsInstalledHostStatusServer {
    /// Bind the server to the ONE frozen status endpoint — the same run identifier, and therefore the
    /// same pipe name and the same single-use nonce, the client derives.
    #[must_use]
    pub fn for_installed_host() -> Self {
        Self {
            adapter: crate::adapter::LocalIpcAdapter::new(WindowsPipeBackend::new(
                crate::protocol::INSTALLED_HOST_STATUS_RUN_ID,
            )),
        }
    }

    /// Serve at most ONE read-only status exchange, then finish.
    ///
    /// `observe` is called ONLY after the request has been confirmed, so a refused or malformed
    /// request never causes the host to be observed, and the record that is sent is always the one
    /// observed for this exchange.
    #[must_use]
    pub fn serve_one_status_exchange(
        &self,
        cap: &LiveIpcOperationCapability,
        security: crate::ProjectOsHostPipeSecurityStatus,
        observe: impl FnOnce() -> InstalledHostStatus,
    ) -> ServeStatusOutcome {
        // 0. THE SCOPE, BEFORE ANYTHING IS OPENED (G5). This facade serves the OWNER-APPROVED STATUS
        //    READ. A governed-review capability is refused here, so the review authority cannot
        //    silently acquire the plain status-serving loop - and, with the mirrored check in
        //    `serve_one_exchange`, the two scopes cannot substitute for one another in EITHER
        //    direction.
        if cap.scope() != crate::adapter::CapabilityScope::ReadInstalledHostStatusLocalOnly {
            return ServeStatusOutcome::RefusedCapabilityScope(cap.scope());
        }
        // 1. Prepare. A security that is not Ready refuses here; there is no weaker fallback.
        let prepared = self.adapter.prepare_server(cap, security);
        if prepared != crate::adapter::ServerPreparation::Prepared {
            return ServeStatusOutcome::RefusedPreparation(prepared);
        }
        // 2. Accept a RAW local connection. Nothing is authenticated by this.
        let connected = self.adapter.accept_unauthenticated(cap);
        if connected != ConnectionState::TransportConnectedUnauthenticated {
            return ServeStatusOutcome::RefusedConnection(connected);
        }
        // 3. The bounded service-side handshake: it consumes the ControllerHello and verifies kind,
        //    nonce, replay, freshness and role, then answers ServiceReady. Malformed, replayed,
        //    stale, wrong-role and wrong-kind requests all fail closed right here.
        let handshake = self.adapter.complete_service_handshake(cap);
        if !handshake.is_peer_confirmed() {
            return ServeStatusOutcome::RefusedHandshake(handshake);
        }
        // 4. Observe (read-only) and answer with exactly one record.
        let status = observe();
        match self.adapter.send_installed_host_status(cap, &status) {
            SendOutcome::Sent => ServeStatusOutcome::StatusServed,
            SendOutcome::Failed(f) => ServeStatusOutcome::SendFailed(f),
        }
    }
}

/// PROOF-ONLY refusal probes. Compiled ONLY when the non-default `test-fixtures` feature is combined
/// with the owner-approved feature, so neither the installed service nor the Control Centre — whose
/// graphs never enable `test-fixtures` — can reach any of this.
///
/// Each variant builds its own bytes INSIDE the probe. There is no caller-supplied payload: this is
/// three fixed, deliberately-invalid requests, not a generic send.
#[cfg(all(feature = "owner-approved-status-read", feature = "test-fixtures"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalProbe {
    /// A well-formed frame of a kind the service must not accept as a request.
    WrongMessageKind,
    /// A frame with a corrupted magic, which the strict parser must refuse.
    MalformedFrame,
    /// A well-formed `ControllerHello` that declares the SERVICE role instead of the controller's.
    WrongPeerRole,
}

#[cfg(all(feature = "owner-approved-status-read", feature = "test-fixtures"))]
impl WindowsInstalledHostStatusClient {
    /// Send ONE deliberately invalid request and report what came back.
    ///
    /// A correct service answers NOTHING: the exchange must never yield
    /// [`ClientStatusReadOutcome::Status`]. That absence is the proof.
    #[must_use]
    pub fn probe_refusal(
        &self,
        _cap: &LiveIpcOperationCapability,
        probe: RefusalProbe,
    ) -> ClientStatusReadOutcome {
        let frame = match probe {
            RefusalProbe::WrongMessageKind => encode_control_frame(
                MessageKind::ShutdownRequest,
                &self.backend.nonce,
                PeerRole::Controller.wire(),
            ),
            RefusalProbe::MalformedFrame => {
                let mut f = encode_control_frame(
                    MessageKind::ControllerHello,
                    &self.backend.nonce,
                    PeerRole::Controller.wire(),
                );
                // Corrupt the magic. The strict parser must refuse before anything else is read.
                f[0] ^= 0xff;
                f
            }
            RefusalProbe::WrongPeerRole => encode_control_frame(
                MessageKind::ControllerHello,
                &self.backend.nonce,
                PeerRole::ServiceFixture.wire(),
            ),
        };

        let handle = match self.backend.open_client() {
            Ok(h) => h,
            Err(f) => return ClientStatusReadOutcome::Failed(f),
        };
        let (handle, sent) = self.backend.write_frame_owned(handle, &frame);
        if let Err(f) = sent {
            return ClientStatusReadOutcome::Failed(f);
        }
        let Some(handle) = handle else {
            return ClientStatusReadOutcome::Failed(IpcFailure::EndpointUnavailable);
        };
        // Whatever comes back is judged by the STRICT decoder. A refusing service sends nothing, so
        // this read fails — and a Status outcome is unreachable unless the service actually answered.
        let (_handle, answer) = self.backend.read_raw_owned(handle);
        match answer {
            Ok((buf, n)) => match decode_installed_host_status(&buf[..n]) {
                Ok((status, _)) => ClientStatusReadOutcome::Status(status),
                Err(e) => ClientStatusReadOutcome::Malformed(e),
            },
            Err(f) => ClientStatusReadOutcome::Failed(f),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1A - the HOST REVIEW exchange, as the installed service would run it.
//
// The accepted status exchange, UNCHANGED, followed by one request frame and one response frame on
// the same connection (see `review_exchange.rs` for why there is no second endpoint). The status
// facade above is untouched and is still what the installed service calls: THIS facade additionally
// demands a `HostReviewIpcCapability`, which has no production mint, so a shipped service cannot call
// it. The path is complete and dormant.
// ---------------------------------------------------------------------------------------------

/// The CLOSED outcome of one served status-then-review exchange.
#[cfg(feature = "owner-approved-status-read")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServeExchangeOutcome {
    /// The accepted status half did not complete, for exactly the reason the status facade reports.
    /// No request was read and the Host was never consulted.
    StatusHalf(ServeStatusOutcome),
    /// The status record was served, and this is how the review half ended.
    ReviewHalf(crate::review_exchange::ServeReviewOutcome),
}

/// NARROW PUBLIC FACADE - the status-then-review SERVER.
#[cfg(feature = "owner-approved-status-read")]
pub struct WindowsHostReviewServer {
    adapter: crate::adapter::LocalIpcAdapter<WindowsPipeBackend>,
}

#[cfg(feature = "owner-approved-status-read")]
impl WindowsHostReviewServer {
    /// Bind the server to the ONE frozen production endpoint. Constructing it opens nothing, and
    /// serving demands a capability no shipped graph can mint.
    #[must_use]
    pub fn for_installed_host() -> Self {
        Self {
            adapter: crate::adapter::LocalIpcAdapter::new(WindowsPipeBackend::new(
                crate::protocol::INSTALLED_HOST_STATUS_RUN_ID,
            )),
        }
    }

    /// FIXTURE ONLY. Bind the server to an ISOLATED endpoint in the run-scoped test proof namespace.
    /// The frozen production run identifier is REFUSED, so a proof can never bind the production
    /// endpoint through this route.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn for_isolated_test_run(run_id: [u8; 8]) -> Option<Self> {
        if run_id == crate::protocol::INSTALLED_HOST_STATUS_RUN_ID {
            return None;
        }
        Some(Self {
            adapter: crate::adapter::LocalIpcAdapter::new(WindowsPipeBackend::new(run_id)),
        })
    }

    /// Serve at most ONE exchange: the four accepted status steps, in their accepted order, and then
    /// at most one review request.
    ///
    /// `host` is called at most once, only after a CONFIRMED handshake and a served status record,
    /// and only with a request the strict decoder accepted under this exchange's nonce.
    #[must_use]
    pub fn serve_one_exchange(
        &self,
        cap: &LiveIpcOperationCapability,
        review: &crate::review_exchange::HostReviewIpcCapability,
        security: crate::ProjectOsHostPipeSecurityStatus,
        observe: impl FnOnce() -> InstalledHostStatus,
        host: &mut dyn FnMut(
            &crate::operation_contract::ProtectedOperationRequest,
        ) -> ProtectedOperationResponse,
    ) -> ServeExchangeOutcome {
        // 0. THE SCOPE, BEFORE ANYTHING IS OPENED (G5). This facade serves a GOVERNED REVIEW, so the
        //    transport capability must be one the review authority issued. An owner STATUS-READ
        //    capability is refused here: the status phrase has never authorised a review, and this
        //    is what makes that a check rather than a comment.
        if cap.scope() != crate::adapter::CapabilityScope::GovernedHostReviewLocalOnly {
            return ServeExchangeOutcome::StatusHalf(
                ServeStatusOutcome::RefusedCapabilityScope(cap.scope()),
            );
        }
        let prepared = self.adapter.prepare_server(cap, security);
        if prepared != crate::adapter::ServerPreparation::Prepared {
            return ServeExchangeOutcome::StatusHalf(ServeStatusOutcome::RefusedPreparation(
                prepared,
            ));
        }
        let connected = self.adapter.accept_unauthenticated(cap);
        if connected != ConnectionState::TransportConnectedUnauthenticated {
            return ServeExchangeOutcome::StatusHalf(ServeStatusOutcome::RefusedConnection(
                connected,
            ));
        }
        let handshake = self.adapter.complete_service_handshake(cap);
        if !handshake.is_peer_confirmed() {
            return ServeExchangeOutcome::StatusHalf(ServeStatusOutcome::RefusedHandshake(
                handshake,
            ));
        }
        let status = observe();
        if let SendOutcome::Failed(f) = self.adapter.send_installed_host_status(cap, &status) {
            return ServeExchangeOutcome::StatusHalf(ServeStatusOutcome::SendFailed(f));
        }
        ServeExchangeOutcome::ReviewHalf(self.adapter.serve_review_request(cap, review, host))
    }
}

/// PROOF-ONLY review CLIENT. The production client is the agent's own transport, in another language;
/// this one exists so the live server facade can be proven against the shipped client order on an
/// isolated endpoint. Compiled only under `test-fixtures`, and bound only to the test namespace.
#[cfg(feature = "test-fixtures")]
pub struct WindowsHostReviewTestClient {
    backend: WindowsPipeBackend,
}

#[cfg(feature = "test-fixtures")]
impl WindowsHostReviewTestClient {
    /// Bind to an isolated test endpoint. The frozen production run identifier is REFUSED.
    #[must_use]
    pub fn for_isolated_test_run(run_id: [u8; 8]) -> Option<Self> {
        if run_id == crate::protocol::INSTALLED_HOST_STATUS_RUN_ID {
            return None;
        }
        Some(Self {
            backend: WindowsPipeBackend::new(run_id),
        })
    }

    /// Run ONE status-then-review exchange through the shipped client order.
    #[must_use]
    pub fn request_review(
        &self,
        _review: &crate::review_exchange::HostReviewIpcCapability,
        request: &crate::operation_contract::ProtectedOperationRequest,
        response_read_attempts: u32,
    ) -> crate::review_exchange::ClientReviewOutcome {
        let mut link = LivePipeReviewLink {
            backend: &self.backend,
            handle: None,
            response_read_attempts,
        };
        crate::review_exchange::run_review_client(&mut link, request)
    }
}

#[cfg(feature = "test-fixtures")]
struct LivePipeReviewLink<'a> {
    backend: &'a WindowsPipeBackend,
    handle: Option<OwnedHandle>,
    /// Each read is bounded by the transport's own wait step; a review outlasts one step, so the
    /// response read is re-issued a BOUNDED number of times. Never unbounded.
    response_read_attempts: u32,
}

#[cfg(feature = "test-fixtures")]
impl crate::review_exchange::ReviewClientLink for LivePipeReviewLink<'_> {
    fn complete_status_exchange(&mut self) -> Result<(), crate::review_exchange::ReviewNotSent> {
        use crate::adapter::HandshakeOutcome;
        use crate::review_exchange::ReviewNotSent;

        let handle = self
            .backend
            .open_client()
            .map_err(ReviewNotSent::ConnectFailed)?;
        let hello = encode_control_frame(
            MessageKind::ControllerHello,
            &self.backend.nonce,
            PeerRole::Controller.wire(),
        );
        let (handle, sent) = self.backend.write_frame_owned(handle, &hello);
        sent.map_err(ReviewNotSent::Failed)?;
        let handle = handle.ok_or(ReviewNotSent::Failed(IpcFailure::EndpointUnavailable))?;

        let (handle, ready) = self.backend.read_raw_owned(handle);
        let handle = handle.ok_or(ReviewNotSent::Failed(IpcFailure::EndpointUnavailable))?;
        let (buf, n) = ready.map_err(ReviewNotSent::Failed)?;
        let (hdr, nonce) = parse_single_frame(&buf[..n]).map_err(ReviewNotSent::Malformed)?;
        if hdr.kind() != MessageKind::ServiceReady {
            return Err(ReviewNotSent::RefusedHandshake(
                HandshakeOutcome::RefusedWrongMessageKind,
            ));
        }
        if nonce != self.backend.nonce {
            return Err(ReviewNotSent::RefusedHandshake(
                HandshakeOutcome::RefusedNonceMismatch,
            ));
        }
        if PeerRole::from_wire(hdr.control_flag()) != PeerRole::ServiceFixture {
            return Err(ReviewNotSent::RefusedHandshake(HandshakeOutcome::RefusedRole));
        }

        let (handle, status) = self.backend.read_raw_owned(handle);
        let handle = handle.ok_or(ReviewNotSent::Failed(IpcFailure::EndpointUnavailable))?;
        let (buf, n) = status.map_err(ReviewNotSent::Failed)?;
        let (record, nonce) =
            decode_installed_host_status(&buf[..n]).map_err(ReviewNotSent::Malformed)?;
        if nonce != self.backend.nonce {
            return Err(ReviewNotSent::RefusedHandshake(
                HandshakeOutcome::RefusedNonceMismatch,
            ));
        }
        crate::review_exchange::require_host_accepting(record)?;
        self.handle = Some(handle);
        Ok(())
    }

    fn send_request(
        &mut self,
        request: &crate::operation_contract::ProtectedOperationRequest,
    ) -> Result<(), IpcFailure> {
        let handle = self.handle.take().ok_or(IpcFailure::EndpointUnavailable)?;
        let frame = crate::operation_contract::encode_protected_operation_request(
            &self.backend.nonce,
            request,
        );
        let (handle, sent) = self.backend.write_frame_owned(handle, &frame);
        self.handle = handle;
        sent
    }

    fn receive_response(
        &mut self,
    ) -> Result<ProtectedOperationResponse, crate::review_exchange::ReviewUnanswered> {
        use crate::review_exchange::ReviewUnanswered;

        let mut last = IpcFailure::ReadTimedOut;
        for _ in 0..self.response_read_attempts {
            let Some(handle) = self.handle.take() else {
                return Err(ReviewUnanswered::Failed(IpcFailure::EndpointUnavailable));
            };
            let (handle, read) = self.backend.read_raw_owned(handle);
            self.handle = handle;
            match read {
                Ok((buf, n)) => {
                    let (response, nonce) =
                        crate::operation_contract::decode_protected_operation_response(&buf[..n])
                            .map_err(ReviewUnanswered::Malformed)?;
                    if nonce != self.backend.nonce {
                        return Err(ReviewUnanswered::WrongNonce);
                    }
                    return Ok(response);
                }
                // The Host is still working. A cancelled message-mode read loses nothing.
                Err(IpcFailure::ReadTimedOut) => last = IpcFailure::ReadTimedOut,
                Err(IpcFailure::UnexpectedFailure) => {
                    return Err(ReviewUnanswered::Malformed(FrameParseError::OversizedPayload))
                }
                Err(f) => return Err(ReviewUnanswered::Failed(f)),
            }
        }
        Err(ReviewUnanswered::Failed(last))
    }
}

// PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A endpoint-binding proofs. Pure construction and name
// derivation only: no pipe is created, opened or connected. This module sits at the END of the file
// deliberately: val-cd-b4-installed-host-status-contract1a strips everything from the first
// `#[cfg(test)] mod *tests` onward, so a mid-file test module would hide the facades above from it.
#[cfg(test)]
mod endpoint_binding_tests {
    use super::*;

    fn name_of(wide: &[u16]) -> String {
        // Strip the trailing NUL the wide encoding appends.
        String::from_utf16_lossy(&wide[..wide.len() - 1])
    }

    #[test]
    fn only_the_frozen_run_identifier_binds_the_production_endpoint() {
        let production = WindowsPipeBackend::new(crate::protocol::INSTALLED_HOST_STATUS_RUN_ID);
        assert_eq!(production.binding, EndpointBinding::Production);
        // EVERY other run identifier stays in the test proof namespace.
        for other in [[0u8; 8], [0xff; 8], [1, 2, 3, 4, 5, 6, 7, 8]] {
            assert_eq!(
                WindowsPipeBackend::new(other).binding,
                EndpointBinding::TestProof
            );
        }
    }

    #[test]
    fn the_production_endpoint_is_exactly_the_fixed_name() {
        let wide = endpoint_wide(EndpointBinding::Production, &[0u8; 8]);
        assert_eq!(name_of(&wide), PRODUCTION_ENDPOINT);
        // The production name ignores the run identifier entirely: no per-run, per-user or
        // caller-shaped variation is representable.
        let wide2 = endpoint_wide(EndpointBinding::Production, &[0xab; 8]);
        assert_eq!(name_of(&wide2), PRODUCTION_ENDPOINT);
    }

    #[test]
    fn the_test_namespace_is_retained_and_run_scoped() {
        let wide = endpoint_wide(EndpointBinding::TestProof, &[0xab; 8]);
        let name = name_of(&wide);
        assert_eq!(name, format!("{ENDPOINT_PREFIX}abababababababab"));
        assert_ne!(name, PRODUCTION_ENDPOINT);
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1B §10 - THE COMPLETE PER-CONNECTION GOVERNED-REVIEW SERVE PATH.
//
// `serve_one_exchange` above is the PATH1A shape: accept, handshake, status, then hand a decoded
// request to a `respond(&request)` callback. That callback shape is exactly what was missing - it
// gave the Host no way to pass the connection TRUST CHAIN to the responder, so the composition
// (which needs a `BoundIpcSession` and a `TrustedPeerContext` for THIS connection) could not be
// reached from the transport at all.
//
// This facade is that chain, in the ruling order, with nothing skipped:
//
//   governed-review IPC capability
//     -> accepted Windows connection
//     -> controller handshake (CONFIRMED, and the confirmation retained)
//     -> served status record
//     -> W1 exact-configured-owner client admission (capture, re-observe, admit)
//     -> real same-connection evidence, assembled inside this boundary
//     -> the canonical client crossing
//     -> BoundIpcSession (sealed verifier) + TrustedPeerContext (sealed admission)
//     -> the responder, which composes the protected operation
//
// NO TEST FIXTURE IS IN THIS CHAIN. Every value is produced by the production route: the sealed
// per-connection verifier, the real handshake, the real kernel capture, the production assembler
// and the unchanged canonical crossing.
// ---------------------------------------------------------------------------------------------

/// How one governed-review exchange ended. CLOSED and redacted: every refusal names the GATE that
/// said no, never an identity, a pid, a SID, a handle or a digest.
#[cfg(all(windows, feature = "owner-approved-status-read"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServeGovernedReviewOutcome {
    /// The accepted status half did not complete, for exactly the reason the status facade reports.
    /// No admission ran, no session was minted and the Host was never consulted.
    StatusHalf(ServeStatusOutcome),
    /// The handshake accepted but its CONFIRMATION could not be taken. Structurally unreachable -
    /// a confirming outcome always carries one - and named rather than unwrapped so a future change
    /// to that invariant fails closed instead of panicking.
    ConfirmationUnavailable,
    /// The connected CLIENT is not the EXACT enrolled configured owner, or its bounded kernel
    /// identity could not be established. The canonical closed verdict is carried verbatim.
    ClientNotAdmitted(projectos_host_windows_service_identity_proof::ClientAdmissionVerdict),
    /// The same-connection evidence could not be assembled from real transport facts (a zero
    /// connection identity, handshake generation, pid or creation tick).
    EvidenceUnavailable,
    /// The canonical crossing refused. Its closed reason is carried verbatim.
    CrossingRefused(crate::observation::CanonicalSessionCrossingRefusal),
    /// The sealed session verifier refused to mint a `BoundIpcSession`.
    SessionRefused(projectos_host_core::IpcSessionError),
    /// The trust chain completed and this is how the review half ended.
    ReviewHalf(crate::review_exchange::ServeReviewOutcome),
}

/// Everything the per-connection chain needs that is NOT a transport fact.
///
/// Each field is a HOST-resolved value or a production authority the startup composition already
/// holds; none is, or can be derived from, anything a client sent. They are grouped so the facade
/// signature states the trust boundary rather than burying it in a long argument list.
#[cfg(all(windows, feature = "windows-live-ipc", feature = "owner-approved-status-read"))]
pub struct GovernedReviewConnectionInputs<'a> {
    /// The sealed per-connection IPC session verifier, derived from the ONE provider capability set
    /// for THIS connection. Its identity is crate-assigned and cannot be chosen.
    pub verifier: &'a projectos_host_core::ConnectionBoundIpcSessionVerifier<'a>,
    /// The Host's own verified runtime instance, minted by the sealed production runtime verifier
    /// from the Host's own process observation and the trusted clock.
    pub runtime: &'a projectos_host_core::VerifiedRuntimeInstance,
    /// The current trusted-clock reading. Never a wire value.
    pub now: &'a projectos_host_core::VerifiedAuthorityTime,
    /// How long the session authority may live from that reading. Re-bounded by the verifier.
    pub session_window: u64,
    /// The live client-admission capability PAIRED with the EXACT enrolled configured owner of this
    /// installation. One value, so the capability and the principal are always about the same
    /// installation and cannot be mismatched by a composition.
    pub admission: &'a crate::production_peer_evidence::GovernedReviewAdmissionAuthority,
    /// The Host's own resolved channel facts.
    pub channel: &'a crate::production_peer_evidence::GovernedChannelContext,
}

#[cfg(all(windows, feature = "windows-live-ipc", feature = "owner-approved-status-read"))]
impl WindowsHostReviewServer {
    /// Serve at most ONE governed review exchange, with the FULL per-connection trust chain.
    ///
    /// `transport` must be the capability the review authority issued
    /// (`HostReviewIpcCapability::issue_transport_capability`); a status-scoped capability is
    /// refused before the endpoint is opened, exactly as in [`Self::serve_one_exchange`].
    ///
    /// `respond` is called AT MOST ONCE, and only with (a) a request the strict decoder accepted
    /// under this exchange's nonce, (b) the `BoundIpcSession` the sealed verifier minted for THIS
    /// connection, and (c) the `TrustedPeerContext` of the client the canonical attempt ADMITTED on
    /// it. A malformed, wrong-nonce, wrong-kind or oversized frame never reaches it; neither does a
    /// request from a client that is not the exact enrolled configured owner.
    #[must_use]
    pub fn serve_one_governed_review_exchange(
        &self,
        transport: &LiveIpcOperationCapability,
        review: &crate::review_exchange::HostReviewIpcCapability,
        security: crate::ProjectOsHostPipeSecurityStatus,
        inputs: &GovernedReviewConnectionInputs<'_>,
        observe: impl FnOnce() -> InstalledHostStatus,
        respond: &mut dyn FnMut(
            &crate::operation_contract::ProtectedOperationRequest,
            &projectos_host_core::BoundIpcSession,
            &crate::operation_contract::TrustedPeerContext,
        ) -> ProtectedOperationResponse,
    ) -> ServeGovernedReviewOutcome {
        // The verifier identity is read through the SEALED trait, so the values are the ones the
        // crossing and the mint will compare against - not a parallel accessor that could drift.
        use projectos_host_core::IpcSessionVerifier as _;

        // 0. THE SCOPE. A status-read capability cannot open a governed review endpoint.
        if transport.scope() != crate::adapter::CapabilityScope::GovernedHostReviewLocalOnly {
            return ServeGovernedReviewOutcome::StatusHalf(
                ServeStatusOutcome::RefusedCapabilityScope(transport.scope()),
            );
        }
        // 1. Prepare. A pipe security that is not Ready refuses here, with no weaker fallback.
        let prepared = self.adapter.prepare_server(transport, security);
        if prepared != crate::adapter::ServerPreparation::Prepared {
            return ServeGovernedReviewOutcome::StatusHalf(ServeStatusOutcome::RefusedPreparation(
                prepared,
            ));
        }
        // 2. Accept a RAW local connection. Nothing is authenticated by this.
        let connected = self.adapter.accept_unauthenticated(transport);
        if connected != ConnectionState::TransportConnectedUnauthenticated {
            return ServeGovernedReviewOutcome::StatusHalf(ServeStatusOutcome::RefusedConnection(
                connected,
            ));
        }
        // 3. The bounded, nonce-bound, role-bound handshake - and RETAIN its confirmation, which is
        //    what the same-connection evidence needs and what nothing in production could produce
        //    before G3.
        let transition = self
            .adapter
            .complete_service_handshake_confirmed(transport);
        let handshake_outcome = transition.outcome();
        if !handshake_outcome.is_peer_confirmed() {
            return ServeGovernedReviewOutcome::StatusHalf(ServeStatusOutcome::RefusedHandshake(
                handshake_outcome,
            ));
        }
        let Some(confirmed) = transition.into_confirmed() else {
            return ServeGovernedReviewOutcome::ConfirmationUnavailable;
        };
        // 4. The status record, exactly as the accepted exchange serves it.
        let status = observe();
        if let SendOutcome::Failed(f) = self.adapter.send_installed_host_status(transport, &status)
        {
            return ServeGovernedReviewOutcome::StatusHalf(ServeStatusOutcome::SendFailed(f));
        }

        // 5. W1 - THE CLIENT ADMISSION. Capture the connected client's bounded kernel identity and
        //    prove it is EXACTLY the enrolled configured owner, then re-observe and reconcile, which
        //    closes the swap window between the capture and the admission.
        let connection_id = inputs.verifier.connection_id();
        let generation = inputs.verifier.handshake_generation();
        let attempt = projectos_host_windows_service_identity_proof::ClientPeerAdmissionAttempt::begin(
            inputs.admission.capability(),
            inputs.admission.owner(),
        );
        let captured = self.adapter.backend().admit_governed_client(
            attempt,
            inputs.admission.capability(),
            true,
            PeerRole::Controller,
            connection_id,
            generation,
        );
        let attempt = match captured {
            projectos_host_windows_service_identity_proof::ClientAttemptOutcome::Continue(a) => a,
            projectos_host_windows_service_identity_proof::ClientAttemptOutcome::Refused(v) => {
                return ServeGovernedReviewOutcome::ClientNotAdmitted(v)
            }
        };
        let reconciled = self.adapter.backend().reconcile_governed_client(
            attempt,
            inputs.admission.capability(),
            true,
            PeerRole::Controller,
            connection_id,
            generation,
        );
        let attempt = match reconciled {
            projectos_host_windows_service_identity_proof::ClientAttemptOutcome::Continue(a) => a,
            projectos_host_windows_service_identity_proof::ClientAttemptOutcome::Refused(v) => {
                return ServeGovernedReviewOutcome::ClientNotAdmitted(v)
            }
        };
        // The ONE audited capture, projected. The process bound below is the process admitted above.
        let Some(client) = attempt.observed_client_process() else {
            return ServeGovernedReviewOutcome::ClientNotAdmitted(
                projectos_host_windows_service_identity_proof::ClientAdmissionVerdict::NoClientObservation,
            );
        };

        // 6. THE REAL SAME-CONNECTION EVIDENCE, assembled inside this trusted boundary from the
        //    confirmed handshake, the verifier's own identity, the audited capture and the Host's
        //    own channel facts and clock.
        let Some(bundle) = crate::production_peer_evidence::assemble_production_same_connection_evidence(
            confirmed,
            inputs.verifier,
            client,
            inputs.channel,
            inputs.now,
            inputs.session_window,
        ) else {
            return ServeGovernedReviewOutcome::EvidenceUnavailable;
        };

        // 7. THE CANONICAL CROSSING, unchanged. It consumes the attempt, producing ONE verdict with
        //    TWO outputs, and refuses unless attempt, bundle, verifier and admission all agree.
        let crossed = match crate::observation::bind_canonical_client_to_session_evidence(
            attempt,
            bundle,
            inputs.verifier,
        ) {
            Ok(c) => c,
            Err(refusal) => return ServeGovernedReviewOutcome::CrossingRefused(refusal),
        };
        let (observation, handshake_evidence, admission) = crossed.into_parts();

        // 8. THE TWO SEALED MINTS, both unchanged.
        let session = match projectos_host_core::IpcSessionVerifier::verify(
            inputs.verifier,
            inputs.runtime,
            handshake_evidence,
            &observation,
            inputs.now,
        ) {
            Ok(s) => s,
            Err(e) => return ServeGovernedReviewOutcome::SessionRefused(e),
        };
        let peer = crate::operation_contract::TrustedPeerContext::from_verified_peer_admission(
            &admission,
        );

        // 9. The review half, with the trust chain the responder composes against.
        let mut with_context = |request: &crate::operation_contract::ProtectedOperationRequest| {
            respond(request, &session, &peer)
        };
        ServeGovernedReviewOutcome::ReviewHalf(self.adapter.serve_review_request(
            transport,
            review,
            &mut with_context,
        ))
    }
}

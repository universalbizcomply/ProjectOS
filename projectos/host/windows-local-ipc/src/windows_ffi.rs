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
use crate::verification::{classify_ipc_error, CancellationTerminalState, IpcFailure, PeerRole};

/// The fixed proof-endpoint prefix. The full endpoint is derived internally from this prefix plus a
/// fixed-size ephemeral run identifier; no caller-supplied name, alternate prefix, or production prefix
/// is representable, and the complete endpoint never leaves this module.
const ENDPOINT_PREFIX: &str = r"\\.\pipe\ProjectOS.Test.ServiceIdentityProof.";

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

/// Build the fixed proof endpoint as a NUL-terminated wide string from the fixed prefix and a fixed-size
/// ephemeral run identifier. The identifier carries no username/SID/machine/service/path/credential.
fn endpoint_wide(run_id: &[u8; 8]) -> Vec<u16> {
    let mut name = String::from(ENDPOINT_PREFIX);
    for b in run_id {
        name.push_str(&format!("{b:02x}"));
    }
    name.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The live Windows named-pipe backend.
pub struct WindowsPipeBackend {
    run_id: [u8; 8],
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
        // The nonce is derived internally from the fixed-size run identifier; a later trusted boundary
        // supplies it. It is never accepted from an arbitrary public byte vector.
        let mut bytes = [0u8; NONCE_LEN];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = run_id[i % run_id.len()];
        }
        Self {
            run_id,
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

    /// Create the fixed proof endpoint as the FIRST message-mode, local-only instance, consuming
    /// host-authority's opaque borrowed security-attributes lease for the single `CreateNamedPipeW` call.
    fn create_first_instance(&self) -> EndpointOutcome {
        // Obtain the opaque, service-SID-backed security. Fail closed if not Ready (no weaker fallback).
        let (_status, security) = ProjectOsHostPipeSecurity::resolve();
        let security = match security {
            Some(s) => s,
            None => return EndpointOutcome::Failed(IpcFailure::SecurityPrincipalUnavailable),
        };
        let lease = security.borrowed_security_attributes();
        let wide = endpoint_wide(&self.run_id);
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
        let wide = endpoint_wide(&self.run_id);
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

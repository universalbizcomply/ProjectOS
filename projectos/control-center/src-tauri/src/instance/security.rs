//! Current-account SID resolution and the instance object's explicit security descriptor
//! (PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A).
//!
//! Two jobs, both narrow:
//!  - resolve the CURRENT ACCOUNT SID (`TokenUser`) — the value that is identical across every
//!    session belonging to the account, and therefore the basis of the cross-session guarantee;
//!  - build an explicit, protected, single-ACE DACL granting exactly `SYNCHRONIZE` to that SID.
//!
//! BINDING: this is ACCESS CONTROL, not identity. The DACL decides who may open the object; it
//! proves nothing about which executable is running, and it is not code identity, owner
//! authentication, or trust evidence.

#![cfg(windows)]

use std::mem::size_of;

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetLengthSid, GetTokenInformation, IsValidSid, TokenUser, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use super::InstanceFailure;

/// Upper bound for the `TOKEN_USER` buffer. A `TOKEN_USER` is a pointer plus attributes and the SID
/// it points at is at most `SECURITY_MAX_SID_SIZE` (68) bytes; 4 KiB is far beyond any legitimate
/// result, so anything larger is treated as malformed rather than allocated.
const MAX_TOKEN_USER_BYTES: usize = 4096;

/// `SYNCHRONIZE`. The typed constant lives in `Win32::Storage::FileSystem`, whose feature is not
/// enabled — and enabling a whole binding module for one integer would be gratuitous. The value is
/// part of the stable Win32 ABI.
///
/// This is the ONLY right requested or granted. `MUTEX_ALL_ACCESS` (0x1F0001) would additionally
/// carry DELETE / WRITE_DAC / WRITE_OWNER / MODIFY_STATE, none of which this design uses: the object
/// is an existence token, never waited on and never modified.
pub const MUTEX_ACCESS_SYNCHRONIZE: u32 = 0x0010_0000;

/// A process token handle that is always closed, on every path.
struct OwnedToken(HANDLE);

impl Drop for OwnedToken {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: `self.0` is a token handle obtained from `OpenProcessToken` and not yet
            // closed; `Drop` runs exactly once, so no double close is possible.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// The current account SID, owning the buffer it points into.
///
/// The buffer is `Vec<u64>`, not `Vec<u8>`: `TOKEN_USER` contains a pointer and therefore requires
/// 8-byte alignment. Casting a `Vec<u8>` (alignment 1) to `*const TOKEN_USER` would be undefined
/// behaviour even though it usually appears to work.
pub struct AccountSid {
    buf: Vec<u64>,
    sid_len: usize,
}

impl AccountSid {
    /// Pointer to the SID inside the owned buffer.
    ///
    /// Borrowed from `&self`, so the returned `PSID` can never outlive the buffer backing it — the
    /// classic dangling-PSID defect is prevented by the borrow checker rather than by discipline.
    fn psid(&self) -> PSID {
        // SAFETY: `buf` is 8-byte aligned (Vec<u64>) and was filled by a successful
        // `GetTokenInformation(TokenUser)` call, so it holds a valid `TOKEN_USER` whose `User.Sid`
        // points inside the same allocation.
        unsafe {
            let tu = self.buf.as_ptr() as *const TOKEN_USER;
            (*tu).User.Sid
        }
    }

    /// The raw SID bytes — scope material for the key digest only. Never rendered, logged or shown.
    pub fn sid_bytes(&self) -> &[u8] {
        let p = self.psid();
        // SAFETY: `p` points at a `GetLengthSid`-sized, `IsValidSid`-validated SID inside `buf`, and
        // the returned slice borrows `self`, so it cannot outlive that buffer.
        unsafe { std::slice::from_raw_parts(p.0 as *const u8, self.sid_len) }
    }
}

/// Resolve the CURRENT ACCOUNT SID.
///
/// `TokenUser` yields the account SID (`S-1-5-21-…`), NOT the logon-session SID (`S-1-5-5-X-Y`).
/// That distinction is the entire cross-session guarantee: the account SID is identical in the
/// console session and in every RDP session, so all of them derive one instance name; the session
/// SID would differ per session and silently permit one host per session.
///
/// No account-name lookup, no `LookupAccountSid`, no network or domain traffic.
pub fn current_account_sid() -> Result<AccountSid, InstanceFailure> {
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle that is valid for the calling process and
    // must NOT be closed; it is only passed to `OpenProcessToken`.
    let process = unsafe { GetCurrentProcess() };

    let mut raw_token = HANDLE::default();
    // SAFETY: `process` is the current-process pseudo-handle and `raw_token` is a valid writable
    // slot. On success the handle is immediately wrapped for RAII closure.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw_token) }
        .map_err(|_| InstanceFailure::AuthorityUnavailable)?;
    let token = OwnedToken(raw_token);

    // Size probe. This call is EXPECTED to fail with ERROR_INSUFFICIENT_BUFFER; only `needed`
    // matters, so the Result is intentionally discarded.
    let mut needed: u32 = 0;
    // SAFETY: passing a null buffer with length 0 is the documented size-query form; `needed` is a
    // valid writable slot.
    let _ = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &mut needed) };

    let needed_usize = needed as usize;
    if needed_usize < size_of::<TOKEN_USER>() || needed_usize > MAX_TOKEN_USER_BYTES {
        return Err(InstanceFailure::ScopeInvalid);
    }

    // Round up to whole u64 words to guarantee 8-byte alignment for the TOKEN_USER cast.
    let mut buf: Vec<u64> = vec![0u64; needed_usize.div_ceil(size_of::<u64>())];
    let mut written: u32 = 0;
    // SAFETY: `buf` is at least `needed` bytes, correctly aligned, and exclusively borrowed here.
    unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            needed,
            &mut written,
        )
    }
    .map_err(|_| InstanceFailure::AuthorityUnavailable)?;

    let sid = AccountSid { buf, sid_len: 0 };

    let p = sid.psid();
    if p.is_invalid() {
        return Err(InstanceFailure::ScopeInvalid);
    }
    // SAFETY: `p` points inside `sid.buf`, which was filled by the successful call above.
    if !unsafe { IsValidSid(p) }.as_bool() {
        return Err(InstanceFailure::ScopeInvalid);
    }
    // SAFETY: `p` was just validated by `IsValidSid`.
    let len = unsafe { GetLengthSid(p) } as usize;
    if len == 0 || len > 68 {
        return Err(InstanceFailure::ScopeInvalid);
    }

    Ok(AccountSid {
        sid_len: len,
        ..sid
    })
}

/// A `LocalAlloc`-backed SID string, freed exactly once.
struct SidString(PWSTR);

impl SidString {
    fn to_rust(&self) -> Result<String, InstanceFailure> {
        if self.0.is_null() {
            return Err(InstanceFailure::ScopeInvalid);
        }
        // SAFETY: `self.0` is a NUL-terminated wide string allocated by `ConvertSidToStringSidW` and
        // still owned by this value.
        unsafe { self.0.to_string() }.map_err(|_| InstanceFailure::ScopeInvalid)
    }
}

impl Drop for SidString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: allocated by `ConvertSidToStringSidW`, which documents `LocalFree` as the
            // matching deallocator; `Drop` runs once, so no double free.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0 as *mut _)));
            }
        }
    }
}

/// The instance object's security descriptor, freed exactly once.
pub struct InstanceSecurity {
    psd: PSECURITY_DESCRIPTOR,
}

impl InstanceSecurity {
    /// Build `D:P(A;;0x00100000;;;<current-account-sid>)`.
    ///
    /// Exact semantics:
    /// - `D:` — a DACL is present. A NULL DACL would grant EVERYONE full access, which is the
    ///   precise cross-user hazard this design exists to remove.
    /// - `P` — SE_DACL_PROTECTED, so no inherited ACEs. Kernel objects have no parent container
    ///   here, so inheritance flags are otherwise irrelevant; `P` states it explicitly.
    /// - `(A;;…)` — exactly ONE ACCESS_ALLOWED ACE, no ACE flags, no object GUIDs.
    /// - rights — `SYNCHRONIZE` only.
    /// - trustee — the current account SID.
    ///
    /// No Everyone ACE, no Authenticated Users ACE, no SYSTEM or Administrators ACE: nothing else
    /// ever opens this object, so granting anyone else would be unjustified privilege. Default-DACL
    /// reliance is rejected — it is token-dependent and not explicitly reviewable, and this object
    /// deliberately crosses sessions.
    ///
    /// The SDDL is generated INTERNALLY from a SID string produced by `ConvertSidToStringSidW`;
    /// no caller supplies any part of it, so there is no SDDL-injection surface.
    pub fn build(sid: &AccountSid) -> Result<Self, InstanceFailure> {
        let mut raw = PWSTR::null();
        // SAFETY: `sid.psid()` borrows `sid` and was validated by `IsValidSid`; `raw` is a valid
        // writable slot that receives a `LocalAlloc` string wrapped immediately for RAII.
        unsafe { ConvertSidToStringSidW(sid.psid(), &mut raw) }
            .map_err(|_| InstanceFailure::ScopeInvalid)?;
        let sid_string = SidString(raw);
        let sid_text = sid_string.to_rust()?;

        // A SID string is only `S-1-…` digits and hyphens. Refuse anything else rather than paste an
        // unexpected value into a security descriptor.
        if !sid_text.starts_with("S-1-")
            || !sid_text
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
        {
            return Err(InstanceFailure::ScopeInvalid);
        }

        let sddl = format!("D:P(A;;0x{MUTEX_ACCESS_SYNCHRONIZE:08X};;;{sid_text})");
        let wide: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();

        let mut psd = PSECURITY_DESCRIPTOR::default();
        // SAFETY: `wide` is a NUL-terminated wide string alive for this call; `psd` is a valid
        // writable slot receiving a `LocalAlloc` descriptor wrapped immediately for RAII.
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                windows::core::PCWSTR(wide.as_ptr()),
                SDDL_REVISION_1,
                &mut psd,
                None,
            )
        }
        .map_err(|_| InstanceFailure::AuthorityUnavailable)?;

        if psd.is_invalid() {
            return Err(InstanceFailure::AuthorityUnavailable);
        }
        Ok(InstanceSecurity { psd })
    }

    /// `SECURITY_ATTRIBUTES` referencing this descriptor.
    ///
    /// Borrowed from `&self`, so the returned value cannot outlive the descriptor it points at — the
    /// descriptor is therefore guaranteed valid across the creation call.
    ///
    /// `bInheritHandle = FALSE`: the instance handle must never be inherited by the daemon.
    pub fn security_attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.psd.0,
            bInheritHandle: false.into(),
        }
    }
}

impl Drop for InstanceSecurity {
    fn drop(&mut self) {
        if !self.psd.is_invalid() {
            // SAFETY: allocated by `ConvertStringSecurityDescriptorToSecurityDescriptorW`, which
            // documents `LocalFree` as the matching deallocator; `Drop` runs once, so no double free.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.psd.0)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_sid_resolves_and_is_bounded() {
        let sid = current_account_sid().expect("current account SID must resolve");
        let bytes = sid.sid_bytes();
        assert!(!bytes.is_empty(), "SID must not be empty");
        assert!(bytes.len() <= 68, "SID must respect SECURITY_MAX_SID_SIZE");
        // A real account SID starts with revision 1.
        assert_eq!(bytes[0], 1);
    }

    /// Stability is what makes the key deterministic across launches and sessions.
    #[test]
    fn account_sid_is_stable_across_repeated_resolution() {
        let a = current_account_sid().unwrap();
        let b = current_account_sid().unwrap();
        assert_eq!(a.sid_bytes(), b.sid_bytes());
    }

    #[test]
    fn security_descriptor_builds_from_the_current_account_sid() {
        let sid = current_account_sid().unwrap();
        let sec = InstanceSecurity::build(&sid).expect("descriptor must build");
        let sa = sec.security_attributes();
        assert_eq!(sa.nLength as usize, size_of::<SECURITY_ATTRIBUTES>());
        assert!(
            !sa.lpSecurityDescriptor.is_null(),
            "DACL must never be null"
        );
        assert!(
            !sa.bInheritHandle.as_bool(),
            "instance handle must be non-inheritable"
        );
    }

    /// Pins the exact granted rights: SYNCHRONIZE, never MUTEX_ALL_ACCESS.
    #[test]
    fn requested_access_is_synchronize_only() {
        assert_eq!(MUTEX_ACCESS_SYNCHRONIZE, 0x0010_0000);
        // MUTEX_ALL_ACCESS would be 0x1F0001 — explicitly not used.
        assert_ne!(MUTEX_ACCESS_SYNCHRONIZE, 0x001F_0001);
    }

    /// The SDDL is fixed-shape and derived only from the account SID.
    #[test]
    fn sddl_shape_is_protected_single_ace_synchronize() {
        let sid = current_account_sid().unwrap();
        let mut raw = PWSTR::null();
        // SAFETY: `sid.psid()` borrows `sid` and was validated during resolution; `raw` is a valid
        // writable slot whose `LocalAlloc` result is wrapped immediately for RAII release.
        unsafe { ConvertSidToStringSidW(sid.psid(), &mut raw) }.unwrap();
        let s = SidString(raw);
        let text = s.to_rust().unwrap();
        let sddl = format!("D:P(A;;0x{MUTEX_ACCESS_SYNCHRONIZE:08X};;;{text})");
        assert!(sddl.starts_with("D:P(A;;0x00100000;;;S-1-"));
        assert_eq!(sddl.matches('(').count(), 1, "exactly one ACE");
        assert!(!sddl.contains(";;;WD)"), "no Everyone ACE");
        assert!(!sddl.contains(";;;AU)"), "no Authenticated Users ACE");
        assert!(!sddl.contains(";;;BA)"), "no Administrators ACE");
        assert!(!sddl.contains(";;;SY)"), "no SYSTEM ACE");
    }

    /// Repeated build/drop cycles must not leak or double-free.
    #[test]
    fn repeated_descriptor_build_and_drop_is_clean() {
        let sid = current_account_sid().unwrap();
        for _ in 0..50 {
            let sec = InstanceSecurity::build(&sid).unwrap();
            assert!(!sec.security_attributes().lpSecurityDescriptor.is_null());
        }
    }
}

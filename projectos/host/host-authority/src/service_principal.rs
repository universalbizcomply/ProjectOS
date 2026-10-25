//! Read-only resolution of the ProjectOSHost service-specific principal SID.
//!
//! This performs a LOCAL LSA account-name lookup only (`LookupAccountNameW` for
//! `NT SERVICE\ProjectOSHost`). It NEVER opens the SCM, installs/starts/queries a service, launches a
//! process, or writes anything. If the principal cannot be resolved before the service is installed,
//! it classifies the outcome as [`ServiceSidResolution::RequiresInstalledServiceProof`] and the caller
//! composes a security profile WITHOUT the service ACE. The resolved SID string is crate-private and
//! never appears in `Debug`, a public getter, an error or any evidence value.

#![cfg(windows)]

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{IsValidSid, LookupAccountNameW, PSID, SID_NAME_USE};

use crate::model::ServiceSidResolution;

/// The service account whose SID we attempt to resolve, read-only. This is the recommended service
/// identity (3K-E); using its name for an LSA lookup neither installs nor touches the SCM, and it is
/// NOT the authority object name.
const SERVICE_ACCOUNT_NAME: &str = "NT SERVICE\\ProjectOSHost";

/// Upper bound for a SID buffer. `SECURITY_MAX_SID_SIZE` is 68 bytes; 256 is a comfortable ceiling
/// beyond which any reported size is treated as malformed rather than allocated.
const MAX_SID_BYTES: usize = 256;
/// Upper bound for the referenced-domain buffer, in `u16` chars.
const MAX_DOMAIN_CHARS: usize = 256;

/// A resolved service principal, owning only its textual SID. No raw SID pointer, path or name escapes.
pub struct ResolvedServicePrincipal {
    sid_string: String,
}

impl ResolvedServicePrincipal {
    /// CRATE-PRIVATE: the `S-1-…` SID string, for composing the machine-wide security descriptor only.
    #[must_use]
    pub(crate) fn sid_string(&self) -> &str {
        &self.sid_string
    }
}

impl core::fmt::Debug for ResolvedServicePrincipal {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Never reveal the concrete SID.
        f.write_str("ResolvedServicePrincipal(<redacted>)")
    }
}

/// A `LocalAlloc`-backed SID string, freed exactly once.
struct SidString(PWSTR);

impl Drop for SidString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: allocated by `ConvertSidToStringSidW`, whose documented deallocator is
            // `LocalFree`; `Drop` runs once, so no double free.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0 as *mut _)));
            }
        }
    }
}

/// Convert STRUCTURALLY VALIDATED binary SID bytes into the `S-1-…` string form, reusing the exact
/// `ConvertSidToStringSidW` + RAII (`SidString`) + shape-validation handling the service resolution
/// uses (PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A). This is a pure, read-only data conversion:
/// no account lookup, no token, no machine state. `None` on ANY structural failure — fail closed.
pub(crate) fn sid_string_from_binary(sid_bytes: &[u8]) -> Option<String> {
    // Structural pre-validation BEFORE any Win32 call, so `IsValidSid` can never read past the
    // buffer: revision 1, a bounded sub-authority count, and an EXACT length for that count
    // (8-byte header + 4 bytes per sub-authority).
    if sid_bytes.len() < 8 || sid_bytes.len() > MAX_SID_BYTES {
        return None;
    }
    let revision = sid_bytes[0];
    let sub_authorities = usize::from(sid_bytes[1]);
    if revision != 1 || sub_authorities > 15 || sid_bytes.len() != 8 + 4 * sub_authorities {
        return None;
    }

    // 4-byte aligned SID buffer (Vec<u32>), matching the resolution path above.
    let mut sid_buf: Vec<u32> = vec![0u32; sid_bytes.len().div_ceil(4)];
    // SAFETY: `sid_buf` is at least `sid_bytes.len()` bytes (rounded up to whole u32s), exclusively
    // borrowed, and the ranges cannot overlap (fresh allocation).
    unsafe {
        core::ptr::copy_nonoverlapping(
            sid_bytes.as_ptr(),
            sid_buf.as_mut_ptr().cast::<u8>(),
            sid_bytes.len(),
        );
    }
    let psid = PSID(sid_buf.as_mut_ptr().cast());
    // SAFETY: `psid` points into `sid_buf`, whose contents were structurally validated above so the
    // declared sub-authority count lies entirely within the buffer.
    if !unsafe { IsValidSid(psid) }.as_bool() {
        return None;
    }

    let mut raw = PWSTR::null();
    // SAFETY: `psid` is valid (checked) and points inside `sid_buf`, alive for this call; `raw`
    // receives a `LocalAlloc` string wrapped immediately for RAII release.
    if unsafe { ConvertSidToStringSidW(psid, &mut raw) }.is_err() {
        return None;
    }
    let sid_string = SidString(raw);
    if sid_string.0.is_null() {
        return None;
    }
    // SAFETY: `raw` is a NUL-terminated wide string owned by `sid_string`.
    let text = unsafe { sid_string.0.to_string() }.ok()?;

    // Same defensive shape rule as the resolution path: `S-1-…` digits and hyphens only.
    if !text.starts_with("S-1-")
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
    {
        return None;
    }
    Some(text)
}

/// Attempt to resolve the ProjectOSHost service principal SID, read-only.
///
/// Returns the classification plus, on success, the resolved principal. A failure to resolve (the
/// common pre-installation case) is NOT an error — it yields `RequiresInstalledServiceProof` with
/// `None`, and the caller omits the service ACE.
#[must_use]
pub fn resolve_projectos_host_service() -> (ServiceSidResolution, Option<ResolvedServicePrincipal>)
{
    let name: Vec<u16> = SERVICE_ACCOUNT_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // Size probe. Expected to fail with ERROR_INSUFFICIENT_BUFFER; only the sizes matter.
    let mut sid_bytes: u32 = 0;
    let mut domain_chars: u32 = 0;
    let mut use_kind = SID_NAME_USE::default();
    // SAFETY: null SID / null domain buffers with zero sizes is the documented size-query form; the
    // size out-params and `use_kind` are valid writable slots. On this path no buffer is written.
    let _ = unsafe {
        LookupAccountNameW(
            PCWSTR::null(),
            PCWSTR(name.as_ptr()),
            None,
            &mut sid_bytes,
            None,
            &mut domain_chars,
            &mut use_kind,
        )
    };

    let sid_len = sid_bytes as usize;
    let dom_len = domain_chars as usize;
    if sid_len == 0 || sid_len > MAX_SID_BYTES || dom_len == 0 || dom_len > MAX_DOMAIN_CHARS {
        // No pre-install resolution route on this machine.
        return (ServiceSidResolution::RequiresInstalledServiceProof, None);
    }

    // 4-byte aligned SID buffer (Vec<u32>).
    let mut sid_buf: Vec<u32> = vec![0u32; sid_len.div_ceil(4)];
    let mut domain: Vec<u16> = vec![0u16; dom_len];
    let mut sid_bytes2 = sid_bytes;
    let mut domain_chars2 = domain_chars;
    // SAFETY: both buffers are at least the probed size and exclusively borrowed here; the SID buffer
    // is 4-byte aligned. The name is a NUL-terminated wide string alive for the call.
    let ok = unsafe {
        LookupAccountNameW(
            PCWSTR::null(),
            PCWSTR(name.as_ptr()),
            Some(PSID(sid_buf.as_mut_ptr().cast())),
            &mut sid_bytes2,
            Some(PWSTR(domain.as_mut_ptr())),
            &mut domain_chars2,
            &mut use_kind,
        )
    };
    if ok.is_err() {
        return (ServiceSidResolution::RequiresInstalledServiceProof, None);
    }

    let psid = PSID(sid_buf.as_mut_ptr().cast());
    // SAFETY: `psid` points into `sid_buf`, filled by the successful call above.
    if !unsafe { IsValidSid(psid) }.as_bool() {
        return (ServiceSidResolution::ResolutionUnavailable, None);
    }

    let mut raw = PWSTR::null();
    // SAFETY: `psid` is valid (checked) and points inside `sid_buf`, alive for this call; `raw`
    // receives a `LocalAlloc` string wrapped immediately for RAII release.
    if unsafe { ConvertSidToStringSidW(psid, &mut raw) }.is_err() {
        return (ServiceSidResolution::ResolutionUnavailable, None);
    }
    let sid_string = SidString(raw);
    if sid_string.0.is_null() {
        return (ServiceSidResolution::ResolutionUnavailable, None);
    }
    // SAFETY: `raw` is a NUL-terminated wide string owned by `sid_string`.
    let text = match unsafe { sid_string.0.to_string() } {
        Ok(t) => t,
        Err(_) => return (ServiceSidResolution::ResolutionUnavailable, None),
    };

    // A SID string is `S-1-…` digits and hyphens; reject anything else rather than paste it into a
    // security descriptor later.
    if !text.starts_with("S-1-")
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
    {
        return (ServiceSidResolution::ResolutionUnavailable, None);
    }

    (
        ServiceSidResolution::SupportedResolutionProven,
        Some(ResolvedServicePrincipal { sid_string: text }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SYNTHETIC binary SID: `S-1-5-21-2222-3333-4444-1001` (revision 1, 5 sub-authorities,
    /// NT authority). No real account; pure data.
    fn synthetic_owner_sid_bytes() -> Vec<u8> {
        let mut b = vec![1u8, 5, 0, 0, 0, 0, 0, 5];
        for sub in [21u32, 2222, 3333, 4444, 1001] {
            b.extend_from_slice(&sub.to_le_bytes());
        }
        b
    }

    #[test]
    fn synthetic_binary_sid_converts_to_its_exact_string_form() {
        let text = sid_string_from_binary(&synthetic_owner_sid_bytes())
            .expect("a structurally valid synthetic SID must convert");
        assert_eq!(text, "S-1-5-21-2222-3333-4444-1001");
    }

    #[test]
    fn malformed_binary_sids_fail_closed() {
        let good = synthetic_owner_sid_bytes();
        // Truncated: the declared count no longer fits the buffer.
        assert!(sid_string_from_binary(&good[..good.len() - 1]).is_none());
        // Wrong revision.
        let mut wrong_rev = good.clone();
        wrong_rev[0] = 2;
        assert!(sid_string_from_binary(&wrong_rev).is_none());
        // Sub-authority count above the SID maximum.
        let mut too_many = good.clone();
        too_many[1] = 16;
        assert!(sid_string_from_binary(&too_many).is_none());
        // Empty and oversize inputs.
        assert!(sid_string_from_binary(&[]).is_none());
        assert!(sid_string_from_binary(&vec![1u8; MAX_SID_BYTES + 1]).is_none());
    }

    #[test]
    fn resolution_attempt_is_read_only_and_classifies() {
        // On a machine WITHOUT the installed service this is expected to be RequiresInstalledServiceProof;
        // on one where the virtual account SID can be synthesised it is SupportedResolutionProven. Either
        // is a valid read-only classification — the call must never panic and never install anything.
        let (class, principal) = resolve_projectos_host_service();
        match class {
            ServiceSidResolution::SupportedResolutionProven => {
                let p = principal.expect("proven resolution yields a principal");
                assert!(p.sid_string().starts_with("S-1-"));
            }
            ServiceSidResolution::RequiresInstalledServiceProof
            | ServiceSidResolution::ResolutionUnavailable => {
                assert!(principal.is_none());
            }
            ServiceSidResolution::InstallerPreparedSid => {
                // Not produced by this read-only path.
                panic!("read-only resolution never claims InstallerPreparedSid");
            }
        }
    }
}

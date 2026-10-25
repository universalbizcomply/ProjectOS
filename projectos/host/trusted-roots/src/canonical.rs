//! SETTLING A CANONICAL PATH — one spelling, proven to denote the directory that was composed.
//!
//! ## The first problem this solves, discovered rather than assumed
//!
//! `GetFinalPathNameByHandleW` — which is what makes two spellings of one directory produce one
//! answer — returns the VERBATIM form, `\\?\C:\...`. That form is exactly what the accepted
//! `validate_local_root` rule refuses, and it refuses it for a good reason: the verbatim prefix
//! bypasses Win32 path normalisation, so a path in that form does not mean what every other
//! spelling of it means. The accepted durable protected store applies that rule when it opens, so a
//! trusted root published in verbatim form resolves perfectly and then cannot be used for anything.
//!
//! ## The second, and the one that actually closes a race
//!
//! `FILE_FLAG_OPEN_REPARSE_POINT` describes the FINAL component of a path. Every level of the Host
//! state root's chain is opened and inspected, but those are independent opens: an ancestor replaced
//! by a junction BETWEEN its own check and the leaf open would be traversed silently, and no
//! identity captured afterwards would reveal it, because the attacker's directory becomes the
//! baseline everything later compares against.
//!
//! The fix is not a faster check, it is a different question. `GetFinalPathNameByHandleW` reports
//! where the opened object ACTUALLY lives. If any ancestor junction was followed, that answer is the
//! junction target's location, which is not the path that was composed. So settling COMPARES the two,
//! and a disagreement is [`TrustedRootRefusal::RootRedirected`]. That is decisive rather than
//! probabilistic: it holds whether the attacker leaves the junction in place, removes it again, or
//! wins any number of interleavings, because it tests the OUTCOME rather than the timing.
//!
//! ## What settling delegates
//!
//! It strips the prefix, refuses the UNC form outright, RE-OPENS the stripped spelling as custody,
//! and requires the re-opened object to be the same object. That second open puts the stripped path
//! back through the accepted syntax gate — the same `validate_local_root` the store will apply — and
//! through the same reparse refusal. So the published path is not merely a string this module
//! trimmed; it is a spelling proven to open, to be safe, and to denote the directory resolved.
//!
//! No path rule is written here. The trimming is a format conversion between two spellings Windows
//! itself produced, and the comparison is an equality test between a path this crate composed and a
//! path Windows reported. Every decision about whether a path is ACCEPTABLE belongs to the primitive.

use std::path::{Path, PathBuf};

use projectos_host_windows_root_custody::WindowsRootCustody;

use crate::refusal::{from_custody, TrustedRootRefusal};

/// The verbatim prefix Windows returns for a normalised local path.
const VERBATIM_PREFIX: &str = r"\\?\";

/// The verbatim prefix Windows returns for a normalised UNC path. Never acceptable as a root.
const VERBATIM_UNC_PREFIX: &str = r"UNC\";

/// Whether a settled spelling is the verbatim UNC form.
///
/// COMPARED AS BYTES, NOT AS `str`. `&text[..4]` panics when byte 4 is not a UTF-8 character
/// boundary, and a governed repository root is an arbitrary installer-chosen path: `C:\Ünïcödé` puts
/// a two-byte character at byte 3, so the slice lands mid-character. A crash is not a refusal, and
/// this crate's whole contract is that every failure is one. Slicing a `[u8]` has no boundary
/// constraint, and `[u8]::eq_ignore_ascii_case` compares exactly the ASCII prefix in question.
fn is_verbatim_unc(trimmed: &str) -> bool {
    let bytes = trimmed.as_bytes();
    let prefix = VERBATIM_UNC_PREFIX.as_bytes();
    bytes.len() >= prefix.len() && bytes[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Whether two paths name the same location, as Windows itself would judge the spelling.
///
/// CASE-INSENSITIVE, SEPARATOR-NORMALISED, TRAILING-SEPARATOR-INSENSITIVE. Windows spells one
/// directory several ways and `GetFinalPathNameByHandleW` returns the filesystem's own casing, which
/// need not be the casing that was composed or registered. Anything beyond those three
/// equivalences — traversal, the verbatim form, alternate data streams, UNC — was already refused by
/// the accepted syntax gate before either path reached here, so this is an equality test and not a
/// second path-security rule.
///
/// ## Why UNICODE lowercasing, when this is a security comparison
///
/// The obvious worry is that `to_lowercase` folds characters NTFS might not — U+212A KELVIN SIGN
/// becomes `k` — so two distinct names could produce one key and a substitution could compare equal.
/// It cannot, and the reason is structural rather than lucky: the only way the settled path differs
/// from the composed one is that a reparse point was followed, and following one lands the object
/// under a DIFFERENT ANCESTOR. That difference is in the ancestor's text, which no folding of a
/// component name can conceal. Folding therefore cannot hide a redirection; it can only equate two
/// spellings of the same location, which is precisely its job here.
///
/// Restricting to ASCII folding would remove nothing real and would BREAK something real: a
/// repository registered as `C:\Café` whose directory is stored as `C:\CAFÉ` would stop resolving,
/// because Windows matched the two and an ASCII-only fold would not. That is a false refusal of a
/// legitimate project in exchange for a class that cannot be reached.
///
/// `to_string_lossy` is likewise safe here rather than merely convenient: the settled path was
/// already required to be valid UTF-8 by `settle`, and the composed path came through the custody
/// primitive, which refuses a path it cannot render as `&str`. Neither side can carry a replacement
/// character by the time this runs.
fn same_location(a: &Path, b: &Path) -> bool {
    fn key(p: &Path) -> String {
        let text = p.to_string_lossy().replace('/', "\\").to_lowercase();
        // Trim a trailing separator, but never turn `c:\` into `c:`.
        match text.strip_suffix('\\') {
            Some(shorter) if shorter.len() > 2 => shorter.to_string(),
            _ => text,
        }
    }
    key(a) == key(b)
}

/// Settle the canonical spelling of an already-held custody root, and prove it is where `composed`
/// said it would be.
///
/// # Errors
/// [`TrustedRootRefusal::UnsafePath`] when the canonical form is not representable as an ordinary
/// drive-rooted path, [`TrustedRootRefusal::RootRedirected`] when the object actually opened does
/// not live at the composed path, [`TrustedRootRefusal::RootIdentityDrift`] when the settled
/// spelling denotes a different object, or whatever the custody primitive says about re-opening it.
pub(crate) fn settle(
    custody: &WindowsRootCustody,
    composed: &Path,
) -> Result<PathBuf, TrustedRootRefusal> {
    let text = custody
        .canonical_path()
        .to_str()
        .ok_or(TrustedRootRefusal::UnsafePath)?;
    let trimmed = text.strip_prefix(VERBATIM_PREFIX).unwrap_or(text);
    // A NETWORK ROOT IS NEVER A TRUSTED ROOT HERE. The syntax gate already refused a UNC path on the
    // way in; meeting one on the way out means the object reached is on a share after all, and the
    // honest answer is a refusal rather than a spelling nobody can use.
    if is_verbatim_unc(trimmed) {
        return Err(TrustedRootRefusal::UnsafePath);
    }
    let settled = PathBuf::from(trimmed);

    // THE OBJECT MUST LIVE WHERE THE PATH SAID. This is what makes an ancestor junction — whether it
    // was there all along or was swapped in during the walk — a refusal rather than a silent
    // redirection, because a followed junction lands the object somewhere the composed path does not
    // name.
    if !same_location(&settled, composed) {
        return Err(TrustedRootRefusal::RootRedirected);
    }

    // THE SECOND OPEN IS THE PROOF, not a formality: the accepted syntax rule, the reparse refusal
    // and the handle-derived identity all apply again, to the spelling that will actually be
    // published.
    let confirmation = WindowsRootCustody::open(&settled).map_err(from_custody)?;
    if !confirmation.identity().same_object(&custody.identity()) {
        return Err(TrustedRootRefusal::RootIdentityDrift);
    }
    Ok(settled)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// THE PANIC THAT WAS NOT A REFUSAL. Byte 3 of this string starts a two-byte character, so the
    /// `&str[..4]` this predicate used to perform panicked instead of answering. A governed
    /// repository root is an arbitrary installer-chosen path, so the input is reachable.
    #[test]
    fn a_non_ascii_settled_path_is_answered_rather_than_panicking() {
        assert!(!is_verbatim_unc("C:\u{dc}n\u{ef}c\u{f6}d\u{e9}"));
        assert!(!is_verbatim_unc("\u{65e5}\u{672c}\u{8a9e}"));
        assert!(!is_verbatim_unc("\u{e9}"));
        assert!(!is_verbatim_unc(""));
        assert!(!is_verbatim_unc("UN"));
    }

    #[test]
    fn the_verbatim_unc_form_is_recognised_in_any_casing() {
        assert!(is_verbatim_unc(r"UNC\server\share"));
        assert!(is_verbatim_unc(r"unc\server\share"));
        assert!(is_verbatim_unc(r"UnC\server\share"));
        assert!(!is_verbatim_unc(r"UNCLE\file"));
        assert!(!is_verbatim_unc(r"C:\UNC\not-at-the-start"));
    }

    #[test]
    fn equivalent_spellings_are_one_location_and_different_ones_are_not() {
        assert!(same_location(
            Path::new(r"C:\ProgramData\ProjectOS\host"),
            Path::new(r"c:\programdata\projectos\host")
        ));
        assert!(same_location(
            Path::new(r"C:\ProgramData\ProjectOS\host\"),
            Path::new(r"C:\ProgramData\ProjectOS\host")
        ));
        assert!(same_location(
            Path::new("C:/ProgramData/ProjectOS/host"),
            Path::new(r"C:\ProgramData\ProjectOS\host")
        ));
        assert!(same_location(Path::new(r"C:\"), Path::new(r"C:\")));
        // A followed junction lands somewhere the composed path does not name.
        assert!(!same_location(
            Path::new(r"D:\elsewhere\host"),
            Path::new(r"C:\ProgramData\ProjectOS\host")
        ));
        assert!(!same_location(
            Path::new(r"C:\ProgramData\ProjectOS"),
            Path::new(r"C:\ProgramData\ProjectOS\host")
        ));
    }
}

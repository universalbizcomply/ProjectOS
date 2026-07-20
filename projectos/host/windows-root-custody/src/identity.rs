//! The immutable, handle-derived filesystem identity value object.
//!
//! Identity is taken from the OPENED HANDLE, never from a pathname, a timestamp, or path spelling. It
//! pairs the volume serial with the modern 128-bit file identifier so a replacement object at the same
//! pathname is distinguishable from the original.
//!
//! **Disclosure:** these values are machine-specific. `Debug` is deliberately REDACTED and there is no
//! `Display`, no accessor returning the raw values, and no hashing/fingerprinting merely to make them
//! printable. Equality comparison is the only intended use.

use std::fmt;

/// A stable, non-secret (but machine-specific) filesystem object identity captured from a handle.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct RootIdentity {
    volume_serial: u64,
    file_id: [u8; 16],
}

impl RootIdentity {
    /// Construct from handle-derived values (crate-internal only).
    pub(crate) fn new(volume_serial: u64, file_id: [u8; 16]) -> Self {
        Self {
            volume_serial,
            file_id,
        }
    }

    /// Whether this identity refers to the same filesystem object as `other` (same volume AND file id).
    #[must_use]
    pub fn same_object(&self, other: &Self) -> bool {
        self == other
    }

    /// Whether this identity is on the same volume as `other` (non-secret comparison only).
    #[must_use]
    pub fn same_volume(&self, other: &Self) -> bool {
        self.volume_serial == other.volume_serial
    }
}

impl fmt::Debug for RootIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // REDACTED: never print the volume serial or file identifier.
        f.write_str("RootIdentity(redacted)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equality_distinguishes_objects_and_volumes() {
        let a = RootIdentity::new(1, [7u8; 16]);
        let b = RootIdentity::new(1, [7u8; 16]);
        let different_file = RootIdentity::new(1, [9u8; 16]);
        let different_volume = RootIdentity::new(2, [7u8; 16]);
        assert!(a.same_object(&b));
        assert!(!a.same_object(&different_file));
        assert!(!a.same_object(&different_volume));
        assert!(a.same_volume(&different_file));
        assert!(!a.same_volume(&different_volume));
    }

    #[test]
    fn debug_is_redacted() {
        let id = RootIdentity::new(0xDEAD_BEEF, [0xAB; 16]);
        let shown = format!("{id:?}");
        assert_eq!(shown, "RootIdentity(redacted)");
        assert!(!shown.contains("dead"));
        assert!(!shown.contains("ab"));
    }
}

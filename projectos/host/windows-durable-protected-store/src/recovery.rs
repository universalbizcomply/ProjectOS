//! Pure STRUCTURAL recovery classification (manifest vs record revisions only, no filesystem or
//! journal-intent reads). The intent-aware decisions (one-ahead promotion requires an exact matching
//! Prepared intent; abort/commit finalisation) live in the store, which layers journal evidence on top
//! of this structural base. Keeping the structural part pure makes it deterministically testable.

/// One scanned record's non-secret recovery facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordScan {
    /// The store revision the record was committed at (framed).
    pub revision: u64,
    /// Whether the record's framing + SHA-256 integrity passed.
    pub integrity_ok: bool,
}

/// The structural state of a store root before journal-intent evidence is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Structural {
    /// A record failed integrity, or a structurally-impossible zero revision exists.
    Corrupt,
    /// No manifest and no records.
    Empty,
    /// Every record is covered by the manifest revision (enclosed).
    Coherent(u64),
    /// Records exist with no authoritative manifest.
    RecordsNoManifest,
    /// The manifest revision is ahead of every record.
    ManifestAhead,
    /// Exactly one record is one revision ahead of the manifest.
    OneAhead {
        /// The current manifest revision.
        manifest: u64,
        /// The single ahead record revision (`manifest + 1`).
        ahead: u64,
    },
    /// More than one record is ahead, or a record is more than one ahead.
    MultipleAhead,
}

/// Classify the structural state. `manifest` is `None` when no manifest exists.
#[must_use]
pub fn structural(manifest: Option<u64>, records: &[RecordScan]) -> Structural {
    if records.iter().any(|r| !r.integrity_ok || r.revision == 0) {
        return Structural::Corrupt;
    }
    let max_rev = records.iter().map(|r| r.revision).max();
    match (manifest, max_rev) {
        (None, None) => Structural::Empty,
        (None, Some(_)) => Structural::RecordsNoManifest,
        (Some(m), None) => Structural::Coherent(m),
        (Some(m), Some(x)) => {
            if x < m {
                Structural::ManifestAhead
            } else if x == m {
                Structural::Coherent(m)
            } else if x == m + 1 && count_at(records, x) == 1 {
                Structural::OneAhead {
                    manifest: m,
                    ahead: x,
                }
            } else {
                Structural::MultipleAhead
            }
        }
    }
}

fn count_at(records: &[RecordScan], rev: u64) -> usize {
    records.iter().filter(|r| r.revision == rev).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(rev: u64) -> RecordScan {
        RecordScan {
            revision: rev,
            integrity_ok: true,
        }
    }

    #[test]
    fn empty() {
        assert_eq!(structural(None, &[]), Structural::Empty);
    }
    #[test]
    fn coherent() {
        assert_eq!(
            structural(Some(5), &[ok(3), ok(5)]),
            Structural::Coherent(5)
        );
    }
    #[test]
    fn one_ahead() {
        assert_eq!(
            structural(Some(4), &[ok(3), ok(5)]),
            Structural::OneAhead {
                manifest: 4,
                ahead: 5
            }
        );
    }
    #[test]
    fn two_ahead_is_multiple() {
        assert_eq!(structural(Some(4), &[ok(6)]), Structural::MultipleAhead);
    }
    #[test]
    fn multiple_at_ahead() {
        assert_eq!(
            structural(Some(4), &[ok(5), ok(5)]),
            Structural::MultipleAhead
        );
    }
    #[test]
    fn records_no_manifest() {
        assert_eq!(structural(None, &[ok(1)]), Structural::RecordsNoManifest);
    }
    #[test]
    fn manifest_ahead() {
        assert_eq!(structural(Some(5), &[ok(3)]), Structural::ManifestAhead);
    }
    #[test]
    fn corrupt_on_integrity() {
        assert_eq!(
            structural(
                Some(3),
                &[RecordScan {
                    revision: 3,
                    integrity_ok: false
                }]
            ),
            Structural::Corrupt
        );
    }
    #[test]
    fn corrupt_on_zero_rev() {
        assert_eq!(structural(Some(1), &[ok(0)]), Structural::Corrupt);
    }
}

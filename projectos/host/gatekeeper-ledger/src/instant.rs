//! The ledger's notion of WHEN — one rendering of one clock reading, in the canonical shape.
//!
//! ## Why this exists at all
//!
//! The canonical ledger attributes spend to a calendar month by string prefix: `at.slice(0, 7)` of
//! `new Date().toISOString()`, which is the UTC `YYYY-MM`. Nothing parses a date on the read side,
//! deliberately (a malformed timestamp must not be reinterpreted into some real month), so the
//! WRITE side is where the month is decided. A Host that rendered its clock in local time, or with
//! a different calendar arithmetic, would put the same instant in a different month from the agent
//! and the hard stop would be applied to two different totals. So this module is the one place the
//! Host turns epoch seconds into that string, it is UTC by construction, and its output is checked
//! against Node's own rendering in the cross-implementation proof.
//!
//! ## What it is not
//!
//! It is not a clock. It takes a reading the caller already made (the Host's sealed
//! `HostClockReading`) and renders it. It reads no system time of its own.

use std::fmt;

/// Seconds in one day.
const SECONDS_PER_DAY: u64 = 86_400;

/// The last instant this rendering will express: `9999-12-31T23:59:59Z`. Beyond it the four-digit
/// year the canonical prefix rule depends on no longer holds, so the answer is a refusal rather than
/// a five-digit year that would never match any month.
pub const MAX_EPOCH_S: u64 = 253_402_300_799;

/// Why an instant could not be rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstantError {
    /// The reading is past [`MAX_EPOCH_S`].
    BeyondRepresentableYear,
}

impl fmt::Display for InstantError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BeyondRepresentableYear => {
                write!(
                    f,
                    "the clock reading is beyond the year 9999 and cannot be rendered"
                )
            }
        }
    }
}

impl std::error::Error for InstantError {}

/// One instant, rendered once, in the canonical ISO-8601 UTC shape `YYYY-MM-DDTHH:MM:SSZ`.
///
/// Whole seconds only: the Host's sealed clock reading carries no finer resolution, and writing
/// `.000Z` would assert a precision the reading does not have. The canonical month rule reads only
/// the first seven characters, which are identical in either form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerInstant {
    rendered: String,
}

impl LedgerInstant {
    /// Render a Unix epoch reading (seconds) as the canonical UTC timestamp.
    ///
    /// # Errors
    /// [`InstantError::BeyondRepresentableYear`] past [`MAX_EPOCH_S`].
    pub fn from_epoch_s(epoch_s: u64) -> Result<Self, InstantError> {
        if epoch_s > MAX_EPOCH_S {
            return Err(InstantError::BeyondRepresentableYear);
        }
        let days = epoch_s / SECONDS_PER_DAY;
        let secs = epoch_s % SECONDS_PER_DAY;
        let (year, month, day) = civil_from_days(days);
        let rendered = format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            secs / 3600,
            (secs / 60) % 60,
            secs % 60
        );
        Ok(Self { rendered })
    }

    /// The full timestamp, as written to the ledger's `at` field.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.rendered
    }

    /// The canonical month prefix `YYYY-MM` — exactly `at.slice(0, 7)`.
    #[must_use]
    pub fn month(&self) -> &str {
        &self.rendered[..7]
    }
}

/// Days since 1970-01-01 to a proleptic Gregorian civil date, for non-negative day counts.
///
/// Howard Hinnant's `civil_from_days`, restricted to the epoch-forward range this crate accepts.
/// Integer-only, so it is exact, and small enough to be checked by hand against the vectors in the
/// tests below and against Node in the cross-implementation proof.
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vectors produced by `new Date(s * 1000).toISOString()` in Node 24, with the `.000` removed.
    const VECTORS: &[(u64, &str)] = &[
        (0, "1970-01-01T00:00:00Z"),
        (86_399, "1970-01-01T23:59:59Z"),
        (86_400, "1970-01-02T00:00:00Z"),
        (951_782_400, "2000-02-29T00:00:00Z"),
        (951_868_799, "2000-02-29T23:59:59Z"),
        (951_868_800, "2000-03-01T00:00:00Z"),
        (1_709_164_800, "2024-02-29T00:00:00Z"),
        (1_756_684_799, "2025-08-31T23:59:59Z"),
        (1_756_684_800, "2025-09-01T00:00:00Z"),
        (1_757_341_948, "2025-09-08T14:32:28Z"),
        (1_767_225_599, "2025-12-31T23:59:59Z"),
        (1_767_225_600, "2026-01-01T00:00:00Z"),
        (4_102_444_799, "2099-12-31T23:59:59Z"),
        (4_102_444_800, "2100-01-01T00:00:00Z"),
        (MAX_EPOCH_S, "9999-12-31T23:59:59Z"),
    ];

    #[test]
    fn renders_the_canonical_utc_shape() {
        for (epoch, expected) in VECTORS {
            let instant = LedgerInstant::from_epoch_s(*epoch).expect("in range");
            assert_eq!(instant.as_str(), *expected, "epoch {epoch}");
            assert_eq!(instant.month(), &expected[..7], "epoch {epoch}");
        }
    }

    #[test]
    fn a_month_boundary_is_the_utc_one() {
        let last = LedgerInstant::from_epoch_s(1_756_684_799).unwrap();
        let first = LedgerInstant::from_epoch_s(1_756_684_800).unwrap();
        assert_eq!(last.month(), "2025-08");
        assert_eq!(first.month(), "2025-09");
    }

    #[test]
    fn beyond_the_year_9999_is_refused() {
        assert_eq!(
            LedgerInstant::from_epoch_s(MAX_EPOCH_S + 1),
            Err(InstantError::BeyondRepresentableYear)
        );
        assert_eq!(
            LedgerInstant::from_epoch_s(u64::MAX),
            Err(InstantError::BeyondRepresentableYear)
        );
    }

    #[test]
    fn the_rendering_is_exactly_twenty_characters() {
        for (epoch, _) in VECTORS {
            assert_eq!(
                LedgerInstant::from_epoch_s(*epoch).unwrap().as_str().len(),
                20
            );
        }
    }
}

//! INTERNAL current-process Windows elevation OBSERVATION engine
//! (3K-I-D-E-C-CAPABILITY-B4-ELEVATION-OBSERVATION-ENGINE1A).
//!
//! This module is PRIVATE (`mod elevation`, never `pub mod`) and gated behind the non-default
//! `windows-elevation-observation` feature. It answers exactly one question about the CURRENT process:
//! is this process running with a genuinely elevated token? It observes nothing else and no other
//! process.
//!
//! What it deliberately does NOT do:
//!   - it does not mint a `VerifiedElevationWitness` (that requires an authentic effect context, which
//!     does not exist yet — see the preflight findings);
//!   - it does not produce an effect grant or a live capability;
//!   - it does not accept a PID, a process handle, a token handle, a bool or a legacy `Elevation`;
//!   - it does not treat Administrators-group membership as elevation, and it never calls
//!     `CheckTokenMembership` / `IsUserAnAdmin`;
//!   - it is never EXECUTED in this phase. The real Windows backend is compiled to prove it builds
//!     within the boundary; running it is a separately-authorised live preflight.
//!
//! Three layers, narrowly separated:
//!   A. a closed classification (`ElevationObservation`), redacted, carrying no identity;
//!   B. a backend contract (`ElevationTokenSource`) that opens the current-process token and reads it;
//!   C. a pure decision (`classify`) over closed backend readings only.
//!
//! Every item is intentionally unused by non-test code this phase (nothing executes the engine), so a
//! module-level dead-code allowance is honest and required; the private module plus the dedicated
//! validator are the real safety net.
#![allow(dead_code)]

use core::fmt;

// ---------------------------------------------------------------------------------------------
// A. CLOSED CLASSIFICATION
// ---------------------------------------------------------------------------------------------

/// The closed, crate-private result of one current-process elevation observation.
///
/// It carries NO raw Windows error, PID, process handle, token handle, SID, username, machine name,
/// session identifier, pointer or raw API output — only a coarse outcome. `Debug` is redacted so even
/// the outcome cannot leak into a log; in-crate tests compare variants by value.
#[derive(PartialEq, Eq)]
pub(crate) enum ElevationObservation {
    /// The current process is genuinely running elevated (`TokenIsElevated` true, type consistent).
    Elevated,
    /// Not elevated; a linked full token exists (filtered/limited token). Membership is NOT elevation.
    NotElevatedLimitedToken,
    /// Not elevated; no split token in play (UAC off, or a non-split account, or a standard user).
    NotElevatedDefaultToken,
    /// The process token could not be opened because access was denied.
    TokenOpenDenied,
    /// The token or one of its information classes could not be read; the observation is unavailable.
    TokenQueryUnavailable,
    /// The Windows API returned an inconsistent or wrong-sized result. Fail closed.
    MalformedResult,
    /// The platform/backend does not support the observation.
    UnsupportedPlatform,
}

impl fmt::Debug for ElevationObservation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ElevationObservation([REDACTED])")
    }
}

impl ElevationObservation {
    /// The ONLY positive observation. Even a positive does not mint a witness in this phase.
    pub(crate) fn is_positive(&self) -> bool {
        matches!(self, Self::Elevated)
    }
}

// ---------------------------------------------------------------------------------------------
// B. BACKEND CONTRACT
// ---------------------------------------------------------------------------------------------

/// The elevation-type classification, closed. `Unknown` is any value the platform did not define.
pub(crate) enum RawElevationType {
    Default,
    Full,
    Limited,
    Unknown,
}

/// A closed reading produced by a backend. No identity, no raw error code — only what the pure
/// decision layer needs.
pub(crate) enum RawElevation {
    /// Both the `TokenElevation` and `TokenElevationType` reads succeeded.
    Reading {
        is_elevated: bool,
        kind: RawElevationType,
    },
    /// `TokenElevation` read succeeded but `TokenElevationType` did not. Consistency cannot be checked,
    /// so the decision layer must fail closed — it must NEVER widen this to `Elevated`.
    TypeUnavailable { is_elevated: bool },
    /// The `TokenElevation` read itself failed.
    Unavailable,
    /// A returned buffer had the wrong length, or the values were internally inconsistent.
    Malformed,
}

/// The outcome of attempting to open the current-process token, generic over the owned guard so that a
/// test backend can supply a drop-counting guard and the real backend can supply an `OwnedHandle`.
pub(crate) enum TokenOpen<G> {
    /// The token was opened; `G` owns it and releases it exactly once on drop.
    Opened(G),
    /// Opening the token was denied.
    Denied,
    /// Opening the token failed for a non-denial reason.
    Unavailable,
    /// The backend/platform does not support the operation.
    Unsupported,
}

/// A source of the CURRENT-process elevation reading.
///
/// Implementors take NO caller-supplied target: `open` obtains the current-process token internally,
/// and `read` observes only through the guard `open` returned. There is deliberately no way to point
/// this at another process, a caller PID, a caller handle or a caller-asserted result.
pub(crate) trait ElevationTokenSource {
    /// The owned token guard; dropped exactly once, closing the token.
    type Guard;
    /// Open the current-process token with `TOKEN_QUERY` only.
    fn open(&self) -> TokenOpen<Self::Guard>;
    /// Read elevation from an opened token guard.
    fn read(&self, guard: &Self::Guard) -> RawElevation;
}

// ---------------------------------------------------------------------------------------------
// C. PURE DECISION
// ---------------------------------------------------------------------------------------------

/// Map a token-open FAILURE to the closed open outcome. Pure: its only input is whether the failure was
/// access-denied — never a raw error code, which the caller inspects transiently and discards.
///
/// This is the SINGLE decision the real Windows backend and the synthetic tests both call, so the tests
/// exercise exactly the mapping the real backend uses. Access-denied is distinguished here (not
/// collapsed into the generic unavailable case) so `TokenOpenDenied` is genuinely reachable.
pub(crate) fn classify_open_failure<G>(access_denied: bool) -> TokenOpen<G> {
    if access_denied {
        TokenOpen::Denied
    } else {
        TokenOpen::Unavailable
    }
}

/// Map a closed backend reading to the closed observation. Pure: no I/O, no Windows call, no state.
///
/// The authorising fact is `TokenIsElevated` alone; `TokenElevationType` is used only to classify a
/// negative and to reject an inconsistent pair. A false or unavailable elevation is NEVER widened.
pub(crate) fn classify(raw: RawElevation) -> ElevationObservation {
    match raw {
        RawElevation::Reading {
            is_elevated: true,
            kind,
        } => match kind {
            // Elevated with a full or default token is consistent → the one positive result.
            RawElevationType::Full | RawElevationType::Default => ElevationObservation::Elevated,
            // Elevated cannot coexist with a limited token, and an unknown type is not trustworthy.
            RawElevationType::Limited | RawElevationType::Unknown => {
                ElevationObservation::MalformedResult
            }
        },
        RawElevation::Reading {
            is_elevated: false,
            kind,
        } => match kind {
            RawElevationType::Limited => ElevationObservation::NotElevatedLimitedToken,
            RawElevationType::Default => ElevationObservation::NotElevatedDefaultToken,
            // Not elevated cannot coexist with a full token, and an unknown type is not trustworthy.
            RawElevationType::Full | RawElevationType::Unknown => {
                ElevationObservation::MalformedResult
            }
        },
        // TokenElevationType unavailable: cannot confirm consistency, so fail closed regardless of the
        // elevation bit. Decision: report unavailable rather than widen a possibly-elevated read into a
        // positive, because this phase must never emit a positive it cannot fully corroborate.
        RawElevation::TypeUnavailable { .. } => ElevationObservation::TokenQueryUnavailable,
        RawElevation::Unavailable => ElevationObservation::TokenQueryUnavailable,
        RawElevation::Malformed => ElevationObservation::MalformedResult,
    }
}

/// Observe the current process through a backend. The token guard is dropped at the end of the opened
/// branch, so the token is released exactly once on EVERY classification outcome; the denial /
/// unavailable / unsupported branches never opened a token, so there is nothing to release.
pub(crate) fn observe<S: ElevationTokenSource>(source: &S) -> ElevationObservation {
    match source.open() {
        TokenOpen::Denied => ElevationObservation::TokenOpenDenied,
        TokenOpen::Unavailable => ElevationObservation::TokenQueryUnavailable,
        TokenOpen::Unsupported => ElevationObservation::UnsupportedPlatform,
        TokenOpen::Opened(guard) => {
            let raw = source.read(&guard);
            classify(raw)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// REAL WINDOWS BACKEND — compiled to prove it builds within the boundary; NEVER executed this phase.
// ---------------------------------------------------------------------------------------------

/// The real current-process elevation source. Constructed only by a future, separately-authorised live
/// preflight; never in this phase and never in tests, so it is dead code by design.
pub(crate) struct WindowsElevationSource;

impl ElevationTokenSource for WindowsElevationSource {
    type Guard = std::os::windows::io::OwnedHandle;

    fn open(&self) -> TokenOpen<Self::Guard> {
        use projectos_windows_runtime_primitives::handles;
        use windows::core::HRESULT;
        use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, HANDLE};
        use windows::Win32::Security::TOKEN_QUERY;
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        // SAFETY: `GetCurrentProcess` returns a pseudo-handle valid for the calling process; it is a
        // constant, is never adopted and must never be closed. It is only passed to OpenProcessToken.
        let process = unsafe { GetCurrentProcess() };

        let mut raw = HANDLE::default();
        // SAFETY: `process` is the current-process pseudo-handle, `raw` is a valid writable slot, and
        // TOKEN_QUERY is the only right requested. On success the handle is immediately adopted for
        // RAII closure; on failure it is left untouched.
        let opened = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) };
        if let Err(err) = opened {
            // The raw error is inspected ONLY here, transiently, to decide whether the failure was
            // access-denied. Its code is compared and then dropped: it is never stored, returned,
            // rendered or logged, and never enters `ElevationObservation`. The shared classifier maps
            // the boolean to the closed outcome, so access-denied reaches `TokenOpenDenied` and every
            // other failure reaches `TokenQueryUnavailable`.
            let access_denied = err.code() == HRESULT::from_win32(ERROR_ACCESS_DENIED.0);
            return classify_open_failure(access_denied);
        }
        // SAFETY: `raw` was returned by a SUCCESSFUL OpenProcessToken, so it is an owned token handle
        // with no other owner; `adopt` transfers it to an OwnedHandle that closes it exactly once.
        match unsafe { handles::adopt(raw) } {
            Some(owned) => TokenOpen::Opened(owned),
            None => TokenOpen::Unavailable,
        }
    }

    fn read(&self, guard: &Self::Guard) -> RawElevation {
        use core::ffi::c_void;
        use core::mem::size_of;
        use projectos_windows_runtime_primitives::handles;
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TokenElevationType, TokenElevationTypeDefault,
            TokenElevationTypeFull, TokenElevationTypeLimited, TOKEN_ELEVATION,
            TOKEN_ELEVATION_TYPE,
        };

        let token = handles::win32(guard);

        // TokenElevation — the authorising read.
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len: u32 = 0;
        // SAFETY: `token` is a live TOKEN_QUERY token borrowed from `guard` for this call only; the
        // buffer is exactly one TOKEN_ELEVATION and `ret_len` is a valid writable slot.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut TOKEN_ELEVATION as *mut c_void),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            )
        };
        if ok.is_err() {
            return RawElevation::Unavailable;
        }
        if ret_len as usize != size_of::<TOKEN_ELEVATION>() {
            return RawElevation::Malformed;
        }
        let is_elevated = elevation.TokenIsElevated != 0;

        // TokenElevationType — non-authorising, used only for classification and consistency.
        let mut etype = TOKEN_ELEVATION_TYPE::default();
        let mut type_len: u32 = 0;
        // SAFETY: same live token; the buffer is exactly one TOKEN_ELEVATION_TYPE and `type_len` is a
        // valid writable slot.
        let type_ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevationType,
                Some(&mut etype as *mut TOKEN_ELEVATION_TYPE as *mut c_void),
                size_of::<TOKEN_ELEVATION_TYPE>() as u32,
                &mut type_len,
            )
        };
        if type_ok.is_err() {
            return RawElevation::TypeUnavailable { is_elevated };
        }
        if type_len as usize != size_of::<TOKEN_ELEVATION_TYPE>() {
            return RawElevation::Malformed;
        }
        // Compare by discriminant value, not by const-pattern, to avoid depending on structural-eq of
        // the Windows newtype.
        let kind = if etype.0 == TokenElevationTypeFull.0 {
            RawElevationType::Full
        } else if etype.0 == TokenElevationTypeLimited.0 {
            RawElevationType::Limited
        } else if etype.0 == TokenElevationTypeDefault.0 {
            RawElevationType::Default
        } else {
            RawElevationType::Unknown
        };

        RawElevation::Reading { is_elevated, kind }
    }
}

// ---------------------------------------------------------------------------------------------
// SYNTHETIC BEHAVIOURAL TESTS — scripted backend only; no real Windows call, no real HANDLE.
// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    /// A guard that counts its own drops, proving the engine releases the token exactly once.
    struct CountingGuard<'a> {
        drops: &'a Cell<u32>,
    }
    impl Drop for CountingGuard<'_> {
        fn drop(&mut self) {
            self.drops.set(self.drops.get() + 1);
        }
    }

    /// What the scripted `open` should model. `Fail { access_denied }` routes through the SAME
    /// `classify_open_failure` the real backend calls, so the test proves the real decision rather than
    /// a disconnected copy.
    enum OpenScript {
        Open,
        Fail { access_denied: bool },
        Unsupported,
    }

    /// A fully scripted, effect-free backend. It creates a drop-counting guard on open and returns a
    /// scripted raw reading on read — never touching Windows.
    struct Scripted<'a> {
        open: OpenScript,
        raw: fn() -> RawElevation,
        drops: &'a Cell<u32>,
    }

    impl<'a> ElevationTokenSource for Scripted<'a> {
        type Guard = CountingGuard<'a>;
        fn open(&self) -> TokenOpen<Self::Guard> {
            match self.open {
                OpenScript::Open => TokenOpen::Opened(CountingGuard { drops: self.drops }),
                // Exactly the real backend's failure path: the access-denied boolean through the shared
                // classifier — no separate test-only mapping.
                OpenScript::Fail { access_denied } => classify_open_failure(access_denied),
                OpenScript::Unsupported => TokenOpen::Unsupported,
            }
        }
        fn read(&self, _guard: &Self::Guard) -> RawElevation {
            (self.raw)()
        }
    }

    fn observe_reading(raw: fn() -> RawElevation) -> (ElevationObservation, u32) {
        let drops = Cell::new(0);
        let source = Scripted {
            open: OpenScript::Open,
            raw,
            drops: &drops,
        };
        let obs = observe(&source);
        (obs, drops.get())
    }

    // ---- classification (§8) ----

    #[test]
    fn elevated_full_is_elevated() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: true,
            kind: RawElevationType::Full,
        });
        assert!(obs == ElevationObservation::Elevated);
        assert!(obs.is_positive());
    }

    #[test]
    fn elevated_default_is_elevated() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: true,
            kind: RawElevationType::Default,
        });
        assert!(obs == ElevationObservation::Elevated);
    }

    #[test]
    fn not_elevated_limited_is_limited() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: false,
            kind: RawElevationType::Limited,
        });
        assert!(obs == ElevationObservation::NotElevatedLimitedToken);
        assert!(!obs.is_positive());
    }

    #[test]
    fn not_elevated_default_is_default() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: false,
            kind: RawElevationType::Default,
        });
        assert!(obs == ElevationObservation::NotElevatedDefaultToken);
    }

    #[test]
    fn elevated_limited_is_malformed() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: true,
            kind: RawElevationType::Limited,
        });
        assert!(obs == ElevationObservation::MalformedResult);
    }

    #[test]
    fn not_elevated_full_is_malformed() {
        let (obs, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: false,
            kind: RawElevationType::Full,
        });
        assert!(obs == ElevationObservation::MalformedResult);
    }

    #[test]
    fn unknown_type_is_malformed() {
        let (obs_pos, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: true,
            kind: RawElevationType::Unknown,
        });
        let (obs_neg, _) = observe_reading(|| RawElevation::Reading {
            is_elevated: false,
            kind: RawElevationType::Unknown,
        });
        assert!(obs_pos == ElevationObservation::MalformedResult);
        assert!(obs_neg == ElevationObservation::MalformedResult);
    }

    #[test]
    fn malformed_reading_is_malformed() {
        let (obs, _) = observe_reading(|| RawElevation::Malformed);
        assert!(obs == ElevationObservation::MalformedResult);
    }

    #[test]
    fn elevation_read_failure_is_unavailable() {
        let (obs, _) = observe_reading(|| RawElevation::Unavailable);
        assert!(obs == ElevationObservation::TokenQueryUnavailable);
    }

    #[test]
    fn type_unavailable_never_widens_to_positive() {
        // Even with the elevation bit set, an unreadable type must fail closed — NOT Elevated.
        let (obs_elev, _) = observe_reading(|| RawElevation::TypeUnavailable { is_elevated: true });
        let (obs_not, _) = observe_reading(|| RawElevation::TypeUnavailable { is_elevated: false });
        assert!(obs_elev == ElevationObservation::TokenQueryUnavailable);
        assert!(!obs_elev.is_positive());
        assert!(obs_not == ElevationObservation::TokenQueryUnavailable);
    }

    // ---- open outcomes (§13.9, §13.10, §13.13) ----

    #[test]
    fn access_denied_open_maps_to_token_open_denied() {
        // Access-denied is the ONLY open failure that reaches TokenOpenDenied. It flows through
        // classify_open_failure(true) — the exact function the real Windows backend calls.
        let drops = Cell::new(0);
        let source = Scripted {
            open: OpenScript::Fail {
                access_denied: true,
            },
            raw: || RawElevation::Malformed,
            drops: &drops,
        };
        assert!(observe(&source) == ElevationObservation::TokenOpenDenied);
        // No token was opened, so no guard was created and nothing was dropped.
        assert_eq!(drops.get(), 0);
    }

    #[test]
    fn non_access_denied_open_maps_to_unavailable() {
        // Every other open failure — classify_open_failure(false) — reaches TokenQueryUnavailable, and
        // never collapses a denial into it or widens either into a positive.
        let drops = Cell::new(0);
        let source = Scripted {
            open: OpenScript::Fail {
                access_denied: false,
            },
            raw: || RawElevation::Malformed,
            drops: &drops,
        };
        assert!(observe(&source) == ElevationObservation::TokenQueryUnavailable);
        assert_eq!(drops.get(), 0);
    }

    #[test]
    fn open_classifier_separates_denied_from_unavailable() {
        // Directly pin the shared classifier both branches use, so a collapse of one into the other is
        // caught at the decision itself, not only through observe().
        assert!(matches!(
            classify_open_failure::<CountingGuard<'_>>(true),
            TokenOpen::Denied
        ));
        assert!(matches!(
            classify_open_failure::<CountingGuard<'_>>(false),
            TokenOpen::Unavailable
        ));
    }

    #[test]
    fn unsupported_backend_maps_through() {
        let drops = Cell::new(0);
        let source = Scripted {
            open: OpenScript::Unsupported,
            raw: || RawElevation::Malformed,
            drops: &drops,
        };
        assert!(observe(&source) == ElevationObservation::UnsupportedPlatform);
        assert_eq!(drops.get(), 0);
    }

    // ---- drop-count: the token is released exactly once on every opened branch (§13.14–17) ----

    #[test]
    fn token_released_exactly_once_on_every_opened_outcome() {
        let readings: [fn() -> RawElevation; 4] = [
            || RawElevation::Reading {
                is_elevated: true,
                kind: RawElevationType::Full,
            },
            || RawElevation::Reading {
                is_elevated: false,
                kind: RawElevationType::Default,
            },
            || RawElevation::Unavailable,
            || RawElevation::Malformed,
        ];
        for raw in readings {
            let (_obs, drops) = observe_reading(raw);
            assert_eq!(drops, 1, "token must be released exactly once");
        }
    }

    // ---- redaction (§13.18) ----

    #[test]
    fn observation_debug_carries_no_identity() {
        for raw in [
            || RawElevation::Reading {
                is_elevated: true,
                kind: RawElevationType::Full,
            },
            || RawElevation::Unavailable,
        ] as [fn() -> RawElevation; 2]
        {
            let (obs, _) = observe_reading(raw);
            let rendered = format!("{obs:?}");
            assert_eq!(rendered, "ElevationObservation([REDACTED])");
            assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        }
    }

    #[test]
    fn engine_marker() {
        // Printed under --nocapture as the synthetic-contract positive marker. Proves ONLY synthetic
        // decision and cleanup behaviour — never a live Windows observation.
        println!("ELEVATION_OBSERVATION_ENGINE_OK");
    }
}

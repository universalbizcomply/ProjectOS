//! THE TYPED EFFECT GRANTS (MODEL 2 issuance).
//!
//! One owner decision yields one [`AuthorisedProofAttemptGrant`], which splits — exactly once, and
//! atomically — into three DIFFERENTLY TYPED single-use grants. Distinct types matter: an
//! [`ScmEffectGrant`] can never be passed where an [`IpcEffectGrant`] is required, so cross-capability
//! substitution is a compile error rather than a runtime check.
//!
//! No grant is itself a capability. A grant records that an authorisation was composed; converting one
//! into a live capability is a LATER, separately-authorised phase. Nothing here performs, enables or
//! implies a machine effect.
//!
//! Every type is opaque, non-`Clone`, non-`Copy`, non-`Default`, non-serialisable, redacted in `Debug`,
//! thread-bound and non-persistable, and each is consumed on use. There is no reusable session and no
//! broker: once split, the attempt grant is gone.

use core::fmt;
use core::marker::PhantomData;

use crate::effect_witness::EffectContextBinding;

/// See the note in `effect_witness`: a raw pointer makes the containing type `!Send + !Sync` on stable.
type ThreadBound = PhantomData<*const ()>;

/// The single authorised proof attempt.
///
/// Obtainable ONLY by consuming a `VerifiedEffectAuthorisationTransition`, which itself requires four
/// unforgeable witnesses. It is not a capability and grants no effect by itself.
pub struct AuthorisedProofAttemptGrant {
    binding: EffectContextBinding,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for AuthorisedProofAttemptGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AuthorisedProofAttemptGrant([REDACTED])")
    }
}

impl AuthorisedProofAttemptGrant {
    /// CRATE-PRIVATE. The only construction path, reached solely from a successful composition, so no
    /// dependent can mint an attempt grant.
    pub(crate) fn from_composed_witnesses(binding: EffectContextBinding) -> Self {
        Self {
            binding,
            _thread_bound: PhantomData,
        }
    }

    /// Split into exactly three typed single-use grants, CONSUMING the attempt.
    ///
    /// Atomic by construction: it returns all three or the attempt is gone. There is no method that
    /// issues one grant and retains the ability to issue the others later, and none that reissues a
    /// consumed grant — the borrow checker enforces both, because `self` is moved.
    #[must_use]
    pub fn into_typed_grants(
        self,
    ) -> (
        ScmEffectGrant,
        IpcEffectGrant,
        InstanceObservationEffectGrant,
    ) {
        let binding = self.binding;
        (
            ScmEffectGrant {
                binding,
                _thread_bound: PhantomData,
            },
            IpcEffectGrant {
                binding,
                _thread_bound: PhantomData,
            },
            InstanceObservationEffectGrant {
                binding,
                _thread_bound: PhantomData,
            },
        )
    }
}

/// Declare one typed, single-use, opaque effect grant.
macro_rules! typed_effect_grant {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        pub struct $name {
            binding: EffectContextBinding,
            _thread_bound: ThreadBound,
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "([REDACTED])"))
            }
        }

        impl $name {
            /// Whether this grant shares an effect context with another grant. Equality only: no
            /// discriminator is readable, so this cannot be used to learn the context.
            #[must_use]
            pub fn shares_context_with_scm(&self, other: &ScmEffectGrant) -> bool {
                self.binding.matches(&other.binding)
            }

            /// The private binding, for a future capability producer inside this crate. Never public.
            #[allow(dead_code)]
            pub(crate) fn binding(&self) -> &EffectContextBinding {
                &self.binding
            }
        }
    };
}

typed_effect_grant!(
    /// Authorises ONE bounded SCM effect. Consumed by a future capability producer; today nothing can
    /// consume it, so it enables nothing.
    ScmEffectGrant
);

typed_effect_grant!(
    /// Authorises ONE bounded local-IPC effect.
    IpcEffectGrant
);

typed_effect_grant!(
    /// Authorises ONE bounded process-instance observation.
    InstanceObservationEffectGrant
);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effect_witness::{
        compose_verified_authorisation, synthetic_witnesses, SyntheticEffectContext,
    };

    fn attempt_grant() -> AuthorisedProofAttemptGrant {
        let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());
        compose_verified_authorisation(o, e, r, x)
            .into_authorised_attempt_grant()
            .expect("valid witnesses compose")
    }

    #[test]
    fn one_attempt_splits_into_exactly_three_typed_grants() {
        let (scm, ipc, obs) = attempt_grant().into_typed_grants();
        // All three describe the SAME effect context.
        assert!(ipc.shares_context_with_scm(&scm));
        assert!(obs.shares_context_with_scm(&scm));
        assert!(scm.shares_context_with_scm(&scm));
    }

    #[test]
    fn grants_from_different_attempts_do_not_share_a_context() {
        let (scm_a, _, _) = attempt_grant().into_typed_grants();
        let (o, e, r, x) =
            synthetic_witnesses(SyntheticEffectContext::valid().with_proof_attempt(2));
        let (_, ipc_b, _) = compose_verified_authorisation(o, e, r, x)
            .into_authorised_attempt_grant()
            .expect("second attempt composes")
            .into_typed_grants();
        assert!(!ipc_b.shares_context_with_scm(&scm_a));
    }

    #[test]
    fn grant_debug_is_redacted() {
        let (scm, ipc, obs) = attempt_grant().into_typed_grants();
        assert_eq!(format!("{scm:?}"), "ScmEffectGrant([REDACTED])");
        assert_eq!(format!("{ipc:?}"), "IpcEffectGrant([REDACTED])");
        assert_eq!(
            format!("{obs:?}"),
            "InstanceObservationEffectGrant([REDACTED])"
        );
        assert_eq!(
            format!("{:?}", attempt_grant()),
            "AuthorisedProofAttemptGrant([REDACTED])"
        );
    }

    #[test]
    fn grant_output_carries_no_identity() {
        for rendered in [
            format!("{:?}", attempt_grant()),
            format!("{:?}", attempt_grant().into_typed_grants().0),
        ] {
            assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        }
    }
}

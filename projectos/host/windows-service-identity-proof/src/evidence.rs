//! The redacted evidence types. No type here can carry a raw identity value.

use projectos_host_authority::{AuthorityHandoverState, AuthorityPeerState, AuthorityTokenOutcome};

/// The one canonical tri-state used for every redacted comparison / presence fact. Never a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tristate {
    /// The fact is positively established.
    True,
    /// The fact is positively negated.
    False,
    /// The fact could not be established either way.
    Indeterminate,
}

impl Tristate {
    /// Whether the fact is positively established.
    #[must_use]
    pub fn is_true(self) -> bool {
        matches!(self, Self::True)
    }

    /// Whether the fact is positively negated.
    #[must_use]
    pub fn is_false(self) -> bool {
        matches!(self, Self::False)
    }
}

/// A NON-AUTHORISING integrity-level observation.
///
/// Wrapped in its own type precisely so it can never be confused with an authorising fact: the
/// classification logic never reads it as a required positive fact, so `SameIntegrityLevel = True`
/// cannot compensate for missing identity evidence and `= False` cannot invalidate otherwise-valid
/// identity evidence. No concrete integrity value (System/High/Medium) is representable — only a
/// redacted comparison tri-state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonAuthorisingIntegrity {
    observed: Tristate,
}

impl NonAuthorisingIntegrity {
    /// Construct a non-authorising integrity observation from a redacted comparison tri-state.
    #[must_use]
    pub fn observed(value: Tristate) -> Self {
        Self { observed: value }
    }

    /// The redacted observation. Informational ONLY — it never contributes to confirmation.
    #[must_use]
    pub fn value(self) -> Tristate {
        self.observed
    }
}

/// A corroboration-channel signal (typed IPC peer, or SCM). Distinct from the corroborated CONCLUSION
/// ([`AuthorityPeerState`]): this is the raw availability/validity of the channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corroboration {
    /// The channel corroborated the expected role.
    Valid,
    /// The channel actively contradicted the expected role.
    Invalid,
    /// The channel could not be reached / read.
    Unavailable,
}

/// Residue evidence after a proof run: whether every test object / process disappeared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResidueEvidence {
    /// No residue remains.
    Zero,
    /// Residue remains — fail closed.
    NonZero,
    /// Residue could not be determined — fail closed.
    Indeterminate,
}

/// The accepted service-SID-TYPE design baseline. There is no existing canonical service-SID-TYPE enum
/// in the repository, so this names ONLY the accepted baseline (3K-I-D-E-A). It is a design input, not
/// an observed configuration and not an owner approval; `#[non_exhaustive]` leaves room for a governed
/// future extension without implying any other type is authorised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceSidTypeBaseline {
    /// `SERVICE_SID_TYPE_UNRESTRICTED` — the accepted baseline.
    Unrestricted,
}

/// A bounded, fully-redacted service-identity evidence record.
///
/// Every field is a tri-state or a closed enum. There is deliberately NO field of type `String`,
/// `OsString`, `PathBuf`, `Vec<u8>`, byte array, map or free text, so no username, service-account
/// name, machine name, SID (string or bytes), token/session/logon identifier, credential, ACL or
/// diagnostic string can ever be attached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceIdentityEvidence {
    /// Redacted comparison: the observed account equals the interactive user's account. Reported only;
    /// not a required positive fact (a service SHOULD differ).
    pub same_account: Tristate,
    /// Redacted comparison: the observed logon session equals the interactive user's session. Reported
    /// only; not a required positive fact.
    pub same_session: Tristate,
    /// NON-AUTHORISING integrity observation. Never contributes to confirmation.
    pub same_integrity_level: NonAuthorisingIntegrity,
    /// The service process token's USER entry corresponds to the configured ProjectOSHost virtual
    /// service account. Required positive fact.
    pub configured_virtual_account_is_token_user: Tristate,
    /// The expected per-service SID is present in the service process token's GROUP entries. Required
    /// positive fact — SEPARATE from token-user identity.
    pub expected_service_sid_present_in_token_groups: Tristate,
    /// The observed service-SID-TYPE configuration corresponds to the accepted design baseline.
    /// Required positive fact — SEPARATE from SID presence.
    pub expected_service_sid_type_present: Tristate,
    /// The raw authority create-or-open outcome (canonical, no-trust). `ExistingToken` is never trusted
    /// ownership.
    pub token_outcome: AuthorityTokenOutcome,
    /// The corroborated peer conclusion (canonical). A live service proof requires
    /// `ServiceRuntimeConfirmed`.
    pub peer_state: AuthorityPeerState,
    /// The typed-IPC peer corroboration channel signal. Required `Valid`.
    pub peer_corroboration: Corroboration,
    /// The SCM corroboration channel signal. Required `Valid`.
    pub scm_corroboration: Corroboration,
    /// The authority-handover state (canonical). Release-before-acquire is evidenced only by the
    /// terminal `ServiceReady`.
    pub handover: AuthorityHandoverState,
    /// The post-run residue evidence. Required `Zero`.
    pub residue: ResidueEvidence,
}

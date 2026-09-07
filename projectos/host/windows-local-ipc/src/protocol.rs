//! The CLOSED, bounded, fixed binary wire protocol for the ProjectOSHost service-identity proof channel
//! (3K-I-D-E-C-CAPABILITY-B3). No JSON/CBOR/MessagePack, no arbitrary maps, no free-form metadata, no
//! unbounded payload, no public `Vec<u8>` body, no general RPC routing. Every frame is a fixed header +
//! a CLOSED typed payload; unknown versions, unknown kinds, malformed/truncated/oversized frames and
//! trailing bytes all fail closed. No raw identity or diagnostic text can be represented.

/// Fixed frame magic (`POS1`). A frame whose first four bytes differ is not our protocol.
pub const FRAME_MAGIC: [u8; 4] = *b"POS1";

/// The ONLY accepted wire protocol version (matches the accepted `contracts::PROTOCOL_V1`). There is no
/// downgrade: any other version value fails closed.
pub const WIRE_PROTOCOL_VERSION: u16 = 1;

/// The fixed-size protocol nonce length, in bytes.
pub const NONCE_LEN: usize = 32;

/// A conservative maximum total frame size. The parser NEVER allocates based on an untrusted length;
/// it rejects any header claiming a payload beyond this bound before reading further.
pub const MAX_FRAME_SIZE: usize = 512;

/// Header layout: magic(4) + version(2, big-endian) + kind(1) + nonce(32) + payload_len(2, big-endian).
pub(crate) const HEADER_LEN: usize = 4 + 2 + 1 + NONCE_LEN + 2;

/// The maximum closed payload length (kept well within [`MAX_FRAME_SIZE`]).
const MAX_PAYLOAD_LEN: usize = MAX_FRAME_SIZE - HEADER_LEN;

/// A fixed-size, single-use protocol nonce. Its bytes are never rendered (`Debug`/`Display` redacted),
/// never serialised to an arbitrary-length form, and never accepted from an arbitrary PUBLIC byte
/// vector — only equality comparison and single-use lifecycle matter. It is NOT a long-term credential.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Nonce([u8; NONCE_LEN]);

impl Nonce {
    /// CRATE-PRIVATE fixed-bytes constructor. A trusted boundary (a later phase, or a deterministic
    /// unit test) supplies the bytes; there is no public arbitrary-bytes constructor.
    pub(crate) fn from_fixed_bytes(bytes: [u8; NONCE_LEN]) -> Self {
        Self(bytes)
    }

    /// The fixed byte length. The value itself is never exposed.
    #[must_use]
    pub fn len(&self) -> usize {
        NONCE_LEN
    }

    /// A nonce is never empty (fixed length).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        false
    }
}

impl core::fmt::Debug for Nonce {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("Nonce(<redacted>)")
    }
}

/// The CLOSED set of proof-protocol message kinds. There is no general command or extension kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum MessageKind {
    /// Controller → service: opening hello.
    ControllerHello,
    /// Service → controller: the service reports ready.
    ServiceReady,
    /// Service → controller: redacted service-identity evidence.
    ServiceEvidence,
    /// Service → controller: the authority outcome.
    AuthorityOutcome,
    /// Controller → service: request shutdown.
    ShutdownRequest,
    /// Service → controller: shutdown acknowledged.
    ShutdownAcknowledged,
    /// Either side: a typed refusal.
    TypedRefusal,
    /// Controller → service: a PROTECTED-OPERATION request (PROJECTOSHOST-IPC-OPERATION-CONTRACT1A).
    ///
    /// A separate versioned family, deliberately NOT an overload of `InstalledHostStatus`, whose
    /// contract is fixed and which has no request kind by design. Its payload is a closed fixed-width
    /// record of bounded identifiers and digests: no string, no byte vector, no map and no secret is
    /// representable in it.
    ProtectedOperationRequest,
    /// Service → controller: the PROTECTED-OPERATION response.
    ProtectedOperationResponse,
    /// Service → controller: the READ-ONLY installed-host status record.
    ///
    /// The single response added by CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A. There is deliberately no
    /// matching REQUEST kind: `ControllerHello` is the request, so this adds one frame, not a
    /// request/response protocol.
    InstalledHostStatus,
}

impl MessageKind {
    /// The fixed wire discriminant.
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::ControllerHello => 1,
            Self::ServiceReady => 2,
            Self::ServiceEvidence => 3,
            Self::AuthorityOutcome => 4,
            Self::ShutdownRequest => 5,
            Self::ShutdownAcknowledged => 6,
            Self::TypedRefusal => 7,
            Self::InstalledHostStatus => 8,
            Self::ProtectedOperationRequest => 9,
            Self::ProtectedOperationResponse => 10,
        }
    }

    /// Decode a wire discriminant. An unknown value fails closed (`None`).
    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::ControllerHello,
            2 => Self::ServiceReady,
            3 => Self::ServiceEvidence,
            4 => Self::AuthorityOutcome,
            5 => Self::ShutdownRequest,
            6 => Self::ShutdownAcknowledged,
            7 => Self::TypedRefusal,
            8 => Self::InstalledHostStatus,
            9 => Self::ProtectedOperationRequest,
            10 => Self::ProtectedOperationResponse,
            _ => return None,
        })
    }
}

/// The closed reasons a frame fails to parse. Fieldless — no offset, byte, name or diagnostic text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FrameParseError {
    /// The magic did not match.
    BadMagic,
    /// The header was shorter than required.
    TruncatedHeader,
    /// The protocol version was not the accepted one (no downgrade is permitted).
    UnknownVersion,
    /// The message-kind discriminant was not a known kind.
    UnknownMessageKind,
    /// The declared payload length exceeds the bound.
    OversizedPayload,
    /// The buffer was shorter than the declared payload.
    TruncatedPayload,
    /// Bytes remained after the declared payload (concatenated/trailing data).
    TrailingData,
    /// The payload length did not match what the message kind requires.
    PayloadLengthMismatch,
    /// A closed enum byte in the status record was not a known value.
    UnknownStatusEnum,
    /// A build or manifest prefix was not exactly lower-case hexadecimal.
    MalformedPrefix,
    /// A decoder was handed a frame of the wrong message kind.
    UnexpectedMessageKind,
}

/// A parsed frame HEADER with its (bounded, closed) payload byte span validated. The payload bytes are
/// NEVER exposed publicly as an arbitrary slice; only the closed metadata is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    kind: MessageKind,
    payload_len: usize,
    control_flag: u8,
}

impl FrameHeader {
    /// The message kind.
    #[must_use]
    pub fn kind(self) -> MessageKind {
        self.kind
    }

    /// The validated payload length.
    #[must_use]
    pub fn payload_len(self) -> usize {
        self.payload_len
    }

    /// The single CLOSED control byte carried by a handshake/control frame — the peer-role discriminant.
    /// It is a small closed enum discriminant, never arbitrary data.
    #[must_use]
    pub fn control_flag(self) -> u8 {
        self.control_flag
    }
}

/// Parse and validate exactly ONE frame from `buf`, returning its header + nonce. Fails closed on every
/// malformation and REQUIRES the buffer to contain exactly one frame (no trailing bytes). It never
/// allocates from an untrusted length: the payload bound is checked against the header first.
pub fn parse_single_frame(buf: &[u8]) -> Result<(FrameHeader, Nonce), FrameParseError> {
    if buf.len() < HEADER_LEN {
        return Err(FrameParseError::TruncatedHeader);
    }
    if buf[0..4] != FRAME_MAGIC {
        return Err(FrameParseError::BadMagic);
    }
    if u16::from_be_bytes([buf[4], buf[5]]) != WIRE_PROTOCOL_VERSION {
        return Err(FrameParseError::UnknownVersion);
    }
    let kind = MessageKind::from_discriminant(buf[6]).ok_or(FrameParseError::UnknownMessageKind)?;
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&buf[7..7 + NONCE_LEN]);
    let len_off = 7 + NONCE_LEN;
    let payload_len = u16::from_be_bytes([buf[len_off], buf[len_off + 1]]) as usize;
    if payload_len > MAX_PAYLOAD_LEN {
        return Err(FrameParseError::OversizedPayload);
    }
    let total = HEADER_LEN + payload_len;
    if buf.len() < total {
        return Err(FrameParseError::TruncatedPayload);
    }
    if buf.len() > total {
        return Err(FrameParseError::TrailingData);
    }
    if payload_len != required_payload_len(kind) {
        return Err(FrameParseError::PayloadLengthMismatch);
    }
    // The first payload byte of a control/handshake frame is the closed peer-role discriminant.
    let control_flag = if payload_len > 0 { buf[HEADER_LEN] } else { 0 };
    Ok((
        FrameHeader {
            kind,
            payload_len,
            control_flag,
        },
        Nonce::from_fixed_bytes(nonce),
    ))
}

/// The exact closed payload length each message kind requires. Every kind has a fixed, bounded payload
/// (a small closed record); none is variable-length or free-form.
fn required_payload_len(kind: MessageKind) -> usize {
    match kind {
        // Hello / ready / shutdown control frames carry a single closed role/flag byte.
        MessageKind::ControllerHello
        | MessageKind::ServiceReady
        | MessageKind::ShutdownRequest
        | MessageKind::ShutdownAcknowledged => 1,
        // Evidence / authority / refusal carry a small fixed closed record.
        MessageKind::ServiceEvidence => 4,
        MessageKind::AuthorityOutcome => 1,
        MessageKind::TypedRefusal => 1,
        // The one fixed-width closed status record. Every other kind's length is unchanged.
        MessageKind::InstalledHostStatus => INSTALLED_HOST_STATUS_LEN,
        // The protected-operation family. Both are fixed width, so a caller cannot vary the shape of a
        // request to smuggle extra data past the parser.
        MessageKind::ProtectedOperationRequest => PROTECTED_OPERATION_REQUEST_LEN,
        MessageKind::ProtectedOperationResponse => PROTECTED_OPERATION_RESPONSE_LEN,
    }
}

/// The EXACT, only payload length of a [`MessageKind::ProtectedOperationRequest`] frame:
/// correlation(16) + sequence(8) + claimed epoch(8) + binding digest(32) + operation(1) +
/// approval reference(32) + parameter digest(32).
pub const PROTECTED_OPERATION_REQUEST_LEN: usize = 16 + 8 + 8 + 32 + 1 + 32 + 32;

/// The EXACT, only payload length of a [`MessageKind::ProtectedOperationResponse`] frame:
/// correlation(16) + state(1) + reason(1) + result class(1) + service epoch(8) +
/// evidence reference(16) + terminal status(1).
pub const PROTECTED_OPERATION_RESPONSE_LEN: usize = 16 + 1 + 1 + 1 + 8 + 16 + 1;

// Both families must fit the accepted bounded frame. A compile-time check, so a future field cannot
// silently push a frame past the ceiling that the parser refuses to allocate beyond.
const _: () = assert!(PROTECTED_OPERATION_REQUEST_LEN <= MAX_PAYLOAD_LEN);
const _: () = assert!(PROTECTED_OPERATION_RESPONSE_LEN <= MAX_PAYLOAD_LEN);

/// Write the fixed frame header into `out`. Shared by every encoder so the header layout exists once.
pub(crate) fn write_frame_header(
    out: &mut [u8],
    kind: MessageKind,
    nonce: &Nonce,
    payload_len: u16,
) {
    out[0..4].copy_from_slice(&FRAME_MAGIC);
    out[4..6].copy_from_slice(&WIRE_PROTOCOL_VERSION.to_be_bytes());
    out[6] = kind.discriminant();
    out[7..7 + NONCE_LEN].copy_from_slice(&nonce.0);
    let len_off = 7 + NONCE_LEN;
    out[len_off..len_off + 2].copy_from_slice(&payload_len.to_be_bytes());
}

/// Encode a control frame (fixed 1-byte closed payload) into a bounded buffer. Used by the live FFI and
/// tests to produce well-formed frames without any arbitrary byte body.
#[allow(dead_code)] // Used by unit tests and, under `windows-live-ipc`, by the FFI send path.
pub(crate) fn encode_control_frame(
    kind: MessageKind,
    nonce: &Nonce,
    flag: u8,
) -> [u8; HEADER_LEN + 1] {
    let mut out = [0u8; HEADER_LEN + 1];
    out[0..4].copy_from_slice(&FRAME_MAGIC);
    out[4..6].copy_from_slice(&WIRE_PROTOCOL_VERSION.to_be_bytes());
    out[6] = kind.discriminant();
    out[7..7 + NONCE_LEN].copy_from_slice(&nonce.0);
    let len_off = 7 + NONCE_LEN;
    out[len_off..len_off + 2].copy_from_slice(&1u16.to_be_bytes());
    out[HEADER_LEN] = flag;
    out
}

// ---------------------------------------------------------------------------------------------
// THE INSTALLED-HOST STATUS RECORD (CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A)
//
// One fixed-width closed record, and one response kind. Every field is a closed enum byte or a
// fixed-size array of lower-case hexadecimal characters. There is deliberately no string, map, JSON,
// raw installation id, filesystem path, secret, token, handle or capability in it, and no generic
// payload accessor is added anywhere.
// ---------------------------------------------------------------------------------------------

/// The ONE frozen run identifier for the installed-host status endpoint.
///
/// Both ends derive everything from it: the pipe name is the fixed endpoint prefix plus its hex, and
/// the single-use handshake nonce is derived from the same bytes. Freezing it here is what lets the
/// installed service and the Control Centre meet on ONE pipe with ONE nonce without either side
/// inventing, transmitting or configuring a name. It is not a secret and carries no authority: it
/// names an endpoint, it does not grant access to it.
pub const INSTALLED_HOST_STATUS_RUN_ID: [u8; 8] = [0x50, 0x4f, 0x53, 0x48, 0x53, 0x54, 0x41, 0x54];

/// The length of a build / manifest digest PREFIX carried in the record, in hex characters.
pub const STATUS_PREFIX_LEN: usize = 8;

/// The exact, only payload length of an [`MessageKind::InstalledHostStatus`] frame.
pub const INSTALLED_HOST_STATUS_LEN: usize = 5 + STATUS_PREFIX_LEN + STATUS_PREFIX_LEN;

/// The service run state, as the service itself reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStateReport {
    Running,
    StartPending,
    StopPending,
    Stopped,
    Unavailable,
}

/// Whether the canonical installed identity verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityVerificationReport {
    Verified,
    Refused,
    Unavailable,
}

/// The installation channel. `Unknown` is representable so nothing has to invent one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelReport {
    Stable,
    Preview,
    Development,
    Unknown,
}

/// How ready the host is to serve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadinessReport {
    Ready,
    Degraded,
    NotReady,
}

/// Whether protected operations are authorised. `Refused` is the only value this phase produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectedOperationsReport {
    Refused,
    Authorised,
}

/// Give a closed enum a fixed wire discriminant and a fail-closed decoder.
macro_rules! closed_enum_byte {
    ($t:ty, $( $variant:ident => $value:literal ),+ $(,)?) => {
        impl $t {
            /// The fixed wire discriminant.
            #[must_use]
            pub fn discriminant(self) -> u8 {
                match self { $( Self::$variant => $value ),+ }
            }
            /// Decode a wire discriminant. An unknown value fails closed.
            #[must_use]
            pub fn from_discriminant(value: u8) -> Option<Self> {
                Some(match value { $( $value => Self::$variant, )+ _ => return None })
            }
        }
    };
}

closed_enum_byte!(ServiceStateReport,
    Running => 1, StartPending => 2, StopPending => 3, Stopped => 4, Unavailable => 5);
closed_enum_byte!(IdentityVerificationReport, Verified => 1, Refused => 2, Unavailable => 3);
closed_enum_byte!(ChannelReport, Stable => 1, Preview => 2, Development => 3, Unknown => 4);
closed_enum_byte!(ReadinessReport, Ready => 1, Degraded => 2, NotReady => 3);
closed_enum_byte!(ProtectedOperationsReport, Refused => 1, Authorised => 2);

/// The closed installed-host status record.
///
/// Private fields with read-only accessors: there is no public payload accessor and no route to the
/// raw bytes. Construction validates both prefixes, so a malformed record cannot exist at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstalledHostStatus {
    service_state: ServiceStateReport,
    identity: IdentityVerificationReport,
    channel: ChannelReport,
    readiness: ReadinessReport,
    protected_operations: ProtectedOperationsReport,
    build_prefix: [u8; STATUS_PREFIX_LEN],
    manifest_prefix: [u8; STATUS_PREFIX_LEN],
}

/// Whether every byte is a lower-case hexadecimal character.
fn is_lower_hex_prefix(bytes: &[u8; STATUS_PREFIX_LEN]) -> bool {
    bytes
        .iter()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

impl InstalledHostStatus {
    /// Build a record. Both prefixes must be exactly lower-case hexadecimal.
    ///
    /// # Errors
    /// [`FrameParseError::MalformedPrefix`] if either prefix is not lower-case hex.
    pub fn new(
        service_state: ServiceStateReport,
        identity: IdentityVerificationReport,
        channel: ChannelReport,
        readiness: ReadinessReport,
        protected_operations: ProtectedOperationsReport,
        build_prefix: [u8; STATUS_PREFIX_LEN],
        manifest_prefix: [u8; STATUS_PREFIX_LEN],
    ) -> Result<Self, FrameParseError> {
        if !is_lower_hex_prefix(&build_prefix) || !is_lower_hex_prefix(&manifest_prefix) {
            return Err(FrameParseError::MalformedPrefix);
        }
        Ok(Self {
            service_state,
            identity,
            channel,
            readiness,
            protected_operations,
            build_prefix,
            manifest_prefix,
        })
    }

    #[must_use]
    pub fn service_state(self) -> ServiceStateReport {
        self.service_state
    }
    #[must_use]
    pub fn identity(self) -> IdentityVerificationReport {
        self.identity
    }
    #[must_use]
    pub fn channel(self) -> ChannelReport {
        self.channel
    }
    #[must_use]
    pub fn readiness(self) -> ReadinessReport {
        self.readiness
    }
    #[must_use]
    pub fn protected_operations(self) -> ProtectedOperationsReport {
        self.protected_operations
    }
    /// The build identity PREFIX. A prefix only — never a full digest or identifier.
    #[must_use]
    pub fn build_prefix(&self) -> &[u8; STATUS_PREFIX_LEN] {
        &self.build_prefix
    }
    /// The release-manifest digest PREFIX. A prefix only.
    #[must_use]
    pub fn manifest_prefix(&self) -> &[u8; STATUS_PREFIX_LEN] {
        &self.manifest_prefix
    }
}

/// Encode ONE status frame. Canonical: the same record always yields the same bytes.
#[must_use]
pub fn encode_installed_host_status(
    nonce: &Nonce,
    status: &InstalledHostStatus,
) -> [u8; HEADER_LEN + INSTALLED_HOST_STATUS_LEN] {
    let mut out = [0u8; HEADER_LEN + INSTALLED_HOST_STATUS_LEN];
    out[0..4].copy_from_slice(&FRAME_MAGIC);
    out[4..6].copy_from_slice(&WIRE_PROTOCOL_VERSION.to_be_bytes());
    out[6] = MessageKind::InstalledHostStatus.discriminant();
    out[7..7 + NONCE_LEN].copy_from_slice(&nonce.0);
    let len_off = 7 + NONCE_LEN;
    out[len_off..len_off + 2].copy_from_slice(&(INSTALLED_HOST_STATUS_LEN as u16).to_be_bytes());
    let p = HEADER_LEN;
    out[p] = status.service_state.discriminant();
    out[p + 1] = status.identity.discriminant();
    out[p + 2] = status.channel.discriminant();
    out[p + 3] = status.readiness.discriminant();
    out[p + 4] = status.protected_operations.discriminant();
    out[p + 5..p + 5 + STATUS_PREFIX_LEN].copy_from_slice(&status.build_prefix);
    out[p + 5 + STATUS_PREFIX_LEN..].copy_from_slice(&status.manifest_prefix);
    out
}

/// STRICTLY decode one status frame.
///
/// Refuses, in order: a malformed, oversized or truncated frame and trailing bytes (via
/// [`parse_single_frame`], which also rejects an unsupported version and a payload-length mismatch); a
/// frame that is not this kind; an unknown closed-enum byte; and a prefix that is not lower-case hex.
///
/// # Errors
/// [`FrameParseError`] naming the first failure.
pub fn decode_installed_host_status(
    buf: &[u8],
) -> Result<(InstalledHostStatus, Nonce), FrameParseError> {
    let (header, nonce) = parse_single_frame(buf)?;
    if header.kind() != MessageKind::InstalledHostStatus {
        return Err(FrameParseError::UnexpectedMessageKind);
    }
    let p = HEADER_LEN;
    let service_state =
        ServiceStateReport::from_discriminant(buf[p]).ok_or(FrameParseError::UnknownStatusEnum)?;
    let identity = IdentityVerificationReport::from_discriminant(buf[p + 1])
        .ok_or(FrameParseError::UnknownStatusEnum)?;
    let channel =
        ChannelReport::from_discriminant(buf[p + 2]).ok_or(FrameParseError::UnknownStatusEnum)?;
    let readiness =
        ReadinessReport::from_discriminant(buf[p + 3]).ok_or(FrameParseError::UnknownStatusEnum)?;
    let protected_operations = ProtectedOperationsReport::from_discriminant(buf[p + 4])
        .ok_or(FrameParseError::UnknownStatusEnum)?;
    let mut build_prefix = [0u8; STATUS_PREFIX_LEN];
    build_prefix.copy_from_slice(&buf[p + 5..p + 5 + STATUS_PREFIX_LEN]);
    let mut manifest_prefix = [0u8; STATUS_PREFIX_LEN];
    manifest_prefix.copy_from_slice(&buf[p + 5 + STATUS_PREFIX_LEN..]);
    let status = InstalledHostStatus::new(
        service_state,
        identity,
        channel,
        readiness,
        protected_operations,
        build_prefix,
        manifest_prefix,
    )?;
    Ok((status, nonce))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_nonce() -> Nonce {
        Nonce::from_fixed_bytes([7u8; NONCE_LEN])
    }

    #[test]
    fn message_kinds_round_trip_and_unknown_fails_closed() {
        for k in [
            MessageKind::ControllerHello,
            MessageKind::ServiceReady,
            MessageKind::ServiceEvidence,
            MessageKind::AuthorityOutcome,
            MessageKind::ShutdownRequest,
            MessageKind::ShutdownAcknowledged,
            MessageKind::TypedRefusal,
            MessageKind::InstalledHostStatus,
            MessageKind::ProtectedOperationRequest,
            MessageKind::ProtectedOperationResponse,
        ] {
            assert_eq!(MessageKind::from_discriminant(k.discriminant()), Some(k));
        }
        assert_eq!(MessageKind::from_discriminant(0), None);
        // 8 is InstalledHostStatus; 9 and 10 are the protected-operation family added by
        // PROJECTOSHOST-IPC-OPERATION-CONTRACT1A; 11 is the first unassigned discriminant. The set
        // stays CLOSED: this assertion is what makes a silently added kind fail.
        assert_eq!(MessageKind::from_discriminant(11), None);
        assert_eq!(MessageKind::from_discriminant(255), None);
    }

    #[test]
    fn well_formed_control_frame_parses() {
        let n = test_nonce();
        let f = encode_control_frame(MessageKind::ControllerHello, &n, 0);
        let (hdr, parsed) = parse_single_frame(&f).expect("valid frame");
        assert_eq!(hdr.kind(), MessageKind::ControllerHello);
        assert_eq!(hdr.payload_len(), 1);
        assert_eq!(parsed, n);
    }

    #[test]
    fn bad_magic_is_refused() {
        let n = test_nonce();
        let mut f = encode_control_frame(MessageKind::ServiceReady, &n, 0);
        f[0] = b'X';
        assert_eq!(parse_single_frame(&f), Err(FrameParseError::BadMagic));
    }

    #[test]
    fn unknown_version_is_refused_and_not_downgraded() {
        let n = test_nonce();
        let mut f = encode_control_frame(MessageKind::ServiceReady, &n, 0);
        f[4..6].copy_from_slice(&999u16.to_be_bytes());
        assert_eq!(parse_single_frame(&f), Err(FrameParseError::UnknownVersion));
    }

    #[test]
    fn unknown_message_kind_is_refused() {
        let n = test_nonce();
        let mut f = encode_control_frame(MessageKind::ServiceReady, &n, 0);
        f[6] = 99;
        assert_eq!(
            parse_single_frame(&f),
            Err(FrameParseError::UnknownMessageKind)
        );
    }

    #[test]
    fn truncated_header_and_payload_are_refused() {
        let n = test_nonce();
        let f = encode_control_frame(MessageKind::ServiceReady, &n, 0);
        assert_eq!(
            parse_single_frame(&f[..HEADER_LEN - 1]),
            Err(FrameParseError::TruncatedHeader)
        );
        assert_eq!(
            parse_single_frame(&f[..HEADER_LEN]),
            Err(FrameParseError::TruncatedPayload)
        );
    }

    #[test]
    fn trailing_data_is_refused() {
        let n = test_nonce();
        let f = encode_control_frame(MessageKind::ServiceReady, &n, 0);
        let mut extended = f.to_vec();
        extended.push(0);
        assert_eq!(
            parse_single_frame(&extended),
            Err(FrameParseError::TrailingData)
        );
    }

    #[test]
    fn oversized_declared_payload_is_refused_without_allocation() {
        let n = test_nonce();
        let mut f = encode_control_frame(MessageKind::ServiceReady, &n, 0).to_vec();
        let len_off = 7 + NONCE_LEN;
        f[len_off..len_off + 2].copy_from_slice(&((MAX_PAYLOAD_LEN as u16) + 1).to_be_bytes());
        assert_eq!(
            parse_single_frame(&f),
            Err(FrameParseError::OversizedPayload)
        );
    }

    #[test]
    fn payload_length_mismatch_for_kind_is_refused() {
        // ServiceEvidence requires 4 payload bytes; a 1-byte control encoding mismatches.
        let n = test_nonce();
        let f = encode_control_frame(MessageKind::ServiceEvidence, &n, 0);
        assert_eq!(
            parse_single_frame(&f),
            Err(FrameParseError::PayloadLengthMismatch)
        );
    }

    #[test]
    fn nonce_is_fixed_length_and_redacted() {
        let n = test_nonce();
        assert_eq!(n.len(), NONCE_LEN);
        assert!(!n.is_empty());
        assert_eq!(format!("{n:?}"), "Nonce(<redacted>)");
    }
}

#[cfg(test)]
mod installed_host_status_tests {
    use super::*;

    fn nonce() -> Nonce {
        Nonce::from_fixed_bytes([9u8; NONCE_LEN])
    }

    fn good() -> InstalledHostStatus {
        InstalledHostStatus::new(
            ServiceStateReport::Running,
            IdentityVerificationReport::Verified,
            ChannelReport::Stable,
            ReadinessReport::Ready,
            ProtectedOperationsReport::Refused,
            *b"0a1b2c3d",
            *b"deadbeef",
        )
        .expect("valid record")
    }

    #[test]
    fn a_status_frame_round_trips_canonically() {
        let s = good();
        let a = encode_installed_host_status(&nonce(), &s);
        let b = encode_installed_host_status(&nonce(), &s);
        assert_eq!(a, b, "encoding is canonical");
        assert_eq!(a.len(), HEADER_LEN + INSTALLED_HOST_STATUS_LEN);

        let (decoded, _) = decode_installed_host_status(&a).expect("decodes");
        assert_eq!(decoded, s);
        assert_eq!(decoded.service_state(), ServiceStateReport::Running);
        assert_eq!(decoded.identity(), IdentityVerificationReport::Verified);
        assert_eq!(decoded.channel(), ChannelReport::Stable);
        assert_eq!(decoded.readiness(), ReadinessReport::Ready);
        assert_eq!(
            decoded.protected_operations(),
            ProtectedOperationsReport::Refused
        );
        assert_eq!(decoded.build_prefix(), b"0a1b2c3d");
        assert_eq!(decoded.manifest_prefix(), b"deadbeef");
    }

    #[test]
    fn the_status_payload_length_is_exact_and_others_are_unchanged() {
        assert_eq!(INSTALLED_HOST_STATUS_LEN, 21);
        assert_eq!(
            required_payload_len(MessageKind::InstalledHostStatus),
            INSTALLED_HOST_STATUS_LEN
        );
        // Every pre-existing kind keeps its original length.
        for (k, n) in [
            (MessageKind::ControllerHello, 1),
            (MessageKind::ServiceReady, 1),
            (MessageKind::ShutdownRequest, 1),
            (MessageKind::ShutdownAcknowledged, 1),
            (MessageKind::ServiceEvidence, 4),
            (MessageKind::AuthorityOutcome, 1),
            (MessageKind::TypedRefusal, 1),
        ] {
            assert_eq!(required_payload_len(k), n, "{k:?}");
        }
    }

    #[test]
    fn a_wrong_length_payload_is_refused() {
        let mut f = encode_installed_host_status(&nonce(), &good()).to_vec();
        f.pop();
        // The declared length no longer matches the buffer.
        assert_eq!(
            decode_installed_host_status(&f).unwrap_err(),
            FrameParseError::TruncatedPayload
        );

        // A declared length that is not the required one.
        let mut g = encode_installed_host_status(&nonce(), &good()).to_vec();
        let len_off = 7 + NONCE_LEN;
        g[len_off..len_off + 2].copy_from_slice(&1u16.to_be_bytes());
        g.truncate(HEADER_LEN + 1);
        assert_eq!(
            decode_installed_host_status(&g).unwrap_err(),
            FrameParseError::PayloadLengthMismatch
        );
    }

    #[test]
    fn trailing_bytes_are_refused() {
        let mut f = encode_installed_host_status(&nonce(), &good()).to_vec();
        f.push(0);
        assert_eq!(
            decode_installed_host_status(&f).unwrap_err(),
            FrameParseError::TrailingData
        );
    }

    #[test]
    fn an_unknown_closed_enum_value_is_refused() {
        for offset in 0..5 {
            let mut f = encode_installed_host_status(&nonce(), &good()).to_vec();
            f[HEADER_LEN + offset] = 200;
            assert_eq!(
                decode_installed_host_status(&f).unwrap_err(),
                FrameParseError::UnknownStatusEnum,
                "enum byte {offset} must fail closed"
            );
            // Zero is never a valid discriminant either.
            let mut z = encode_installed_host_status(&nonce(), &good()).to_vec();
            z[HEADER_LEN + offset] = 0;
            assert_eq!(
                decode_installed_host_status(&z).unwrap_err(),
                FrameParseError::UnknownStatusEnum
            );
        }
    }

    #[test]
    fn a_malformed_prefix_is_refused_on_both_construction_and_decode() {
        // Upper-case hex, and a non-hex byte, are both refused at construction.
        for bad in [*b"0A1B2C3D", *b"zzzzzzzz", *b"        "] {
            assert_eq!(
                InstalledHostStatus::new(
                    ServiceStateReport::Running,
                    IdentityVerificationReport::Verified,
                    ChannelReport::Stable,
                    ReadinessReport::Ready,
                    ProtectedOperationsReport::Refused,
                    bad,
                    *b"deadbeef",
                )
                .unwrap_err(),
                FrameParseError::MalformedPrefix
            );
        }
        // And on the wire.
        let mut f = encode_installed_host_status(&nonce(), &good()).to_vec();
        f[HEADER_LEN + 5] = b'Z';
        assert_eq!(
            decode_installed_host_status(&f).unwrap_err(),
            FrameParseError::MalformedPrefix
        );
    }

    #[test]
    fn a_wrong_kind_or_version_is_refused() {
        let control = encode_control_frame(MessageKind::ControllerHello, &nonce(), 0);
        assert_eq!(
            decode_installed_host_status(&control).unwrap_err(),
            FrameParseError::UnexpectedMessageKind
        );

        let mut f = encode_installed_host_status(&nonce(), &good()).to_vec();
        f[4..6].copy_from_slice(&99u16.to_be_bytes());
        assert_eq!(
            decode_installed_host_status(&f).unwrap_err(),
            FrameParseError::UnknownVersion
        );

        let mut m = encode_installed_host_status(&nonce(), &good()).to_vec();
        m[0] = b'X';
        assert_eq!(
            decode_installed_host_status(&m).unwrap_err(),
            FrameParseError::BadMagic
        );
    }

    #[test]
    fn the_record_carries_no_full_identifier_and_no_free_form_data() {
        // Prefixes are exactly 8 hex characters — never a full 32-hex id or 64-hex digest.
        assert_eq!(STATUS_PREFIX_LEN, 8);
        let s = good();
        assert_eq!(s.build_prefix().len(), 8);
        assert_eq!(s.manifest_prefix().len(), 8);
        // The whole payload is 21 bytes: five closed enum bytes plus the two prefixes. There is no
        // room for a path, a token or a free-form string, and no accessor returns the raw payload.
        assert_eq!(INSTALLED_HOST_STATUS_LEN, 5 + 8 + 8);
    }
}

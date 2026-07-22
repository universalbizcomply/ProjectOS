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
const HEADER_LEN: usize = 4 + 2 + 1 + NONCE_LEN + 2;

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
    }
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
        ] {
            assert_eq!(MessageKind::from_discriminant(k.discriminant()), Some(k));
        }
        assert_eq!(MessageKind::from_discriminant(0), None);
        assert_eq!(MessageKind::from_discriminant(8), None);
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

//! Deterministic, bounded, length-framed on-disk record container with a SHA-256 integrity digest.
//!
//! **Integrity honesty:** the digest is SHA-256 (RustCrypto `sha2`), computed over the COMPLETE framed
//! content preceding the digest. It detects corruption and accidental OR unauthorised mutation (bit
//! flips, truncation, trailing bytes, silent edits) and makes framing unambiguous. It is UNKEYED, so
//! it does NOT authenticate a record against a local administrator or a deliberate forger who
//! recomputes the digest; keyed authenticity remains deferred until an approved custody key and threat
//! model exist (documented limitation). Framing uses fixed big-endian length prefixes — never
//! delimiter-only parsing. There is no weak-checksum fallback and no caller-selectable algorithm.

use sha2::{Digest, Sha256};

use crate::error::DurableStoreError;

/// Container magic ("Protected Durable Record v2" — SHA-256 format). No parsing without an exact match.
const MAGIC: [u8; 4] = *b"PDR2";
/// Maximum framed record size (bytes) — bounds read allocation before trusting any length.
pub const MAX_FRAMED_BYTES: usize = 1_048_576;
/// Maximum record-identity length (bytes).
pub const MAX_ID_BYTES: usize = 128;
/// Maximum payload (DTO JSON) length (bytes).
pub const MAX_PAYLOAD_BYTES: usize = 786_432;

/// Fixed header length: magic(4) + schema(4) + kind(4) + id_len(4) + revision(8) + payload_len(4).
const HEADER_LEN: usize = 4 + 4 + 4 + 4 + 8 + 4;
/// Trailing digest length (SHA-256).
pub const DIGEST_LEN: usize = 32;

/// The kind of framed document (discriminants are part of the on-disk format; never reused/renumbered).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum FrameKind {
    /// A protected-state record payload (an accepted persistence record DTO, as JSON).
    Record = 1,
    /// The protected-state manifest (an accepted `ProtectedStateManifestDto`, as JSON).
    Manifest = 2,
    /// A journal/intent envelope (a private crate-local journal envelope, as JSON).
    Journal = 3,
}

impl FrameKind {
    fn from_u32(v: u32) -> Option<Self> {
        match v {
            1 => Some(FrameKind::Record),
            2 => Some(FrameKind::Manifest),
            3 => Some(FrameKind::Journal),
            _ => None,
        }
    }
}

/// A decoded frame: the non-secret framing metadata plus the payload bytes (still an opaque accepted
/// DTO / private envelope document to this layer).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFrame {
    /// Framing schema version.
    pub schema_version: u32,
    /// Document kind.
    pub kind: FrameKind,
    /// Record identity bytes (empty for manifest).
    pub id: Vec<u8>,
    /// Monotonic revision bound to this document.
    pub revision: u64,
    /// The accepted DTO / private envelope (JSON) payload.
    pub payload: Vec<u8>,
}

/// Compute a SHA-256 digest of `bytes` (non-secret; used for framing integrity and record-frame
/// binding in the journal).
#[must_use]
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

/// Encode a framed document. Rejects oversized identity/payload BEFORE producing any bytes.
///
/// # Errors
/// [`DurableStoreError::InvalidInput`] for oversized identity/payload or a framing overflow.
pub fn encode(
    schema_version: u32,
    kind: FrameKind,
    id: &[u8],
    revision: u64,
    payload: &[u8],
) -> Result<Vec<u8>, DurableStoreError> {
    if id.len() > MAX_ID_BYTES || payload.len() > MAX_PAYLOAD_BYTES {
        return Err(DurableStoreError::InvalidInput);
    }
    let id_len = u32::try_from(id.len()).map_err(|_| DurableStoreError::InvalidInput)?;
    let payload_len = u32::try_from(payload.len()).map_err(|_| DurableStoreError::InvalidInput)?;
    let total = HEADER_LEN
        .checked_add(id.len())
        .and_then(|n| n.checked_add(payload.len()))
        .and_then(|n| n.checked_add(DIGEST_LEN))
        .ok_or(DurableStoreError::InvalidInput)?;
    if total > MAX_FRAMED_BYTES {
        return Err(DurableStoreError::InvalidInput);
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&schema_version.to_be_bytes());
    out.extend_from_slice(&(kind as u32).to_be_bytes());
    out.extend_from_slice(&id_len.to_be_bytes());
    out.extend_from_slice(&revision.to_be_bytes());
    out.extend_from_slice(&payload_len.to_be_bytes());
    out.extend_from_slice(id);
    out.extend_from_slice(payload);
    let digest = sha256(&out); // over everything preceding the digest
    out.extend_from_slice(&digest);
    Ok(out)
}

/// Decode and integrity-check a framed document. Rejects bad magic, truncation, trailing bytes,
/// out-of-bound lengths, unknown kinds, and any SHA-256 digest mismatch.
///
/// # Errors
/// [`DurableStoreError::CorruptionDetected`] for any framing/integrity violation;
/// [`DurableStoreError::ResourceLimit`] if the buffer exceeds [`MAX_FRAMED_BYTES`].
pub fn decode(bytes: &[u8]) -> Result<DecodedFrame, DurableStoreError> {
    if bytes.len() > MAX_FRAMED_BYTES {
        return Err(DurableStoreError::ResourceLimit);
    }
    if bytes.len() < HEADER_LEN + DIGEST_LEN {
        return Err(DurableStoreError::CorruptionDetected);
    }
    if bytes[0..4] != MAGIC {
        return Err(DurableStoreError::CorruptionDetected);
    }
    let schema_version = read_u32(bytes, 4);
    let kind =
        FrameKind::from_u32(read_u32(bytes, 8)).ok_or(DurableStoreError::CorruptionDetected)?;
    let id_len = read_u32(bytes, 12) as usize;
    let revision = read_u64(bytes, 16);
    let payload_len = read_u32(bytes, 24) as usize;
    if id_len > MAX_ID_BYTES || payload_len > MAX_PAYLOAD_BYTES {
        return Err(DurableStoreError::CorruptionDetected);
    }
    // EXACT total: header + id + payload + digest. Trailing or missing bytes are corruption.
    let expected = HEADER_LEN
        .checked_add(id_len)
        .and_then(|n| n.checked_add(payload_len))
        .and_then(|n| n.checked_add(DIGEST_LEN))
        .ok_or(DurableStoreError::CorruptionDetected)?;
    if bytes.len() != expected {
        return Err(DurableStoreError::CorruptionDetected);
    }
    let digest_offset = expected - DIGEST_LEN;
    let computed = sha256(&bytes[..digest_offset]);
    // Exact 32-byte comparison; a truncated/malformed digest cannot match.
    if bytes[digest_offset..] != computed[..] {
        return Err(DurableStoreError::CorruptionDetected);
    }
    let id_start = HEADER_LEN;
    let payload_start = id_start + id_len;
    Ok(DecodedFrame {
        schema_version,
        kind,
        id: bytes[id_start..payload_start].to_vec(),
        revision,
        payload: bytes[payload_start..digest_offset].to_vec(),
    })
}

fn read_u32(bytes: &[u8], at: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&bytes[at..at + 4]);
    u32::from_be_bytes(b)
}

fn read_u64(bytes: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&bytes[at..at + 8]);
    u64::from_be_bytes(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<u8> {
        encode(1, FrameKind::Record, b"rec-1", 3, b"{\"k\":1}").unwrap()
    }

    #[test]
    fn round_trip_exact() {
        let f = decode(&sample()).unwrap();
        assert_eq!(f.kind, FrameKind::Record);
        assert_eq!(f.id, b"rec-1");
        assert_eq!(f.revision, 3);
        assert_eq!(f.payload, b"{\"k\":1}");
    }

    #[test]
    fn digest_is_sha256_length() {
        let s = sample();
        // The trailing digest is exactly 32 bytes.
        assert_eq!(DIGEST_LEN, 32);
        assert!(s.len() > 32);
    }

    #[test]
    fn one_bit_mutation_rejected() {
        let mut b = sample();
        let mid = b.len() / 2;
        b[mid] ^= 0x01;
        assert_eq!(
            decode(&b).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
    }

    #[test]
    fn digest_mutation_rejected() {
        let mut b = sample();
        let last = b.len() - 1;
        b[last] ^= 0xff;
        assert_eq!(
            decode(&b).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
    }

    #[test]
    fn truncation_rejected() {
        let b = sample();
        assert_eq!(
            decode(&b[..b.len() - 1]).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
    }

    #[test]
    fn trailing_bytes_rejected() {
        let mut b = sample();
        b.push(0x00);
        assert_eq!(
            decode(&b).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
    }

    #[test]
    fn bad_magic_rejected() {
        let mut b = sample();
        b[0] ^= 0xff;
        assert_eq!(
            decode(&b).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
    }

    #[test]
    fn oversized_id_refused_on_encode() {
        let big = vec![b'a'; MAX_ID_BYTES + 1];
        assert_eq!(
            encode(1, FrameKind::Record, &big, 1, b"x").unwrap_err(),
            DurableStoreError::InvalidInput
        );
    }
}

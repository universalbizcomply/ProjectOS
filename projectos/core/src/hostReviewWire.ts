/**
 * THE AGENT'S MIRROR of the ProjectOSHost local-IPC wire, for ONE exchange: the accepted read-only
 * status exchange followed by one fixed-width review request and one fixed-width response.
 *
 * WHY A MIRROR EXISTS. The Host is Rust and the agent is TypeScript, and they meet on a byte layout.
 * The one definition of that layout is Rust — `projectos/host/windows-local-ipc/src/protocol.rs` and
 * `.../operation_contract.rs` — and this file exists to produce and judge the same bytes. It is not a
 * second opinion: `projectos/contracts/host-review-path-vectors.v1.json` holds frames the REAL Host code
 * produced and frames this file produced, and both languages are tested against that one file.
 *
 * NOTHING HERE IS TRUSTED BECAUSE IT PARSED. Every decoder is STRICT — bad magic, an unknown version or
 * kind, a truncated, oversized, padded or wrong-length frame, an unknown enum byte and a frame under
 * another exchange's nonce are each a typed refusal, never a default. And a frame that decodes is still
 * only a CLAIM: the response carries sixteen bytes that must equal the digest of an out-of-band record
 * the agent then verifies in full (`hostReviewEnvelope.ts`).
 *
 * WHAT IT NEVER CARRIES. No text, no path, no credential, no prompt, no decision prose. The frame is
 * fixed-width by construction and this file adds nothing to it.
 *
 * PURE. No I/O, no clock, no environment. Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { createHash } from 'node:crypto';

export const HOST_FRAME_MAGIC = Buffer.from('POS1', 'ascii');
export const HOST_WIRE_PROTOCOL_VERSION = 1;
export const HOST_NONCE_LEN = 32;
/** magic(4) + version(2) + kind(1) + nonce(32) + payload length(2). */
export const HOST_HEADER_LEN = 41;
export const HOST_MAX_FRAME_SIZE = 512;

/** The closed message kinds this exchange uses. Discriminants are the Rust `MessageKind`'s. */
export const HOST_MESSAGE_KIND = {
  ControllerHello: 1,
  ServiceReady: 2,
  InstalledHostStatus: 8,
  ProtectedOperationRequest: 9,
  ProtectedOperationResponse: 10,
} as const;

/** Peer roles carried in a control frame's single payload byte. */
const ROLE_CONTROLLER = 1;
const ROLE_SERVICE = 2;

const CONTROL_PAYLOAD_LEN = 1;
const STATUS_PREFIX_LEN = 8;
export const HOST_STATUS_PAYLOAD_LEN = 5 + STATUS_PREFIX_LEN + STATUS_PREFIX_LEN;
export const HOST_REQUEST_PAYLOAD_LEN = 16 + 8 + 8 + 32 + 1 + 32 + 32;
export const HOST_RESPONSE_PAYLOAD_LEN = 16 + 1 + 1 + 1 + 8 + 16 + 1;

export const HOST_SERVICE_READY_FRAME_LEN = HOST_HEADER_LEN + CONTROL_PAYLOAD_LEN;
export const HOST_STATUS_FRAME_LEN = HOST_HEADER_LEN + HOST_STATUS_PAYLOAD_LEN;
export const HOST_RESPONSE_FRAME_LEN = HOST_HEADER_LEN + HOST_RESPONSE_PAYLOAD_LEN;

/** `OperationClass::IndependentGatekeeperReview`. The ONLY class this client can ask for. */
export const HOST_OPERATION_INDEPENDENT_GATEKEEPER_REVIEW = 3;

/**
 * The ONE frozen run identifier of the installed-host endpoint (`INSTALLED_HOST_STATUS_RUN_ID`). Both
 * ends derive the single-use exchange nonce from it; it names an endpoint and grants nothing.
 */
export const INSTALLED_HOST_RUN_ID = Buffer.from([0x50, 0x4f, 0x53, 0x48, 0x53, 0x54, 0x41, 0x54]);

/** The exchange nonce for a run identifier: its eight bytes repeated to thirty-two. Mirrors Rust. */
export function hostNonceForRunId(runId: Buffer): Buffer {
  if (runId.length !== 8) throw new Error('a Host run identifier is exactly 8 bytes');
  const nonce = Buffer.alloc(HOST_NONCE_LEN);
  for (let i = 0; i < HOST_NONCE_LEN; i += 1) nonce[i] = runId[i % 8]!;
  return nonce;
}

// -------------------------------------------------------------------------------------------------
// STRICT FRAME PARSING
// -------------------------------------------------------------------------------------------------

/** Why a frame was refused. Spelt as the Rust `FrameParseError` variants are, plus the nonce check. */
export type HostFrameRefusal =
  | 'TruncatedHeader'
  | 'BadMagic'
  | 'UnknownVersion'
  | 'UnknownMessageKind'
  | 'OversizedPayload'
  | 'TruncatedPayload'
  | 'TrailingData'
  | 'PayloadLengthMismatch'
  | 'UnknownStatusEnum'
  | 'MalformedPrefix'
  | 'UnexpectedMessageKind'
  | 'NonceMismatch'
  | 'WrongPeerRole';

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: HostFrameRefusal };

function refuse<T>(refusal: HostFrameRefusal): Parsed<T> {
  return { ok: false, refusal };
}

function requiredPayloadLen(kind: number): number | null {
  switch (kind) {
    case HOST_MESSAGE_KIND.ControllerHello:
    case HOST_MESSAGE_KIND.ServiceReady:
      return CONTROL_PAYLOAD_LEN;
    case HOST_MESSAGE_KIND.InstalledHostStatus:
      return HOST_STATUS_PAYLOAD_LEN;
    case HOST_MESSAGE_KIND.ProtectedOperationRequest:
      return HOST_REQUEST_PAYLOAD_LEN;
    case HOST_MESSAGE_KIND.ProtectedOperationResponse:
      return HOST_RESPONSE_PAYLOAD_LEN;
    default:
      // Every OTHER kind the Host defines is one this client never expects; an unknown discriminant
      // and an unexpected one are both refusals, and the caller's kind check names which.
      return null;
  }
}

/**
 * Parse exactly ONE frame of `expectedKind` under `nonce`, in the Rust parser's own order: header,
 * magic, version, kind, payload bound, truncation, trailing data, the kind's exact length — then the
 * expected kind and this exchange's nonce.
 */
function parseFrame(buf: Buffer, expectedKind: number, nonce: Buffer): Parsed<Buffer> {
  if (buf.length < HOST_HEADER_LEN) return refuse('TruncatedHeader');
  if (!buf.subarray(0, 4).equals(HOST_FRAME_MAGIC)) return refuse('BadMagic');
  if (buf.readUInt16BE(4) !== HOST_WIRE_PROTOCOL_VERSION) return refuse('UnknownVersion');
  const kind = buf[6]!;
  if (kind < 1 || kind > 10) return refuse('UnknownMessageKind');
  const payloadLen = buf.readUInt16BE(7 + HOST_NONCE_LEN);
  if (payloadLen > HOST_MAX_FRAME_SIZE - HOST_HEADER_LEN) return refuse('OversizedPayload');
  const total = HOST_HEADER_LEN + payloadLen;
  if (buf.length < total) return refuse('TruncatedPayload');
  if (buf.length > total) return refuse('TrailingData');
  const required = requiredPayloadLen(kind);
  if (required !== null && payloadLen !== required) return refuse('PayloadLengthMismatch');
  if (kind !== expectedKind) return refuse('UnexpectedMessageKind');
  if (!buf.subarray(7, 7 + HOST_NONCE_LEN).equals(nonce)) return refuse('NonceMismatch');
  return { ok: true, value: buf.subarray(HOST_HEADER_LEN, total) };
}

function header(kind: number, nonce: Buffer, payloadLen: number): Buffer {
  if (nonce.length !== HOST_NONCE_LEN) throw new Error('a Host exchange nonce is exactly 32 bytes');
  const out = Buffer.alloc(HOST_HEADER_LEN + payloadLen);
  HOST_FRAME_MAGIC.copy(out, 0);
  out.writeUInt16BE(HOST_WIRE_PROTOCOL_VERSION, 4);
  out[6] = kind;
  nonce.copy(out, 7);
  out.writeUInt16BE(payloadLen, 7 + HOST_NONCE_LEN);
  return out;
}

// -------------------------------------------------------------------------------------------------
// THE ACCEPTED STATUS HALF
// -------------------------------------------------------------------------------------------------

/** The accepted `ControllerHello`: the existing request of the existing status exchange. */
export function encodeControllerHello(nonce: Buffer): Buffer {
  const out = header(HOST_MESSAGE_KIND.ControllerHello, nonce, CONTROL_PAYLOAD_LEN);
  out[HOST_HEADER_LEN] = ROLE_CONTROLLER;
  return out;
}

/** `null` when `buf` is exactly an accepted `ServiceReady` for this exchange. */
export function serviceReadyRefusal(buf: Buffer, nonce: Buffer): HostFrameRefusal | null {
  const parsed = parseFrame(buf, HOST_MESSAGE_KIND.ServiceReady, nonce);
  if (!parsed.ok) return parsed.refusal;
  return parsed.value[0] === ROLE_SERVICE ? null : 'WrongPeerRole';
}

export const HOST_SERVICE_STATES = ['Running', 'StartPending', 'StopPending', 'Stopped', 'Unavailable'] as const;
export const HOST_IDENTITY_REPORTS = ['Verified', 'Refused', 'Unavailable'] as const;
export const HOST_CHANNEL_REPORTS = ['Stable', 'Preview', 'Development', 'Unknown'] as const;
export const HOST_READINESS_REPORTS = ['Ready', 'Degraded', 'NotReady'] as const;
export const HOST_PROTECTED_OPERATIONS_REPORTS = ['Refused', 'Authorised'] as const;

export interface HostStatusRecord {
  readonly serviceState: (typeof HOST_SERVICE_STATES)[number];
  readonly identity: (typeof HOST_IDENTITY_REPORTS)[number];
  readonly channel: (typeof HOST_CHANNEL_REPORTS)[number];
  readonly readiness: (typeof HOST_READINESS_REPORTS)[number];
  readonly protectedOperations: (typeof HOST_PROTECTED_OPERATIONS_REPORTS)[number];
  readonly buildPrefix: string;
  readonly manifestPrefix: string;
}

function closedByte<T extends string>(values: readonly T[], byte: number): T | null {
  // Wire discriminants start at 1; 0 is never a value.
  return byte >= 1 && byte <= values.length ? values[byte - 1]! : null;
}

const LOWER_HEX_PREFIX = /^[0-9a-f]{8}$/;

/** STRICTLY decode the one status record the Host serves after `ServiceReady`. */
export function decodeInstalledHostStatus(buf: Buffer, nonce: Buffer): Parsed<HostStatusRecord> {
  const parsed = parseFrame(buf, HOST_MESSAGE_KIND.InstalledHostStatus, nonce);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  const serviceState = closedByte(HOST_SERVICE_STATES, p[0]!);
  const identity = closedByte(HOST_IDENTITY_REPORTS, p[1]!);
  const channel = closedByte(HOST_CHANNEL_REPORTS, p[2]!);
  const readiness = closedByte(HOST_READINESS_REPORTS, p[3]!);
  const protectedOperations = closedByte(HOST_PROTECTED_OPERATIONS_REPORTS, p[4]!);
  if (serviceState === null || identity === null || channel === null || readiness === null || protectedOperations === null) {
    return refuse('UnknownStatusEnum');
  }
  const buildPrefix = p.subarray(5, 5 + STATUS_PREFIX_LEN).toString('latin1');
  const manifestPrefix = p.subarray(5 + STATUS_PREFIX_LEN).toString('latin1');
  if (!LOWER_HEX_PREFIX.test(buildPrefix) || !LOWER_HEX_PREFIX.test(manifestPrefix)) return refuse('MalformedPrefix');
  return { ok: true, value: { serviceState, identity, channel, readiness, protectedOperations, buildPrefix, manifestPrefix } };
}

// -------------------------------------------------------------------------------------------------
// THE REVIEW HALF
// -------------------------------------------------------------------------------------------------

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const U64_MAX = (1n << 64n) - 1n;

/** One review request, exactly as the fixed frame carries it. Every field is a CLAIM. */
export interface HostReviewRequestFrame {
  /** 16 bytes, lower-case hex. */
  readonly correlation: string;
  readonly sequence: bigint;
  readonly claimedServiceEpoch: bigint;
  /** 32 bytes, lower-case hex: the agent's claim about what this request is about. */
  readonly bindingDigest: string;
  /** 32 bytes, lower-case hex: NAMES the owner programme delegation. Never an approval. */
  readonly approvalRef: string;
  /** 32 bytes, lower-case hex: SHA-256 of the exact out-of-band subject. */
  readonly parameterDigest: string;
}

/** Encode the one request frame, or `null` when any field is not exactly the width the wire fixes. */
export function encodeProtectedOperationRequest(nonce: Buffer, request: HostReviewRequestFrame): Buffer | null {
  if (!HEX32.test(request.correlation)) return null;
  if (!HEX64.test(request.bindingDigest) || !HEX64.test(request.approvalRef) || !HEX64.test(request.parameterDigest)) return null;
  for (const n of [request.sequence, request.claimedServiceEpoch]) if (n < 0n || n > U64_MAX) return null;
  const out = header(HOST_MESSAGE_KIND.ProtectedOperationRequest, nonce, HOST_REQUEST_PAYLOAD_LEN);
  let o = HOST_HEADER_LEN;
  o += Buffer.from(request.correlation, 'hex').copy(out, o);
  out.writeBigUInt64BE(request.sequence, o);
  o += 8;
  out.writeBigUInt64BE(request.claimedServiceEpoch, o);
  o += 8;
  o += Buffer.from(request.bindingDigest, 'hex').copy(out, o);
  out[o] = HOST_OPERATION_INDEPENDENT_GATEKEEPER_REVIEW;
  o += 1;
  o += Buffer.from(request.approvalRef, 'hex').copy(out, o);
  Buffer.from(request.parameterDigest, 'hex').copy(out, o);
  return out;
}

export const HOST_RESPONSE_STATES = ['Rejected', 'Accepted', 'Completed'] as const;
export const HOST_REJECTION_REASONS = [
  'OwnerPresenceGateOpen',
  'PeerNotAuthenticated',
  'BindingMismatch',
  'CorrelationMismatch',
  'ServiceEpochMismatch',
  'SequenceRefused',
  'MalformedRequest',
  'PolicyRefused',
] as const;
export const HOST_RESULT_CLASSES = ['NotRun', 'Succeeded', 'Failed'] as const;
export const HOST_TERMINAL_STATUSES = ['Terminal', 'RetryWithNewCorrelation'] as const;

export interface HostReviewResponseFrame {
  readonly correlation: string;
  readonly state: (typeof HOST_RESPONSE_STATES)[number];
  readonly reason: (typeof HOST_REJECTION_REASONS)[number];
  readonly result: (typeof HOST_RESULT_CLASSES)[number];
  readonly serviceEpoch: bigint;
  /** 16 bytes, lower-case hex: binds this completion to the out-of-band response record. */
  readonly evidenceRef: string;
  readonly terminal: (typeof HOST_TERMINAL_STATUSES)[number];
}

/** STRICTLY decode the one response frame under this exchange's nonce. */
export function decodeProtectedOperationResponse(buf: Buffer, nonce: Buffer): Parsed<HostReviewResponseFrame> {
  const parsed = parseFrame(buf, HOST_MESSAGE_KIND.ProtectedOperationResponse, nonce);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  const state = closedByte(HOST_RESPONSE_STATES, p[16]!);
  const reason = closedByte(HOST_REJECTION_REASONS, p[17]!);
  const result = closedByte(HOST_RESULT_CLASSES, p[18]!);
  const terminal = closedByte(HOST_TERMINAL_STATUSES, p[43]!);
  if (state === null || reason === null || result === null || terminal === null) return refuse('UnknownStatusEnum');
  return {
    ok: true,
    value: {
      correlation: p.subarray(0, 16).toString('hex'),
      state,
      reason,
      result,
      serviceEpoch: p.readBigUInt64BE(19),
      evidenceRef: p.subarray(27, 43).toString('hex'),
      terminal,
    },
  };
}

// -------------------------------------------------------------------------------------------------
// THE BINDING DIGEST
// -------------------------------------------------------------------------------------------------

/** `BINDING_DIGEST_DOMAIN` and `BINDING_DIGEST_SCHEMA_VERSION`, as Rust spells them. */
const BINDING_DIGEST_DOMAIN = Buffer.from('projectos.host-request-binding.v1', 'ascii');
const BINDING_DIGEST_SCHEMA_VERSION = 1;

/** The nine facts a binding digest covers — each a 32-byte digest as lower-case hex. */
export interface HostBindingSubject {
  readonly project: string;
  readonly repository: string;
  readonly plan: string;
  readonly planDigest: string;
  readonly phase: string;
  readonly candidateDigest: string;
  readonly modelPolicy: string;
  readonly credentialRef: string;
}

/**
 * THE AGENT'S CLAIM about what a request is about: SHA-256 over the domain, the schema version and the
 * subject's fixed-width fields in the Host's fixed order, with the one operation class this client can
 * ask for. The Host hashes the facts IT resolved and refuses unless the two are equal byte for byte —
 * so this function can state a belief and can never make one true. `null` when any field is malformed.
 */
export function hostBindingDigest(subject: HostBindingSubject): string | null {
  const fields = [subject.project, subject.repository, subject.plan, subject.planDigest, subject.phase, subject.candidateDigest];
  const tail = [subject.modelPolicy, subject.credentialRef];
  if (![...fields, ...tail].every((f) => HEX64.test(f))) return null;
  const version = Buffer.alloc(4);
  version.writeUInt32BE(BINDING_DIGEST_SCHEMA_VERSION, 0);
  const h = createHash('sha256').update(BINDING_DIGEST_DOMAIN).update(version);
  for (const f of fields) h.update(Buffer.from(f, 'hex'));
  h.update(Buffer.from([HOST_OPERATION_INDEPENDENT_GATEKEEPER_REVIEW]));
  for (const f of tail) h.update(Buffer.from(f, 'hex'));
  return h.digest('hex');
}

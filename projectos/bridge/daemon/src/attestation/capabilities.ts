/**
 * Runtime-verifiable opaque trust capabilities.
 *
 * Structural TypeScript typing is NOT a security boundary — a plain object could satisfy an
 * interface. These capabilities are gated by module-private WeakSets: the only way an object enters
 * a set is a module-private `mint*`, reachable solely through the test issuer (mode `test`) or a
 * future verifier entry point (mode `production`). No production minter exists in this phase, so a
 * production store/ledger/classification can never obtain a production capability and fails closed.
 * JSON serialisation drops WeakSet membership; re-parsed metadata is a plain object and is rejected.
 * Created in PROJECTOS-OWNER-ATTESTATION-STORE1B.
 */

export type CapabilityMode = 'production' | 'test';

// ---- VerifiedStoreProtection ---------------------------------------------------------------------
export interface SafeProtectionMeta {
  readonly mode: CapabilityMode;
  readonly verifierId: string;
  readonly protectionVersion: string;
  readonly verifiedRootId: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly evidenceRef: string;
}
const STORE_CAPS = new WeakSet<object>();
export class VerifiedStoreProtection {
  constructor(readonly meta: SafeProtectionMeta) {}
}
function mintStoreProtection(meta: SafeProtectionMeta): VerifiedStoreProtection {
  const v = new VerifiedStoreProtection(meta);
  STORE_CAPS.add(v);
  return v;
}
export function isVerifiedStoreProtection(x: unknown): x is VerifiedStoreProtection {
  return typeof x === 'object' && x !== null && STORE_CAPS.has(x as object);
}
/** TEST ONLY — mints a `test`-mode capability that production must reject. */
export function issueTestStoreProtection(verifiedRootId: string): VerifiedStoreProtection {
  return mintStoreProtection({
    mode: 'test', verifierId: 'test-fixture', protectionVersion: 'test-v0',
    verifiedRootId, verifiedAt: '1970-01-01T00:00:00.000Z', expiresAt: '9999-12-31T00:00:00.000Z', evidenceRef: 'test',
  });
}

// ---- VerifiedSecureNonceGenerator ----------------------------------------------------------------
const NONCE_CAPS = new WeakSet<object>();
export class VerifiedSecureNonceGenerator {
  constructor(readonly mode: CapabilityMode, private readonly gen: () => string) {}
  /** Only reachable when this instance is a genuinely-minted capability (checked by the ledger). */
  next(): string { return this.gen(); }
}
function mintNonceGenerator(mode: CapabilityMode, gen: () => string): VerifiedSecureNonceGenerator {
  const v = new VerifiedSecureNonceGenerator(mode, gen);
  NONCE_CAPS.add(v);
  return v;
}
export function isVerifiedSecureNonceGenerator(x: unknown): x is VerifiedSecureNonceGenerator {
  return typeof x === 'object' && x !== null && NONCE_CAPS.has(x as object);
}
/** TEST ONLY — wraps a deterministic generator as a `test`-mode capability (rejected in production). */
export function issueTestNonceGenerator(seed = 0): VerifiedSecureNonceGenerator {
  let n = seed;
  return mintNonceGenerator('test', () => `synthetic-test-nonce-${(n += 1)}`);
}

// ---- VerifiedKeyProtectionEvidence ---------------------------------------------------------------
import type { KeyProtection } from './types.js';
export interface SafeKeyProtectionMeta {
  readonly mode: CapabilityMode;
  readonly credentialId: string;
  readonly installationId: string;
  readonly deviceReference: string;
  readonly classification: KeyProtection;
  readonly verificationMethod: string;
  readonly verifiedAt: string;
  readonly evidenceRef: string;
}
const KEYPROT_CAPS = new WeakSet<object>();
export class VerifiedKeyProtectionEvidence {
  constructor(readonly meta: SafeKeyProtectionMeta) {}
}
function mintKeyProtection(meta: SafeKeyProtectionMeta): VerifiedKeyProtectionEvidence {
  const v = new VerifiedKeyProtectionEvidence(meta);
  KEYPROT_CAPS.add(v);
  return v;
}
export function isVerifiedKeyProtectionEvidence(x: unknown): x is VerifiedKeyProtectionEvidence {
  return typeof x === 'object' && x !== null && KEYPROT_CAPS.has(x as object);
}
/** TEST ONLY — `test`-mode evidence (rejected under production; cannot mint TPM_ATTESTED in this phase). */
export function issueTestKeyProtectionEvidence(meta: Omit<SafeKeyProtectionMeta, 'mode'>): VerifiedKeyProtectionEvidence {
  return mintKeyProtection({ ...meta, mode: 'test' });
}

// ---- Future verifier contracts (declared, NOT implemented in this phase) --------------------------
export type CapabilityFailure = { readonly ok: false; readonly reason: string };

/** The future Windows filesystem verifier will issue a production VerifiedStoreProtection. */
export interface StoreProtectionVerifier {
  verify(evidence: {
    readonly canonicalRoot: string;
    readonly beneathLocalAppData: boolean;
    readonly traversalPrevented: boolean;
    readonly reparsePolicyVerified: boolean;
    readonly ownerAccount: string;
    readonly directoryAclVerified: boolean;
    readonly fileAclVerified: boolean;
    readonly storeVersion: string;
  }): VerifiedStoreProtection | CapabilityFailure;
}
/** The future Windows/Rust crypto adapter will issue a production VerifiedSecureNonceGenerator. */
export interface SecureNonceGeneratorVerifier {
  verify(implementationId: string): VerifiedSecureNonceGenerator | CapabilityFailure;
}
/** The future enrollment/verifier phase will issue production VerifiedKeyProtectionEvidence. */
export interface KeyProtectionVerifier {
  verify(input: Omit<SafeKeyProtectionMeta, 'mode'>): VerifiedKeyProtectionEvidence | CapabilityFailure;
}

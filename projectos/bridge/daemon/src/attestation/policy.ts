/**
 * Production/test policy — gated by runtime-verifiable opaque capabilities (see capabilities.ts),
 * not by structural typing. Production requires a genuinely-minted `production`-mode capability;
 * none is issuable in this phase, so production stores/ledgers fail closed. Created in
 * PROJECTOS-OWNER-ATTESTATION-STORE1A; hardened in STORE1B.
 */
import { failWith, succeed, type Outcome } from './errors.js';
import {
  isVerifiedSecureNonceGenerator, isVerifiedStoreProtection,
  type VerifiedSecureNonceGenerator, type VerifiedStoreProtection,
} from './capabilities.js';
import type { AttestationPolicy, NonceClassification, StoreIntegrityStatus } from './types.js';

/** Derive the integrity status a store may claim from its policy + opaque capability. */
export function effectiveIntegrityStatus(policy: AttestationPolicy, protection: VerifiedStoreProtection | null, now: string): StoreIntegrityStatus {
  if (policy === 'test') return 'TEST_ISOLATED';
  if (!isVerifiedStoreProtection(protection)) return 'PRODUCTION_PROTECTION_UNAVAILABLE';
  if (protection.meta.mode !== 'production') return 'PRODUCTION_PROTECTION_UNAVAILABLE';
  if (Date.parse(protection.meta.expiresAt) <= Date.parse(now)) return 'PRODUCTION_PROTECTION_UNAVAILABLE';
  return 'PRODUCTION_PROTECTION_READY';
}

/** Gate a mutating store operation: production requires a fully-ready protected store. */
export function requireWritable(policy: AttestationPolicy, status: StoreIntegrityStatus): Outcome<true> {
  if (policy === 'test') return status === 'TEST_ISOLATED' ? succeed(true) : failWith('STORE_PROTECTION_INVALID', 'test store must be TEST_ISOLATED');
  if (status === 'MALFORMED_BLOCKED') return failWith('MALFORMED_RECORD', 'store is malformed-blocked');
  if (status !== 'PRODUCTION_PROTECTION_READY') return failWith('STORE_PROTECTION_REQUIRED', 'production requires a verified store-protection capability');
  return succeed(true);
}

/** Gate the nonce generator: production requires a genuinely-minted `production`-mode capability. */
export function requireNonceGenerator(policy: AttestationPolicy, gen: VerifiedSecureNonceGenerator | null): Outcome<VerifiedSecureNonceGenerator> {
  if (!isVerifiedSecureNonceGenerator(gen)) return failWith('NONCE_GENERATOR_REQUIRED', 'a verified secure nonce generator is required');
  if (policy === 'production' && gen.mode !== 'production') {
    return failWith('SYNTHETIC_REJECTED_IN_PRODUCTION', 'production requires a production-mode secure nonce generator');
  }
  return succeed(gen);
}

/** Reject a synthetic-test nonce classification under production. */
export function requireProductionNonceClass(policy: AttestationPolicy, cls: NonceClassification): Outcome<true> {
  if (policy === 'production' && cls !== 'cryptographic') {
    return failWith('SYNTHETIC_REJECTED_IN_PRODUCTION', 'synthetic nonce rejected under production policy');
  }
  return succeed(true);
}

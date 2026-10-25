/**
 * Owner-attestation storage foundation (STORE1A): typed credential registry + single-use challenge
 * ledger + production/test policy + fail-closed persistence. No Windows Hello, no signing, no
 * verification, no enrollment, no approval decisions — those are later gated phases.
 */
export * from './errors.js';
export * from './types.js';
export * from './capabilities.js';
export * from './policy.js';
export * from './validation.js';
export * from './persistence.js';
export * from './credentialStore.js';
export * from './nonceLedger.js';
export * from './paths.js';

/**
 * ExecutionProvider — the bounded execution boundary. A provider performs ONLY the underlying
 * operation for a bound record; it never touches authority, state, identity, evidence or recovery
 * (the controller owns all of those). Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type { ExecutionIdentity, ExecutionProviderMetadata } from './types.js';

/** Outcome of a provider operation. `ack` = accepted; `refused` = safe refusal (e.g. cannot pause now). */
export type ProviderResult =
  | { readonly kind: 'ack'; readonly detail: string }
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'timeout'; readonly detail: string };

/** Result of probing a possibly-interrupted operation during recovery. */
export type ProbeResult =
  | { readonly kind: 'running'; readonly detail: string }
  | { readonly kind: 'paused'; readonly detail: string }
  | { readonly kind: 'terminated'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string };

/**
 * A provider performs the bounded operation. Every method is given the immutable identity so the
 * provider can scope its work, but the provider must not mutate the controller record or decide
 * authority. Methods are synchronous + deterministic for CORE1A (the synthetic provider); a real
 * provider adapter will wrap async work behind the controller's timeout in a later phase.
 */
export interface ExecutionProvider {
  readonly metadata: ExecutionProviderMetadata;
  start(identity: ExecutionIdentity): ProviderResult;
  pause(identity: ExecutionIdentity): ProviderResult;
  resume(identity: ExecutionIdentity): ProviderResult;
  stop(identity: ExecutionIdentity): ProviderResult;
  /** Forced termination for emergency stop (e.g. real worker terminate + dispose). */
  terminate(identity: ExecutionIdentity): ProviderResult;
  /** Read-only liveness probe used during recovery. */
  probe(identity: ExecutionIdentity): ProbeResult;
}

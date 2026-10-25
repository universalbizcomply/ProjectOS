/**
 * Typed execution command request/response contracts. Requests carry bound identity + authority +
 * concurrency controls, and NEVER a raw secret (there is no field for one). Responses are minimal
 * and redacted. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type {
  ExecutionEnvironment,
  ExecutionProviderKind,
  ExecutionState,
  TrustedActorContext,
} from './types.js';

/** Fields common to every mutating command. No password/token/cookie/JWT/apiKey/credential field exists. */
export interface MutatingRequest {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly environment: ExecutionEnvironment;
  readonly expectedState: ExecutionState;
  readonly actor: TrustedActorContext;
  readonly requestedAt: string;
  readonly reason?: string;
  readonly timeoutMs?: number;
}

/** register creates a new record; it supplies the provider + optional predecessor instead of expectedState. */
export interface RegisterRequest {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly environment: ExecutionEnvironment;
  readonly providerId: string;
  readonly providerKind: ExecutionProviderKind;
  readonly actor: TrustedActorContext;
  readonly requestedAt: string;
  readonly predecessorOperationId?: string;
  readonly reason?: string;
}

export type StartRequest = MutatingRequest;
export type PauseRequest = MutatingRequest;
export type ResumeRequest = MutatingRequest;
export type StopRequest = MutatingRequest;
export type EmergencyStopRequest = MutatingRequest;
export type RecoverRequest = MutatingRequest;

export interface StatusRequest {
  readonly operationId: string;
  readonly actor: TrustedActorContext;
  readonly requestedAt: string;
}

export interface ListRequest {
  readonly actor: TrustedActorContext;
  readonly requestedAt: string;
}

/** Standard mutating response. `changed:false` marks an idempotent replay. */
export interface ExecutionResponse {
  readonly operationId: string;
  readonly state: ExecutionState;
  readonly changed: boolean;
  readonly reason: string;
  readonly evidenceRef: string | null;
  readonly nextSafeAction: string;
}

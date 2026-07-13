import {
  ExecutionController,
  InMemoryExecutionStore,
  SyntheticExecutionProvider,
  sha256EvidenceHasher,
  type AuthorityPolicy,
  type EvidenceHasher,
  type MutatingRequest,
  type RegisterRequest,
  type SyntheticProviderConfig,
  type TrustedActorContext,
} from '../src/execution/index.js';

export const NOW = '2026-07-13T00:00:00.000Z';
export const CLOCK = (): string => NOW;

/** A valid human-owner claim that passes the default production policy. */
export function ownerCtx(overrides: Partial<TrustedActorContext> = {}): TrustedActorContext {
  return {
    actorId: 'murad',
    role: 'owner',
    actorKind: 'human-owner',
    authoritySource: 'tauri-owner-attestation',
    authorityReference: 'attestation-ref-1',
    verifiedAt: NOW,
    expiresAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

export function setup(
  cfg: SyntheticProviderConfig = {},
  policy: AuthorityPolicy = 'production',
  hasher: EvidenceHasher = sha256EvidenceHasher,
): {
  store: InMemoryExecutionStore;
  provider: SyntheticExecutionProvider;
  ctrl: ExecutionController;
} {
  const store = new InMemoryExecutionStore();
  const provider = new SyntheticExecutionProvider({ providerId: 'p1', ...cfg });
  const ctrl = new ExecutionController({ store, providers: new Map([['p1', provider]]), clock: CLOCK, policy, hasher });
  return { store, provider, ctrl };
}

export function registerReq(overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  return {
    operationId: 'op1',
    idempotencyKey: 'k-reg',
    projectId: 'projectos',
    phaseId: 'PH1',
    environment: 'local',
    providerId: 'p1',
    providerKind: 'synthetic',
    actor: ownerCtx(),
    requestedAt: NOW,
    ...overrides,
  };
}

export function mut(overrides: Partial<MutatingRequest> = {}): MutatingRequest {
  return {
    operationId: 'op1',
    idempotencyKey: 'k',
    projectId: 'projectos',
    phaseId: 'PH1',
    environment: 'local',
    expectedState: 'READY',
    actor: ownerCtx(),
    requestedAt: NOW,
    ...overrides,
  };
}

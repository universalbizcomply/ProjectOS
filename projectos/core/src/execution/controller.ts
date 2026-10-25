/**
 * ExecutionController — the single authoritative execution controller.
 *
 * Owns: authority validation, identity binding, optimistic concurrency, idempotency, transition
 * validation, provider invocation, persistence and deterministic evidence. Providers own ONLY the
 * bounded operation. No I/O, clock or randomness is taken ambiently — a clock is injected. Nothing
 * here approves, closes a phase, starts another phase, or performs any external action.
 * Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A; hardened in CORE1B/CORE1C.
 *
 * Command pipeline (precedence) for every mutating command — a cached replay is NEVER returned
 * before current trust, identity and policy validation:
 *   1. validate trusted-actor claim structure + authority + expiry + production/test policy
 *   2. fail closed unless a cryptographic evidence hasher is supplied (production policy)
 *   3. validate operationId format + environment mutability
 *   4. load record; validate project / phase / environment identity
 *   5. inspect idempotency: identical canonical request => replay; different => conflict
 *   6. (fresh only) terminal check; expected-state (optimistic concurrency); allowed transition
 *   7. invoke provider only when required; persist; emit SHA-256 evidence; record idempotency
 */
import { canExecutionTransition } from './stateMachine.js';
import { buildEvidence, canonicalStringify, type EvidenceHasher } from './evidence.js';
import { failWith, succeed, type Outcome } from './errors.js';
import { MUTABLE_ENVIRONMENTS, TERMINAL_STATES } from './types.js';
import type {
  AuthorityPolicy,
  ExecutionAuthoritySource,
  ExecutionCommandName,
  ExecutionRecord,
  ExecutionState,
  TrustedActorContext,
} from './types.js';
import type { BlockReason } from './recovery.js';
import { nextActionFor, probeAllowedFor, recoveryStrategyFor, rechecksAvailabilityFor } from './recovery.js';
import type { ExecutionProvider } from './provider.js';
import type { ExecutionStore } from './persistence.js';
import type {
  ExecutionResponse,
  ListRequest,
  MutatingRequest,
  RegisterRequest,
  StatusRequest,
} from './commands.js';

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Strict RFC3339 / ISO-8601 timestamp with a `Z` or numeric offset. */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const OWNER_SOURCES_PRODUCTION: ReadonlySet<ExecutionAuthoritySource> = new Set(['tauri-owner-attestation', 'cli-owner-confirmation']);
const OWNER_SOURCES_TEST: ReadonlySet<ExecutionAuthoritySource> = new Set(['tauri-owner-attestation', 'cli-owner-confirmation', 'synthetic-test-fixture']);

export interface ControllerDeps {
  readonly store: ExecutionStore;
  readonly providers: ReadonlyMap<string, ExecutionProvider>;
  /** Injected deterministic clock returning an ISO-8601 UTC timestamp. */
  readonly clock: () => string;
  /** Authority policy. Defaults to `production` (synthetic authority + non-cryptographic hasher rejected). */
  readonly policy?: AuthorityPolicy;
  /** Evidence hasher. Production requires `classification: 'cryptographic'`; otherwise fail closed. */
  readonly hasher: EvidenceHasher;
}

type Preflight =
  | { readonly done: Outcome<ExecutionResponse> }
  | { readonly proceed: { readonly record: ExecutionRecord; readonly canonical: string } };

/** Return a copy of the record without the BLOCKED/UNAVAILABLE-only fields (exactOptionalPropertyTypes-safe clear). */
function stripBlockFields(record: ExecutionRecord): ExecutionRecord {
  const { blockReason, recoveryStrategy, automaticRecheckAllowed, providerProbeAllowed, ...rest } = record;
  void blockReason; void recoveryStrategy; void automaticRecheckAllowed; void providerProbeAllowed;
  return rest;
}

export class ExecutionController {
  readonly #store: ExecutionStore;
  readonly #providers: ReadonlyMap<string, ExecutionProvider>;
  readonly #clock: () => string;
  readonly #policy: AuthorityPolicy;
  readonly #hasher: EvidenceHasher;

  constructor(deps: ControllerDeps) {
    this.#store = deps.store;
    this.#providers = deps.providers;
    this.#clock = deps.clock;
    this.#policy = deps.policy ?? 'production';
    this.#hasher = deps.hasher;
  }

  // ---- validation helpers --------------------------------------------------

  /** Fail closed unless a cryptographic evidence hasher is supplied under production policy. */
  #requireHasher(): Outcome<true> {
    if (this.#policy === 'production' && this.#hasher.classification !== 'cryptographic') {
      return failWith('INSECURE_EVIDENCE_HASHER', 'production policy requires a cryptographic evidence hasher');
    }
    return succeed(true);
  }

  /**
   * Validate a claims envelope supplied by a trusted boundary. Core validates the CLAIM only; the
   * boundary establishes authenticity. A bare role string never establishes owner authority.
   */
  #validateActor(actor: TrustedActorContext, ownerOnly: boolean): Outcome<true> {
    if (!RFC3339.test(actor.verifiedAt) || !RFC3339.test(actor.expiresAt)) {
      return failWith('UNAUTHORISED_ACTOR', 'malformed timestamp (RFC3339 required)');
    }
    if (actor.actorId.trim() === '' || actor.authorityReference.trim() === '') {
      return failWith('UNAUTHORISED_ACTOR', 'missing actorId or authorityReference');
    }
    const verifiedAt = Date.parse(actor.verifiedAt);
    const expiresAt = Date.parse(actor.expiresAt);
    const now = Date.parse(this.#clock());
    if (Number.isNaN(verifiedAt) || Number.isNaN(expiresAt)) return failWith('UNAUTHORISED_ACTOR', 'unparseable timestamp');
    if (verifiedAt > expiresAt) return failWith('UNAUTHORISED_ACTOR', 'verifiedAt is after expiresAt');
    if (expiresAt <= now) return failWith('UNAUTHORISED_ACTOR', 'actor context expired');
    // Synthetic authority is only ever valid under an explicit test policy.
    if (this.#policy === 'production' && (actor.actorKind === 'synthetic-test-owner' || actor.authoritySource === 'synthetic-test-fixture')) {
      return failWith('UNAUTHORISED_ACTOR', 'synthetic authority rejected under production policy');
    }
    if (ownerOnly) {
      const ownerKindOk = actor.actorKind === 'human-owner' || (this.#policy === 'test' && actor.actorKind === 'synthetic-test-owner');
      if (actor.role !== 'owner' || !ownerKindOk) {
        return failWith('UNAUTHORISED_ACTOR', `role/kind '${actor.role}'/'${actor.actorKind}' cannot perform an owner-only command`);
      }
      const recognised = this.#policy === 'test' ? OWNER_SOURCES_TEST : OWNER_SOURCES_PRODUCTION;
      if (!recognised.has(actor.authoritySource)) {
        return failWith('UNAUTHORISED_ACTOR', `unrecognised owner authority source '${actor.authoritySource}'`);
      }
    }
    return succeed(true);
  }

  /** opId format + environment mutability + load + IMMUTABLE identity binding (no terminal/expectedState). */
  #authorizeIdentity(req: MutatingRequest): Outcome<ExecutionRecord> {
    if (!OP_ID.test(req.operationId)) return failWith('MALFORMED_RECORD', 'invalid operationId format');
    if (!MUTABLE_ENVIRONMENTS.has(req.environment)) return failWith('WRONG_ENVIRONMENT', `environment '${req.environment}' cannot be mutated`);
    const record = this.#store.get(req.operationId);
    if (record === null) return failWith('NOT_FOUND', 'no such operation');
    if (record.identity.projectId !== req.projectId) return failWith('WRONG_PROJECT', 'project identity mismatch');
    if (record.identity.phaseId !== req.phaseId) return failWith('WRONG_PHASE', 'phase identity mismatch');
    if (record.identity.environment !== req.environment) return failWith('WRONG_ENVIRONMENT', 'environment identity mismatch');
    return succeed(record);
  }

  /** Fresh-request gates (skipped on idempotent replay): terminal, expected-state, allowed transition. */
  #gateFresh(record: ExecutionRecord, req: MutatingRequest, allowedFrom: readonly ExecutionState[]): Outcome<ExecutionRecord> {
    if (TERMINAL_STATES.has(record.state)) return failWith('TERMINAL_OPERATION', `operation is terminal (${record.state})`);
    if (record.state !== req.expectedState) return failWith('EXPECTED_STATE_MISMATCH', `expected ${req.expectedState}, is ${record.state}`);
    if (!allowedFrom.includes(record.state)) return failWith('INVALID_TRANSITION', `${record.state} is not valid for this command`);
    return succeed(record);
  }

  #canonicalRequest(command: ExecutionCommandName, req: Record<string, unknown> & { actor: TrustedActorContext }): string {
    const a = req.actor;
    return canonicalStringify({
      command,
      operationId: req['operationId'] ?? '',
      projectId: req['projectId'] ?? '',
      phaseId: req['phaseId'] ?? '',
      environment: req['environment'] ?? '',
      expectedState: req['expectedState'] ?? '',
      providerId: req['providerId'] ?? '',
      providerKind: req['providerKind'] ?? '',
      predecessorOperationId: req['predecessorOperationId'] ?? '',
      reason: req['reason'] ?? '',
      timeoutMs: req['timeoutMs'] ?? '',
      idempotencyKey: req['idempotencyKey'] ?? '',
      actorId: a.actorId,
      role: a.role,
      actorKind: a.actorKind,
      authoritySource: a.authoritySource,
      authorityReference: a.authorityReference,
    });
  }

  /** Replay (identical canonical) or conflict (different canonical); null => proceed with a fresh request. */
  #replayOrConflict(key: string, canonical: string): Outcome<ExecutionResponse> | null {
    const prior = this.#store.getIdempotency(key);
    if (prior === null) return null;
    if (prior.canonicalRequest === canonical) return succeed({ ...(prior.response as ExecutionResponse), changed: false });
    return failWith('IDEMPOTENCY_CONFLICT', 'idempotency key reused with a different request');
  }

  /** Shared preamble: trust → hasher → identity → replay/conflict. */
  #preflight(req: MutatingRequest, ownerOnly: boolean, command: ExecutionCommandName): Preflight {
    const actorCheck = this.#validateActor(req.actor, ownerOnly);
    if (!actorCheck.ok) return { done: actorCheck };
    const hasherCheck = this.#requireHasher();
    if (!hasherCheck.ok) return { done: hasherCheck };
    const auth = this.#authorizeIdentity(req);
    if (!auth.ok) return { done: auth };
    const canonical = this.#canonicalRequest(command, req as unknown as Record<string, unknown> & { actor: TrustedActorContext });
    const replay = this.#replayOrConflict(req.idempotencyKey, canonical);
    if (replay !== null) return { done: replay };
    return { proceed: { record: auth.value, canonical } };
  }

  #finish(key: string, canonical: string, response: ExecutionResponse): Outcome<ExecutionResponse> {
    this.#store.saveIdempotency(key, { canonicalRequest: canonical, response });
    return succeed(response);
  }

  // ---- persistence + evidence ----------------------------------------------

  #commit(
    prev: ExecutionRecord,
    to: ExecutionState,
    command: ExecutionCommandName,
    actorRef: string,
    result: 'ok' | 'failed',
    reason: string,
    nextSafeAction: string,
    extra: Partial<ExecutionRecord> = {},
  ): Outcome<ExecutionRecord> {
    if (!canExecutionTransition(prev.state, to)) return failWith('INVALID_TRANSITION', `${prev.state} -> ${to}`);
    const at = this.#clock();
    const ev = buildEvidence({
      operationId: prev.identity.operationId,
      projectId: prev.identity.projectId,
      phaseId: prev.identity.phaseId,
      environment: prev.identity.environment,
      command,
      previousState: prev.state,
      newState: to,
      actorReference: actorRef,
      providerReference: prev.identity.providerId,
      result,
      reason,
      at,
      ...(extra.blockReason !== undefined ? { blockReason: extra.blockReason } : {}),
      ...(extra.recoveryStrategy !== undefined ? { recoveryStrategy: extra.recoveryStrategy } : {}),
      nextSafeAction,
    }, this.#hasher);
    const base: ExecutionRecord = {
      ...prev,
      ...extra,
      state: to,
      revision: prev.revision + 1,
      updatedAt: at,
      reason,
      nextSafeAction,
      lastEvidenceHash: ev.evidenceHash,
    };
    // Block fields belong only to a BLOCKED/UNAVAILABLE record; strip them on any other transition.
    const next: ExecutionRecord = (to === 'BLOCKED' || to === 'UNAVAILABLE') ? base : stripBlockFields(base);
    const u = this.#store.update(prev.identity.operationId, prev.revision, next);
    if (!u.ok) return failWith(u.reason === 'not-found' ? 'NOT_FOUND' : 'EXPECTED_STATE_MISMATCH', 'concurrent modification');
    return succeed(next);
  }

  #toResponse(record: ExecutionRecord, changed: boolean): ExecutionResponse {
    return {
      operationId: record.identity.operationId,
      state: record.state,
      changed,
      reason: record.reason,
      evidenceRef: record.lastEvidenceHash ?? null,
      nextSafeAction: record.nextSafeAction,
    };
  }

  /** Extra fields + owner-visible next action for a BLOCKED/UNAVAILABLE record. */
  #blockExtra(reason: BlockReason): Partial<ExecutionRecord> {
    return {
      blockReason: reason,
      recoveryStrategy: recoveryStrategyFor(reason),
      providerProbeAllowed: probeAllowedFor(reason),
      automaticRecheckAllowed: rechecksAvailabilityFor(reason),
      recoveryStatus: 'unresolved',
    };
  }

  #nextFor(state: ExecutionState): string {
    switch (state) {
      case 'RUNNING': return 'Pause, stop, or emergency-stop';
      case 'PAUSED': return 'Resume, stop, or emergency-stop';
      case 'STOPPED': return 'Terminal — register a new operation to run again';
      case 'CANCELLED': return 'Terminal (emergency-stopped) — register a new operation';
      case 'FAILED': return 'Recover or register a new operation';
      default: return 'Awaiting next command';
    }
  }

  // ---- provider-backed command driver --------------------------------------

  #drive(
    req: MutatingRequest,
    command: ExecutionCommandName,
    allowedFrom: readonly ExecutionState[],
    requestedState: ExecutionState,
    capability: 'start' | 'pause' | 'resume' | 'stop',
    ackState: ExecutionState,
    refuseState: ExecutionState | null,
  ): Outcome<ExecutionResponse> {
    const pf = this.#preflight(req, true, command);
    if ('done' in pf) return pf.done;
    const { record, canonical } = pf.proceed;
    const fresh = this.#gateFresh(record, req, allowedFrom);
    if (!fresh.ok) return fresh;
    const provider = this.#providers.get(record.identity.providerId);
    if (provider === undefined) {
      this.#commit(record, 'UNAVAILABLE', command, req.actor.actorId, 'failed', 'provider not registered', nextActionFor('PROVIDER_UNAVAILABLE'), this.#blockExtra('PROVIDER_UNAVAILABLE'));
      return failWith('PROVIDER_UNAVAILABLE', 'provider not registered');
    }
    if (!provider.metadata.capabilities[capability]) {
      return failWith('PROVIDER_CAPABILITY_UNSUPPORTED', `provider does not support ${capability}`);
    }
    const req2 = this.#commit(record, requestedState, command, req.actor.actorId, 'ok', `${command} requested`, 'Awaiting provider');
    if (!req2.ok) return req2;
    const res = provider[capability](record.identity);
    const extraReq: Partial<ExecutionRecord> =
      requestedState === 'PAUSE_REQUESTED' ? { pauseRequestedAt: req.requestedAt }
      : requestedState === 'STOP_REQUESTED' ? { stopRequestedAt: req.requestedAt }
      : {};
    switch (res.kind) {
      case 'ack': {
        const c = this.#commit(req2.value, ackState, command, req.actor.actorId, 'ok', res.detail, this.#nextFor(ackState), extraReq);
        return c.ok ? this.#finish(req.idempotencyKey, canonical, this.#toResponse(c.value, true)) : c;
      }
      case 'refused': {
        if (refuseState === null) {
          this.#commit(req2.value, 'FAILED', command, req.actor.actorId, 'failed', `refusal not safe: ${res.detail}`, 'Recover or register a new operation');
          return failWith('PROVIDER_FAILURE', `refusal not safe: ${res.detail}`);
        }
        const c = this.#commit(req2.value, refuseState, command, req.actor.actorId, 'ok', `provider refused (safe): ${res.detail}`, this.#nextFor(refuseState));
        return c.ok ? this.#finish(req.idempotencyKey, canonical, this.#toResponse(c.value, true)) : c;
      }
      case 'timeout': {
        this.#commit(req2.value, 'FAILED', command, req.actor.actorId, 'failed', `provider timeout: ${res.detail}`, 'Recover or register a new operation');
        return failWith('PROVIDER_TIMEOUT', `provider timeout: ${res.detail}`);
      }
      default: {
        this.#commit(req2.value, 'FAILED', command, req.actor.actorId, 'failed', `provider failure: ${res.detail}`, 'Recover or register a new operation');
        return failWith('PROVIDER_FAILURE', `provider failure: ${res.detail}`);
      }
    }
  }

  // ---- commands ------------------------------------------------------------

  register(req: RegisterRequest): Outcome<ExecutionResponse> {
    const actorCheck = this.#validateActor(req.actor, false);
    if (!actorCheck.ok) return actorCheck;
    const hasherCheck = this.#requireHasher();
    if (!hasherCheck.ok) return hasherCheck;
    if (!OP_ID.test(req.operationId)) return failWith('MALFORMED_RECORD', 'invalid operationId format');
    if (!MUTABLE_ENVIRONMENTS.has(req.environment)) return failWith('WRONG_ENVIRONMENT', `environment '${req.environment}' cannot be mutated`);
    const providerPresent = this.#providers.has(req.providerId);
    const at = this.#clock();
    const initialState: ExecutionState = providerPresent ? 'READY' : 'UNAVAILABLE';
    const block = providerPresent ? {} : this.#blockExtra('PROVIDER_UNAVAILABLE');
    const nextSafeAction = providerPresent ? 'Start execution' : nextActionFor('PROVIDER_UNAVAILABLE');
    const ev = buildEvidence({
      operationId: req.operationId, projectId: req.projectId, phaseId: req.phaseId, environment: req.environment,
      command: 'register', previousState: 'IDLE', newState: initialState, actorReference: req.actor.actorId,
      providerReference: req.providerId, result: providerPresent ? 'ok' : 'failed',
      reason: providerPresent ? 'registered' : 'provider not registered', at, nextSafeAction,
    }, this.#hasher);
    const record: ExecutionRecord = {
      identity: { projectId: req.projectId, phaseId: req.phaseId, environment: req.environment, operationId: req.operationId, providerId: req.providerId, providerKind: req.providerKind },
      state: initialState, revision: 0, createdAt: at, updatedAt: at,
      reason: providerPresent ? 'registered' : 'provider not registered',
      nextSafeAction, lastEvidenceHash: ev.evidenceHash, ...block,
      ...(req.predecessorOperationId !== undefined ? { predecessorOperationId: req.predecessorOperationId } : {}),
    };
    const created = this.#store.create(record);
    if (!created.ok) return failWith('DUPLICATE_OPERATION', 'operationId already exists');
    return succeed(this.#toResponse(record, true));
  }

  start(req: MutatingRequest): Outcome<ExecutionResponse> {
    return this.#drive(req, 'start', ['READY'], 'STARTING', 'start', 'RUNNING', null);
  }

  pause(req: MutatingRequest): Outcome<ExecutionResponse> {
    return this.#drive(req, 'pause', ['RUNNING'], 'PAUSE_REQUESTED', 'pause', 'PAUSED', 'RUNNING');
  }

  resume(req: MutatingRequest): Outcome<ExecutionResponse> {
    return this.#drive(req, 'resume', ['PAUSED'], 'RESUME_REQUESTED', 'resume', 'RUNNING', 'PAUSED');
  }

  stop(req: MutatingRequest): Outcome<ExecutionResponse> {
    return this.#drive(req, 'stop', ['RUNNING', 'PAUSED'], 'STOP_REQUESTED', 'stop', 'STOPPED', null);
  }

  /** Emergency stop = forced termination via provider.terminate, ending CANCELLED (never STOPPED, never phase closure). */
  emergencyStop(req: MutatingRequest): Outcome<ExecutionResponse> {
    const pf = this.#preflight(req, true, 'emergencyStop');
    if ('done' in pf) return pf.done;
    const { record, canonical } = pf.proceed;
    const fresh = this.#gateFresh(record, req, ['STARTING', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'RESUME_REQUESTED', 'STOP_REQUESTED']);
    if (!fresh.ok) return fresh;
    const provider = this.#providers.get(record.identity.providerId);
    if (provider === undefined) {
      this.#commit(record, 'EMERGENCY_STOP_REQUESTED', 'emergencyStop', req.actor.actorId, 'ok', 'emergency stop requested', 'Awaiting termination');
      return failWith('PROVIDER_UNAVAILABLE', 'provider not registered');
    }
    if (!provider.metadata.capabilities.terminate) return failWith('PROVIDER_CAPABILITY_UNSUPPORTED', 'provider does not support terminate');
    const r1 = this.#commit(record, 'EMERGENCY_STOP_REQUESTED', 'emergencyStop', req.actor.actorId, 'ok', 'emergency stop requested', 'Terminating', { stopRequestedAt: req.requestedAt });
    if (!r1.ok) return r1;
    const r2 = this.#commit(r1.value, 'CANCELLING', 'emergencyStop', req.actor.actorId, 'ok', 'terminating provider', 'Terminating');
    if (!r2.ok) return r2;
    const res = provider.terminate(record.identity);
    if (res.kind === 'ack') {
      const c = this.#commit(r2.value, 'CANCELLED', 'emergencyStop', req.actor.actorId, 'ok', res.detail, this.#nextFor('CANCELLED'));
      return c.ok ? this.#finish(req.idempotencyKey, canonical, this.#toResponse(c.value, true)) : c;
    }
    this.#commit(r2.value, 'FAILED', 'emergencyStop', req.actor.actorId, 'failed', `termination failed: ${res.detail}`, 'Recover; do not assume the operation stopped');
    return failWith(res.kind === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE', `termination failed: ${res.detail}`);
  }

  /** Recover a stale/held record. Reason-aware: a provider probe can clear ONLY a state-unknown block. */
  recover(req: MutatingRequest): Outcome<ExecutionResponse> {
    const pf = this.#preflight(req, true, 'recover');
    if ('done' in pf) return pf.done;
    const { record, canonical } = pf.proceed;
    const fresh = this.#gateFresh(record, req, ['STARTING', 'RUNNING', 'PAUSE_REQUESTED', 'RESUME_REQUESTED', 'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'CANCELLING', 'BLOCKED', 'UNAVAILABLE']);
    if (!fresh.ok) return fresh;
    const sourceState = record.state;
    const wasPreStart = sourceState === 'STARTING';
    const rec = this.#commit(record, 'RECOVERING', 'recover', req.actor.actorId, 'ok', 'recovering', 'Reconciling with provider');
    if (!rec.ok) return rec;
    const provider = this.#providers.get(record.identity.providerId);
    const key = req.idempotencyKey;

    // UNAVAILABLE (or a PROVIDER_UNAVAILABLE / PROVIDER_CAPABILITY_MISSING block): re-check availability — no probe.
    const reason: BlockReason = record.blockReason ?? (sourceState === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_STATE_UNKNOWN');
    if (sourceState === 'UNAVAILABLE' || rechecksAvailabilityFor(reason)) {
      const available = provider !== undefined && provider.metadata.capabilities.start && provider.metadata.capabilities.probe;
      if (available) {
        const c = this.#commit(rec.value, 'READY', 'recover', req.actor.actorId, 'ok', 'provider is now available', 'Start execution', { recoveryStatus: 'reconciled' });
        return c.ok ? this.#finish(key, canonical, this.#toResponse(c.value, true)) : c;
      }
      const back: ExecutionState = sourceState === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'BLOCKED';
      const c = this.#commit(rec.value, back, 'recover', req.actor.actorId, 'failed', 'provider still unavailable', nextActionFor(reason), this.#blockExtra(reason));
      return c.ok ? this.#finish(key, canonical, this.#toResponse(c.value, true)) : c;
    }

    // Authority/identity/environment/governance/malformed blocks: NO provider call — a probe cannot clear these.
    if (sourceState === 'BLOCKED' && !probeAllowedFor(reason)) {
      const strategy = recoveryStrategyFor(reason);
      const to: ExecutionState = strategy === 'NOT_RECOVERABLE' ? 'FAILED' : 'BLOCKED';
      const c = this.#commit(rec.value, to, 'recover', req.actor.actorId, to === 'FAILED' ? 'failed' : 'failed', `unresolved: ${reason}`, nextActionFor(reason), to === 'BLOCKED' ? this.#blockExtra(reason) : { recoveryStatus: 'unresolved' });
      return c.ok ? this.#finish(key, canonical, this.#toResponse(c.value, true)) : c;
    }

    // Otherwise probe the provider; an unknown state is never treated as success.
    if (provider === undefined || !provider.metadata.capabilities.probe) {
      const c = this.#commit(rec.value, 'BLOCKED', 'recover', req.actor.actorId, 'failed', 'cannot probe provider', nextActionFor('PROVIDER_CAPABILITY_MISSING'), this.#blockExtra('PROVIDER_CAPABILITY_MISSING'));
      return c.ok ? this.#finish(key, canonical, this.#toResponse(c.value, true)) : c;
    }
    const probe = provider.probe(record.identity);
    let to: ExecutionState;
    let detail: string;
    let extra: Partial<ExecutionRecord>;
    switch (probe.kind) {
      case 'terminated': to = wasPreStart ? 'READY' : 'STOPPED'; detail = wasPreStart ? 'pre-start; provider terminated — safe to retry' : 'provider terminated safely'; extra = { recoveryStatus: 'reconciled' }; break;
      case 'paused': to = 'PAUSED'; detail = 'provider proves paused'; extra = { recoveryStatus: 'reconciled' }; break;
      case 'running': to = 'BLOCKED'; detail = 'provider still running — reconciliation indeterminate'; extra = this.#blockExtra('PROVIDER_STATE_UNKNOWN'); break;
      default: to = 'FAILED'; detail = 'provider state unknown — never treated as success'; extra = { recoveryStatus: 'unresolved' }; break;
    }
    const nextAction = to === 'BLOCKED' ? nextActionFor('PROVIDER_STATE_UNKNOWN') : this.#nextFor(to);
    const c = this.#commit(rec.value, to, 'recover', req.actor.actorId, to === 'FAILED' ? 'failed' : 'ok', detail, nextAction, extra);
    return c.ok ? this.#finish(key, canonical, this.#toResponse(c.value, true)) : c;
  }

  status(req: StatusRequest): Outcome<ExecutionResponse> {
    const actorCheck = this.#validateActor(req.actor, false);
    if (!actorCheck.ok) return actorCheck;
    const record = this.#store.get(req.operationId);
    if (record === null) return failWith('NOT_FOUND', 'no such operation');
    return succeed(this.#toResponse(record, false));
  }

  list(req: ListRequest): Outcome<readonly ExecutionRecord[]> {
    const actorCheck = this.#validateActor(req.actor, false);
    if (!actorCheck.ok) return actorCheck;
    return succeed(this.#store.list());
  }
}

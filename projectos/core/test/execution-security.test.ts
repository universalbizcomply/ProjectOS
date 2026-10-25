import { describe, it, expect } from 'vitest';
import { setup, registerReq, mut, ownerCtx, NOW } from './execution-helpers.js';
import {
  buildEvidence, canonicalStringify, sha256Hex, EVIDENCE_HASH_ALGORITHM,
  sha256EvidenceHasher, deterministicTestHasher,
  BLOCK_REASON_STRATEGY, recoveryStrategyFor, probeAllowedFor,
  ExecutionController, InMemoryExecutionStore, SyntheticExecutionProvider,
  type EvidenceInput, type BlockReason,
} from '../src/execution/index.js';

describe('execution authority — strict claims envelope', () => {
  function startWith(over: Partial<ReturnType<typeof ownerCtx>>, policy: 'production' | 'test' = 'production') {
    const { ctrl } = setup({}, policy);
    ctrl.register(registerReq({ actor: ownerCtx() }));
    return ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY', actor: ownerCtx(over) }));
  }

  it('a valid human-owner claim starts under production policy', () => {
    expect(startWith({}).ok).toBe(true);
  });

  it.each([
    ['claude', { role: 'implementer' as const, actorKind: 'claude' as const }],
    ['worker', { role: 'implementer' as const, actorKind: 'worker' as const }],
    ['daemon', { role: 'implementer' as const, actorKind: 'daemon' as const }],
    ['advisor', { role: 'advisor' as const, actorKind: 'advisor' as const }],
    ['owner-role-but-claude-kind', { role: 'owner' as const, actorKind: 'claude' as const }],
    ['owner-role-but-daemon-kind', { role: 'owner' as const, actorKind: 'daemon' as const }],
    ['owner-role-but-worker-kind', { role: 'owner' as const, actorKind: 'worker' as const }],
  ])('refuses an owner-only command from %s', (_l, over) => {
    const r = startWith(over);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNAUTHORISED_ACTOR');
  });

  it.each([
    ['expired context', { expiresAt: '2026-07-12T00:00:00.000Z' }],
    ['verifiedAt after expiresAt', { verifiedAt: '2026-07-14T00:00:00.000Z', expiresAt: '2026-07-13T00:00:00.000Z' }],
    ['malformed timestamp', { expiresAt: 'not-a-date' }],
    ['missing authorityReference', { authorityReference: '   ' }],
    ['unrecognised owner authority source', { authoritySource: 'system-controller' as const }],
  ])('refuses %s', (_l, over) => {
    const r = startWith(over);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNAUTHORISED_ACTOR');
  });

  it('synthetic owner authority is REJECTED under production policy', () => {
    const r = startWith({ actorKind: 'synthetic-test-owner', authoritySource: 'synthetic-test-fixture' }, 'production');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNAUTHORISED_ACTOR');
  });

  it('synthetic owner authority is ACCEPTED only under an explicit test policy', () => {
    const r = startWith({ actorKind: 'synthetic-test-owner', authoritySource: 'synthetic-test-fixture' }, 'test');
    expect(r.ok).toBe(true);
  });
});

describe('execution evidence', () => {
  const input: EvidenceInput = {
    operationId: 'op1', projectId: 'projectos', phaseId: 'PH1', environment: 'local',
    command: 'start', previousState: 'READY', newState: 'STARTING', actorReference: 'murad',
    providerReference: 'p1', result: 'ok', reason: 'starting', at: NOW,
  };

  it('uses a real, cryptographic SHA-256 (FIPS-180 known-answer vectors)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('labels the algorithm as sha-256 and emits a 64-hex digest', () => {
    const ev = buildEvidence(input, sha256EvidenceHasher);
    expect(ev.hashAlgorithm).toBe(EVIDENCE_HASH_ALGORITHM);
    expect(ev.hashAlgorithm).toBe('sha-256');
    expect(ev.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces an identical digest for identical input (deterministic)', () => {
    expect(buildEvidence(input, sha256EvidenceHasher).evidenceHash).toBe(buildEvidence({ ...input }, sha256EvidenceHasher).evidenceHash);
  });

  it('changes the digest when any bound field changes', () => {
    expect(buildEvidence(input, sha256EvidenceHasher).evidenceHash).not.toBe(buildEvidence({ ...input, newState: 'FAILED' }, sha256EvidenceHasher).evidenceHash);
  });

  it('carries no secret/credential field (shape is minimal + bound identity only)', () => {
    const keys = Object.keys(buildEvidence(input, sha256EvidenceHasher));
    for (const forbidden of ['password', 'token', 'secret', 'apiKey', 'cookie', 'jwt', 'credential']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it('canonicalStringify sorts keys so equal objects serialise identically', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
  });
});

describe('execution governance invariants', () => {
  it('execution success never closes a phase and never starts another (no such capability exists)', () => {
    const { ctrl, store } = setup();
    ctrl.register(registerReq());
    ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    ctrl.stop(mut({ idempotencyKey: 'kt', expectedState: 'RUNNING' }));
    const rec = store.get('op1');
    // The record models execution only; there is no phase-closure or next-phase field/command.
    expect(rec?.state).toBe('STOPPED');
    expect(JSON.stringify(rec)).not.toMatch(/closed|closure|nextPhase|deploy|commit|push/i);
  });

  it('terminal operations are immutable; restarting requires a new operation id', () => {
    const { ctrl } = setup();
    ctrl.register(registerReq());
    ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    ctrl.stop(mut({ idempotencyKey: 'kt', expectedState: 'RUNNING' }));
    const restart = ctrl.start(mut({ idempotencyKey: 'ks2', expectedState: 'STOPPED' }));
    expect(restart.ok).toBe(false); if (!restart.ok) expect(restart.error.code).toBe('TERMINAL_OPERATION');
    // A fresh operation id succeeds (new evidence chain).
    const fresh = ctrl.register(registerReq({ operationId: 'op2', idempotencyKey: 'k-reg2', predecessorOperationId: 'op1' }));
    expect(fresh.ok && fresh.value.state).toBe('READY');
  });
});

describe('SHA-256 comprehensive vectors', () => {
  it('two-block FIPS vector (448-bit message)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('one-million-"a" vector (many block boundaries)', () => {
    expect(sha256Hex('a'.repeat(1_000_000)))
      .toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('long input crossing several blocks is deterministic + 64-hex', () => {
    const s = 'The quick brown fox jumps over the lazy dog'.repeat(50);
    expect(sha256Hex(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(s)).toBe(sha256Hex(s));
  });
  it('Unicode + non-BMP inputs are deterministic and distinct', () => {
    expect(sha256Hex('héllo wörld — Ω')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('𝓪𝓫')).toMatch(/^[0-9a-f]{64}$/); // non-BMP (surrogate pairs)
    expect(sha256Hex('𝓪𝓫')).not.toBe(sha256Hex('ab'));
    expect(sha256Hex('café')).not.toBe(sha256Hex('cafe'));
  });
});

describe('evidence hasher policy (fail-closed)', () => {
  it('production fails closed when only a test-only hasher is supplied', () => {
    const { ctrl } = setup({}, 'production', deterministicTestHasher);
    const r = ctrl.register(registerReq());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('INSECURE_EVIDENCE_HASHER');
  });
  it('a cryptographic hasher passes production', () => {
    const { ctrl } = setup({}, 'production', sha256EvidenceHasher);
    expect(ctrl.register(registerReq()).ok).toBe(true);
  });
  it('the test-only hasher is permitted under test policy', () => {
    const { ctrl } = setup({}, 'test', deterministicTestHasher);
    expect(ctrl.register(registerReq({ actor: ownerCtx() })).ok).toBe(true);
  });
});

describe('idempotent replay is re-authorised (trust + identity before cache)', () => {
  function startedOwner() {
    const { ctrl, provider } = setup();
    ctrl.register(registerReq());
    ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    return { ctrl, provider };
  }
  it('valid current actor + identical request replays (provider still called once)', () => {
    const { ctrl, provider } = startedOwner();
    const r = ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    expect(r.ok && r.value.changed).toBe(false);
    expect(provider.calls.start).toBe(1);
  });
  it('expired actor with a previously successful key is refused (not replayed)', () => {
    const { ctrl, provider } = startedOwner();
    const r = ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY', actor: ownerCtx({ expiresAt: '2026-07-12T00:00:00.000Z' }) }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNAUTHORISED_ACTOR');
    expect(provider.calls.start).toBe(1);
  });
  it('Claude actor with a previously successful owner key is refused', () => {
    const { ctrl } = startedOwner();
    const r = ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY', actor: ownerCtx({ role: 'implementer', actorKind: 'claude' }) }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('UNAUTHORISED_ACTOR');
  });
  it('changed project is refused before any replay', () => {
    const { ctrl } = startedOwner();
    const r = ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY', projectId: 'other' }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('WRONG_PROJECT');
  });
});

describe('block-reason / recovery-strategy model', () => {
  const ALL: readonly BlockReason[] = [
    'PROVIDER_UNAVAILABLE', 'PROVIDER_STATE_UNKNOWN', 'PROVIDER_CAPABILITY_MISSING', 'IDENTITY_MISMATCH',
    'AUTHORITY_REQUIRED', 'ENVIRONMENT_UNVERIFIED', 'MALFORMED_RECORD', 'CONCURRENCY_CONFLICT',
    'GOVERNANCE_GUARD', 'OWNER_ACTION_REQUIRED', 'RECOVERY_REQUIRED', 'OTHER_FAIL_CLOSED',
  ];
  it('every block reason maps to exactly one strategy', () => {
    for (const r of ALL) expect(recoveryStrategyFor(r)).toBe(BLOCK_REASON_STRATEGY[r]);
    expect(Object.keys(BLOCK_REASON_STRATEGY).sort()).toEqual([...ALL].sort());
  });
  it('a provider STATE probe may NOT clear authority/identity/environment/governance/malformed blocks', () => {
    for (const r of ['AUTHORITY_REQUIRED', 'IDENTITY_MISMATCH', 'ENVIRONMENT_UNVERIFIED', 'GOVERNANCE_GUARD', 'MALFORMED_RECORD'] as const) {
      expect(probeAllowedFor(r)).toBe(false);
    }
    expect(probeAllowedFor('PROVIDER_STATE_UNKNOWN')).toBe(true);
  });
  it('a running-probe block records a typed reason, strategy and probe permission', () => {
    const store = new InMemoryExecutionStore();
    const provider = new SyntheticExecutionProvider({ providerId: 'p1', probeResult: 'running' });
    const ctrl = new ExecutionController({ store, providers: new Map([['p1', provider]]), clock: () => NOW, policy: 'production', hasher: sha256EvidenceHasher });
    ctrl.register(registerReq());
    ctrl.start(mut({ idempotencyKey: 'ks', expectedState: 'READY' }));
    ctrl.recover(mut({ idempotencyKey: 'kr', expectedState: 'RUNNING' }));
    const rec = store.get('op1');
    expect(rec?.state).toBe('BLOCKED');
    expect(rec?.blockReason).toBe('PROVIDER_STATE_UNKNOWN');
    expect(rec?.recoveryStrategy).toBe('PROBE_PROVIDER_STATE');
    expect(rec?.providerProbeAllowed).toBe(true);
  });
});

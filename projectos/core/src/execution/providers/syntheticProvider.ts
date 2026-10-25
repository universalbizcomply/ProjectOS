/**
 * SYNTHETIC — NOT A REAL WORKER.
 *
 * A deterministic, in-memory execution provider for tests and native proof. No network, no
 * credentials, no product repositories, no subprocess, no shell, no arbitrary filesystem. Every
 * operation is scripted and configurable (refuse/fail/timeout/crash) so the controller's transition,
 * idempotency and recovery logic can be proven. Invocation counters back the "provider invoked once"
 * idempotency tests. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type { ExecutionIdentity, ExecutionProviderMetadata } from '../types.js';
import type { ExecutionProvider, ProbeResult, ProviderResult } from '../provider.js';

export interface SyntheticProviderConfig {
  readonly providerId?: string;
  /** Force a specific behaviour per capability (default: ack). */
  readonly startResult?: ProviderResult['kind'];
  readonly pauseResult?: ProviderResult['kind'];
  readonly resumeResult?: ProviderResult['kind'];
  readonly stopResult?: ProviderResult['kind'];
  readonly terminateResult?: ProviderResult['kind'];
  readonly probeResult?: ProbeResult['kind'];
  /** Disable a capability so the controller returns PROVIDER_CAPABILITY_UNSUPPORTED. */
  readonly unsupported?: ReadonlyArray<'start' | 'pause' | 'resume' | 'stop' | 'terminate' | 'probe'>;
}

export class SyntheticExecutionProvider implements ExecutionProvider {
  readonly metadata: ExecutionProviderMetadata;
  readonly calls = { start: 0, pause: 0, resume: 0, stop: 0, terminate: 0, probe: 0 };
  /** Current probe outcome (mutable so a test can model a provider whose liveness changes over time). */
  probeResult: ProbeResult['kind'];
  readonly #cfg: SyntheticProviderConfig;

  constructor(cfg: SyntheticProviderConfig = {}) {
    this.#cfg = cfg;
    this.probeResult = cfg.probeResult ?? 'terminated';
    const off = new Set(cfg.unsupported ?? []);
    this.metadata = {
      providerId: cfg.providerId ?? 'synthetic-1',
      providerKind: 'synthetic',
      capabilities: {
        start: !off.has('start'),
        pause: !off.has('pause'),
        resume: !off.has('resume'),
        stop: !off.has('stop'),
        terminate: !off.has('terminate'),
        probe: !off.has('probe'),
      },
      externalNetworkAllowed: false,
      secretAccessAllowed: false,
      productRepositoryAccessAllowed: false,
      label: 'SYNTHETIC — NOT A REAL WORKER',
    };
  }

  #result(kind: ProviderResult['kind'] | undefined, id: ExecutionIdentity, verb: string): ProviderResult {
    const k = kind ?? 'ack';
    return { kind: k, detail: `synthetic ${verb} for ${id.operationId}` } as ProviderResult;
  }

  start(id: ExecutionIdentity): ProviderResult { this.calls.start++; return this.#result(this.#cfg.startResult, id, 'start'); }
  pause(id: ExecutionIdentity): ProviderResult { this.calls.pause++; return this.#result(this.#cfg.pauseResult, id, 'pause'); }
  resume(id: ExecutionIdentity): ProviderResult { this.calls.resume++; return this.#result(this.#cfg.resumeResult, id, 'resume'); }
  stop(id: ExecutionIdentity): ProviderResult { this.calls.stop++; return this.#result(this.#cfg.stopResult, id, 'stop'); }
  terminate(id: ExecutionIdentity): ProviderResult { this.calls.terminate++; return this.#result(this.#cfg.terminateResult, id, 'terminate'); }
  probe(id: ExecutionIdentity): ProbeResult {
    this.calls.probe++;
    return { kind: this.probeResult, detail: `synthetic probe for ${id.operationId}` } as ProbeResult;
  }
}

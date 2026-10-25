/**
 * FixtureTransport — a test-only DaemonTransport that replays a deterministic synthetic scenario.
 *
 * TEST-ONLY. It satisfies the exact production `DaemonTransport` contract, so the real
 * DaemonClient + DaemonProvider + LiveMissionControl drive it unmodified. It makes ZERO network
 * requests, ZERO IPC calls, ZERO daemon connections, ZERO filesystem access. It only pushes the
 * scenario's snapshot + events into the client. Owner-only decision semantics are preserved: it
 * exposes read-only state and never carries an approve/close capability.
 */
import type { DaemonTransport, TransportListener } from '../../src/daemon/ports';
import type { Scenario } from './fixtureData';

export class FixtureTransport implements DaemonTransport {
  readonly kind = 'fixture';
  readonly #listeners = new Set<TransportListener>();
  readonly #scenario: Scenario;

  constructor(scenario: Scenario) {
    this.#scenario = scenario;
  }

  connect(): void {
    const s = this.#scenario;
    if (s.disconnected) {
      this.#emit({ kind: 'closed' });
      return;
    }
    this.#emit({ kind: 'snapshot', snapshot: s.snapshot });
    for (const event of s.events) this.#emit({ kind: 'event', event });
  }

  disconnect(): void {
    /* nothing to tear down — no sockets, no processes */
  }

  onMessage(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Re-emit the deterministic snapshot (heartbeat asks for this). No I/O. */
  requestSnapshot(): void {
    if (this.#scenario.disconnected) return;
    this.#emit({ kind: 'snapshot', snapshot: this.#scenario.snapshot });
  }

  #emit(message: Parameters<TransportListener>[0]): void {
    for (const l of this.#listeners) l(message);
  }
}

// Origin: original ProjectOS code
/**
 * The ports the research rules are handed (PROJECTOS-PORT-RESEARCH1A).
 *
 * THIS MODULE OPENS NOTHING. Time, DNS and HTTP arrive as functions, so a test drives every rule with fakes and no
 * live network, shell or DNS is reached in this phase. A later phase wires real ports; the contract they must keep is
 * written here, because the rules depend on it:
 *
 *   - `HttpFetchPort` does NOT follow redirects. It returns the 3xx, and the guard judges the next hop itself.
 *   - `HttpFetchPort` dials ONLY `pinnedAddresses`, which the guard has just judged, and keeps the host name for the
 *     Host header and the certificate. Dialling the name again would reopen DNS rebinding.
 *   - `HttpFetchPort` says which address it connected to, in `connectedAddress`. The guard compares it with the addresses it
 *     pinned (IPv4-mapped and long IPv6 spellings compare equal) and refuses the response when it is absent, not an address
 *     or not pinned. This is the contract made executable: a port that dials something else is refused after the fact.
 *   - `HttpFetchPort` stops reading at `maxBytes` and says so in `truncated`. `maxBytes` applies AFTER decompression, to the
 *     bytes of the body the caller will see. The guard sets `accept-encoding: identity` itself and drops any the caller gave,
 *     but a server may compress anyway, so the port must count decompressed bytes. The guard re-checks `bytesRead` and the
 *     UTF-8 length of `body` against the cap.
 *   - `HttpFetchPort` enforces `timeoutMs` and stops on `signal`, which the guard aborts when its own wall clock for the call runs out.
 *   - `ResolverPort` answers addresses as text and does nothing else, and stops on `signal`.
 *   - `TimerPort.within` runs `work` with an `AbortSignal`, aborts it at `ms` and answers `{ done: false }`. The core never uses a timer
 *     of its own, so a hung planner, provider, resolver or port ends a run only through this port.
 */

export interface ResearchScope {
  readonly tenant: string;
  readonly project: string;
}

/** Milliseconds, from the injected clock only. Judged by `createClockGuard`, never trusted raw. */
export type ResearchClock = () => number;

export type ResolverPort = (host: string, signal?: AbortSignal) => Promise<readonly string[]>;

export interface HttpFetchRequest {
  readonly url: string;
  readonly pinnedAddresses: readonly string[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface HttpFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bytesRead: number;
  readonly truncated: boolean;
  /** The address the connection was made to, as text. Required: a response without it is refused. */
  readonly connectedAddress: string;
}

export type HttpFetchPort = (request: HttpFetchRequest) => Promise<HttpFetchResponse>;

/** A monotonic reading of the injected clock. Null when the clock gave no usable time or went backwards. */
export interface ClockGuard {
  readonly now: () => number | null;
}

/** The clock is read through this, so a clock that returns NaN, a string or an earlier time is a refusal, not a free pass. */
export function createClockGuard(clock: ResearchClock): ClockGuard {
  let last = Number.NEGATIVE_INFINITY;
  return {
    now: () => {
      let reading: unknown;
      try {
        reading = clock();
      } catch {
        return null;
      }
      if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0 || reading < last) return null;
      last = reading;
      return reading;
    },
  };
}

export type TimedResult<T> = { readonly done: true; readonly value: T } | { readonly done: false };

export interface TimerPort {
  readonly within: <T>(ms: number, work: (signal: AbortSignal) => Promise<T>) => Promise<TimedResult<T>>;
}

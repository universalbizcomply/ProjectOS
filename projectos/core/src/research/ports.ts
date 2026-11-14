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
 *   - `HttpFetchPort` stops reading at `maxBytes` and says so in `truncated`; it enforces `timeoutMs` itself.
 *   - `ResolverPort` answers addresses as text and does nothing else.
 */

export interface ResearchScope {
  readonly tenant: string;
  readonly project: string;
}

/** Milliseconds, from the injected clock only. Judged by `createClockGuard`, never trusted raw. */
export type ResearchClock = () => number;

export type ResolverPort = (host: string) => Promise<readonly string[]>;

export interface HttpFetchRequest {
  readonly url: string;
  readonly pinnedAddresses: readonly string[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bytesRead: number;
  readonly truncated: boolean;
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

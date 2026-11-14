import { createWebsitePolicy, type HttpFetchRequest, type HttpFetchResponse, type ResolverPort, type TimerPort, type WebsitePolicy } from '../src/research/index.js';

export const SCOPE = { tenant: 'acme-co', project: 'alpha-project' } as const;
export const OTHER_TENANT = { tenant: 'other-co', project: 'alpha-project' } as const;

export function policyOf(domains: readonly string[] = [], enabled = true): WebsitePolicy {
  const made = createWebsitePolicy({ enabled, domains });
  if (!made.ok) throw new Error(`policy: ${made.problems.join('; ')}`);
  return made.policy;
}

export const OPEN_POLICY = policyOf([], false);

/** A resolver that answers from a table, counts every call, and can answer a sequence (for rebinding). */
export function resolverOf(table: Readonly<Record<string, readonly string[] | readonly (readonly string[])[] | Error>>) {
  const calls: string[] = [];
  const seen: Record<string, number> = {};
  const resolver: ResolverPort = async (host) => {
    calls.push(host);
    const entry = table[host];
    if (entry === undefined) throw new Error(`no such host ${host}`);
    if (entry instanceof Error) throw entry;
    const nth = (seen[host] = (seen[host] ?? 0) + 1) - 1;
    const first = entry[0];
    return Array.isArray(first) ? ((entry as readonly (readonly string[])[])[Math.min(nth, entry.length - 1)] as readonly string[]) : (entry as readonly string[]);
  };
  return { resolver, calls };
}

export const PUBLIC_IP = '93.184.216.34';

export interface FakePage {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly truncated?: boolean;
  readonly bytesRead?: number;
  /** The address the port says it connected to. Absent: the first pinned address. `null`: the port gives none. */
  readonly connectedAddress?: string | null;
}

/** An HTTP port that answers from a table keyed by canonical URL, and records every request it was given. */
export function fetchOf(table: Readonly<Record<string, FakePage | Error>>) {
  const requests: HttpFetchRequest[] = [];
  const fetch = async (request: HttpFetchRequest): Promise<HttpFetchResponse> => {
    requests.push(request);
    const entry = table[request.url];
    if (entry === undefined) throw new Error(`no page for ${request.url}`);
    if (entry instanceof Error) throw entry;
    const body = entry.body ?? '';
    return {
      status: entry.status ?? 200,
      headers: entry.headers ?? { 'content-type': 'text/html; charset=utf-8' },
      body,
      bytesRead: entry.bytesRead ?? body.length,
      truncated: entry.truncated ?? false,
      ...(entry.connectedAddress === null ? {} : { connectedAddress: entry.connectedAddress ?? request.pinnedAddresses[0] ?? '' }),
    } as HttpFetchResponse;
  };
  return { fetch, requests };
}

export const html = (inner: string, title = 'A page'): string => `<!doctype html><html><head><title>${title}</title></head><body>${inner}</body></html>`;

export function clockOf(start = 1_000_000, step = 10) {
  let now = start;
  return { clock: () => (now += step), set: (value: number) => void (now = value) };
}

/** A timer port over setTimeout. When it expires it can advance the injected clock, so a deadline read from the clock is reached too. */
export function timerOf(advance?: (ms: number) => void): TimerPort {
  return {
    within: async (ms, work) => {
      const controller = new AbortController();
      let handle: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<{ readonly done: false }>((resolve) => {
        handle = setTimeout(() => {
          controller.abort();
          advance?.(ms);
          resolve({ done: false });
        }, ms);
      });
      try {
        return await Promise.race([work(controller.signal).then((value) => ({ done: true as const, value })), expired]);
      } finally {
        clearTimeout(handle);
      }
    },
  };
}

/** Never settles: a hung planner, provider, resolver or port. */
export const hang = <T>(): Promise<T> => new Promise<T>(() => undefined);

// Origin: original ProjectOS code
/**
 * Where a provider may be reached: the rules for a custom OpenAI-compatible endpoint, and for a local model.
 *
 * THE ADDRESS IS READ AS TEXT, NOT AS A URL OBJECT. A URL parser turns `2130706433`, `0x7f000001` and `127.1` into
 * `127.0.0.1`, so a check made after parsing would call an alias loopback. Here the host is cut from the string, it
 * must already be spelled as a loopback address, and anything with userinfo (`127.0.0.1@evil.com`) is refused before
 * the host is judged. A local endpoint accepts `127.0.0.0/8`, `::1` and the name `localhost`, and nothing else.
 * A custom endpoint is the opposite: https, a public DNS name, and never a literal address or this machine's own.
 *
 * What a name resolves to is not known here, so a public-looking name that points inside a network passes. The
 * transport phase owns that check at connect time.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;
const AUTHORITY = /^(\[[0-9a-fA-F:.]+\]|[^:/?#@\s[\]]+)(?::(\d{1,5}))?$/;
const PATH = /^(?:\/[^?#\s]*)?$/;
/** Names that resolve to this machine or its network by convention, and wildcard-DNS services that map any name to an address. */
const INTERNAL_SUFFIX = /(?:^|\.)(?:localhost|internal|local|nip\.io|sslip\.io|xip\.io|lvh\.me|localtest\.me|vcap\.me|lacolhost\.com|traefik\.me)$/i;

/** Four decimal octets exactly, each 0-255, with no leading zero ambiguity beyond a lone zero. */
function ipv4Octets(host: string): readonly number[] | null {
  const match = IPV4.exec(host);
  if (match === null) return null;
  const octets = match.slice(1).map((part) => (part.length > 1 && part.startsWith('0') ? Number.NaN : Number(part)));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

/** Loopback only: 127.0.0.0/8 written as four octets, `::1`, or the name `localhost`. */
export function isLoopbackHost(host: string): boolean {
  if (typeof host !== 'string') return false;
  if (host === '[::1]' || host === '::1') return true;
  if (host.toLowerCase() === 'localhost') return true;
  const octets = ipv4Octets(host);
  return octets !== null && octets[0] === 127;
}

/** A literal address that is this machine, a private range, link-local, carrier-grade NAT or unspecified. */
function isNonPublicLiteral(host: string): boolean {
  const octets = ipv4Octets(host);
  if (octets === null) return false;
  const [a = 0, b = 0] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

interface ParsedEndpoint {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number | null;
}

type EndpointParse = { readonly ok: true; readonly value: ParsedEndpoint } | { readonly ok: false; readonly problem: string };

function parseEndpoint(address: unknown): EndpointParse {
  if (typeof address !== 'string' || address === '' || /[\s\\]/.test(address)) return { ok: false, problem: 'the address is empty or has whitespace' };
  const split = /^(https?):\/\/([^/?#]*)(.*)$/.exec(address);
  if (split === null) return { ok: false, problem: 'the address is not an http or https address' };
  const [, scheme = '', authority = '', rest = ''] = split;
  if (authority.includes('@')) return { ok: false, problem: 'the address carries credentials' };
  const parts = AUTHORITY.exec(authority);
  if (parts === null) return { ok: false, problem: 'the address has no usable host' };
  if (!PATH.test(rest)) return { ok: false, problem: 'the address carries a query or a fragment' };
  const port = parts[2] === undefined ? null : Number(parts[2]);
  if (port !== null && !(port >= 1 && port <= 65535)) return { ok: false, problem: 'the port is out of range' };
  return { ok: true, value: { scheme: scheme as 'http' | 'https', host: parts[1] as string, port } };
}

/** Why this is not a loopback model endpoint, or null. Reads nothing: it judges the text. */
export function localEndpointProblem(address: unknown): string | null {
  const parsed = parseEndpoint(address);
  if (!parsed.ok) return parsed.problem;
  return isLoopbackHost(parsed.value.host) ? null : 'the host is not a loopback address';
}

/** Why this is not a usable custom endpoint: https only, a public DNS name, no literal or local address. */
function customEndpointProblem(address: unknown): string | null {
  const parsed = parseEndpoint(address);
  if (!parsed.ok) return parsed.problem;
  const { scheme, host } = parsed.value;
  if (scheme !== 'https') return 'a custom endpoint must be https';
  if (host.startsWith('[')) return 'a custom endpoint may not be an IPv6 literal';
  if (isLoopbackHost(host) || isNonPublicLiteral(host)) return 'a custom endpoint may not be this machine or a private address';
  if (!DNS_NAME.test(host)) return 'a custom endpoint must be a public DNS name';
  if (INTERNAL_SUFFIX.test(host)) return 'a custom endpoint may not be an internal or wildcard-DNS name';
  return null;
}

export const PROVIDER_KINDS = ['hosted', 'custom-openai-compatible', 'local'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The endpoint rule for a provider kind. A hosted provider uses its vendor's own address and may not name one. */
export function endpointProblem(record: { readonly kind: ProviderKind; readonly baseUrl?: unknown }): string | null {
  switch (record.kind) {
    case 'hosted':
      return record.baseUrl === undefined ? null : 'a hosted provider uses its own address and may not name one';
    case 'custom-openai-compatible':
      return customEndpointProblem(record.baseUrl);
    case 'local':
      return localEndpointProblem(record.baseUrl);
  }
}

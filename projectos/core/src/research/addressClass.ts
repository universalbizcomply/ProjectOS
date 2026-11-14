// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/url_safety.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript with a hand-written address parser; the address classes are written out as ranges; IPv4-mapped, IPv4-translated and IPv4-compatible IPv6 are classified by the IPv4 they carry; NAT64, 6to4, Teredo and every IPv6 range outside 2000::/3 are refused, where upstream allowed what Python called global; the allow-private toggle, the fake-IP declaration and the trusted-private-host exception are cut, so the only answers are public and refused
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Which addresses a research request may never reach.
 *
 * AN ADDRESS IS PUBLIC OR IT IS REFUSED. There is no switch that allows a private range, and the cloud metadata
 * addresses are named on their own so a refusal says "metadata" and not merely "private". An answer that does not
 * parse is refused: a resolver's odd spelling is not a way round the check.
 *
 * Wrappers are read through. `::ffff:127.0.0.1`, `::ffff:0:127.0.0.1` and `::127.0.0.1` are the IPv4 they carry,
 * because a client that dials them reaches that IPv4. The URL parser has already turned decimal, octal and hex
 * spellings (`2130706433`, `0177.0.0.1`, `0x7f.1`) into dotted quads before an address gets here.
 *
 * WHAT THIS CANNOT PROVE. That an address is the one a connection really reaches: that is the fetch port's contract
 * (it dials only the addresses judged here). Pure.
 */

export type AddressReason =
  | 'unparseable-address'
  | 'unspecified-address'
  | 'loopback-address'
  | 'private-address'
  | 'link-local-address'
  | 'cgnat-address'
  | 'benchmark-address'
  | 'documentation-address'
  | 'reserved-address'
  | 'multicast-address'
  | 'translation-address'
  | 'metadata-address';

export type AddressClass = { readonly blocked: false } | { readonly blocked: true; readonly reason: AddressReason };

const PUBLIC: AddressClass = { blocked: false };
const refuse = (reason: AddressReason): AddressClass => ({ blocked: true, reason });

/** The cloud metadata and credential endpoints, the commonest SSRF target. Always refused. */
const METADATA_V4: readonly string[] = ['169.254.169.254', '169.254.170.2', '169.254.169.253', '100.100.100.200'];
const METADATA_V6_HEXTETS = [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254] as const;

const DOTTED = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** Four decimal octets exactly. A leading zero is refused: `010.0.0.1` is octal to some parsers and decimal to others. */
export function parseIpv4(text: string): readonly number[] | null {
  const match = DOTTED.exec(text);
  if (match === null) return null;
  const octets = match.slice(1).map((part) => (part.length > 1 && part.startsWith('0') ? Number.NaN : Number(part)));
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

/** Eight 16-bit groups. Accepts `::` compression and a dotted IPv4 tail; a zone id and brackets are stripped, as upstream strips the scope. */
export function parseIpv6(text: string): readonly number[] | null {
  let body = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  const zone = body.indexOf('%');
  if (zone >= 0) {
    if (!/^[A-Za-z0-9_.-]+$/.test(body.slice(zone + 1))) return null;
    body = body.slice(0, zone);
  }
  if (body === '' || /[^0-9a-fA-F:.]/.test(body)) return null;
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];
    const pieces = part.split(':');
    const out: number[] = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i] as string;
      if (piece.includes('.')) {
        const tail = i === pieces.length - 1 ? parseIpv4(piece) : null;
        if (tail === null) return null;
        out.push(((tail[0] as number) << 8) | (tail[1] as number), ((tail[2] as number) << 8) | (tail[3] as number));
      } else if (HEXTET.test(piece)) {
        out.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = groupsOf(halves[0] as string);
  const tail = halves.length === 2 ? groupsOf(halves[1] as string) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing < 1 ? null : [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function classifyIpv4(octets: readonly number[]): AddressClass {
  const [a = 0, b = 0, c = 0] = octets;
  if (METADATA_V4.includes(octets.join('.'))) return refuse('metadata-address');
  if (a === 0) return refuse('unspecified-address');
  if (a === 10) return refuse('private-address');
  if (a === 100 && b >= 64 && b <= 127) return refuse('cgnat-address');
  if (a === 127) return refuse('loopback-address');
  if (a === 169 && b === 254) return refuse('link-local-address');
  if (a === 172 && b >= 16 && b <= 31) return refuse('private-address');
  if (a === 192 && b === 0 && c === 0) return refuse('reserved-address');
  if (a === 192 && b === 0 && c === 2) return refuse('documentation-address');
  if (a === 192 && b === 88 && c === 99) return refuse('reserved-address');
  if (a === 192 && b === 168) return refuse('private-address');
  if (a === 198 && (b === 18 || b === 19)) return refuse('benchmark-address');
  if (a === 198 && b === 51 && c === 100) return refuse('documentation-address');
  if (a === 203 && b === 0 && c === 113) return refuse('documentation-address');
  if (a >= 224 && a <= 239) return refuse('multicast-address');
  if (a >= 240) return refuse('reserved-address');
  return PUBLIC;
}

const v4Of = (high: number, low: number): readonly number[] => [high >> 8, high & 0xff, low >> 8, low & 0xff];
const zeros = (groups: readonly number[], from: number, to: number): boolean => groups.slice(from, to).every((g) => g === 0);

function classifyIpv6(g: readonly number[]): AddressClass {
  const [g0 = 0, g1 = 0] = g;
  if (METADATA_V6_HEXTETS.every((value, i) => g[i] === value)) return refuse('metadata-address');
  if (zeros(g, 0, 8)) return refuse('unspecified-address');
  if (zeros(g, 0, 7) && g[7] === 1) return refuse('loopback-address');
  const carried = v4Of(g[6] as number, g[7] as number);
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-translated ::ffff:0:a.b.c.d: the address is the IPv4 it carries.
  if ((zeros(g, 0, 5) && g[5] === 0xffff) || (zeros(g, 0, 4) && g[4] === 0xffff && g[5] === 0)) return classifyIpv4(carried);
  // IPv4-compatible ::a.b.c.d: refused, and named for the IPv4 when that is itself refused.
  if (zeros(g, 0, 6)) {
    const inner = classifyIpv4(carried);
    return inner.blocked ? inner : refuse('reserved-address');
  }
  if (g0 === 0x64 && g1 === 0xff9b && zeros(g, 2, 6)) return refuse('translation-address');
  if (g0 === 0x2002 || (g0 === 0x2001 && g1 === 0)) return refuse('translation-address');
  if ((g0 & 0xfe00) === 0xfc00) return refuse('private-address');
  if ((g0 & 0xffc0) === 0xfe80) return refuse('link-local-address');
  if ((g0 & 0xffc0) === 0xfec0) return refuse('private-address');
  if ((g0 & 0xff00) === 0xff00) return refuse('multicast-address');
  if (g0 === 0x2001 && g1 === 0x0db8) return refuse('documentation-address');
  if (g0 === 0x3fff && g1 < 0x1000) return refuse('documentation-address');
  if (g0 === 0x2001 && g1 < 0x0200) return refuse('reserved-address');
  // Only 2000::/3 is global unicast. Every other range is reserved, whatever Python would call it.
  return (g0 & 0xe000) === 0x2000 ? PUBLIC : refuse('reserved-address');
}

/** Public, or refused with the class. The text is judged as an address and nothing else. */
export function classifyAddress(text: unknown): AddressClass {
  if (typeof text !== 'string' || text === '') return refuse('unparseable-address');
  const v4 = parseIpv4(text);
  if (v4 !== null) return classifyIpv4(v4);
  const v6 = parseIpv6(text);
  return v6 === null ? refuse('unparseable-address') : classifyIpv6(v6);
}

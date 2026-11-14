// Origin: original ProjectOS code
/**
 * The idempotency key of a model call, derived from what the call is.
 *
 * A KEY THE CALLER MADE UP IS NOT A KEY. The key is `sha256:` over the tenant, the project, the request id and the
 * hash of the prompt, so it names one logical request and nothing else. The broker recomputes it and refuses a
 * request whose key is not the one its own fields give: a caller cannot mint a fresh attempt count with a random
 * key, and cannot reuse one request's count for another prompt.
 */

import { sha256Hex } from '../execution/evidence.js';

export interface KeyedRequestFields {
  readonly tenant: string;
  readonly project: string;
  readonly requestId: string;
  readonly prompt: string;
}

/** Length-prefixed, so a field boundary cannot be moved: `a`+`bc` is not `ab`+`c`. */
const part = (value: string): string => `${value.length}:${value}`;

export function bindingKeyOf(fields: KeyedRequestFields): string {
  return `sha256:${sha256Hex(`${part(fields.tenant)}${part(fields.project)}${part(fields.requestId)}${part(sha256Hex(fields.prompt))}`)}`;
}

export interface FingerprintedFields {
  readonly chain: readonly { readonly provider: string; readonly model: string }[];
  readonly maxOutputTokens: number;
  readonly phaseId: string;
  readonly budget: { readonly maxMicroUsd: number };
}

/**
 * What the key leaves out: the chain, the output cap, the phase and the budget ceiling. The store keeps it with the
 * key, and a request that arrives with the same key and a different fingerprint is refused, not served.
 */
export function fingerprintOf(fields: FingerprintedFields): string {
  const routes = fields.chain.map((entry) => `${part(entry.provider)}${part(entry.model)}`).join('|');
  return sha256Hex(`${part(routes)}${part(String(fields.maxOutputTokens))}${part(fields.phaseId)}${part(String(fields.budget.maxMicroUsd))}`);
}

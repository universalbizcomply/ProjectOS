// Origin: original ProjectOS code
/**
 * WHOSE MEMORY A RUN MAY BE SHOWN (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * Retrieval is keyed on ONE thing: the admitted run envelope's tenant, domain and project. The key is worked out here from the
 * envelope and from nothing else, so no request, no stored file and no worker can say which project's notes it wants. An
 * envelope that is missing gives no key, and no key means nothing is retrieved: the manager fails closed.
 *
 * CALLER-ASSERTED IDENTITY IS NOT PROOF. Core cannot tell a minted envelope from a copy of one (the kernel's admitted list is
 * private to `taskEnvelope.ts`), so the agent's one source is `admittedRunEnvelopeOf`, and this file refuses what a hand-made
 * object can get wrong: a field that does not parse (R1, by `parseEnvelope`), an unknown field, an envelope that is not a run
 * (a crossing or a read), a run whose scope does not name its own project, and one past its expiry. The envelope is read ONCE
 * into a frozen copy (a getter, a symbol key and a prototype key are refused), and a Proxy is refused by a port the agent
 * supplies, because core imports no `node:` module and cannot ask. A refusal never quotes the envelope.
 *
 * Pure: no I/O, no clock of its own (the instant is handed in).
 */
import { plainListOf, plainRecordOf } from '../memory/memoryShapes.js';
import { ENVELOPE_FIELDS, envelopeExpired, parseEnvelope } from '../taskEnvelope.js';
import type { Domain } from '../tenant.js';

/** The one action whose envelope keys retrieval: a run's own start. */
export const CONTEXT_MANAGER_RUN_ACTION = 'run-start';

export type ContextManagerKeyCode =
  | 'CONTEXT_MANAGER_NO_ENVELOPE'
  | 'CONTEXT_MANAGER_ENVELOPE_INVALID'
  | 'CONTEXT_MANAGER_NOT_A_RUN'
  | 'CONTEXT_MANAGER_ENVELOPE_EXPIRED';

export interface ContextRetrievalKey {
  readonly envelopeId: string;
  readonly tenant: string;
  readonly domain: Domain;
  readonly project: string;
}

export type ContextRetrievalKeyResult =
  | { readonly ok: true; readonly key: ContextRetrievalKey }
  | { readonly ok: false; readonly code: ContextManagerKeyCode; readonly message: string };

const MAX_SCOPE_ENTRIES = 64;
const ACTOR_FIELDS = ['agent', 'provider', 'model'] as const;

function refuse(code: ContextManagerKeyCode, message: string): ContextRetrievalKeyResult {
  return { ok: false, code, message };
}

const invalid = (why: string): ContextRetrievalKeyResult => refuse('CONTEXT_MANAGER_ENVELOPE_INVALID', `No retrieval: the run envelope ${why}.`);

/** Exactly `false`, from a port that exists and does not throw. Anything else is a Proxy, or unknown, and refuses. */
function isPlainByPort(isProxy: unknown, value: unknown): boolean {
  if (typeof isProxy !== 'function') return false;
  try {
    return (isProxy as (value: unknown) => unknown)(value) === false;
  } catch {
    return false;
  }
}

/** The envelope's own data properties, read once, with its list and its actor copied the same way. */
function copiedEnvelope(envelope: unknown): Readonly<Record<string, unknown>> | null {
  const read = plainRecordOf(envelope, ENVELOPE_FIELDS);
  if (!read.ok) return null;
  const scope = plainListOf(read.value['scope'], MAX_SCOPE_ENTRIES);
  const actor = plainRecordOf(read.value['actor'], ACTOR_FIELDS);
  if (scope === null || !actor.ok) return null;
  return { ...read.value, scope: Object.freeze([...scope]), actor: actor.value };
}

/** The key this admitted run retrieves under, or the reason there is none. */
export function contextRetrievalKeyOf(envelope: unknown, isProxy: unknown, nowIso: unknown): ContextRetrievalKeyResult {
  if (envelope === null || envelope === undefined) return refuse('CONTEXT_MANAGER_NO_ENVELOPE', 'No retrieval: this run has no admitted envelope, so no project is named.');
  if (!isPlainByPort(isProxy, envelope)) return invalid('could not be shown to be plain data');
  const copy = copiedEnvelope(envelope);
  if (copy === null) return invalid('is not plain data of the envelope shape');
  const parsed = parseEnvelope(copy);
  if (!parsed.ok) return invalid('does not parse');
  const run = parsed.envelope;
  if (run.action !== CONTEXT_MANAGER_RUN_ACTION) return refuse('CONTEXT_MANAGER_NOT_A_RUN', 'No retrieval: only the envelope of a run keys it.');
  if (!run.scope.includes(`project:${run.project}`)) return refuse('CONTEXT_MANAGER_NOT_A_RUN', 'No retrieval: the run does not name its own project in its scope.');
  if (typeof nowIso !== 'string' || envelopeExpired(run, nowIso)) return refuse('CONTEXT_MANAGER_ENVELOPE_EXPIRED', 'No retrieval: the run envelope has expired, or the time could not be read.');
  return { ok: true, key: Object.freeze({ envelopeId: run.envelopeId, tenant: run.tenant, domain: run.domain, project: run.project }) };
}

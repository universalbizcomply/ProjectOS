/**
 * The owner interface's authority boundary, written before the bridge exists.
 *
 * WHAT IS BEING PREPARED. The approved scope allows "a SMALL private ProjectOS MCP bridge reachable
 * from ChatGPT over the Secure MCP Tunnel", and only if Developer mode and the tunnel turn out to be
 * available on the owner's own account — a fact to be established from the owner's screen, not from
 * documentation. The tunnel client also needs a runtime API key, so the bridge sits behind the same
 * commercial gate as the reviewer. None of that has happened. This module is the part that can be
 * built and proven without any of it: WHAT THE BRIDGE WOULD BE ALLOWED TO DO.
 *
 * WHY THIS IS THE PART TO BUILD FIRST. A bridge is an instruction channel from a conversation into a
 * governed machine. The conversation contains text written by a person, text written by a model, and
 * — once evidence is pasted into it — text written by whatever the evidence quoted. If the set of
 * operations is decided by reading that text, then everything downstream is a matter of phrasing. So
 * the operation is selected by EXACT NAME from a closed list, arguments are identifiers rather than
 * prose, and anything else is refused. There is no natural-language route into this surface, by
 * construction rather than by filtering.
 *
 * A REFUSAL IS A RECORD, NOT A DROP. The plan requires it explicitly, and the reason is that a
 * silently dropped request is indistinguishable from one that was never made — which is the state in
 * which a probing conversation learns nothing and an auditor learns nothing either.
 *
 * WHAT THE BRIDGE MAY NEVER DO, whatever it is asked: deploy, mutate a database, run an arbitrary
 * command, transmit an external message, make a payment, reach credential material, or sign. Those
 * are not operations with strict arguments — they are absent from the vocabulary entirely.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */

/** Everything the bridge may read. Read operations return governed state and change nothing. */
export const BRIDGE_READ_OPERATIONS = [
  'project-state',
  'active-phase',
  'pending-gate',
  'evidence',
  'worker-status',
  'cost-status',
] as const;

/**
 * Everything the bridge may do that is not a read.
 *
 * `record-owner-decision` WAS HERE AND HAS BEEN REMOVED, by the owner's ruling of 2026-08-17:
 * "ChatGPT / OpenAI MUST NOT impersonate Murad." The operation was the wrong shape, not merely a
 * risky one — a bridge operation named "record the owner's decision" is, from the far end, an
 * operation named "write `decidedBy: Murad`", and the conversation at the far end contains text
 * written by a model. What replaces it is `submit-owner-intent`: the bridge may TRANSPORT what the
 * owner says, and the resulting artefact is explicitly an intent, not a decision. Turning an intent
 * into owner authority requires a receipt from a separately verifiable owner action, which is not
 * something this surface can produce.
 *
 * Note what the rest are NOT. `record-bound-decision` records the GATEKEEPER's decision, whose
 * authority comes from a delegation; it can carry closure where the delegation permits it, and it can
 * never carry owner provenance. `continue-authorised-work` continues work that is ALREADY authorised;
 * it does not authorise. `stop-work` is the only one needing no authority at all, because stopping is
 * always safe.
 */
export const BRIDGE_GOVERNANCE_OPERATIONS = [
  'record-bound-decision',
  'submit-owner-intent',
  'continue-authorised-work',
  'stop-work',
] as const;

/**
 * Provenance the bridge may never assert, whatever operation it is performing.
 *
 * A request carrying any of these fields is claiming to BE someone rather than to be speaking for
 * them, and the difference is the whole of the owner's ruling.
 */
export const PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT: readonly string[] = [
  'decidedBy',
  'grantedBy',
  'approvedBy',
  'delegatedBy',
  'ownerChoice',
];

export type BridgeOperation =
  | (typeof BRIDGE_READ_OPERATIONS)[number]
  | (typeof BRIDGE_GOVERNANCE_OPERATIONS)[number];

export const BRIDGE_OPERATIONS: readonly BridgeOperation[] = [
  ...BRIDGE_READ_OPERATIONS,
  ...BRIDGE_GOVERNANCE_OPERATIONS,
];

/**
 * Operations that need an existing authorisation to name.
 *
 * `continue-authorised-work` is the dangerous-looking one and the reason this list exists: continuing
 * is only safe if something else already said yes, so the request must POINT AT that yes rather than
 * assert it.
 */
export const OPERATIONS_REQUIRING_PRIOR_AUTHORITY: readonly BridgeOperation[] = [
  'continue-authorised-work',
  'record-bound-decision',
];

/** A request arriving over the bridge. Every field is untrusted; `operation` is matched exactly. */
export interface BridgeRequest {
  readonly operation?: unknown;
  readonly projectId?: unknown;
  /** Identifier arguments only. Never a sentence, never a path, never a command. */
  readonly arguments?: unknown;
  /** The authorisation this request points at, where one is required. */
  readonly authorityRef?: unknown;
  /**
   * Deliberately declared and always refused. Naming the field in the type is how a reader learns
   * that asserting it is a known, checked failure rather than an unconsidered gap.
   */
  readonly decidedBy?: never;
}

export interface BridgeContext {
  /** Projects this bridge is bound to. A request naming any other project is not its business. */
  readonly boundProjectIds: readonly string[];
  /** Authorisation ids the runtime has actually recorded. Never the ids a request claims exist. */
  readonly recordedAuthorityIds: readonly string[];
}

/** A refusal, shaped to be written down. */
export interface BridgeRefusal {
  readonly allowed: false;
  readonly operation: string;
  readonly reasons: readonly string[];
}

export interface BridgeAllowed {
  readonly allowed: true;
  readonly operation: BridgeOperation;
  readonly readOnly: boolean;
}

export type BridgeVerdict = BridgeAllowed | BridgeRefusal;

/**
 * Identifier arguments only: no spaces, no punctuation that could carry a path or a command.
 *
 * The dot is allowed because real identifiers contain it, but a DOUBLE dot is not: `..` is the one
 * dot sequence that traverses, and an argument that reaches a path or a git revision downstream would
 * carry it. A leading dash is refused for the same reason — a value that starts one looks like an
 * option to any command that ever receives it.
 */
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
const TRAVERSAL = /\.\./;

/**
 * Argument names that are not data.
 *
 * Assigning to any of these on a plain object reaches the prototype chain rather than the object, so
 * an argument set containing one is not a set of arguments — it is an attempt to change how every
 * object in the process behaves.
 */
const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'prototype'];

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * What may be quoted back in a refusal.
 *
 * A REFUSAL IS WRITTEN DOWN, and the far end of this bridge is a conversation containing text written
 * by a model. Echoing an arbitrary request verbatim into a durable governance record would let that
 * conversation choose the contents of a ProjectOS artefact — unbounded in length, and free to contain
 * whatever reads convincingly to whoever opens the file next. So the echo is truncated hard and
 * stripped of everything that is not plainly printable.
 */
function safeEcho(value: string): string {
  const cleaned = Array.from(value)
    .filter((ch) => ch >= ' ' && ch !== '')
    .join('')
    .slice(0, 64);
  return cleaned === '' ? '(unprintable)' : cleaned;
}

/**
 * May the bridge perform this request?
 *
 * FAILS CLOSED IN EVERY DIRECTION. An unknown operation, a project the bridge is not bound to, an
 * argument that reads like prose, a claimed authority the runtime never recorded — each is a refusal,
 * and the refusal names what was asked so it can be written down.
 */
export function checkBridgeRequest(request: BridgeRequest, context: BridgeContext): BridgeVerdict {
  const reasons: string[] = [];
  const rawOperation = text(request.operation);
  const named = rawOperation ?? '(none)';

  // THE VOCABULARY IS THE CONTROL. A request is not parsed for intent; it is matched or refused.
  if (rawOperation === null || !(BRIDGE_OPERATIONS as readonly string[]).includes(rawOperation)) {
    return {
      allowed: false,
      operation: named,
      reasons: [
        `'${safeEcho(named)}' is not an operation this bridge exposes; the bridge offers exactly: ` +
          `${BRIDGE_OPERATIONS.join(', ')} — and no phrasing adds to that list`,
      ],
    };
  }
  const operation = rawOperation as BridgeOperation;

  const projectId = text(request.projectId);
  if (projectId === null) {
    reasons.push('the request names no project');
  } else if (!context.boundProjectIds.includes(projectId)) {
    reasons.push(
      `the bridge is not bound to project '${safeEcho(projectId)}'; it can act only for ` +
        `${context.boundProjectIds.join(', ') || '(no project)'}`,
    );
  }

  // ARGUMENTS ARE IDENTIFIERS. This is where an instruction would try to enter.
  const args = request.arguments;
  if (args !== undefined && args !== null) {
    if (typeof args !== 'object' || Array.isArray(args)) {
      reasons.push('arguments must be a set of named identifier values');
    } else {
      for (const key of Object.getOwnPropertyNames(args as object)) {
        // NOT DATA. Assigning any of these reaches the prototype chain rather than the object, so a
        // request carrying one is not passing an argument. Refused BY NAME and before the identifier
        // rule, because `__proto__` satisfies the identifier rule perfectly well.
        if (PROTOTYPE_KEYS.includes(key)) {
          reasons.push(`argument name '${safeEcho(key)}' is a prototype key, which is not an argument`);
          continue;
        }
        if (!IDENTIFIER.test(key)) {
          reasons.push(`argument name ${JSON.stringify(safeEcho(key))} is not an identifier`);
          continue;
        }
        const value = (args as Record<string, unknown>)[key];
        const asText = text(value);
        if (asText === null) {
          reasons.push(`argument '${key}' has no usable value`);
        } else if (!IDENTIFIER.test(asText)) {
          reasons.push(
            `argument '${key}' carries free text rather than an identifier; the bridge takes no prose, ` +
              'so nothing written in a conversation can become an instruction here',
          );
        } else if (TRAVERSAL.test(asText)) {
          reasons.push(
            `argument '${key}' contains a double dot, which traverses; an identifier that reaches a path ` +
              'or a git revision downstream must not be able to leave where it was pointed',
          );
        } else if (asText.startsWith('-')) {
          reasons.push(
            `argument '${key}' starts with a dash, which any command receiving it would read as an option`,
          );
        }
      }
    }
  }

  // POINTING AT AN AUTHORITY IS NOT THE SAME AS HAVING ONE.
  if (OPERATIONS_REQUIRING_PRIOR_AUTHORITY.includes(operation)) {
    const ref = text(request.authorityRef);
    if (ref === null) {
      reasons.push(`'${operation}' must name the authority it relies on; it cannot create one`);
    } else if (!context.recordedAuthorityIds.includes(ref)) {
      reasons.push(
        `'${operation}' names authority '${ref}', which ProjectOS has not recorded; a request cannot ` +
          'establish the permission it is asking to use',
      );
    }
  }

  // IMPERSONATION IS REFUSED AT THE FIELD LEVEL, not just by removing the operation. A request that
  // carries `decidedBy` is asserting provenance whatever it is otherwise asking for, and the bridge
  // may speak FOR the owner but never AS them.
  // CASE-INSENSITIVE, AND OVER OWN PROPERTY NAMES. An exact-case denylist over an object whose keys
  // the far end chooses is not a denylist: `DecidedBy` and `decidedby` sail straight through while
  // meaning exactly the same thing to any consumer that later reads the field case-insensitively.
  const provenanceLower = PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT.map((f) => f.toLowerCase());
  const argObject =
    request.arguments !== null && typeof request.arguments === 'object' && !Array.isArray(request.arguments)
      ? (request.arguments as object)
      : null;
  for (const key of Object.getOwnPropertyNames(request as object)) {
    if (provenanceLower.includes(key.toLowerCase())) {
      reasons.push(
        `the request asserts '${safeEcho(key)}'; the bridge may transport what the owner says but may ` +
          'never manufacture the provenance of the owner, which requires a separately verifiable owner action',
      );
    }
  }
  if (argObject !== null) {
    for (const key of Object.getOwnPropertyNames(argObject)) {
      if (provenanceLower.includes(key.toLowerCase())) {
        reasons.push(`argument '${safeEcho(key)}' asserts provenance the bridge cannot hold`);
      }
    }
  }

  if (reasons.length > 0) return { allowed: false, operation: named, reasons };

  return {
    allowed: true,
    operation,
    readOnly: (BRIDGE_READ_OPERATIONS as readonly string[]).includes(operation),
  };
}

/**
 * Effects the bridge has no vocabulary for.
 *
 * Exported so a reviewer can see the list rather than infer it from an absence, and so a test can
 * assert that none of them ever becomes an operation. A guard that checks for these at request time
 * would be the wrong shape: it would imply they are operations that happen to be blocked.
 */
export const EFFECTS_ABSENT_FROM_THE_BRIDGE: readonly string[] = [
  'deploy',
  'database-mutation',
  'shell-command',
  'external-message',
  'payment',
  'credential-access',
  'sign',
];

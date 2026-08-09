/**
 * The governed command vocabulary — the ONLY things the owner surface may ask the runtime to do.
 *
 * The Control Centre must not become a remote shell. The UI never sends a command line; it sends a
 * verb from this closed set plus typed arguments, and the sidecar translates that verb into a
 * canonical `@projectos/agent` call.
 *
 * NO ARGV ROUND TRIP. An earlier revision mapped verbs to an argv string array which the agent then
 * re-parsed with its positional flag parser. That reintroduced classic argument injection: the
 * agent's parser treats `--flag --force` as TWO booleans rather than a flag whose value is
 * `"--force"`, so a `note` of `"--force"` smuggled a bare `--force` into `phase new` and silently
 * overwrote an existing phase record — destroying an owner-authorised closure and its entire audit
 * trail. A security review demonstrated it end to end. The mapping now produces a typed FLAGS OBJECT
 * handed straight to the command function, so there is no parsing step for a value to escape
 * through: flag NAMES are literals written here, and caller input only ever supplies VALUES.
 *
 * Every verb maps onto an operation the runtime ALREADY has. No new lifecycle verbs are invented:
 * stop/resume are not core phase statuses, so they are expressed as the transitions the state
 * machine really supports (`rolled_back`, and `rolled_back -> draft` to resume).
 *
 * Shared by the browser (which builds requests) and the sidecar (which validates and executes them),
 * so both ends agree by construction. Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */

export const GOVERNED_COMMAND_KIND = 'governed-command';
export const GOVERNED_RESULT_KIND = 'governed-result';

/** The closed verb set. Adding a verb here is a deliberate governance decision, not a UI detail. */
export const GOVERNED_VERBS = [
  'refresh',
  'phase.start',
  'phase.advance',
  'phase.stop',
  'phase.resume',
  'phase.close',
  'approval.request',
  'approval.decide',
  'report.write',
] as const;

export type GovernedVerb = (typeof GOVERNED_VERBS)[number];

/**
 * Typed arguments. Deliberately narrow: identifiers, enumerated statuses and short prose. There is
 * no field anywhere in this shape that can carry a command line, a path or a flag.
 */
export interface GovernedCommandArgs {
  readonly phaseId?: string;
  readonly toStatus?: string;
  readonly role?: string;
  readonly identity?: string;
  readonly note?: string;
  readonly approvalId?: string;
  readonly action?: string;
  readonly decision?: string;
}

export type GovernedArgName = keyof GovernedCommandArgs;

export interface GovernedCommandRequest {
  readonly kind: typeof GOVERNED_COMMAND_KIND;
  readonly verb: GovernedVerb;
  readonly args: GovernedCommandArgs;
  /** Correlates the reply with the request that caused it. Non-secret, bounded. */
  readonly correlationId: string;
}

export interface GovernedCommandResult {
  readonly kind: typeof GOVERNED_RESULT_KIND;
  readonly correlationId: string;
  /** The runtime's own exit code. 0 = performed; 2 = governance refusal; 1 = usage/illegal. */
  readonly code: number;
  /** The runtime's own output lines, VERBATIM. Refusals are never reworded or summarised. */
  readonly lines: readonly string[];
  readonly verb: GovernedVerb | null;
}

/** Bounded so a malformed or hostile field cannot become an unbounded write. */
export const MAX_ARG_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;
export const MAX_CORRELATION_LENGTH = 64;

/**
 * Identifiers must START with an alphanumeric. Without that anchor `--force` and `-f` are valid
 * identifiers — every character is in the class — and an identifier beginning with `-` is not an
 * identifier at all once it reaches an argv parser: it is a flag.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Prose fields: spaces and punctuation yes, control characters never — a newline would smuggle a
 * second line into the sidecar's per-line stdin protocol. A leading `-` is refused too: the flags
 * object already makes flag injection structurally impossible, but a value that LOOKS like a flag
 * has no legitimate use here and refusing it keeps the boundary obvious. Written as an explicit
 * code-point test rather than a regex character class, because a literal control-character class is
 * exactly the kind of thing an editor or a patch silently mangles.
 */
function isProse(value: string, maxLength: number): boolean {
  if (value.length > maxLength) return false;
  if (value.startsWith('-')) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export type GovernedCommandRefusal =
  | 'MALFORMED_REQUEST'
  | 'UNKNOWN_VERB'
  | 'INVALID_ARGUMENT'
  | 'MISSING_ARGUMENT';

export type GovernedCommandValidation =
  | { readonly ok: true; readonly request: GovernedCommandRequest }
  | { readonly ok: false; readonly code: GovernedCommandRefusal; readonly detail: string };

function isVerb(v: unknown): v is GovernedVerb {
  return typeof v === 'string' && (GOVERNED_VERBS as readonly string[]).includes(v);
}

/**
 * Which actor role each verb may claim.
 *
 * THE RENDERER IS NOT THE OWNER. Without this table `role` was merely "a well-formed identifier", so
 * a caller could send `role: 'owner'` with no identity, and the owner branch of `authoriseClosure` —
 * which only validates a STATED identity — would mint an owner-basis grant unconditionally. That is
 * a complete bypass of the delegation system from inside the webview.
 *
 * So the browser may only ever act as `implementer`, except for closure, where it may only act as
 * `advisor` and MUST name the delegate. Owner authority is deliberately unreachable from this
 * channel: an owner acts through the CLI, where their authority is not asserted by a web page.
 */
const ALLOWED_ROLES: Readonly<Record<GovernedVerb, readonly string[]>> = {
  refresh: [],
  'phase.start': ['implementer'],
  'phase.advance': ['implementer'],
  'phase.stop': ['implementer'],
  'phase.resume': ['implementer'],
  'phase.close': ['advisor'],
  'approval.request': ['implementer'],
  'approval.decide': ['implementer', 'advisor'],
  'report.write': ['implementer'],
};

/**
 * Statuses `phase.advance` may target. Terminal statuses are absent on purpose: closure has its own
 * verb with its own role and identity rules, and must not be reachable as "just another advance".
 */
const ADVANCEABLE_STATUSES: readonly string[] = [
  'draft',
  'prompted',
  'implementing',
  'validating',
  'evidence',
  'awaiting_review',
  'awaiting_closure',
  'rolled_back',
];

const DECISIONS: readonly string[] = ['approved', 'rejected'];

/**
 * Arguments each verb ACCEPTS, and which of them it REQUIRES.
 *
 * Scoped per verb, not globally. A global allowlist is how `note` reached `phase.start` in the first
 * place — the verb had no use for it, but the mapping forwarded it anyway, and that was the vehicle
 * for the flag-injection defect. An argument a verb has no use for is now refused outright.
 */
const ARG_SPEC: Readonly<
  Record<
    GovernedVerb,
    { readonly accepts: readonly GovernedArgName[]; readonly requires: readonly GovernedArgName[] }
  >
> = {
  refresh: { accepts: [], requires: [] },
  'phase.start': { accepts: ['phaseId', 'role'], requires: ['phaseId'] },
  'phase.advance': { accepts: ['phaseId', 'toStatus', 'role', 'note'], requires: ['phaseId', 'toStatus'] },
  'phase.stop': { accepts: ['phaseId', 'role', 'note'], requires: ['phaseId'] },
  'phase.resume': { accepts: ['phaseId', 'role', 'note'], requires: ['phaseId'] },
  'phase.close': { accepts: ['phaseId', 'role', 'identity', 'note'], requires: ['phaseId', 'role', 'identity'] },
  'approval.request': { accepts: ['approvalId', 'action', 'role'], requires: ['approvalId', 'action'] },
  'approval.decide': { accepts: ['approvalId', 'decision', 'role', 'note'], requires: ['approvalId', 'decision'] },
  'report.write': { accepts: ['phaseId', 'role'], requires: ['phaseId'] },
};

const PROSE_ARGS: readonly GovernedArgName[] = ['note', 'action'];

/**
 * Validate an untrusted request into a typed one. Fails closed on anything unexpected — an unknown
 * verb, an argument the verb does not accept, a malformed identifier, an over-long field, a role the
 * channel may not claim, or a status that is really a closure in disguise.
 */
export function validateGovernedCommand(value: unknown): GovernedCommandValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'MALFORMED_REQUEST', detail: 'request is not an object' };
  }
  const rec = value as Record<string, unknown>;
  if (rec['kind'] !== GOVERNED_COMMAND_KIND) {
    return { ok: false, code: 'MALFORMED_REQUEST', detail: 'not a governed-command request' };
  }
  const correlationId = rec['correlationId'];
  if (typeof correlationId !== 'string' || !CORRELATION_PATTERN.test(correlationId)) {
    return { ok: false, code: 'MALFORMED_REQUEST', detail: 'correlationId is missing or malformed' };
  }
  const verb = rec['verb'];
  if (!isVerb(verb)) {
    return { ok: false, code: 'UNKNOWN_VERB', detail: `'${String(verb)}' is not a governed verb` };
  }
  const rawArgs = rec['args'] === undefined ? {} : rec['args'];
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    return { ok: false, code: 'MALFORMED_REQUEST', detail: 'args is not an object' };
  }

  const spec = ARG_SPEC[verb];
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawArgs as Record<string, unknown>)) {
    if (!(spec.accepts as readonly string[]).includes(k)) {
      return { ok: false, code: 'INVALID_ARGUMENT', detail: `verb '${verb}' does not accept argument '${k}'` };
    }
    if (typeof v !== 'string') {
      return { ok: false, code: 'INVALID_ARGUMENT', detail: `argument '${k}' is not a string` };
    }
    const okShape = (PROSE_ARGS as readonly string[]).includes(k as GovernedArgName)
      ? isProse(v, k === 'note' ? MAX_NOTE_LENGTH : MAX_ARG_LENGTH)
      : ID_PATTERN.test(v);
    if (!okShape) {
      return { ok: false, code: 'INVALID_ARGUMENT', detail: `argument '${k}' is malformed or too long` };
    }
    args[k] = v;
  }

  for (const need of spec.requires) {
    if (args[need] === undefined) {
      return { ok: false, code: 'MISSING_ARGUMENT', detail: `verb '${verb}' requires '${need}'` };
    }
  }

  const allowedRoles = ALLOWED_ROLES[verb];
  if (args['role'] !== undefined && !allowedRoles.includes(args['role'])) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: `verb '${verb}' cannot be performed as '${args['role']}'${allowedRoles.length > 0 ? ` (permitted: ${allowedRoles.join(', ')})` : ''}`,
    };
  }
  if (verb === 'phase.advance' && !ADVANCEABLE_STATUSES.includes(args['toStatus'] as string)) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: `'${args['toStatus']}' is not an advanceable status; closure has its own verb`,
    };
  }
  if (verb === 'approval.decide' && !DECISIONS.includes(args['decision'] as string)) {
    return { ok: false, code: 'INVALID_ARGUMENT', detail: `'${args['decision']}' is not a decision` };
  }

  return { ok: true, request: { kind: GOVERNED_COMMAND_KIND, verb, args, correlationId } };
}

/** The canonical agent commands this channel can reach. Nothing else is addressable. */
export type GovernedTargetCommand = 'phase' | 'approve' | 'report';

/**
 * A typed call, NOT a command line. `flags` is handed to the command function as-is, so no value is
 * ever parsed — which is what makes flag injection structurally impossible rather than merely
 * filtered.
 */
export interface GovernedInvocation {
  readonly command: GovernedTargetCommand;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

/**
 * Translate a validated request into a canonical invocation.
 *
 * A pure total function over the closed verb set. Every flag NAME below is a literal written here;
 * caller input only ever supplies flag VALUES. `refresh` maps to null: it is served entirely by the
 * existing read path and performs nothing.
 */
export function toAgentInvocation(request: GovernedCommandRequest): GovernedInvocation | null {
  const a = request.args;
  const withNote = (flags: Record<string, string>): Record<string, string> =>
    a.note === undefined ? flags : { ...flags, note: a.note };

  switch (request.verb) {
    case 'refresh':
      return null;
    case 'phase.start':
      return { command: 'phase', positionals: ['new'], flags: { id: a.phaseId as string } };
    case 'phase.advance':
      return {
        command: 'phase',
        positionals: ['advance'],
        flags: withNote({ id: a.phaseId as string, to: a.toStatus as string, as: a.role ?? 'implementer' }),
      };
    // Stop/resume are NOT invented statuses: the core state machine models them as `rolled_back`
    // and `rolled_back -> draft`. One owner action, one canonical transition.
    case 'phase.stop':
      return {
        command: 'phase',
        positionals: ['advance'],
        flags: withNote({ id: a.phaseId as string, to: 'rolled_back', as: a.role ?? 'implementer' }),
      };
    case 'phase.resume':
      return {
        command: 'phase',
        positionals: ['advance'],
        flags: withNote({ id: a.phaseId as string, to: 'draft', as: a.role ?? 'implementer' }),
      };
    case 'phase.close':
      return {
        command: 'phase',
        positionals: ['advance'],
        flags: withNote({
          id: a.phaseId as string,
          to: 'closed',
          as: a.role as string,
          identity: a.identity as string,
        }),
      };
    case 'approval.request':
      return {
        command: 'approve',
        positionals: ['request'],
        flags: { id: a.approvalId as string, action: a.action as string, as: a.role ?? 'implementer' },
      };
    case 'approval.decide':
      return {
        command: 'approve',
        positionals: ['decide'],
        flags: withNote({
          id: a.approvalId as string,
          decision: a.decision as string,
          as: a.role ?? 'implementer',
        }),
      };
    case 'report.write':
      return { command: 'report', positionals: [], flags: { phase: a.phaseId as string } };
  }
}

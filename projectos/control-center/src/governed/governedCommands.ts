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
  // Owner objective intake. Produces a NON-AUTHORITATIVE draft proposal and nothing else — no
  // phase, no approval, no activation. Added so the owner does not need a terminal to start work.
  'plan.draft',
  // ACTIVATION IS NOT APPROVAL, and the distinction is the whole reason this verb exists.
  //
  // It asks the runtime to activate a plan that a COMMITTED approval decision has ALREADY approved.
  // It cannot create that decision, name who approved it, or stand in for an approver: it carries
  // two identifiers and nothing else, and every question of authority is answered downstream by
  // `approvePlan` against records in the repository. If no valid committed decision exists for the
  // named draft, this verb produces a refusal — which is the correct outcome, not a failure of the
  // seam. Drafting proposes; a decision approves; this only materialises what was already approved.
  'plan.activate',
  // PROJECT SELECTION. It carries a project ID and NOTHING else — never a repository path, never a
  // root, never a directory. The ID is a KEY into the set of projects the host already validated
  // against the protected registry, so an unknown ID selects nothing and a well-formed ID that
  // happens to look like a path is still only ever compared, never joined to anything.
  'project.select',
  // GOVERNED EXECUTION. Starts, resumes or stops the ACTUAL gatekeeper loop (`projectos run`) —
  // the real worker, the real live gatekeeper call, the real cost. Everything downstream of these
  // three verbs is exactly the authority chain proven throughout PROJECTOS-AUTONOMOUS-GATEKEEPER-
  // LOOP1A: the loop's own delegation checks, owner gates, correction boundaries and protected-
  // action refusals are unchanged by who starts it. This channel can only ask the loop to run; it
  // cannot widen what the loop is allowed to do once it has.
  'run.start',
  'run.resume',
  'run.stop',
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
  readonly note?: string;
  readonly approvalId?: string;
  readonly action?: string;
  readonly decision?: string;
  /** Plain-language owner intent. Data, never an instruction. */
  readonly objective?: string;
  /** WHICH proposal the owner is activating. An identifier, not a path and not authority. */
  readonly draftId?: string;
  /**
   * WHICH committed decision approves it. Also data: naming a decision does not make it valid.
   *
   * The runtime cannot derive this today — a decision records the `draftId` it approves, but nothing
   * enumerates the decisions directory, so there is no read-model that could select "the unique
   * valid committed decision for this draft". Rather than invent that discovery here, the caller
   * names the decision and the engine judges it: committed, unconsumed, right project, repository,
   * branch, draft, plan digest and decider. A caller naming the wrong decision gets a refusal, not
   * an approval.
   */
  readonly decisionId?: string;
  /**
   * WHICH registered project the owner is selecting. A stable identifier and nothing else.
   *
   * It never becomes a path. The daemon resolves it by looking it up among the projects the host
   * supplied from the protected registry; if it is not there, selection is refused. So the WebView
   * cannot assert, inject or imply a repository location — the only thing it can do is name one of
   * the projects the installed host already decided it may govern.
   */
  readonly projectId?: string;
  /**
   * WHICH earlier execution session to resume. An identifier only — never a path. The sidecar
   * looks it up among THIS root's own session records; a foreign or unknown id is refused by the
   * canonical runtime exactly as it is from a terminal (`NO_SUCH_SESSION`).
   */
  readonly sessionId?: string;
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
/**
 * An objective is a paragraph of intent. Matches the runtime's own MAX_OBJECTIVE_CHARS so the UI
 * cannot compose something the canonical path would then refuse. Newlines stay forbidden by
 * `isProse`: the sidecar protocol is one request per line, so a newline would smuggle a second.
 */
export const MAX_OBJECTIVE_LENGTH = 4000;
export const MAX_CORRELATION_LENGTH = 64;

/**
 * Identifiers must START with an alphanumeric. Without that anchor `--force` and `-f` are valid
 * identifiers — every character is in the class — and an identifier beginning with `-` is not an
 * identifier at all once it reaches an argv parser: it is a flag.
 *
 * THIS PATTERN IS NOT SUFFICIENT FOR A VALUE THAT REACHES A FILESYSTEM PATH. It permits `.` and `:`,
 * so `..` and a Windows drive letter are both spellable here, and an NTFS alternate data stream is
 * `name:stream`. That is deliberate — record ids legitimately contain dots — and it is safe only
 * because the runtime re-validates on the far side: `approvePlan` runs both ids through a stricter
 * `FILENAME_ID` (`[A-Za-z0-9_-]{8,128}`, no dot, no colon) BEFORE either is joined to a path. If a
 * future verb forwards a caller-supplied identifier to something that builds a path, it needs an
 * equivalent check of its own; passing this one is not the guarantee it looks like.
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
  'phase.close': [],
  'approval.request': ['implementer'],
  'approval.decide': ['implementer', 'advisor'],
  'report.write': ['implementer'],
  // No role at all: drafting proposes, it does not act, so there is no authority to claim.
  'plan.draft': [],
  // No role either, and for a stronger reason. The authority for activation lives in a committed
  // decision made by the delegate the ACTIVE approved plan records. There is no role this channel
  // could claim that would add to that, and any role it could claim would only be a claim.
  'plan.activate': [],
  // Selection is not an act of authority over a project; it decides which project the surface is
  // looking at. There is no role to claim and none is accepted.
  'project.select': [],
  // `projectos run` has no `--as` concept at all — it is not a role-claiming act, it is the
  // canonical loop's own authority chain running exactly as it would from a terminal. Sending a
  // role here is refused at the arg-accepts check below, before this table is ever consulted.
  'run.start': [],
  'run.resume': [],
  'run.stop': [],
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
  // CLOSURE TAKES NO ROLE AND NO IDENTITY. The renderer may REQUEST closure; it may not nominate or
  // authenticate the authority that grants it. Accepting `identity: 'ChatGPT'` from an untrusted
  // caller meant the caller was naming the party whose name confers the power — a filter on the
  // string, not a control over the authority. The runtime derives the delegate from the ACTIVE
  // APPROVED PLAN instead, so there is nothing here for a caller to supply or forge.
  'phase.close': { accepts: ['phaseId', 'note'], requires: ['phaseId'] },
  'approval.request': { accepts: ['approvalId', 'action', 'role'], requires: ['approvalId', 'action'] },
  'approval.decide': { accepts: ['approvalId', 'decision', 'role', 'note'], requires: ['approvalId', 'decision'] },
  // Objective only. There is nothing else to supply, and nothing else may be supplied.
  'plan.draft': { accepts: ['objective'], requires: ['objective'] },
  // Two identifiers, both REQUIRED, and nothing else — no role, no note, no path, no approver, no
  // delegation. Neither is prose, so both are validated as identifiers before they are forwarded,
  // and `approvePlan` re-validates them under a stricter pattern before either touches a path.
  'plan.activate': { accepts: ['draftId', 'decisionId'], requires: ['draftId', 'decisionId'] },
  'report.write': { accepts: ['phaseId', 'role'], requires: ['phaseId'] },
  // One identifier, required, and nothing else. No path, no root, no environment, no role.
  'project.select': { accepts: ['projectId'], requires: ['projectId'] },
  // `phaseId` is accepted only as a UI-side correlator for the sidecar's own in-flight-run guard;
  // `projectos run` itself takes no phase flag — it derives the phase from the active approved
  // plan, exactly as it does from a terminal.
  'run.start': { accepts: ['phaseId'], requires: [] },
  // The one thing a resume MUST name is which session — the sidecar will not guess, matching the
  // canonical CLI's own `--resume` refusal (`NO_SESSION_NAMED`) when none is given.
  'run.resume': { accepts: ['phaseId', 'sessionId'], requires: ['sessionId'] },
  'run.stop': { accepts: ['phaseId'], requires: [] },
};

const PROSE_ARGS: readonly GovernedArgName[] = ['note', 'action', 'objective'];

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
      ? isProse(v, k === 'note' ? MAX_NOTE_LENGTH : k === 'objective' ? MAX_OBJECTIVE_LENGTH : MAX_ARG_LENGTH)
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
// 'plan' is read/propose-only: its sole reachable subcommand here is `draft`, which writes a
// proposal under .projectops/ and can create no phase, approval or execution authority.
export type GovernedTargetCommand = 'phase' | 'approve' | 'report' | 'plan';

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
    // Selection is served entirely by the host/daemon boundary: it changes WHICH project the surface
    // reads, and performs no governed action inside any project. There is deliberately no canonical
    // agent command for it, so there is nothing here for a value to be forwarded into.
    case 'project.select':
      return null;
    // GOVERNED EXECUTION is not a synchronous in-process call like every other verb here — it
    // spawns and tracks the real `projectos run` process, which the sidecar intercepts and
    // handles BEFORE this function is ever reached (see host.mjs, same precedent as
    // `project.select`). There is no canonical agent command to translate these into.
    case 'run.start':
    case 'run.resume':
    case 'run.stop':
      return null;
    case 'plan.draft':
      return { command: 'plan', positionals: ['draft'], flags: { objective: a.objective as string } };
    // `plan activate`, NOT `plan approve`. Both end in the same `approvePlan` engine — the only
    // route by which a record with `planStatus: PLAN READY` comes into existence — but `approve` is
    // the low-level command whose destination defaults to a single fixed filename. Since an
    // activated plan is immutable and the engine refuses to overwrite one, that default would let
    // this button work exactly once per project and then refuse forever. `activate` derives a record
    // path of its own from the draft id and keeps the programme already in force.
    case 'plan.activate':
      return {
        command: 'plan',
        positionals: ['activate'],
        flags: { id: a.draftId as string, decision: a.decisionId as string },
      };
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
    // No `as` and no `identity`: the agent resolves the delegated authority from the approved plan.
    // A caller cannot name the delegate, so a caller cannot become one.
    case 'phase.close':
      return {
        command: 'phase',
        positionals: ['advance'],
        flags: withNote({ id: a.phaseId as string, to: 'closed', delegated: 'true' }),
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

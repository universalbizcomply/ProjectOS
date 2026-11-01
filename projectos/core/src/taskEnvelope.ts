/**
 * Task envelope v2 and the rules R1 to R5 (ADR-K1 §2, §5; ADR-T1).
 *
 * AN ENVELOPE IS THE KERNEL'S STATEMENT, NOT THE CALLER'S. `mintEnvelope` reads a fixed list of facts
 * from its request and nothing else. `tenant`, `domain` and `project` come from a binding only
 * `resolveTenant` can produce; `environment` and `actionClass` come from the action registry. A
 * request that also carries `tenant` or `actionClass` changes nothing, because those keys are never
 * read (R2). Worker text is not in this module's vocabulary at all.
 *
 * WHAT THIS MODULE CANNOT PROVE. `principal`, `actor`, `subjectHash`, `scope` and `budget` are handed
 * in by kernel code. That they are derived rather than relayed from a worker is the job of the call
 * sites, which arrive in PROJECTOS-TENANT-PRINCIPAL1A. This module proves shape and the no-widening
 * rule, and says so rather than implying more.
 *
 * PROVENANCE IS NOT SHAPE. A full-shape object is not an envelope. `mintEnvelope` and
 * `readmitEnvelope` brand what they return in a private `WeakMap`, and the door takes nothing else, so a
 * caller cannot hand `admitEnvelope` `{ ok: true, envelope: { ...actionClass: 'P1' } }`. Anything read
 * back from disk goes through `readmitEnvelope`, which derives the five facts again, holds the rest to
 * limits the kernel states, and refuses any difference.
 *
 * R3 HAS TWO HALVES. `tenant`, `domain`, `project`, `environment` and `principal` must EQUAL the
 * parent's: a child that moves any of them is crossing a boundary, not narrowing a task. `scope`,
 * `budget`, `expiry` and the class must be AT MOST the parent's. Cross-tenant access is never a child:
 * each use starts a new root envelope in the data-owning tenant (ADR-K1 §4).
 *
 * BOUNDARY CROSSINGS ARE ROOTS (ADR-T1 §8). A broker call is not in the environment of the run that made
 * it, so it cannot be its child, and R3 is not loosened to pretend otherwise. `mintCrossing` carries the
 * link instead, and it is not optional: the door refuses `RUN_LINKED_ACTIONS` from anywhere else.
 *
 * THE DOOR GATES THE CLASS. P6 is refused always, P4 has no grant to give (ADR-K1 §4), an unregistered
 * action is refused by name, and P3 and P5 need the grant port to confirm. Which grant answers is the
 * port's business; this module only refuses to proceed without one.
 *
 * R4 IS FAIL-CLOSED. An admission that cannot be recorded did not happen. The recorder is a port, so
 * this module does no I/O, and a recorder that answers `false` or throws refuses the operation, the
 * allowed path included. A refusal that cannot be recorded stays a refusal and says so.
 *
 * ONLY V2 EXISTS. ADR-K1 describes v1 for Stage 1, where `tenant` and `domain` were derived defaults,
 * but no v1 envelope was ever built. So there is no default here to fall back on (R1).
 *
 * The code adds `action` to ADR-K1 §2's table. §2 hashes it into `idempotencyKey` without listing it,
 * and a record that names a class but not the action is not an audit (ADR-T1 §8). It is the one
 * addition: `registered` and `via` live on the record line, not on the envelope.
 */
import { createHash } from 'node:crypto';
import { ROLES, type Role } from './types.js';
import {
  ACTION_CLASSES,
  classAtMost,
  isActionName,
  isBoundaryAction,
  isRunLinkedAction,
  KERNEL_ENVIRONMENTS,
  PAID_ACTIONS,
  resolveAction,
  type ActionClass,
  type ActionRegistry,
  type KernelEnvironment,
} from './actionRegistry.js';
import { DOMAINS, isDerivedBinding, isProjectId, isTenantId, type Domain, type TenantBinding } from './tenant.js';

export const ENVELOPE_VERSION = 2;

export interface EnvelopeActor {
  readonly agent: string;
  readonly provider: string;
  readonly model: string;
}

export interface TaskEnvelope {
  readonly envelopeVersion: typeof ENVELOPE_VERSION;
  readonly envelopeId: string;
  readonly parentEnvelopeId: string | null;
  readonly principal: Role;
  readonly actor: EnvelopeActor;
  readonly tenant: string;
  readonly domain: Domain;
  readonly project: string;
  readonly environment: KernelEnvironment;
  readonly action: string;
  readonly actionClass: ActionClass;
  readonly subjectHash: string;
  readonly scope: readonly string[];
  /**
   * The most this one envelope may spend, in micro-USD. Zero for an unpaid action. A per-call ceiling,
   * not a running total: nothing here draws it down. `gatekeeperCostLedger` is the cumulative cap.
   */
  readonly budget: number;
  /** When authority lapses, as `Date.prototype.toISOString` writes it. */
  readonly expiry: string;
  readonly idempotencyKey: string;
}

const ENVELOPE_ID = /^ENV-[0-9a-f]{24}$/;
/** A git commit, or a SHA-256 of the exact bytes acted on. */
const SUBJECT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;
const ACTOR_FIELDS = ['agent', 'provider', 'model'] as const;
const IDEMPOTENCY_DOMAIN = 'projectos-envelope-idempotency-v2:';
const RUN_ACTION = 'run-start';

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isActor(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.keys(record).length === ACTOR_FIELDS.length && ACTOR_FIELDS.every((field) => nonBlank(record[field]));
}

/**
 * The instant, or `null`. `Date.parse` alone accepts `2026`, `Nov 1`, and rolls 31 February into
 * March, so the text must be exactly what the parsed instant prints back as.
 */
function instantOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) || new Date(at).toISOString() !== value ? null : at;
}

/** R1: every field, and what makes it parseable. A field added here is required everywhere. */
const FIELD_CHECKS: Readonly<Record<keyof TaskEnvelope, (value: unknown) => boolean>> = {
  envelopeVersion: (value) => value === ENVELOPE_VERSION,
  envelopeId: (value) => typeof value === 'string' && ENVELOPE_ID.test(value),
  parentEnvelopeId: (value) => value === null || (typeof value === 'string' && ENVELOPE_ID.test(value)),
  principal: (value) => (ROLES as readonly unknown[]).includes(value),
  actor: isActor,
  tenant: isTenantId,
  domain: (value) => (DOMAINS as readonly unknown[]).includes(value),
  project: isProjectId,
  environment: (value) => (KERNEL_ENVIRONMENTS as readonly unknown[]).includes(value),
  action: isActionName,
  actionClass: (value) => (ACTION_CLASSES as readonly unknown[]).includes(value),
  subjectHash: (value) => typeof value === 'string' && SUBJECT_HASH.test(value),
  scope: (value) => Array.isArray(value) && [...value].every(nonBlank),
  budget: (value) => Number.isSafeInteger(value) && (value as number) >= 0,
  expiry: (value) => instantOf(value) !== null,
  idempotencyKey: (value) => typeof value === 'string' && IDEMPOTENCY_KEY.test(value),
};

export const ENVELOPE_FIELDS = Object.keys(FIELD_CHECKS) as readonly (keyof TaskEnvelope)[];

export type EnvelopeRule = 'R1' | 'R2' | 'R3' | 'R4' | 'RUN_LINK' | 'EXPIRED';

export type EnvelopeResult =
  | { readonly ok: true; readonly envelope: TaskEnvelope }
  | { readonly ok: false; readonly rule: EnvelopeRule; readonly reasons: readonly string[] };

function refused(rule: EnvelopeRule, reasons: readonly string[]): Extract<EnvelopeResult, { ok: false }> {
  return { ok: false, rule, reasons };
}

/**
 * What only the kernel knows about an envelope it minted. Recorded and shown to the grant port, never an
 * envelope field.
 */
export interface EnvelopeProvenance {
  readonly registered: boolean;
  readonly via: TenantBinding['via'];
  /** Only `mintCrossing` sets this, so a persisted crossing comes back without it and is minted again. */
  readonly runLinked: boolean;
}

/** Envelopes `mintEnvelope` or `readmitEnvelope` produced. Nothing else passes the door. */
const LIVE_ENVELOPES = new WeakMap<TaskEnvelope, EnvelopeProvenance>();

/**
 * Envelopes the door admitted, with their line written. MINTED IS NOT ADMITTED: a brand says the kernel
 * built it, and a run refused at the door keeps its brand, so anything that acts on a run asks here.
 */
const ADMITTED_ENVELOPES = new WeakSet<TaskEnvelope>();

function branded(result: EnvelopeResult, provenance: EnvelopeProvenance): EnvelopeResult {
  if (result.ok) LIVE_ENVELOPES.set(result.envelope, Object.freeze(provenance));
  return result;
}

/**
 * R1: a missing or unparseable field is a refusal, and an unknown field is too.
 *
 * NO DEFAULTS. The one place ADR-K1 allowed a default was envelope v1, which does not exist. An
 * unknown field is refused because a tolerant reader is how `tenantOverride` becomes a habit.
 */
export function parseEnvelope(raw: unknown): EnvelopeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return refused('R1', ['the envelope is not an object']);
  const record = raw as Readonly<Record<string, unknown>>;
  const reasons = [
    ...ENVELOPE_FIELDS.flatMap((field) => {
      if (!Object.hasOwn(record, field)) return [`the envelope has no ${field}`];
      return FIELD_CHECKS[field](record[field]) ? [] : [`the envelope's ${field} is unparseable`];
    }),
    ...Object.keys(record)
      .filter((key) => !(ENVELOPE_FIELDS as readonly string[]).includes(key))
      .map((key) => `the envelope carries an unknown field '${key}'`),
    ...((PAID_ACTIONS as readonly unknown[]).includes(record['action']) && record['budget'] === 0
      ? [`the paid action '${String(record['action'])}' has no budget`]
      : []),
  ];
  if (reasons.length > 0) return refused('R1', reasons);
  const scope = Object.freeze([...(record['scope'] as readonly string[])]);
  const actor = Object.freeze({ ...(record['actor'] as EnvelopeActor) });
  return { ok: true, envelope: Object.freeze({ ...(record as unknown as TaskEnvelope), scope, actor }) };
}

/** Is this envelope past its expiry at `now`? An instant that cannot be read has expired. */
export function envelopeExpired(envelope: TaskEnvelope, now: string): boolean {
  const expiry = instantOf(envelope.expiry);
  const at = instantOf(now);
  return expiry === null || at === null || expiry <= at;
}

/**
 * The key a retry reuses (ADR-K1 §2): derived from the intent, so a new envelope id alone never
 * produces a new one. The intent scope is the parent task or run id, or a schedule's occurrence id,
 * so next week's reminder is a new key.
 */
export function deriveIdempotencyKey(intent: {
  readonly tenant: string;
  readonly project: string;
  readonly action: string;
  readonly subjectHash: string;
  readonly intentScope: string;
}): string {
  const canonical = JSON.stringify([intent.tenant, intent.project, intent.action, intent.subjectHash, intent.intentScope]);
  return `sha256:${createHash('sha256').update(`${IDEMPOTENCY_DOMAIN}${canonical}`, 'utf8').digest('hex')}`;
}

/** What only kernel code may supply. Compare `EnvelopeRequest`, which has no authority in it. */
export interface KernelEnvelopeContext {
  /** From `resolveTenant`. A structurally identical copy is refused. */
  readonly binding: TenantBinding;
  readonly registry: ActionRegistry;
  readonly principal: Role;
  readonly actor: EnvelopeActor;
  /** Minted by the kernel at admission. */
  readonly envelopeId: string;
}

/**
 * The facts of the task itself. Nothing here can say whose it is. The caller does name the action, and
 * the action selects the class, so a caller can choose what it asks for but not what that is called:
 * the class comes from the registry entry for that action, and an unknown action is refused at the door.
 */
export interface EnvelopeRequest {
  readonly action: string;
  readonly subjectHash: string;
  readonly scope: readonly string[];
  readonly budget: number;
  readonly expiry: string;
  readonly intentScope: string;
}

/**
 * R3 against a presented child: both envelopes are parsed first, so a child cannot pass by being
 * malformed in a way the comparisons below would skip. The child's class and environment are derived
 * again from the registry, because at-most against the parent says nothing about a label that lies.
 */
export function checkChildEnvelope(parent: unknown, child: unknown, registry: ActionRegistry): EnvelopeResult {
  const parsedParent = parseEnvelope(parent);
  if (!parsedParent.ok) return refused('R1', parsedParent.reasons.map((reason) => `parent: ${reason}`));
  const parsedChild = parseEnvelope(child);
  if (!parsedChild.ok) return parsedChild;
  const up = parsedParent.envelope;
  const down = parsedChild.envelope;
  const resolved = resolveAction(registry, down.action);
  const reasons: readonly string[] = [
    ...(down.parentEnvelopeId === up.envelopeId ? [] : [`the child's parentEnvelopeId is not ${up.envelopeId}`]),
    ...(isBoundaryAction(down.action) ? [`'${down.action}' is a boundary crossing, so it is a root envelope and never a child`] : []),
    ...(down.actionClass === resolved.actionClass ? [] : [`the child's class ${down.actionClass} is not the registry's ${resolved.actionClass} for '${down.action}'`]),
    ...(down.environment === resolved.environment ? [] : [`the child's environment ${down.environment} is not the registry's ${resolved.environment} for '${down.action}'`]),
    ...(['tenant', 'domain', 'project', 'environment', 'principal'] as const).flatMap((field) =>
      down[field] === up[field] ? [] : [`the child's ${field} '${down[field]}' is not its parent's '${up[field]}'`],
    ),
    ...down.scope.filter((item) => !up.scope.includes(item)).map((item) => `the child's scope '${item}' is outside its parent's`),
    ...(down.budget <= up.budget ? [] : [`the child's budget ${down.budget} is above its parent's ${up.budget}`]),
    ...((instantOf(down.expiry) as number) <= (instantOf(up.expiry) as number) ? [] : [`the child's expiry ${down.expiry} is after its parent's ${up.expiry}`]),
    ...(classAtMost(down.actionClass, up.actionClass) ? [] : [`the child's class ${down.actionClass} is above its parent's ${up.actionClass}`]),
  ];
  return reasons.length > 0 ? refused('R3', reasons) : parsedChild;
}

/**
 * Mint an envelope: a root, or with `parent` a child, which must then pass `checkChildEnvelope`.
 *
 * R2: the request is read field by field, never spread, and `tenant`, `domain`, `project`,
 * `environment` and `actionClass` have no other source than the binding and the registry. R5 is
 * `resolveAction`'s: an unregistered action mints as P5 rather than refusing, so the attempt is
 * recorded at the class it deserves, and the door then refuses it by name. A parent must itself be
 * branded, because its budget, scope and expiry are the limits the child is held to.
 */
export function mintEnvelope(context: KernelEnvelopeContext, request: EnvelopeRequest, parent: TaskEnvelope | null = null): EnvelopeResult {
  const { binding, registry, principal, actor, envelopeId } = context;
  if (!isDerivedBinding(binding)) {
    return refused('R2', ['the tenant binding was not produced by resolveTenant, so the tenant is a claim']);
  }
  if (parent !== null && !LIVE_ENVELOPES.has(parent)) {
    return refused('R2', ['the parent envelope was not minted or re-admitted here, so its limits are claims']);
  }
  const { action, subjectHash, scope, budget, expiry, intentScope } = request;
  if (!nonBlank(intentScope)) return refused('R1', ['the request has no intentScope, so no idempotency key can be derived']);
  const resolved = resolveAction(registry, action);
  const candidate: TaskEnvelope = {
    envelopeVersion: ENVELOPE_VERSION,
    envelopeId,
    parentEnvelopeId: parent === null ? null : parent.envelopeId,
    principal,
    actor,
    tenant: binding.tenant,
    domain: binding.domain,
    project: binding.projectId,
    environment: resolved.environment,
    action,
    actionClass: resolved.actionClass,
    subjectHash,
    scope,
    budget,
    expiry,
    idempotencyKey: deriveIdempotencyKey({ tenant: binding.tenant, project: binding.projectId, action, subjectHash, intentScope }),
  };
  const result = parent === null ? parseEnvelope(candidate) : checkChildEnvelope(parent, candidate, registry);
  return branded(result, { registered: resolved.registered, via: binding.via, runLinked: false });
}

/** What the kernel states about a persisted envelope. Every field is required: none is read from disk. */
export interface ReadmissionLimits {
  readonly principal: Role;
  readonly actor: EnvelopeActor;
  /** The latest expiry the kernel will honour. An unreadable one refuses. */
  readonly latestExpiry: string;
  /** The most the kernel will honour, in micro-USD. A non-integer refuses. */
  readonly maxBudget: number;
  /** What a child of this envelope may inherit. The persisted scope must sit inside it. */
  readonly scope: readonly string[];
  readonly subjectHash: string;
  readonly idempotencyKey: string;
  readonly parentEnvelopeId: string | null;
  readonly now: string;
}

function limitProblems(envelope: TaskEnvelope, limits: ReadmissionLimits): readonly string[] {
  const latest = instantOf(limits.latestExpiry);
  return [
    ...(envelope.principal === limits.principal ? [] : [`the persisted principal '${envelope.principal}' is not the kernel's '${limits.principal}'`]),
    ...(ACTOR_FIELDS.every((field) => envelope.actor[field] === limits.actor[field]) ? [] : ['the persisted actor is not the kernel\'s']),
    ...(Number.isSafeInteger(limits.maxBudget) && envelope.budget <= limits.maxBudget ? [] : [`the persisted budget ${envelope.budget} is above the limit`]),
    ...(latest !== null && (instantOf(envelope.expiry) as number) <= latest ? [] : [`the persisted expiry ${envelope.expiry} is after the limit`]),
    ...envelope.scope.filter((item) => !limits.scope.includes(item)).map((item) => `the persisted scope '${item}' is outside the allowed scope`),
    ...(['subjectHash', 'idempotencyKey', 'parentEnvelopeId'] as const).flatMap((field) =>
      envelope[field] === limits[field] ? [] : [`the persisted ${field} '${String(envelope[field])}' is not the kernel's`],
    ),
  ];
}

/**
 * Bring a persisted envelope back to the door.
 *
 * ITS OWN WORDS COUNT FOR NOTHING. A record on disk is writable, and a readmitted envelope caps its
 * children, so nothing it says about itself may stand unchecked. `tenant`, `domain`, `project`,
 * `environment` and `actionClass` are derived again from a live binding and the registry. `principal`
 * and `actor` must equal what the kernel states, `subjectHash`, `idempotencyKey` and `parentEnvelopeId`
 * likewise, and `budget`, `expiry` and `scope` must sit within limits it states. An action the registry
 * has since dropped reads as unregistered here, and a class that has since changed refuses. A crossing
 * loses its run link, so it is minted again rather than trusted. What this returns is branded, not
 * admitted: it still has to pass the door.
 */
export function readmitEnvelope(raw: unknown, binding: TenantBinding, registry: ActionRegistry, limits: ReadmissionLimits): EnvelopeResult {
  if (!isDerivedBinding(binding)) {
    return refused('R2', ['the tenant binding was not produced by resolveTenant, so the tenant is a claim']);
  }
  const parsed = parseEnvelope(raw);
  if (!parsed.ok) return parsed;
  const { envelope } = parsed;
  if (envelopeExpired(envelope, limits.now)) return refused('EXPIRED', [`the persisted envelope expired at ${envelope.expiry}`]);
  const resolved = resolveAction(registry, envelope.action);
  const derived = {
    tenant: binding.tenant,
    domain: binding.domain,
    project: binding.projectId,
    environment: resolved.environment,
    actionClass: resolved.actionClass,
  } as const;
  const reasons = [
    ...(Object.keys(derived) as readonly (keyof typeof derived)[]).flatMap((field) =>
      envelope[field] === derived[field] ? [] : [`the persisted ${field} '${envelope[field]}' is not the derived '${derived[field]}'`],
    ),
    ...limitProblems(envelope, limits),
  ];
  return reasons.length > 0 ? refused('R2', reasons) : branded(parsed, { registered: resolved.registered, via: binding.via, runLinked: false });
}

/** The scope entry that ties a boundary crossing to the run it belongs to. */
function runLinkScope(runEnvelopeId: string): string {
  return `run:${runEnvelopeId}`;
}

/** A crossing's request has no scope: `mintCrossing` derives the only one it may have. */
export type CrossingRequest = Omit<EnvelopeRequest, 'scope'>;

/**
 * Mint a boundary crossing tied to its run. The only route the door accepts for `RUN_LINKED_ACTIONS`.
 *
 * A crossing is a root, so lineage cannot tie it to a run, and R3 is not loosened to do so: a crossing
 * may be in another environment. This ties it instead. The run must have been admitted, not merely
 * minted, and be unexpired and really a run, and the crossing must match its tenant, domain, project and
 * principal and stay within its expiry and budget. The scope is derived here, so a caller cannot add to
 * it, and a credential release can always be traced back to the run that asked. `now` is passed in
 * because this module has no clock.
 *
 * THE BUDGET CHECK IS PER CALL. Each crossing is held to the run's ceiling and nothing draws the run
 * down, so several crossings may together pass it. That is deliberate: `gatekeeperCostLedger` already
 * refuses a paid call before dispatch, against committed caps, and a second running total here would be
 * a second answer to what was spent.
 */
export function mintCrossing(context: KernelEnvelopeContext, request: CrossingRequest, run: TaskEnvelope, now: string): EnvelopeResult {
  if (!ADMITTED_ENVELOPES.has(run)) return refused('RUN_LINK', ['the run was not admitted at the door, so it links nothing']);
  const { binding, principal } = context;
  const { action, subjectHash, budget, expiry, intentScope } = request;
  const bound = { tenant: binding.tenant, domain: binding.domain, project: binding.projectId, principal } as const;
  const reasons: readonly string[] = [
    ...(run.action === RUN_ACTION ? [] : [`'${run.action}' is not a run`]),
    ...(isRunLinkedAction(action) ? [] : [`'${action}' is not a run-linked action`]),
    ...(envelopeExpired(run, now) ? [`the run expired at ${run.expiry}`] : []),
    ...(Object.keys(bound) as readonly (keyof typeof bound)[]).flatMap((field) =>
      bound[field] === run[field] ? [] : [`the crossing's ${field} '${bound[field]}' is not its run's '${run[field]}'`],
    ),
    ...(budget <= run.budget ? [] : [`the crossing's budget ${budget} is above its run's ${run.budget}`]),
    ...((instantOf(expiry) ?? Number.POSITIVE_INFINITY) <= (instantOf(run.expiry) as number) ? [] : [`the crossing's expiry ${expiry} is after its run's ${run.expiry}`]),
  ];
  if (reasons.length > 0) return refused('RUN_LINK', reasons);
  const result = mintEnvelope(context, { action, subjectHash, scope: [runLinkScope(run.envelopeId)], budget, expiry, intentScope });
  return result.ok ? branded(result, { ...(LIVE_ENVELOPES.get(result.envelope) as EnvelopeProvenance), runLinked: true }) : result;
}

/** One line of the admission and execution record. Built here, written by the port. */
export interface EnvelopeRecord {
  readonly stage: 'admission' | 'execution';
  readonly outcome: 'allowed' | 'refused' | 'failed';
  /** The rule that decided a refusal, or the operation's own rule at execution. */
  readonly rule: string | null;
  readonly envelope: TaskEnvelope | null;
  /** Whether the registry named the action; `null` when no branded envelope reached this line. */
  readonly registered: boolean | null;
  /** How the checkout was bound, so a linked-worktree admission is visible; `null` as above. */
  readonly via: TenantBinding['via'] | null;
  /** On an allowed admission line: whether `mintCrossing` tied it to a run. */
  readonly runLinked?: boolean;
  readonly reasons: readonly string[];
  readonly at: string;
}

/** Durably records one line. `false` or a throw means it was not recorded. */
export type EnvelopeRecorder = (record: EnvelopeRecord) => boolean;

function recorded(recorder: EnvelopeRecorder, record: EnvelopeRecord): boolean {
  try {
    return recorder(record) === true;
  } catch {
    return false;
  }
}

/**
 * Is there a grant for this P3 or P5 envelope? Answers `true` or it has not granted; a throw is not a
 * grant. Which record answers is the port's business. For P3 that is the technical gate, wired by later
 * phases. CREDENTIALS1A decides it for `credential-release`. The port sees the provenance too, frozen,
 * because worktree identity alone must never release a secret and only `via` can say which this is.
 */
export type EnvelopeGrantPort = (envelope: TaskEnvelope, provenance: EnvelopeProvenance) => boolean;

function granted(grant: EnvelopeGrantPort, envelope: TaskEnvelope, provenance: EnvelopeProvenance): boolean {
  try {
    return grant(envelope, provenance) === true;
  } catch {
    return false;
  }
}

export type EnvelopeClassRule = 'P6_PROHIBITED' | 'UNREGISTERED_ACTION' | 'P4_NO_GRANT' | 'RUN_LINK_REQUIRED' | 'P5_NO_GRANT' | 'P3_NO_GRANT';

interface ClassRefusal {
  readonly rule: EnvelopeClassRule;
  readonly reasons: readonly string[];
}

/** May this class run? Asked at the door, in this order, so the port is never asked about P6. */
function classRefusal(envelope: TaskEnvelope, provenance: EnvelopeProvenance, grant: EnvelopeGrantPort): ClassRefusal | null {
  const { action, actionClass } = envelope;
  if (actionClass === 'P6') return { rule: 'P6_PROHIBITED', reasons: [`'${action}' is P6: nobody may authorise it, ever`] };
  if (!provenance.registered) return { rule: 'UNREGISTERED_ACTION', reasons: [`'${action}' is not in the action registry`] };
  if (actionClass === 'P4') return { rule: 'P4_NO_GRANT', reasons: [`'${action}' is P4, and no P4 grant exists yet (ADR-K1 §4)`] };
  if (isRunLinkedAction(action) && !provenance.runLinked) return { rule: 'RUN_LINK_REQUIRED', reasons: [`'${action}' must be minted by mintCrossing, tied to its run`] };
  if (actionClass === 'P5' && !granted(grant, envelope, provenance)) return { rule: 'P5_NO_GRANT', reasons: [`'${action}' is P5, and no grant confirms it`] };
  if (actionClass === 'P3' && !granted(grant, envelope, provenance)) return { rule: 'P3_NO_GRANT', reasons: [`'${action}' is P3, and no grant confirms it`] };
  return null;
}

export type EnvelopeAdmission =
  | { readonly admitted: true; readonly envelope: TaskEnvelope }
  | {
      readonly admitted: false;
      readonly rule: EnvelopeRule | EnvelopeClassRule | 'EXPIRED';
      readonly reasons: readonly string[];
      readonly recorded: boolean;
    };

/**
 * R4: record at admission, refusals included, and only then answer.
 *
 * THIS IS THE DOOR. It takes only what this module branded; `{ ok: true }` is
 * only an object, and a perfect copy is not minted. Then expiry, then the class. Nothing is admitted
 * unless its line was written.
 */
export function admitEnvelope(minted: EnvelopeResult, now: string, recorder: EnvelopeRecorder, grant: EnvelopeGrantPort): EnvelopeAdmission {
  const at = { stage: 'admission', at: now } as const;
  const refuse = (
    rule: EnvelopeRule | EnvelopeClassRule | 'EXPIRED',
    reasons: readonly string[],
    envelope: TaskEnvelope | null,
    provenance: EnvelopeProvenance | null,
  ): EnvelopeAdmission => {
    const wrote = recorded(recorder, { ...at, outcome: 'refused', rule, envelope, registered: provenance?.registered ?? null, via: provenance?.via ?? null, reasons });
    return { admitted: false, rule, reasons, recorded: wrote };
  };
  if (!minted.ok) return refuse(minted.rule, minted.reasons, null, null);
  const { envelope } = minted;
  const provenance = LIVE_ENVELOPES.get(envelope);
  if (provenance === undefined) return refuse('R2', ['this envelope was not minted or re-admitted by the kernel'], null, null);
  if (envelopeExpired(envelope, now)) return refuse('EXPIRED', [`the envelope expired at ${envelope.expiry}`], envelope, provenance);
  const refusal = classRefusal(envelope, provenance, grant);
  if (refusal !== null) return refuse(refusal.rule, refusal.reasons, envelope, provenance);
  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope, ...provenance, reasons: [] })) {
    return { admitted: false, rule: 'R4', reasons: ['the admission could not be recorded, so the operation does not run'], recorded: false };
  }
  ADMITTED_ENVELOPES.add(envelope);
  return { admitted: true, envelope };
}

/**
 * R4, second half: the outcome at execution, naming the rule. `false` means the caller must stop, and
 * that includes an envelope the door never admitted: nothing executed under it, so no line says so.
 */
export function recordExecution(
  envelope: TaskEnvelope,
  outcome: EnvelopeRecord['outcome'],
  rule: string | null,
  now: string,
  recorder: EnvelopeRecorder,
): boolean {
  const provenance = LIVE_ENVELOPES.get(envelope);
  if (provenance === undefined || !ADMITTED_ENVELOPES.has(envelope)) return false;
  return recorded(recorder, { stage: 'execution', outcome, rule, envelope, registered: provenance.registered, via: provenance.via, reasons: [], at: now });
}

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
 * R3 HAS TWO HALVES. `tenant`, `domain`, `project` and `environment` must EQUAL the parent's: a child
 * that moves any of them is crossing a boundary, not narrowing a task. `scope`, `budget`, `expiry`
 * and the class must be AT MOST the parent's. Cross-tenant access is never a child: each use starts a
 * new root envelope in the data-owning tenant (ADR-K1 §4).
 *
 * R4 IS FAIL-CLOSED. An admission that cannot be recorded did not happen. The recorder is a port, so
 * this module does no I/O, and a recorder that answers `false` or throws refuses the operation, the
 * allowed path included. A refusal that cannot be recorded stays a refusal and says so.
 *
 * ONLY V2 EXISTS. ADR-K1 describes v1 for Stage 1, where `tenant` and `domain` were derived defaults,
 * but no v1 envelope was ever built. So there is no default here to fall back on (R1).
 *
 * The code adds `action` to ADR-K1 §2's table. §2 hashes it into `idempotencyKey` without listing it,
 * and a record that names a class but not the action is not an audit (ADR-T1 §8).
 */
import { createHash } from 'node:crypto';
import { ROLES, type Role } from './types.js';
import { ACTION_CLASSES, classAtMost, isActionName, KERNEL_ENVIRONMENTS, resolveAction, type ActionClass, type ActionRegistry, type KernelEnvironment } from './actionRegistry.js';
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
  /** The most this envelope may spend, in micro-USD. Zero for an unpaid action. */
  readonly budget: number;
  /** When authority lapses, as `Date.prototype.toISOString` writes it. */
  readonly expiry: string;
  readonly idempotencyKey: string;
}

const ENVELOPE_ID = /^ENV-[0-9a-f]{24}$/;
/** A git commit, or a SHA-256 of the exact bytes acted on. */
const SUBJECT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;
const ACTOR_FIELDS = ['agent', 'provider', 'model'];
const IDEMPOTENCY_DOMAIN = 'projectos-envelope-idempotency-v2:';

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
  scope: (value) => Array.isArray(value) && value.every(nonBlank),
  budget: (value) => Number.isSafeInteger(value) && (value as number) >= 0,
  expiry: (value) => instantOf(value) !== null,
  idempotencyKey: (value) => typeof value === 'string' && IDEMPOTENCY_KEY.test(value),
};

export const ENVELOPE_FIELDS = Object.keys(FIELD_CHECKS) as readonly (keyof TaskEnvelope)[];

export type EnvelopeRule = 'R1' | 'R2' | 'R3' | 'R4';

export type EnvelopeResult =
  | { readonly ok: true; readonly envelope: TaskEnvelope }
  | { readonly ok: false; readonly rule: EnvelopeRule; readonly reasons: readonly string[] };

function refused(rule: EnvelopeRule, reasons: readonly string[]): Extract<EnvelopeResult, { ok: false }> {
  return { ok: false, rule, reasons };
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

/** The facts of the task itself. Nothing here can say whose it is or how dangerous it is. */
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
 * malformed in a way the comparisons below would skip.
 */
export function checkChildEnvelope(parent: unknown, child: unknown): EnvelopeResult {
  const parsedParent = parseEnvelope(parent);
  if (!parsedParent.ok) return refused('R1', parsedParent.reasons.map((reason) => `parent: ${reason}`));
  const parsedChild = parseEnvelope(child);
  if (!parsedChild.ok) return parsedChild;
  const up = parsedParent.envelope;
  const down = parsedChild.envelope;
  const reasons: readonly string[] = [
    ...(down.parentEnvelopeId === up.envelopeId ? [] : [`the child's parentEnvelopeId is not ${up.envelopeId}`]),
    ...(['tenant', 'domain', 'project', 'environment'] as const).flatMap((field) =>
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
 * recorded at the class it deserves.
 */
export function mintEnvelope(context: KernelEnvelopeContext, request: EnvelopeRequest, parent: TaskEnvelope | null = null): EnvelopeResult {
  const { binding, registry, principal, actor, envelopeId } = context;
  if (!isDerivedBinding(binding)) {
    return refused('R2', ['the tenant binding was not produced by resolveTenant, so the tenant is a claim']);
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
  return parent === null ? parseEnvelope(candidate) : checkChildEnvelope(parent, candidate);
}

/** One line of the admission and execution record. Built here, written by the port. */
export interface EnvelopeRecord {
  readonly stage: 'admission' | 'execution';
  readonly outcome: 'allowed' | 'refused' | 'failed';
  /** The rule that decided a refusal, or the operation's own rule at execution. */
  readonly rule: string | null;
  readonly envelope: TaskEnvelope | null;
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

export type EnvelopeAdmission =
  | { readonly admitted: true; readonly envelope: TaskEnvelope }
  | { readonly admitted: false; readonly rule: EnvelopeRule | 'EXPIRED'; readonly reasons: readonly string[]; readonly recorded: boolean };

/**
 * R4: record at admission, refusals included, and only then answer.
 *
 * Takes what `mintEnvelope` or `parseEnvelope` returned and parses it again, because this is the door
 * and `{ ok: true }` is only an object. Nothing is admitted unless its line was written.
 */
export function admitEnvelope(minted: EnvelopeResult, now: string, recorder: EnvelopeRecorder): EnvelopeAdmission {
  const parsed = minted.ok ? parseEnvelope(minted.envelope) : minted;
  const at = { stage: 'admission', at: now } as const;
  if (!parsed.ok) {
    const wrote = recorded(recorder, { ...at, outcome: 'refused', rule: parsed.rule, envelope: null, reasons: parsed.reasons });
    return { admitted: false, rule: parsed.rule, reasons: parsed.reasons, recorded: wrote };
  }
  if (envelopeExpired(parsed.envelope, now)) {
    const reasons = [`the envelope expired at ${parsed.envelope.expiry}`];
    const wrote = recorded(recorder, { ...at, outcome: 'refused', rule: 'EXPIRED', envelope: parsed.envelope, reasons });
    return { admitted: false, rule: 'EXPIRED', reasons, recorded: wrote };
  }
  if (!recorded(recorder, { ...at, outcome: 'allowed', rule: null, envelope: parsed.envelope, reasons: [] })) {
    return { admitted: false, rule: 'R4', reasons: ['the admission could not be recorded, so the operation does not run'], recorded: false };
  }
  return { admitted: true, envelope: parsed.envelope };
}

/** R4, second half: the outcome at execution, naming the rule. `false` means the caller must stop. */
export function recordExecution(
  envelope: TaskEnvelope,
  outcome: EnvelopeRecord['outcome'],
  rule: string | null,
  now: string,
  recorder: EnvelopeRecorder,
): boolean {
  return recorded(recorder, { stage: 'execution', outcome, rule, envelope, reasons: [], at: now });
}

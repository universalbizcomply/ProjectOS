// Origin: original ProjectOS code
/**
 * The routine record, and the reader that admits it.
 *
 * A RECORD NAMES A PLAN DECISION; THIS READER CHECKS ITS FORM, NOT THE DECISION. It asks the record to carry an
 * `approval` that names a `PLANDEC-` id, says `decidedBy: 'owner'` and carries a plan digest. Those are claims the
 * record makes about itself. Nothing here looks up the decision, so "admitted" means well-formed and within the
 * floors, and does not mean approved. Upstream lets the agent create a cron job itself; here a record without a named
 * decision is refused, and whether the named decision exists and is the owner's is the host wiring's check against the
 * committed plan-decision records (see WHAT THIS MODULE CANNOT PROVE).
 *
 * ADMISSION IS THE FLOORS AND THE SCAN. The schedule is held to the floor and the prompt is scanned here, so a routine
 * that fails either never becomes a record. The result is frozen and remembered by the module, so a copy built by hand,
 * with every field right, is not an admitted record and enables nothing.
 *
 * EACH FIELD IS READ ONCE. The record is copied field by field before anything is judged, and a field that is a getter
 * is refused, so a value cannot be clean when it is checked and something else when it is stored.
 *
 * THERE IS NO FIELD FOR A FLOOR. A record with a field this reader does not know is refused as a whole, so
 * `minimumIntervalMs` or `enabledLimit` cannot ride along in a file. The per-run budget is held to a named maximum.
 *
 * WHAT THIS MODULE CANNOT PROVE. It reads the shape of an approval, not the approval: that `decisionId` names a
 * committed owner decision with this plan digest is for the wiring to check against the committed bytes, as the
 * plan-decision reader does for the rest of the kernel. Until that wiring exists, a record that names a decision is
 * only as trustworthy as the file it was read from. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { checkScheduleFloor } from './cronSchedule.js';
import { MAX_ROUTINE_PROMPT_CHARS, scanRoutinePrompt } from './promptScan.js';
import { MAX_RUN_BUDGET_CENTS } from './runLimits.js';

export type RoutineRefusalCode =
  | 'ROUTINE_SHAPE'
  | 'ROUTINE_NO_PLAN_DECISION'
  | 'ROUTINE_BUDGET'
  | 'ROUTINE_PROMPT_THREAT'
  | 'SCHEDULE_UNREADABLE'
  | 'SCHEDULE_TIMEZONE'
  | 'SCHEDULE_TOO_FREQUENT'
  | 'SCHEDULE_NEVER_FIRES';

export interface RoutineRefusal {
  readonly code: RoutineRefusalCode;
  readonly message: string;
}

/** What a record says about its own approval. The reader checks its form only. */
export interface RoutineApproval {
  readonly decisionId: string;
  readonly decidedBy: 'owner';
  readonly planDigest: string;
}

export interface RoutineRecord {
  readonly recordId: string;
  readonly routineId: string;
  readonly tenant: string;
  readonly project: string;
  readonly cron: string;
  readonly timezone: string;
  readonly prompt: string;
  /**
   * What each run may spend, in US CENTS (not the envelope's micro-USD: 1 cent is 10,000 micro-USD, and the wiring
   * converts). Each run has its own budget; it is not shared across runs and not carried over.
   */
  readonly runBudgetCents: number;
  readonly approval: RoutineApproval;
  /** A SHA-256 over every field above, so another version of a routine is another effect. */
  readonly recordHash: string;
}

export type RoutineRecordResult =
  | { readonly ok: true; readonly record: RoutineRecord }
  | { readonly ok: false; readonly refusals: readonly RoutineRefusal[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DECISION_ID = /^PLANDEC-[A-Za-z0-9-]{1,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FIELDS = ['recordId', 'routineId', 'tenant', 'project', 'cron', 'timezone', 'prompt', 'runBudgetCents', 'approval'] as const;
const APPROVAL_FIELDS = ['decisionId', 'decidedBy', 'planDigest'] as const;

const ADMITTED = new WeakSet<object>();

const refusal = (code: RoutineRefusalCode, message: string): RoutineRefusal => ({ code, message });
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);

/**
 * Copy an object's own fields, once each. Null when it has a key that is not allowed, a key that is not an enumerable
 * string, or a field that is a getter or setter.
 */
function snapshotOf(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

/** Did the reader admit this record? A copy of one, built by hand, was not admitted. */
export function isAdmittedRoutineRecord(value: unknown): value is RoutineRecord {
  return typeof value === 'object' && value !== null && ADMITTED.has(value);
}

function approvalOf(raw: unknown): { readonly approval: RoutineApproval } | { readonly refusal: RoutineRefusal } {
  const no = (message: string) => ({ refusal: refusal('ROUTINE_NO_PLAN_DECISION', message) });
  const value = snapshotOf(raw, APPROVAL_FIELDS);
  if (value === null) return no('a routine record needs an approval that names a plan decision, as plain fields');
  const { decisionId, decidedBy, planDigest } = value;
  if (typeof decisionId !== 'string' || !DECISION_ID.test(decisionId)) return no('the approval does not name a plan decision');
  if (decidedBy !== 'owner') return no('the approval does not say the owner decided');
  if (typeof planDigest !== 'string' || !DIGEST.test(planDigest)) return no('the approval does not name the plan digest it was decided against');
  return { approval: Object.freeze({ decisionId, decidedBy: 'owner' as const, planDigest }) };
}

function shapeProblem(fields: Record<string, unknown>): RoutineRefusal | null {
  for (const field of ['recordId', 'routineId', 'tenant', 'project'] as const) {
    const value = fields[field];
    if (typeof value !== 'string' || !ID.test(value)) return refusal('ROUTINE_SHAPE', `'${field}' must be one plain id`);
  }
  if (typeof fields['cron'] !== 'string' || typeof fields['timezone'] !== 'string') return refusal('ROUTINE_SHAPE', 'the schedule must be text');
  const prompt = fields['prompt'];
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > MAX_ROUTINE_PROMPT_CHARS) {
    return refusal('ROUTINE_SHAPE', `the prompt must be 1 to ${MAX_ROUTINE_PROMPT_CHARS} characters`);
  }
  return null;
}

const hashOf = (record: Omit<RoutineRecord, 'recordHash'>): string =>
  `sha256:${createHash('sha256')
    .update(
      JSON.stringify([
        record.recordId,
        record.routineId,
        record.tenant,
        record.project,
        record.cron,
        record.timezone,
        record.prompt,
        record.runBudgetCents,
        record.approval.decisionId,
        record.approval.planDigest,
      ]),
      'utf8',
    )
    .digest('hex')}`;

/** Read a routine record from parsed JSON, and admit it or refuse it with every reason found. */
export function admitRoutineRecord(raw: unknown): RoutineRecordResult {
  const fields = snapshotOf(raw, FIELDS);
  if (fields === null) {
    return { ok: false, refusals: [refusal('ROUTINE_SHAPE', 'a routine record is one object of plain fields this reader knows, with no getters')] };
  }
  const approved = approvalOf(fields['approval']);
  const shape = shapeProblem(fields);
  if (shape !== null) return { ok: false, refusals: 'refusal' in approved ? [shape, approved.refusal] : [shape] };
  const refusals: RoutineRefusal[] = 'refusal' in approved ? [approved.refusal] : [];
  const budget = fields['runBudgetCents'];
  if (typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 1 || budget > MAX_RUN_BUDGET_CENTS) {
    refusals.push(refusal('ROUTINE_BUDGET', `each run needs its own budget, a whole number of cents from 1 to ${MAX_RUN_BUDGET_CENTS}`));
  }
  const floor = checkScheduleFloor(fields['cron'] as string, fields['timezone'] as string);
  if (!floor.ok) refusals.push(refusal(floor.code, floor.message));
  const finding = scanRoutinePrompt(fields['prompt'] as string);
  if (finding !== null) refusals.push(refusal('ROUTINE_PROMPT_THREAT', finding.message));
  if (refusals.length > 0 || 'refusal' in approved) return { ok: false, refusals };

  const body = {
    recordId: fields['recordId'] as string,
    routineId: fields['routineId'] as string,
    tenant: fields['tenant'] as string,
    project: fields['project'] as string,
    cron: fields['cron'] as string,
    timezone: fields['timezone'] as string,
    prompt: fields['prompt'] as string,
    runBudgetCents: budget as number,
    approval: approved.approval,
  };
  const record: RoutineRecord = Object.freeze({ ...body, recordHash: hashOf(body) });
  ADMITTED.add(record);
  return { ok: true, record };
}

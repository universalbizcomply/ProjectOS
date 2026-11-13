// Origin: original ProjectOS code
/**
 * The routine record, and the reader that admits it.
 *
 * A ROUTINE IS A PLAN-APPROVED RECORD, NEVER CREATED BY AN AGENT. The reader asks for the plan decision that
 * approved it: a `PLANDEC-` id, `decidedBy: 'owner'`, and the digest of the plan it was decided against.
 * Upstream lets the agent create a cron job itself; here the agent can only propose, and the owner's decision
 * is what makes a record.
 *
 * ADMISSION IS APPROVAL. The schedule is held to the floor and the prompt is scanned here, so a routine that
 * fails either never becomes a record. The result is frozen and remembered by the module, so a copy built by
 * hand, with every field right, is not an admitted record and enables nothing.
 *
 * THERE IS NO FIELD FOR A FLOOR. A record with a field this reader does not know is refused as a whole, so
 * `minimumIntervalMs` or `enabledLimit` cannot ride along in a file.
 *
 * WHAT THIS MODULE CANNOT PROVE. It reads the shape of an approval, not the approval: that `decisionId` names
 * a committed owner decision with this plan digest is for the wiring to check against the committed bytes, as
 * the plan-decision reader does for the rest of the kernel. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { checkScheduleFloor } from './cronSchedule.js';
import { scanRoutinePrompt } from './promptScan.js';

export type RoutineRefusalCode =
  | 'ROUTINE_SHAPE'
  | 'ROUTINE_NOT_PLAN_APPROVED'
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
  /** Each run has its own budget, in cents. It is not shared across runs and not carried over. */
  readonly runBudgetCents: number;
  readonly approval: RoutineApproval;
  /** A SHA-256 over every field above, so another version of a routine is another effect. */
  readonly recordHash: string;
}

export type RoutineRecordResult =
  | { readonly ok: true; readonly record: RoutineRecord }
  | { readonly ok: false; readonly refusals: readonly RoutineRefusal[] };

const MAX_PROMPT_CHARS = 8000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DECISION_ID = /^PLANDEC-[A-Za-z0-9-]{1,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FIELDS = ['recordId', 'routineId', 'tenant', 'project', 'cron', 'timezone', 'prompt', 'runBudgetCents', 'approval'] as const;
const APPROVAL_FIELDS = ['decisionId', 'decidedBy', 'planDigest'] as const;

const ADMITTED = new WeakSet<object>();

const refusal = (code: RoutineRefusalCode, message: string): RoutineRefusal => ({ code, message });
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));

/** Did the reader admit this record? A copy of one, built by hand, was not admitted. */
export function isAdmittedRoutineRecord(value: unknown): value is RoutineRecord {
  return typeof value === 'object' && value !== null && ADMITTED.has(value);
}

function approvalProblem(value: unknown): RoutineRefusal | null {
  if (!isPlainObject(value) || !onlyKeys(value, APPROVAL_FIELDS)) {
    return refusal('ROUTINE_NOT_PLAN_APPROVED', 'a routine needs the plan decision that approved it');
  }
  if (typeof value['decisionId'] !== 'string' || !DECISION_ID.test(value['decisionId'])) {
    return refusal('ROUTINE_NOT_PLAN_APPROVED', 'the approval does not name a plan decision');
  }
  if (value['decidedBy'] !== 'owner') return refusal('ROUTINE_NOT_PLAN_APPROVED', 'only the owner approves a routine');
  if (typeof value['planDigest'] !== 'string' || !DIGEST.test(value['planDigest'])) {
    return refusal('ROUTINE_NOT_PLAN_APPROVED', 'the approval does not name the plan digest it was decided against');
  }
  return null;
}

function shapeProblem(raw: Record<string, unknown>): RoutineRefusal | null {
  if (!onlyKeys(raw, FIELDS)) return refusal('ROUTINE_SHAPE', 'a routine record has a field this reader does not know');
  for (const field of ['recordId', 'routineId', 'tenant', 'project'] as const) {
    const value = raw[field];
    if (typeof value !== 'string' || !ID.test(value)) return refusal('ROUTINE_SHAPE', `'${field}' must be one plain id`);
  }
  if (typeof raw['cron'] !== 'string' || typeof raw['timezone'] !== 'string') return refusal('ROUTINE_SHAPE', 'the schedule must be text');
  const prompt = raw['prompt'];
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > MAX_PROMPT_CHARS) {
    return refusal('ROUTINE_SHAPE', `the prompt must be 1 to ${MAX_PROMPT_CHARS} characters`);
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

/** Read a routine record from parsed JSON, and approve it or refuse it with every reason found. */
export function admitRoutineRecord(raw: unknown): RoutineRecordResult {
  if (!isPlainObject(raw)) return { ok: false, refusals: [refusal('ROUTINE_SHAPE', 'a routine record is one object')] };
  const approvalRefusal = approvalProblem(raw['approval']);
  const shape = shapeProblem(raw);
  if (shape !== null) return { ok: false, refusals: approvalRefusal === null ? [shape] : [shape, approvalRefusal] };
  const refusals: RoutineRefusal[] = approvalRefusal === null ? [] : [approvalRefusal];
  const budget = raw['runBudgetCents'];
  if (typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 1) {
    refusals.push(refusal('ROUTINE_BUDGET', 'each run needs its own budget, a whole number of cents above zero'));
  }
  const floor = checkScheduleFloor(raw['cron'] as string, raw['timezone'] as string);
  if (!floor.ok) refusals.push(refusal(floor.code, floor.message));
  const finding = scanRoutinePrompt(raw['prompt'] as string);
  if (finding !== null) refusals.push(refusal('ROUTINE_PROMPT_THREAT', finding.message));
  if (refusals.length > 0) return { ok: false, refusals };

  const approval = raw['approval'] as RoutineApproval;
  const body = {
    recordId: raw['recordId'] as string,
    routineId: raw['routineId'] as string,
    tenant: raw['tenant'] as string,
    project: raw['project'] as string,
    cron: raw['cron'] as string,
    timezone: raw['timezone'] as string,
    prompt: raw['prompt'] as string,
    runBudgetCents: budget as number,
    approval: Object.freeze({ decisionId: approval.decisionId, decidedBy: 'owner' as const, planDigest: approval.planDigest }),
  };
  const record: RoutineRecord = Object.freeze({ ...body, recordHash: hashOf(body) });
  ADMITTED.add(record);
  return { ok: true, record };
}

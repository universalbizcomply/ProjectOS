// Origin: original ProjectOS code
/**
 * WHAT A CUT-OFF ATTEMPT MAY TELL THE NEXT WORKER (PROJECTOS-RESUME1A, plan 3.x).
 *
 * The loop's work record says where an earlier attempt got to. A worker can write that file, so it is read here for exactly four
 * fields whose values come from a CLOSED SET, and for nothing else:
 *
 *   state          one of the loop's own work states
 *   lastStopCode   one of the loop's own stop codes, or none
 *   subjectCommit  a git object name (40 or 64 lower-case hex characters), or none
 *   sessionId      a safe file-name stem, used only to find that attempt's own findings and evidence
 *
 * Every other field is free text (`lastStopDetail`, `lastCompletedStep`, `nextCandidateAction`, `gateDecisionId`,
 * `evidenceSessionId` and the rest) and is NEVER read, never copied and never rendered, so an instruction planted in any of them has
 * no path to the worker. A value outside its closed set is dropped and named by a closed code, never quoted. The record's own
 * project and phase are read only to be compared with the run's, which come from the governed context.
 *
 * The vocabularies are PARAMETERS: the agent owns them, and a second copy here would drift from it. The result is frozen, and a
 * record that is not plain data (an accessor, a prototype key, a symbol key) is refused whole, because a getter answers differently
 * the second time it is read. Pure: no I/O, no clock.
 */
import { isCommitName } from '../search/citation.js';

export interface ContextResumeVocabulary {
  /** Every state the loop writes. A state outside this list refuses the record. */
  readonly states: readonly string[];
  /** Every stop code the loop writes. */
  readonly stopCodes: readonly string[];
  /** States that describe no cut-off attempt: nothing was started, or the work finished. */
  readonly inactiveStates: readonly string[];
}

export interface ContextResumeFields {
  readonly state: string;
  readonly lastStopCode: string | null;
  readonly subjectCommit: string | null;
  readonly sessionId: string | null;
}

export type ContextResumeDropCode = 'RESUME_STOP_CODE_NOT_CLOSED' | 'RESUME_SUBJECT_COMMIT_NOT_A_COMMIT' | 'RESUME_SESSION_NOT_A_SAFE_NAME';

export type ContextResumeFieldsResult =
  | {
      readonly ok: true;
      readonly fields: ContextResumeFields;
      /** The project and phase the record names, to be compared with the run's own. Never rendered. */
      readonly belongsTo: { readonly projectId: string | null; readonly phaseId: string | null };
      /** True when the state is one that records an attempt that started and did not finish. */
      readonly cutOff: boolean;
      readonly dropped: readonly ContextResumeDropCode[];
    }
  | { readonly ok: false; readonly code: 'RESUME_RECORD_NOT_PLAIN' | 'RESUME_RECORD_STATE_UNKNOWN' };

const SESSION_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_IDENTITY_CHARS = 200;

/** One own data property, read once. An accessor, an inherited name and a missing one are all `undefined`. */
function dataField(record: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true ? (descriptor.value as unknown) : undefined;
}

function isPlainData(value: unknown): value is object {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const identityOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' && value.length <= MAX_IDENTITY_CHARS ? value : null);

/** The closed-vocabulary fields of a work record, or the closed code that says why there are none. */
export function contextResumeFieldsOf(raw: unknown, vocabulary: ContextResumeVocabulary): ContextResumeFieldsResult {
  if (!isPlainData(raw)) return { ok: false, code: 'RESUME_RECORD_NOT_PLAIN' };
  const state = dataField(raw, 'state');
  if (typeof state !== 'string' || !vocabulary.states.includes(state)) return { ok: false, code: 'RESUME_RECORD_STATE_UNKNOWN' };
  const dropped: ContextResumeDropCode[] = [];

  const stop = dataField(raw, 'lastStopCode');
  let lastStopCode: string | null = null;
  if (typeof stop === 'string' && vocabulary.stopCodes.includes(stop)) lastStopCode = stop;
  else if (stop !== null && stop !== undefined) dropped.push('RESUME_STOP_CODE_NOT_CLOSED');

  const commit = dataField(raw, 'subjectCommit');
  let subjectCommit: string | null = null;
  if (isCommitName(commit)) subjectCommit = commit;
  else if (commit !== null && commit !== undefined) dropped.push('RESUME_SUBJECT_COMMIT_NOT_A_COMMIT');

  const session = dataField(raw, 'sessionId');
  let sessionId: string | null = null;
  if (typeof session === 'string' && SESSION_NAME.test(session)) sessionId = session;
  else if (session !== null && session !== undefined) dropped.push('RESUME_SESSION_NOT_A_SAFE_NAME');

  return Object.freeze({
    ok: true,
    fields: Object.freeze({ state, lastStopCode, subjectCommit, sessionId }),
    belongsTo: Object.freeze({ projectId: identityOf(dataField(raw, 'projectId')), phaseId: identityOf(dataField(raw, 'phaseId')) }),
    cutOff: !vocabulary.inactiveStates.includes(state),
    dropped: Object.freeze(dropped),
  });
}

/**
 * Where a run's durable records live, and what the loop is allowed to read back.
 *
 * ONE DIRECTORY, ONE SESSION ID, FOUR RECORDS. The brief is what the worker was told; the session is
 * what was started; the findings and effects are what the run reported about itself; the evidence is
 * what the loop observed. Keeping them separate matters: a worker writes findings and effects, and a
 * worker must not be able to rewrite the brief it was given or the evidence collected about it.
 *
 * A MALFORMED RECORD IS NOT AN EMPTY ONE. `readFindings` and `readEffects` return a problem rather
 * than a default when a file exists but will not parse — treating an unreadable findings file as "no
 * findings" would turn a corrupted record into a clean bill of health.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { System } from '../system.js';
import { join, projectopsDir } from '../context.js';
import type { WorkerBrief } from './brief.js';
import type { WorkerSession } from './workers.js';
import { attestationProblems, type EffectsRecord, type ReviewFinding, type Severity } from './outcome.js';
import type { ExecutionEvidence } from './verification.js';

const SAFE_SESSION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const SEVERITIES: ReadonlySet<string> = new Set<Severity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export function executionDir(root: string): string {
  return join(projectopsDir(root), 'execution');
}

/**
 * Session ids become file paths, so an unsafe one is refused HERE — at every read and write site,
 * not only where the id is minted. The read sites matter more, not less: a mint is ours, a read may
 * be handed an id from anywhere.
 */
export function assertSafeSessionId(sessionId: string): string {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error(`execution: '${sessionId}' is not a safe session identifier`);
  }
  return sessionId;
}

function recordPath(root: string, sessionId: string, suffix: string): string {
  return join(executionDir(root), `${assertSafeSessionId(sessionId)}.${suffix}.json`);
}

export const briefPath = (root: string, id: string): string => recordPath(root, id, 'brief');
export const sessionPath = (root: string, id: string): string => recordPath(root, id, 'session');
export const findingsPath = (root: string, id: string): string => recordPath(root, id, 'findings');
export const effectsPath = (root: string, id: string): string => recordPath(root, id, 'effects');
export const evidencePath = (root: string, id: string): string => recordPath(root, id, 'evidence');

function writeJson(sys: System, path: string, value: unknown): void {
  sys.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeBrief(sys: System, root: string, sessionId: string, brief: WorkerBrief): string {
  const p = briefPath(root, sessionId);
  writeJson(sys, p, brief);
  return p;
}

export function writeSession(sys: System, root: string, session: WorkerSession): void {
  writeJson(sys, sessionPath(root, session.sessionId), session);
}

export function writeEvidence(sys: System, root: string, evidence: ExecutionEvidence): void {
  writeJson(sys, evidencePath(root, evidence.sessionId), evidence);
}

export function readSession(sys: System, root: string, sessionId: string): WorkerSession | null {
  const text = sys.readText(sessionPath(root, sessionId));
  if (text === null) return null;
  try {
    return JSON.parse(text) as WorkerSession;
  } catch {
    return null;
  }
}

export interface FindingsRecord {
  /** Which of the plan's required reviews this run actually produced. */
  readonly reviews: readonly string[];
  readonly findings: readonly ReviewFinding[];
}

export type ReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/** Findings for this run. Absent is `{reviews:[],findings:[]}`; unreadable is a problem. */
export function readFindings(sys: System, root: string, sessionId: string): ReadResult<FindingsRecord> {
  const p = findingsPath(root, sessionId);
  const text = sys.readText(p);
  if (text === null) return { ok: true, value: { reviews: [], findings: [] } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: `the findings record at ${p} exists but is not valid JSON; it is not evidence of no findings` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problem: `the findings record at ${p} is not an object` };
  }
  const obj = parsed as Record<string, unknown>;
  const reviews = Array.isArray(obj['reviews']) ? obj['reviews'].filter((r): r is string => typeof r === 'string') : [];
  const rawFindings = Array.isArray(obj['findings']) ? obj['findings'] : [];
  const findings: ReviewFinding[] = [];
  for (const [i, f] of rawFindings.entries()) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) {
      return { ok: false, problem: `${p}: findings[${i}] is not an object` };
    }
    const rec = f as Record<string, unknown>;
    const severity = String(rec['severity']);
    if (!SEVERITIES.has(severity)) {
      // An unrecognised severity must not silently sort below HIGH.
      return { ok: false, problem: `${p}: findings[${i}] has severity '${severity}', which is not CRITICAL, HIGH, MEDIUM or LOW` };
    }
    findings.push({
      id: typeof rec['id'] === 'string' ? rec['id'] : `findings[${i}]`,
      severity: severity as Severity,
      category: typeof rec['category'] === 'string' ? rec['category'] : 'unspecified',
      summary: typeof rec['summary'] === 'string' ? rec['summary'] : '',
      resolved: rec['resolved'] === true,
    });
  }
  return { ok: true, value: { reviews, findings } };
}

/**
 * Effects this run reported about itself.
 *
 * Absent is `null` — no attestation, judged at certification. Present but INCOMPLETE is a problem,
 * not a lenient `null` and certainly not an empty record: `{}` would otherwise certify a run that
 * answered none of the six questions, which is the fail-open the absent-record rule already closes.
 */
export function readEffects(sys: System, root: string, sessionId: string): ReadResult<EffectsRecord | null> {
  const p = effectsPath(root, sessionId);
  const text = sys.readText(p);
  if (text === null) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: `the effects record at ${p} exists but is not valid JSON; it is not evidence that nothing happened` };
  }
  const problems = attestationProblems(parsed);
  if (problems.length > 0) {
    return { ok: false, problem: `${p}: ${problems.join('; ')}` };
  }
  return { ok: true, value: parsed as EffectsRecord };
}

/**
 * The session id for a phase at a commit. Deterministic, so re-running the loop rejoins the same
 * session instead of scattering a phase's records across a new id every time.
 *
 * Returns null rather than throwing when the plan's phase id would not make a safe path component.
 * A phase id comes from the plan, and the plan is a file — so this is untrusted input reaching a path,
 * and the loop must be able to REFUSE it in its own words instead of dying with a stack trace.
 */
export function sessionIdFor(phaseId: string, head: string): string | null {
  const candidate = `${phaseId}-${head.slice(0, 12)}`;
  return SAFE_SESSION_ID.test(candidate) ? candidate : null;
}

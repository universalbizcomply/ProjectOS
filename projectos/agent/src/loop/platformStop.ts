/**
 * THE PLATFORM-WIDE EMERGENCY STOP — PROJECTOS-KERNEL-PLATFORM-STOP1A.
 *
 * One record, one check. The record says whether the owner has stopped the platform; the check is the
 * single question every entry point that can start work, spend, commit, push or close asks before it
 * does any of those things. There is deliberately no second reader: two readers disagree eventually,
 * and the disagreement is discovered by something running that should have stopped.
 *
 * WHERE THE RECORD LIVES, AND WHY THERE. `<installation state>/platform-stop.json`, the same per-user
 * application-data directory the degraded-mode ledger uses (`nodeInstallationStateDir`). It is outside
 * every repository, so a bounded worker — which writes only inside its project — cannot remove it, and
 * it is one file for the whole installation, so one stop reaches every project this machine governs.
 *
 * WHAT IS JUDGED, AND BY WHOM (ADR-K1 R7). The stop is judged by the EXECUTING principal at the moment
 * it executes, not by whoever approved the work. So the check is asked again at every step that can
 * have an effect — not once at admission — and an approval granted before the stop buys nothing after
 * it. Only an act the owner performs directly, in person, is outside it, and the one in-person act this
 * module recognises is an owner-authored git commit of the lift record. A `--as owner` flag is not one.
 *
 * FAIL CLOSED, EVERY WAY. An absent record means running; that is the only shape that does. A record
 * that is engaged, a record that cannot be read, a record that reads but is not a valid record, and a
 * state directory that cannot be resolved at all each mean STOPPED. A control that a corrupted file or
 * a missing environment variable switches off is not a control.
 *
 * IT ONLY REFUSES. Nothing here decides a closure, changes an eligibility predicate, edits the owner-only
 * set or touches any committed authority record. A refusal is the whole effect, and every caller returns
 * its own ordinary refusal shape carrying these lines.
 *
 * NO GIT, EVER, IN THE CHECK. `platformStopRefusal` reads one file through `System` and runs nothing:
 * it is called from inside test worlds whose fake git fails on any command it does not expect, and from
 * paths that run before git has been established at all.
 */
import { randomBytes } from 'node:crypto';
import { join } from '../context.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import type { System } from '../system.js';

export const PLATFORM_STOP_SCHEMA_VERSION = '1.0.0';
export const PLATFORM_STOP_FILENAME = 'platform-stop.json';

/** Where the owner's lift record is committed, inside the governed project. Never matched by `.gitignore`. */
export const STOP_LIFTS_REL = '.projectops/stop-lifts';

/** The `kind` a lift record must carry, so no other committed JSON file can be mistaken for one. */
export const STOP_LIFT_KIND = 'projectos-platform-stop-lift';

/** How much of a free-text reason or claim is ever kept. Inert text, bounded. */
export const STOP_TEXT_MAX = 280;

/**
 * THE ONE HONEST STATEMENT, carried by every refusal and every stop output.
 *
 * A stop that let people believe it had undone something would be worse than no stop. It refuses NEW
 * effects; it cannot recall ones that already left this machine, and it does not reach into a process
 * that is already running. Saying so at the moment it matters is the point.
 */
export const PLATFORM_STOP_STATEMENT =
  'This stop does NOT reverse completed external effects: commits already pushed, paid provider calls ' +
  'already made, messages already sent and payments already made all stand. A worker that is already ' +
  'running is not killed; it ends at its next check. The ProjectOS Host service is not touched.';

const STOP_ID = /^STOP-[0-9TZ]{8,16}-[0-9a-f]{12}$/;

/** Is this a stop id this module could have minted? Checked before any id becomes part of a path. */
export function isStopId(value: string): boolean {
  return STOP_ID.test(value);
}

export interface StopEvent {
  readonly event: 'engaged' | 'lifted' | 'replaced-unreadable';
  readonly stopId: string;
  readonly at: string;
  readonly detail: string;
}

export interface PlatformStopRecord {
  readonly schemaVersion: string;
  readonly state: 'engaged' | 'lifted';
  readonly stopId: string;
  readonly engagedAt: string;
  /** WHO SAID SO, AS THEY SAID IT. Nothing authenticates this, and the record says so in the value. */
  readonly engagedBy: { readonly claim: string; readonly authenticated: false };
  /** Inert, bounded text. Never interpreted, never executed, only shown. */
  readonly reason: string;
  readonly statement: string;
  readonly liftedAt?: string;
  readonly liftedStopId?: string;
  readonly liftCommit?: string;
  /** Append-only. Nothing is removed from it, and nothing is ever deleted from the record. */
  readonly history: readonly StopEvent[];
}

export type PlatformStopRead =
  | { readonly kind: 'unresolvable' }
  | { readonly kind: 'absent'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly path: string; readonly why: string }
  | { readonly kind: 'ok'; readonly path: string; readonly record: PlatformStopRecord };

export function platformStopPath(stateDir: string): string {
  return join(stateDir, PLATFORM_STOP_FILENAME);
}

/** The lift record's repository-relative path, or null for an id that must not become a path. */
export function stopLiftRelPath(stopId: string): string | null {
  return isStopId(stopId) ? `${STOP_LIFTS_REL}/${stopId}.json` : null;
}

/**
 * The state directory a command should consult: the composition root's own answer, unless a TEST has
 * named one on the context.
 *
 * WHY A CONTEXT FIELD AND NOT AN ENVIRONMENT VARIABLE. `nodeInstallationStateDir` refuses any
 * environment override on purpose — one variable that points the stop at an empty directory would lift
 * it. A property on the in-process context is reachable only by code already running inside ProjectOS,
 * which can do anything anyway; it is how a test engages a stop in a temporary directory without ever
 * touching the owner's real one. Production entrypoints never set it. An explicit `null` (or a present
 * but undefined value) is an unresolvable directory and refuses, which is the safe reading.
 */
export function platformStopDirOf(ctx: object): string | null {
  if (!('platformStopStateDir' in ctx)) return nodeInstallationStateDir();
  const named = (ctx as { readonly platformStopStateDir?: unknown }).platformStopStateDir;
  return typeof named === 'string' && named.trim() !== '' ? named : null;
}

function text(value: unknown): string {
  // INERT AND BOUNDED: control characters become spaces, so a reason cannot forge a further output line.
  const raw = typeof value === 'string' ? value : '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, STOP_TEXT_MAX);
}

/** The record, if it is one. Anything else is null, and null means stopped. */
function validRecord(parsed: unknown): PlatformStopRecord | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (r['schemaVersion'] !== PLATFORM_STOP_SCHEMA_VERSION) return null;
  if (r['state'] !== 'engaged' && r['state'] !== 'lifted') return null;
  if (typeof r['stopId'] !== 'string' || !isStopId(r['stopId'])) return null;
  if (typeof r['engagedAt'] !== 'string' || !Array.isArray(r['history'])) return null;
  const by = r['engagedBy'] as Record<string, unknown> | null | undefined;
  if (typeof by !== 'object' || by === null || by['authenticated'] !== false || typeof by['claim'] !== 'string') return null;
  if (typeof r['reason'] !== 'string') return null;
  // A LIFT NAMES WHAT IT LIFTED AND THE COMMIT THAT LIFTED IT. A "lifted" record without both is not a
  // lift anybody can account for, so it reads as a damaged record — which is stopped.
  if (r['state'] === 'lifted') {
    if (r['liftedStopId'] !== r['stopId']) return null;
    if (typeof r['liftCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(r['liftCommit'])) return null;
  }
  return parsed as PlatformStopRecord;
}

/**
 * What the record says, with "never engaged" kept apart from "cannot be read".
 *
 * `readText` returns null for an absent file AND for one that exists but could not be read, so `exists`
 * is asked to tell those apart: a file the runtime cannot open is not an absent stop.
 */
export function readPlatformStop(sys: System, stateDir: string | null): PlatformStopRead {
  if (stateDir === null || stateDir.trim() === '') return { kind: 'unresolvable' };
  const path = platformStopPath(stateDir);
  let raw: string | null;
  try {
    raw = sys.readText(path);
  } catch {
    return { kind: 'unreadable', path, why: 'it could not be read' };
  }
  if (raw === null) {
    let present = true;
    try {
      present = sys.exists(path);
    } catch {
      present = true;
    }
    return present ? { kind: 'unreadable', path, why: 'it exists but could not be read' } : { kind: 'absent', path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable', path, why: 'it is not valid JSON' };
  }
  const record = validRecord(parsed);
  if (record === null) return { kind: 'unreadable', path, why: 'it is not a valid platform stop record' };
  return { kind: 'ok', path, record };
}

/** How to see the stop, and how the owner lifts it. Shared by every refusal and status. */
function nextSteps(stopId: string | null): readonly string[] {
  return [
    '  - see it: projectos stop status',
    stopId === null
      ? '  - the record must be repaired by hand before it can be lifted; until then the platform stays stopped'
      : `  - lift it (owner only, by an owner-authored commit): projectos stop lift --stop ${stopId}`,
  ];
}

/**
 * THE CHECK. `null` means the platform is running; anything else is the refusal, ready to print.
 *
 * One file read through `System`, nothing executed. Absent is the only "running" answer; engaged,
 * unreadable, invalid and unresolvable all refuse, and every refusal carries the honest statement.
 */
export function platformStopRefusal(
  sys: System,
  stateDir: string | null | undefined = nodeInstallationStateDir(),
): readonly string[] | null {
  const read = readPlatformStop(sys, stateDir ?? null);
  if (read.kind === 'absent') return null;
  if (read.kind === 'ok' && read.record.state === 'lifted') return null;
  if (read.kind === 'unresolvable') {
    return [
      'REFUSED (PLATFORM_STOP_UNVERIFIABLE): no per-user application-data directory could be resolved, so whether',
      "  the owner's platform-wide emergency stop is engaged cannot be established. ProjectOS treats the",
      '  platform as STOPPED; nothing was started, spent, committed or pushed by this command.',
      PLATFORM_STOP_STATEMENT,
    ];
  }
  if (read.kind === 'unreadable') {
    return [
      `REFUSED (PLATFORM_STOP_UNREADABLE): the platform stop record at ${read.path} cannot be trusted (${read.why}),`,
      '  so ProjectOS treats the platform as STOPPED; nothing was started, spent, committed or pushed by this command.',
      ...nextSteps(null),
      PLATFORM_STOP_STATEMENT,
    ];
  }
  const r = read.record;
  return [
    `REFUSED (PLATFORM_STOP): the owner's platform-wide emergency stop ${r.stopId} is engaged (since ${r.engagedAt}).`,
    `  - reason, as given and inert: ${JSON.stringify(r.reason)}`,
    `  - engaged by (an unauthenticated claim): ${JSON.stringify(r.engagedBy.claim)}`,
    '  - nothing was started, spent, committed or pushed by this command',
    ...nextSteps(r.stopId),
    PLATFORM_STOP_STATEMENT,
  ];
}

/** A stop id nobody else will mint: the engagement instant plus 48 random bits. */
export function mintStopId(now: string): string {
  const stamp = now.replace(/[^0-9TZ]/g, '').slice(0, 16);
  return `STOP-${stamp.length >= 8 ? stamp : '00000000'}-${randomBytes(6).toString('hex')}`;
}

export type StopWrite = { readonly written: true } | { readonly written: false; readonly problem: string };

/**
 * Replace the record: a temporary file, an atomic move, and a read-back of what landed.
 *
 * THE ONLY WRITE OF THE RECORD. The temporary file sits beside it in the state directory, so the move
 * never crosses a volume, and the read-back proves the bytes the next check will see are these.
 */
function writeRecord(sys: System, stateDir: string, next: PlatformStopRecord): StopWrite {
  const path = platformStopPath(stateDir);
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error: unknown) {
    return { written: false, problem: `the platform stop record could not be written: ${error instanceof Error ? error.message : 'write failed'}` };
  }
  if (!sys.renameFile(temporary, path)) {
    return { written: false, problem: 'the platform stop record could not be moved into place atomically' };
  }
  const back = readPlatformStop(sys, stateDir);
  if (back.kind !== 'ok' || back.record.state !== next.state || back.record.stopId !== next.stopId) {
    return { written: false, problem: 'the platform stop record did not read back as written' };
  }
  return { written: true };
}

export type EngageOutcome =
  | { readonly kind: 'ENGAGED'; readonly stopId: string; readonly lines: readonly string[] }
  | { readonly kind: 'ALREADY_ENGAGED'; readonly stopId: string; readonly lines: readonly string[] }
  | { readonly kind: 'FAILED'; readonly lines: readonly string[] };

/** What an engaged stop reports. No path: the bridge forwards this and must not reveal the state dir. */
function engagedLines(record: PlatformStopRecord, already: boolean): readonly string[] {
  return [
    already
      ? `The platform-wide emergency stop ${record.stopId} was ALREADY engaged (since ${record.engagedAt}); it stays engaged.`
      : `PLATFORM STOP ENGAGED: ${record.stopId} at ${record.engagedAt}.`,
    '  every ProjectOS entry point that can start work, spend, commit, push or close now refuses,',
    '  and every technical delegation is suspended, until the owner lifts this stop',
    `  - reason, as given and inert: ${JSON.stringify(record.reason)}`,
    `  - engaged by (an unauthenticated claim): ${JSON.stringify(record.engagedBy.claim)}`,
    ...nextSteps(record.stopId),
    PLATFORM_STOP_STATEMENT,
  ];
}

/**
 * ENGAGE THE STOP. Needs no authority, because stopping is always safe.
 *
 * AN ENGAGED STOP IS NOT RE-ENGAGED: a second engagement keeps the first stop id, so a lift already in
 * motion for it still means what it meant. A LIFTED record gets a NEW stop id and keeps its history, so
 * an old lift can never lift a new stop. An UNREADABLE record is moved aside, never overwritten, before a
 * fresh one is written — and if it cannot be moved aside, nothing is overwritten and the answer is that
 * the platform is already stopped, which it is, because an unreadable record already refuses everything.
 *
 * THE READ-BACK IS ASKED TWICE. A lift that was verifying in another process while this ran could land
 * after this decided "already engaged"; reading once more after deciding closes that window from this
 * side — the stop wins.
 */
export function engagePlatformStop(
  sys: System,
  stateDir: string | null,
  claim: { readonly reason: unknown; readonly engagedBy: unknown },
  mint: (now: string) => string = mintStopId,
): EngageOutcome {
  if (stateDir === null || stateDir.trim() === '') {
    return {
      kind: 'FAILED',
      lines: [
        'THE STOP WAS NOT RECORDED: no per-user application-data directory could be resolved to hold it.',
        '  every governed command on this machine already refuses for the same reason, so nothing can start;',
        '  restore LOCALAPPDATA (or HOME) and engage the stop again so the refusal is recorded and not incidental',
        PLATFORM_STOP_STATEMENT,
      ],
    };
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const outcome = engageOnce(sys, stateDir, claim, mint);
    if (outcome.kind === 'FAILED') return outcome;
    const back = readPlatformStop(sys, stateDir);
    if (back.kind === 'ok' && back.record.state === 'engaged') return outcome;
    if (back.kind === 'unreadable') return outcome;
  }
  return {
    kind: 'FAILED',
    lines: ['THE STOP COULD NOT BE CONFIRMED: the record did not read back as engaged twice in a row.', PLATFORM_STOP_STATEMENT],
  };
}

function engageOnce(
  sys: System,
  stateDir: string,
  claim: { readonly reason: unknown; readonly engagedBy: unknown },
  mint: (now: string) => string,
): EngageOutcome {
  const at = sys.now();
  const read = readPlatformStop(sys, stateDir);
  if (read.kind === 'ok' && read.record.state === 'engaged') {
    return { kind: 'ALREADY_ENGAGED', stopId: read.record.stopId, lines: engagedLines(read.record, true) };
  }
  const prior: StopEvent[] = read.kind === 'ok' ? [...read.record.history] : [];
  const stopId = mint(at);
  if (read.kind === 'unreadable') {
    const aside = `${read.path}.unreadable-${stopId}`;
    if (!sys.renameFile(read.path, aside)) {
      return {
        kind: 'FAILED',
        lines: [
          'THE PLATFORM IS ALREADY STOPPED: its stop record cannot be read, and an unreadable record refuses everything.',
          '  it could not be moved aside, so it was NOT overwritten; repair it by hand to engage a fresh, liftable stop',
          PLATFORM_STOP_STATEMENT,
        ],
      };
    }
    prior.push({ event: 'replaced-unreadable', stopId, at, detail: `the unreadable record was preserved beside it (${read.why})` });
  }
  const reason = text(claim.reason) || '(no reason given)';
  const by = text(claim.engagedBy) || 'unspecified';
  const record: PlatformStopRecord = {
    schemaVersion: PLATFORM_STOP_SCHEMA_VERSION,
    state: 'engaged',
    stopId,
    engagedAt: at,
    engagedBy: { claim: by, authenticated: false },
    reason,
    statement: PLATFORM_STOP_STATEMENT,
    history: [...prior, { event: 'engaged', stopId, at, detail: `engaged by ${by} (unauthenticated claim)` }],
  };
  const written = writeRecord(sys, stateDir, record);
  if (!written.written) {
    return { kind: 'FAILED', lines: [`THE STOP WAS NOT RECORDED: ${written.problem}.`, '  engage it again', PLATFORM_STOP_STATEMENT] };
  }
  return { kind: 'ENGAGED', stopId, lines: engagedLines(record, false) };
}

/**
 * Record the lift — called ONLY by `stop lift`, ONLY after the owner-authored commit has been verified.
 *
 * Re-reads the record immediately before writing, and refuses unless it still names THIS stop as
 * engaged: a stop engaged afresh in the meantime has a new id, and an old lift does not reach it.
 */
export function recordPlatformStopLift(sys: System, stateDir: string, stopId: string, liftCommit: string): StopWrite {
  const read = readPlatformStop(sys, stateDir);
  if (read.kind !== 'ok' || read.record.state !== 'engaged' || read.record.stopId !== stopId) {
    return { written: false, problem: `stop ${stopId} is no longer the engaged stop, so this lift does not apply to what is engaged now` };
  }
  if (!/^[0-9a-f]{40}$/.test(liftCommit)) return { written: false, problem: 'the lift commit is not a full commit id' };
  const at = sys.now();
  return writeRecord(sys, stateDir, {
    ...read.record,
    state: 'lifted',
    liftedAt: at,
    liftedStopId: stopId,
    liftCommit,
    history: [...read.record.history, { event: 'lifted', stopId, at, detail: `lifted by the owner-authored commit ${liftCommit}` }],
  });
}

/** `stop status`: the record as it stands, with the statement. Reads only. */
export function platformStopStatusLines(sys: System, stateDir: string | null): readonly string[] {
  const read = readPlatformStop(sys, stateDir);
  // AN UNRESOLVABLE OR UNREADABLE RECORD IS A STOP, and its status is exactly the refusal it causes.
  if (read.kind === 'unresolvable' || read.kind === 'unreadable') return platformStopRefusal(sys, stateDir) ?? [];
  if (read.kind === 'absent') {
    return [`Platform stop: NOT ENGAGED (no record at ${read.path}).`, PLATFORM_STOP_STATEMENT];
  }
  const r = read.record;
  return [
    r.state === 'engaged' ? `Platform stop: ENGAGED — ${r.stopId} since ${r.engagedAt}` : `Platform stop: LIFTED — ${r.stopId} at ${r.liftedAt ?? '?'} by commit ${r.liftCommit ?? '?'}`,
    `  record: ${read.path}`,
    `  reason, as given and inert: ${JSON.stringify(r.reason)}`,
    `  engaged by (an unauthenticated claim): ${JSON.stringify(r.engagedBy.claim)}`,
    `  history: ${r.history.length} event(s)`,
    ...r.history.map((e) => `    ${e.at}  ${e.event}  ${e.stopId}  ${text(e.detail)}`),
    ...(r.state === 'engaged' ? nextSteps(r.stopId) : []),
    PLATFORM_STOP_STATEMENT,
  ];
}

/**
 * THE EMERGENCY STOP FOR THIS WINDOWS ACCOUNT ON THIS MACHINE — PROJECTOS-KERNEL-PLATFORM-STOP1A.
 *
 * One record, one check. The record says whether the owner has stopped ProjectOS; the check is the
 * single question every entry point that can start work, spend, commit, push or close asks before it
 * does any of those things. There is deliberately no second reader: two readers disagree eventually,
 * and the disagreement is discovered by something running that should have stopped.
 *
 * WHERE THE RECORD LIVES, AND WHY THERE. `<installation state>/platform-stop.json`, in the per-user
 * application-data directory of THIS account. It is outside every repository, so a bounded worker —
 * which writes only inside its project — cannot remove it, and it is one file for every project this
 * account governs on this machine. It is not a fleet-wide or machine-wide stop, and says so.
 *
 * THE DIRECTORY IS DERIVED FROM THE OPERATING SYSTEM, NOT FROM THE ENVIRONMENT. `os.userInfo()` asks the
 * account database for the profile directory; LOCALAPPDATA, XDG_STATE_HOME and HOME are variables any
 * parent process can set. The rest of the installation state still resolves through the environment
 * (`nodeInstallationStateDir`), so the two are COMPARED: when they disagree, the stop and the records it
 * governs would live in different places, and the directory is treated as unverifiable — which is
 * stopped. A variable can therefore stop ProjectOS, never lift a stop.
 *
 * WHAT IS JUDGED, AND BY WHOM (ADR-K1 R7). The stop is judged by the EXECUTING principal at the moment
 * it executes, not by whoever approved the work. So the check is asked again at every step that can
 * have an effect — not once at admission — and an approval granted before the stop buys nothing after
 * it.
 *
 * LIFTING IS AN OWNER-INTENT CHECK, NOT PROOF. The lift needs a commit under the owner's git name that
 * touches only the lift record, made from the project the stop was engaged in, plus the stop id retyped
 * in an interactive terminal. A git name is configuration and a terminal is not a person: together they
 * show that someone at this account's keyboard meant it, which agents running without a terminal cannot
 * fake. It is not cryptographic proof of the owner; a later phase adds Windows Hello.
 *
 * FAIL CLOSED, EVERY WAY. An absent record means running; a validly lifted one means running; nothing
 * else does. Engaged, unreadable, invalid and unresolvable each mean STOPPED.
 *
 * IT ONLY REFUSES. Nothing here decides a closure, changes an eligibility predicate, edits the owner-only
 * set or touches any committed authority record.
 *
 * NO GIT, EVER, IN THE CHECK. `platformStopRefusal` reads one file and runs nothing: it is called from
 * inside test worlds whose fake git fails on any command it does not expect, and from paths that run
 * before git has been established at all.
 */
import { randomBytes } from 'node:crypto';
import { readSync, statSync, writeSync } from 'node:fs';
import os from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { join } from '../context.js';
import { loadGovernedContext } from '../governedContext.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import type { System } from '../system.js';

export const PLATFORM_STOP_SCHEMA_VERSION = '1.1.0';
export const PLATFORM_STOP_FILENAME = 'platform-stop.json';

/** Where the owner's lift record is committed, inside the governed project. Never matched by `.gitignore`. */
export const STOP_LIFTS_REL = '.projectops/stop-lifts';

/** The `kind` a lift record must carry, so no other committed JSON file can be mistaken for one. */
export const STOP_LIFT_KIND = 'projectos-platform-stop-lift';

/** How much of a free-text reason or claim is ever kept. Inert text, bounded. */
export const STOP_TEXT_MAX = 280;

/** What the stop covers, said the same way everywhere. */
export const STOP_SCOPE = 'this Windows account on this machine';

/**
 * THE ONE HONEST STATEMENT, carried by every refusal and every stop output, lift refusals included.
 *
 * A stop that let people believe it had undone something — or that its lift proved who lifted it —
 * would be worse than no stop. Saying so at the moment it matters is the point.
 */
export const PLATFORM_STOP_STATEMENT =
  'This stop covers this Windows account on this machine. It does NOT reverse completed external effects: ' +
  'commits already pushed, paid provider calls already made, messages already sent and payments already ' +
  'made all stand. A worker that is already running is not killed; it ends at its next check. The ' +
  'ProjectOS Host service is not touched. Lifting it is an owner-intent check — a git name match plus the ' +
  'stop id retyped in a terminal — not cryptographic proof of the owner; a later phase adds Windows Hello.';

/** The only lift guidance any refusal carries: no command an agent could copy and paste. */
export const STOP_LIFT_HINT = '  - a person lifts this with `projectos stop lift` in a terminal';

/*
 * WHAT THE REFUSING STEP HAD ALREADY DONE. The sentence used to be fixed — "nothing was started, spent,
 * committed or pushed by this command" — and that was false for a run that had already dispatched a
 * worker, or a closure that had already paid for its answer. The caller says which is true.
 */
export const STOP_NOTHING_DONE = 'nothing was started, spent, committed or pushed by this command';
export const STOP_AFTER_WORK =
  'this run had already done the work reported above before the stop was seen; nothing further was ' +
  'started, spent, committed or pushed after it';
export const STOP_AFTER_ASK =
  'the closure question had already been asked — and on the unattended route paid for — before the stop ' +
  'was seen; nothing was committed or pushed after it';
export const STOP_AFTER_OWNER_COMMIT =
  "the owner's commit had already been observed before the stop was seen; nothing was closed, committed or pushed after it";
export const STOP_BEFORE_ACT = 'this step was stopped before it acted: nothing was committed, pushed or integrated by it';
export const STOP_AFTER_COMMIT = 'the commit reported above was made before the stop was seen; nothing was pushed after it';

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

/** The governed project the stop was engaged from. A lift is accepted only from the same one. */
export interface StopProject {
  readonly projectId: string;
  readonly planId: string | null;
  readonly root: string;
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
  /** Null when the stop was engaged outside any governed project; then only the installation's root lifts it. */
  readonly project: StopProject | null;
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

function forwardSlashes(p: string): string {
  return p.split(String.fromCharCode(92)).join('/');
}

/** Two paths name the same place: separators, a trailing slash and (on Windows) case do not count. */
export function sameStopPath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const f = forwardSlashes(resolve(p)).replace(/\/+$/, '');
    return process.platform === 'win32' ? f.toLowerCase() : f;
  };
  return norm(a) === norm(b);
}

/**
 * The state directory as the OPERATING SYSTEM places it: the account's profile from the account
 * database, then `AppData/Local` on Windows (the profile itself elsewhere, matching the installation's
 * own HOME fallback). Null when the account database gives no usable answer.
 */
export function osInstallationStateDir(): string | null {
  let home: string;
  try {
    home = os.userInfo().homedir;
  } catch {
    return null;
  }
  if (typeof home !== 'string' || home.trim() === '' || !isAbsolute(home)) return null;
  const base = process.platform === 'win32' ? resolve(home, 'AppData', 'Local') : home;
  return forwardSlashes(resolve(base, 'ProjectOS', 'installation-state'));
}

/**
 * Where production reads the stop: the OS-derived directory, and only while the environment-derived
 * installation state directory agrees with it. Disagreement is unverifiable, which is stopped.
 */
export function defaultPlatformStopStateDir(): string | null {
  const derived = osInstallationStateDir();
  const configured = nodeInstallationStateDir();
  if (derived === null || configured === null) return null;
  return sameStopPath(derived, configured) ? derived : null;
}

/**
 * The state directory a command should consult: the composition root's own answer, unless a TEST has
 * named one on the context.
 *
 * WHY A CONTEXT FIELD AND NOT AN ENVIRONMENT VARIABLE. One variable that pointed the stop at an empty
 * directory would lift it. A property on the in-process context is reachable only by code already
 * running inside ProjectOS; production entrypoints never set it. An explicit `null` (or a present but
 * unusable value) is an unresolvable directory and refuses.
 */
export function platformStopDirOf(ctx: object): string | null {
  if (!('platformStopStateDir' in ctx)) return defaultPlatformStopStateDir();
  const named = (ctx as { readonly platformStopStateDir?: unknown }).platformStopStateDir;
  return typeof named === 'string' && named.trim() !== '' ? named : null;
}

/** Characters that could forge a line, reorder text on screen, or hide inside it. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

function text(value: unknown): string {
  // INERT AND BOUNDED: C0 and C1 controls, line and paragraph separators and bidirectional overrides
  // become spaces, so a reason can neither forge a further output line nor display as something else.
  const raw = typeof value === 'string' ? value : '';
  return raw.replace(UNSAFE_TEXT, ' ').trim().slice(0, STOP_TEXT_MAX);
}

function validEvent(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
  const v = e as Record<string, unknown>;
  return (
    (v['event'] === 'engaged' || v['event'] === 'lifted' || v['event'] === 'replaced-unreadable') &&
    typeof v['stopId'] === 'string' &&
    typeof v['at'] === 'string' &&
    typeof v['detail'] === 'string'
  );
}

function validProject(p: unknown): boolean {
  if (p === null) return true;
  if (typeof p !== 'object' || Array.isArray(p)) return false;
  const v = p as Record<string, unknown>;
  return typeof v['projectId'] === 'string' && typeof v['root'] === 'string' && (v['planId'] === null || typeof v['planId'] === 'string');
}

/** The record, if it is one. Anything else is null, and null means stopped. */
function validRecord(parsed: unknown): PlatformStopRecord | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (r['schemaVersion'] !== PLATFORM_STOP_SCHEMA_VERSION) return null;
  if (r['state'] !== 'engaged' && r['state'] !== 'lifted') return null;
  if (typeof r['stopId'] !== 'string' || !isStopId(r['stopId'])) return null;
  if (typeof r['engagedAt'] !== 'string' || !Array.isArray(r['history'])) return null;
  // EVERY HISTORY ENTRY IS AN EVENT. A null or foreign element would make `stop status` throw, and a
  // record a reader cannot walk is a damaged record — which is stopped.
  if (!(r['history'] as unknown[]).every(validEvent)) return null;
  if (!('project' in r) || !validProject(r['project'])) return null;
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

function parseRecord(raw: string): { readonly record: PlatformStopRecord } | { readonly why: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { why: 'it is not valid JSON' };
  }
  const record = validRecord(parsed);
  return record === null ? { why: 'it is not a valid platform stop record' } : { record };
}

/**
 * Is this path DEFINITELY absent — as opposed to unreachable?
 *
 * `existsSync` answers false for a missing file, and ALSO for a directory it may not enter (EACCES) or a
 * parent that is a file (ENOTDIR — which Windows reports as ENOENT). So the path is walked upward to the
 * first component that exists: only when every failure on the way is ENOENT, and that first existing
 * ancestor is a directory, is the record truly absent. Anything else is unreachable, which is stopped.
 */
function definitelyAbsent(path: string): boolean {
  let at = resolve(path);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const isDirectory = statSync(at).isDirectory();
      // The record itself exists (depth 0): not absent. An ancestor exists: absent only if it is a directory.
      return depth > 0 && isDirectory;
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code !== 'ENOENT') return false;
    }
    const up = resolve(at, '..');
    if (up === at) return true;
    at = up;
  }
  return false;
}

/**
 * What the record says, with "never engaged" kept apart from "cannot be read".
 *
 * `readText` returns null for an absent file AND for one that exists but could not be read, so `exists`
 * and then the operating system's own error code are asked to tell those apart.
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
      present = sys.exists(path) || !definitelyAbsent(path);
    } catch {
      present = true;
    }
    return present ? { kind: 'unreadable', path, why: 'it exists or is unreachable, but could not be read' } : { kind: 'absent', path };
  }
  const parsed = parseRecord(raw);
  if ('why' in parsed) return { kind: 'unreadable', path, why: parsed.why };
  return { kind: 'ok', path, record: parsed.record };
}

/**
 * THE CHECK. `null` means running; anything else is the refusal, ready to print.
 *
 * One file read, nothing executed. Absent and validly lifted are the only "running" answers. Every
 * refusal carries the honest statement, and `consequence` says truthfully what the refusing step had
 * already done — by default, nothing.
 */
export function platformStopRefusal(
  sys: System,
  stateDir: string | null | undefined = defaultPlatformStopStateDir(),
  consequence: string = STOP_NOTHING_DONE,
): readonly string[] | null {
  const read = readPlatformStop(sys, stateDir ?? null);
  if (read.kind === 'absent') return null;
  if (read.kind === 'ok' && read.record.state === 'lifted') return null;
  if (read.kind === 'unresolvable') {
    return [
      `REFUSED (PLATFORM_STOP_UNVERIFIABLE): the state directory for ${STOP_SCOPE} could not be established`,
      '  from the operating system, or the environment disagrees with it, so whether the owner\'s emergency stop',
      `  is engaged cannot be known. ProjectOS treats itself as STOPPED; ${consequence}.`,
      PLATFORM_STOP_STATEMENT,
    ];
  }
  if (read.kind === 'unreadable') {
    return [
      `REFUSED (PLATFORM_STOP_UNREADABLE): the emergency stop record at ${read.path} cannot be trusted (${read.why}),`,
      `  so ProjectOS treats itself as STOPPED; ${consequence}.`,
      '  - the record must be repaired by hand before it can be lifted; until then ProjectOS stays stopped',
      PLATFORM_STOP_STATEMENT,
    ];
  }
  const r = read.record;
  return [
    `REFUSED (PLATFORM_STOP): the owner's emergency stop ${r.stopId} for ${STOP_SCOPE} is engaged (since ${r.engagedAt}).`,
    `  - reason, as given and inert: ${JSON.stringify(r.reason)}`,
    `  - engaged by (an unauthenticated claim): ${JSON.stringify(r.engagedBy.claim)}`,
    `  - ${consequence}`,
    STOP_LIFT_HINT,
    PLATFORM_STOP_STATEMENT,
  ];
}

/**
 * The Control Center's gate. Every verb refuses under a stop except the three that cannot act:
 * `refresh` reads, `project.select` only changes which project the surface shows, and `run.stop` ends a
 * child the sidecar already owns, which is what a stop wants. Lives here so the sidecar asks the one
 * check rather than keeping a copy, and so its decision is tested.
 */
export const CONTROL_CENTER_VERBS_UNDER_STOP: readonly string[] = ['refresh', 'project.select', 'run.stop'];

export function controlCenterVerbRefusal(
  sys: System,
  verb: string,
  stateDir: string | null | undefined = defaultPlatformStopStateDir(),
): readonly string[] | null {
  if (CONTROL_CENTER_VERBS_UNDER_STOP.includes(verb)) return null;
  return platformStopRefusal(sys, stateDir);
}

/** A stop id nobody else will mint: the engagement instant plus 48 random bits. */
export function mintStopId(now: string): string {
  const stamp = now.replace(/[^0-9TZ]/g, '').slice(0, 16);
  return `STOP-${stamp.length >= 8 ? stamp : '00000000'}-${randomBytes(6).toString('hex')}`;
}

/** The governed project at this root, as a stop binds to it, or null. Reads only; never throws. */
export function governedProjectOf(sys: System, root: string): StopProject | null {
  try {
    const gc = loadGovernedContext(sys, root);
    if (!gc.ok) return null;
    const planId = gc.context.plan['planId'];
    return { projectId: gc.context.projectId, planId: typeof planId === 'string' ? planId : null, root: forwardSlashes(resolve(root)) };
  } catch {
    return null;
  }
}

export type StopWrite = { readonly written: true } | { readonly written: false; readonly problem: string };

interface ReplaceOptions {
  /** Where a standing record is moved before the new one goes in. Absent when nothing is moved aside. */
  readonly aside?: string;
  /** Asked immediately before anything standing is touched; a reason refuses the write (compare-and-swap). */
  readonly stillApplies?: () => string | null;
}

/**
 * Replace the record WITHOUT EVER DROPPING A STANDING STOP.
 *
 * ORDER IS THE PROPERTY: the new record is written to a temporary file and read back from there FIRST;
 * only then is anything standing touched — the compare-and-swap is asked, a damaged record is moved
 * aside, and the new one is moved into place. If the final move fails, the damaged record is moved
 * back, so at every moment a reader finds either the old stop or the new one, never nothing.
 */
function writeRecord(sys: System, stateDir: string, next: PlatformStopRecord, opts: ReplaceOptions = {}): StopWrite {
  const path = platformStopPath(stateDir);
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error: unknown) {
    return { written: false, problem: `the emergency stop record could not be written: ${error instanceof Error ? error.message : 'write failed'}` };
  }
  const staged = sys.readText(temporary);
  const stagedRecord = staged === null ? null : parseRecord(staged);
  if (stagedRecord === null || 'why' in stagedRecord || stagedRecord.record.stopId !== next.stopId || stagedRecord.record.state !== next.state) {
    return { written: false, problem: 'the new emergency stop record did not read back from its temporary file' };
  }
  const changed = opts.stillApplies?.() ?? null;
  if (changed !== null) return { written: false, problem: changed };
  if (opts.aside !== undefined && !sys.renameFile(path, opts.aside)) {
    return { written: false, problem: 'the damaged record could not be moved aside, so it was left exactly where it was' };
  }
  if (!sys.renameFile(temporary, path)) {
    if (opts.aside !== undefined) sys.renameFile(opts.aside, path);
    return { written: false, problem: 'the new emergency stop record could not be moved into place; the record that stood was restored' };
  }
  const back = readPlatformStop(sys, stateDir);
  if (back.kind !== 'ok' || back.record.state !== next.state || back.record.stopId !== next.stopId) {
    return { written: false, problem: 'the emergency stop record did not read back as written' };
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
      ? `The emergency stop ${record.stopId} for ${STOP_SCOPE} was ALREADY engaged (since ${record.engagedAt}); it stays engaged.`
      : `EMERGENCY STOP ENGAGED for ${STOP_SCOPE}: ${record.stopId} at ${record.engagedAt}.`,
    '  every ProjectOS entry point that can start work, spend, commit, push or close now refuses,',
    '  and every technical delegation is suspended, until the owner lifts this stop',
    `  - reason, as given and inert: ${JSON.stringify(record.reason)}`,
    `  - engaged by (an unauthenticated claim): ${JSON.stringify(record.engagedBy.claim)}`,
    `  - bound to: ${record.project === null ? "no governed project; only the installation's own project root can lift it" : `project '${record.project.projectId}'`}`,
    STOP_LIFT_HINT,
    PLATFORM_STOP_STATEMENT,
  ];
}

/**
 * ENGAGE THE STOP. Needs no authority, because stopping is always safe.
 *
 * AN ENGAGED STOP IS NOT RE-ENGAGED: a second engagement keeps the first stop id. A LIFTED record gets a
 * NEW stop id and keeps its history, so an old lift can never lift a new stop. An UNREADABLE record is
 * never dropped: the new record is staged and verified first, the damaged one is moved aside only then,
 * and it is restored if the new one cannot be moved in. The read-back is asked twice, so a lift landing
 * in another process after this decided "already engaged" loses — the stop wins.
 */
export function engagePlatformStop(
  sys: System,
  stateDir: string | null,
  claim: { readonly reason: unknown; readonly engagedBy: unknown; readonly project?: StopProject | null },
  mint: (now: string) => string = mintStopId,
): EngageOutcome {
  if (stateDir === null || stateDir.trim() === '') {
    return {
      kind: 'FAILED',
      lines: [
        `THE STOP WAS NOT RECORDED: no state directory for ${STOP_SCOPE} could be established to hold it.`,
        '  every governed command here already refuses for the same reason, so nothing can start; restore the',
        '  account profile (and an environment that agrees with it) and engage the stop again so the refusal is recorded',
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
  claim: { readonly reason: unknown; readonly engagedBy: unknown; readonly project?: StopProject | null },
  mint: (now: string) => string,
): EngageOutcome {
  const at = sys.now();
  const read = readPlatformStop(sys, stateDir);
  if (read.kind === 'ok' && read.record.state === 'engaged') {
    return { kind: 'ALREADY_ENGAGED', stopId: read.record.stopId, lines: engagedLines(read.record, true) };
  }
  const prior: StopEvent[] = read.kind === 'ok' ? [...read.record.history] : [];
  const stopId = mint(at);
  const aside = read.kind === 'unreadable' ? `${read.path}.unreadable-${stopId}` : undefined;
  if (read.kind === 'unreadable') {
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
    project: claim.project ?? null,
    statement: PLATFORM_STOP_STATEMENT,
    history: [...prior, { event: 'engaged', stopId, at, detail: `engaged by ${by} (unauthenticated claim)` }],
  };
  const written = writeRecord(sys, stateDir, record, aside === undefined ? {} : { aside });
  if (!written.written) {
    return {
      kind: 'FAILED',
      lines: [
        `THE STOP WAS NOT RECORDED: ${written.problem}.`,
        read.kind === 'unreadable'
          ? '  the damaged record still stands, and a damaged record already refuses everything'
          : '  engage it again',
        PLATFORM_STOP_STATEMENT,
      ],
    };
  }
  return { kind: 'ENGAGED', stopId, lines: engagedLines(record, false) };
}

/**
 * Record the lift — called ONLY by `stop lift`, ONLY after every owner-intent check has passed.
 *
 * A COMPARE-AND-SWAP: the record is read now, and read AGAIN immediately before the new one is moved
 * into place; unless it still names THIS stop as engaged, nothing is written. A stop engaged afresh in
 * the meantime has a new id, and an old lift does not reach it.
 */
export function recordPlatformStopLift(sys: System, stateDir: string, stopId: string, liftCommit: string): StopWrite {
  const stillEngaged = (): string | null => {
    const now = readPlatformStop(sys, stateDir);
    return now.kind === 'ok' && now.record.state === 'engaged' && now.record.stopId === stopId
      ? null
      : `stop ${stopId} is no longer the engaged stop, so this lift does not apply to what is engaged now`;
  };
  const read = readPlatformStop(sys, stateDir);
  if (read.kind !== 'ok' || read.record.state !== 'engaged' || read.record.stopId !== stopId) {
    return { written: false, problem: `stop ${stopId} is no longer the engaged stop, so this lift does not apply to what is engaged now` };
  }
  if (!/^[0-9a-f]{40}$/.test(liftCommit)) return { written: false, problem: 'the lift commit is not a full commit id' };
  const at = sys.now();
  return writeRecord(
    sys,
    stateDir,
    {
      ...read.record,
      state: 'lifted',
      liftedAt: at,
      liftedStopId: stopId,
      liftCommit,
      history: [...read.record.history, { event: 'lifted', stopId, at, detail: `lifted after the owner-intent check, commit ${liftCommit}` }],
    },
    { stillApplies: stillEngaged },
  );
}

/** `stop status`: the record as it stands, with the statement. Reads only. */
export function platformStopStatusLines(sys: System, stateDir: string | null): readonly string[] {
  const read = readPlatformStop(sys, stateDir);
  // AN UNRESOLVABLE OR UNREADABLE RECORD IS A STOP, and its status is exactly the refusal it causes.
  if (read.kind === 'unresolvable' || read.kind === 'unreadable') return platformStopRefusal(sys, stateDir) ?? [];
  if (read.kind === 'absent') {
    return [`Emergency stop for ${STOP_SCOPE}: NOT ENGAGED (no record at ${read.path}).`, PLATFORM_STOP_STATEMENT];
  }
  const r = read.record;
  return [
    r.state === 'engaged'
      ? `Emergency stop for ${STOP_SCOPE}: ENGAGED — ${r.stopId} since ${r.engagedAt}`
      : `Emergency stop for ${STOP_SCOPE}: LIFTED — ${r.stopId} at ${r.liftedAt ?? '?'} after commit ${r.liftCommit ?? '?'}`,
    `  record: ${read.path}`,
    `  reason, as given and inert: ${JSON.stringify(r.reason)}`,
    `  engaged by (an unauthenticated claim): ${JSON.stringify(r.engagedBy.claim)}`,
    `  bound to: ${r.project === null ? "no governed project (lift from the installation's own project root)" : `project '${r.project.projectId}' at ${r.project.root}`}`,
    `  history: ${r.history.length} event(s)`,
    ...r.history.map((e) => `    ${e.at}  ${e.event}  ${e.stopId}  ${text(e.detail)}`),
    ...(r.state === 'engaged' ? [STOP_LIFT_HINT] : []),
    PLATFORM_STOP_STATEMENT,
  ];
}

/* ----------------------------------------------------------------------------------------------
 * THE TYPED CONFIRMATION — the in-person half of the lift.
 * ------------------------------------------------------------------------------------------- */

export type StopLiftConfirmation = { readonly kind: 'typed'; readonly text: string } | { readonly kind: 'no-terminal' };
export type StopLiftConfirm = (stopId: string) => StopLiftConfirmation;

/** What the confirmation needs from a terminal. Injected so the refusal without one is testable. */
export interface StopLiftTerminal {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly ask: (question: string) => string | null;
}

/** How long a person may take to type, before the lift gives up rather than hanging for ever. */
const TERMINAL_WAIT_MS = 5 * 60_000;

/** One line from the controlling terminal, synchronously. Null when it cannot be read. */
function askTerminal(question: string): string | null {
  try {
    writeSync(1, question);
  } catch {
    return null;
  }
  const one = Buffer.alloc(1);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let line = '';
  let waited = 0;
  while (line.length < 200) {
    let n: number;
    try {
      n = readSync(0, one, 0, 1, null);
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code === 'EAGAIN' && waited < TERMINAL_WAIT_MS) {
        Atomics.wait(pause, 0, 0, 50);
        waited += 50;
        continue;
      }
      return null;
    }
    if (n === 0) break;
    const ch = one.toString('utf8');
    if (ch === '\n') break;
    if (ch !== '\r') line += ch;
  }
  return line;
}

function nodeTerminal(): StopLiftTerminal {
  return { stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true, ask: askTerminal };
}

/**
 * The production confirmation: ONLY in an interactive terminal — standard input AND standard output
 * both a TTY — and only by retyping the stop id. Agents run without a terminal; without one the answer
 * is `no-terminal`, never a guess and never a default.
 */
export function terminalStopLiftConfirm(terminal: () => StopLiftTerminal = nodeTerminal): StopLiftConfirm {
  return (stopId) => {
    const t = terminal();
    if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'no-terminal' };
    const typed = t.ask(`Lifting emergency stop ${stopId} for ${STOP_SCOPE}.\nRetype the stop id exactly to confirm: `);
    return typed === null ? { kind: 'no-terminal' } : { kind: 'typed', text: typed };
  };
}

/** The confirmation a command uses: a test's, when one is named on the context, else the terminal's. */
export function platformStopConfirmOf(ctx: object): StopLiftConfirm {
  const named = (ctx as { readonly platformStopConfirm?: unknown }).platformStopConfirm;
  return typeof named === 'function' ? (named as StopLiftConfirm) : terminalStopLiftConfirm();
}

/** The installation's own project root: where a stop engaged outside any project is lifted. */
export function platformStopInstallRootOf(ctx: object): string {
  const named = (ctx as { readonly platformStopInstallRoot?: unknown }).platformStopInstallRoot;
  return typeof named === 'string' && named.trim() !== '' ? named : nodeProjectosRuntime().installRoot;
}

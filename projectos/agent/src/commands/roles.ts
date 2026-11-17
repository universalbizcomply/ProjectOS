/**
 * `projectos roles` — PROJECTOS-PROVIDER-ROLES1A (plan 4.2, first slice).
 *
 * A READ-ONLY REPORT of which already-authorised worker, or the committed gatekeeper route, fills each role,
 * with its capabilities and cost class. It reads `.projectops/provider-roles.json` from COMMITTED bytes only
 * (a working-tree copy that differs is flagged, never used) and judges it against what the project has
 * already authorised: the committed `execution.workers` and the committed gatekeeper route and rate cards.
 *
 * SELECTION AND RECORDING ONLY. It writes nothing, starts nothing, spends nothing and reads no credential.
 * Nothing consults the registry to choose a worker, and a well-formed registry is not an approval of anything.
 * Registry text is data: it is printed inert and capped.
 */
import { ROLE_IDS, selectForRole, type KnownRoleSources, type RoleEntry, type RoleRefusal, type RoleRegistry } from '@projectos/core';
import { loadCommittedRoleRegistry } from '../modelBroker/committedConfig.js';
import type { CommandContext, CommandResult } from '../context.js';
import { fail, join, ok } from '../context.js';
import type { Flags } from '../flags.js';
import { loadGovernedContext, refusalLines } from '../governedContext.js';
import { GATEKEEPER_CONFIG_REL, loadGatekeeperConfig } from '../loop/gatekeeperConfig.js';
import { authorisedWorkers, committedExecutionProblems } from '../loop/workers.js';
import type { System } from '../system.js';

export const ROLE_REGISTRY_REL = '.projectops/provider-roles.json';

const USAGE = 'Use: roles (it takes no arguments; it only reports)';
const MAX_PRINTED = 160;
const MAX_REASONS = 5;
const GIT_READ_BYTES = 65536;

export type RoleSources = { readonly ok: true; readonly known: KnownRoleSources; readonly lines: readonly string[] } | { readonly ok: false; readonly lines: readonly string[] };

/** Where what the project authorises comes from. Injected so a test needs no governed checkout. */
export type RoleSourcesPort = (ctx: CommandContext) => RoleSources;

/** Registry and refusal text, made safe to print: printable ASCII only, and capped. */
function inert(text: unknown, max: number = MAX_PRINTED): string {
  const plain = String(text).replace(/[^\x20-\x7e]/g, '?');
  return plain.length > max ? `${plain.slice(0, max)}...` : plain;
}

function committedRead(sys: System, root: string): (path: string) => { text: string; commit: string } | null {
  return (path) => {
    const options = { isolatedGit: {}, maxOutputBytes: GIT_READ_BYTES };
    const base = ['--no-replace-objects', '-C', root];
    const head = sys.exec('git', [...base, 'rev-parse', 'HEAD'], options);
    const shown = sys.exec('git', [...base, 'show', `HEAD:./${path}`], options);
    return head.code === 0 && shown.code === 0 ? { text: shown.stdout, commit: head.stdout.trim() } : null;
  };
}

const sameBytes = (a: string, b: string): boolean => a.replace(/^﻿/, '').replace(/\r\n/g, '\n') === b.replace(/^﻿/, '').replace(/\r\n/g, '\n');

function committedTransportId(sys: System, root: string): string | null {
  const found = committedRead(sys, root)(GATEKEEPER_CONFIG_REL);
  if (found === null) return null;
  try {
    const id = (JSON.parse(found.text) as { transport?: { transportId?: unknown } } | null)?.transport?.transportId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * What the project authorises, from the protected readers: the governed context and `authorisedWorkers` for the
 * workers (the `execution` block must match its committed copy), `loadGatekeeperConfig` for the rate cards, and the
 * committed gatekeeper record for the transport id. No gatekeeper is not a refusal: a registry may then name none.
 */
export const productionRoleSources: RoleSourcesPort = (ctx) => {
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  if (!gc.ok) return { ok: false, lines: refusalLines(gc) };
  const drift = committedExecutionProblems(ctx.sys, ctx.root, gc.context);
  if (drift.length > 0) return { ok: false, lines: ['REFUSED (EXECUTION_NOT_COMMITTED):', ...drift.map((p) => `  - ${inert(p)}`)] };
  const workers = authorisedWorkers(gc.context);
  if (!workers.ok) return { ok: false, lines: ['REFUSED (NO_AUTHORISED_WORKERS):', ...workers.problems.slice(0, MAX_REASONS).map((p) => `  - ${inert(p)}`)] };
  const gatekeeper = loadGatekeeperConfig(ctx.sys, ctx.root, 'not-needed');
  const transportId = committedTransportId(ctx.sys, ctx.root);
  if (gatekeeper.ok && transportId !== null && transportId === gatekeeper.config.transport.transportId) {
    return { ok: true, known: { workerIds: workers.workers.map((w) => w.workerId), gatekeeperTransportId: transportId, rateCards: gatekeeper.config.rateCards }, lines: [] };
  }
  const why = gatekeeper.ok ? 'its transport differs from the committed record' : gatekeeper.reasons.slice(0, 1).map((r) => inert(r, 120)).join('');
  return { ok: true, known: { workerIds: workers.workers.map((w) => w.workerId), gatekeeperTransportId: null, rateCards: {} }, lines: [`gatekeeper route: none usable here (${why})`] };
};

const costText = (entry: RoleEntry): string => (entry.cost.class === 'metered' ? `metered, model ${inert(entry.cost.model, 60)}` : 'unmetered');

function roleLines(registry: RoleRegistry, role: string): string[] {
  const picked = selectForRole(registry, role);
  if (picked === null) return [`  ${role}: not assigned`];
  const { entry, standing } = picked;
  const who = entry.transportId === undefined ? `worker ${inert(entry.workerId, 60)}` : `gatekeeper route ${inert(entry.transportId, 60)}`;
  const state = standing === 'awaiting' ? 'awaiting: a decision is not held in this registry' : 'assigned';
  return [`  ${role}: ${who}; capabilities ${entry.capabilities.join(', ')}; cost ${costText(entry)}; ${state}`, `    note: ${inert(entry.notes)}`];
}

function refusalReport(refusals: readonly RoleRefusal[]): CommandResult {
  const shown = refusals.slice(0, MAX_REASONS);
  const lines = shown.flatMap((r) => [`  - ${r.code} at ${inert(r.field, 60)}: ${inert(r.reason)}`, `    next: ${inert(r.next)}`]);
  const more = refusals.length > shown.length ? [`  ... and ${refusals.length - shown.length} more`] : [];
  return fail(2, [`REFUSED (ROLE_REGISTRY): ${ROLE_REGISTRY_REL} was not accepted`, ...lines, ...more]);
}

export function roles(ctx: CommandContext, _flags: Flags, positionals: readonly string[], sources: RoleSourcesPort = productionRoleSources): CommandResult {
  if (positionals.length > 0) return fail(1, [USAGE]);
  const known = sources(ctx);
  if (!known.ok) return fail(2, known.lines);
  const loaded = loadCommittedRoleRegistry({ read: committedRead(ctx.sys, ctx.root), path: ROLE_REGISTRY_REL, known: known.known });
  if (!loaded.ok) return refusalReport(loaded.refusals);
  const working = ctx.sys.readText(join(ctx.root, ...ROLE_REGISTRY_REL.split('/')));
  const differs = working === null || !sameBytes(working, loaded.text);
  const report = [
    `Provider roles (committed at ${loaded.commit.slice(0, 12)})`,
    ...ROLE_IDS.flatMap((role) => roleLines(loaded.registry, role)),
    ...known.lines,
    'Selection and recording only: nothing consults this registry to choose a worker, and nothing in it is an approval.',
  ];
  if (!differs) return ok(report);
  return fail(2, [...report, `FLAGGED (WORKING_COPY_DIFFERS): the working copy of ${ROLE_REGISTRY_REL} is not the committed copy shown above; only the committed copy counts. Commit the change, or restore the file.`]);
}

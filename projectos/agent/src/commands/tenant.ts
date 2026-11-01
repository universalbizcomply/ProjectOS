/**
 * `projectos tenant` — WHOSE WORK THIS IS, AND THE OWNER'S CONFIRMATION OF THE REGISTRY THAT SAYS SO
 * (PROJECTOS-TENANT-PRINCIPAL1A, ADR-T1 §3).
 *
 *   projectos tenant [show]                 read-only: the tenant, domain and registry for this checkout
 *   projectos tenant receipt --blob <sha>   a person, in a terminal: confirm this committed registry
 *
 * `tenant show` WRITES NOTHING AND STARTS NOTHING. It answers under the emergency stop for that reason.
 * It reads no `--tenant`, because the tenant is derived; a flag naming one is simply not looked at.
 *
 * `tenant receipt` IS THE P5 ACTION `tenant-registry-change`, THE SAME SHAPE AS `stop lift`. A person
 * retypes the start of the registry blob in an interactive terminal: standard input and output must both
 * be a TTY, and agents run without one. The grant port the door asks is built only after that, for that
 * one blob. Without a terminal there is no receipt, and `--as owner` changes nothing.
 *
 * THERE IS NO COMMIT HERE, BECAUSE A COMMIT CANNOT TELL THE OWNER FROM AN AGENT. Every commit on this
 * machine is named Murad (ADR-T1 §3). So the receipt lives in the installation state, outside every
 * repository, and one command is the whole owner act. `TENANT_RECEIPT_STATEMENT` says what that does and
 * does not prove, on every answer.
 *
 * WHAT IT WRITES: one line of the envelope record and the one receipt file, in the installation state.
 * Nothing inside any repository.
 */
import { readSync, writeSync } from 'node:fs';
import type { EnvelopeGrantPort } from '@projectos/core';
import { recordExecution } from '@projectos/core';
import type { CommandContext, CommandResult } from '../context.js';
import { type Flags, str } from '../flags.js';
import {
  admissionRefusalLines,
  admitBoundary,
  bindCheckout,
  declaredProjectId,
  deriveProjectTenant,
  READ_ENVELOPE_WINDOW_MS,
  readInstallationRegistries,
  tenantRefusalLines,
  tenantSourceOf,
  type DerivedTenant,
} from '../governedContext.js';
import {
  envelopeRecorder,
  readTenantReceipt,
  TENANT_RECEIPT_STATEMENT,
  TENANT_REGISTRY_REL,
  writeTenantReceipt,
} from '../installation/tenantRegistry.js';

const USAGE: readonly string[] = [
  'Usage:',
  '  projectos tenant [show]                whose work this is: read-only',
  '  projectos tenant receipt --blob <sha>  confirm the committed tenant registry: a person, in a terminal',
];

/** How much of the blob a person retypes: enough that it cannot be done by accident. */
const CONFIRMATION_LENGTH = 12;
const BLOB_SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type TenantReceiptConfirmation = { readonly kind: 'typed'; readonly text: string } | { readonly kind: 'no-terminal' };
export type TenantReceiptConfirm = (blob: string, summary: readonly string[]) => TenantReceiptConfirmation;

/** What the confirmation needs from a terminal. Injected so the refusal without one is testable. */
export interface TenantReceiptTerminal {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly ask: (question: string) => string | null;
}

/** How long a person may take to type, before this gives up rather than hanging for ever. */
const TERMINAL_WAIT_MS = 5 * 60_000;

/**
 * One line from the controlling terminal, synchronously. The same read as `stop lift`'s, which
 * `platformStop.ts` does not export and this phase does not own. Null when it cannot be read.
 */
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

function nodeTerminal(): TenantReceiptTerminal {
  return { stdinIsTTY: process.stdin.isTTY === true, stdoutIsTTY: process.stdout.isTTY === true, ask: askTerminal };
}

/**
 * The production confirmation: ONLY in an interactive terminal, standard input AND standard output both
 * a TTY. Agents run without one; the answer is then `no-terminal`, never a guess and never a default.
 */
export function terminalTenantReceiptConfirm(terminal: () => TenantReceiptTerminal = nodeTerminal): TenantReceiptConfirm {
  return (blob, summary) => {
    const t = terminal();
    if (t.stdinIsTTY !== true || t.stdoutIsTTY !== true) return { kind: 'no-terminal' };
    const typed = t.ask(
      [
        `Confirming the committed tenant registry, blob ${blob}:`,
        ...summary,
        `Retype the first ${CONFIRMATION_LENGTH} characters of the blob exactly to confirm: `,
      ].join('\n'),
    );
    return typed === null ? { kind: 'no-terminal' } : { kind: 'typed', text: typed };
  };
}

/**
 * THE CONFIRMATION IS A PARAMETER, AND PRODUCTION NEVER PASSES ONE. The same rule as `stop`: a context
 * is a bag in-process callers assemble and forward, and a confirmation reachable through it would be one
 * they could satisfy by attaching a function. A test passes its own as the fourth argument, in the open.
 */
export function tenant(
  ctx: CommandContext,
  flags: Flags,
  positionals: readonly string[],
  confirm: TenantReceiptConfirm = terminalTenantReceiptConfirm(),
): CommandResult {
  const sub = positionals[0] ?? 'show';
  switch (sub) {
    case 'show':
      return show(ctx);
    case 'receipt':
      return receipt(ctx, flags, confirm);
    default:
      return { code: 1, lines: [`Unknown 'tenant' subcommand: ${sub}`, '', ...USAGE] };
  }
}

function show(ctx: CommandContext): CommandResult {
  const source = tenantSourceOf(ctx);
  const derived = deriveProjectTenant(ctx.sys, ctx.root, source);
  if (!derived.ok) return { code: 2, lines: tenantRefusalLines(derived) };
  const { binding, blob, commit } = derived;
  const confirmedAt = source.stateDir === null ? null : readTenantReceipt(ctx.sys, source.stateDir);
  return {
    code: 0,
    lines: [
      `project: ${binding.projectId}`,
      `tenant: ${binding.tenant}`,
      `domain: ${binding.domain}`,
      `repository: ${binding.repository}`,
      `governed root: ${binding.governedRoot}`,
      `bound by: ${binding.via}`,
      `registry: ${TENANT_REGISTRY_REL}, blob ${blob}, committed bytes at ${commit}`,
      `owner receipt: ${confirmedAt?.kind === 'ok' ? `confirmed ${confirmedAt.receipt.confirmedAt}` : 'none'}`,
      TENANT_RECEIPT_STATEMENT,
    ],
  };
}

/** The P5 grant: this action, on this blob, and nothing else. Built only after a person has typed. */
export function tenantReceiptGrant(blob: string): EnvelopeGrantPort {
  return (envelope) => envelope.action === 'tenant-registry-change' && envelope.subjectHash === blob;
}

/** EVERY `tenant receipt` ANSWER, refusal or success, goes out through here, and carries the statement. */
function receiptAnswer(code: number, lines: readonly string[]): CommandResult {
  return { code, lines: [...lines, TENANT_RECEIPT_STATEMENT] };
}

function asIgnored(flags: Flags): readonly string[] {
  return flags['as'] === undefined ? [] : ['  - `--as` was given and was ignored: a command-line role is not evidence of the owner'];
}

function registrySummary(derived: DerivedTenant): readonly string[] {
  return derived.registry.projects.map((entry) => `  ${entry.projectId}: tenant ${entry.tenant}, domain ${entry.domain}, ${entry.repository}, ${entry.governedRoot}`);
}

function receipt(ctx: CommandContext, flags: Flags, confirm: TenantReceiptConfirm): CommandResult {
  const { sys } = ctx;
  const source = tenantSourceOf(ctx);
  const blob = str(flags, 'blob');
  if (!BLOB_SHAPE.test(blob)) {
    return receiptAnswer(1, ['`tenant receipt` requires --blob <sha>, exactly as the refusal printed it.', ...asIgnored(flags)]);
  }
  if (source.stateDir === null) {
    return receiptAnswer(2, ['REFUSED (TENANT_RECEIPT_UNVERIFIABLE): no installation state directory can be established, so no receipt can be kept.']);
  }
  const registries = readInstallationRegistries(sys, source.installRoot);
  if (!registries.ok) return receiptAnswer(2, [...tenantRefusalLines(registries), ...asIgnored(flags)]);
  if (blob !== registries.blob) {
    return receiptAnswer(2, [
      `REFUSED (TENANT_RECEIPT_BLOB_MISMATCH): the committed tenant registry is blob ${registries.blob}, not ${blob}.`,
      '  a receipt names exactly the bytes the owner confirmed',
      ...asIgnored(flags),
    ]);
  }
  const before = readTenantReceipt(sys, source.stateDir);
  if (before.kind === 'ok' && before.receipt.registryBlob === blob) {
    return receiptAnswer(0, [`The owner already confirmed this registry, blob ${blob}, at ${before.receipt.confirmedAt}.`]);
  }
  // THE INSTALLATION'S OWN PROJECT IS WHAT THIS ACTION BELONGS TO, wherever it is typed from. The receipt
  // is not asked here: this is the step that makes one.
  const projectId = declaredProjectId(sys, source.installRoot);
  if (projectId === null) {
    return receiptAnswer(2, [`REFUSED (TENANT_UNKNOWN): the installation at ${source.installRoot} has no readable project configuration.`, ...asIgnored(flags)]);
  }
  const derived = bindCheckout(sys, source.installRoot, projectId, registries);
  if (!derived.ok) return receiptAnswer(2, [...tenantRefusalLines(derived), ...asIgnored(flags)]);

  // THE IN-PERSON HALF. No terminal, no receipt.
  const confirmation = confirm(blob, registrySummary(derived));
  if (confirmation.kind !== 'typed') {
    return receiptAnswer(2, [
      'REFUSED (TENANT_RECEIPT_NEEDS_A_TERMINAL): a person must confirm the registry in an interactive terminal; this process has no terminal.',
      '  - use PowerShell or Windows Terminal (Git Bash/mintty gives no terminal)',
      ...asIgnored(flags),
    ]);
  }
  if (confirmation.text !== blob.slice(0, CONFIRMATION_LENGTH)) {
    return receiptAnswer(2, ['REFUSED (TENANT_RECEIPT_CONFIRMATION_MISMATCH): what was typed does not match the blob exactly.', ...asIgnored(flags)]);
  }
  // THE GRANT EXISTS ONLY NOW, ONLY FOR THIS ACTION ON THIS BLOB, and the door has to ask it.
  const admission = admitBoundary(
    sys,
    source.stateDir,
    derived,
    {
      action: 'tenant-registry-change',
      principal: 'owner',
      subjectHash: blob,
      scope: [TENANT_REGISTRY_REL],
      windowMs: READ_ENVELOPE_WINDOW_MS,
      intentScope: 'owner-receipt',
    },
    tenantReceiptGrant(blob),
  );
  if (!admission.admitted) return receiptAnswer(2, admissionRefusalLines(admission));
  const recorder = envelopeRecorder(sys, source.stateDir);
  if (!writeTenantReceipt(sys, source.stateDir, blob, sys.now())) {
    recordExecution(admission.envelope, 'failed', 'TENANT_RECEIPT_NOT_WRITTEN', sys.now(), recorder);
    return receiptAnswer(2, [`REFUSED (TENANT_RECEIPT_NOT_WRITTEN): the receipt could not be written and read back in ${source.stateDir}.`]);
  }
  const recorded = recordExecution(admission.envelope, 'allowed', null, sys.now(), recorder);
  return receiptAnswer(recorded ? 0 : 2, [
    `TENANT REGISTRY CONFIRMED: blob ${blob}, after a typed confirmation in a terminal.`,
    ...(recorded ? [] : ['  - the receipt was written, but its outcome line was not; the admission line stands']),
  ]);
}

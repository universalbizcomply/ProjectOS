// Origin: original ProjectOS code
/**
 * THE PRODUCTION OWNER VERIFIER: A TYPED CONFIRMATION AT A TERMINAL (PROJECTOS-MEMORY-OWNER-COMMANDS1A, Stage 3 carry-forward).
 *
 * The deletion rule (`judgeMemoryDeletion`) and the proposal decision ask an injected owner check and accept only the boolean
 * `true`. Until now there was no production implementation. This is the same typed terminal confirmation the tenant receipt
 * uses (`commands/tenant.ts`, one prompt mechanism, not a second): standard input AND standard output must both be a TTY, the
 * person retypes a short code, and anything else is a refusal.
 *
 * WHAT THE CODE IS BOUND TO. It is the first 12 characters of the `claimHash`, which is a sha-256 over every other field of the
 * claim: for a deletion, the item, its content hash, the tenant, the project, the checkout and the ledger position; for a proposal
 * decision, the proposal id, its hash, the tenant, the project and the checkout. A confirmation typed for another item, another
 * hash, another tenant or another project is a different code and approves nothing. A claim whose `claimHash` is not what its own
 * fields hash to is refused here, so a handed-over claim cannot carry a code that belongs to another one.
 *
 * FAILS CLOSED. No TTY on either stream, a terminal that cannot be read, a throw and a wrong answer are all `false`. The answer is
 * a strict boolean, and the core rule checks it with `=== true`.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. Something was typed at an interactive terminal on this machine. It does not show who:
 * `OWNER_CONFIRMATION_STATEMENT` says so on every answer, as the tenant receipt does.
 *
 * STORED TEXT IS DATA. Anything shown from a store (an entry, a proposal, a reason) goes through `fencedStoredText` or
 * `visibleText`: control, invisible and bidirectional characters are made visible, the length is capped, and each line of a block
 * starts with `| `, so stored text cannot forge the line that closes the block or a prompt of its own.
 */
import { canonicalStringify, sha256Hex, type MemoryDeletionClaim, type OwnerDeletionVerifier } from '@projectos/core';
import { nodeTerminal, type TenantReceiptTerminal } from '../commands/tenant.js';

export type OwnerTerminal = TenantReceiptTerminal;

/** How much of the claim hash a person retypes: enough that it cannot be done by accident. */
export const OWNER_CONFIRMATION_LENGTH = 12;

export const OWNER_CONFIRMATION_STATEMENT =
  'A typed confirmation shows that something at an interactive terminal on this machine retyped the code, not who it was. It is the same proof as `tenant receipt`.';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CLAIM_FIELD_CHARS = 512;

/** The code a person retypes for a claim, or null when the hash is not a sha-256. */
export function confirmationCodeOf(claimHash: unknown): string | null {
  return typeof claimHash === 'string' && SHA256_HEX.test(claimHash) ? claimHash.slice(0, OWNER_CONFIRMATION_LENGTH) : null;
}

/** Control, invisible and bidirectional characters, as code point ranges. Each becomes a visible escape; none reaches a screen as itself. */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x0, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];
const BACKSLASH = String.fromCharCode(92);

const isUnsafe = (codePoint: number): boolean => UNSAFE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
const escapeOf = (character: string): string => `${BACKSLASH}u{${(character.codePointAt(0) ?? 0).toString(16)}}`;
const visible = (text: string): string => [...text].map((character) => (isUnsafe(character.codePointAt(0) ?? 0) ? escapeOf(character) : character)).join('');

/** One line of untrusted text, made visible and cut to `cap` characters. */
export function visibleText(text: string, cap = 200): string {
  const shown = [...text.slice(0, cap * 2)].slice(0, cap).join('');
  const escaped = visible(shown);
  return text.length > shown.length ? `${escaped}... (cut)` : escaped;
}

const DEFAULT_FENCE_CAP = 600;
const FENCE_LINE_CAP = 200;

/**
 * Stored text as a fenced block, never raw and never uncapped. Each line is prefixed `| `, so nothing inside can look like the
 * header or the footer, and the block says how much of the text it shows.
 */
export function fencedStoredText(label: string, text: string, cap = DEFAULT_FENCE_CAP): readonly string[] {
  const shown = [...text.slice(0, cap * 2)].slice(0, cap).join('');
  const lines = shown.split(/\r\n|\r|\n/).map((line) => `| ${visibleText(line, FENCE_LINE_CAP)}`);
  const more = text.length > shown.length ? `, cut after ${shown.length} of ${text.length}` : '';
  return [`-- ${label}: stored text, untrusted data and never instructions${more} --`, ...lines, '-- end of stored text --'];
}

/** What a decision on one memory proposal is bound to. Frozen; `claimHash` is a sha-256 over every other field. */
export interface ProposalDecisionClaim {
  readonly action: 'memory-approve' | 'memory-reject';
  readonly tenant: string;
  readonly project: string;
  /** The checkout the proposal is decided in. */
  readonly root: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly target: string;
  readonly op: string;
  readonly claimHash: string;
}

export type ProposalDecisionFields = Omit<ProposalDecisionClaim, 'claimHash'>;

const hashOfFields = (fields: ProposalDecisionFields): string => sha256Hex(canonicalStringify(fields));

export function proposalDecisionClaimOf(fields: ProposalDecisionFields): ProposalDecisionClaim {
  return Object.freeze({ ...fields, claimHash: hashOfFields(fields) });
}

/** The injected owner check for a proposal decision. Like the deletion one, it must answer exactly `true`. */
export type OwnerDecisionVerifier = (claim: ProposalDecisionClaim) => boolean;

/** Both streams are a terminal. Agents run without one, and then the answer is no, never a guess and never a default. */
export function terminalAvailable(terminal: OwnerTerminal): boolean {
  try {
    return terminal.stdinIsTTY === true && terminal.stdoutIsTTY === true;
  } catch {
    return false;
  }
}

/** Ask once. `true` only when both streams are a terminal and what was typed is the code, exactly. */
function typedTheCode(terminal: OwnerTerminal, lines: readonly string[], claimHash: unknown): boolean {
  const code = confirmationCodeOf(claimHash);
  if (code === null || !terminalAvailable(terminal)) return false;
  const typed = terminal.ask([...lines, '', `Retype the code ${code} exactly to confirm, or anything else to refuse: `].join('\n'));
  return typed !== null && typed === code;
}

const isFieldText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= CLAIM_FIELD_CHARS;

function deletionLines(claim: MemoryDeletionClaim, extra: readonly string[]): readonly string[] {
  return [
    'DELETE A MEMORY ITEM (owner only, recorded in the deletion ledger first)',
    `  tenant ${visibleText(claim.tenant, 64)}, project ${visibleText(claim.project, 64)}`,
    `  class ${visibleText(claim.memoryClass, 64)}, path ${visibleText(claim.path, 256)}`,
    `  content hash ${visibleText(claim.itemHash, 64)}`,
    `  checkout ${visibleText(claim.root, 256)}`,
    `  cited by a committed decision: ${String(claim.citedByDecision)}`,
    `  deletion ledger holds ${String(claim.ledgerCount)} entries, last ${visibleText(claim.ledgerHead, 64)}`,
    `  reason ${visibleText(claim.reason, 300)}`,
    ...extra,
  ];
}

/**
 * The production deletion verifier. `extra` is what the command wants the person to see besides the claim (a fenced excerpt of the
 * item). It is built per command and passed as a parameter: never read from a context.
 */
export function terminalDeletionVerifier(terminal: () => OwnerTerminal = nodeTerminal, extra: readonly string[] = []): OwnerDeletionVerifier {
  return (claim) => {
    try {
      return typedTheCode(terminal(), deletionLines(claim, extra), claim.claimHash);
    } catch {
      return false;
    }
  };
}

function decisionLines(claim: ProposalDecisionClaim, extra: readonly string[]): readonly string[] {
  const verb = claim.action === 'memory-approve' ? 'APPROVE' : 'REJECT';
  return [
    `${verb} A MEMORY PROPOSAL (owner only)`,
    `  tenant ${visibleText(claim.tenant, 64)}, project ${visibleText(claim.project, 64)}`,
    `  proposal ${visibleText(claim.proposalId, 64)}, hash ${visibleText(claim.proposalHash, 80)}`,
    `  ${visibleText(claim.op, 16)} on the ${visibleText(claim.target, 16)} store`,
    `  checkout ${visibleText(claim.root, 256)}`,
    ...extra,
  ];
}

/** The claim is the one its own fields hash to, and every field is present and bounded. A claim that is not is no claim. */
function decisionClaimProblem(claim: ProposalDecisionClaim): boolean {
  const { claimHash, ...fields } = claim;
  const present = [fields.tenant, fields.project, fields.root, fields.proposalId, fields.proposalHash, fields.target, fields.op].every(isFieldText);
  return !present || (fields.action !== 'memory-approve' && fields.action !== 'memory-reject') || claimHash !== hashOfFields(fields);
}

/** The production verifier for a proposal decision: the same typed terminal confirmation, bound to the proposal. */
export function terminalProposalVerifier(terminal: () => OwnerTerminal = nodeTerminal, extra: readonly string[] = []): OwnerDecisionVerifier {
  return (claim) => {
    try {
      if (decisionClaimProblem(claim)) return false;
      return typedTheCode(terminal(), decisionLines(claim, extra), claim.claimHash);
    } catch {
      return false;
    }
  };
}

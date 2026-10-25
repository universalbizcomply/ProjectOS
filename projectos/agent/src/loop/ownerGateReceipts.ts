/**
 * Reading an owner's gate receipt from the only place it counts: the git object store.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE CONTRACT. `checkOwnerGateReceipt` is pure and knows nothing
 * about disks or git, which is what makes it testable without a repository. The part that has to
 * touch git is small and lives here.
 *
 * IT IS A SECOND COPY, AND THAT IS A REAL COST. `closureGate.ts`'s `decisionIsCommitted` /
 * `readCommittedDecision` do the same two things for a different record, and this pair is modelled on
 * them closely enough that a future fix to one — a new laundering trick, a git flag that behaves
 * differently under the packaged daemon — will not reach the other. The duplication was chosen over
 * generalising `closureGate`, which is load-bearing for closure and outside this phase's boundary, but
 * the debt is real and is recorded here rather than dressed up as a virtue.
 *
 * THE FLAT FILENAME IS NOT A STYLE CHOICE. `.projectops/gates/<phaseId>.<gateName>.json` is used
 * instead of a per-phase directory because this project's `.gitignore` excludes `secret*` and
 * `*token*` — and `secrets-handling` is a real owner gate in the active plan. Under a per-phase
 * layout, `.projectops/gates/PHASE1A/secrets-handling.json` is silently ignored by git: the owner
 * would commit, see nothing tracked, and the runtime would refuse the gate with no visible cause.
 * The flat form is not matched by either pattern. This was verified against the actual `.gitignore`,
 * not assumed.
 *
 * ALL GIT INVOCATIONS USE `-C root`. The repository has both styles, and the ambient-cwd style has
 * failed closed under the packaged daemon before, where the process's working directory is not the
 * governed checkout.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the owner's bridge ruling of 2026-08-17.
 */
import { join } from 'node:path';
import { ownerGateState, type OwnerGateReceipt } from '@projectos/core';
import type { System } from '../system.js';

/**
 * Gate names that may become a filename.
 *
 * Narrow on purpose: these are interpolated into a path, so anything that could traverse, hide or
 * collide is refused rather than sanitised. A gate name is a short identifier in the approved plan,
 * so nothing legitimate is excluded.
 */
const SAFE_GATE_NAME = /^[A-Za-z0-9_-]{2,64}$/;
const SAFE_PHASE_ID = /^[A-Za-z0-9_-]{4,128}$/;

export function isSafeGateName(gateName: string): boolean {
  return SAFE_GATE_NAME.test(gateName);
}

/** Repo-relative path of a gate receipt. `null` when either part could not safely become a filename. */
export function ownerGateReceiptRelPath(phaseId: string, gateName: string): string | null {
  if (!SAFE_PHASE_ID.test(phaseId) || !SAFE_GATE_NAME.test(gateName)) return null;
  return `.projectops/gates/${phaseId}.${gateName}.json`;
}

/** Absolute path of a gate receipt in a given checkout. */
export function ownerGateReceiptPath(root: string, phaseId: string, gateName: string): string | null {
  const rel = ownerGateReceiptRelPath(phaseId, gateName);
  return rel === null ? null : join(root, ...rel.split('/'));
}

/**
 * Is the receipt COMMITTED, and unchanged since it was?
 *
 * Two questions, both necessary. `git log` proves it was committed at all; `git diff HEAD` catches a
 * committed receipt that has since been edited in the working tree, which would otherwise let the
 * committed version launder an uncommitted change. Any git failure is `false`: an unverifiable
 * receipt is not a receipt.
 */
export function receiptIsCommitted(sys: System, root: string, phaseId: string, gateName: string): boolean {
  const rel = ownerGateReceiptRelPath(phaseId, gateName);
  if (rel === null) return false;
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return false;
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0) return false;
  return dirty.stdout.trim().length === 0;
}

/**
 * The receipt AS COMMITTED — read from the git object rather than from the working tree.
 *
 * Reading the file would validate bytes git never saw. A tracked symlink is committed once as a link
 * target while `readFileSync` follows it, so the content could then be rewritten freely and remain
 * invisible to `git diff`, `git log` and `git status` — and the claimed boundary, "a forged receipt
 * is a visible diff at the owner's commit gate", would be gone. Reading the object makes what is
 * validated and what is committed the same bytes by construction.
 */
export function readCommittedReceipt(
  sys: System,
  root: string,
  phaseId: string,
  gateName: string,
): Record<string, unknown> | null {
  const rel = ownerGateReceiptRelPath(phaseId, gateName);
  if (rel === null) return null;
  // `./` binds the read to the governed root; see the note in degradedMode.ts. This is the read that
  // releases the gatekeeper credential, and a nested checkout was reading the outer project's receipt.
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(shown.stdout) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Has the owner approved credential use for this phase?
 *
 * READ FROM THE COMMITTED TREE. A receipt sitting in the working tree is a file the runtime itself
 * could have written; the commit is the owner action a model cannot perform, and it is the whole of
 * the separation this record relies on.
 *
 * THE RECORD'S OWN PHASE IS CHECKED, not only the path it was found at. The filename already binds
 * the phase, so this is defence in depth rather than a hole being closed — but a record whose
 * contents disagree with where it lives is not a record to act on. GK-SEC-003.
 *
 * ONE COPY, ON PURPOSE. `run` and `reconcile` both release the gatekeeper credential, and two
 * hand-copied predicates would let one route drift into being more permissive than the other without
 * anything failing.
 */
export function ownerApprovedSecretsHandling(sys: System, root: string, phaseId: string): boolean {
  if (!receiptIsCommitted(sys, root, phaseId, 'secrets-handling')) return false;
  const receipt = readCommittedReceipt(sys, root, phaseId, 'secrets-handling');
  return (
    receipt !== null &&
    receipt['ownerChoice'] === 'APPROVE' &&
    receipt['gateName'] === 'secrets-handling' &&
    receipt['phaseId'] === phaseId
  );
}

/**
 * Every gate's receipt, keyed by gate name, read as committed.
 *
 * A gate whose receipt is absent, unparseable, uncommitted or dirty maps to `null` — the checker
 * treats all four the same way, because from "may this proceed" they are the same.
 */
export function readCommittedReceipts(
  sys: System,
  root: string,
  phaseId: string,
  requiredOwnerGates: readonly string[],
): ReadonlyMap<string, Record<string, unknown> | null> {
  const out = new Map<string, Record<string, unknown> | null>();
  for (const gate of requiredOwnerGates) {
    out.set(gate, receiptIsCommitted(sys, root, phaseId, gate) ? readCommittedReceipt(sys, root, phaseId, gate) : null);
  }
  return out;
}

/**
 * The result of trying to spend a receipt. `ok` is the ONLY thing a caller may act on.
 *
 * Added in PROJECTOS-OWNER-ESCALATION-WAIT1A.
 */
export interface ReceiptConsumption {
  /** True ONLY when the spend was written AND read back AND the receipt no longer counts. */
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Spend a receipt, and PROVE it was spent, so the passage it bought cannot be bought twice.
 *
 * WHY THE WORKING TREE IS THE RIGHT PLACE. A receipt counts only while `receiptIsCommitted` holds —
 * committed AND unchanged since. Stamping `consumedAt` into the working copy therefore ends its
 * usefulness immediately and durably: `git diff HEAD` is no longer empty, so the next process refuses
 * it as uncommitted, and if the owner later commits the stamped form `checkOwnerGateReceipt` refuses
 * it again for carrying a spent marker. Two independent refusals from one write.
 *
 * THE FAILURE THIS FUNCTION USED TO ALLOW. It reported a failed spend and returned prose, and its own
 * doc argued that reporting was the honest thing because the write "only ever narrows". That was
 * wrong, and the gatekeeper was right to raise it: a caller that resumes on a receipt whose spend
 * failed has taken an owner-approved passage that nothing durable records as taken, so a restart
 * takes it again. Single-use authority that reports its own failure and proceeds is not single-use.
 * `ok` now carries that fact into the type, where a caller cannot read past it.
 *
 * AND IT IS PROVEN, NOT ASSUMED. A write that does not throw is not a write that happened: the bytes
 * are read back and the stamp checked, and `receiptIsCommitted` is asked again — it must now be
 * false. Only then is the spend `ok`. Anything else, including a silently-dropped write, is a
 * refusal.
 *
 * AND IT IS SERIALISED, BECAUSE PROVING A WRITE IS NOT THE SAME AS BEING THE ONLY WRITER. Read the
 * file, see no `consumedAt`, write the stamp, read your own stamp back: every step succeeds for BOTH
 * of two concurrent processes that each read the clean file before either wrote. Both would then
 * hold a proven spend of the same single-use decision. The whole read-check-write-verify sequence
 * therefore happens under an exclusive lock taken with `createExclusive`, whose exclusivity is the
 * filesystem's rather than ours, and the `consumedAt` check is made INSIDE it — a check made before
 * the lock is a check made against a file another process may already have stamped. This project has
 * been bitten by exactly this shape before, in the cost ledger, where a ceiling was checked outside
 * the lock that reserved against it.
 *
 * A LOCK THAT IS NEVER RELEASED LEAVES THE GATE STANDING, which is the safe direction: the owner is
 * asked again and the receipt is untouched. Recovering a lock left behind by a killed process is
 * crash reconciliation, and belongs to B8.
 *
 * Added in PROJECTOS-OWNER-ESCALATION-WAIT1A.
 */
export function markOwnerReceiptConsumed(
  sys: System,
  root: string,
  phaseId: string,
  gateName: string,
  at: string,
): ReceiptConsumption {
  const no = (detail: string): ReceiptConsumption => ({ ok: false, detail });
  const path = ownerGateReceiptPath(root, phaseId, gateName);
  if (path === null) return no(`receipt for '${gateName}' could not be addressed, so it was NOT spent`);

  // THE LOCK COMES FIRST, BEFORE ANYTHING IS EVEN READ.
  const lock = `${path}.lock`;
  if (!sys.createExclusive(lock, `spending '${gateName}' at ${at}
`)) {
    // WHICH FAILURE IT WAS DECIDES WHAT THE OPERATOR SHOULD DO, and `createExclusive` cannot say:
    // it swallows every error, so "the lock is held" and "this location cannot be written at all"
    // arrive identically. Blaming a process that does not exist sends someone to delete a file that
    // is not there, on a machine whose actual problem is a permission or a full disk. The degraded
    // ledger already distinguishes these two with exactly this test.
    //
    // NAMING THE FILE IS THE POINT. The lock convention here is deliberate — no timeout, no PID, no
    // automatic deletion, because a stale-timeout rule can clear itself at the wrong moment — and its
    // only remedy is an operator removing the file. A refusal that does not say which file makes that
    // remedy unreachable.
    if (!sys.exists(lock)) {
      return no(
        `the owner-gate receipt directory could not be written, so '${gateName}' was NOT spent and the ` +
          `gate still stands; check that ${lock} can be created`,
      );
    }
    return no(
      `receipt for '${gateName}' is already being spent by another process, so it was NOT spent here. ` +
        `If no other run is in progress, ${lock} was left behind by one that died and must be removed.`,
    );
  }
  try {
    return spendUnderLock(sys, root, phaseId, gateName, at, path, no);
  } finally {
    sys.removeFile(lock);
  }
}

/** The spend itself. Only ever called by `markOwnerReceiptConsumed`, and only holding the lock. */
function spendUnderLock(
  sys: System,
  root: string,
  phaseId: string,
  gateName: string,
  at: string,
  path: string,
  no: (detail: string) => ReceiptConsumption,
): ReceiptConsumption {
  const raw = sys.readText(path);
  if (raw === null) return no(`receipt for '${gateName}' could not be read back, so it was NOT spent`);
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    record = parsed as Record<string, unknown>;
  } catch {
    return no(`receipt for '${gateName}' is not a JSON object, so it was NOT spent`);
  }
  if (record['consumedAt'] !== undefined && record['consumedAt'] !== null) {
    return no(`receipt for '${gateName}' was already spent at ${String(record['consumedAt'])}`);
  }
  try {
    sys.writeText(path, `${JSON.stringify({ ...record, consumedAt: at }, null, 2)}
`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return no(`receipt for '${gateName}' could not be written back, so it was NOT spent: ${why}`);
  }

  // THE PROOF, IN THE TWO FORMS THAT MATTER.
  //
  // First that the bytes on disk now carry the stamp — a `writeText` that returns without throwing
  // has still not necessarily changed anything a later process will read. Second that the receipt has
  // actually stopped counting: `receiptIsCommitted` is the exact predicate every other reader uses,
  // so asking it again is asking the real question rather than a proxy for it.
  const back = sys.readText(path);
  if (back === null) return no(`receipt for '${gateName}' could not be re-read after writing, so the spend is UNPROVEN`);
  try {
    const after = JSON.parse(back) as Record<string, unknown>;
    if (after['consumedAt'] !== at) {
      return no(`receipt for '${gateName}' does not carry the spend after writing, so it was NOT spent`);
    }
  } catch {
    return no(`receipt for '${gateName}' is unreadable after writing, so the spend is UNPROVEN`);
  }
  if (receiptIsCommitted(sys, root, phaseId, gateName)) {
    return no(`receipt for '${gateName}' still counts as committed and unchanged after the spend, so it was NOT spent`);
  }
  return { ok: true, detail: `receipt for '${gateName}' spent at ${at}; it cannot answer this gate again` };
}

/**
 * Which of a phase's owner gates are ANSWERED by a committed receipt, and by which decision.
 *
 * WHY THIS DECISION LIVES HERE AND NOT IN THE RUNNER. `readFromCommittedTree` is a claim about where
 * bytes came from, and only the code that performed the read is in a position to make it. The runner
 * cannot: it never touches the object store, so asserting the flag there would be asserting something
 * it did not establish — the same rule `loadDegradedModeGrant` already enforces for degraded
 * authority, kept by two frozen proofs that forbid the runner from even naming the flag. Placing the
 * conjunction here keeps the assertion adjacent to the read that justifies it.
 *
 * IT ONLY EVER REPORTS. Nothing here grants passage or writes anything; the caller decides what an
 * answered gate is worth, and marks it spent separately.
 *
 * Added in PROJECTOS-OWNER-ESCALATION-WAIT1A.
 */
export function answeredOwnerGatesFromCommittedTree(
  sys: System,
  root: string,
  binding: {
    readonly projectId: string;
    readonly phaseId: string;
    readonly requiredOwnerGates: readonly string[];
    readonly evidenceSubjectHead: string;
    readonly planOwner: string;
    readonly alreadyConsumedDecisionIds: readonly string[];
  },
): readonly { readonly gate: string; readonly decisionId: string }[] {
  const gates = binding.requiredOwnerGates;
  if (gates.length === 0) return [];
  const receipts = readCommittedReceipts(sys, root, binding.phaseId, gates);
  // ACCUMULATED AS WE GO, WHICH IS WHAT THE FIELD IS FOR. `alreadyConsumedDecisionIds` refuses a
  // receipt that has already answered something, so a gate judged later in this same pass must see
  // the ids the earlier gates used — otherwise one decision could answer two gates in one breath.
  // The gate-name and gate-instance bindings make that hard to reach on their own; this closes it by
  // construction rather than by relying on the other two holding.
  const spent = [...binding.alreadyConsumedDecisionIds];
  const answered: { gate: string; decisionId: string }[] = [];
  for (const gate of gates) {
    const receipt = (receipts.get(gate) ?? null) as OwnerGateReceipt | null;
    const { state } = ownerGateState(receipt, {
      projectId: binding.projectId,
      phaseId: binding.phaseId,
      requiredOwnerGates: [gate],
      evidenceSubjectHead: binding.evidenceSubjectHead,
      planOwner: binding.planOwner,
      // ESTABLISHED, NOT ASSUMED: `readCommittedReceipts` above reads `HEAD:./<path>` from the object
      // store and maps anything uncommitted or since-edited to null.
      readFromCommittedTree: true,
      alreadyConsumedDecisionIds: spent,
    });
    if (state !== 'APPROVED') continue;
    const decisionId = String((receipt as Record<string, unknown> | null)?.['decisionId'] ?? '');
    spent.push(decisionId);
    answered.push({ gate, decisionId });
  }
  return answered;
}

/**
 * The gates an owner receipt has BOUGHT — read, judged, and spent, in that order.
 *
 * THE ORDER IS THE WHOLE POINT, AND IT WAS THE WRONG WAY ROUND. The first wiring satisfied the gate
 * and spent the receipt afterwards, reporting a failed spend and resuming anyway. An owner decision
 * is single-use authority: taking the passage without a durable record that it was taken means a
 * restart takes it again, which is a replay of Murad's authority however narrow the window. So
 * consumption is now a PRECONDITION of satisfaction, not a consequence of it. A gate whose receipt
 * could not be provably spent is returned as refused and stays standing.
 *
 * FAILING TO SPEND COSTS THE OWNER NOTHING. The receipt is untouched by a failed spend, so once the
 * checkout is writable again the same decision still answers. The run stops; the authority survives.
 *
 * WHY BOTH HALVES LIVE HERE. `readFromCommittedTree` may only be asserted by the code that performed
 * the read, and the spend has to be adjacent to the judgement it gates — a caller that could satisfy
 * a gate without passing through this function is the hole this closes.
 *
 * Added in PROJECTOS-OWNER-ESCALATION-WAIT1A.
 */
export function consumeAnsweredOwnerGates(
  sys: System,
  root: string,
  binding: {
    readonly projectId: string;
    readonly phaseId: string;
    readonly requiredOwnerGates: readonly string[];
    readonly evidenceSubjectHead: string;
    readonly planOwner: string;
    readonly alreadyConsumedDecisionIds: readonly string[];
  },
  at: string,
): {
  readonly satisfied: readonly { readonly gate: string; readonly decisionId: string }[];
  readonly refusals: readonly string[];
} {
  const satisfied: { gate: string; decisionId: string }[] = [];
  const refusals: string[] = [];
  for (const { gate, decisionId } of answeredOwnerGatesFromCommittedTree(sys, root, binding)) {
    const spend = markOwnerReceiptConsumed(sys, root, binding.phaseId, gate, at);
    if (!spend.ok) {
      // NOT SATISFIED, AND SAID SO. The gate stays standing and the run stops on the owner, which is
      // where it already was — no worse off than if the receipt had never been written.
      refusals.push(`owner gate '${gate}' NOT satisfied: ${spend.detail}`);
      continue;
    }
    satisfied.push({ gate, decisionId });
  }
  return { satisfied, refusals };
}

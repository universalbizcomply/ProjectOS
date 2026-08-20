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

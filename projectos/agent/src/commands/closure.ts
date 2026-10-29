/**
 * `projectos closure <request|resume|status>` — the autonomous closure transport, Route A.
 *
 * WHAT THIS COMMAND IS FOR. Everything between "the work is pushed and eligible" and "the phase is
 * closed" used to travel through a person: Claude wrote a report, Murad carried it to ChatGPT,
 * ChatGPT answered in prose, Murad carried the prose back, and somebody typed the decision record.
 * That relay is the last thing in ProjectOS a human does purely to move information. This removes it
 * — and removes ONLY it.
 *
 * WHAT IT DELIBERATELY DOES NOT REMOVE. The owner's commit. Under `tamperProof: false` the single
 * thing that makes a governance record more than a file the runtime could have written is that it
 * passed the owner's commit gate as a visible diff. So the shape is:
 *
 *   request  ask the closure authority, check the answer, WRITE the record, and stop.
 *   (owner)  Murad commits the exact record. Nothing here can do that, and nothing tries.
 *   resume   observe from git that he did, that the bytes are the ones he was shown, and then hand
 *            the closure to the EXISTING G4 / delegation / consumption path, unchanged.
 *
 * WHY `resume` CALLS `phase advance` RATHER THAN CLOSING ANYTHING ITSELF. A second closure engine is
 * the worst outcome available here: two places deciding what closure means, drifting, with the more
 * permissive one eventually winning. `phase advance --to closed --delegated` already re-derives G4
 * from the repository, re-reads the COMMITTED decision, judges it with `checkClosureDecision`,
 * resolves the delegate from the approved plan, refuses any caller-asserted authority, records the
 * decision id on the history and spends the decision. This command adds one question in front of all
 * of that — "are the committed bytes the bytes the owner was shown?" — and then gets out of the way.
 *
 * NOTHING HERE IS AUTHORITY. The wait record narrows; the decision record is inert until committed;
 * and `phase-closure` remains in `ABSOLUTE_OWNER_ONLY`, which no part of this route touches.
 *
 * Created in PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { join, ok, fail } from '../context.js';
import { type Flags, str, bool } from '../flags.js';
import { authorisePhase, loadGovernedContext, refusalLines, type GovernedContext } from '../governedContext.js';
import { loadPhase } from '../phaseStore.js';
import {
  closureDecisionPath,
  closureDecisionProblems,
  closureDecisionRelPath,
  closureEvidencePath,
  decisionIsCommitted,
  evaluateG4,
  g4RefusalLines,
  gitFacts,
  latestRunEvidence,
  programmeStateTailPaths,
  unattestedRuns,
  validationRecordPath,
} from '../closureGate.js';
import { checksFor, configuredChecks, phaseCopyChecks, runChecks, runPhaseCopyChecks, type CheckResult } from '../loop/verification.js';
import { phaseWritePaths } from '../loop/workers.js';
import { withPinnedValidators } from '../loop/pinnedValidators.js';
import {
  commitOwnRecordsFor,
  PROJECTOS_COMMIT_EMAIL,
  PROJECTOS_COMMIT_NAME,
  type OwnRecordsKind,
  type OwnRecordsOutcome,
} from '../loop/technicalContinuation.js';
import { findingsPath, readFindings, readReviewerRecord, reviewerPath, type FindingsRecord } from '../loop/session.js';
import { creditedReviews, independentReviews, type ReviewerRecord } from '../loop/reviewRoles.js';
import { createHash } from 'node:crypto';
import { blockingFindings } from '../loop/outcome.js';
import { isClosureTailPath } from '@projectos/core';
import {
  CLOSURE_WAIT_SCHEMA_VERSION,
  closureDecisionSha256,
  closureWaitProblems,
  closureWaitRelPath,
  isSafeClosurePhaseId,
  observeOwnerCommit,
  readClosureWait,
  resolveClosureWait,
  writeClosureDecisionForOwner,
  writeClosureWait,
  type ClosureBundleEntry,
  type ClosureWaitRecord,
} from '../closureWait.js';
import type { HostClosureReviewPort } from '@projectos/core';
import { composeHostReview } from '../loop/hostReviewComposition.js';
import {
  takeClosureTurn,
  takeInteractiveClosureTurn,
  type ClosureTurnDeps,
  type ClosureTurnResult,
  type InteractiveClosureDeps,
} from '../loop/closureTurn.js';
import {
  loadGatekeeperConfig,
  readLedger,
  admitGatekeeperSpend,
  releaseUndispatchedReservation,
  settleUnansweredGatekeeperSpend,
  settleGatekeeperSpend,
  GATEKEEPER_DECISIONS_REL,
  GATEKEEPER_THREAD_REL,
  resolveClosureCommitDelegation,
  type GatekeeperConfig,
} from '../loop/gatekeeperConfig.js';
import { CLOSURE_INTERACTIVE_REL, GATEKEEPER_INTERACTIVE_REL, nodeInteractivePort, resolveGatekeeperMode } from '../loop/gatekeeperHandoff.js';
import { WORK_RECORD_REL } from '../loop/workRecord.js';
import { unprovisionedResolver } from '../loop/credentialResolver.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { resolveBoundGit } from '../system.js';
import { phase as phaseCommand } from './phase.js';
import { brokerRouteOptedIn, GATE_WAIT_INVALID, gateWaitMinutesFrom, run as runCommand, trustedBroker } from './run.js';
import {
  closureRequestDigest,
  consumedDecisionIds as consumedDecisionIdsOf,
  type ClosureDecisionRecord,
  type ClosureRequest,
} from '@projectos/core';
import type { System } from '../system.js';

export function closure(ctx: CommandContext, flags: Flags, positionals: readonly string[]): CommandResult {
  const sub = positionals[0] ?? 'status';
  switch (sub) {
    case 'prepare':
      return closurePrepare(ctx, flags);
    case 'request':
      return closureRequest(ctx, flags);
    case 'resume':
      return closureResume(ctx, flags);
    case 'status':
      return closureStatus(ctx, flags);
    default:
      return fail(1, [`Unknown 'closure' subcommand: ${sub}`, 'Use: closure prepare|request|resume|status']);
  }
}

function readJson(sys: System, path: string): Record<string, unknown> | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The plan's closure delegate, or `''`. Read from the plan, never from a caller or a record. */
function delegatedTo(plan: Record<string, unknown>): string {
  const governance = plan['governance'];
  if (typeof governance !== 'object' || governance === null) return '';
  const delegation = (governance as Record<string, unknown>)['closureDelegation'];
  if (typeof delegation !== 'object' || delegation === null || Array.isArray(delegation)) return '';
  const to = (delegation as Record<string, unknown>)['delegatedTo'];
  return typeof to === 'string' ? to : '';
}

function planOwner(plan: Record<string, unknown>): string {
  const governance = plan['governance'];
  if (typeof governance !== 'object' || governance === null) return '';
  const owner = (governance as Record<string, unknown>)['owner'];
  return typeof owner === 'string' ? owner : '';
}

/**
 * Why a phase has no governed record to close, and the governed route to one.
 *
 * TWO DIFFERENT FACTS, NOT ONE. A phase the active approved plan does not contain can never have had a
 * record — `phase new` refuses it — so closure has nothing to move to `closed` until the owner admits
 * it to the plan. A planned phase that was simply never started needs only `phase new`. Saying "No
 * phase" for both sent the operator looking for a registration fault that did not exist.
 */
function missingPhaseLines(sys: System, root: string, context: GovernedContext, id: string): readonly string[] {
  const auth = authorisePhase(sys, root, context, id);
  const notPlanned = !auth.ok && auth.code === 'PHASE_NOT_AUTHORISED';
  return [
    notPlanned
      ? `REFUSED (NO_PHASE_RECORD): ${id} has no governed phase record, and it is not a phase of the active approved plan.`
      : `REFUSED (NO_PHASE_RECORD): ${id} is a phase of the active approved plan, but it was never started, so it has no governed record.`,
    ...(auth.ok ? [] : [`  ${auth.detail}`]),
    '  Closure moves a phase RECORD to closed; with no record there is nothing it can move.',
    notPlanned
      ? `  To govern it: the owner approves a plan amendment that admits ${id}, then \`projectos phase new --id ${id}\` starts its record.`
      : `  Start its record with \`projectos phase new --id ${id}\`, then advance it with the evidence it produced.`,
    '',
    'Nothing was asked and nothing was spent.',
  ];
}

/**
 * The canonical closure evidence, as the text the closure authority reads and the digest binds.
 *
 * DERIVED, DETERMINISTIC AND ENTIRELY FROM DURABLE STATE. Nothing here is a claim by whoever wants
 * the closure: the record is the phase's own committed-workflow evidence file, and the facts and
 * verdict are recomputed by `evaluateG4` from the repository. No timestamp and no session id appears,
 * because the request id is derived from this digest and a volatile field would make a restart a
 * different — and separately billed — question.
 */
function closureEvidenceText(
  facts: Record<string, unknown>,
  verdict: Record<string, unknown>,
  evidenceRecord: Record<string, unknown> | null,
  phaseRecord: Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      what: 'ProjectOS phase closure evidence',
      phase: {
        phaseId: phaseRecord['phaseId'],
        objective: phaseRecord['objective'],
        status: phaseRecord['status'],
        history: phaseRecord['history'],
      },
      closureEvidenceRecord: evidenceRecord,
      g4Facts: facts,
      g4Verdict: verdict,
    },
    null,
    2,
  );
}

/**
 * The exact ask put to the owner. Rendered from the wait, so the ask and the record cannot drift.
 *
 * IT NAMES EVERY FILE IN THE BUNDLE, WITH ITS DIGEST. The closure call is the only paid call that
 * happens AFTER the evidence subject, so it necessarily leaves its cost entry in the governed tree
 * beside the decision, and G4-13 refuses the closure while either is uncommitted. An earlier version
 * of this ask named both files and byte-bound only the first, which meant the owner was told the
 * commit was exact while half of it was unchecked. Every entry is rendered from `wait.bundle`, so the
 * ask and the thing that will be verified cannot drift.
 */
function ownerAskLines(wait: ClosureWaitRecord): readonly string[] {
  const others = wait.bundle.filter((b) => b.path !== wait.decisionPath);
  return [
    // THE PLAN'S OWNER, NOT A NAME IN SOURCE: `resume` accepts only a commit under the plan owner's
    // identity, so the ask names whoever that is rather than one particular person.
    'WAITING_OWNER — the plan owner must commit the closure bundle.',
    '',
    `  project:  ${wait.projectId}`,
    `  phase:    ${wait.phaseId}`,
    `  subject:  ${wait.evidenceSubjectHead}`,
    `  decision: ${wait.decision}, by ${wait.decidedBy} (${wait.decisionId})`,
    '',
    'THE ACTION REQUESTED — ONE COMMIT OF THESE EXACT FILES, AND NOTHING ELSE:',
    '',
    ...wait.bundle.flatMap((entry) => [
      `  ${entry.path}${entry.path === wait.decisionPath ? '   (the closure decision)' : ''}`,
      `    must digest to ${entry.sha256}`,
    ]),
    '',
    others.length === 0
      ? '  Every file above is checked byte for byte against what you commit.'
      : '  EVERY file above is checked byte for byte against the committed blob — not only the decision.' +
        ' The other ' +
        (others.length === 1 ? 'file is' : 'files are') +
        ' the accounting this call produced: no decision and no authority, but governed state entering' +
        ' the repository inside your commit, so it is bound exactly as the decision is.',
    '',
    '  Do not edit any of them. Do not relay anything to or from the closure authority — ProjectOS',
    '  already asked it and already has its answer. Committing is the whole of what is needed from you.',
    '',
    '  ProjectOS will then read these blobs back out of the commit itself; you do not need to tell it',
    '  the commit id, and a later working-tree correction cannot stand in for a wrong committed blob.',
    '',
    'WHY THIS IS ASKED OF YOU. ProjectOS wrote these files, so ProjectOS writing them proves nothing:',
    'anything able to write a file can write those. Your commit is what makes them a reviewable diff',
    'that passed a gate no part of this runtime can pass for you.',
    '',
    'ONE MORE EXISTING GATE, STATED SO IT IS NOT A SURPRISE. G4-12 requires the branch to be reconciled',
    'with its remote, so the commit must also reach origin before closure can proceed. That predicate',
    'predates this route; it is not something the closure transport added.',
    '',
    `Then run:  projectos closure resume --id ${wait.phaseId}`,
  ];
}

/**
 * How the turn's ports are built. Composed here for production; INJECTED only by tests.
 *
 * THE SEAM IS STATED PLAINLY RATHER THAN HIDDEN, and it is the same one `commands/run.ts` and
 * `loop/runner.ts` already have: the entrypoint composes the credential boundary, the transport and
 * the ledger, and the transition receives them. Without it the request flow could only be exercised
 * against a real trusted broker and a real paid call — so the whole path from eligibility to
 * WAITING_OWNER would ship unexercised, which is exactly the state B6's executor was found in.
 *
 * IT IS NOT REACHABLE FROM THE CLI. `closure()` calls `closureRequest` with no maker, so there is no
 * flag, argument or configuration through which a caller can substitute the credential boundary. A
 * test can pass a fake; a user cannot.
 */
export type MakeClosureDeps = (args: ClosureCompositionArgs) => ClosureTurnDeps | InteractiveClosureDeps;

/**
 * What the composition is handed. The MODE is the committed configuration's, resolved before this is
 * built; the unattended configuration exists only in unattended mode, because interactive needs none.
 */
export type ClosureCompositionArgs = {
  readonly sys: System;
  readonly root: string;
  readonly projectId: string;
  /** Decision ids this phase's own history records as already spent. Derived, never supplied. */
  readonly consumedDecisionIds: readonly string[];
  /** How long an interactive question holds its gate open for the answer. */
  readonly gateWaitMs: number;
  /** `--supersede-stale-request`: archive a stale interactive question and ask afresh. */
  readonly supersedeStale?: boolean;
} & (
  | { readonly mode: 'interactive'; readonly config: null }
  | {
      readonly mode: 'unattended';
      readonly config: GatekeeperConfig;
      /** The route to ProjectOSHost, present only when the COMMITTED configuration names one. */
      readonly hostReview?: HostClosureReviewPort;
    }
);

/**
 * Every governed path this route left uncommitted, with the exact bytes now on disk.
 *
 * DERIVED FROM GIT, NOT LISTED BY HAND. A hand-written list would say what this route was expected to
 * write; `git status --porcelain` says what it actually left, which is what G4-13 will judge and what
 * the owner will therefore have to commit. Digesting each one here is what makes the whole bundle
 * byte-bound rather than just its first file.
 *
 * A git failure yields null rather than an empty list. "I could not ask" and "nothing is dirty" are
 * different facts, and treating the first as the second would present a bundle that silently omitted
 * whatever was actually there — which is the binding this amendment exists to close.
 */
function dirtyGovernedPaths(sys: System, root: string): readonly string[] | null {
  // `-uall` IS LOAD-BEARING, NOT TIDINESS. Plain `--porcelain` collapses an untracked directory to
  // its directory name — a brand-new decision reports as `?? .projectops/closure/decisions/`, not as
  // the file. A bundle built from that would name a directory, digest nothing, and the byte-binding
  // would be over a path git never stores. Listing untracked files individually is what makes the
  // bundle a set of files.
  const status = sys.exec('git', ['-C', root, 'status', '--porcelain', '-uall', '--', '.projectops']);
  if (status.code !== 0) return null;
  return status.stdout
    .split(String.fromCharCode(10))
    .filter((line) => line.trim() !== '')
    .map((line) => {
      // THE PATH IS THE REST OF THE LINE, AND IT IS NOT TRIMMED.
      //
      // Porcelain v1 is `XY <path>` — two status characters, one space, then the path to end of line.
      // An earlier version called `.trim()` on it, and the ECC security review of this amendment
      // demonstrated the consequence against real git: a decoy file whose name is the decision's plus
      // a trailing U+00A0 is emitted unquoted when `core.quotepath` is false, `.trim()` strips the
      // NBSP, and the decoy's parsed path becomes STRING-IDENTICAL to the decision's. It then passed
      // the "unexpected path" filter as if it were the decision, was never digested, never named in
      // the bundle, and rode into the owner's commit unexamined. Only `\r` is removed, because the
      // captured stream may carry CRLF and a carriage return is never part of a git path.
      const path = line.slice(3).split(String.fromCharCode(13)).join('');
      // TWO PORCELAIN FORMS THIS CANNOT READ AS A PATH, AND BOTH ARE RETURNED VERBATIM.
      //
      // A rename is `R  old -> new`, and a path needing escapes is C-quoted (`"a\tb"`). Neither is a
      // plain path, and a parser that guessed at them could produce a path that reads plausibly and
      // digests the wrong file. Returning the raw line instead means it cannot match the decision or
      // the one approved accounting path, so `buildClosureBundle` refuses and quotes git word for
      // word — which is what an operator needs, and is the safe direction rather than the lucky one.
      // No legitimate file this route writes takes either form.
      if (path.startsWith('"') || path.includes(' -> ')) return line.trim();
      return path;
    })
    .filter((path) => path !== '');
}

/**
 * Characters that never appear in a governed record path, and whose presence means a name was crafted
 * to be mistaken for another.
 *
 * WHITESPACE OTHER THAN NOTHING, AND EVERY CONTROL CHARACTER. The attack the security review proved is
 * a filename that differs from the decision's only by an invisible character, so the two look the same
 * to a person and — before this — compared equal after trimming. Refusing the whole class is what
 * makes that impossible rather than merely handled: a governed path is ASCII-printable with no spaces,
 * and anything else is refused by name rather than normalised into something it is not.
 */
const UNSAFE_IN_PATH =
  /[\u0000-\u0020\u007F\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/;

/**
 * The closure bundle: every governed file the owner must commit, decision first, each byte-bound.
 *
 * THE SET IS CLOSED, AND THAT IS THE POINT. A closure call leaves exactly two governed files behind —
 * the decision it produced and the ledger entry it paid for — because eligibility required a clean
 * tree before the call. Anything ELSE dirty under `.projectops/` at this moment is something this
 * route did not write, and it would ride into the owner's commit unexamined: the ask would name two
 * files while the commit carried three. So an unexpected path is a refusal, not a third bundle entry.
 * That is what makes "these two exact files constitute the closure bundle" true rather than hopeful.
 */
export type BundleOutcome =
  | { readonly kind: 'bundle'; readonly entries: readonly ClosureBundleEntry[] }
  | { readonly kind: 'refused'; readonly reasons: readonly string[] };

export function buildClosureBundle(
  sys: System,
  root: string,
  decisionPath: string,
  decisionSha256: string,
): BundleOutcome {
  const dirty = dirtyGovernedPaths(sys, root);
  if (dirty === null) {
    return {
      kind: 'refused',
      reasons: [
        'git would not report what this call left uncommitted, so the closure bundle cannot be named.',
        '  An unverifiable bundle is not a bundle; nothing is presented for owner action.',
      ],
    };
  }

  // A NAME CRAFTED TO BE MISTAKEN FOR ANOTHER IS REFUSED BEFORE IT IS COMPARED. Without this, a file
  // differing from the decision's only by an invisible character reads identically to a person and,
  // once trimmed, compared equal in code — the collision the ECC security review proved against real
  // git. Refusing the class is what makes the comparison below mean what it says.
  const unreadable = dirty.filter((path) => UNSAFE_IN_PATH.test(path));
  if (unreadable.length > 0) {
    return {
      kind: 'refused',
      reasons: [
        `${unreadable.length} uncommitted governed path(s) carry whitespace or control characters:`,
        ...unreadable.map((path) => `    ${JSON.stringify(path)}`),
        '  A governed record path has none. A name that differs from another only by an invisible',
        '  character cannot be told apart by the person being asked to commit it, so it is refused',
        '  rather than normalised into something it is not.',
      ],
    };
  }

  // AND NO PATH APPEARS TWICE. Two entries for one path would mean two presented digests for one file,
  // and the resume would have to choose. `closureWaitProblems` refuses that too; refusing it here as
  // well means it is never written.
  const duplicated = dirty.filter((path, i) => dirty.indexOf(path) !== i);
  if (duplicated.length > 0) {
    return {
      kind: 'refused',
      reasons: [`git reported '${duplicated[0]}' more than once; one path, one presented digest`],
    };
  }

  const unexpected = dirty.filter((path) => path !== decisionPath && !ALSO_IN_BUNDLE.includes(path));
  if (unexpected.length > 0) {
    return {
      kind: 'refused',
      reasons: [
        `${unexpected.length} governed path(s) are uncommitted that this closure call did not write:`,
        ...unexpected.map((path) => `    ${path}`),
        '  The owner is asked to commit a bundle, and every file in it is byte-bound. A path this route',
        '  cannot account for would either travel inside that commit unexamined or refuse the closure',
        '  later at G4-13. Commit or clean it, then ask again.',
      ],
    };
  }

  const entries: ClosureBundleEntry[] = [{ path: decisionPath, sha256: decisionSha256 }];
  for (const path of dirty) {
    if (path === decisionPath) continue;
    const bytes = sys.readText(join(root, ...path.split('/')));
    if (bytes === null) {
      return {
        kind: 'refused',
        reasons: [
          `${path} is uncommitted and could not be read, so the bytes the owner is asked to commit`,
          '  cannot be identified. Nothing is presented for owner action.',
        ],
      };
    }
    entries.push({ path, sha256: closureDecisionSha256(bytes) });
  }
  return { kind: 'bundle', entries };
}

/**
 * The governed paths a closure call may leave behind besides the decision.
 *
 * ONE ENTRY, AND IT IS THE ONE THE ARCHITECTURE GATE APPROVED. The ledger is written because the call
 * was paid for; it is the only other file this route touches. A second name here would be a second
 * thing the owner is asked to commit without a ruling behind it, so the list is a literal.
 */
const ALSO_IN_BUNDLE: readonly string[] = ['.projectops/gatekeeper-ledger.json'];

/** The name the preparation gives its own all-checks result in the validation record. Not a module. */
export const PREPARED_AGGREGATE_NAME = 'projectos-closure-prepare-checks';

/** Where the generated report lives. Named with the phase id so the G4 report predicate finds it. */
export function closureReportRelPath(phaseId: string): string {
  return `knowledge/reports/${phaseId}-closure-evidence.md`;
}

/**
 * Records the LOOP itself writes after its own technical-continuation commit — the gate decision, the
 * interactive question and answer, the work record, the run's own execution records. They describe the
 * run; they are not the work. Uncommitted, they mean "waiting on the owner's commit", not "unreviewed work".
 */
// Named through their OWNING modules' constants: each store has one module that may address it.
const RUN_RECORD_PREFIXES: readonly string[] = [
  '.projectops/execution/',
  `${GATEKEEPER_DECISIONS_REL}/`,
  `${GATEKEEPER_INTERACTIVE_REL}/`,
];
// The thread pointer is written by a paid gatekeeper turn after evidence collection; it is a run record.
const RUN_RECORD_FILES: readonly string[] = [WORK_RECORD_REL, GATEKEEPER_THREAD_REL];

function isRunRecordPath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return !p.includes('..') && (RUN_RECORD_FILES.includes(p) || RUN_RECORD_PREFIXES.some((x) => p.startsWith(x) && p.length > x.length));
}

/** A worker-written string, made safe to put in a JSON record, a prompt and a markdown table. */
function inert(value: string): string {
  return value.replace(/[^A-Za-z0-9 _.:()\-]/g, '_').slice(0, 120);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Porcelain paths, rename-aware enough for a refusal message and for classification. */
function dirtyPaths(sys: System, root: string): readonly string[] {
  return sys
    .exec('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'])
    .stdout.split(/\r?\n/)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .map((l) => (l.includes(' -> ') ? (l.split(' -> ').pop() as string) : l))
    .filter((l) => l !== '');
}

/** How far HEAD is ahead of and behind its upstream, or null when there is no upstream to compare. */
function aheadBehind(sys: System, root: string): { ahead: number; behind: number } | null {
  const r = sys.exec('git', ['-C', root, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  const m = /^(\d+)\s+(\d+)$/.exec(r.stdout.trim());
  return r.code !== 0 || m === null ? null : { ahead: Number(m[1]), behind: Number(m[2]) };
}

/**
 * Is the tree ready to prepare closure on? `null` when it is; otherwise the answer to give. A tree
 * whose only changes are records the run wrote is WAITING ON THE OWNER (exit 0, with the exact commit
 * to make); anything else is unreviewed work and refuses.
 */
function preparationTreeAnswer(sys: System, root: string, context: GovernedContext): CommandResult | null {
  const git = gitFacts(sys, root);
  if (!git.clean) {
    const dirty = dirtyPaths(sys, root);
    const tail = programmeStateTailPaths(context);
    const substantive = dirty.filter((d) => !isClosureTailPath(d, tail) && !isRunRecordPath(d));
    if (substantive.length > 0) {
      return fail(2, [
        'REFUSED (TREE_NOT_CLEAN): the checkout has uncommitted changes that are not run or closure records; closure is not prepared over unreviewed work.',
        ...substantive.map((d) => `  ${d}`),
      ]);
    }
    return ok([
      'WAITING_OWNER_COMMIT (RUN_RECORDS_UNCOMMITTED): the run left its own records uncommitted. They describe the',
      '  run and are not the work, but the checks must run on a clean, pushed tree. Commit exactly these and push:',
      ...dirty.map((d) => `  ${d}`),
      '  then run `projectos continue`.',
    ]);
  }
  const counts = aheadBehind(sys, root);
  if (git.head !== null && counts !== null && counts.ahead > 0 && counts.behind === 0) {
    return ok([`WAITING_OWNER_PUSH: HEAD is ${counts.ahead} commit(s) ahead of its upstream; push, then run \`projectos continue\`.`]);
  }
  if (git.head === null || !git.reconciled) {
    return fail(2, ['REFUSED (SUBJECT_NOT_PUSHED): HEAD is not reconciled with its upstream, so it is not yet the subject a closure judges.']);
  }
  return null;
}

/**
 * The run this closure is prepared from, bound to the subject — or the refusal. Every fact closure
 * evidence is built from must trace to a run the RUNNER recorded:
 *  - the run is bound to a runner session (see `latestRunEvidence`);
 *  - its findings still hash to what the runner collected, so a finding cannot be marked resolved, or a
 *    review claimed, after the run was judged;
 *  - every substantive change from the run's base to the subject is a file the run itself changed: work
 *    committed outside the run does not ride on its review.
 */
function boundRun(
  sys: System,
  root: string,
  context: GovernedContext,
  id: string,
  subject: string,
):
  | { ok: true; run: Record<string, unknown>; findings: FindingsRecord; reviewer: ReviewerRecord | null }
  | { ok: false; result: CommandResult } {
  const refuse = (lines: readonly string[]) => ({ ok: false as const, result: fail(2, lines) });
  const run = latestRunEvidence(sys, root, id);
  if (run === null) return refuse([`REFUSED (NO_RUN_EVIDENCE): no runner-recorded run exists for ${id}; there is no run to prepare closure from.`]);
  const sessionId = String(run['sessionId']);
  const base = typeof run['baseHead'] === 'string' ? run['baseHead'] : '';
  if (!/^[0-9a-f]{40}$/.test(base) || sys.exec('git', ['-C', root, 'merge-base', '--is-ancestor', base, subject]).code !== 0) {
    return refuse([`REFUSED (RUN_NOT_ON_SUBJECT): the run's base commit is not an ancestor of ${subject.slice(0, 7)}, so that run did not produce this subject.`]);
  }
  const recordedFindings = run['findingsSha256'];
  const findingsText = sys.readText(findingsPath(root, sessionId));
  if (recordedFindings === undefined || (findingsText === null ? recordedFindings !== null : sha256(findingsText) !== recordedFindings)) {
    return refuse([
      'REFUSED (FINDINGS_NOT_BOUND): the findings record is not the one the runner collected for this run, or the run',
      '  recorded no digest for it; findings changed after a run was judged are not closure evidence.',
    ]);
  }
  const findings = readFindings(sys, root, sessionId);
  if (!findings.ok) return refuse([`REFUSED (FINDINGS_UNREADABLE): ${findings.problem}`]);
  // D11-C1: THE REVIEWER RECORD COUNTS ONLY WHILE IT HASHES TO WHAT THE RUNNER RECORDED after writing it.
  // A run that obtained no review recorded no digest, and then any reviewer file present is ignored.
  let reviewer: ReviewerRecord | null = null;
  const recordedReviewer = run['reviewerSha256'];
  if (typeof recordedReviewer === 'string') {
    const reviewerText = sys.readText(reviewerPath(root, sessionId));
    const read = readReviewerRecord(sys, root, sessionId);
    if (reviewerText === null || sha256(reviewerText) !== recordedReviewer || !read.ok || read.value === null ||
        read.value.sessionId !== sessionId || read.value.baseHead !== base ||
        read.value.reviewerWorkerId === read.value.implementerWorkerId) {
      return refuse([
        'REFUSED (REVIEWER_NOT_BOUND): the reviewer record is not the one the loop wrote for this run, or it does not',
        '  describe this run; a review changed after the run was judged is not closure evidence.',
      ]);
    }
    reviewer = read.value;
  }
  const changed = new Set(Array.isArray(run['changedFiles']) ? (run['changedFiles'] as unknown[]).map(String) : []);
  const tail = programmeStateTailPaths(context);
  const since = sys.exec('git', ['-C', root, 'diff', '--name-only', `${base}..${subject}`]);
  if (since.code !== 0) return refuse(['REFUSED (SUBJECT_UNREADABLE): the changes from the run base to the subject could not be listed.']);
  const foreign = since.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !isClosureTailPath(l, tail) && !isRunRecordPath(l) && !changed.has(l));
  if (foreign.length > 0) {
    return refuse([
      `REFUSED (SUBJECT_NOT_FROM_RUN): the subject carries changes the run did not make, so the run's review does not cover them.`,
      ...foreign.map((f) => `  ${f}`),
    ]);
  }
  return { ok: true, run, findings: findings.value, reviewer };
}

/**
 * STEP 0.5 — PREPARE CLOSURE: generate the closure evidence, the validation record and the report row
 * from the run's own records — PROJECTOS-BOOT-CONTINUE1A (continuation three).
 *
 * WHAT IT READS. The phase's latest RUNNER-recorded run, bound to the subject (see `boundRun`), the
 * findings that run recorded, the approved plan's requirements for the phase, and git. Nothing is taken
 * from a caller.
 *
 * WHAT IT RUNS. The phase's own check set — the plan's required validators and the configured suites —
 * once more, at the PUSHED subject on a CLEAN tree. The run's checks ran against the candidate before
 * it was committed, on a tree that was by definition not clean; recording those as a clean-tree run
 * would be false. Every check the run recorded must still be configured, and a configuration problem
 * refuses rather than silently dropping a check — a dropped check would read as a passing one.
 *
 * WHAT IT WRITES. Three closure-tail files, and nothing else: `.projectops/closure/<phase>.json`,
 * `.projectops/validation/<subject>.json` and `knowledge/reports/<phase>-closure-evidence.md`.
 *
 * WHAT IT DOES NOT DO. It asks nobody and decides nothing: the closure decision stays with its existing
 * authority, and G4 re-derives every fact again at request. It commits and pushes only its three records,
 * only when every check passed and the phase leaves commit and push delegated (PROJECTOS-FINISH-
 * MULTIPROJECT1A) — otherwise it commits nothing, pushes nothing, and the owner commits them as before.
 * The review claim stays the WORKER's, and is labelled so; binding it to the run is what is added.
 */
export function closurePrepare(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`closure prepare` requires --id <PHASE-ID>']);
  if (!isSafeClosurePhaseId(id)) {
    return fail(1, [`REFUSED (UNSAFE_PHASE_ID): '${id}' does not make a safe governed record name.`]);
  }
  if (resolveBoundGit() === null) {
    return fail(2, ['REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so the subject cannot be established.']);
  }
  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const current = loadPhase(sys, root, id);
  if (current === null) return fail(2, missingPhaseLines(sys, root, gc.context, id));
  if (current.status !== 'awaiting_closure') {
    return fail(2, [`REFUSED (NOT_AWAITING_CLOSURE): ${id} is ${current.status}; closure is prepared only for a phase whose work is finished.`]);
  }
  const treeAnswer = preparationTreeAnswer(sys, root, gc.context);
  if (treeAnswer !== null) return treeAnswer;
  const subject = gitFacts(sys, root).head as string;

  const bound = boundRun(sys, root, gc.context, id, subject);
  if (!bound.ok) return bound.result;
  const { run, findings: recorded, reviewer } = bound;

  const planPhase = (Array.isArray(gc.context.plan['phases']) ? (gc.context.plan['phases'] as Record<string, unknown>[]) : [])
    .find((ph) => ph['phaseId'] === id);
  if (planPhase === undefined) return fail(2, [`REFUSED (PHASE_NOT_IN_PLAN): ${id} is not a phase of the active approved plan.`]);
  const names = (key: string): readonly string[] =>
    Array.isArray(planPhase[key]) ? (planPhase[key] as unknown[]).filter((v): v is string => typeof v === 'string' && v !== '') : [];

  const suites = configuredChecks(gc.context.config as unknown as Record<string, unknown>);
  if (suites.problems.length > 0) {
    return fail(2, ['REFUSED (BAD_CHECK_CONFIG): the project declares a check that cannot be read; a dropped check would read as a passing one.', ...suites.problems.map((p) => `  - ${p}`)]);
  }
  // THE VALIDATORS JUDGE FROM THE RUN'S BASE COMMIT, exactly as they did during the run: the subject
  // carries the phase's own edits, which may include a validator it was granted.
  const base = typeof run['baseHead'] === 'string' ? run['baseHead'] : '';
  if (!/^[0-9a-f]{40}$/.test(base)) {
    return fail(2, ['REFUSED (RUN_BASE_UNKNOWN): the run records no base commit, so its validators cannot be run from the commit the phase started at.']);
  }
  const checked = withPinnedValidators(sys, root, base, (pin) => {
    // THE SAME SET THE RUN RAN: the pinned base copies, plus the phase's own copy of any required validator
    // its approved write paths cover (`phaseCopyChecks`, PROJECTOS-FINISH-CONTINUE-INTEGRITY1A).
    const writePaths = phaseWritePaths(gc.context.plan, id).entries.filter((p): p is string => typeof p === 'string');
    const pinnedSpecs = checksFor(sys, root, names('requiredValidators'), suites.checks, pin);
    const copySpecs = phaseCopyChecks(sys, root, names('requiredValidators'), writePaths);
    const specs = [...pinnedSpecs, ...copySpecs];
    if (specs.length === 0) {
      return fail(2, ['REFUSED (NOTHING_TO_VALIDATE): the phase requires no validator and the project configures no check; a validation record of nothing proves nothing.']);
    }
    const runCheckIds = Array.isArray(run['checks']) ? (run['checks'] as Record<string, unknown>[]).map((c) => String(c['id'])) : [];
    const missing = runCheckIds.filter((c) => !specs.some((s) => s.id === c));
    if (missing.length > 0) {
      return fail(2, ['REFUSED (CHECK_SET_CHANGED): checks the run ran are no longer configured, so the subject would be judged on less.', ...missing.map((m) => `  ${m}`)]);
    }
    return [...runChecks(sys, root, pinnedSpecs), ...runPhaseCopyChecks(sys, root, copySpecs)];
  });
  if (!Array.isArray(checked)) return checked as CommandResult;
  const results: readonly CheckResult[] = checked;
  // THE CHECKS MUST NOT HAVE MOVED THE TREE OR THE SUBJECT. A check that wrote into the checkout, or a
  // commit made while they ran, would make the record describe a tree that is not the subject.
  const after = gitFacts(sys, root);
  if (!after.clean) return fail(2, ['REFUSED (CHECKS_DIRTIED_TREE): running the checks changed the checkout, so no clean-tree record can be written.']);
  if (after.head !== subject || !after.reconciled) {
    return fail(2, ['REFUSED (SUBJECT_MOVED): HEAD or its upstream moved while the checks ran, so they did not run against one subject.']);
  }
  const written = writePreparedRecords(sys, root, id, subject, results, names('requiredReviews'), recorded, reviewer, run);
  // THE THREE RECORDS, COMMITTED BY PROJECTOS WHEN THE PHASE LEAVES COMMIT AND PUSH DELEGATED —
  // PROJECTOS-FINISH-MULTIPROJECT1A. Exactly these three paths and nothing else; when either gate is the
  // owner's, they are only generated and the owner commits them, as before. The closure DECISION is never
  // among them: it counts only once the owner commits it.
  // A FAILING RECORD IS LEFT FOR THE OWNER: it is truthful, but committing it on every retry would add a
  // commit per attempt for a phase G4 will refuse anyway.
  if (!results.every((r) => r.passed)) return written;
  const tail = new Set([`.projectops/validation/${subject}.json`, `.projectops/closure/${id}.json`, closureReportRelPath(id)]);
  const committed = commitOwnRecordsFor(sys, root, gc.context, id, 'closure-tail', (p) => tail.has(p));
  return { code: written.code, lines: [...written.lines, '', ...ownRecordsLines(committed, 'closure-tail')] };
}

/** How each kind of ProjectOS's own records is named to the person reading the outcome. */
const OWN_RECORDS_WHAT: Readonly<Record<OwnRecordsKind, string>> = {
  'run-records': "the run's own records",
  'closure-tail': 'the three closure records',
  'closure-decision': 'the closure decision',
  'post-close': 'the records that persist the close',
};

/** Where a project without a declared state path keeps its governed state; `phase advance` writes it on close. */
const DEFAULT_STATE_REL = '.projectops/current-state.json';

/** What happened to ProjectOS's own records, said plainly. */
export function ownRecordsLines(outcome: OwnRecordsOutcome, kind: OwnRecordsKind): readonly string[] {
  const what = OWN_RECORDS_WHAT[kind];
  switch (outcome.kind) {
    case 'DONE':
      return outcome.lines;
    case 'NOTHING':
      return [`${what}: nothing uncommitted`];
    case 'RESERVED':
      return [`${what}: left for the owner to commit and push — ${outcome.reasons.join('; ')}`];
    case 'REFUSED':
      return [`${what}: ${outcome.nothingAttempted ? 'NOT committed by ProjectOS (nothing attempted)' : 'NOT completed by ProjectOS'}:`, ...outcome.reasons.map((r) => `  ${r}`)];
  }
}

/** Write the three records from facts already established, and say what was written. */
function writePreparedRecords(
  sys: System,
  root: string,
  id: string,
  subject: string,
  results: readonly CheckResult[],
  required: readonly string[],
  recorded: FindingsRecord,
  reviewer: ReviewerRecord | null,
  run: Record<string, unknown>,
): CommandResult {
  const at = sys.now();
  const validators = results.filter((r) => r.kind === 'validator');
  const others = results.filter((r) => r.kind !== 'validator');
  const allPassed = results.every((r) => r.passed);
  const validation = {
    schemaVersion: '1.1.0',
    subjectHead: subject,
    workingTreeCleanAtRunStart: true,
    generatedBy: 'projectos closure prepare',
    generatedAt: at,
    registeredModuleCount: results.length,
    results: results.map((r: CheckResult) => ({ name: r.id, kind: r.kind, passed: r.passed, exitCode: r.exitCode, timedOut: r.timedOut === true })),
    aggregate: { name: PREPARED_AGGREGATE_NAME, passed: allPassed },
    aggregatePassed: allPassed,
  };
  // D11: the same credit rule the loop applies — the implementer's claims satisfy only its self-reviews,
  // and an independent review only the bound reviewer record that passed it.
  const credited = creditedReviews(required, recorded.reviews, reviewer);
  const reviews = credited.map(inert);
  const unresolved = blockingFindings(recorded.findings);
  const evidence = {
    schemaVersion: '1.0.0',
    phaseId: id,
    evidenceSubjectHead: subject,
    validatorsPass: validators.every((r) => r.passed),
    checksPass: others.every((r) => r.passed),
    reviewsComplete: independentReviews(required).length > 0 && required.every((r) => credited.includes(r)),
    reviewsSource: 'worker-attested self-reviews from the findings record (bound by findingsSha256); independent reviews only from the reviewer record the loop wrote (bound by reviewerSha256)',
    unresolvedCriticalOrHigh: unresolved.length,
    unresolvedCritical: unresolved.filter((f) => f.severity === 'CRITICAL').length,
    unresolvedHighIds: unresolved.filter((f) => f.severity === 'HIGH').map((f) => inert(f.id)),
    headedProofPass: null,
    generatedBy: 'projectos closure prepare',
    generatedAt: at,
    generatedFrom: { sessionId: String(run['sessionId']), runBaseHead: String(run['baseHead']), validationRecord: `.projectops/validation/${subject}.json` },
  };

  sys.writeText(validationRecordPath(root, subject), `${JSON.stringify(validation, null, 2)}\n`);
  sys.writeText(closureEvidencePath(root, id), `${JSON.stringify(evidence, null, 2)}\n`);
  const reportRel = closureReportRelPath(id);
  sys.writeText(join(root, ...reportRel.split('/')), closureReportText(id, subject, evidence, results, required, reviews));
  // SAID NOW, NOT AT THE REQUEST: a run that did not verifiably attest makes G4-11 refuse this phase on
  // the delegated route, and the owner route is then the way to close it.
  const unattested = unattestedRuns(sys, root, id);

  return ok([
    `closure prepared for ${id} at subject ${subject}`,
    ...results.map((r) => `  ${r.passed ? 'PASS' : 'FAIL'} ${r.kind} ${r.id}${r.timedOut === true ? ' (timed out)' : ''}`),
    `  reviews (credited): ${evidence.reviewsComplete ? 'complete' : `missing ${required.filter((r) => !credited.includes(r)).join(', ') || 'an independent review'}`}`,
    `  unresolved CRITICAL/HIGH: ${evidence.unresolvedCriticalOrHigh}`,
    '',
    'generated (closure-tail records; nobody was asked):',
    `  .projectops/validation/${subject}.json`,
    `  .projectops/closure/${id}.json`,
    `  ${reportRel}`,
    '',
    allPassed
      ? 'Unless ProjectOS committed them below, commit exactly these three files and push; then `projectos continue` asks the closure authority.'
      : 'A check failed at the subject, so G4 will refuse this closure; the records say so truthfully.',
    ...(unattested.length === 0
      ? []
      : [
          '',
          `NOTE (G4-11 NOT ESTABLISHED): ${unattested.length} run(s) of ${id} did not verifiably attest that no protected effect occurred:`,
          ...unattested.map((s) => `  ${s}`),
          '  G4-11 refuses the delegated closure while any run is unestablished — not because an effect was recorded,',
          '  but because none can be ruled out. The owner closure route decides such a phase.',
        ]),
  ]);
}

/** The report row, rendered from the records just written. Deterministic apart from the run facts. */
function closureReportText(
  phaseId: string,
  subject: string,
  evidence: Record<string, unknown>,
  results: readonly CheckResult[],
  required: readonly string[],
  recorded: readonly string[],
): string {
  return [
    `# ${phaseId} — closure evidence`,
    '',
    'Generated by `projectos closure prepare` from the run\'s own records. It decides nothing; the',
    'closure decision stays with its existing authority.',
    '',
    `- Subject: \`${subject}\``,
    `- Validators pass: ${String(evidence['validatorsPass'])}`,
    `- Checks pass: ${String(evidence['checksPass'])}`,
    `- Reviews required: ${required.length === 0 ? 'none' : required.join(', ')}; recorded by the worker (worker-attested): ${recorded.length === 0 ? 'none' : recorded.join(', ')}`,
    `- Unresolved CRITICAL/HIGH: ${String(evidence['unresolvedCriticalOrHigh'])}`,
    '',
    '| Check | Kind | Result |',
    '| --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.kind} | ${r.passed ? 'pass' : r.timedOut === true ? 'timed out' : 'fail'} |`),
    '',
  ].join('\n');
}

/**
 * STEP 1 — ask the closure authority, and stop at the owner.
 *
 * `--execute` IS REQUIRED because this is the only subcommand that spends money. The same reason
 * `run` requires it: a command that makes a paid provider call must not be reachable by a typo.
 */
export function closureRequest(ctx: CommandContext, flags: Flags, makeDeps?: MakeClosureDeps): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`closure request` requires --id <PHASE-ID>']);
  // THE PHASE ID MUST BE A SAFE NAME BEFORE ANY PATH IS BUILT FROM IT.
  //
  // `closureDecisionPath` interpolates without validating — that is pre-existing and shared with
  // `phase advance` — and this route WRITES through it. Checking here means an id that could traverse
  // or collide is refused before a single path is formed, rather than after the decision has been
  // written and `writeClosureWait` refuses to remember it. The id is operator-supplied, never the
  // authority's; the authority's `phaseId` is only ever compared.
  if (!isSafeClosurePhaseId(id)) {
    return fail(1, [`REFUSED (UNSAFE_PHASE_ID): '${id}' does not make a safe governed record name.`]);
  }

  if (!bool(flags, 'execute')) {
    return fail(2, [
      'REFUSED (NOT_EXECUTING): `closure request` puts the closure question to the closure authority —',
      '  through the owner in interactive mode, or as a PAID ProjectOS Host call in unattended mode.',
      '  - `projectos closure request --id <PHASE-ID> --execute` to actually ask',
      '  - `projectos closure status --id <PHASE-ID>` to see where this phase stands, free',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }
  const gateWaitMinutes = gateWaitMinutesFrom(flags);
  if (gateWaitMinutes === null) return fail(2, [GATE_WAIT_INVALID, '', 'Nothing was asked and nothing was spent.']);

  // THE ORACLE MUST ANSWER BEFORE ANY GOVERNANCE FACT IS REPORTED. Every fact below is read from
  // COMMITTED bytes, and git is what reads them; without it the refusals would all be false.
  if (resolveBoundGit() === null) {
    return fail(2, [
      'REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so no repository fact can be established.',
      '  - bind one with PROJECTOS_GIT_EXE, or install Git so it is on PATH',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const current = loadPhase(sys, root, id);
  if (current === null) return fail(2, missingPhaseLines(sys, root, gc.context, id));

  // WHO ANSWERS, FROM THE COMMITTED CONFIGURATION — the same resolution `projectos run` uses. A
  // configured project that declares no mode is refused, never assigned one.
  const modeResolution = resolveGatekeeperMode(sys, root);
  if (!modeResolution.ok) {
    return fail(2, [
      'REFUSED (GATEKEEPER_MODE_UNRESOLVED): which closure authority route answers this project cannot be established.',
      ...modeResolution.reasons.map((r) => `  - ${r}`),
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  const decider = delegatedTo(gc.context.plan);
  if (decider === '') {
    return fail(2, [
      'REFUSED (NO_CLOSURE_DELEGATION): the active approved plan records no closure delegate.',
      '  - closure stays the owner\'s, and there is nobody for this route to ask',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  // ALREADY DECIDED AND COMMITTED? Then the question has been answered and paying to ask it again
  // would buy a second answer to a settled question.
  if (closureDecisionProblems(sys, root, gc.context, id, current.history, 'delegated').length === 0) {
    return ok([
      `A committed closure decision for ${id} is already usable.`,
      `  run: projectos closure resume --id ${id}`,
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  // ALREADY WAITING? Re-print the ask rather than asking again. This is what makes the route
  // idempotent: writing the decision dirties the tree, so a second `request` would form a DIFFERENT
  // evidence digest, derive a different request id, and be billed as a new question.
  const waitRead = readClosureWait(sys, root, id);
  if (!waitRead.ok) return fail(2, [`REFUSED (CLOSURE_WAIT_UNREADABLE): ${waitRead.problem}`]);
  if (waitRead.value !== null && waitRead.value.state === 'WAITING_OWNER') {
    return ok([
      `${id} is already waiting on the owner; the closure authority was NOT asked again.`,
      '',
      ...ownerAskLines(waitRead.value),
    ]);
  }

  // A DECISION ON DISK WITH NO WAIT is a record this route cannot account for. Overwriting it would
  // destroy an answer somebody may already be acting on.
  if (sys.readText(closureDecisionPath(root, id)) !== null) {
    return fail(2, [
      `REFUSED (UNACCOUNTED_DECISION): a closure decision already exists at ${closureDecisionRelPath(id)} and`,
      '  this route did not write it. Resolve it by hand — it is not overwritten.',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  // ELIGIBILITY FIRST, AND FROM THE REPOSITORY. `evaluateG4` is where "the work is pushed, reconciled,
  // validated, reviewed and clean" becomes a fact rather than a claim — including G4-12, which is
  // what "successful post-push phase state" actually means here.
  // G4-14 IS DERIVED, NOT ASSERTED. `decider` above is non-empty only because the ACTIVE APPROVED
  // PLAN records a closure delegation, so passing that same fact is passing what the runtime
  // established — not a caller's claim. `authorityAssertedByCaller` is false because nothing on this
  // route accepts a role or an identity; G4-15 would refuse it if it did.
  const g4 = evaluateG4(sys, root, gc.context, id, current.status, { ready: true, reasons: [] }, decider !== '', false);
  if (!g4.verdict.eligible) {
    return fail(2, [
      ...g4RefusalLines(g4.verdict),
      '',
      'The closure authority is not asked about work that is not yet closable. Nothing was spent.',
    ]);
  }

  const subject = g4.facts.evidenceSubjectHead;
  if (subject === null) {
    return fail(2, ['REFUSED (NO_EVIDENCE_SUBJECT): the closure evidence names no subject commit.']);
  }

  // `'not-needed'` BECAUSE THIS ROUTE'S AUTHORITY COMES FROM ELSEWHERE, and saying so is more
  // truthful than requiring an unrelated one. `expectedDecider` in the gatekeeper config resolves the
  // committed `gatekeeper-review-decisions` delegate — who may decide a TECHNICAL review. Closure is
  // decided by the plan's `closureDelegation`, which is what `decider` above reads and what
  // `closureDecisionProblems` will compare the committed record against. Demanding the review
  // delegation here would refuse a project that has closure delegated and reviews not, for a reason
  // that has nothing to do with closure. Everything else the loader checks — transport, model policy,
  // rate cards, the owner's budget ceiling, the committed programme and the thread binding — still
  // runs unchanged.
  //
  // ONLY UNATTENDED MODE HAS A TRANSPORT TO LOAD. An interactive closure is answered through the owner
  // and needs no endpoint, price or credential, so a project configured only with `"mode": "interactive"`
  // is not refused for lacking them.
  let config: GatekeeperConfig | null = null;
  let hostClosureReview: HostClosureReviewPort | undefined;
  if (modeResolution.mode === 'unattended') {
    const gk = loadGatekeeperConfig(sys, root, 'not-needed');
    if (!gk.ok) {
      return fail(2, [
        'REFUSED (GATEKEEPER_MISCONFIGURED): a closure authority transport could not be used.',
        ...('reasons' in gk ? gk.reasons.map((r) => `  - ${r}`) : ['  - no gatekeeper transport is configured']),
        '',
        'Nothing was asked and nothing was spent.',
      ]);
    }
    config = gk.config;
    const composedHost = composeHostReview(sys, root);
    if (composedHost.kind === 'refused') return fail(2, composedHost.lines);
    if (composedHost.kind === 'composed') hostClosureReview = composedHost.port;
    if (hostClosureReview !== undefined && brokerRouteOptedIn(sys, root)) {
      return fail(2, [
        'REFUSED (GATEKEEPER_ROUTE_AMBIGUOUS): the committed configuration names both a ProjectOSHost review route and the',
        '  installation broker. Keep exactly one. Nothing was asked and nothing was spent.',
      ]);
    }
  }

  const evidenceText = closureEvidenceText(
    g4.facts as unknown as Record<string, unknown>,
    g4.verdict as unknown as Record<string, unknown>,
    readJson(sys, closureEvidencePath(root, id)),
    current as unknown as Record<string, unknown>,
  );

  // WHICH AUTHORITY IS FUNDING THIS CALL, SAID OUT LOUD. The trusted broker admits a closure question
  // under the phase's committed `secrets-handling` receipt, exactly as it does the seven technical
  // asks — so a receipt committed before this route existed also pays for this. That is bounded (a
  // paid question closes nothing) but it is a real widening of what an old receipt covers, and the
  // owner should see it at the moment it is being used rather than infer it later.
  const fundedBy =
    `this call is funded by the committed secrets-handling receipt for ${id}; that receipt now also ` +
    'covers closure questions, which it did not when it was written';

  const shared = {
    sys,
    root,
    projectId: gc.context.projectId,
    // FROM THE PHASE'S OWN HISTORY. An authority that answers with an id this phase has already
    // closed on is refused at the transport, before anything is written and before the owner is
    // asked to commit it — rather than only at the gate, where the refusal would arrive after a
    // record had been put in front of a person.
    consumedDecisionIds: consumedDecisionIdsOf(current.history),
    gateWaitMs: gateWaitMinutes * 60_000,
    supersedeStale: flags["supersede-stale-request"] === true,
  };
  const deps = (makeDeps ?? productionClosureDeps)(
    config === null
      ? { ...shared, mode: 'interactive', config: null }
      : { ...shared, mode: 'unattended', config, ...(hostClosureReview === undefined ? {} : { hostReview: hostClosureReview }) },
  );
  const turnInput = {
    projectId: gc.context.projectId,
    phaseId: id,
    subjectHead: subject,
    repositoryRoot: root,
    evidenceText,
    expectedDecider: decider,
    owner: planOwner(gc.context.plan),
    unresolvedHighIds: g4.facts.unresolvedHighIds,
    at: sys.now(),
  };
  // ONE QUESTION, TWO ACQUISITION PATHS. Everything after the turn — the decision write, the bundle,
  // the owner's commit and `phase advance` — is the same code whichever route produced the answer.
  const turn: ClosureTurnResult =
    deps.mode === 'interactive' ? takeInteractiveClosureTurn(turnInput, deps) : takeClosureTurn(turnInput, deps);

  if (turn.outcome !== 'DECIDED_CLOSE' || turn.decision === null || turn.request === null) {
    return fail(2, [
      `REFUSED (${turn.outcome}): ${id} was not closed and no closure decision was written.`,
      ...turn.lines.map((l) => `  ${l}`),
      ...turn.problems.map((p) => `  ${p}`),
    ]);
  }

  // SETTLE FIRST, WHATEVER THE ANSWER WAS. The call happened and cost money; that is true regardless
  // of whether the answer turned out to be usable, and a refused answer that left only a reservation
  // behind would under-report the very spend the owner's ceiling exists to bound.
  //
  // SETTLE, DO NOT APPEND: admission already wrote this request id at its estimate, and the ledger
  // keeps the first entry it sees for an id — so appending the truth beside it would leave the
  // estimate standing as the recorded cost.
  const trace = [
    ...(config === null ? [] : [fundedBy]),
    ...turn.lines,
    ...(turn.provenance === undefined ? [] : [`closure decision provenance: ${turn.provenance}`]),
  ];
  if (turn.ledgerEntry !== null) {
    settleGatekeeperSpend(sys, root, turn.ledgerEntry.requestId, turn.ledgerEntry);
  }

  const written = writeClosureDecisionForOwner(sys, root, id, turn.decision);
  if (written.kind === 'conflict') {
    return fail(2, [`REFUSED (DECISION_CONFLICT): ${written.detail}`, ...trace.map((l) => `  ${l}`)]);
  }

  // THE BUNDLE, BEFORE THE OWNER IS ASKED FOR ANYTHING. Presenting the ask first and identifying the
  // files afterwards would be presenting an ask ProjectOS could not yet verify.
  const bundle = buildClosureBundle(sys, root, written.relPath, written.sha256);
  if (bundle.kind === 'refused') {
    return fail(2, [
      `REFUSED (BUNDLE_NOT_IDENTIFIED): the closure decision for ${id} was written but NOT presented.`,
      ...bundle.reasons.map((r) => `  ${r}`),
      `  The decision at ${written.relPath} is NOT to be committed until this is resolved.`,
    ]);
  }

  // HEAD AT THE MOMENT OF THE ASK. Verifying the bundle's bytes says the two named files are right;
  // it says nothing about what ELSE the owner's commit carried. Recording the head the ask was made
  // against is what lets resume ask that second question — see `observeOwnerCommit`.
  const headAtRequest = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(headAtRequest)) {
    return fail(2, [
      `REFUSED (HEAD_NOT_ESTABLISHED): git would not say where HEAD is, so the commit the owner makes`,
      '  could not later be bounded to the bundle. Nothing is presented for owner action.',
    ]);
  }

  const wait = closureWaitFrom(
    turn.request,
    turn.decision,
    written.sha256,
    written.relPath,
    bundle.entries,
    headAtRequest,
    sys.now(),
    turn,
  );
  if (!writeClosureWait(sys, root, wait)) {
    return fail(2, [
      `REFUSED (UNSAFE_PHASE_ID): phase '${id}' does not make a safe closure-wait record name, so the`,
      '  bytes presented to the owner could not be remembered and a later commit could not be checked',
      `  against them. The decision at ${written.relPath} is NOT to be committed until this is resolved.`,
    ]);
  }

  // ZERO-TOUCH CLOSURE — PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A. Where the owner has granted
  // `closure-decision-commit` in the committed delegation, ProjectOS commits and pushes exactly the
  // presented bundle itself and resumes at once; `closureResume` then checks that commit exactly as it
  // checks the owner's. Without the grant, or when a gate keeps commit or push, the owner is asked as
  // before, and a commit that could not be made leaves the same ask standing.
  // ONLY AN ANSWER PRODUCED IN THIS CALL (ECC SECURITY C1 against this phase). An interactive answer is a
  // file anything able to write the checkout can place while the question waits, and the owner's commit
  // is its only anchor — so under the grant it is still the owner's to commit. The broker and Host routes
  // answer inside this process's call, and those alone are committed by ProjectOS.
  if (modeResolution.mode !== 'unattended' || !closureCommitGrant(sys, root, gc.context).granted) {
    return ok([...trace, '', ...ownerAskLines(wait)]);
  }
  const bundlePaths = new Set(bundle.entries.map((b) => b.path));
  const committed = commitOwnRecordsFor(sys, root, gc.context, id, 'closure-decision', (p) => bundlePaths.has(p));
  if (committed.kind !== 'DONE') {
    return ok([...trace, '', ...ownRecordsLines(committed, 'closure-decision'), '', ...ownerAskLines(wait)]);
  }
  const resumed = closureResume(ctx, resumeFlagsFrom(flags, id));
  return { code: resumed.code, lines: [...trace, '', ...committed.lines, ...resumed.lines] };
}

/** The owner's `closure-decision-commit` grant for this project's programme, from the committed delegation. */
function closureCommitGrant(sys: System, root: string, context: GovernedContext): { readonly granted: boolean } {
  const programme = typeof context.plan['programmeId'] === 'string' ? (context.plan['programmeId'] as string).trim() : '';
  return resolveClosureCommitDelegation(sys, root, programme);
}

/** What a request forwards to the resume it runs itself: the phase and the caller's continuation choices, nothing else. */
function resumeFlagsFrom(flags: Flags, id: string): Flags {
  const forwarded: Record<string, string | boolean> = { id };
  if (bool(flags, 'continue')) forwarded['continue'] = true;
  const gateWait = str(flags, 'gate-wait-minutes');
  if (gateWait !== '') forwarded['gate-wait-minutes'] = gateWait;
  if (flags['supersede-stale-request'] === true) forwarded['supersede-stale-request'] = true;
  const worker = str(flags, 'worker');
  if (worker !== '') forwarded['worker'] = worker;
  return forwarded;
}

/** The wait, built from the request and the decision so it cannot describe anything else. */
function closureWaitFrom(
  request: ClosureRequest,
  decision: ClosureDecisionRecord,
  sha256: string,
  relPath: string,
  bundle: readonly ClosureBundleEntry[],
  headAtRequest: string,
  at: string,
  obtained: Pick<ClosureTurnResult, 'provenance' | 'hostAttestationId'>,
): ClosureWaitRecord {
  return {
    ...(obtained.provenance === undefined ? {} : { provenance: obtained.provenance }),
    ...(obtained.hostAttestationId === undefined ? {} : { hostAttestationId: obtained.hostAttestationId }),
    schemaVersion: CLOSURE_WAIT_SCHEMA_VERSION,
    projectId: request.projectId,
    phaseId: request.phaseId,
    decisionPath: relPath,
    decisionSha256: sha256,
    bundle,
    headAtRequest,
    decisionId: String(decision.decisionId ?? ''),
    decidedBy: String(decision.decidedBy ?? ''),
    decision: String(decision.decision ?? ''),
    evidenceSubjectHead: request.subjectHead,
    requestId: request.requestId,
    requestDigest: closureRequestDigest(request),
    requestedAt: at,
    state: 'WAITING_OWNER',
  };
}


/**
 * The production ports, for the project's committed mode — and nothing in this process that could hold
 * a credential.
 *
 * INTERACTIVE: the same interactive port `projectos run` uses, pointed at the closure wait directory
 * (see `CLOSURE_INTERACTIVE_REL`). No transport, price or credential.
 *
 * UNATTENDED: the closure question goes to ProjectOSHost when the committed configuration names a Host
 * route, or — only on the owner's committed opt-in (`brokerRouteOptedIn`, PROJECTOS-FINISH-API-
 * GATEKEEPER1A) — to the trusted installation broker, which resolves the key in its own process. With
 * neither, the closure WAITS. The accounting ports stay: either route is a paid call the owner's ceiling
 * must bound.
 */
function productionClosureDeps(args: ClosureCompositionArgs): ClosureTurnDeps | InteractiveClosureDeps {
  const { sys, root } = args;
  if (args.mode === 'interactive') {
    return {
      mode: 'interactive',
      interactive: nodeInteractivePort(sys, root, {
        dir: CLOSURE_INTERACTIVE_REL,
        waitMs: args.gateWaitMs,
        ...(args.supersedeStale === true ? { supersedeStale: true } : {}),
        // A waiting request returns nothing until it ends, so where to answer is said as it starts.
        onWaiting: (where) =>
          process.stderr.write(
            `WAITING FOR THE INTERACTIVE CLOSURE AUTHORITY\n  the question: ${where.request}\n  save the decision as: ${where.decision}\n`,
          ),
      }),
      consumedDecisionIds: args.consumedDecisionIds,
    };
  }
  const config = args.config;
  return {
    // THE TRUSTED INSTALLATION BROKER, ONLY ON THE OWNER'S COMMITTED OPT-IN — PROJECTOS-FINISH-API-
    // GATEKEEPER1A: composed in the pre-hybrid shape (no `mode`, which means Host-attested); it admits the
    // closure question under the phase's committed secrets-handling receipt and resolves the key inside
    // itself. Otherwise the Host route, ONLY when the committed configuration names one (`closureRequest`
    // has already refused a block that is present but broken, and both at once), or nothing — and it waits.
    ...(args.hostReview === undefined && brokerRouteOptedIn(sys, root)
      ? { broker: trustedBroker(sys, root, args.projectId) }
      : { mode: 'unattended' as const, ...(args.hostReview === undefined ? {} : { hostReview: args.hostReview }) }),
    transport: config.transport,
    availability: { reachable: true },
    // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS. It is the Host's or the broker's; the resolver
    // handed over refuses by construction.
    resolver: unprovisionedResolver('the closure authority credential is resolved on the Host side, never in the agent'),
    http: nodeHttpPort(),
    modelPolicy: config.modelPolicy,
    rateCards: config.rateCards,
    budget: config.budget,
    // ACCOUNTING IS THE SAME MACHINERY THE TECHNICAL ROUTE USES, AND THAT WAS NOT THE FIRST ANSWER.
    //
    // The first attempt supplied no ledger ports at all, reasoning that a ledger write would leave the
    // tree dirty at exactly the moment G4-13 is re-evaluated. The ECC code review called that a HIGH
    // and was right: `authoriseRequestSpend` is the ONLY place in this system that holds the owner's
    // dollar ceiling, it reads this ledger, and an entry that is computed and discarded does not drift
    // the ceiling once — it drifts it further with every phase ever closed. A snapshot read also
    // cannot bound two concurrent requests, which is the defect C17-F1 already cost this programme
    // once.
    //
    // THE REAL FIX WAS ELSEWHERE. `.projectops/gatekeeper-ledger.json` is now a closure-tail path, so
    // the entry can be committed with the decision it paid for without reading as a substantive change
    // since the evidence subject. That is a change to `CLOSURE_TAIL_PATHS` with its own argument
    // recorded there; what it buys here is that the money guard behaves exactly as it does everywhere
    // else, with no special case for the one call that happens after the subject.
    //
    // AND IT SERIALISES. `admitGatekeeperSpend` decides and records under an exclusive lock, so two
    // concurrent `closure request` runs cannot both be admitted for the same deterministic request id
    // — which also closes the write race the reviews raised against the decision and wait records,
    // because only one of the two can reach the point of writing anything.
    ledger: readLedger(sys, root),
    threadBinding: config.threadBinding,
    // Read, never written. The call joins this project's governance conversation; writing the pointer
    // back would dirty `.projectops/gatekeeper-thread.json`, which is NOT a closure-tail path, so the
    // next closure call simply continues from the same turn as this one. Stated rather than hidden.
    admitSpend: (request) =>
      admitGatekeeperSpend(sys, root, request, config.budget, () =>
        readBrokerAnsweredState(sys, nodeInstallationStateDir(), request),
      ),
    releaseUndispatched: (requestId: string) => releaseUndispatchedReservation(sys, root, requestId),
    resolveSpend: (request, cause, providerDispatched) =>
      settleUnansweredGatekeeperSpend(sys, root, request.requestId, cause, providerDispatched, () =>
        readBrokerAnsweredState(sys, nodeInstallationStateDir(), request),
      ),
    // THE IDS THIS PHASE HAS ALREADY SPENT, from its own history. The gate refuses a replay too —
    // `checkClosureDecision` reads `consumedAt` and the history — but refusing it here means a
    // replayed answer never becomes a file, and the owner is never shown a record that was going to
    // be rejected.
    consumedDecisionIds: args.consumedDecisionIds,
  };
}

/** The longest `closure resume` will wait for the owner's commit in one invocation. */
const MAX_OWNER_WAIT_MINUTES = 240;
/** How often a waiting resume looks at the repository again. Git reads only; nothing is spent. */
const OWNER_COMMIT_POLL_MS = 15_000;

export const OWNER_WAIT_INVALID =
  `REFUSED (OWNER_WAIT_INVALID): --owner-wait-minutes takes a whole number from 0 to ${MAX_OWNER_WAIT_MINUTES}.`;

/** `--owner-wait-minutes`, default 0 (look once), or null when it is not a whole number in range. */
export function ownerWaitMinutesFrom(flags: Flags): number | null {
  const raw = str(flags, 'owner-wait-minutes');
  const minutes = raw === '' ? 0 : Number(raw);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_OWNER_WAIT_MINUTES ? minutes : null;
}

/** The pause between looks. A port so a proof can make the owner commit DURING the wait. */
export interface OwnerCommitWaitPorts {
  readonly sleep?: (ms: number) => void;
  readonly pollMs?: number;
}

function blockFor(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * WAIT FOR THE OWNER'S COMMIT, BOUNDED — PROJECTOS-BOOT-CONTINUE1A (G5).
 *
 * The same observation `resume` always made, asked again until it holds or the bound runs out. It
 * waits only for a commit whose bytes match what was presented; it accepts nothing else sooner, and
 * the decision is still re-judged by `phase advance` after it. A bound counted in polls, not wall
 * time, so the wait ends however the clock behaves. RESUMABLE: the wait record stays on disk, so a
 * later `closure resume` (or `projectos continue`) picks up exactly here.
 */
function awaitOwnerCommit<T extends { readonly committed: boolean; readonly matchesPresented: boolean }>(
  observe: () => T,
  minutes: number,
  ports: OwnerCommitWaitPorts,
): T {
  const pollMs = ports.pollMs ?? OWNER_COMMIT_POLL_MS;
  const sleep = ports.sleep ?? blockFor;
  let observed = observe();
  const polls = Math.ceil((minutes * 60_000) / pollMs);
  for (let i = 0; i < polls && !(observed.committed && observed.matchesPresented); i += 1) {
    sleep(pollMs);
    observed = observe();
  }
  return observed;
}

/**
 * STEP 2 — observe the owner's commit, then hand the closure to the existing path.
 *
 * MAKES NO PROVIDER CALL AND SPENDS NOTHING. Everything it needs is in the repository.
 */
export function closureResume(ctx: CommandContext, flags: Flags, ownerWait: OwnerCommitWaitPorts = {}): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`closure resume` requires --id <PHASE-ID>']);
  const ownerWaitMinutes = ownerWaitMinutesFrom(flags);
  if (ownerWaitMinutes === null) return fail(2, [OWNER_WAIT_INVALID]);

  // THE PHASE ID MUST BE A SAFE NAME BEFORE ANY PATH IS BUILT FROM IT.
  //
  // `closureDecisionPath` interpolates without validating — that is pre-existing and shared with
  // `phase advance` — and this route WRITES through it. Checking here means an id that could traverse
  // or collide is refused before a single path is formed, rather than after the decision has been
  // written and `writeClosureWait` refuses to remember it. The id is operator-supplied, never the
  // authority's; the authority's `phaseId` is only ever compared.
  if (!isSafeClosurePhaseId(id)) {
    return fail(1, [`REFUSED (UNSAFE_PHASE_ID): '${id}' does not make a safe governed record name.`]);
  }

  if (resolveBoundGit() === null) {
    return fail(2, [
      'REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so whether the owner committed',
      '  the decision cannot be established. An unverifiable commit is not a commit.',
    ]);
  }

  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));

  const waitRead = readClosureWait(sys, root, id);
  if (!waitRead.ok) return fail(2, [`REFUSED (CLOSURE_WAIT_UNREADABLE): ${waitRead.problem}`]);
  const wait = waitRead.value;
  const waitProblems = closureWaitProblems(wait, { projectId: gc.context.projectId, phaseId: id });
  if (waitProblems.length > 0) {
    return fail(2, ['REFUSED (NO_CLOSURE_WAIT): this run has no record of a decision presented for owner action.', ...waitProblems.map((p) => `  ${p}`)]);
  }
  // Narrowed by `waitProblems` being empty, which is only possible for a non-null wait.
  const waiting = wait as ClosureWaitRecord;

  // THE OWNER'S COMMIT, OBSERVED FROM THE REPOSITORY AND NOWHERE ELSE.
  // THE OWNER IS THE PLAN'S, never the wait's and never a caller's — the same source `authoriseClosure`
  // reads and the same rule every other identity in this programme is judged by.
  // UNDER THE OWNER'S `closure-decision-commit` GRANT, AND ONLY THEN, the ProjectOS commit identity —
  // exactly that name and email — may stand in for the owner's. Everything else below is unchanged.
  // And only for an answer produced in the call, ALLOWLISTED rather than "not interactive" (ECC SECURITY C1,
  // round 2 M1): the committed mode is unattended, and the wait is either Host-attested or — the broker route
  // stamps no provenance — carries none on a project whose committed configuration opts in to the broker.
  // An interactive answer stays the owner's to commit whatever the grant says.
  const grant = closureCommitGrant(sys, root, gc.context);
  const committedMode = resolveGatekeeperMode(sys, root);
  const answeredInCall =
    committedMode.ok &&
    committedMode.mode === 'unattended' &&
    (waiting.provenance === 'HostIndependentProviderAttestation' || (waiting.provenance === undefined && brokerRouteOptedIn(sys, root)));
  const delegatedCommitter = grant.granted && answeredInCall ? { name: PROJECTOS_COMMIT_NAME, email: PROJECTOS_COMMIT_EMAIL } : null;
  const observed = awaitOwnerCommit(
    () => observeOwnerCommit(sys, root, waiting, planOwner(gc.context.plan), delegatedCommitter),
    ownerWaitMinutes,
    ownerWait,
  );
  if (!observed.committed || !observed.matchesPresented) {
    return fail(2, [
      `REFUSED (AWAITING_OWNER_COMMIT): ${id} is still waiting on the owner.`,
      // EVERY ENTRY, MATCHED OR NOT. A refusal that named only the first mismatch would send an
      // operator round the loop once per file.
      ...observed.bundle.map(
        (b) =>
          `  ${b.matches ? 'ok  ' : 'BAD '} ${b.path} ` +
          (b.committedSha256 === null ? '(not in a commit)' : b.matches ? '' : `committed ${b.committedSha256}`),
      ),
      ...(observed.committedBy === null ? [] : [`  the last commit touching the decision was made by ${observed.committedBy}`]),
      ...observed.problems.map((p) => `  ${p}`),
      '',
      ...ownerAskLines(waiting),
    ]);
  }
  // AND STILL UNCHANGED SINCE. A committed decision edited afterwards in the working tree would let
  // the committed version launder an uncommitted change; `decisionIsCommitted` is the existing
  // predicate for exactly that and is asked here rather than re-derived.
  if (!decisionIsCommitted(sys, root, id)) {
    return fail(2, [
      `REFUSED (DECISION_DIRTY): the committed ${closureDecisionRelPath(id)} has been modified since it was`,
      '  committed, so what git holds and what is on disk are different decisions.',
    ]);
  }

  // WHO MADE THE COMMIT THAT WAS ACCEPTED, said truthfully in the output and in the durable history.
  const committedUnderGrant = delegatedCommitter !== null && observed.committedBy === `${PROJECTOS_COMMIT_NAME} <${PROJECTOS_COMMIT_EMAIL}>`;
  const lines = [
    `${committedUnderGrant ? "ProjectOS committed the closure bundle under the owner's closure-decision-commit grant" : 'the owner committed the closure bundle'}, and every file in it is byte-identical to what was presented`,
    ...observed.bundle.map((b) => `  ${b.path}  ${b.committedSha256}`),
    // REPORTED, ALWAYS. The identity was checked against the plan's owner; saying which identity it
    // was is what lets a person notice a checkout configured as somebody it is not.
    `  committed by ${observed.committedBy ?? '<unattributable>'}`,
    'handing the closure to the existing G4 / closure-delegation path',
  ];

  // THE EXISTING PATH, CALLED WITH NOTHING BUT THE PHASE AND THE BASIS.
  //
  // No `--as` and no `--identity`: under `--delegated` the runtime resolves the delegate from the
  // approved plan, and supplying either would be a caller asserting part of the authority, which
  // G4-15 refuses. That refusal is the desired behaviour and is asserted in the tests.
  const advanced = phaseCommand(
    ctx,
    // THE NOTE NAMES THE ROUTE, NOT THE DECISION ID. The id belongs at the END of the recorded note,
    // where `consumedDecisionIds` reads it, and `phase advance` puts the authority basis there itself.
    // Writing `decision <id>` into the caller's half would reproduce the exact shape of the decoy that
    // once defeated replay tracking — the anchored regex makes it harmless today, and a second string
    // of that shape in the same note is still a trap for whoever relaxes the anchor.
    // The note also carries HOW the committed answer was obtained, as the route that received it stated,
    // so the durable history keeps the evidence class the owner committed.
    {
      id,
      to: 'closed',
      delegated: true,
      note: `closed by the closure transport on the ${committedUnderGrant ? "record ProjectOS committed under the owner's closure-decision-commit grant" : 'owner-committed record'} (${waiting.provenance ?? 'provenance unrecorded'})`,
    },
    ['advance'],
  );
  if (advanced.code !== 0) return { code: advanced.code, lines: [...lines, ...advanced.lines] };

  resolveClosureWait(sys, root, waiting, sys.now());

  // AND THE CLOSE IS PERSISTED, under the same grant. The closed phase record, the governed state and the
  // decision's `consumedAt` stamp are the records `phase advance` just wrote; without the grant they stay
  // for the owner, as before (the decision is the owner's file then).
  const tail = new Set([closureDecisionRelPath(id), `.projectops/phases/${id}.json`, DEFAULT_STATE_REL, ...programmeStateTailPaths(gc.context)]);
  const persisted = grant.granted
    ? ownRecordsLines(commitOwnRecordsFor(sys, root, gc.context, id, 'post-close', (p) => tail.has(p)), 'post-close')
    : [];

  /**
   * AND THEN THE PROGRAMME CARRIES ON — through the SAME authority `run` uses, never a second one.
   *
   * WHAT WAS MISSING. A delegated closure recorded the close and exited, so the programme advanced
   * only when the owner typed the next command. That is one of the three things run-to-completion
   * exists to remove.
   *
   * WHY IT DELEGATES TO `run` RATHER THAN CONTINUING HERE. Two continuation paths disagree
   * eventually, and the disagreement is discovered by a programme continuing when it should have
   * stopped. This command closes a phase; it does not decide what happens next and it does not know
   * how to start a worker. It hands over to the one entry point that does, which then asks
   * `continueProgramme` exactly as it would have if the owner had typed it.
   *
   * OPT-IN, AND ONLY AFTER A REAL CLOSE. Without `--continue` this behaves exactly as it always has.
   * `--execute` is set because a closure that carries the programme is by definition starting work;
   * a caller that wants to close without starting anything simply omits `--continue`.
   */
  if (!bool(flags, 'continue')) return ok([...lines, ...advanced.lines, ...persisted]);
  // THE SAME WAIT AND RECOVERY CHOICES THE CALLER MADE, and nothing else: no authority travels here.
  const forwarded: Record<string, string | boolean> = { execute: true, continue: true };
  const gateWait = str(flags, 'gate-wait-minutes');
  if (gateWait !== '') forwarded['gate-wait-minutes'] = gateWait;
  if (flags['supersede-stale-request'] === true) forwarded['supersede-stale-request'] = true;
  const worker = str(flags, 'worker');
  if (worker !== '') forwarded['worker'] = worker;
  const carried = runCommand(ctx, forwarded);

  /**
   * THE CLOSE SUCCEEDED, SO THIS COMMAND SUCCEEDED — whatever the follow-on run did.
   *
   * Returning `carried.code` conflated two different facts. The phase is closed and the record is
   * written by the time this line is reached (`advanced.code === 0` is checked above), so a follow-on
   * run that merely refused to START — a missing git binding, a misconfigured gatekeeper — would have
   * exited non-zero and told a script that the CLOSURE failed. A script that retries on that would
   * re-run a closure that already happened. Raised as LOW by the code review of this change.
   *
   * The continuation's own outcome is not hidden: it is in the lines, in its own words, and a
   * continuation that refused says so there.
   */
  return ok([
    ...lines,
    ...advanced.lines,
    ...persisted,
    '',
    `phase ${id} closed; carrying the approved programme forward from the same continuation authority`,
    ...carried.lines,
    ...(carried.code === 0
      ? []
      : ['', `the closure stands; the follow-on run ended non-zero (${carried.code}) and its reasons are above`]),
  ]);
}

/** STEP 0 — where this phase stands. Reads only; asks nobody; spends nothing. */
function closureStatus(ctx: CommandContext, flags: Flags): CommandResult {
  const { sys, root } = ctx;
  const id = str(flags, 'id');
  if (id === '') return fail(1, ['`closure status` requires --id <PHASE-ID>']);
  // THE PHASE ID MUST BE A SAFE NAME BEFORE ANY PATH IS BUILT FROM IT.
  //
  // `closureDecisionPath` interpolates without validating — that is pre-existing and shared with
  // `phase advance` — and this route WRITES through it. Checking here means an id that could traverse
  // or collide is refused before a single path is formed, rather than after the decision has been
  // written and `writeClosureWait` refuses to remember it. The id is operator-supplied, never the
  // authority's; the authority's `phaseId` is only ever compared.
  if (!isSafeClosurePhaseId(id)) {
    return fail(1, [`REFUSED (UNSAFE_PHASE_ID): '${id}' does not make a safe governed record name.`]);
  }

  const gc = loadGovernedContext(sys, root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const current = loadPhase(sys, root, id);
  if (current === null) return fail(2, missingPhaseLines(sys, root, gc.context, id));

  // THE SAME DERIVED FACT. Hardcoding `true` here would have told a project with NO closure
  // delegation that G4-14 was satisfied — a read-only report that lies about the one predicate the
  // reader is most likely to be checking.
  const g4 = evaluateG4(
    sys,
    root,
    gc.context,
    id,
    current.status,
    { ready: true, reasons: [] },
    delegatedTo(gc.context.plan) !== '',
    false,
  );
  const decisionProblems = closureDecisionProblems(sys, root, gc.context, id, current.history, 'delegated');
  const waitRead = readClosureWait(sys, root, id);

  const lines = [
    `closure status for ${id}`,
    `  phase status:        ${current.status}`,
    `  closure delegate:    ${delegatedTo(gc.context.plan) || '<none recorded>'}`,
    `  G4 eligible:         ${g4.verdict.eligible ? 'yes' : `no (${g4.verdict.unmet.length} unmet)`}`,
    ...g4.verdict.unmet.map((u) => `    ${u.code}: ${u.detail}`),
    `  committed decision:  ${decisionProblems.length === 0 ? 'usable' : `${decisionProblems.length} problem(s)`}`,
    ...decisionProblems.map((p) => `    ${p}`),
  ];
  if (!waitRead.ok) {
    lines.push(`  closure wait:        UNREADABLE — ${waitRead.problem}`);
  } else if (waitRead.value === null) {
    lines.push(`  closure wait:        none (${closureWaitRelPath(id) ?? 'unnameable path'})`);
  } else {
    lines.push(
      `  closure wait:        ${waitRead.value.state}`,
      `    decision:          ${waitRead.value.decisionId} by ${waitRead.value.decidedBy}`,
      `    presented digest:  ${waitRead.value.decisionSha256}`,
      `    provenance:        ${waitRead.value.provenance ?? 'unrecorded'}`,
    );
  }
  return ok(lines);
}

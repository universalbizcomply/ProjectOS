/**
 * Where the live gatekeeper's configuration and its durable ledger live.
 *
 * WHY NOT IN `project-config.json`. That file is covered by the plan fingerprint: editing it makes
 * the approved plan STALE and forces a re-approval, which is exactly what happened to this
 * programme's first plan decision. Configuration that changes when a rate card changes must not be
 * able to invalidate an approved plan, so it lives in its own file. The plan governs WHAT may happen;
 * this governs WHICH endpoint and at WHAT price.
 *
 * THE LEDGER IS DURABLE ON PURPOSE. A budget that resets when the process restarts is not a budget.
 * `.projectops/gatekeeper-ledger.json` is the record of what has actually been spent, and it is what
 * makes "restart without a duplicate charge" true across processes rather than merely within one:
 * the request id is derived from the question, so a restarted run re-derives it, finds it already in
 * the ledger, and does not pay twice.
 *
 * NOTHING HERE HOLDS A SECRET. The transport names a credential; `checkTransportDescriptor` refuses a
 * descriptor containing key-shaped material at any depth, and that check runs on this file's contents
 * before the configuration is used.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { join } from 'node:path';
import {
  checkTransportDescriptor,
  checkPilotBudget,
  authoriseRequestSpend,
  summariseLedger,
  BUDGET_RAISE_SCOPE,
  GATEKEEPER_REVIEW_SCOPE,
  type BudgetPolicy,
  type GatekeeperTransportDescriptor,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type ModelPolicy,
  type RateCard,
} from '@projectos/core';
import type { System } from '../system.js';
import type { BrokerAnsweredState } from '../installation/brokerAnsweredState.js';
// The canonical delegation validator and the canonical owner resolution — imported rather than
// re-implemented, because a second opinion about either is the defect this file was corrected for.
import {
  checkClosureDelegationRecord,
  resolveRecordedOwner,
  readCommittedJson,
  PROJECT_CONFIG_REL,
  type PlanApprovalDelegationRecord,
} from '../planApproval.js';

export const GATEKEEPER_CONFIG_REL = '.projectops/gatekeeper.json';
export const GATEKEEPER_LEDGER_REL = '.projectops/gatekeeper-ledger.json';
export const GATEKEEPER_LEDGER_LOCK_REL = '.projectops/gatekeeper-ledger.lock';
export const GATEKEEPER_THREAD_REL = '.projectops/gatekeeper-thread.json';

/** The decider a valid delegation names, or every reason there is no decider. */
export type DelegatedDeciderResolution =
  | { readonly ok: true; readonly decider: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * The decider the COMMITTED delegation names for this programme, IF that record is a valid one.
 *
 * READ FROM GIT, NOT FROM THE WORKING TREE, and not from `gatekeeper.json`. The transport's own
 * configuration says who it claims to be; this says who the owner delegated to. Keeping them in
 * different files - one of which only counts once committed - is what stops the identity check
 * comparing a value with itself. GK-SEC-004.
 *
 * WHY IT VALIDATES, AND WHY THAT WAS A REAL DEFECT (C11-W2-F1). This function used to accept the
 * record on two facts: `programmeScope` matched, and `delegatedTo` was a non-empty string. Nothing
 * else about it was ever judged here — not its schema, not whether the owner it claims to come from
 * is this project's owner, not whether the delegate is the implementer, not what it actually
 * delegates. `checkClosureDelegationRecord` judged all of that, but only when a plan was being
 * approved, so the same committed bytes could be REJECTED by the approval path and simultaneously
 * ACCEPTED here as the authority behind every review decision. It also made authority
 * ORDER-DEPENDENT: commit the delegation after the plan is approved and the validating path never
 * sees it at all.
 *
 * Validity is now a property of the record, not of when it was committed. The record is judged by
 * the same function the approval path calls, against an owner resolved from the same sources, and it
 * must carry `gatekeeper-review-decisions` — the capability actually being exercised. A record that
 * would be refused at approval is refused here, in either order.
 */
export function resolveDelegatedDecider(sys: System, root: string, programmeId: string): DelegatedDeciderResolution {
  const rel = '.projectops/authority/closure-delegation.json';
  // `./` binds the read to the governed root; see the note in degradedMode.ts. This one had no
  // root-relative pre-check at all, so a nested checkout adopted the outer project's delegation —
  // and the delegation names who is permitted to decide.
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  const committed = shown.code === 0 && shown.stdout.trim() !== '';
  let record: Record<string, unknown> | null = null;
  if (committed) {
    try {
      const parsed: unknown = JSON.parse(shown.stdout);
      // `JSON.parse` accepts `null` and arrays. Neither is a delegation, and both would otherwise
      // reach the checker as an object-shaped value.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, problems: [`the committed ${rel} is not a JSON object, so it delegates nothing`] };
      }
      record = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, problems: [`the committed ${rel} is not valid JSON, so it delegates nothing`] };
    }
  }

  // THE PROJECT AND THE OWNER ARE DERIVED, never read from the record being judged — otherwise the
  // record would supply the values it is checked against, which is not a check.
  //
  // AND THEY ARE READ FROM THE COMMITTED TREE. A validated record judged against a forgeable
  // expectation is not validated: `projectId` and the plan that names the owner are precisely the
  // values `checkClosureDelegationRecord` compares the delegation to, so trusting the working copy
  // here would let anything that can write a file decide who the owner is, commit one internally
  // consistent delegation, and be resolved as the decider. Plan approval reads the working tree
  // because it is one owner-attended act whose output is then committed; this runs unattended, over
  // and over, and has no such gate — so it takes the bytes that passed one.
  const config = readCommittedJson(sys, root, PROJECT_CONFIG_REL);
  if (config === null) {
    return {
      ok: false,
      problems: [
        `${PROJECT_CONFIG_REL} is not committed, so this project's identity has not passed the owner ` +
          'commit gate and no delegation can be bound to it',
      ],
    };
  }
  const projectId = typeof config['projectId'] === 'string' ? (config['projectId'] as string).trim() : '';
  if (projectId === '') {
    return { ok: false, problems: [`the committed ${PROJECT_CONFIG_REL} names no projectId, so no delegation can be bound to this project`] };
  }
  // FAIL CLOSED, DO NOT CRASH. Resolving the owner and judging the record both go through the
  // governance engine, which an entrypoint must install first. This function used to need no such
  // dependency, so a caller that reaches it too early would now throw where it previously got a
  // `null`. A refusal carrying the real message is the honest form of that: nothing is swallowed,
  // and a misconfigured entrypoint cannot turn into an unhandled crash mid-loop.
  let problems: readonly string[];
  try {
    const owned = resolveRecordedOwner(sys, root, config, projectId, 'committed');
    if (!owned.ok) {
      return { ok: false, problems: [`this project's recorded owner could not be established (${owned.code})`, ...owned.problems] };
    }
    problems = checkClosureDelegationRecord(record as PlanApprovalDelegationRecord | null, {
      projectId,
      recordedOwner: owned.recordedOwner,
      isCommitted: committed,
      programmeId,
      requiredScope: GATEKEEPER_REVIEW_SCOPE,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      problems: [
        'the delegation could not be judged, so it grants nothing',
        `  ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (problems.length > 0) return { ok: false, problems };
  // Narrowing. `checkClosureDelegationRecord` has already refused a null record when a scope is
  // required, and refused a missing or blank `delegatedTo`.
  return { ok: true, decider: String((record as Record<string, unknown>)['delegatedTo']).trim() };
}

/** The decider, or `null`. Thin wrapper over {@link resolveDelegatedDecider} for callers that only
 *  need the identity; anything reporting a refusal should use the full result and say why. */
export function committedDelegatedDecider(sys: System, root: string, programmeId: string): string | null {
  const r = resolveDelegatedDecider(sys, root, programmeId);
  return r.ok ? r.decider : null;
}

export interface GatekeeperConfig {
  readonly transport: GatekeeperTransportDescriptor;
  readonly modelPolicy: ModelPolicy;
  readonly rateCards: Readonly<Record<string, RateCard>>;
  readonly budget: BudgetPolicy;
  readonly threadBinding: GovernanceThreadBinding;
  /** Who may decide, per the committed delegation. */
  readonly expectedDecider: string;
  /** Who the configured transport claims to be. Checked against the above, never derived from it. */
  readonly transportDecider: string;
}

export type ConfigLoad =
  | { readonly ok: true; readonly config: GatekeeperConfig }
  | { readonly ok: false; readonly reasons: readonly string[] }
  | { readonly ok: false; readonly absent: true; readonly reasons: readonly string[] };

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

/**
 * Load and CHECK the gatekeeper configuration.
 *
 * ABSENT IS NOT AN ERROR. With no configuration there is no reviewer and the loop behaves exactly as
 * it did before one existed — stopping for the owner. That is the correct behaviour for every project
 * that has not opted in, and it is why this returns a distinguishable `absent` rather than a refusal.
 */
export function loadGatekeeperConfig(sys: System, root: string): ConfigLoad {
  const path = join(root, ...GATEKEEPER_CONFIG_REL.split('/'));
  const raw = readJson(sys, path);
  if (raw === null) {
    return {
      ok: false,
      absent: true,
      reasons: [`no gatekeeper is configured for this project (${GATEKEEPER_CONFIG_REL} is absent or unreadable)`],
    };
  }

  const reasons: string[] = [];
  if (raw['schemaVersion'] !== '1.0.0') {
    reasons.push(`gatekeeper config schemaVersion is ${JSON.stringify(raw['schemaVersion'])}, expected "1.0.0"`);
  }
  if (raw['enabled'] !== true) {
    reasons.push('the gatekeeper is configured but not enabled; set enabled to true to use it');
  }

  const transport = raw['transport'] as GatekeeperTransportDescriptor | undefined;
  if (transport === undefined) reasons.push('gatekeeper config declares no transport');
  else reasons.push(...checkTransportDescriptor(transport));

  const modelPolicy = raw['modelPolicy'] as ModelPolicy | undefined;
  if (
    modelPolicy === undefined ||
    typeof modelPolicy.routineModel !== 'string' ||
    typeof modelPolicy.strongModel !== 'string'
  ) {
    reasons.push('gatekeeper config declares no usable modelPolicy (routineModel and strongModel)');
  }

  const rateCards = (raw['rateCards'] ?? {}) as Record<string, RateCard>;
  if (modelPolicy !== undefined) {
    for (const model of [modelPolicy.routineModel, modelPolicy.strongModel]) {
      if (typeof model === 'string' && rateCards[model] === undefined) {
        reasons.push(`no rate card is configured for model '${model}', so a call to it could not be priced`);
      }
    }
  }

  // THE OWNER'S CEILING IS CHECKED HERE, not only at call time: a configuration above the approved
  // pilot is refused before anything reads it, and a budget raise must name a decision scoped to it.
  const budgetRaw = (raw['budget'] ?? {}) as Record<string, unknown>;
  const authorities = Array.isArray(raw['budgetRaiseAuthorities'])
    ? (raw['budgetRaiseAuthorities'] as { decisionId: string; scope: string }[])
    : [];
  reasons.push(
    ...checkPilotBudget(
      {
        initialCreditMicroUsd: budgetRaw['initialCreditMicroUsd'],
        warnAtMicroUsd: budgetRaw['warnAtMicroUsd'],
        hardStopAtMicroUsd: budgetRaw['hardStopAtMicroUsd'],
        autoRecharge: budgetRaw['autoRecharge'],
        raisedByOwnerDecisionId: budgetRaw['raisedByOwnerDecisionId'],
      },
      authorities.filter((a) => a && typeof a.decisionId === 'string' && a.scope === BUDGET_RAISE_SCOPE),
    ),
  );

  const transportRaw = (raw['transport'] ?? {}) as Record<string, unknown>;
  const transportDecider =
    typeof transportRaw['decidedBy'] === 'string' ? transportRaw['decidedBy'].trim() : '';
  if (transportDecider === '') reasons.push('gatekeeper config transport names no decidedBy');

  // The authority comes from the COMMITTED delegation, never from this file.
  const programmeId = typeof raw['programmeId'] === 'string' ? raw['programmeId'].trim() : '';
  // THE PROGRAMME IS WHAT A DELEGATION IS MATCHED AGAINST, so it may not be re-pointed in the working
  // copy alone. A delegation record stays in history forever and carries no expiry: it stops applying
  // only because the programme moved on. Reading this value from the uncommitted file would therefore
  // let an edit nobody reviewed revive a retired programme's delegation, and with it a decider who
  // should no longer hold that authority. The committed value is the one the owner's commit gate saw;
  // a working copy that disagrees is refused rather than silently preferred either way.
  const committedGatekeeper = readCommittedJson(sys, root, GATEKEEPER_CONFIG_REL);
  const committedProgramme =
    typeof committedGatekeeper?.['programmeId'] === 'string' ? (committedGatekeeper['programmeId'] as string).trim() : '';
  const programmeIsCommitted = programmeId !== '' && programmeId === committedProgramme;
  if (programmeId !== '' && !programmeIsCommitted) {
    reasons.push(
      committedProgramme === ''
        ? `the committed ${GATEKEEPER_CONFIG_REL} declares no programmeId, so the programme this ` +
          'configuration names has not passed the owner commit gate and no delegation can be resolved against it'
        : `this configuration names programme '${programmeId}', but the committed ${GATEKEEPER_CONFIG_REL} ` +
          `names '${committedProgramme}'. Commit the change, or restore it: re-pointing the programme in the ` +
          'working copy alone would decide which committed delegation applies.',
    );
  }
  const delegated = !programmeIsCommitted ? null : resolveDelegatedDecider(sys, root, programmeId);
  const expectedDecider = delegated !== null && delegated.ok ? delegated.decider : null;
  if (programmeId === '') reasons.push('gatekeeper config names no programmeId, so no delegation can be resolved');
  else if (delegated !== null && !delegated.ok) {
    // The specific reasons, not a generic line. "No delegation names a decider" was true of a
    // missing record and of a malformed, foreign-owned or wrongly-scoped one alike, which told an
    // operator holding a real but invalid delegation nothing about what was actually wrong with it.
    reasons.push(
      `no valid committed delegation grants '${GATEKEEPER_REVIEW_SCOPE}' for programme '${programmeId}'; a ` +
        'review decision has no authority behind it until the owner has committed one that does',
      ...delegated.problems.map((p) => `  ${p}`),
    );
  }

  const threadBinding = raw['threadBinding'] as GovernanceThreadBinding | undefined;
  if (threadBinding === undefined) reasons.push('gatekeeper config declares no threadBinding');

  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    config: {
      transport: transport as GatekeeperTransportDescriptor,
      modelPolicy: modelPolicy as ModelPolicy,
      rateCards,
      budget: {
        warnAtMicroUsd: Number(budgetRaw['warnAtMicroUsd']),
        hardStopAtMicroUsd: Number(budgetRaw['hardStopAtMicroUsd']),
      },
      threadBinding: threadBinding as GovernanceThreadBinding,
      expectedDecider: expectedDecider as string,
      transportDecider,
    },
  };
}

/** Everything spent so far, as recorded on disk. An unreadable ledger reads as empty. */
/**
 * THE BUDGET DECISION AND THE RECORD OF IT ARE ONE ACT, OR THEY ARE NOTHING.
 *
 * `appendLedger` below is crash-safe: a complete temporary file is renamed over the target, so no
 * reader ever sees half a ledger. That closed a real defect (GK-SEC-001) and it is still right. What
 * it never gave was mutual exclusion, and a crash-safe read-modify-write is still a read-modify-write:
 * two processes that read the same ledger both compute the same "remaining budget", both conclude
 * they are under the hard stop, and both make a billed call. The later rename then overwrites the
 * earlier one and the first paid call disappears from the record entirely — so the month's total is
 * not merely wrong, it is wrong in the direction that admits yet more spending.
 *
 * The hard stop is documented as a refusal, not a warning: "Reaching it refuses further calls; it does
 * not merely warn." Under concurrency that was untrue, which is what C17-F1 found.
 *
 * SO ADMISSION IS SERIALISED, NOT JUST THE WRITE. Inside one lock acquisition this reads the ledger
 * FRESH — never a snapshot taken when the process started — totals it, asks `authoriseRequestSpend`,
 * and, if the answer is yes, writes a provisional entry carrying the ESTIMATE before releasing the
 * lock. A second process entering afterwards therefore sees the first call's cost already counted and
 * is refused by the same hard stop. Locking only the final append would leave both processes passing
 * the check and both paying.
 *
 * THE PROVISIONAL ENTRY IS THE RESERVATION. It carries the same `requestId` the real entry will carry,
 * so there is no separate reservation table to reconcile, and `settleGatekeeperSpend` REPLACES it once
 * the true cost is known. Replacement matters: `dedupeEntries` keeps the FIRST entry it sees for a
 * request id, so appending the real entry alongside the provisional one would leave the estimate
 * standing and silently discard the truth.
 *
 * A CRASH LEAVES THE ESTIMATE BEHIND, AND THAT IS THE SAFE DIRECTION. A process killed between
 * admission and settlement leaves a provisional entry counted at its estimate: the month reads
 * slightly high, and the next call is refused slightly early. The opposite failure — losing a call
 * that was actually paid for — is the one that lets spending run away.
 *
 * Added for C17-F1, reusing the lock discipline the installation degraded ledger already proved.
 */
function underCostLedgerLock<T>(sys: System, root: string, body: () => T, refused: (why: string) => T): T {
  const lock = join(root, ...GATEKEEPER_LEDGER_LOCK_REL.split('/'));
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) {
    // "Held" and "this directory cannot be written at all" arrive identically from `createExclusive`,
    // and they need different answers from an operator, so they are distinguished here.
    if (!sys.exists(lock)) {
      return refused(
        `the gatekeeper ledger directory could not be written (${GATEKEEPER_LEDGER_REL}), so no spend ` +
          'could be admitted and no call was made',
      );
    }
    return refused(
      'another ProjectOS process is deciding gatekeeper spend; nothing was admitted and no call was ' +
        `made. If no other run is in progress, ${GATEKEEPER_LEDGER_LOCK_REL} was left behind by one ` +
        'that died and must be removed.',
    );
  }
  try {
    return body();
  } finally {
    // A lock the OS refuses to delete is the everyday Windows case (an indexer holding a handle), and
    // silently treating it as released would make every later admission refuse with no explanation.
    if (!sys.removeFile(lock)) {
      sys.writeText(
        join(root, ...`${GATEKEEPER_LEDGER_LOCK_REL}.leaked`.split('/')),
        `the gatekeeper ledger lock could not be released at ${sys.now()}\n`,
      );
    }
  }
}

export interface SpendAdmission {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/**
 * Decide whether this call may be made, and record its estimate, without letting go of the lock in
 * between. Returns `allowed: false` when the hard stop refuses it, when another process holds the
 * lock, or when the ledger cannot be written — all three mean no call.
 */
export function admitGatekeeperSpend(
  sys: System,
  root: string,
  request: {
    readonly requestId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly model: string;
    readonly estimateMicroUsd: number;
    readonly at: string;
  },
  budget: BudgetPolicy,
  /**
   * What the INSTALLATION's own record says about this request, for the retry case only.
   *
   * Omitted means `unknown`, which refuses — see the branch below. That default is deliberate: a
   * caller that cannot consult the broker's record is a caller that does not know whether a reviewer
   * already answered, and the safe answer is not to ask again.
   */
  answered: () => BrokerAnsweredState = () => 'unknown',
): SpendAdmission {
  return underCostLedgerLock<SpendAdmission>(
    sys,
    root,
    () => {
      const fresh = readLedger(sys, root);
      // ALREADY PAID FOR IS NOT PAID FOR TWICE. A restarted run re-derives the same request id; if it
      // is already in the ledger the call was made, and admitting it again would both double-charge
      // and double-count.
      //
      // BUT A RESERVATION IS NOT A CALL (C11-W2-F6). Admission writes a provisional entry BEFORE the
      // call, so the ledger also holds questions that were started and never answered. Treating those
      // as "already asked" made one failed transport permanently bar that exact question — and because
      // the refusal happens before the gatekeeper is even attempted, it also withdrew the owner's
      // degraded-mode choice, which is the opposite of failing safe. An unresolved reservation is
      // therefore re-askable, and the entry below REPLACES it rather than joining it, so a retained
      // estimate is never counted twice.
      const prior = fresh.find((e) => e.requestId === request.requestId);
      // WHAT MAKES AN ENTRY A CALL RATHER THAN A RESERVATION IS RECORDED USAGE, not the local mark.
      //
      // The mark is this process's own note to itself and it can be missing for honest reasons: an
      // entry written before this correction existed carries none, and treating those as completed
      // calls would bar their questions for ever with no way back that is not a hand-edit. Usage is
      // the thing only a real answer produces. And the mark is not needed as a safety net here,
      // because the broker's record — consulted immediately below — is what actually decides whether
      // a reviewer answered.
      const settledHere = prior !== undefined && (prior.usage.inputTokens !== 0 || prior.usage.outputTokens !== 0);
      if (settledHere) {
        return { allowed: false, reasons: [`request ${request.requestId} is already in the ledger; it is not asked again`] };
      }
      // THE MARK IS NOT PROOF THE QUESTION WENT UNANSWERED (C11-W2-F7).
      //
      // It is cleared by settlement, and settlement can silently fail to take this lock. So an entry
      // still marked unresolved may be a call that was answered and whose settlement was lost — and
      // asking again would pay a second time for a question already decided, then apply a second
      // verdict over the first. The project ledger cannot tell those apart; the broker's own durable
      // record can, because it marks the row answered before it hands the reply back.
      if (prior !== undefined) {
        const state = answered();
        if (state !== 'not-answered') {
          return {
            allowed: false,
            reasons:
              state === 'answered'
                ? [
                    `request ${request.requestId} was already ANSWERED by the reviewer, according to the ` +
                      "installation's own record; it is not asked again",
                    '  the project ledger still shows it unresolved, so its settlement was lost — the decision ' +
                      'stands and the accounting needs reconciling, but nothing may be re-asked',
                  ]
                : [
                    `whether request ${request.requestId} was already answered could not be determined from the ` +
                      "installation's record, so it is not asked again",
                    '  not knowing whether a reviewer has answered is exactly the state in which asking twice ' +
                      'would charge twice and could apply a second, different verdict',
                  ],
          };
        }
      }
      const others = prior === undefined ? fresh : fresh.filter((e) => e.requestId !== request.requestId);
      const totals = summariseLedger(others, {
        projectId: request.projectId,
        phaseId: request.phaseId,
        month: request.at.slice(0, 7),
      });
      const spend = authoriseRequestSpend(request.estimateMicroUsd, totals, budget);
      if (!spend.allowed) return { allowed: false, reasons: spend.reasons };

      writeLedger(sys, root, [
        ...others,
        {
          requestId: request.requestId,
          projectId: request.projectId,
          phaseId: request.phaseId,
          model: request.model,
          usage: { inputTokens: 0, outputTokens: 0 },
          costMicroUsd: request.estimateMicroUsd,
          // MARKED THE MOMENT IT IS WRITTEN, not later when something notices the call failed.
          //
          // The first version of this correction marked the entry from a separate step that ran after
          // the transport returned. Anything that stopped the process reaching that step — a crash, a
          // kill, a timeout, or simply losing the ledger lock, which this file's own notes call an
          // everyday Windows occurrence — left a bare reservation behind, and the next admission
          // refused it exactly as before: no owner choices, no cause, degraded mode unreachable. The
          // defect was reproduced by its own fix. Settlement clears the flag by replacing the entry
          // wholesale with the real call, so what survives an interruption is always the truth: a
          // question that was started and never answered.
          unresolved: true,
          at: request.at,
        },
      ]);
      return { allowed: true, reasons: spend.reasons };
    },
    (why) => ({ allowed: false, reasons: [why] }),
  );
}

/**
 * Replace the provisional entry with what the call actually cost, or remove it if no call was made.
 *
 * Replacement, never append: `dedupeEntries` keeps the first entry per request id, so an appended
 * truth would sit behind the estimate and never be counted.
 */
export function settleGatekeeperSpend(
  sys: System,
  root: string,
  requestId: string,
  entry: LedgerEntry | null,
): void {
  underCostLedgerLock<void>(
    sys,
    root,
    () => {
      const fresh = readLedger(sys, root);
      const without = fresh.filter((e) => e.requestId !== requestId);
      writeLedger(sys, root, entry === null ? without : [...without, entry]);
    },
    () => undefined,
  );
}

/**
 * Causes that prove the request never left this process.
 *
 * Each of these is decided BEFORE anything is sent: no transport, an unusable or unapproved one, or a
 * credential that could not be resolved. Everything else — an unreachable route, a provider that
 * answered nothing, a spend refusal from the provider — may or may not have been dispatched, and is
 * treated as if it was.
 */
const NEVER_DISPATCHED: readonly string[] = [
  'TRANSPORT_NOT_CONFIGURED',
  'TRANSPORT_UNUSABLE',
  'TRANSPORT_NOT_APPROVED',
  'CREDENTIAL_UNAVAILABLE',
];

/**
 * Close out a reservation whose call produced no answer (C11-W2-F6).
 *
 * TWO OUTCOMES, AND THE DIFFERENCE IS WHETHER MONEY COULD HAVE BEEN SPENT.
 *
 * When the cause proves nothing was dispatched, the reservation is REMOVED. Leaving it would bill the
 * month for a call that never happened, and a phantom charge is not a conservative error — it spends
 * an owner's budget on nothing.
 *
 * When dispatch may have occurred, this does NOTHING and the reservation stands. Real spend must
 * never disappear because a reply was lost, so the cost stays counted; the mark admission already
 * wrote is what lets the question be put again, and the next admission replaces that entry rather
 * than adding a second one, so the retained estimate cannot be double-counted either. Doing nothing
 * in the common case is deliberate: a step that must run for the system to recover is a step whose
 * failure recreates the defect.
 */
export function resolveGatekeeperSpend(
  sys: System,
  root: string,
  requestId: string,
  cause: string,
  /**
   * What the INSTALLATION's own record says about this request, as admission asks it.
   *
   * REQUIRED BECAUSE THE CAUSE DESCRIBES THIS ATTEMPT, NOT THE ENTRY. A reservation can outlive the
   * attempt that made it: an earlier call may have been dispatched and failed uncertainly, its cost
   * conservatively retained, and only then the project removed from the allowlist. The next attempt's
   * cause would be a definite no-dispatch one, and releasing on that alone would erase spend that may
   * really have been incurred — the exact thing this function's own contract forbids. Omitted means
   * `unknown`, which retains.
   */
  answered: () => BrokerAnsweredState = () => 'unknown',
): void {
  underCostLedgerLock<void>(
    sys,
    root,
    () => {
      // NOTHING TO DO UNLESS THE CAUSE PROVES NOTHING WAS SENT. The reservation is already marked
      // unresolved by admission, so the retain case needs no write at all — which is what makes a
      // failure here harmless rather than a repeat of the defect.
      if (!NEVER_DISPATCHED.includes(cause)) return;
      // AND THE INSTALLATION MUST AGREE THAT NOTHING WAS ANSWERED. Retaining on `answered` or on
      // `unknown` keeps a real charge; releasing wrongly loses one. Only one of those is recoverable.
      if (answered() !== 'not-answered') return;
      const fresh = readLedger(sys, root);
      const entry = fresh.find((e) => e.requestId === requestId);
      // Only a reservation is ours to release, and what makes an entry a completed call is RECORDED
      // USAGE — the same rule admission uses, for the same reason. An entry written before the mark
      // existed carries none, and refusing to release it would leave a charge for a call this cause
      // proves was never sent, with no way to clear it that is not a hand-edit. There is no ambiguity
      // to be conservative about here: the cause reaching this point is one that means nothing was
      // dispatched, so nothing can have been answered.
      if (entry === undefined || entry.usage.inputTokens !== 0 || entry.usage.outputTokens !== 0) return;
      writeLedger(sys, root, fresh.filter((e) => e.requestId !== requestId));
    },
    () => undefined,
  );
}

/**
 * Release a reservation whose call this attempt is refusing before anything can be dispatched.
 *
 * WHY THIS IS SEPARATE FROM `resolveGatekeeperSpend`, AND NARROWER (C11-W2-F9). That function closes
 * out a call that was ATTEMPTED and produced no answer, so it cannot tell "never answered" from
 * "answered, and the settlement was lost" — which is why it defers to the installation's record and
 * retains whenever that record cannot be consulted. This one is used at a different moment: BEFORE
 * admission, when the installation's committed policy refuses to spend on this project at all. At
 * that point no call can be dispatched, the request is the same deterministic question this route is
 * declining, and the entry is a bare reservation carrying no usage. Requiring the broker's record
 * here achieved nothing except stranding the charge for a call nobody made, with no route to clear it
 * that was not a hand-edit.
 *
 * WHAT IT STILL WILL NOT DO. It never touches an entry carrying recorded usage — a call that
 * happened is not this function's to erase, in any circumstance. And it changes nothing about the
 * retry rule: an unresolved reservation is still only re-askable when the installation's record
 * positively says the question went unanswered.
 *
 * THE RESIDUAL, STATED PLAINLY. If a project were de-authorised AFTER a real call had been dispatched
 * but before its settlement landed, this would release that reservation and the month would lose an
 * estimate for spend that may really have occurred. That is a narrow window, it costs an estimate
 * rather than a governance decision, and the alternative — a phantom charge that can never be cleared
 * and a question that can never be asked again — was the worse failure in practice.
 */
export function releaseUndispatchedReservation(sys: System, root: string, requestId: string): void {
  underCostLedgerLock<void>(
    sys,
    root,
    () => {
      const fresh = readLedger(sys, root);
      const entry = fresh.find((e) => e.requestId === requestId);
      if (entry === undefined || entry.usage.inputTokens !== 0 || entry.usage.outputTokens !== 0) return;
      writeLedger(sys, root, fresh.filter((e) => e.requestId !== requestId));
    },
    () => undefined,
  );
}

export function readLedger(sys: System, root: string): readonly LedgerEntry[] {
  const raw = readJson(sys, join(root, ...GATEKEEPER_LEDGER_REL.split('/')));
  const entries = raw?.['entries'];
  return Array.isArray(entries) ? (entries as LedgerEntry[]) : [];
}

/**
 * Append one entry, keeping the file the durable record of spend.
 *
 * APPENDS RATHER THAN REWRITES, and never deduplicates on write. Deduplication is `summariseLedger`'s
 * job at read time, deliberately: a ledger that silently dropped a repeat would lose the evidence
 * that a repeat happened, which is exactly what a restart proof needs to show.
 */
export function appendLedger(sys: System, root: string, entry: LedgerEntry): void {
  writeLedger(sys, root, [...readLedger(sys, root), entry]);
}

/**
 * Write the whole ledger atomically. Extracted from `appendLedger` so the locked admission and
 * settlement paths reuse exactly the same crash-safe write rather than a second copy of it.
 */
function writeLedger(sys: System, root: string, entries: readonly LedgerEntry[]): void {
  const path = join(root, ...GATEKEEPER_LEDGER_REL.split('/'));
  const next = `${JSON.stringify({ schemaVersion: '1.0.0', entries }, null, 2)}\n`;

  // CRASH-SAFE, AND THE LOOP ITSELF FOUND THIS. The first version read the whole ledger and wrote it
  // back over the same path. A crash, a full disk or a killed process between the two left the file
  // truncated or half-written, and the record of what had already been spent was gone - which does
  // not merely lose an audit line, it re-opens the budget and lets a restart pay for a call already
  // made. Reported live by the gatekeeper as GK-SEC-001, HIGH, during the first real loop run.
  //
  // A complete temporary file in the SAME DIRECTORY is written first, then renamed over the target.
  // Rename within one filesystem is atomic: a reader sees either the old complete ledger or the new
  // complete ledger, never a partial one. Same directory matters - a rename across volumes is a copy,
  // and a copy is the non-atomic write this is replacing.
  const temporary = `${path}.tmp`;
  sys.writeText(temporary, next);
  const moved = sys.renameFile(temporary, path);
  if (!moved) {
    // The rename failed, so the temporary file is the only complete copy and the original is intact.
    // Falling back to a direct overwrite here would reintroduce exactly the window being closed.
    throw new Error(
      'the gatekeeper ledger could not be updated atomically; the previous ledger is unchanged and the ' +
        `pending entry is in ${GATEKEEPER_LEDGER_REL}.tmp`,
    );
  }
}

/** The provider's id for the last turn, so the next one continues the same conversation. */
export function readPreviousResponseId(sys: System, root: string): string | null {
  const raw = readJson(sys, join(root, ...GATEKEEPER_THREAD_REL.split('/')));
  const id = raw?.['previousResponseId'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

export function writePreviousResponseId(sys: System, root: string, id: string | null): void {
  if (id === null || id.trim() === '') return;
  const path = join(root, ...GATEKEEPER_THREAD_REL.split('/'));
  sys.writeText(path, JSON.stringify({ schemaVersion: '1.0.0', previousResponseId: id.trim() }, null, 2) + '\n');
}

/** Decision ids already acted on, derived from the ledger. A spent request is a spent decision. */
export function consumedDecisionIds(ledger: readonly LedgerEntry[]): readonly string[] {
  // AN UNANSWERED QUESTION CONSUMED NO DECISION. This list is what `checkGatekeeperDecision` refuses
  // a reply against, so including a reservation would refuse the very answer the retry was for: the
  // caller reads the ledger once at start-up, the retained entry is still in it, and the fresh,
  // paid-for decision then comes back as an "already acted on" replay. A decision id is consumed by a
  // decision, not by an attempt to obtain one.
  return ledger.filter((e) => e.unresolved !== true).map((e) => `GKDEC-${e.requestId}`);
}

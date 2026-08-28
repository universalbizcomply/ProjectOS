/**
 * `projectos plan` — the plan surface.
 *
 *   plan                       the execution plan: which worker owns each workflow step (read-only)
 *   plan draft --objective ..  submit an owner objective; generate a NON-AUTHORITATIVE draft
 *   plan drafts                list generated drafts (read-only)
 *   plan show --id <id>        show one generated draft in full (read-only)
 *
 * The bare `plan` behaviour is unchanged, so nothing that already depended on it moves.
 *
 * `plan draft` is the F3 bootstrap: before it, ProjectOS could refuse an unapproved phase but could
 * not accept a new objective at all, so no new work could ever be authorised. It creates a proposal
 * and nothing else — no phase, no approval, no execution authority. Every guarantee it relies on
 * lives in `planIntake.ts` and in the canonical discovery engine; this file only renders.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import {
  planWorkflow,
  DEFAULT_WORKERS,
  estimateCostMicroUsd,
  estimateInputTokensFromBytes,
  modelForAsk,
  recordCall,
  PLAN_AUTHORING_ASK,
} from '@projectos/core';
import { submitObjective, listDrafts, checkDraftBinding, type DraftRecord, type SubmitOptions } from '../planIntake.js';
import { buildAuthoringAttemptEvidence, writeAuthoringAttemptEvidence } from '../authoringEvidence.js';
import { brokeredAuthorPort, type AuthorPort } from '../planAuthoring.js';
import { checkPlanAuthoringPermission } from '../planAuthoringPermission.js';
import { approvePlan, FILENAME_ID } from '../planApproval.js';
import {
  writePlanApprovalDecision,
  makeDecisionDurable,
  PLAN_DECISIONS,
  type PlanDecision,
} from '../planDecision.js';
import { loadGovernedContext } from '../governedContext.js';
import {
  loadGatekeeperConfig,
  admitGatekeeperSpend,
  settleGatekeeperSpend,
  releaseUndispatchedReservation,
} from '../loop/gatekeeperConfig.js';
import { nodeBrokeredTransport } from '../loop/transports/brokeredHttpPort.js';
import { installationAllowsProject } from '../installation/projectAllowlist.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';

function workflowPlan(): CommandResult {
  const planned = planWorkflow(DEFAULT_WORKERS);
  const lines = ['Execution plan (default workers):'];
  for (const p of planned) {
    const who = p.worker ? p.worker.displayName : '(unassigned)';
    const gate = p.gated ? '  [owner-gated]' : '';
    lines.push(`  ${p.step.id.padEnd(10)} ${p.role.padEnd(11)} ${who}${gate}`);
  }
  return ok(lines);
}

/** The one sentence that must never be ambiguous: a draft is a proposal. */
function authorityFooter(): readonly string[] {
  return [
    '',
    'This is a PROPOSAL, not an approved plan.',
    'It authorises nothing. No phase may start until an owner approves it.',
  ];
}

/**
 * Show at most a handful of ids and say how many were withheld.
 *
 * Not cosmetic. The first real submission against this repository produced 5,891 conflicts and the
 * unbounded version printed every id — 135KB of terminal output in which the actual status was
 * invisible. A summary that cannot be read is not a summary; the full set is in the draft record.
 */
function preview(ids: readonly string[], limit = 5): string {
  if (ids.length === 0) return 'none';
  if (ids.length <= limit) return ids.join(', ');
  return `${ids.slice(0, limit).join(', ')} … and ${ids.length - limit} more (see the draft record)`;
}

function renderDraftSummary(d: DraftRecord): readonly string[] {
  const draft = d.draft as Record<string, unknown>;
  const phases = Array.isArray(draft['phaseCandidates']) ? (draft['phaseCandidates'] as unknown[]) : [];
  const unknowns = Array.isArray(draft['unresolvedUnknowns'])
    ? (draft['unresolvedUnknowns'] as readonly string[])
    : [];
  return [
    `  status:              ${d.planStatus}`,
    `  authoritative:       ${String(d.authoritative)}`,
    // The exact thing an approval is taken against. Printed so the approver can quote it.
    `  plan digest:         ${d.planDigest ?? '(not recorded — regenerate this draft)'}`,
    `  project:             ${d.projectId}${d.repository === '' ? '' : ` (${d.repository})`}`,
    `  branch / base:       ${d.branch} @ ${d.baseHead.slice(0, 12)}`,
    `  sources considered:  ${d.discovery.sourcesConsidered} (${d.discovery.sourcesSkipped} skipped${d.discovery.truncated ? ', TRUNCATED' : ''})`,
    // Narrowing what may SHAPE the plan must never look like hiding what was FOUND.
    `  planning corpus:     ${(d.planningCorpus?.counts?.['CURRENT_PLANNING'] ?? 0)} current planning · ` +
      `${(d.planningCorpus?.counts?.['SUPPORTING_CONTEXT'] ?? 0)} supporting context · ` +
      `${(d.planningCorpus?.counts?.['HISTORICAL_EVIDENCE'] ?? 0)} historical evidence · ` +
      `${(d.planningCorpus?.counts?.['QUARANTINED'] ?? 0)} quarantined`,
    ...(d.planningCorpus?.currentPlanningSources ?? []).map((p, i) => `${i === 0 ? '  plan sources:        ' : '                       '}${p}`),
    `  phase candidates:    ${phases.length}`,
    `  conflicts:           ${d.conflicts.length}`,
    `  unknowns:            ${preview(unknowns)}`,
    `  owner decisions:     ${d.ownerDecisionsRequired.length} — ${preview(d.ownerDecisionsRequired, 3)}`,
    `  provenance errors:   ${d.provenanceErrors.length}`,
    ...(d.discovery.instructionShapedSources.length === 0
      ? []
      : [
          `  instruction-shaped sources (flagged, NOT obeyed): ${d.discovery.instructionShapedSources.length} — ${preview(d.discovery.instructionShapedSources, 3)}`,
        ]),
  ];
}

/**
 * Where authoring spend is counted, in the ledger column keyed by phase.
 *
 * THE SAME KEY THE TRUSTED SIDE USES, AND THE `@` IS LOAD-BEARING IN BOTH. Phase ids are
 * `[A-Za-z0-9_-]`, so no real phase can produce this string: authoring cannot quietly consume a
 * phase's gatekeeper budget and a phase cannot consume authoring's. Two ledgers count this call —
 * the project's, in money, and the installation's, in calls — and they agree on the key.
 */
const AUTHORING_LEDGER_PHASE = '@plan-authoring';

/**
 * What one authored plan is assumed to cost, in output tokens, for the pre-dispatch estimate.
 *
 * Larger than the gatekeeper's 800 because the artefacts are different sizes: a decision is a verdict
 * and a paragraph, a plan is a set of phases with scope, environments and success criteria. The
 * estimate exists to be a real bound before the money is gone; the ledger is settled afterwards on
 * what the provider actually reports.
 */
const AUTHORING_OUTPUT_TOKEN_ESTIMATE = 2000;

/**
 * Compose the objective-led author, or say why there is none.
 *
 * THERE IS DELIBERATELY NO FALLBACK. Returning no author makes `plan draft --authored` refuse; the
 * one thing it must never do is quietly run corpus import instead, because a bounded objective
 * silently answered by the existing corpus is exactly the defect the authoring phase corrected.
 *
 * THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS, AND THERE IS NO RESOLVER HERE TO CHANGE THAT.
 * `openAiAuthorPort` exists and takes one; the live composition does not use it. The trusted broker
 * validates the installation allowlist and the project's committed authoring permission itself,
 * resolves the value inside its own process, makes the call, and returns a status and a body — so
 * there is no in-process value even to leak, which is the same argument `commands/run.ts` makes for
 * the gatekeeper and for the same reason: generated agent code running against an untrusted project
 * should not be holding the installation owner's key.
 *
 * EVERY REFUSAL IS NAMED IN TERMS THE OWNER CAN ACT ON. "No author is composed" told an operator
 * nothing; a missing permission, an unconfigured gatekeeper, an unpriced model and an unauthorised
 * project are four different problems with four different fixes.
 */
function composeAuthor(ctx: CommandContext): { readonly author?: AuthorPort; readonly reason: string } {
  const governed = loadGovernedContext(ctx.sys, ctx.root);
  if (!governed.ok) {
    return { reason: 'this checkout is not a governed ProjectOS project, so nothing can be authored for it' };
  }
  const projectId = governed.context.projectId;

  // WHICH MODEL, AT WHAT PRICE, UNDER WHOSE CEILING. All three come from the project's committed
  // gatekeeper configuration — the same one the reviewer is priced by — because authoring and review
  // spend the same credential out of the same budget and must not be governed by two different files.
  // NO DECIDER IS RESOLVED, because authoring takes no decision. Asking for one refused projects that
  // had never configured a gatekeeper REVIEW delegation — true, fail-closed, and about something the
  // owner was not doing. Everything else in that file still applies: authoring and review spend the
  // same credential out of the same budget, so they must be priced by the same configuration.
  const gk = loadGatekeeperConfig(ctx.sys, ctx.root, 'not-needed');
  if (!gk.ok) {
    return {
      reason:
        'authoring is priced by this project\'s gatekeeper configuration, and it could not be used: ' +
        gk.reasons.join('; '),
    };
  }
  const config = gk.config;
  const credentialRef = config.transport.credentialRef ?? '';
  const model = modelForAsk(PLAN_AUTHORING_ASK, config.modelPolicy);
  const rate = config.rateCards[model];
  if (rate === undefined) {
    return {
      reason: `no rate card is configured for model '${model}', so the cost of an authoring call cannot be established; a call whose price is unknown is not made`,
    };
  }

  const runtime = nodeProjectosRuntime();
  const stateDir = nodeInstallationStateDir();

  const author = brokeredAuthorPort(
    { model, credentialRef, projectId, governedRoot: ctx.root },
    {
      transport: nodeBrokeredTransport(ctx.sys, runtime),
      // THE SAME TWO COMMITTED FACTORS THE BROKER ENFORCES, ASKED ON THIS SIDE.
      //
      // Not a substitute for the trusted check — that one is the control, and it runs whatever this
      // says. This exists so that a refusal is knowably a call that was NEVER MADE: the broker reports
      // a pre-dispatch refusal down the same channel as a mid-flight failure, and a caller that cannot
      // tell them apart has to bill conservatively for a call nobody made.
      permitted: () => {
        const allow = installationAllowsProject(ctx.sys, runtime, ctx.root, projectId);
        if (!allow.allowed) {
          return {
            allowed: false,
            reasons: [
              'this ProjectOS installation does not authorise the governed project to spend its credential, so no authoring request was made',
              ...allow.reasons,
            ],
          };
        }
        const permission = checkPlanAuthoringPermission(ctx.sys, ctx.root, { projectId, credentialRef });
        return permission.allowed
          ? { allowed: true, reasons: [] }
          : { allowed: false, reasons: permission.reasons };
      },
      // The body's own UTF-8 bytes, through the one conservative estimator. It used to divide the
      // string's UTF-16 LENGTH by four, which under-reserved the only real authoring call by 24.9%.
      estimateMicroUsd: (inputBytes) =>
        estimateCostMicroUsd(
          { inputTokens: estimateInputTokensFromBytes(inputBytes), outputTokens: AUTHORING_OUTPUT_TOKEN_ESTIMATE },
          rate,
        ),
      admitSpend: (request) =>
        admitGatekeeperSpend(
          ctx.sys,
          ctx.root,
          {
            requestId: request.requestId,
            projectId,
            phaseId: AUTHORING_LEDGER_PHASE,
            model,
            estimateMicroUsd: request.estimateMicroUsd,
            at: ctx.sys.now(),
          },
          config.budget,
          () =>
            readBrokerAnsweredState(ctx.sys, stateDir, {
              requestId: request.requestId,
              projectId,
              phaseId: AUTHORING_LEDGER_PHASE,
            }),
        ),
      settleSpend: (requestId, usage) => {
        // THE ENTRY IS BUILT ONCE AND REPORTED BACK. The attempt record has to state what the call
        // actually cost, and the only place that number exists is the ledger entry being written.
        const entry = recordCall({
          requestId,
          projectId,
          phaseId: AUTHORING_LEDGER_PHASE,
          usage,
          rate,
          at: ctx.sys.now(),
        });
        settleGatekeeperSpend(ctx.sys, ctx.root, requestId, entry);
        return entry.costMicroUsd;
      },
      now: () => ctx.sys.now(),
      // A PAID REPLY THAT FAILS A CHECK IS KEPT. Written into the governed project itself, beside
      // the other evidence, because that is where the owner already looks for what a phase produced.
      recordAttempt: (input) =>
        writeAuthoringAttemptEvidence(ctx.sys, ctx.root, buildAuthoringAttemptEvidence(input)),
      releaseUndispatched: (requestId) => releaseUndispatchedReservation(ctx.sys, ctx.root, requestId),
    },
  );

  return { author, reason: '' };
}

function draft(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const raw = flags['objective'];
  // DEFAULT UNCHANGED. `plan draft` stays corpus-led import so no existing behaviour regresses;
  // objective-led authoring is opted into explicitly.
  //
  // TWO CALLERS, TWO SPELLINGS OF THE SAME REQUEST. The CLI's flag parser yields boolean `true` for
  // a bare `--authored`; the governed channel carries typed STRING arguments and can only say
  // `'true'`. Reading only the boolean is why the Control Centre could never author: it sent the
  // request and this line silently declined it, so "Start Something New" ran import and made no
  // provider call at all. Both spellings are the same intent and both are read.
  const wantsAuthoring = flags['authored'] === true || flags['authored'] === 'true';
  let options: SubmitOptions | undefined;
  if (wantsAuthoring) {
    const composed = composeAuthor(ctx);
    if (composed.author === undefined) {
      return fail(1, [`REFUSED (AUTHOR_NOT_COMPOSED): ${composed.reason}`]);
    }
    options = { mode: 'authored', author: composed.author };
  }
  const result = submitObjective(ctx.sys, ctx.root, typeof raw === 'string' ? raw : undefined, undefined, options);
  if (!result.ok) {
    return fail(1, [`REFUSED (${result.code}): ${result.detail}`]);
  }
  const { objective, draftRecord, objectivePath, draftPath } = result;
  return ok([
    draftRecord.origin === 'authored'
      ? 'Objective received. ProjectOS authored a draft plan from it.'
      : 'Objective received. ProjectOS generated a draft plan by importing this repository.',
    '',
    `  origin:              ${draftRecord.origin ?? 'import'}`,
    `  objective id:        ${objective.objectiveId}`,
    ...renderDraftSummary(draftRecord),
    '',
    `  objective record:    ${objectivePath}`,
    `  draft record:        ${draftPath}`,
    ...(objective.instructionShaped
      ? ['', '  NOTE: the objective text contains instruction-shaped content. It was stored as data', '        and flagged. It confers no authority.']
      : []),
    ...authorityFooter(),
  ]);
}

function drafts(ctx: CommandContext): CommandResult {
  const all = listDrafts(ctx.sys, ctx.root);
  if (all.length === 0) {
    return ok(['No drafts. Submit an objective with: projectos plan draft --objective "..."']);
  }
  const lines = [`${all.length} draft(s), newest first:`];
  for (const d of all) {
    lines.push(`  ${d.objectiveId}  ${d.planStatus.padEnd(24)} ${d.generatedAt}`);
  }
  return ok([...lines, ...authorityFooter()]);
}

function show(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const id = typeof flags['id'] === 'string' ? flags['id'] : '';
  const all = listDrafts(ctx.sys, ctx.root);
  const found = id === '' ? all[0] : all.find((d) => d.objectiveId === id);
  if (found === undefined) {
    return fail(1, [id === '' ? 'No drafts to show.' : `No draft with id '${id}'.`]);
  }
  // Re-verify the binding against the repository AS IT IS NOW, rather than reporting what the
  // draft claims about itself. A draft is a file: it can be copied between checkouts, and the
  // commit it was generated against moves on. Showing a stale or foreign draft without saying so
  // is how a proposal for one project gets read as a proposal for another.
  const head = ctx.sys.exec('git', ['rev-parse', 'HEAD']);
  const cfgText = ctx.sys.readText(`${ctx.root}/.projectops/project-config.json`);
  let binding: readonly string[] = [];
  if (head.code === 0 && cfgText !== null) {
    try {
      const cfg = JSON.parse(cfgText) as Record<string, unknown>;
      binding = checkDraftBinding(found, {
        projectId: typeof cfg['projectId'] === 'string' ? cfg['projectId'] : '',
        repository: typeof cfg['repo'] === 'string' ? cfg['repo'] : '',
        head: head.stdout.trim(),
      });
    } catch {
      binding = ['could not read the current project config to verify this draft against'];
    }
  } else {
    binding = ['could not establish the current project identity or commit to verify this draft against'];
  }

  return ok([
    `Draft ${found.objectiveId}`,
    ...renderDraftSummary(found),
    '',
    `  next step:           ${found.nextStep}`,
    '',
    ...(binding.length === 0
      ? ['  binding:             still matches this project, repository and commit']
      : ['  binding PROBLEMS — this draft does not match the repository as it is now:', ...binding.map((p) => `    - ${p}`)]),
    ...authorityFooter(),
  ]);
}

/**
 * `plan approve` — the only route to an approved plan, and therefore to execution authority.
 *
 * It decides nothing. It checks that someone the owner named has decided, in a committed record,
 * about exactly this plan material, and then materialises the plan and lets the existing evaluator
 * rule on readiness. Every refusal names what is missing.
 */
/**
 * `plan activate` — the owner-workflow wrapper around `plan approve`.
 *
 * WHY THIS EXISTS RATHER THAN CALLING `plan approve` DIRECTLY. The low-level command defaults its
 * destination to `.projectops/plan.json`, which is right for a manual operator naming their own
 * paths and wrong for a button. `approvePlan` refuses to overwrite an existing record — correctly,
 * since an activated plan is an immutable one — so a fixed filename makes activation work exactly
 * once per project and then refuse forever. Every activation needs a destination of its own.
 *
 * IT DERIVES, IT DOES NOT DECIDE. The four values below are mechanical consequences of the draft id
 * and of the currently active plan. None of them is accepted from a caller, and this function
 * performs no authority check of its own: it hands everything to `approvePlan`, which remains the
 * only thing that verifies delegation, decision, digest, decider and readiness.
 */
function activate(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const s = (k: string): string => (typeof flags[k] === 'string' ? (flags[k] as string) : '');
  const draftId = s('id');
  const decisionId = s('decision');
  if (draftId === '') return fail(1, ['`plan activate` requires --id <draftId> (see `plan drafts`)']);
  if (decisionId === '') return fail(1, ['`plan activate` requires --decision <decisionId>']);

  // BEFORE THE ID BECOMES PART OF A PATH. `approvePlan` validates both ids too, but it does so after
  // this function has already interpolated the draft id into a filename — too late to matter here.
  // Same pattern, imported rather than restated, so the two cannot diverge.
  if (!FILENAME_ID.test(draftId)) {
    return fail(2, [
      'REFUSED (UNSAFE_TARGET_PATH): the draft id is not a plain identifier.',
      '  - letters, digits, underscore and hyphen only',
      '',
      'Nothing was written.',
    ]);
  }

  // THE PROGRAMME IS THE ONE ALREADY IN FORCE, read from the active approved plan through the
  // trusted config route — never invented and never accepted from the caller. Closure delegation is
  // programme-scoped, so a fabricated programme id would silently invalidate the committed closure
  // delegation and produce a plan nobody can close. Starting a NEW programme is a governance act,
  // not a side effect of pressing Activate.
  const governed = loadGovernedContext(ctx.sys, ctx.root);
  if (!governed.ok) {
    return fail(2, [
      `REFUSED (${governed.code}): the active approved plan could not be read.`,
      `  - ${governed.detail}`,
      '',
      'Nothing was written.',
    ]);
  }
  //
  // THE CHECK BELOW IS NARROWING, NOT THE DEFENCE. `plan['programmeId']` is typed `unknown`, so it
  // has to be narrowed before it can be passed on. It is not what stops a plan without a programme:
  // `programmeId` is `required` with `minLength: 1` in the plan schema, and `loadGovernedContext`
  // validates against that schema and refuses with `PLAN_SCHEMA_INVALID` before it ever returns a
  // context. A plan missing one is therefore already refused above. This branch is kept because the
  // narrowing is needed anyway and a silent `undefined` reaching `approvePlan` would be worse than a
  // redundant refusal — but it is belt-and-braces, and describing it as the guarantee would be a
  // claim the code does not earn.
  const activeProgramme = governed.context.plan['programmeId'];
  if (typeof activeProgramme !== 'string' || activeProgramme.trim() === '') {
    return fail(2, [
      'REFUSED (NO_ACTIVE_PROGRAMME): the active approved plan declares no programmeId.',
      '  - an activation joins the programme already in force; it does not start one',
      '',
      'Nothing was written.',
    ]);
  }

  // A NEW PLAN IS A NEW RECORD — AND AN AMENDMENT IS A NEW PLAN.
  //
  // The record used to be named from the draft alone. A draft id is `sha256(projectId + objective)`,
  // so the SAME objective always produces the SAME id — which is correct for an objective, and wrong
  // for a record. An AMENDMENT is by definition a second activation of the same objective, so the
  // derived path was always the record already in force, and the overwrite guard refused it. That
  // guard was right; the name was not. The consequence was absolute: once a plan had been activated,
  // no amendment to it could ever be activated, and the owner's only way out was to invent a
  // filename by hand — which is a governance decision disguised as a naming convention.
  //
  // So identity is the objective AND the plan material approved for it. Same objective, different
  // approved digest, different record. The digest is the one the draft records, sliced with the same
  // 12-hex convention the refusal messages already use; `approvePlan` independently recomputes the
  // plan material and refuses with DRAFT_SUPERSEDED if the stored digest is not what this repository
  // now proposes, so a stale digest can only ever cost a refusal, never a wrong write.
  //
  // Replaying the SAME digest is not a new record and must not become one: it derives the same name,
  // that file already exists, and the existing overwrite protection refuses it — fail-closed, with
  // the spent-decision check behind it. Nothing here relaxes either.
  const draftRecord = listDrafts(ctx.sys, ctx.root).find((d) => d.objectiveId === draftId);
  if (draftRecord === undefined) {
    return fail(2, [
      'REFUSED (NO_DRAFT): this draft was not activated.',
      `  - no draft '${draftId}' — generate one with \`plan draft\``,
      '',
      'Nothing was written. No plan, no state, no activation.',
    ]);
  }
  // FAIL CLOSED ON A MISSING DIGEST. Falling back to the draft-only name would quietly restore the
  // collision this exists to end, and would aim an amendment at the active record again.
  if (typeof draftRecord.planDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(draftRecord.planDigest)) {
    return fail(2, [
      'REFUSED (DRAFT_SUPERSEDED): this draft was not activated.',
      `  - draft '${draftId}' records no usable plan digest, so no record identity can be derived from it`,
      '  - regenerate the draft with `plan draft` and obtain a decision on the new one',
      '',
      'Nothing was written. No plan, no state, no activation.',
    ]);
  }
  const recordId = `${draftId}-${draftRecord.planDigest.slice(7, 19)}`;
  const result = approvePlan(ctx.sys, ctx.root, {
    draftId,
    decisionId,
    planRelPath: `.projectops/plan-${recordId}.json`,
    stateRelPath: `.projectops/current-state-${recordId}.json`,
    planId: `plan-${recordId}`,
    programmeId: activeProgramme,
  });

  if (!result.ok) {
    return fail(2, [
      `REFUSED (${result.code}): this draft was not activated.`,
      ...result.problems.map((p) => `  - ${p}`),
      '',
      'Nothing was written. No plan, no state, no activation.',
    ]);
  }
  return ok([
    'Plan ACTIVATED.',
    '',
    `  plan id:        ${result.planId}`,
    `  programme:      ${activeProgramme}`,
    `  phases:         ${result.phaseCount}`,
    `  plan digest:    ${result.planDigest}`,
    `  decision:       ${result.decisionId} (now consumed; it cannot approve anything again)`,
    `  plan record:    ${result.planPath}`,
    `  current state:  ${result.statePath}`,
    '',
    'PLAN READY was recomputed by the plan evaluator, not copied from the record.',
    'The previously active plan record was not modified.',
  ]);
}

function approve(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const s = (k: string): string => (typeof flags[k] === 'string' ? (flags[k] as string) : '');
  const draftId = s('id');
  const decisionId = s('decision');
  if (draftId === '') return fail(1, ['`plan approve` requires --id <draftId> (see `plan drafts`)']);
  if (decisionId === '') return fail(1, ['`plan approve` requires --decision <decisionId>']);

  // THE PROGRAMME DECIDES WHICH DELEGATION APPLIES, SO THE CALLER MAY NOT CHOOSE IT.
  //
  // A plan-approval delegation now applies only to the programme it names, and `programmeId` is the
  // value that check compares against. While this arrived as a bare `--programme-id` flag, anyone
  // could re-point the comparison at whatever a stale delegation happened to say and have that
  // retired authority accepted for a different programme — reproducing the exact defect the scope
  // check exists to close, through a supported command. The same flag also gates the closure
  // delegation, so it could carry a retired closure authority into the new plan as well.
  //
  // So where a plan is already in force, the programme is read from it through the trusted config
  // route, exactly as `plan activate` does. A caller may still PASS the flag, but only to say the
  // same thing: a disagreement is refused rather than silently preferred either way. Where no plan is
  // in force this is a project's FIRST plan, there is no programme yet and no earlier delegation that
  // could be stale, so the flag remains the only available source.
  const governedForProgramme = loadGovernedContext(ctx.sys, ctx.root);
  const declaredProgramme = s('programme-id');
  let programmeId = declaredProgramme;
  let startsNewProgramme = false;
  if (governedForProgramme.ok) {
    const activeProgramme = governedForProgramme.context.plan['programmeId'];
    if (typeof activeProgramme === 'string' && activeProgramme.trim() !== '') {
      // CONTINUING the programme in force is the default, and the caller does not get to name it.
      // DECLARING a different one starts a new programme, which is the owner's act: no delegation
      // applies to it, so naming a programme can never be the thing that decides which delegation
      // applies. That is what closes the bypass, and it leaves starting a programme possible.
      programmeId = declaredProgramme === '' ? activeProgramme : declaredProgramme;
      startsNewProgramme = declaredProgramme !== '' && declaredProgramme !== activeProgramme;
    }
  }
  if (programmeId === '') programmeId = 'programme';

  const result = approvePlan(ctx.sys, ctx.root, {
    draftId,
    decisionId,
    // THE DESTINATION, NOT THE CURRENT PLAN. `planMemory.planPath` names the plan in force NOW;
    // these name where the newly activated one is written, and `approvePlan` repoints planMemory at
    // them afterwards. Deriving these from planMemory would aim the approval at the active record,
    // which the engine refuses outright — and rightly, since it would overwrite the plan whose owner
    // it just read. So they stay a convention a project may override with --plan-path/--state-path.
    planRelPath: s('plan-path') || '.projectops/plan.json',
    stateRelPath: s('state-path') || '.projectops/current-state.json',
    planId: s('plan-id') || 'plan',
    programmeId,
    startsNewProgramme,
  });

  if (!result.ok) {
    return fail(2, [
      `REFUSED (${result.code}): this draft was not approved.`,
      ...result.problems.map((p) => `  - ${p}`),
      '',
      'Nothing was written. No plan, no state, no activation.',
    ]);
  }
  return ok([
    'Plan APPROVED and activated.',
    '',
    `  plan id:        ${result.planId}`,
    `  phases:         ${result.phaseCount}`,
    `  plan digest:    ${result.planDigest}`,
    `  decision:       ${result.decisionId} (now consumed; it cannot approve anything again)`,
    `  plan record:    ${result.planPath}`,
    `  current state:  ${result.statePath}`,
    '',
    'PLAN READY was recomputed by the plan evaluator, not copied from the record.',
    'The previously active plan record was not modified.',
  ]);
}


/**
 * `plan decide` — the owner's answer to a proposal, recorded and made durable.
 *
 * WHAT THE CALLER MAY SAY: which draft, approve or reject, and optionally why. Nothing else. Every
 * field that carries authority is derived by `writePlanApprovalDecision` from committed records and
 * from the repository; there is no flag here for the project, the digest, the base commit, the
 * decider or the output path, and adding one would be the defect rather than a convenience.
 *
 * TWO STEPS, NOT ONE, AND BOTH REPORTED. Writing the record is ProjectOS transcribing an answer.
 * Committing it is that answer entering the history the whole authority model rests on — under
 * `tamperProof: false` the commit IS what makes a forged decision a visible diff. They are separated
 * here so that a commit failure (a hook, a lock, an unwritable index) is reported as what it is: the
 * decision exists on disk and does not yet count.
 *
 * IT DOES NOT ACTIVATE ANYTHING. A recorded approval is an input to `plan activate`, which still
 * recomputes the plan material, re-checks the digest, the binding, the delegation, the decider and
 * plan readiness. A rejection activates nothing by construction: `checkPlanApprovalDecision` refuses
 * any record whose `decision` is not `approve`.
 */
function decide(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const s = (k: string): string => (typeof flags[k] === 'string' ? (flags[k] as string) : '');
  const draftId = s('id');
  const verdict = s('decision');
  const note = s('note');

  if (draftId === '') return fail(1, ['`plan decide` requires --id <draftId> (see `plan drafts`)']);
  if (!(PLAN_DECISIONS as readonly string[]).includes(verdict)) {
    return fail(1, [`\`plan decide\` requires --decision ${PLAN_DECISIONS.join('|')}`]);
  }

  const written = writePlanApprovalDecision(ctx.sys, ctx.root, {
    draftId,
    decision: verdict as PlanDecision,
    ...(note === '' ? {} : { note }),
  });
  if (!written.ok) {
    return fail(2, [
      `REFUSED (${written.code}): no decision was recorded.`,
      ...written.problems.map((p) => `  - ${p}`),
      '',
      'Nothing was written.',
    ]);
  }

  const durable = makeDecisionDurable(ctx.sys, ctx.root, written.decisionId);
  if (!durable.ok) {
    return fail(2, [
      `REFUSED (${durable.code}): the decision was written but is NOT yet durable, so it does not count.`,
      ...durable.problems.map((p) => `  - ${p}`),
      '',
      `  record:  ${written.relPath}`,
      '  a decision counts only once it is committed; nothing was activated.',
    ]);
  }

  return ok([
    verdict === 'approve'
      ? `${written.decidedBy} approved this plan.`
      : `${written.decidedBy} rejected this plan.`,
    '',
    `  decision:      ${written.decisionId}`,
    `  proposal:      ${draftId}`,
    `  plan material: ${written.planDigest.slice(7, 19)}`,
    `  recorded at:   ${durable.commit.slice(0, 12)} (on ${written.branch})`,
    `  record:        ${written.relPath}`,
    '',
    ...(verdict === 'approve'
      ? [
          'This decision approves exactly the plan material above. It activates nothing by itself:',
          `  projectos plan activate --id ${draftId} --decision ${written.decisionId}`,
        ]
      : [
          'This proposal will not be activated. It stays on record, with this decision beside it.',
          'To propose something different, submit a new objective.',
        ]),
  ]);
}

export function plan(
  ctx: CommandContext,
  flags: Record<string, string | boolean> = {},
  positionals: readonly string[] = [],
): CommandResult {
  const sub = positionals[0] ?? '';
  switch (sub) {
    case '':
      return workflowPlan();
    case 'draft':
      return draft(ctx, flags);
    case 'drafts':
      return drafts(ctx);
    case 'show':
      return show(ctx, flags);
    case 'decide':
      return decide(ctx, flags);
    case 'approve':
      return approve(ctx, flags);
    case 'activate':
      return activate(ctx, flags);
    default:
      return fail(1, [
        `Unknown 'plan' subcommand: ${sub}`,
        '',
        'Usage:',
        '  plan                          show the execution plan (worker per step)',
        '  plan draft --objective "..."  submit an objective; generate a draft proposal',
        '  plan drafts                   list generated drafts',
        '  plan show [--id <id>]         show a generated draft',
        '  plan decide --id <draftId> --decision approve|reject [--note "..."]',
        '                                record the owner decision on a proposal and commit it',
        '  plan approve --id <draftId> --decision <decisionId>',
        '                                low-level: activate to explicit --plan-path/--state-path',
        '  plan activate --id <draftId> --decision <decisionId>',
        '                                activate the plan a committed decision approved,',
        '                                deriving new record paths and keeping the programme',
      ]);
  }
}

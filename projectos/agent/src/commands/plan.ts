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
import { planWorkflow, DEFAULT_WORKERS } from '@projectos/core';
import { submitObjective, listDrafts, checkDraftBinding, type DraftRecord } from '../planIntake.js';
import { approvePlan, FILENAME_ID } from '../planApproval.js';
import { loadGovernedContext } from '../governedContext.js';

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

function draft(ctx: CommandContext, flags: Record<string, string | boolean>): CommandResult {
  const raw = flags['objective'];
  const result = submitObjective(ctx.sys, ctx.root, typeof raw === 'string' ? raw : undefined);
  if (!result.ok) {
    return fail(1, [`REFUSED (${result.code}): ${result.detail}`]);
  }
  const { objective, draftRecord, objectivePath, draftPath } = result;
  return ok([
    'Objective received. ProjectOS generated a draft plan.',
    '',
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

  // A NEW PLAN IS A NEW RECORD. Named from the draft so two activations in the same programme
  // cannot collide, and so the previous plan keeps its own file rather than being written over.
  const result = approvePlan(ctx.sys, ctx.root, {
    draftId,
    decisionId,
    planRelPath: `.projectops/plan-${draftId}.json`,
    stateRelPath: `.projectops/current-state-${draftId}.json`,
    planId: `plan-${draftId}`,
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
        '  plan approve --id <draftId> --decision <decisionId>',
        '                                low-level: activate to explicit --plan-path/--state-path',
        '  plan activate --id <draftId> --decision <decisionId>',
        '                                activate the plan a committed decision approved,',
        '                                deriving new record paths and keeping the programme',
      ]);
  }
}

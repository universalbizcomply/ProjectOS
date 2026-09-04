/**
 * THE PROJECTS LIST — what ProjectOS can honestly say about every installed project.
 *
 * WHAT THIS MODEL EXISTS TO PREVENT. The accepted specification draws a row per project carrying a
 * status, an active plan, a current step and whether a decision is waiting. ProjectOS cannot serve
 * that today and this model says so in its types rather than inventing it: the daemon reports ONE
 * governed projection at a time, for the SELECTED project only, and the installed-project inventory
 * carries a name, a root and a repository identity — no status, no plan, no phase, no decision.
 *
 * So a row is one of exactly two things, and the difference is visible in the shape:
 *
 *   `live: true`  — this is the selected project, and every field is read from its real projection.
 *   `live: false` — every other project. Name and repository only, with `Open to see` as the
 *                   honest answer to "what is happening here?".
 *
 * The alternative — selecting each project in turn to fill the list — would issue a governed
 * `project.select` per row on every render of a screen the owner merely looked at, and would make
 * the list's own display change what the runtime is pointed at. A list must not have side effects.
 *
 * Pure: same inventory and same projection in, same rows out. No clock, no I/O, no randomness.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { PortfolioMessage, ProjectSummary } from '../governed/projectInventory';
import type {
  GovernedProjectsInventory,
  GovernedProjection,
  GovernedState,
} from '../governed/types';
import { buildContinueWorking, type ProjectStatus } from '../owner/continueWorkingModel';
import { sameRepositoryRoot } from '../governed/sameRoot';
import { buildHomeModel } from '../owner/homeModel';

/**
 * A project ProjectOS knows about but is not currently pointed at.
 *
 * IT MAY NOW CARRY A SUMMARY, AND THE SHAPE STAYS SEPARATE ON PURPOSE. `live: true` still means
 * "this is the selected project, read from its full projection"; a summary is the reduced read the
 * daemon took of a project it is NOT pointed at. Collapsing the two would let a row claim the
 * completeness of a projection it never had.
 *
 * `summary` is `null` when the portfolio has not arrived, and the row falls back to the honest
 * `Open to see`. Absence of a summary is not a claim that nothing is happening.
 */
export interface DormantProjectRow {
  readonly live: false;
  readonly projectId: string;
  readonly projectName: string;
  /** `owner/name`, or `none` when the project's configuration does not name one. */
  readonly repository: string;
  readonly selected: false;
  readonly summary: ProjectSummary | null;
}

/** The selected project, described from its real governed projection. */
export interface LiveProjectRow {
  readonly live: true;
  readonly projectId: string;
  readonly projectName: string;
  readonly repository: string;
  readonly selected: true;
  readonly status: ProjectStatus;
  /** The plan's own version label, or null when no plan is recorded. */
  readonly planLabel: string | null;
  /** "Step 3 of 7 — Gap analysis", or null when no phase is in play. */
  readonly stepLabel: string | null;
  readonly ownerActionRequired: boolean;
  /** The first blocking thing waiting on the owner, in the owner's words. */
  readonly ownerActionSummary: string | null;
  /** True only when a real problem is recorded — never decoration. */
  readonly hasProblem: boolean;
  readonly problemSummary: string | null;
}

export type ProjectRow = DormantProjectRow | LiveProjectRow;

/** Why the list is empty, or why it may be incomplete. Never inferred from an empty array alone. */
export interface ProjectsModel {
  readonly rows: readonly ProjectRow[];
  /** True when ProjectOS has read the registry and it genuinely holds no project. */
  readonly empty: boolean;
  /**
   * Set when the inventory has not arrived at all. Distinct from `empty`: "we have not been told"
   * is not "there are none", and a list that says the second when it means the first is a lie.
   */
  readonly unknown: boolean;
  /** The registry's own closed token when it is anything other than `ok`. */
  readonly registryProblem: string | null;
  /** Roots the host refused. A count, never a path. */
  readonly refusedCount: number;
}

/**
 * The plan label the owner sees.
 *
 * The plan record's `planVersion` is what the runtime actually pins, so it is what is shown. The
 * declared status is deliberately NOT used — `ready` is recomputed by the engine and the record's
 * own claim about itself decides nothing.
 */
function planLabelOf(live: GovernedProjection): string | null {
  const v = live.plan.planVersion.trim();
  return v === '' ? null : `Plan ${v}`;
}

/** "Step 4 of 9 — Gap analysis", from the phase actually in play. */
function stepLabelOf(live: GovernedProjection): string | null {
  const phase = live.activePhase ?? live.nextStartablePhase;
  if (phase === null) return null;
  const index = live.phases.findIndex((p) => p.phaseId === phase.phaseId);
  const total = live.phases.length;
  const description = phase.description.trim();
  const position = index >= 0 && total > 0 ? `Step ${index + 1} of ${total}` : 'Step';
  return description === '' ? position : `${position} — ${description}`;
}

/**
 * Build the list.
 *
 * `now` is supplied rather than read: the continue-working model needs a clock to decide how stale
 * a session is, and a model that read one itself could not be tested at a chosen moment.
 *
 * `governed` may be a projection, an explicit unavailable, or null (nothing reported yet). Only the
 * first produces a live row, and only for the project the inventory says is selected — a projection
 * describing a different project than the one currently selected is a stale snapshot, and attaching
 * it to the wrong row would put one project's status under another project's name.
 */
export function buildProjectsModel(
  inventory: GovernedProjectsInventory | null,
  governed: GovernedState | null,
  now: number,
  portfolio: PortfolioMessage | null = null,
  /**
   * The live governed run, so a row for a project that IS running says so. Rows are matched to it by
   * repository root, never by selection: a run belongs to one project and must not colour another's.
   */
  liveRun: { readonly root: string | null; readonly active: boolean } | null = null,
): ProjectsModel {
  if (inventory === null) {
    return { rows: [], empty: false, unknown: true, registryProblem: null, refusedCount: 0 };
  }

  const live: GovernedProjection | null =
    governed !== null && governed.connected ? governed : null;

  const rows: ProjectRow[] = inventory.projects.map((p) => {
    const isLive =
      live !== null &&
      inventory.selectedProjectId === p.projectId &&
      live.projectId === p.projectId;

    if (!isLive || live === null) {
      // MATCHED BY EXACT PROJECT ID, and by nothing else. A summary is only ever attached to the row
      // it was built for, so one project's phase, blocker or worker can never appear on another's.
      const summary = portfolio?.projects.find((row) => row.projectId === p.projectId) ?? null;
      return {
        live: false,
        projectId: p.projectId,
        projectName: p.projectName,
        repository: p.repository,
        selected: false,
        summary,
      };
    }

    const home = buildHomeModel(live);
    const runHere =
      liveRun !== null && liveRun.active && sameRepositoryRoot(liveRun.root, live.repository.localPath)
        ? { active: true }
        : null;
    const cw = buildContinueWorking(live, home.ownerActions, now, runHere);
    const blocking = home.ownerActions.find((a) => a.severity === 'blocking') ?? null;
    // A problem is a recorded blocker or an unusable connection — never a status word, and never
    // the mere absence of something. Nothing here is decoration.
    const problem = live.blockers[0] ?? home.connectionProblems[0] ?? null;

    return {
      live: true,
      projectId: p.projectId,
      projectName: p.projectName,
      repository: p.repository,
      selected: true,
      status: cw.status,
      planLabel: planLabelOf(live),
      stepLabel: stepLabelOf(live),
      ownerActionRequired: home.ownerActionRequired,
      ownerActionSummary: blocking === null ? null : blocking.title,
      hasProblem: problem !== null,
      problemSummary: problem,
    };
  });

  const status = inventory.registryStatus;
  return {
    rows,
    empty: rows.length === 0,
    unknown: false,
    registryProblem: status === null || status === 'ok' ? null : status,
    refusedCount: inventory.refusedCount,
  };
}

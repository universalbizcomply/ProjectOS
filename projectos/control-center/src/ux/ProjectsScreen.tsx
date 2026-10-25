/**
 * SCREEN 1 — PROJECTS. Every governed project, and which one wants attention.
 *
 * ONE PROJECT PICKER. This screen replaces three: the rail's own list, the constellation overlay and
 * the legacy project selector. They showed the same set through three different mental models, and
 * the accepted architecture keeps exactly one.
 *
 * WHAT A ROW MAY CLAIM. See `projectsModel.ts`. The selected project's row is drawn from its full
 * governed projection. Every other row shows the read-only portfolio summary the daemon took of it,
 * once one has arrived, and only what that summary says: an unknown stays unknown, an unreadable
 * project says why in the daemon's words, and a row with no summary offers to open. Nothing here
 * selects a project, fills a card with repository internals, or infers a status from silence.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A. The summary for projects that are not
 * selected is rendered since PROJECTOS-FOUNDATION-GAPS1A: selection is refused while governed work
 * runs, so without it the owner could see nothing about any other project during a run.
 */
import { useEffect, useState } from 'react';
import { hasLocalHost } from './HostCapability';
import { dotColour, initialsOf, statusInk, type ProjectState } from '../owner/workspaceModel';
import type { ProjectSummary } from '../governed/projectInventory';
import type { ProjectRow, ProjectsModel } from './projectsModel';

/**
 * How long "reading…" may honestly stand before it becomes a lie.
 *
 * The inventory arrives over the native bridge within a moment of the shell mounting. Fifteen
 * seconds is far longer than that ever takes and short enough that an owner is not left staring at
 * a sentence describing work that is not happening.
 */
const SILENCE_BEFORE_SAYING_SO_MS = 15_000;

/**
 * Has the runtime failed to answer at all?
 *
 * THE DEFECT THIS EXISTS FOR. An unsigned packaged build opens its window and refuses to launch its
 * daemon -- failure is refusal, by design, and that design is right. What was wrong is what the
 * owner saw: "Reading the list of projects on this computer…", for ever, describing work that had
 * already been refused and would never begin. Observed directly against a real unsigned build.
 *
 * IT REPORTS OUR OWN WAITING, NOT A DIAGNOSIS. This knows that nothing arrived in a bounded time. It
 * does not know why, and says so in those terms rather than naming a cause it cannot establish.
 */
function useRuntimeSilence(unknown: boolean): boolean {
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!unknown) {
      setSilent(false);
      return;
    }
    const id = setTimeout(() => setSilent(true), SILENCE_BEFORE_SAYING_SO_MS);
    return () => clearTimeout(id);
  }, [unknown]);
  return silent;
}

/**
 * The row's dot colour comes from the same state vocabulary the workspace uses.
 *
 * A row that is not selected is coloured only from facts its summary records — a decision waiting on
 * the owner, a recorded blocker, a run this daemon is tracking. Anything else, an unreadable project
 * included, stays the neutral colour: its text says what is known, and a colour must not say more.
 */
function stateOfRow(row: ProjectRow): ProjectState {
  if (!row.live) {
    const s = row.summary;
    if (s === null || !s.available) return 'ready';
    if (s.ownerActionRequired) return 'waiting';
    if (s.blockerCount > 0) return 'blocked';
    if (s.liveness === 'RUNNING') return 'working';
    return 'ready';
  }
  if (row.status === 'Waiting for you') return 'waiting';
  if (row.status === 'Blocked') return 'blocked';
  if (row.status === 'Working') return 'working';
  return 'ready';
}

/**
 * The worker line. Two values, because the summary has two: this daemon either tracks a run for the
 * project or does not know. There is no idle — the absence of a tracked run is not knowledge that
 * nothing is running.
 */
function livenessText(s: ProjectSummary): string {
  return s.liveness === 'RUNNING' ? 'Running now' : 'Worker status not known';
}

function blockerText(s: ProjectSummary): string {
  if (s.blockerCount === 0) return 'No blockers';
  if (s.firstBlocker === null) {
    return s.blockerCount === 1 ? '1 blocker, not described' : `${s.blockerCount} blockers, not described`;
  }
  return s.blockerCount === 1
    ? `Blocked: ${s.firstBlocker}`
    : `Blocked: ${s.firstBlocker} (and ${s.blockerCount - 1} more)`;
}

/**
 * What the daemon's read-only summary says about a project that is not selected.
 *
 * PLAIN TEXT ONLY. Every value originates in that project's own records, so each is rendered as a
 * text child — never as markup, and never as the target of a link. Rendering starts nothing: no
 * selection, no command, no request. Opening the project remains the owner's explicit click.
 */
function DormantSummary({ summary: s }: { summary: ProjectSummary }) {
  if (!s.available) {
    // Unreadable is reported as exactly that — not as a project with no blockers and nothing to do.
    return (
      <>
        <span className="ux-projproblem">ProjectOS could not read this project</span>
        <span className="ux-projwhy">{s.unavailableDetail ?? 'No reason was given'}</span>
        <span className="ux-projline">{livenessText(s)}</span>
      </>
    );
  }
  const phases =
    s.acceptedPhaseCount !== null && s.totalPhaseCount !== null
      ? `${s.acceptedPhaseCount} of ${s.totalPhaseCount} phases accepted`
      : 'phase count not known';
  return (
    <>
      <span className="ux-projline">{`Plan: ${s.planStatus ?? 'status not known'} · ${phases}`}</span>
      <span className="ux-projline">
        {s.activePhaseId !== null ? `Active phase: ${s.activePhaseId}` : 'No phase active'}
      </span>
      <span className="ux-projstatus">{livenessText(s)}</span>
      <span className="ux-projwhy">{blockerText(s)}</span>
      <span className="ux-projwhy">
        {s.ownerActionRequired ? 'Waiting on your decision' : 'Nothing waiting on you'}
      </span>
      <span className="ux-projwhy">
        {s.nextSafeAction !== null ? `Next: ${s.nextSafeAction}` : 'Next step not known'}
      </span>
    </>
  );
}

function Row({
  row,
  onOpen,
}: {
  row: ProjectRow;
  onOpen: (projectId: string) => void;
}) {
  const state = stateOfRow(row);
  return (
    <li className="ux-projrow">
      <span className="os-tile" style={{ color: dotColour(state) }} aria-hidden="true">
        {initialsOf(row.projectName)}
      </span>

      <span className="ux-projbody">
        <span className="ux-projhead">
          <span className="ux-projname">{row.projectName}</span>
          {(row.live ? row.ownerActionRequired : row.summary?.ownerActionRequired === true) && (
            // Never colour alone: the dot carries a word beside it.
            <span className="ux-needsyou">
              <i style={{ background: dotColour('waiting') }} aria-hidden="true" />
              Needs you
            </span>
          )}
        </span>

        {row.live ? (
          <>
            <span className="ux-projline">
              {[row.planLabel, row.stepLabel].filter((x) => x !== null).join(' · ') ||
                'No plan yet'}
            </span>
            <span className="ux-projstatus" style={{ color: statusInk(state) }}>
              {row.status}
            </span>
            {row.ownerActionSummary !== null && (
              <span className="ux-projwhy">{row.ownerActionSummary}</span>
            )}
            {row.problemSummary !== null && (
              <span className="ux-projproblem">{row.problemSummary}</span>
            )}
          </>
        ) : row.summary !== null ? (
          <DormantSummary summary={row.summary} />
        ) : (
          <span className="ux-projline">
            {/*
              THE HONEST LINE. No summary has arrived for this project, so ProjectOS does not know its
              status — and a list must not change what the runtime is doing merely by being looked at.
            */}
            Open to see what is happening here
          </span>
        )}
      </span>

      <button type="button" className="os-sec ux-projopen" onClick={() => onOpen(row.projectId)}>
        Open
      </button>
    </li>
  );
}

export function ProjectsScreen({
  model,
  onOpen,
  onAddProject,
}: {
  model: ProjectsModel;
  onOpen: (projectId: string) => void;
  onAddProject: () => void;
}) {
  const runtimeSilent = useRuntimeSilence(model.unknown);
  return (
    <section className="os-stack" aria-labelledby="ux-projects-title">
      <header className="ux-screenhead">
        <h1 className="os-h1" id="ux-projects-title">Projects</h1>
        <button type="button" className="os-pri" onClick={onAddProject}>
          Add project
        </button>
      </header>

      {/*
        "READING…" IS ONLY TRUE WHERE THERE IS SOMETHING TO READ FROM.
        On the desktop the inventory arrives over the native bridge a moment after the shell mounts,
        so a pending line is right. In a browser there is no bridge and it never arrives — the line
        then describes work in progress that will never finish, and an owner waits for something
        that cannot come. See `HostCapability`.
      */}
      {model.unknown && !hasLocalHost() && (
        <p className="os-empty" role="status">
          Your projects live on your own computer, and this page cannot reach them. Open the
          ProjectOS application there to see them.
        </p>
      )}

      {model.unknown && hasLocalHost() && !runtimeSilent && (
        <p className="os-empty" role="status">Reading the list of projects on this computer…</p>
      )}

      {/*
        NOTHING ANSWERED. Said plainly, because the alternative is the sentence above standing for
        ever over a runtime that was refused before it started.
      */}
      {model.unknown && hasLocalHost() && runtimeSilent && (
        <div className="os-plate" role="alert">
          <h2 className="os-h2">ProjectOS could not start its runtime</h2>
          <p className="os-set-sub">
            Nothing answered, so there is nothing to show — this is not an empty list, it is no
            answer at all. Your projects and their records are untouched.
          </p>
          <p className="os-set-sub">
            Close ProjectOS and open it again. If it still cannot start, the installed application
            could not verify itself and needs to be reinstalled.
          </p>
        </div>
      )}

      {model.registryProblem !== null && (
        <p className="ux-notice" role="alert">
          ProjectOS could not read the list of installed projects properly ({model.registryProblem}).
          What is shown below may be incomplete.
        </p>
      )}

      {model.refusedCount > 0 && (
        <p className="ux-notice" role="status">
          {model.refusedCount === 1
            ? '1 folder was not accepted as a project.'
            : `${model.refusedCount} folders were not accepted as projects.`}
        </p>
      )}

      {model.empty && !model.unknown && (
        <div className="os-plate">
          <h2 className="os-h2">No projects yet</h2>
          <p className="os-set-sub">Add the first one and ProjectOS will take it from there.</p>
          <button type="button" className="os-pri" onClick={onAddProject}>
            Add project
          </button>
        </div>
      )}

      {model.rows.length > 0 && (
        <ul className="ux-projlist">
          {model.rows.map((row) => (
            <Row key={row.projectId} row={row} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

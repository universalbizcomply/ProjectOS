/**
 * SCREEN 1 — PROJECTS. Every governed project, and which one wants attention.
 *
 * ONE PROJECT PICKER. This screen replaces three: the rail's own list, the constellation overlay and
 * the legacy project selector. They showed the same set through three different mental models, and
 * the accepted architecture keeps exactly one.
 *
 * WHAT A ROW MAY CLAIM. See `projectsModel.ts` — only the selected project has a governed
 * projection, so only its row carries a status, a plan and a step. Every other row says what it
 * honestly knows and offers to open. Nothing here fills a card with repository internals, and
 * nothing infers a status from silence.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useEffect, useState } from 'react';
import { hasLocalHost } from './HostCapability';
import { dotColour, initialsOf, statusInk, type ProjectState } from '../owner/workspaceModel';
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

/** The row's dot colour comes from the same state vocabulary the workspace uses. */
function stateOfRow(row: ProjectRow): ProjectState {
  if (!row.live) return 'ready';
  if (row.status === 'Waiting for you') return 'waiting';
  if (row.status === 'Blocked') return 'blocked';
  if (row.status === 'Working') return 'working';
  return 'ready';
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
          {row.live && row.ownerActionRequired && (
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
        ) : (
          <span className="ux-projline">
            {/*
              THE HONEST LINE. ProjectOS is pointed at one project at a time, so it does not know
              this one's status without being pointed at it — and a list must not change what the
              runtime is doing merely by being looked at.
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

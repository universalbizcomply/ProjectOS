/**
 * The persistent rail — README §Screens 1.
 *
 * WHAT IT SHOWS. The projects this installed ProjectOS may govern, taken verbatim from the
 * runtime's inventory. Selecting one submits a project ID through the governed command channel and
 * nothing else: there is no text field here, no folder picker and no path, exactly as the `<select>`
 * it replaces had none. A project the installed host did not supply is not in this list and cannot
 * be reached from it.
 *
 * WHAT IT REFUSES TO INVENT. The projection describes ONE project — the selected one. Every other
 * row therefore has no measured status, and says so: "Not read yet", in the idle colour. Borrowing
 * the selected project's state, or picking a plausible one, would put a fact-shaped claim next to
 * five projects nobody has looked at. The row keeps its designed shape either way.
 */
import { useState } from 'react';
import { useGovernedProjects } from '../daemon/DaemonProvider';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { ShellThemeToggle, type ShellTheme } from './ShellTheme';
import { dotColour, initialsOf, statusInk, type ProjectState } from './workspaceModel';
import { IconPlus, IconSettings } from './icons';

export interface RailProjectState {
  /** The state the model decided for the SELECTED project. */
  readonly state: ProjectState;
  readonly label: string;
  /** How many things are waiting on the owner right now. */
  readonly waiting: number;
}

export function ProjectRail({
  theme,
  setTheme,
  selectedState,
  onNewProject,
  onOpenSettings,
  onOpenDashboard,
  onOpenProject,
}: {
  theme: ShellTheme;
  setTheme: (next: ShellTheme) => void;
  selectedState: RailProjectState | null;
  onNewProject: () => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenProject: () => void;
}) {
  const inventory = useGovernedProjects();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<readonly string[]>([]);

  const projects = inventory?.projects ?? [];
  const selectedId = inventory?.selectedProjectId ?? null;

  async function select(projectId: string) {
    if (projectId === selectedId) {
      onOpenProject();
      return;
    }
    setBusy(true);
    setRefusal([]);
    try {
      // The runtime's own verdict, verbatim. A refused switch stays refused — nothing here
      // optimistically repaints as though the project had changed.
      const outcome = await requestGovernedCommand(tauriBridge, 'project.select', { projectId });
      if (!outcome.ok) setRefusal(outcome.lines);
      else onOpenProject();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="os-rail">
      <div className="os-brand">
        <span className="os-brand-mark" aria-hidden="true" />
        <span className="os-brand-name">ProjectOS</span>
      </div>

      <button type="button" className="os-newproject" onClick={onNewProject}>
        <IconPlus />
        New project
      </button>

      <div className="os-railmid">
        <div className="os-raillabel" id="os-rail-projects">Projects</div>

        {inventory === null && (
          <div className="os-railempty" role="status">
            Checking which projects are set up on this computer.
          </div>
        )}
        {inventory !== null && projects.length === 0 && (
          <div className="os-railempty">None yet. Add one above and it will appear here.</div>
        )}

        <div className="os-projlist" role="list" aria-labelledby="os-rail-projects">
          {projects.map((p) => {
            const isSelected = p.projectId === selectedId;
            const state: ProjectState = isSelected && selectedState !== null ? selectedState.state : 'ready';
            const label = isSelected && selectedState !== null ? selectedState.label : 'Not read yet';
            const waiting = isSelected && selectedState !== null ? selectedState.waiting : 0;
            return (
              <button
                type="button"
                role="listitem"
                key={p.projectId}
                className="os-proj"
                data-active={isSelected ? '1' : '0'}
                aria-current={isSelected ? 'true' : undefined}
                aria-busy={busy}
                onClick={() => void select(p.projectId)}
              >
                <span className="os-tile" style={{ color: dotColour(state) }} aria-hidden="true">
                  {initialsOf(p.projectName)}
                </span>
                <span className="os-projbody">
                  <span className="os-projname">{p.projectName}</span>
                  {/* Status is never colour alone: the word sits beside the dot, always. */}
                  <span className="os-projstatus" style={{ color: statusInk(state) }}>
                    <span
                      className={`os-dot${state === 'working' ? ' os-live' : ''}`}
                      style={{ background: dotColour(state) }}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </span>
                </span>
                {waiting > 0 && (
                  <span className="os-count" aria-label={`${waiting} waiting for you`}>
                    {waiting}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {busy && (
          <p className="os-railempty" role="status" data-testid="project-select-pending">
            Switching project…
          </p>
        )}
        {refusal.length > 0 && (
          <div className="os-refusal failed" role="alert" data-testid="project-select-refusal">
            {refusal.join('\n')}
          </div>
        )}
        {inventory !== null && inventory.refusedCount > 0 && (
          <p className="os-railempty" role="status" data-testid="project-refused-count">
            {inventory.refusedCount}{' '}
            {inventory.refusedCount === 1 ? 'project is' : 'projects are'} not available, because what
            is on disk no longer matches what was set up. Nothing was changed — an administrator needs
            to look at this.
          </p>
        )}
      </div>

      <div className="os-railfoot">
        <div>
          <div className="os-railfoot-label">Appearance</div>
          {/* The existing `ShellThemeToggle`, restyled. Same mechanism, same persistence key. */}
          <ShellThemeToggle theme={theme} setTheme={setTheme} />
        </div>
        {theme === 'command' && (
          <button type="button" className="os-raildash" onClick={onOpenDashboard}>
            Command dashboard
          </button>
        )}
        <button type="button" className="os-settingsbtn" onClick={onOpenSettings}>
          <IconSettings />
          Settings
        </button>
      </div>
    </aside>
  );
}

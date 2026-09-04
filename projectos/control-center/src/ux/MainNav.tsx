/**
 * THE RAIL — four destinations, and nothing that competes with them.
 *
 * WHAT CHANGED FROM THE ACCEPTED VISUAL BRANCH, AND WHAT DID NOT. The rail keeps every specified
 * dimension, class and treatment: 308px, `26px 18px`, sticky, the same brand block, the same
 * appearance switch, the same Settings control at the foot. The JARVIS identity is frozen and this
 * file changes none of it.
 *
 * What changes is what the middle of the rail is FOR. It used to be a project picker — one of three
 * in the product. The accepted architecture gives project selection its own screen, so the rail
 * carries the four destinations instead, with recently-opened projects beneath them as a shortcut
 * into the Projects screen's job rather than a second implementation of it.
 *
 * IT NAVIGATES; IT DOES NOT SELECT. Nothing here dispatches a governed command. Opening a project
 * is a `project.select`, and it belongs to the screen that owns that decision.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { ShellThemeToggle, type ShellTheme } from '../owner/ShellTheme';
import { dotColour, initialsOf, type ProjectState } from '../owner/workspaceModel';
import { IconPlus, IconSettings } from '../owner/icons';

/** The four destinations. Plans live inside a project, so they are not one of them. */
export type NavDestination = 'projects' | 'execution' | 'control' | 'health' | 'settings';

export interface NavRecent {
  readonly projectId: string;
  readonly projectName: string;
  /** Only the selected project has a measured state; every other recent uses the idle one. */
  readonly state: ProjectState;
  readonly selected: boolean;
}

const DESTINATIONS: ReadonlyArray<{ id: NavDestination; label: string; hint: string }> = [
  { id: 'projects', label: 'Projects', hint: 'Everything ProjectOS is working on' },
  // THE PRIMARY OPERATING SURFACE. It sits directly under Projects because it is where an owner
  // spends their time: the plan, what is running, what finished, and any decision that is theirs.
  { id: 'execution', label: 'Execution', hint: 'The plan, live, and anything waiting for you' },
  { id: 'control', label: 'Control Center', hint: 'Ask, command, and watch it happen' },
  { id: 'health', label: 'Health', hint: 'Spending, connections and the runtime' },
];

export function MainNav({
  theme,
  setTheme,
  active,
  available,
  onNavigate,
  recents,
  onOpenProject,
  onNewProject,
  waiting,
}: {
  theme: ShellTheme;
  setTheme: (t: ShellTheme) => void;
  active: NavDestination;
  /**
   * The destinations that are IMPLEMENTED. Anything absent is not drawn.
   *
   * The accepted architecture names four and they are being built in sequence. A rail listing all
   * four before they exist would put entries on screen that lead to an empty canvas, and a
   * navigation item that goes nowhere is a worse answer than one that is not there yet.
   */
  available: readonly NavDestination[];
  onNavigate: (to: NavDestination) => void;
  recents: readonly NavRecent[];
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  /** How many things are waiting on the owner in the project ProjectOS is pointed at. */
  waiting: number;
}) {
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
        <nav className="ux-nav" aria-label="Primary">
          {DESTINATIONS.filter((d) => available.includes(d.id)).map((d) => (
            <button
              key={d.id}
              type="button"
              className="ux-navbtn"
              data-active={active === d.id ? '1' : '0'}
              aria-current={active === d.id ? 'page' : undefined}
              onClick={() => onNavigate(d.id)}
            >
              <span className="ux-navlabel">
                {d.label}
                {d.id === 'projects' && waiting > 0 && (
                  <span className="ux-navcount" aria-label={`${waiting} waiting for you`}>
                    {waiting}
                  </span>
                )}
              </span>
              <span className="ux-navhint">{d.hint}</span>
            </button>
          ))}
        </nav>

        {recents.length > 0 && (
          <>
            <div className="os-raillabel" id="ux-rail-recent">Recent</div>
            <div className="os-projlist" role="list" aria-labelledby="ux-rail-recent">
              {recents.map((r) => (
                <button
                  key={r.projectId}
                  type="button"
                  role="listitem"
                  className="os-proj"
                  data-active={r.selected ? '1' : '0'}
                  aria-current={r.selected ? 'true' : undefined}
                  onClick={() => onOpenProject(r.projectId)}
                >
                  <span className="os-tile" style={{ color: dotColour(r.state) }} aria-hidden="true">
                    {initialsOf(r.projectName)}
                  </span>
                  <span className="os-projbody">
                    <span className="os-projname">{r.projectName}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="os-railfoot">
        <div className="os-railfoot-row">
          <div className="os-railfoot-label">Appearance</div>
          <ShellThemeToggle theme={theme} setTheme={setTheme} />
        </div>
        <button
          type="button"
          className="os-settingsbtn"
          data-active={active === 'settings' ? '1' : '0'}
          aria-current={active === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <IconSettings />
          Settings
        </button>
      </div>
    </aside>
  );
}

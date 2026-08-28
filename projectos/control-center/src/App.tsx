import { useEffect, useMemo, useRef, useState } from 'react';
import {
  planWorkflow,
  DEFAULT_WORKERS,
  defaultCatalog,
  list,
  CORE_VERSION,
  DEFAULT_SAFETY_GATES,
  GATE_KEYS,
} from '@projectos/core';
import { useGovernedProjects, useGovernedRun, useGovernedState } from './daemon/DaemonProvider';
import { isSupabaseConfigured } from './data/supabase';
import { getSession, onAuthChange, signOut, mustChangePassword } from './data/auth';
import { Login } from './Login';
import { ChangePassword } from './ChangePassword';
import { DaemonProvider } from './daemon/DaemonProvider';
import { LiveMissionControl } from './daemon/LiveMissionControl';
import { OwnerControlPlane } from './owner/OwnerControlPlane';
import { SafetyProviders } from './owner/SafetyProviders';
import { useShellTheme } from './owner/ShellTheme';
import { ForgeConsole } from './forge/ForgeConsole';
import { MainNav, type NavDestination, type NavRecent } from './ux/MainNav';
import { ProjectsScreen } from './ux/ProjectsScreen';
import { ProjectHome, type ProjectTab } from './ux/ProjectHome';
import { PlanDetail } from './ux/PlanDetail';
import { ControlCenter, type ControlCenterEntry } from './ux/ControlCenter';
import { HealthScreen } from './ux/HealthScreen';
import { NoLocalHostNotice } from './ux/HostCapability';
import { buildProjectsModel } from './ux/projectsModel';
import { AddProjectWizard } from './owner/AddProjectWizard';
import { StartSomethingNew } from './owner/StartSomethingNew';
import { SettingsScreen } from './owner/SettingsScreen';
import { FirstRun } from './owner/FirstRun';
import { useCalmMotion, useParallax } from './owner/motion';
import { buildContinueWorking } from './owner/continueWorkingModel';
import { buildHomeModel } from './owner/homeModel';
import { stateFromStatus, type ProjectState } from './owner/workspaceModel';
import { requestGovernedCommand } from './governed/governedClient';
import { tauriBridge } from './daemon/tauriBridge';
import type { Session } from '@supabase/supabase-js';

/**
 * THE SHELL — README §Screens 1, and the view union IMPLEMENTATION_ORDER §2 specifies.
 *
 * Ten equally weighted destinations became six: a persistent 308px rail carrying the brand, New
 * project, the project list, the appearance switch and Settings, over one canvas. Nothing became
 * unreachable — workflow is also the Plan tab, and every previous destination (Mission Control,
 * Workflow, Integrations, Forge, Owner Control, Safety & Providers and Safety Gates) is reached
 * from Advanced. Owner Chat was REMOVED in Stage 8: the Universal Control Center is the owner's
 * conversation and command surface, and a second chat behind Advanced was a duplicate of it with a
 * weaker safety posture — see the Advanced surface's own note.
 *
 * Settings states the five approvals an owner meets in plain language; the eight canonical gates,
 * with their keys and their gated/prohibited status, stay on Safety Gates.
 *
 * `dashboard` EXISTS ONLY IN COMMAND MODE. In Standard it falls through to the workspace; rendering
 * it there leaves an empty canvas, and that bug has happened here once already.
 */
type View =
  | 'projects'   // the list of every governed project — the landing surface
  | 'project'    // one project: overview, plans, activity, files, advanced
  | 'control'    // the universal command surface
  | 'health'     // spending, connections, runtime, execution
  | 'settings'
  | 'wizard'     // add a project
  | 'plan'       // one plan, its steps, its evidence and its governed controls
  | 'advanced';  // the retained surfaces, reachable and unredesigned
type AdvancedView =
  | 'live'
  | 'workflow'
  | 'plugins'
  | 'forge'
  | 'control'
  | 'safety'
  | 'gates';

/**
 * The retained surfaces, in the order the previous shell listed them.
 *
 * One list, used both by the workspace's technical panel and by the Advanced surface's own
 * switcher, so the two can never drift apart and no surface can be reachable from one but not the
 * other. Reference data, not navigation authority: choosing an entry only changes which retained
 * component is rendered.
 */
const ADVANCED_SURFACES: ReadonlyArray<{ id: AdvancedView; label: string }> = [
  { id: 'live', label: 'Mission Control' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'plugins', label: 'Integrations' },
  { id: 'forge', label: 'Forge' },
  { id: 'control', label: 'Owner Control' },
  { id: 'safety', label: 'Safety & Providers' },
  { id: 'gates', label: 'Safety Gates' },
];

/**
 * Upper bound on the initial session probe. `getSession()` can reject (offline, DNS
 * failure) or stay pending indefinitely (token refresh against an unreachable host);
 * either way the boot state must end, so the probe is raced against this deadline.
 */
const SESSION_PROBE_TIMEOUT_MS = 10_000;

/** How long the mode-change light sweep runs. README §Interactions. */
const SWEEP_MS = 720;
const TOAST_MS = 3000;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [probeAttempt, setProbeAttempt] = useState(0);
  const [showChangePw, setShowChangePw] = useState(false);

  // The auth-change subscription lives for the whole component, independent of the probe:
  // subscribing re-emits the current auth state, so re-running it on every retry would fire
  // that side effect for an unrelated reason.
  useEffect(() => {
    const off = onAuthChange((s) => setSession(s));
    return off;
  }, []);

  // The initial session probe, re-armed by `probeAttempt` when the owner retries.
  useEffect(() => {
    let live = true;
    // One-shot: whichever of resolve / reject / timeout lands first owns the transition.
    // A late resolution after the deadline is dropped rather than reviving a stale boot.
    let settled = false;
    const deadline = setTimeout(() => {
      if (!live || settled) return;
      settled = true;
      setProbeFailed(true);
    }, SESSION_PROBE_TIMEOUT_MS);

    getSession()
      .then((s) => {
        if (!live || settled) return;
        settled = true;
        clearTimeout(deadline);
        setSession(s);
        setAuthReady(true);
      })
      .catch(() => {
        if (!live || settled) return;
        settled = true;
        clearTimeout(deadline);
        setProbeFailed(true);
      });

    return () => {
      live = false;
      clearTimeout(deadline);
    };
  }, [probeAttempt]);

  function retryProbe() {
    setProbeFailed(false);
    setProbeAttempt((n) => n + 1);
  }

  // Auth gate: when Supabase is configured, require a session.
  if (isSupabaseConfigured) {
    if (probeFailed) return <SessionProbeFailed onRetry={retryProbe} />;
    if (!authReady) return <div className="booting">Loading…</div>;
    if (session === null) return <Login />;
    if (mustChangePassword(session)) {
      return <ChangePassword forced onDone={() => void getSession().then(setSession)} />;
    }
    if (showChangePw) {
      return <ChangePassword forced={false} onDone={() => setShowChangePw(false)} />;
    }
  }

  return (
    <DaemonProvider>
      <Shell
        canChangePassword={session !== null}
        onChangePassword={() => setShowChangePw(true)}
      />
    </DaemonProvider>
  );
}

/**
 * Exported so the design-fidelity proof harness can mount the real shell against a scripted
 * projection. Production still enters through `App`, which owns the auth gate above.
 */
/**
 * Which of the four accepted destinations are BUILT. Settings is always present at the rail's foot.
 * Control Center and Health join this list when their screens land.
 */
const AVAILABLE_DESTINATIONS: readonly NavDestination[] = ['projects', 'control', 'health'];

export function Shell({
  canChangePassword,
  onChangePassword,
}: {
  canChangePassword: boolean;
  onChangePassword: () => void;
}) {
  // Appearance only. See ShellTheme.tsx: the mode changes no authority, workflow, state or capability.
  const { theme, setTheme } = useShellTheme();
  const { calm, setCalm } = useCalmMotion();
  const [view, setView] = useState<View>('projects');
  const [advanced, setAdvanced] = useState<AdvancedView>('live');
  const [projectTab, setProjectTab] = useState<ProjectTab>('overview');
  /**
   * THE CONTROL CENTER'S TRANSCRIPT, HELD ABOVE THE SCREEN THAT RENDERS IT.
   *
   * What the owner asked and what ProjectOS answered must survive a heartbeat lapse, a transient
   * disconnect and a remount — the same durability the frozen core gave authored results. Held
   * inside the screen, all of it would vanish the moment the projection went null.
   */
  const [ccEntries, setCcEntries] = useState<readonly ControlCenterEntry[]>([]);
  const [objectiveOpen, setObjectiveOpen] = useState(false);
  /** Which plan the owner opened. Null means the active one. */
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [enterTick, setEnterTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sweepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inventory = useGovernedProjects();
  const governed = useGovernedState();
  const run = useGovernedRun();
  const live = governed !== null && governed.connected ? governed : null;

  const isCommand = theme === 'command';
  useParallax(isCommand && !calm);

  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    if (sweepTimer.current !== null) clearTimeout(sweepTimer.current);
  }, []);

  function say(message: string) {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  function go(next: View) {
    setView(next);
    setEnterTick((n) => n + 1);
    // A new screen starts at its own top. Without this, opening Settings from halfway down a long
    // workspace lands the owner in the middle of the appearance plate with the heading off-screen.
    window.scrollTo({ top: 0 });
  }

  function changeTheme(next: typeof theme) {
    if (next === theme) return;
    setTheme(next);
    setEnterTick((n) => n + 1);
    if (!calm) {
      setSweeping(true);
      if (sweepTimer.current !== null) clearTimeout(sweepTimer.current);
      sweepTimer.current = setTimeout(() => setSweeping(false), SWEEP_MS);
    }
  }

  // The one state word the rail and the constellation print for the selected project, decided by the
  // same model the workspace hero uses. Computed once, printed once.
  const railState = useMemo(() => {
    if (live === null) return null;
    const home = buildHomeModel(live);
    const next = buildContinueWorking(live, home.ownerActions, Date.now());
    const complete =
      live.programme.totalPhaseCount > 0 &&
      live.programme.acceptedPhaseCount === live.programme.totalPhaseCount;
    const state: ProjectState = stateFromStatus(next.status, run.active, complete);
    // The SAME count the workspace panels render — approvals plus any other blocking item the
    // model found. A badge that counts only approvals disagrees with the status word beside it.
    const waiting = home.ownerActions.filter((a) => a.severity === 'blocking').length;
    return { state, label: next.status, waiting };
  }, [live, run.active]);

  const selected = inventory?.projects.find((p) => p.projectId === inventory.selectedProjectId) ?? null;
  const projectName = live?.projectName ?? selected?.projectName ?? 'ProjectOS';
  const projectId = live?.projectId ?? selected?.projectId ?? '';

  /**
   * SCREEN 1's data, and the rail's.
   *
   * Both read the SAME two sources — the inventory and the one governed projection — through the
   * same pure model. The rail's recents are a shortcut into the Projects screen's job, never a
   * second answer to it, so there is nothing here for the two to disagree about.
   */
  const projectsModel = useMemo(() => buildProjectsModel(inventory, governed, Date.now()), [inventory, governed]);
  const recents: readonly NavRecent[] = useMemo(
    () =>
      projectsModel.rows.slice(0, 4).map((r) => ({
        projectId: r.projectId,
        projectName: r.projectName,
        state: r.live ? railState?.state ?? 'ready' : 'ready',
        selected: r.live,
      })),
    [projectsModel, railState],
  );

  /** Which of the four destinations is lit. A project screen still belongs to Projects. */
  const navActive: NavDestination =
    view === 'control' ? 'control'
    : view === 'health' ? 'health'
    : view === 'settings' ? 'settings'
    : 'projects';

  /**
   * Open a project: select it in the runtime, THEN show it.
   *
   * The order matters and the failure path more so. A refusal leaves the owner exactly where they
   * were with the runtime's own words — never on a project screen describing a project ProjectOS
   * was never pointed at.
   */
  async function openProject(id: string): Promise<void> {
    const outcome = await requestGovernedCommand(tauriBridge, 'project.select', { projectId: id });
    if (!outcome.ok) {
      say(outcome.lines[0] ?? 'ProjectOS refused that switch.');
      return;
    }
    go('project');
  }

  const noProjects = inventory !== null && inventory.projects.length === 0;
  // `dashboard` is Command-only; in Standard it falls through to the workspace.
  const enterClass = enterTick === 0 ? '' : enterTick % 2 === 0 ? 'os-enter-a' : 'os-enter-b';

  const atmosphere = (
    <>
      <div className="os-atmos" aria-hidden="true">
        <i className="g1" /><i className="g2" />
        <span className="grid" /><span className="floor" /><span className="scan" />
      </div>
      {/* The viewport HUD frame belongs to the workspace shell. The dashboard has its own header in
          that corner, and the frame's readout sits straight on top of SYSTEM TIME. */}
      <div className="os-frame" aria-hidden="true">
        <i /><i /><i /><i />
        <b>projectos // command centre</b>
      </div>
    </>
  );

  const overlays = (
    <>
      {sweeping && <div className="os-sweep" aria-hidden="true" />}
      {toast !== null && <div className="os-toast" role="status">{toast}</div>}
    </>
  );

  return (
    <>
      {atmosphere}
      <a className="skip" href="#main">Skip to content</a>
      <div className="os-shell">
        <MainNav
          theme={theme}
          setTheme={changeTheme}
          active={navActive}
          available={AVAILABLE_DESTINATIONS}
          onNavigate={(to) => go(to as View)}
          recents={recents}
          onOpenProject={(id) => void openProject(id)}
          onNewProject={() => go('wizard')}
          waiting={railState?.waiting ?? 0}
        />
        <main className="os-canvas" id="main" tabIndex={-1}>
          <div className={`os-column ${enterClass}`}>
            {/*
              SAID ONCE, ABOVE EVERYTHING. Without a local host nothing below can reach a project,
              and every screen would otherwise describe that as a runtime that has stopped — true on
              a desktop, misleading on a hosted page where no host was ever there to stop. Renders
              nothing at all in the installed application.
            */}
            <NoLocalHostNotice />
            {/* First run REPLACES THE CANVAS — the workspace's canvas, not every screen. It used to
                render on top of Settings and Advanced as well, so an empty machine showed "Let's add
                your first project" stacked above whatever the owner had actually opened. */}
            {noProjects && view === 'projects' && <FirstRun onAddProject={() => go('wizard')} />}

            {/* SCREEN 1. The one project picker, replacing the rail list, the constellation and the
                legacy selector. Opening a row is a governed `project.select` and nothing else. */}
            {!noProjects && view === 'projects' && (
              <ProjectsScreen
                model={projectsModel}
                onOpen={(id) => void openProject(id)}
                onAddProject={() => go('wizard')}
              />
            )}

            {/* SCREEN 2 + 3. One project: overview, plans, activity, files, advanced. */}
            {!noProjects && view === 'project' && live !== null && (
              <ProjectHome
                state={live}
                tab={projectTab}
                setTab={setProjectTab}
                now={Date.now()}
                onPrimary={() => go('control')}
                onOpenAdvanced={(next) => { setAdvanced(next as AdvancedView); go('advanced'); }}
                onOpenPlanDetail={(planId) => { setOpenPlanId(planId); go('plan'); }}
              />
            )}

            {/* The project screen needs a projection. Without one, say so rather than draw a shell
                around nothing — and keep the way out reachable. */}
            {!noProjects && view === 'project' && live === null && (
              <div className="os-plate" role="status">
                <h2 className="os-h2">ProjectOS is not reporting yet</h2>
                <p className="os-set-sub">
                  Nothing has been read for this project. Everything below is unavailable until the
                  runtime answers.
                </p>
                <button type="button" className="os-sec" onClick={() => go('projects')}>
                  Back to projects
                </button>
              </div>
            )}

            {view === 'health' && <HealthScreen governed={governed} />}

            {view === 'control' && (
              <ControlCenter
                state={live}
                now={Date.now()}
                entries={ccEntries}
                setEntries={(u) => setCcEntries(u)}
                onNavigate={(to) => {
                  if (to === 'projects') return go('projects');
                  if (to === 'health') return go('health');
                  setProjectTab(to === 'plans' ? 'plans' : 'activity');
                  go('project');
                }}
                objectiveOpen={objectiveOpen}
                objectivePanel={
                  <StartSomethingNew
                    projectName={projectName}
                    projectId={projectId}
                    onBack={() => setObjectiveOpen(false)}
                    onSeePlan={() => { setObjectiveOpen(false); setProjectTab('plans'); go('project'); }}
                  />
                }
                onStartObjective={() => setObjectiveOpen(true)}
              />
            )}

            {view === 'plan' && live !== null && (
              <PlanDetail
                state={live}
                now={Date.now()}
                planId={openPlanId}
                onBack={() => { setProjectTab('plans'); go('project'); }}
              />
            )}

            {/* The same honest fallback the project screen has: a screen that needs a projection
                says so rather than rendering nothing when the runtime goes quiet. */}
            {view === 'plan' && live === null && (
              <div className="os-plate" role="status">
                <h2 className="os-h2">ProjectOS is not reporting yet</h2>
                <p className="os-set-sub">This plan cannot be shown until the runtime answers.</p>
                <button type="button" className="os-sec" onClick={() => { setProjectTab('plans'); go('project'); }}>
                  Back to plans
                </button>
              </div>
            )}

            {view === 'wizard' && (
              <AddProjectWizard
                onCancel={() => go('projects')}
                onAdded={(id) => { void openProject(id); }}
              />
            )}

            {view === 'settings' && (
              <SettingsScreen
                projectName={projectName}
                theme={theme}
                setTheme={changeTheme}
                calm={calm}
                setCalm={setCalm}
                onBack={() => go('projects')}
                onAdvanced={() => {
                  /*
                   * GLOBAL Advanced, which is what the button says and what Settings is about.
                   *
                   * It used to open the PROJECT's Advanced tab instead, so a control on a
                   * ProjectOS-wide screen navigated into one project's technical detail — and on a
                   * machine with no project it opened something else again. The two Advanced
                   * contexts are now distinct and this one goes to the platform-wide surface.
                   */
                  setAdvanced('live');
                  go('advanced');
                }}
                onSignOut={() => void signOut()}
                onChangePassword={canChangePassword ? onChangePassword : null}
              />
            )}

            {view === 'advanced' && (
              <AdvancedSurface
                which={advanced}
                onBack={() => go('projects')}
                onOpen={(next) => {
                  setAdvanced(next);
                  window.scrollTo({ top: 0 });
                }}
              />
            )}
          </div>

        </main>
      </div>
      {overlays}
    </>
  );
}

/**
 * The surfaces this pass deliberately does not redesign, shown full-canvas with a way back.
 *
 * README is explicit that these stay reachable and are not restyled in this pass. They are rendered
 * exactly as they were, on the shared token layer, so both palettes still read.
 */
function AdvancedSurface({
  which,
  onBack,
  onOpen,
}: {
  which: AdvancedView;
  onBack: () => void;
  onOpen: (next: AdvancedView) => void;
}) {
  return (
    <div className="os-stack os-advanced">
      <div className="os-advanced-back">
        <button type="button" className="os-ghost" onClick={onBack} style={{ fontSize: '13.5px' }}>
          ← Back to the project
        </button>
        {/*
          The same eight links the technical panel carries, repeated here.
          Without them a machine with no project registered could reach exactly one retained surface
          and no other: Advanced opens straight onto it, and the panel that lists the rest only
          exists on a project workspace. Every surface is reachable from every surface instead.
        */}
        <nav className="os-advnav os-advlinks" aria-label="Advanced surfaces">
          {ADVANCED_SURFACES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="os-advlink"
              aria-current={s.id === which ? 'page' : undefined}
              onClick={() => onOpen(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>
      {/*
        THE SIGNAL THE NO-TRAINING STANDARD ASKS FOR. Advanced is inspection and expert tooling;
        nothing an owner does in the ordinary course of running a project requires any of it, and
        the screen says so in its own words rather than leaving the owner to work it out.
      */}
      <div className="os-plate ux-advnote" role="note">
        <h2 className="os-h2">You normally do not need this</h2>
        <p className="os-set-sub">
          Everything below is technical evidence about ProjectOS itself — how it is installed, what
          it will and will not do without asking, and the surfaces engineers use to inspect it.
          Running your projects never requires it.
        </p>
        <dl className="os-machine">
          <dt>ProjectOS</dt>
          <dd>core v{CORE_VERSION} · governed projection · owner-gated closure</dd>
          <dt>Desktop host</dt>
          <dd>
            {tauriBridge.isTauri()
              ? 'Installed application — the native host is answering'
              : 'Browser preview — the native host is not present, so nothing can be stored or run'}
          </dd>
          <dt>Credentials</dt>
          <dd>Held by Windows. Set one up or replace it in Settings, never here.</dd>
        </dl>
      </div>

      {which === 'live' && <LiveMissionControl />}
      {which === 'control' && <OwnerControlPlane />}
      {which === 'safety' && <SafetyProviders />}
      {which === 'gates' && <Gates />}
      {which === 'forge' && <ForgeConsole />}
      {which === 'workflow' && <Workflow />}
      {which === 'plugins' && <Plugins />}
    </div>
  );
}

/**
 * Safety Gates — the eight canonical gates, unchanged from the previous shell.
 *
 * Kept verbatim, including its own class names: this pass does not redesign the retained surfaces.
 * Settings names the five approvals in the owner's language; this is the engine's own list, with
 * the canonical key and the gated/prohibited status of every one.
 */
function Gates() {
  return (
    <>
      <Head title="Safety Gates" sub="Actions that require explicit owner approval" />
      <div className="section">
        <div className="gates">
          {GATE_KEYS.map((k) => {
            const g = DEFAULT_SAFETY_GATES[k];
            return (
              <div className="gate" key={k}>
                <div>
                  <div className="d">{g.description}</div>
                  <div className="k">{k}</div>
                </div>
                <span className={`tag ${g.status === 'prohibited' ? 'crit' : 'warn'}`}>
                  {g.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * Shown when the initial session probe failed or ran past its deadline. Never reports the
 * underlying error — the cause is always "we could not reach the sign-in service", and the
 * only offered action is to try again. Reaching this screen grants no session.
 */
function SessionProbeFailed({ onRetry }: { onRetry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // This screen replaces the whole boot view, so an alert region alone is not reliably
  // announced. Moving focus to the heading matches the existing `#main` tabIndex={-1}
  // pattern and puts the keyboard on the retry control's own card.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        <h1 ref={heading} tabIndex={-1}>Can’t reach sign-in</h1>
        <p className="login-sub">Check your connection, then try again.</p>
        <div className="login-error" role="alert">
          The sign-in service did not respond.
        </div>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
        <div className="login-foot">Execution stays owner-gated · read-only visibility</div>
      </div>
    </div>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <span className="pill">projectos-core v{CORE_VERSION}</span>
    </div>
  );
}

function Workflow() {
  const plan = useMemo(() => planWorkflow(DEFAULT_WORKERS), []);
  return (
    <>
      <Head title="Workflow" sub="Canonical phase lifecycle and who owns each step" />
      <div className="section">
        <div className="flow">
          {plan.map((p, i) => (
            <div className={`step${p.gated ? ' gated' : ''}`} key={p.step.id}>
              <div className="idx">{i + 1}</div>
              <div className="lbl">{p.step.label}</div>
              <div className="who">
                <b>{p.worker ? p.worker.displayName : '(unassigned)'}</b> · {p.role}
                {p.gated ? ' · owner-gated' : ''}
              </div>
            </div>
          ))}
        </div>
        <p className="note">
          Closure is owner-gated: only the owner worker can move a phase to closed. ProjectOS
          produces the plan; it does not run external providers.
        </p>
      </div>
    </>
  );
}

function Plugins() {
  const items = useMemo(() => list(defaultCatalog()), []);
  return (
    <>
      <Head title="Integrations" sub={`${items.length} plugins in the catalog (inert)`} />
      <div className="section">
        <div className="plugins">
          {items.map((p) => (
            <div className="plugin" key={p.id}>
              <b>{p.displayName}</b>
              <div className="row" style={{ marginTop: 8 }}>
                <span className={`tag ${p.external ? 'warn' : 'mut'}`}>
                  {p.external ? 'external' : 'local'}
                </span>
              </div>
              <div className="caps">{p.capabilities.join(' · ')}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

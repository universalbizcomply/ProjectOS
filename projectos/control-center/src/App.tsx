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
import { OwnerChat } from './owner/OwnerChat';
import { SafetyProviders } from './owner/SafetyProviders';
import { CommandCenterHome } from './owner/CommandCenterHome';
import { useShellTheme } from './owner/ShellTheme';
import { ForgeConsole } from './forge/ForgeConsole';
import { ProjectRail } from './owner/ProjectRail';
import { ProjectWorkspace, type WorkspaceTab } from './owner/ProjectWorkspace';
import { OwnerComposer } from './owner/OwnerComposer';
import { AddProjectWizard } from './owner/AddProjectWizard';
import { StartSomethingNew } from './owner/StartSomethingNew';
import { WorkDone } from './owner/WorkDone';
import { SettingsScreen } from './owner/SettingsScreen';
import { FirstRun } from './owner/FirstRun';
import { Constellation } from './owner/Constellation';
import { useCalmMotion, useParallax } from './owner/motion';
import { useOwnerConversation } from './owner/ownerConversation';
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
 * unreachable — chat is also the workspace composer and workflow is also the Plan tab, and every
 * previous destination (Mission Control, Workflow, Integrations, Forge, Owner Control, Owner Chat,
 * Safety & Providers and Safety Gates) is reached from Advanced, inside the workspace's collapsed
 * technical panel. Settings states the five approvals an owner meets in plain language; the eight
 * canonical gates, with their keys and their gated/prohibited status, stay on Safety Gates.
 *
 * `dashboard` EXISTS ONLY IN COMMAND MODE. In Standard it falls through to the workspace; rendering
 * it there leaves an empty canvas, and that bug has happened here once already.
 */
type View = 'dashboard' | 'projects' | 'wizard' | 'new' | 'settings' | 'recent' | 'advanced';
type AdvancedView =
  | 'live'
  | 'workflow'
  | 'plugins'
  | 'forge'
  | 'control'
  | 'chat'
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
  { id: 'chat', label: 'Owner Chat' },
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
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [enterTick, setEnterTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sweepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inventory = useGovernedProjects();
  const governed = useGovernedState();
  const run = useGovernedRun();
  const live = governed !== null && governed.connected ? governed : null;
  const conversation = useOwnerConversation();

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

  const noProjects = inventory !== null && inventory.projects.length === 0;
  // `dashboard` is Command-only; in Standard it falls through to the workspace.
  const isDash = isCommand && view === 'dashboard' && !noProjects;
  const enterClass = enterTick === 0 ? '' : enterTick % 2 === 0 ? 'os-enter-a' : 'os-enter-b';

  async function pickProject(id: string) {
    setMapOpen(false);
    const outcome = await requestGovernedCommand(tauriBridge, 'project.select', { projectId: id });
    if (!outcome.ok) say(outcome.lines[0] ?? 'ProjectOS refused that switch.');
    else go('projects');
  }

  const atmosphere = (
    <>
      <div className="os-atmos" aria-hidden="true">
        <i className="g1" /><i className="g2" />
        <span className="grid" /><span className="floor" /><span className="scan" />
      </div>
      {/* The viewport HUD frame belongs to the workspace shell. The dashboard has its own header in
          that corner, and the frame's readout sits straight on top of SYSTEM TIME. */}
      {!isDash && (
        <div className="os-frame" aria-hidden="true">
          <i /><i /><i /><i />
          <b>projectos // command centre</b>
        </div>
      )}
    </>
  );

  const overlays = (
    <>
      {mapOpen && railState !== null && (
        <Constellation
          selectedState={railState.state}
          selectedLabel={railState.label}
          onClose={() => setMapOpen(false)}
          onPick={(id) => void pickProject(id)}
        />
      )}
      {sweeping && <div className="os-sweep" aria-hidden="true" />}
      {toast !== null && <div className="os-toast" role="status">{toast}</div>}
    </>
  );

  if (isDash) {
    return (
      <>
        {atmosphere}
        <a className="skip" href="#main">Skip to content</a>
        <main id="main" tabIndex={-1} className={enterClass}>
          <CommandCenterHome
            conversation={conversation}
            onNavigate={(to) => {
              if (to === 'dashboard') return;
              if (to === 'standard') { changeTheme('standard'); go('projects'); return; }
              if (to === 'plan') { setTab('plan'); go('projects'); return; }
              if (to === 'connections') { setTab('secrets'); go('projects'); return; }
              go('projects');
            }}
          />
        </main>
        {overlays}
      </>
    );
  }

  return (
    <>
      {atmosphere}
      <a className="skip" href="#main">Skip to content</a>
      <div className="os-shell">
        <ProjectRail
          theme={theme}
          setTheme={changeTheme}
          selectedState={railState}
          onNewProject={() => go('wizard')}
          onOpenSettings={() => go('settings')}
          onOpenDashboard={() => go('dashboard')}
          onOpenProject={() => go('projects')}
        />
        <main className="os-canvas" id="main" tabIndex={-1}>
          <div className={`os-column ${enterClass}`}>
            {/* First run REPLACES THE CANVAS — the workspace's canvas, not every screen. It used to
                render on top of Settings and Advanced as well, so an empty machine showed "Let's add
                your first project" stacked above whatever the owner had actually opened. */}
            {noProjects && view === 'projects' && <FirstRun onAddProject={() => go('wizard')} />}

            {!noProjects && view === 'projects' && (
              <ProjectWorkspace
                tab={tab}
                setTab={setTab}
                advancedOpen={advancedOpen}
                setAdvancedOpen={setAdvancedOpen}
                conversation={conversation}
                isCommand={isCommand}
                onStartNew={() => go('new')}
                onWorkDone={() => go('recent')}
                onOpenMap={() => setMapOpen(true)}
                onOpenAdvanced={(next) => { setAdvanced(next as AdvancedView); go('advanced'); }}
                onToast={say}
              />
            )}

            {view === 'wizard' && (
              <AddProjectWizard
                onCancel={() => go('projects')}
                onAdded={(id) => { void pickProject(id); }}
              />
            )}

            {!noProjects && view === 'new' && (
              <StartSomethingNew
                projectName={projectName}
                projectId={projectId}
                onBack={() => go('projects')}
                onSeePlan={() => { setTab('plan'); go('projects'); }}
              />
            )}

            {!noProjects && view === 'recent' && (
              <WorkDone projectName={projectName} onBack={() => go('projects')} />
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
                  // The prototype's own route: open the project's technical detail and say so.
                  // With NO project there is no workspace to open it on, and the Advanced surfaces
                  // would be unreachable — so the button opens them directly instead. "Nothing
                  // becomes unreachable" has to hold on an empty machine too.
                  if (noProjects) {
                    setAdvanced('control');
                    go('advanced');
                    return;
                  }
                  setAdvancedOpen(true);
                  go('projects');
                  say('Technical detail opened at the bottom of the project.');
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

          {/* The composer is pinned to the bottom of the workspace, and only there. */}
          {!noProjects && view === 'projects' && <OwnerComposer conversation={conversation} />}
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
      {which === 'live' && <LiveMissionControl />}
      {which === 'control' && <OwnerControlPlane />}
      {which === 'chat' && <OwnerChat />}
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

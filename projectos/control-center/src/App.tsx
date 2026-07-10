import { useEffect, useMemo, useState } from 'react';
import {
  planWorkflow,
  DEFAULT_WORKERS,
  DEFAULT_SAFETY_GATES,
  GATE_KEYS,
  defaultCatalog,
  list,
  CORE_VERSION,
} from '@projectos/core';
import { PROJECTS, type ProjectRow } from './data/projects';
import { fetchProjects, isSupabaseConfigured } from './data/supabase';
import { createProject } from './data/db';
import { ProjectDetail } from './ProjectDetail';
import { getSession, onAuthChange, signOut, mustChangePassword } from './data/auth';
import { Login } from './Login';
import { ChangePassword } from './ChangePassword';
import { DaemonProvider } from './daemon/DaemonProvider';
import { LiveMissionControl } from './daemon/LiveMissionControl';
import type { Session } from '@supabase/supabase-js';

type View = 'overview' | 'live' | 'workflow' | 'gates' | 'plugins';

const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'overview', label: 'Projects' },
  { id: 'live', label: 'Mission Control' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'gates', label: 'Safety Gates' },
  { id: 'plugins', label: 'Integrations' },
];

export function App() {
  const [view, setView] = useState<View>('overview');
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    let live = true;
    getSession().then((s) => {
      if (live) {
        setSession(s);
        setAuthReady(true);
      }
    });
    const off = onAuthChange((s) => setSession(s));
    return () => {
      live = false;
      off();
    };
  }, []);

  // Auth gate: when Supabase is configured, require a session.
  if (isSupabaseConfigured) {
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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        {NAV.map((n) => (
          <button
            type="button"
            key={n.id}
            className={`navitem${view === n.id ? ' active' : ''}`}
            aria-current={view === n.id ? 'page' : undefined}
            onClick={() => setView(n.id)}
          >
            <span className="dot" />
            {n.label}
          </button>
        ))}
        <div className="sidefoot">
          core v{CORE_VERSION}
          <br />
          Mission Control — read-only.
          <br />
          Execution stays owner-gated.
          {session && (
            <>
              <br />
              <span className="signout" onClick={() => setShowChangePw(true)}>
                Change password
              </span>
              {'  ·  '}
              <span className="signout" onClick={() => void signOut()}>
                Sign out
              </span>
            </>
          )}
        </div>
      </aside>
      <main className="main">
        {view === 'overview' && <Overview />}
        {view === 'live' && <LiveMissionControl />}
        {view === 'workflow' && <Workflow />}
        {view === 'gates' && <Gates />}
        {view === 'plugins' && <Plugins />}
      </main>
    </div>
    </DaemonProvider>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <span className="pill">projectos-v2-core</span>
    </div>
  );
}

function Overview() {
  const [projects, setProjects] = useState<readonly ProjectRow[]>(PROJECTS);
  const [source, setSource] = useState<'supabase' | 'seed'>('seed');
  const [selected, setSelected] = useState<ProjectRow | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [np, setNp] = useState({ id: '', name: '', repo: '', type: 'saas' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const r = await fetchProjects();
    setProjects(r.rows);
    setSource(r.source);
  }
  useEffect(() => {
    let live = true;
    fetchProjects().then((r) => {
      if (live) {
        setProjects(r.rows);
        setSource(r.source);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function onCreateProject() {
    setError(null);
    if (np.id.trim() === '' || np.name.trim() === '') return setError('Id and name are required.');
    setBusy(true);
    const { error } = await createProject({ id: np.id.trim(), name: np.name.trim(), repo: np.repo.trim(), type: np.type });
    setBusy(false);
    if (error) return setError(error);
    setShowNew(false);
    setNp({ id: '', name: '', repo: '', type: 'saas' });
    await reload();
  }

  if (selected) {
    return <ProjectDetail project={selected} onBack={() => { setSelected(null); void reload(); }} />;
  }

  const installed = projects.filter((p) => p.installStatus === 'installed').length;
  const frozen = projects.filter((p) => p.productionFreeze).length;
  const openPhases = projects.reduce((n, p) => n + p.openPhases, 0);
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <p>{projects.length} governed by ProjectOS · data: {source === 'supabase' ? 'live (Supabase)' : 'seed'}</p>
        </div>
        <button className="btn-new" onClick={() => setShowNew((v) => !v)}>+ New project</button>
      </div>

      {showNew && (
        <div className="newproj">
          <input placeholder="id (e.g. acme-shop)" value={np.id} onChange={(e) => setNp({ ...np, id: e.target.value })} />
          <input placeholder="Name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <input placeholder="repo (owner/name or blank)" value={np.repo} onChange={(e) => setNp({ ...np, repo: e.target.value })} />
          <button onClick={() => void onCreateProject()} disabled={busy}>Create</button>
          {error && <div className="login-error" style={{ flexBasis: '100%' }}>{error}</div>}
        </div>
      )}

      <div className="kpis">
        <div className="kpi accent"><div className="n">{projects.length}</div><div className="l">Governed projects</div></div>
        <div className="kpi"><div className="n">{installed}</div><div className="l">.projectops installed</div></div>
        <div className="kpi"><div className="n">{frozen}</div><div className="l">Production frozen</div></div>
        <div className="kpi"><div className="n">{openPhases}</div><div className="l">Open phases</div></div>
      </div>
      <div className="grid">
        {projects.map((p) => (
          <div className="card clickable" key={p.id} onClick={() => setSelected(p)}>
            <h3>{p.name}</h3>
            <div className="repo">{p.repo}</div>
            <div className="row">
              <span className="tag ok">{p.installStatus}</span>
              {p.productionFreeze ? <span className="tag warn">freeze on</span> : <span className="tag mut">freeze off</span>}
              {p.openPhases > 0 && <span className="tag mut">{p.openPhases} phases</span>}
              <span className="open-hint">open →</span>
            </div>
          </div>
        ))}
      </div>
    </>
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

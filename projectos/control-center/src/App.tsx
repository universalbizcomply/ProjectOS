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
import { getSession, onAuthChange, signOut } from './data/auth';
import { Login } from './Login';
import type { Session } from '@supabase/supabase-js';

type View = 'overview' | 'workflow' | 'gates' | 'plugins';

const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'overview', label: 'Projects' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'gates', label: 'Safety Gates' },
  { id: 'plugins', label: 'Integrations' },
];

export function App() {
  const [view, setView] = useState<View>('overview');
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

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
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        {NAV.map((n) => (
          <div
            key={n.id}
            className={`navitem${view === n.id ? ' active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span className="dot" />
            {n.label}
          </div>
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
              <span className="signout" onClick={() => void signOut()}>
                Sign out
              </span>
            </>
          )}
        </div>
      </aside>
      <main className="main">
        {view === 'overview' && <Overview />}
        {view === 'workflow' && <Workflow />}
        {view === 'gates' && <Gates />}
        {view === 'plugins' && <Plugins />}
      </main>
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
      <span className="pill">projectos-v2-core</span>
    </div>
  );
}

function Overview() {
  const [projects, setProjects] = useState<readonly ProjectRow[]>(PROJECTS);
  const [source, setSource] = useState<'supabase' | 'seed'>('seed');
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

  const installed = projects.filter((p) => p.installStatus === 'installed').length;
  const frozen = projects.filter((p) => p.productionFreeze).length;
  const openPhases = projects.reduce((n, p) => n + p.openPhases, 0);
  return (
    <>
      <Head
        title="Projects"
        sub={`${projects.length} governed by ProjectOS · data: ${source === 'supabase' ? 'live (Supabase)' : 'seed'}`}
      />
      <div className="kpis">
        <div className="kpi accent">
          <div className="n">{projects.length}</div>
          <div className="l">Governed projects</div>
        </div>
        <div className="kpi">
          <div className="n">{installed}</div>
          <div className="l">.projectops installed</div>
        </div>
        <div className="kpi">
          <div className="n">{frozen}</div>
          <div className="l">Production frozen</div>
        </div>
        <div className="kpi">
          <div className="n">{openPhases}</div>
          <div className="l">Open phases</div>
        </div>
      </div>
      <div className="grid">
        {projects.map((p) => (
          <div className="card" key={p.id}>
            <h3>{p.name}</h3>
            <div className="repo">{p.repo}</div>
            <div className="row">
              <span className="tag ok">{p.installStatus}</span>
              {p.productionFreeze ? (
                <span className="tag warn">freeze on</span>
              ) : (
                <span className="tag mut">freeze off</span>
              )}
              {p.openPhases > 0 && <span className="tag mut">{p.openPhases} phases</span>}
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

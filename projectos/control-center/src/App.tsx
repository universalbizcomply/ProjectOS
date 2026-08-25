import { useEffect, useMemo, useRef, useState } from 'react';
import {
  planWorkflow,
  DEFAULT_WORKERS,
  DEFAULT_SAFETY_GATES,
  GATE_KEYS,
  defaultCatalog,
  list,
  CORE_VERSION,
} from '@projectos/core';
import { inventoryFrom } from './data/governedInventory';
import { useGovernedState } from './daemon/DaemonProvider';
import { isSupabaseConfigured } from './data/supabase';
import { getSession, onAuthChange, signOut, mustChangePassword } from './data/auth';
import { Login } from './Login';
import { ChangePassword } from './ChangePassword';
import { DaemonProvider } from './daemon/DaemonProvider';
import { LiveMissionControl } from './daemon/LiveMissionControl';
import { OwnerControlPlane } from './owner/OwnerControlPlane';
import { OwnerChat } from './owner/OwnerChat';
import { SafetyProviders } from './owner/SafetyProviders';
import { ForgeConsole } from './forge/ForgeConsole';
import type { Session } from '@supabase/supabase-js';

type View = 'control' | 'forge' | 'chat' | 'safety' | 'overview' | 'live' | 'workflow' | 'gates' | 'plugins';

/**
 * ONE OBVIOUS WORKFLOW, and everything else disclosed progressively.
 *
 * Nine equally-weighted destinations gave an owner nine plausible starting points and no indication
 * which one was the way in. The workflow the owner actually runs — pick a project, state an
 * objective, get a plan, approve it, watch execution, answer decisions, read evidence, finish — lives
 * on two of them. The other seven are real and are kept: they are reference and support, not steps,
 * and they are grouped as such rather than deleted. Nothing became unreachable.
 */
const NAV_PRIMARY: ReadonlyArray<{ id: View; label: string; hint: string }> = [
  { id: 'overview', label: 'Projects', hint: 'Which project' },
  { id: 'control', label: 'Owner Control', hint: 'Objective, plan, execution, decisions, evidence' },
];

const NAV_REFERENCE: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'live', label: 'Mission Control' },
  { id: 'chat', label: 'Owner Chat' },
  { id: 'safety', label: 'Safety & Providers' },
  { id: 'gates', label: 'Safety Gates' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'plugins', label: 'Integrations' },
  { id: 'forge', label: 'Forge' },
];

/**
 * Upper bound on the initial session probe. `getSession()` can reject (offline, DNS
 * failure) or stay pending indefinitely (token refresh against an unreachable host);
 * either way the boot state must end, so the probe is raced against this deadline.
 */
const SESSION_PROBE_TIMEOUT_MS = 10_000;

export function App() {
  const [view, setView] = useState<View>('control');
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
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <b>ProjectOS</b>
          <span>Control</span>
        </div>
        <nav aria-label="Primary">
          {NAV_PRIMARY.map((n) => (
            <button
              type="button"
              key={n.id}
              className={`navitem${view === n.id ? ' active' : ''}`}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => setView(n.id)}
            >
              <span className="dot" />
              <span className="navlabel">{n.label}</span>
              <span className="navhint">{n.hint}</span>
            </button>
          ))}
        </nav>
        <nav aria-label="Reference and support" className="nav-reference">
          <h2 className="navgroup">Reference &amp; support</h2>
          {NAV_REFERENCE.map((n) => (
            <button
              type="button"
              key={n.id}
              className={`navitem quiet${view === n.id ? ' active' : ''}`}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => setView(n.id)}
            >
              <span className="dot" />
              <span className="navlabel">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          core v{CORE_VERSION}
          <br />
          Mission Control — read-only.
          <br />
          Execution stays owner-gated.
          {session && (
            <>
              <br />
              <button type="button" className="linkbtn signout" onClick={() => setShowChangePw(true)}>
                Change password
              </button>
              {'  ·  '}
              <button type="button" className="linkbtn signout" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        {view === 'control' && <OwnerControlPlane />}
        {view === 'forge' && <ForgeConsole />}
        {view === 'chat' && <OwnerChat />}
        {view === 'safety' && <SafetyProviders />}
        {view === 'overview' && <Overview onGoToRegistration={() => setView('control')} />}
        {view === 'live' && <LiveMissionControl />}
        {view === 'workflow' && <Workflow />}
        {view === 'gates' && <Gates />}
        {view === 'plugins' && <Plugins />}
      </main>
    </div>
    </DaemonProvider>
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

function Overview({ onGoToRegistration }: { onGoToRegistration: () => void }) {
  // The inventory is DERIVED from the governed projection — the runtime's own reading of the
  // canonical records — and from nothing else. It used to come from a remote Supabase table, or from
  // a thirteen-row static seed when that was absent, and either way the surface reported the result
  // as "governed by ProjectOS". Three project universes in one application, and no way for the owner
  // to tell which was real. See data/governedInventory.ts.
  const governed = useGovernedState();
  const inventory = inventoryFrom(governed);

  if (inventory.kind === 'unavailable') {
    return (
      <>
        <div className="head">
          <div>
            <h1>Projects</h1>
            <p>ProjectOS cannot report its governed projects right now.</p>
          </div>
        </div>
        <div className="card" role="status">
          <h3>No governed truth available</h3>
          <div className="repo">{inventory.reason}</div>
          <p>{inventory.detail}</p>
          <p className="muted">
            Nothing is shown in place of it. &ldquo;ProjectOS governs no projects&rdquo; and
            &ldquo;ProjectOS cannot currently tell you&rdquo; are different statements, and showing the
            first when the second is true would be a guess wearing the clothes of a fact.
          </p>
        </div>
      </>
    );
  }

  const rows = inventory.rows;
  const frozen = rows.filter((p) => p.productionFreeze).length;
  const active = rows.filter((p) => p.activePhase !== null).length;
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <p>
            {rows.length} governed by ProjectOS · every figure below is read from the project&rsquo;s own
            canonical records
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent"><div className="n">{rows.length}</div><div className="l">Governed projects</div></div>
        <div className="kpi"><div className="n">{active}</div><div className="l">With a phase running</div></div>
        <div className="kpi"><div className="n">{frozen}</div><div className="l">Production frozen</div></div>
      </div>

      <div className="grid">
        {rows.map((p) => (
          <div className="card" key={p.id}>
            <h3>{p.name}</h3>
            <div className="repo">{p.repo}</div>
            <div className="row">
              <span className="tag ok">{p.planStatus}</span>
              {p.productionFreeze ? <span className="tag warn">freeze on</span> : <span className="tag mut">freeze off</span>}
              <span className="tag mut">{p.acceptedPhases}/{p.totalPhases} phases</span>
            </div>
            <p className="muted">
              {p.activePhase === null ? 'No phase is running.' : `Running: ${p.activePhase}`}
            </p>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Adding a project</h3>
        <p>
          A project joins this list by being REGISTERED, which pins the checkout roots that may claim
          its id. Registration is an owner-confirmed action, so ProjectOS cannot add a project on its
          own behalf — which is precisely what makes this list trustworthy.
        </p>
        <button type="button" className="ocp-btn primary" onClick={onGoToRegistration}>
          Register a project
        </button>
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

/**
 * Forge Console — the owner types a build command and watches the governed pipeline (F1–F6): blueprint,
 * planned scaffold, budget, verification, snapshots. Read-only + inert: no real generation/exec here (the
 * real build runs via the local worker, owner-approved); owner-only actions are inert chips routed to the
 * approval queue. Snapshot-driven and deterministic. Created in PROJECTOS-FORGE-COMMAND-UI1A.
 */
import { useMemo, useState } from 'react';
import { FORGE_RUNS, forgeRunForCommand, budgetPercent, verifyTone, isVerified, type ForgeRun } from './forgeModel';
import { buildOwnerControlView } from '../owner/ownerModel';
import { PROJECTOS_V3 } from '../owner/ownerSnapshot';

function Stage({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="ocp-panel fg-stage">
      <h2><span className="fg-num">{n}</span>{title}</h2>
      {children}
    </div>
  );
}

export function ForgeConsole() {
  const [command, setCommand] = useState<string>(FORGE_RUNS[0]!.command);
  const [run, setRun] = useState<ForgeRun>(FORGE_RUNS[0]!);
  const safetyBadges = useMemo(() => buildOwnerControlView({ ...PROJECTOS_V3, safety: run.safety }).safetyBadges, [run]);
  const pct = budgetPercent(run.spent, run.budgetCap);
  const verified = isVerified(run);

  function submit(cmd: string) {
    const c = cmd.trim();
    if (!c) return;
    setRun(forgeRunForCommand(c));
  }

  return (
    <section className="ocp fg" aria-labelledby="fg-title">
      <div className="head">
        <div>
          <h1 id="fg-title">Forge</h1>
          <p>Describe an app. Forge plans it, scaffolds it, and proves it — locally, you own it. No external calls.</p>
        </div>
      </div>

      <form className="fg-command" onSubmit={(e) => { e.preventDefault(); submit(command); }}>
        <label className="fg-command-label" htmlFor="fg-input">Build command</label>
        <input id="fg-input" type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. a booking app with payments and accounts" />
        <button type="submit" className="ocp-btn primary">Plan it</button>
      </form>

      <div className="fg-examples" aria-label="Example commands">
        {FORGE_RUNS.map((r) => (
          <button type="button" key={r.commandId} className="ocp-chip fg-example" onClick={() => { setCommand(r.command); setRun(r); }}>{r.projectName}</button>
        ))}
      </div>

      <Stage n={1} title="Blueprint">
        <div className="ocp-grid2">
          <div>
            <div className="fg-kv"><span>Project</span><b>{run.projectName}</b></div>
            <div className="fg-kv"><span>Stack</span><b>{run.stack}</b></div>
            <div className="fg-kv"><span>Pages</span><b>{run.pages.join(', ')}</b></div>
            <div className="fg-kv"><span>Data</span><b>{run.entities.join(', ') || 'none'}</b></div>
          </div>
          <div>
            <div className="fg-kv"><span>Integrations</span><b>
              {run.integrations.map((i) => (<span key={i.id} className={`ocp-badge ${i.ownerGated ? 'warn' : 'ok'}`}>{i.id}{i.ownerGated ? ' · approval' : ''}</span>))}
            </b></div>
            {run.refused.length > 0 && (
              <div className="fg-kv"><span>Refused</span><b><span className="ocp-badge crit">{run.refused.join(', ')} (no metered AI API)</span></b></div>
            )}
          </div>
        </div>
      </Stage>

      <Stage n={2} title={`Scaffold · ${run.scaffoldFiles.length} files`}>
        <div className="fg-files">
          {run.scaffoldFiles.map((f) => <code key={f} className="fg-file">{f}</code>)}
        </div>
        <p className="ocp-sub">Secure by default: RLS on, service-role server-only, no secret in the client bundle, governance seeded.</p>
      </Stage>

      <Stage n={3} title="Budget">
        <div className="ocp-meter" role="group" aria-label="Token budget">
          <div className="ocp-meter-track">
            <div className="ocp-meter-fill" style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
          </div>
          <div className="ocp-meter-label">{run.spent.toLocaleString()} / {run.budgetCap.toLocaleString()} tokens · {pct}% (hard cap — never exceeded)</div>
        </div>
      </Stage>

      <Stage n={4} title="Verification">
        <div className="ocp-badges">
          {run.verification.map((v) => <span key={v.kind} className={`ocp-badge ${verifyTone(v.passed)}`}>{v.kind}: {v.passed ? 'pass' : 'FAIL'}</span>)}
        </div>
        <p className={`fg-verdict ${verified ? 'ok' : 'crit'}`}>{verified ? 'Verified — build, tests, and the wired data round-trip all pass.' : 'NOT verified — a required check (incl. the anti-Potemkin wired check) failed. Not done.'}</p>
      </Stage>

      <Stage n={5} title="Snapshots">
        <div className="ocp-chips">
          {run.snapshots.map((s) => <span key={s.id} className="ocp-chip">{s.label} · {s.id}</span>)}
        </div>
        <p className="ocp-sub">Every step is a restorable snapshot — roll the whole environment back if a change goes wrong.</p>
      </Stage>

      <Stage n={6} title="Safety & owner-only actions">
        <div className="ocp-badges">{safetyBadges.map((b, i) => <span key={i} className={`ocp-badge ${b.tone}`}>{b.label}</span>)}</div>
        <p className="ocp-sub">These require your approval — ProjectOS and Claude cannot perform them:</p>
        <div className="ocp-chips">{run.ownerActions.map((a) => <span key={a} className="ocp-chip">{a}</span>)}</div>
      </Stage>
    </section>
  );
}

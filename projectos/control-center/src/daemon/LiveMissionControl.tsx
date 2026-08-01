/**
 * LiveMissionControl — the live visualisation surface. Strictly read-only: it renders the
 * daemon's mirrored state and never edits anything. Everything updates from daemon events;
 * there is no refresh button and no polling.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useDaemon,
  useConnection,
  useLifecycle,
  useReconnectAttempt,
  useHealth,
  useWorkers,
  usePhases,
  useLiveProjects,
  useEvents,
  useNotifications,
} from './DaemonProvider.js';
import { filterEvents } from './eventStream.js';
import {
  readInstalledHostStatus,
  unavailableView,
  type InstalledHostStatusView,
} from './installedHostStatus.js';
import { tauriBridge } from './tauriBridge.js';
import type { ConnectionState, LiveLifecycle, LivePhase, LiveWorker } from './types.js';

const CONN_LABEL: Record<ConnectionState, string> = {
  connected: 'Bridge running',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
};

/**
 * Short badge label per host lifecycle state. The full sentence always comes from the host's own
 * `nextSafeAction` (never rewritten here) — this is only the pill's few words.
 */
const LIFECYCLE_LABEL: Record<LiveLifecycle['state'], string> = {
  NOT_STARTED: 'Worker not started',
  RECOVERING: 'Finishing recovery…',
  STARTING: 'Starting worker…',
  RUNNING_READ_ONLY: 'Bridge running',
  STOPPING: 'Worker stopping…',
  STOPPED: 'Worker stopped',
  CRASHED: 'Worker unavailable',
  BLOCKED: 'Worker unavailable',
};

const LIFECYCLE_TONE: Record<LiveLifecycle['state'], string> = {
  NOT_STARTED: 'warn',
  RECOVERING: 'warn',
  STARTING: 'warn',
  RUNNING_READ_ONLY: 'ok',
  STOPPING: 'warn',
  STOPPED: 'warn',
  CRASHED: 'crit',
  BLOCKED: 'crit',
};

/** Pre-ready means: the host owns the truth and no daemon data exists yet. */
function isPreReady(lifecycle: LiveLifecycle | null): boolean {
  return lifecycle !== null && !lifecycle.readOnlyAvailable;
}

export function LiveMissionControl() {
  const connection = useConnection();
  const lifecycle = useLifecycle();
  return (
    <>
      <div className="head">
        <div>
          <h1>Mission Control</h1>
          <p>Live from the Bridge Daemon · read-only · no refresh needed</p>
        </div>
        <ConnectionBadge state={connection} lifecycle={lifecycle} />
      </div>
      <HealthPanel />
      <InstalledHostPanel />
      <div className="live-grid">
        <WorkerPanel />
        <ReviewPanel />
      </div>
      <ProjectLivePanel />
      <EventViewer />
      <NotificationPanel />
    </>
  );
}

function ConnectionBadge({
  state,
  lifecycle,
}: {
  state: ConnectionState;
  lifecycle: LiveLifecycle | null;
}) {
  const attempt = useReconnectAttempt();
  // While the host reports a pre-ready worker, its lifecycle is the authority: the transport is
  // fine, so a connection label would be both wrong and alarming.
  if (isPreReady(lifecycle) && lifecycle !== null) {
    return (
      <span className={`pill conn ${LIFECYCLE_TONE[lifecycle.state]}`}>
        <span className="conn-dot" />
        {LIFECYCLE_LABEL[lifecycle.state]}
      </span>
    );
  }
  const cls = state === 'connected' ? 'ok' : state === 'connecting' ? 'warn' : 'crit';
  return (
    <span className={`pill conn ${cls}`}>
      <span className="conn-dot" />
      {CONN_LABEL[state]}
      {state === 'disconnected' && attempt > 0 ? ` · retry #${attempt}` : ''}
    </span>
  );
}

function HealthPanel() {
  const health = useHealth();
  const lifecycle = useLifecycle();
  // Before the worker is ready there is no daemon health to show. The host's own safe sentence is
  // rendered verbatim — recovery, blocked and startup all speak through it, so nothing here needs
  // to know why. `role="status"` announces the change to assistive technology.
  if (isPreReady(lifecycle) && lifecycle !== null) {
    return (
      <div className="section muted-note lifecycle-note" role="status" aria-live="polite">
        {lifecycle.nextSafeAction}
      </div>
    );
  }
  if (health === null) {
    return <div className="section muted-note">Waiting for the daemon…</div>;
  }
  const cells: ReadonlyArray<[string, string | number]> = [
    ['Daemon', health.running ? 'running' : 'stopped'],
    ['Version', health.version],
    ['Uptime', `${Math.round(health.uptimeMs / 1000)}s`],
    ['Projects', health.projects],
    ['Workers', health.workers],
    ['Watchers', health.watchers],
    ['Pending events', health.pendingEvents],
    ['Pending prompts', health.pendingPrompts],
    ['Pending reports', health.pendingReports],
    ['Pending approvals', health.pendingApprovals],
    ['Recovery', health.recovered ? 'recovered' : 'fresh'],
  ];
  return (
    <div className="health-grid">
      {cells.map(([k, v]) => (
        <div className="health-cell" key={k}>
          <div className="hv">{v}</div>
          <div className="hk">{k}</div>
        </div>
      ))}
    </div>
  );
}

const WORKER_TONE: Record<string, string> = {
  offline: 'mut',
  blocked: 'crit',
  'waiting-approval': 'warn',
  done: 'ok',
};

function WorkerPanel() {
  const workers = useWorkers();
  return (
    <div className="section">
      <h2 className="panel-h">Workers</h2>
      {workers.length === 0 && <div className="muted-note">No workers reporting.</div>}
      <div className="worker-list">
        {workers.map((w) => (
          <WorkerRow key={`${w.project}:${w.phase}:${w.worker}`} w={w} />
        ))}
      </div>
    </div>
  );
}

function WorkerRow({ w }: { w: LiveWorker }) {
  return (
    <div className="worker-row">
      <span className={`wdot ${w.online ? 'on' : 'off'}`} />
      <b>{w.worker}</b>
      <span className={`tag ${WORKER_TONE[w.status] ?? 'mut'}`}>{w.status}</span>
      <span className="wmeta">
        {w.project} · {w.phase}
        {w.currentAction ? ` · ${w.currentAction}` : ''}
      </span>
    </div>
  );
}

function ReviewPanel() {
  const phases = usePhases();
  const reviews = useMemo(() => phases.filter((p) => p.stage === 'awaiting_review'), [phases]);
  const approvals = useMemo(
    () => phases.filter((p) => p.decisionRequired && p.stage !== 'closed'),
    [phases],
  );
  return (
    <div className="section">
      <h2 className="panel-h">Owner queue</h2>
      <div className="queue-block">
        <div className="queue-label">Pending reviews ({reviews.length})</div>
        {reviews.length === 0 && <div className="muted-note">None.</div>}
        {reviews.map((p) => (
          <PhaseChip key={`${p.project}:${p.phase}`} p={p} />
        ))}
      </div>
      <div className="queue-block">
        <div className="queue-label">Approvals required ({approvals.length})</div>
        {approvals.length === 0 && <div className="muted-note">None.</div>}
        {approvals.map((p) => (
          <PhaseChip key={`a:${p.project}:${p.phase}`} p={p} />
        ))}
      </div>
    </div>
  );
}

function PhaseChip({ p }: { p: LivePhase }) {
  return (
    <div className="phase-chip">
      <b>{p.project}</b> · {p.phase} <span className="tag warn">{p.stage}</span>
    </div>
  );
}

const VALIDATOR_TONE: Record<string, string> = { pass: 'ok', fail: 'crit', running: 'warn', unknown: 'mut' };

function ProjectLivePanel() {
  const projects = useLiveProjects();
  return (
    <div className="section">
      <h2 className="panel-h">Projects — live</h2>
      {projects.length === 0 && <div className="muted-note">No project activity yet.</div>}
      <div className="grid">
        {projects.map((p) => (
          <div className="card" key={`${p.project}:${p.phase}`}>
            <h3>{p.project}</h3>
            <div className="repo">{p.phase}</div>
            <div className="row">
              <span className="tag ok">{p.stage}</span>
              <span className={`tag ${VALIDATOR_TONE[p.validators] ?? 'mut'}`}>{p.validators}</span>
              {p.decisionRequired && <span className="tag warn">decision</span>}
              {p.branch && <span className="tag mut">{p.branch}</span>}
            </div>
            <div className="wmeta">worker: {p.worker || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The installed ProjectOSHost — read-only. One request, one answer, seven values.
 *
 * It renders EXACTLY what the host returned. When the read did not succeed every value is
 * `UNAVAILABLE`, so an unverified or unreachable host is never presented as Verified or Ready. It
 * shows no installation ID, no raw record, no path, no secret and no capability.
 */
function InstalledHostPanel() {
  const [view, setView] = useState<InstalledHostStatusView | null>(null);
  useEffect(() => {
    let live = true;
    readInstalledHostStatus(tauriBridge)
      .then((v) => {
        if (live) setView(v);
      })
      .catch(() => {
        if (live) setView(unavailableView('The installed host could not be reached.'));
      });
    return () => {
      live = false;
    };
  }, []);
  if (view === null) {
    return (
      <div className="section muted-note" role="region" aria-label="Installed host" aria-live="polite">
        Reading the installed host…
      </div>
    );
  }
  const rows: ReadonlyArray<[string, string]> = [
    ['Service', view.serviceState],
    ['Installation identity', view.identityVerification],
    ['Channel', view.channel],
    ['Build', view.buildPrefix],
    ['Release manifest', view.manifestPrefix],
    ['Readiness', view.readiness],
    ['Protected operations', view.protectedOperations],
  ];
  return (
    <div className="section" role="region" aria-label="Installed host" aria-live="polite">
      <h2 className="panel-h">Installed host</h2>
      <div className="health-grid">
        {rows.map(([label, value]) => (
          <div className="health-cell" key={label}>
            <div className="hv">{value}</div>
            <div className="hk">{label}</div>
          </div>
        ))}
      </div>
      <div className="muted-note">{view.nextSafeAction}</div>
    </div>
  );
}

function EventViewer() {
  const daemon = useDaemon();
  const events = useEvents();
  const [text, setText] = useState('');
  const [paused, setPausedState] = useState(false);
  const shown = useMemo(() => filterEvents(events, text ? { text } : {}), [events, text]);
  const togglePause = () => {
    const next = !paused;
    setPausedState(next);
    daemon.setPaused(next);
  };
  return (
    <div className="section">
      <div className="ev-head">
        <h2 className="panel-h">Event stream</h2>
        <input
          className="ev-search"
          placeholder="filter events…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="ev-pause" onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="ev-list">
        {shown.length === 0 && <div className="muted-note">No events.</div>}
        {shown.map((e) => (
          <div className="ev-row" key={e.id}>
            <span className="ev-type">{e.type}</span>
            <span className="ev-meta">
              {e.project} · {e.phase} · {e.worker ?? e.actor}
            </span>
            <span className="ev-time">{e.at.slice(11, 19)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationPanel() {
  const notifications = useNotifications();
  const recent = notifications.slice(0, 8);
  return (
    <div className="section">
      <h2 className="panel-h">Notifications</h2>
      {recent.length === 0 && <div className="muted-note">Nothing yet.</div>}
      <div className="notif-list">
        {recent.map((n, i) => (
          <div className="notif-row" key={`${n.kind}:${n.at}:${i}`}>
            <span className="tag mut">{n.kind}</span>
            <span>{n.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

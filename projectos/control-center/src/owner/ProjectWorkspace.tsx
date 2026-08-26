/**
 * The project workspace — README §Screens 2, in the approved order and no other:
 *
 *   header → tabs → waiting for you → blocked → warning → hero → progress → recent work
 *   → safety → technical detail, with the composer pinned beneath by the shell.
 *
 * THE HERO TAKES EVERY STRING FROM `buildContinueWorking()`. Its five outcomes are the only primary
 * action this screen shows, and there is never a second one: the old surfaces offered every
 * capability at once and left the owner to work out which applied, which is the thing that model
 * exists to end. Nothing here decides — it renders what the models decided.
 *
 * WHAT IS REAL. Every number, word and row is derived from the governed projection: the plan from
 * the phase records, the decisions from `.projectops/approvals`, the recent work from each phase's
 * own transition history, the connections from credential metadata. The handoff's demonstration
 * data — six projects, a five-step plan, a missing folder, a mock feed — appears nowhere.
 */
import { useState } from 'react';
import { CORE_VERSION } from '@projectos/core';
import { useGovernedProjects, useGovernedRun, useGovernedState, useLifecycle } from '../daemon/DaemonProvider';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { buildHomeModel } from './homeModel';
import { buildContinueWorking } from './continueWorkingModel';
import type { GovernedCommandArgs } from '../governed/governedCommands';
import type { GovernedApprovalView, GovernedProjection } from '../governed/types';
import { PlanTab } from './PlanTab';
import { ConnectionsTab } from './ConnectionsTab';
import { CoreReticle, OperatorAside } from './Hologram';
import type { OwnerConversation } from './ownerConversation';
import {
  activityByHour,
  coreLabel,
  dotColour,
  guarantees,
  progressCells,
  recordedItems,
  shortWhen,
  stageOf,
  stateFromStatus,
  type ProjectState,
} from './workspaceModel';
import { IconAlert, IconConstellation, IconPlay, IconTick, IconWarnTriangle } from './icons';

export type WorkspaceTab = 'overview' | 'plan' | 'secrets';

/** What each answer means, derived from the approval record and nothing else. */
const IF_YES = 'ProjectOS is permitted to perform this action, once, and records that you said so.';
const IF_NO = 'It is not performed, and your decision is recorded against this request.';

function ActivityChart({ buckets, total }: { buckets: readonly number[]; total: number }) {
  const peak = Math.max(1, ...buckets);
  return (
    <section className="os-telemetry os-glass os-hud">
      <div className="os-hudlabel">
        <span>activity // last 24 hours</span>
        <span className="rule" />
        <span>{total} {total === 1 ? 'event' : 'events'}</span>
      </div>
      <svg
        viewBox="0 0 720 90"
        width="100%"
        height={90}
        role="img"
        aria-label={`Activity over the last 24 hours: ${total} recorded ${total === 1 ? 'event' : 'events'}, most recent on the right.`}
      >
        <line x1={0} y1={76} x2={720} y2={76} stroke="var(--line)" strokeWidth={1} />
        {buckets.map((n, i) => {
          const h = Math.round(6 + (n / peak) * 62);
          return (
            <rect
              key={i}
              x={i * 30 + 1}
              y={76 - h}
              width={18}
              height={h}
              fill={i > 20 ? 'var(--ok)' : 'var(--acc)'}
              fillOpacity={n === 0 ? 0.12 : i > 20 ? 0.9 : 0.42}
            />
          );
        })}
      </svg>
      <div className="os-telemetry-axis"><span>24H AGO</span><span>12H</span><span>NOW</span></div>
    </section>
  );
}

function WaitingPanel({
  item,
  onDecided,
}: {
  item: GovernedApprovalView;
  onDecided: (message: string) => void;
}) {
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState(false);

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    setLines([`Asking the runtime to ${decision === 'approved' ? 'approve' : 'reject'} ${item.action}…`]);
    setFailed(false);
    // The SAME governed verb, arguments and role the action inbox has always used. Nothing about
    // who may decide, or how, changed with the redesign.
    const result = await requestGovernedCommand(tauriBridge, 'approval.decide', {
      approvalId: item.id,
      decision,
      role: 'implementer',
    });
    setBusy(false);
    setLines(result.lines);
    setFailed(!result.ok);
    if (result.ok) onDecided(decision === 'approved' ? 'Approved. Carrying on.' : 'Nothing was sent.');
  }

  if (item.prohibited) {
    return (
      <section className="os-waiting" role="alert">
        <div className="os-kicker">
          <span className="os-dot os-live" style={{ background: 'var(--warn)' }} aria-hidden="true" />
          <span>Waiting for you</span>
        </div>
        <h2>{item.action}</h2>
        <p>
          This action is prohibited and cannot be approved from here. It requires you to act outside
          ProjectOS.
        </p>
      </section>
    );
  }

  return (
    <section className="os-waiting" role="alert">
      <div className="os-kicker">
        <span className="os-dot os-live" style={{ background: 'var(--warn)' }} aria-hidden="true" />
        <span>Waiting for you</span>
      </div>
      <h2>{item.action}</h2>
      <p>
        Requested by {item.requestedBy || 'ProjectOS'}. Risk: {item.risk || 'unrecorded'}.
        {item.gated ? ' ProjectOS cannot decide this for itself, whatever else it has been delegated.' : ''}
      </p>
      <div className="os-actionrow">
        <button type="button" className="os-pri" disabled={busy} onClick={() => void decide('approved')}>
          Yes, go ahead
        </button>
        <button type="button" className="os-sec" disabled={busy} onClick={() => void decide('rejected')}>
          Not this time
        </button>
        <button type="button" className="os-ghost" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
          What does this mean?
        </button>
      </div>
      {why && (
        <div className="os-why">
          <div>
            <div className="os-why-k">If you say yes</div>
            <div className="os-why-v">{IF_YES}</div>
          </div>
          <div>
            <div className="os-why-k">If you say no</div>
            <div className="os-why-v">{IF_NO}</div>
          </div>
        </div>
      )}
      {lines.length > 0 && (
        <p className={`os-refusal${failed ? ' failed' : ''}`} role="status" aria-live="polite">
          {lines.join('\n')}
        </p>
      )}
    </section>
  );
}

export function ProjectWorkspace({
  tab,
  setTab,
  advancedOpen,
  setAdvancedOpen,
  conversation,
  isCommand,
  onStartNew,
  onWorkDone,
  onOpenMap,
  onOpenAdvanced,
  onToast,
}: {
  tab: WorkspaceTab;
  setTab: (next: WorkspaceTab) => void;
  advancedOpen: boolean;
  setAdvancedOpen: (next: boolean) => void;
  conversation: OwnerConversation;
  isCommand: boolean;
  onStartNew: () => void;
  onWorkDone: () => void;
  onOpenMap: () => void;
  onOpenAdvanced: (view: 'live' | 'workflow' | 'plugins' | 'forge' | 'control' | 'chat' | 'safety') => void;
  onToast: (message: string) => void;
}) {
  const inventory = useGovernedProjects();
  const governed = useGovernedState();
  const run = useGovernedRun();
  const lifecycle = useLifecycle();
  const live: GovernedProjection | null = governed !== null && governed.connected ? governed : null;

  const [warningDismissed, setWarningDismissed] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<readonly string[]>([]);

  const selected = inventory?.projects.find((p) => p.projectId === inventory.selectedProjectId) ?? null;
  const projectName = live?.projectName ?? selected?.projectName ?? 'ProjectOS';

  async function send(
    verb: 'run.start' | 'run.stop' | 'run.resume' | 'phase.stop' | 'refresh',
    args: GovernedCommandArgs,
    description: string,
  ) {
    setBusy(true);
    setOutcome([`Asking ProjectOS to ${description}…`]);
    const result = await requestGovernedCommand(tauriBridge, verb, args);
    setBusy(false);
    setOutcome(result.lines);
  }

  // NOT REPORTING IS ITS OWN ANSWER. A workspace full of confident figures over a runtime that has
  // said nothing is how an owner comes to believe a stopped system is running.
  if (live === null) {
    return (
      <div className="os-work">
        <header className="os-workhead">
          <div>
            <h1 className="os-h1">{projectName}</h1>
            <div className="os-statusline">
              <span className="os-dot" style={{ background: 'var(--faint)' }} aria-hidden="true" />
              <span>Not reporting yet</span>
            </div>
          </div>
          {/* The technical panel is the ONLY route to the Advanced surfaces, so it has to survive a
              runtime that has not reported — that is exactly when somebody wants Mission Control. */}
          <div className="os-headtools">
            <button
              type="button"
              className="os-ghost os-advtoggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              {advancedOpen ? 'Hide technical detail' : 'Technical detail'}
            </button>
          </div>
        </header>
        <section className="os-hero os-glass os-hud" role="status">
          <span className="os-edge" aria-hidden="true" />
          <div className="os-hudlabel"><span>core // offline</span><span className="rule" /><span>no reading</span></div>
          <div>
            <div className="os-hero-kicker">ProjectOS is not reporting yet</div>
            <h2>
              {governed !== null && !governed.connected
                ? governed.detail
                : 'Waiting for the local ProjectOS runtime to report. Nothing is shown here until it does, because a recorded position is not live state.'}
            </h2>
          </div>
        </section>
        {advancedOpen && (
          <section className="os-tech">
            <h3>Technical detail</h3>
            <div className="os-techgrid">
              <span className="k">Project</span><span className="v">{selected?.projectId ?? 'none selected'}</span>
              <span className="k">Folder</span><span className="v">{selected?.repositoryRoot ?? 'not known'}</span>
              <span className="k">Runtime</span><span className="v">not reporting</span>
              <span className="k">Core</span><span className="v">v{CORE_VERSION}</span>
              <span className="k">Advanced surfaces</span>
              <span className="v os-advlinks">
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('live')}>Mission Control</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('workflow')}>Workflow</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('plugins')}>Integrations</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('forge')}>Forge</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('control')}>Owner Control</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('chat')}>Owner Chat</button>
                <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('safety')}>Safety &amp; Providers</button>
              </span>
            </div>
          </section>
        )}
      </div>
    );
  }

  const home = buildHomeModel(live);
  const next = buildContinueWorking(live, home.ownerActions, Date.now());
  /** Everything the model says is blocking on the owner — the same list the rail badge counts. */
  const waiting = home.ownerActions.filter((a) => a.severity === 'blocking');
  const phase = live.activePhase ?? live.nextStartablePhase;
  const recorded = recordedItems(live);
  const now = Date.now();

  const complete =
    live.programme.totalPhaseCount > 0 &&
    live.programme.acceptedPhaseCount === live.programme.totalPhaseCount;
  const state: ProjectState = stateFromStatus(next.status, run.active, complete);

  const preReady = lifecycle !== null && !lifecycle.readOnlyAvailable;
  const workerCritical = preReady && (lifecycle.state === 'BLOCKED' || lifecycle.state === 'CRASHED');
  const workerSoft = preReady && !workerCritical;

  const blockedLines = workerCritical ? [lifecycle.nextSafeAction, ...live.blockers] : live.blockers;
  const showBlocked = blockedLines.length > 0;

  const warningText = workerSoft ? lifecycle.nextSafeAction : (live.risks[0] ?? null);
  const showWarning = warningText !== null && !warningDismissed;

  const pct = live.programme.completionPercentage;
  const percentLabel = live.phases.length === 0 ? '—' : `${pct}%`;

  const tabs: ReadonlyArray<{ id: WorkspaceTab; label: string; count: string | null }> = [
    { id: 'overview', label: 'Overview', count: null },
    { id: 'plan', label: 'Plan', count: live.phases.length > 0 ? String(live.phases.length) : null },
    {
      id: 'secrets',
      label: 'Connections',
      count: live.connections.connections.length > 0 ? String(live.connections.connections.length) : null,
    },
  ];

  function focusPanel(id: string) {
    const el = document.getElementById(id);
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el as HTMLElement).focus?.();
  }

  function runPrimary() {
    if (next.primary.kind === 'start') { onStartNew(); return; }
    if (next.primary.kind === 'review') { focusPanel(showBlocked ? 'os-blocked' : 'os-waiting'); return; }
    if (phase === null) return;
    if (next.primary.kind === 'resume' && next.primary.sessionId !== null) {
      void send('run.resume', { phaseId: phase.phaseId, sessionId: next.primary.sessionId }, 'carry on where it stopped');
      return;
    }
    void send('run.start', { phaseId: phase.phaseId }, 'continue working');
  }

  return (
    <div className="os-work">
      <header className="os-workhead">
        <div>
          <h1 className="os-h1">{projectName}</h1>
          <div className="os-statusline">
            <span
              className={`os-dot${state === 'working' ? ' os-live' : ''}`}
              style={{ background: dotColour(state) }}
              aria-hidden="true"
            />
            <span>
              {next.status}
              {live.programme.totalPhaseCount > 0
                ? ` · task ${live.programme.acceptedPhaseCount} of ${live.programme.totalPhaseCount}`
                : ''}
            </span>
          </div>
        </div>
        <div className="os-headtools">
          {isCommand && (
            <button type="button" className="os-sec os-allprojects" onClick={onOpenMap}>
              <IconConstellation />
              All projects
            </button>
          )}
          <button
            type="button"
            className="os-ghost os-advtoggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            {advancedOpen ? 'Hide technical detail' : 'Technical detail'}
          </button>
        </div>
      </header>

      <div className="os-tabs os-glass" role="tablist" aria-label="Project">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.id}
            className="os-tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            {t.count !== null && <span className="os-tabcount">{t.count}</span>}
          </button>
        ))}
      </div>

      {/*
        1. WAITING FOR YOU — one panel per thing the model says is waiting on the owner.

        NOT ONLY APPROVALS. `buildHomeModel` counts three kinds of blocking item: a pending
        approval, a plan that does not recompute ready, and a reviewer budget that has stopped.
        Rendering panels for the first kind alone left the header saying "Waiting for you" and the
        hero offering "Review" over a screen with nothing to review — the status was right and the
        surface underneath it was empty. An item with a real approval record gets the decision
        buttons; the other two get the same panel and say plainly that the answer is not here.

        The wrapper renders only when there is something in it: an empty one still takes the
        column's 42px gap and pushes the hero down a whole section for nothing.
      */}
      {waiting.length > 0 && (
        <div id="os-waiting" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 42 }}>
          {waiting.map((item) => {
            const approval = live.pendingApprovals.find((a) => `approval:${a.id}` === item.id);
            return approval !== undefined ? (
              <WaitingPanel key={item.id} item={approval} onDecided={onToast} />
            ) : (
              <section className="os-waiting" key={item.id} role="alert">
                <div className="os-kicker">
                  <span className="os-dot os-live" style={{ background: 'var(--warn)' }} aria-hidden="true" />
                  <span>Waiting for you</span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
              </section>
            );
          })}
        </div>
      )}

      {/* 2. BLOCKED */}
      {showBlocked && (
        <section className="os-blocked" id="os-blocked" tabIndex={-1} role="alert">
          <div className="os-kicker">
            <IconAlert />
            <span>Can&rsquo;t carry on</span>
          </div>
          <h2>{blockedLines[0]}</h2>
          <p className="os-detail">{live.nextSafeAction}</p>
          <p className="os-safe">Nothing was lost. Nothing was written and nothing was sent.</p>
          <div className="os-actionrow">
            <button
              type="button"
              className="os-pri"
              disabled={busy}
              onClick={() => void send('refresh', {}, 'look again')}
            >
              {busy ? 'Trying…' : 'Try again'}
            </button>
            <button type="button" className="os-sec" onClick={() => onOpenAdvanced('control')}>
              Check the setup
            </button>
            <button type="button" className="os-ghost" aria-expanded={traceOpen} onClick={() => setTraceOpen((t) => !t)}>
              {traceOpen ? 'Hide what it tried' : 'What did it try?'}
            </button>
          </div>
          {traceOpen && (
            <div className="os-trace">
              <div className="os-trace-k">What ProjectOS tried</div>
              <div className="os-trace-lines">
                {blockedLines.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. WARNING */}
      {showWarning && (
        <section className="os-warnrow" role="status">
          <IconWarnTriangle />
          <div className="os-warnbody">
            <div className="os-warntitle">{warningText}</div>
            <div className="os-warndetail">
              {live.risks.length > 1
                ? `${live.risks.length - 1} more recorded for this project.`
                : 'Recorded for this project. Nothing is blocked by it.'}
            </div>
          </div>
          <button type="button" className="os-sec" onClick={() => setWarningDismissed(true)}>Dismiss</button>
        </section>
      )}

      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          {/* 4. HERO — exactly one primary action, and it is the model's. */}
          <section className="os-hero os-glass os-hud">
            <span className="os-edge" aria-hidden="true" />
            <div className="os-hudlabel">
              <span>core // {live.projectId}</span>
              <span className="rule" />
              <span>
                {coreLabel(state)}
                {live.programme.totalPhaseCount > 0
                  ? `  ·  task ${live.programme.acceptedPhaseCount}/${live.programme.totalPhaseCount}`
                  : ''}
              </span>
            </div>
            <OperatorAside speaking={conversation.speaking} label={coreLabel(state)} readout={percentLabel} />
            <CoreReticle state={state} percentLabel={percentLabel} fraction={pct / 100} />

            {run.active ? (
              <div className="os-hero-run">
                <div className="os-runhead">
                  <span className="os-dot os-live" style={{ width: 8, height: 8, background: 'var(--ok)' }} aria-hidden="true" />
                  <span className="os-runlabel">Working now</span>
                  <span className="os-runpct">{pct}%</span>
                </div>
                <h2>{stageOf(phase)}</h2>
                <div className="os-track">
                  <div className="os-fill" style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
                </div>
                <div className="os-actionrow">
                  <button
                    type="button"
                    className="os-sec"
                    disabled={busy || phase === null}
                    onClick={() => phase !== null && void send('run.stop', { phaseId: phase.phaseId }, 'pause the work')}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="os-ghost"
                    disabled={busy || phase === null}
                    onClick={() => phase !== null && void send('phase.stop', { phaseId: phase.phaseId }, 'stop this work')}
                  >
                    Stop
                  </button>
                </div>
                <p className="os-hero-note">
                  It stops on its own and asks you if it reaches anything that needs your say-so.
                </p>
              </div>
            ) : next.status === 'Blocked' ? (
              <div className="os-hero-blocked">
                <div className="os-hero-kicker">Where you left off</div>
                <h2>{next.primary.detail}</h2>
                <div className="os-hero-actions">
                  <button type="button" className="os-pri" onClick={runPrimary}>{next.primary.label}</button>
                  <button
                    type="button"
                    className="os-ghost"
                    disabled={busy}
                    onClick={() => void send('refresh', {}, 'look again')}
                  >
                    {busy ? 'Trying…' : 'Try again'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="os-hero-kicker">{next.primary.heading}</div>
                <h2>{live.nextSafeAction}</h2>
                <p className="os-hero-detail">{next.primary.detail}</p>
                <div className="os-hero-actions">
                  <button type="button" className="os-pri" disabled={busy} onClick={runPrimary}>
                    <IconPlay />
                    {next.primary.label}
                  </button>
                  {/* Never beside a primary that already IS "Start": two controls, one destination,
                      two names for it is how a screen starts feeling arbitrary. Same rule the
                      Command Centre home has always applied. */}
                  {next.canStartSomethingNew && next.primary.kind !== 'start' && (
                    <button type="button" className="os-ghost" onClick={onStartNew}>
                      Start something new instead
                    </button>
                  )}
                </div>
              </div>
            )}
            {outcome.length > 0 && (
              <p className="os-refusal" role="status" aria-live="polite">{outcome.join('\n')}</p>
            )}
          </section>

          {/* 5. PROGRESS */}
          <section>
            <h3 className="os-h3">Progress</h3>
            <div className="os-cells">
              {progressCells(live, waiting.length, recorded.length, now).map((c) => (
                <div className="os-cell" key={c.k}>
                  <div className="os-cell-k">{c.k}</div>
                  <div className="os-cell-v">{c.v}</div>
                  <div className="os-cell-sub">{c.sub}</div>
                </div>
              ))}
            </div>
          </section>

          <ActivityChart buckets={activityByHour(recorded, now)} total={recorded.length} />

          {/* 6. RECENT WORK */}
          <section>
            <div className="os-sechead">
              <h3>Recent work</h3>
              <button type="button" className="os-ghost os-seeall" onClick={onWorkDone}>See all</button>
            </div>
            {recorded.length === 0 && <div className="os-empty">Nothing yet. Finished work is written down here.</div>}
            <div className="os-rows">
              {recorded.slice(0, 5).map((r) => (
                <div className="os-row" key={r.id}>
                  <span className="os-dot" style={{ background: dotColour(r.state) }} aria-hidden="true" />
                  <span className="os-row-title">{r.title}</span>
                  <span className="os-row-outcome">{r.outcome}</span>
                  <span className="os-row-when">{shortWhen(r.at, now)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 7. SAFETY */}
          <section>
            <h3 className="os-h3">Safety</h3>
            <div className="os-guarantees">
              {guarantees(live).map((g) => (
                <div className="os-guarantee" key={g.text}>
                  {g.held ? <IconTick size={15} width={1.8} /> : <IconAlert size={15} width={1.8} />}
                  <span style={g.held ? undefined : { color: 'var(--crit)' }}>{g.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'plan' && <PlanTab state={live} onStartNew={onStartNew} />}
      {tab === 'secrets' && <ConnectionsTab state={live} />}

      {/* 8. TECHNICAL DETAIL — collapsed by default. Identifiers live here and nowhere else. */}
      {advancedOpen && (
        <section className="os-tech">
          <h3>Technical detail</h3>
          <div className="os-techgrid">
            <span className="k">Project id</span><span className="v">{live.projectId}</span>
            <span className="k">Folder</span><span className="v">{live.repository.localPath}</span>
            <span className="k">Config</span><span className="v">{live.plan.planPath}</span>
            <span className="k">Phase</span><span className="v">{phase?.phaseId ?? 'none'}</span>
            <span className="k">Branch</span><span className="v">{live.repository.branch ?? 'unrecorded'}</span>
            <span className="k">Keys</span>
            <span className="v">
              Windows credential store · {live.connections.connections.length} held for this project
            </span>
            <span className="k">Live site</span>
            <span className="v">{live.safety.productionFreeze ? 'frozen — every change needs your approval' : 'NOT frozen'}</span>
            <span className="k">Core</span>
            <span className="v">v{CORE_VERSION} · governed projection · owner-gated closure</span>
            {/* README requires Mission Control, Workflow, Integrations and Forge to stay reachable
                from Advanced but does not draw the route. This is that route, and it is the only
                addition to the approved composition — quiet, mono, inside the collapsed panel. */}
            <span className="k">Advanced surfaces</span>
            <span className="v os-advlinks">
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('live')}>Mission Control</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('workflow')}>Workflow</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('plugins')}>Integrations</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('forge')}>Forge</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('control')}>Owner Control</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('chat')}>Owner Chat</button>
              <button type="button" className="os-advlink" onClick={() => onOpenAdvanced('safety')}>Safety &amp; Providers</button>
            </span>
          </div>
        </section>
      )}

      {/* The conversation the composer beneath the canvas feeds. */}
      <section className="os-conv">
        <h3>Conversation</h3>
        {conversation.turns.length === 0 && (
          <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--faint)', maxWidth: '54ch' }}>
            Nothing said yet. Type below, talk, or drop in a file — a screenshot, a spreadsheet, a
            document, anything.
          </p>
        )}
        <div className="os-thread">
          {conversation.turns.map((m) => (
            <div className={`os-msg ${m.role}`} key={m.id}>
              <div className="os-bubble">{m.text}</div>
              {m.fileLine !== null && <div className="os-fileline">{m.fileLine}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

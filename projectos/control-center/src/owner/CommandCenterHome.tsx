/**
 * The Command Centre dashboard — README §Screens 3. Command mode only; in Standard the shell falls
 * through to the workspace, which is a bug this file's predecessor had exactly once.
 *
 * EVERYTHING IT PRINTS IS DERIVED. The handoff's dashboard carries demonstration telemetry — CORE
 * SYSTEMS ONLINE, six named AI agents, CPU 23%, a six-line feed — and README §Open questions is
 * explicit that a browser cannot read a machine's CPU, memory, network or disk, and that inventing
 * them is not an option. So each plate keeps its exact geometry and is fed the real thing:
 *
 *   SYSTEM STATUS      the runtime's connection, production freeze, plan readiness, pending
 *                      approvals and the reviewer's own budget status
 *   ACTIVE PROJECTS    the installed inventory; the bar shows real progress for the project the
 *                      runtime has read and an em dash for the ones it has not
 *   AI AGENT NETWORK   ProjectOS's real agent network: owner, gatekeeper, implementer, closure
 *                      authority, delegation and the protected-action boundary
 *   REAL-TIME FEED     the newest recorded transitions, with their own timestamps
 *   PERFORMANCE        the owner-relevant substitutes README offers, and `Unavailable` where there
 *                      is no measurement — never a number that was not measured
 *
 * The sparkline slots hold a dashed baseline rather than a drawn series: ProjectOS keeps no series
 * for these figures, and a curve is a claim about a trend.
 */
import { useGovernedProjects, useGovernedRun, useGovernedState } from '../daemon/DaemonProvider';
import type { OwnerConversation } from './ownerConversation';
import { OperatorProjection } from './Hologram';
import { useClock } from './motion';
import { recordedItems, relativeTime } from './workspaceModel';
import { useVoiceInput } from './speech';
import { IconClose, IconMic, IconPaperclip } from './icons';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The nine-node mesh and its links. Decorative geometry, exactly as drawn in the handoff. */
const MESH: ReadonlyArray<readonly [number, number]> = [
  [70, 18], [26, 44], [114, 44], [70, 62], [18, 90], [122, 90], [70, 108], [40, 132], [100, 132],
];
const MESH_LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 6], [4, 6], [5, 6], [6, 7], [6, 8], [4, 7], [5, 8],
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A pie wedge from twelve o'clock, clockwise, covering `pct` of the circle. */
function wedgePath(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p >= 100) return 'M0 0 H112 V112 H0 Z';
  if (p <= 0) return 'M0 0 Z';
  const a = (Math.PI * 2 * p) / 100 - Math.PI / 2;
  const r = 80; // beyond the ring, so the wedge always clips the whole stroke
  const x = 56 + Math.cos(a) * r;
  const y = 56 + Math.sin(a) * r;
  return `M56 56 L56 ${56 - r} A${r} ${r} 0 ${p > 50 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

function usd(microUsd: number): string {
  const v = Math.max(0, microUsd) / 1_000_000;
  return v > 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
}

export type DashboardDestination = 'dashboard' | 'projects' | 'plan' | 'connections' | 'standard';

export function CommandCenterHome({
  conversation,
  onNavigate,
}: {
  conversation: OwnerConversation;
  onNavigate: (to: DashboardDestination) => void;
}) {
  const governed = useGovernedState();
  const inventory = useGovernedProjects();
  const run = useGovernedRun();
  const live = governed !== null && governed.connected ? governed : null;
  const now = useClock(true);
  const voice = useVoiceInput((text) =>
    conversation.setDraft(conversation.draft === '' ? text : `${conversation.draft} ${text}`),
  );

  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const today = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const pct = live?.programme.completionPercentage ?? 0;
  const gaugeWord = live === null ? 'NOT REPORTING' : live.blockers.length > 0 ? 'BLOCKED' : 'OPERATIONAL';
  const budget = live?.gatekeeperStatus.budget ?? null;
  const recorded = live === null ? [] : recordedItems(live);
  const projectName = live?.projectName ?? 'no project';

  const status: ReadonlyArray<{ k: string; v: string; ok: boolean }> = [
    { k: 'RUNTIME', v: live === null ? 'NOT REPORTING' : 'CONNECTED', ok: live !== null },
    {
      k: 'PRODUCTION',
      v: live === null ? 'UNKNOWN' : live.safety.productionFreeze ? 'FROZEN' : 'REACHABLE',
      ok: live !== null && live.safety.productionFreeze,
    },
    { k: 'PLAN', v: live === null ? 'UNKNOWN' : live.plan.ready ? 'READY' : 'NOT READY', ok: live?.plan.ready === true },
    {
      k: 'APPROVALS',
      v: live === null ? 'UNKNOWN' : live.pendingApprovals.length === 0 ? 'CLEAR' : `${live.pendingApprovals.length} WAITING`,
      ok: live !== null && live.pendingApprovals.length === 0,
    },
    {
      k: 'REVIEWER',
      v: live === null ? 'UNKNOWN' : budget === null ? 'NO BUDGET SET' : budget.status,
      ok: budget !== null && budget.status === 'OK',
    },
  ];

  const agents: ReadonlyArray<{ k: string; v: string }> = [
    { k: 'OWNER', v: (live?.authority.owner ?? 'UNKNOWN').toUpperCase() },
    { k: 'GATEKEEPER', v: (live?.authority.gatekeeper ?? 'UNKNOWN').toUpperCase() },
    { k: 'IMPLEMENTER', v: (live?.authority.implementer ?? 'UNKNOWN').toUpperCase() },
    { k: 'CLOSURE', v: (live?.authority.closureAuthority ?? 'UNKNOWN').toUpperCase() },
    { k: 'DELEGATION', v: live?.authority.closureDelegation != null ? 'RECORDED' : 'NONE' },
    { k: 'PROTECTED', v: 'OWNER ONLY' },
  ];

  const metrics: ReadonlyArray<{ k: string; v: string }> = [
    { k: 'WORK RUNNING', v: run.active ? 'YES' : 'NO' },
    { k: 'DECISIONS WAITING', v: live === null ? 'Unavailable' : String(live.pendingApprovals.length) },
    {
      k: 'REVIEWER COST',
      v:
        live === null || !live.gatekeeperStatus.configured
          ? 'Unavailable'
          : usd(live.gatekeeperStatus.spentThisProjectMicroUsd),
    },
    {
      k: 'LAST DELIVERY',
      v: recorded[0] === undefined ? 'Unavailable' : relativeTime(recorded[0].at, now.getTime()),
    },
  ];

  const feed = recorded.slice(0, 6);

  return (
    <div className="os-dash">
      <header className="os-dashhead">
        <div className="os-dashbrand">
          <svg width={42} height={42} viewBox="0 0 42 42" aria-hidden="true">
            <circle cx={21} cy={21} r={19} fill="none" stroke="#00d5ff" strokeOpacity={0.35} strokeWidth={1} />
            <circle className="os-ringmark" cx={21} cy={21} r={14} fill="none" stroke="#00d5ff" strokeWidth={2} strokeDasharray="16 8" />
            <circle cx={21} cy={21} r={5} fill="#00d5ff" />
          </svg>
          <div>
            <div className="os-dashbrand-name">PROJECTOS</div>
            <div className="os-dashbrand-sub">COMMAND CENTER</div>
          </div>
        </div>
        <div className="os-plate2" style={{ padding: '12px 40px', textAlign: 'center' }}>
          <span className="os-mono" style={{ fontSize: 15, letterSpacing: '.2em', color: '#bff0ff' }}>
            PROJECTOS AI COMMAND INTERFACE
          </span>
        </div>
        <div className="os-dashclock">
          <div className="l">SYSTEM TIME</div>
          <div className="t" role="status" aria-live="off">{clock}</div>
          <div className="d">{today}</div>
        </div>
      </header>

      <div className="os-dashgrid">
        <div className="os-dashcol">
          <section className="os-plate2">
            <div className="os-plate2-h">SYSTEM STATUS</div>
            <div className="os-gaugerow">
              <svg width={112} height={112} viewBox="0 0 112 112" aria-hidden="true" style={{ flex: 'none' }}>
                {/* The dashed ring is the design's; the real percentage is shown by clipping the lit
                    copy to a wedge, so the ticks stay ticks rather than turning into a solid arc. */}
                <defs>
                  <clipPath id="os-gauge-wedge">
                    <path d={wedgePath(pct)} />
                  </clipPath>
                </defs>
                <circle cx={56} cy={56} r={46} fill="none" stroke="#00d5ff" strokeOpacity={0.18} strokeWidth={9} strokeDasharray="3 5" />
                <g clipPath="url(#os-gauge-wedge)">
                  <circle cx={56} cy={56} r={46} fill="none" stroke="#00d5ff" strokeWidth={9} strokeDasharray="3 5" />
                </g>
                <circle cx={56} cy={56} r={34} fill="none" stroke="#00d5ff" strokeOpacity={0.35} strokeWidth={1} />
                <text x={56} y={55} textAnchor="middle" className="os-mono" fontSize={19} fill="#dff6ff">{pct}%</text>
                <text x={56} y={70} textAnchor="middle" className="os-mono" fontSize={8} letterSpacing={1.6} fill="#7fc8e8">{gaugeWord}</text>
              </svg>
              <ul className="os-statusrows">
                {status.map((r) => (
                  <li className="os-statusrow" key={r.k}>
                    <span className={`d${r.ok ? ' os-live' : ''}`} style={{ background: r.ok ? '#25e39a' : 'var(--warn)' }} aria-hidden="true" />
                    <span className="k">{r.k}</span>
                    <span className="v" style={{ color: r.ok ? '#25e39a' : 'var(--warn)' }}>{r.v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="os-plate2">
            <div className="os-plate2-h">ACTIVE PROJECTS</div>
            <div className="os-dashprojects">
              {(inventory?.projects ?? []).map((p) => {
                const known = live !== null && p.projectId === live.projectId;
                const v = known ? pct : 0;
                return (
                  <button type="button" className="os-dashproj" key={p.projectId} onClick={() => onNavigate('projects')}>
                    <span className="n">{p.projectName.toUpperCase()}</span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${v}%` }} /></span>
                    <span className="p">{known ? `${v}%` : '—'}</span>
                  </button>
                );
              })}
              {(inventory?.projects.length ?? 0) === 0 && (
                <span className="os-cmdempty">NO PROJECTS REGISTERED.</span>
              )}
            </div>
          </section>

          <section className="os-plate2">
            <div className="os-plate2-h">AI AGENT NETWORK</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
              <svg width={140} height={150} viewBox="0 0 140 150" aria-hidden="true" style={{ flex: 'none' }}>
                {MESH_LINKS.map(([a, b], i) => (
                  <line key={i} x1={MESH[a]![0]} y1={MESH[a]![1]} x2={MESH[b]![0]} y2={MESH[b]![1]} stroke="#00d5ff" strokeOpacity={0.28} strokeWidth={1} />
                ))}
                {MESH.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={5} fill="#2ad3ff" />
                ))}
              </svg>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto' }}>
                {agents.map((a) => (
                  <li className="os-agentrow" key={a.k}>
                    <span className="k">{a.k}</span>
                    <span className="v os-ok2">{a.v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <div className="os-dashcenter">
          <OperatorProjection speaking={conversation.speaking} />
          <div className="os-plate2 os-tagline">
            <span className="os-mono">
              &ldquo;INTELLIGENCE. AUTOMATION. EXECUTION.
              <br />
              PROJECTOS.&rdquo;
            </span>
          </div>

          <section className="os-plate2 os-cmdchat">
            <div className="os-plate2-h">COMMAND CHAT // {projectName}</div>
            <div className="os-cmdlog" role="log" aria-live="polite" aria-label="Conversation">
              {conversation.turns.map((m) => (
                <div className={`os-cmdmsg ${m.role}`} key={m.id}>
                  <span className="os-cmdwho">{m.role === 'you' ? 'YOU' : 'PROJECTOS'}</span>
                  <div className="os-cmdbubble">{m.text}</div>
                  {m.fileLine !== null && <span className="os-cmdfile">{m.fileLine}</span>}
                </div>
              ))}
              {conversation.turns.length === 0 && (
                <span className="os-cmdempty">NO EXCHANGE YET. TYPE, TALK, OR DROP A FILE.</span>
              )}
            </div>

            {conversation.files.length > 0 && (
              <div className="os-cmdchips">
                {conversation.files.map((f) => (
                  <span className="os-cmdchip" key={f.id}>
                    <span className="nm">{f.name}</span>
                    <span className="sz">{f.size}</span>
                    <button type="button" onClick={() => conversation.removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                      <IconClose size={11} width={2} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {voice.listening && (
              <div className="os-cmdlisten" role="status">
                <span className="os-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="t">LISTENING — SPEAK NOW</span>
                <button type="button" className="os-navbtn" onClick={voice.stop} style={{ height: 32, padding: '0 12px' }}>DONE</button>
              </div>
            )}

            <div className="os-cmdprompt">
              <span className="caret" aria-hidden="true">&gt;</span>
              <label className="os-vh" htmlFor="os-cmd-field">Message ProjectOS</label>
              <textarea
                id="os-cmd-field"
                rows={1}
                value={conversation.draft}
                placeholder="TALK TO PROJECTOS…"
                onChange={(e) => conversation.setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    conversation.send();
                  }
                }}
              />
              <label className="os-navbtn os-cmdicon" title="Attach a file — any format">
                <span className="os-vh">Attach a file — any format</span>
                <input
                  type="file"
                  multiple
                  className="os-vh"
                  onChange={(e) => { conversation.addFiles(e.target.files); e.target.value = ''; }}
                />
                <IconPaperclip size={15} />
              </label>
              <button
                type="button"
                className="os-navbtn os-cmdicon"
                data-active={voice.listening ? '1' : '0'}
                onClick={voice.toggle}
                disabled={!voice.supported}
                aria-label={voice.supported ? 'Talk instead of typing' : voice.unavailableReason}
                title={voice.supported ? 'Talk instead of typing' : voice.unavailableReason}
              >
                <IconMic size={15} />
              </button>
              <button
                type="button"
                className="os-navbtn os-cmdsend"
                onClick={conversation.send}
                disabled={!conversation.canSend}
              >
                SEND
              </button>
            </div>
          </section>
        </div>

        <div className="os-dashcol">
          <section className="os-plate2">
            <div className="os-plate2-h">MISSION OVERVIEW</div>
            <div className="os-mission">
              <div>
                <div className="k">BUILD | AUTOMATE | SCALE</div>
                <p>
                  ProjectOS plans, builds, tests and delivers real projects — and stops to ask you
                  before anything reaches customers, payments or the live site.
                </p>
              </div>
              <svg width={128} height={128} viewBox="0 0 128 128" aria-hidden="true">
                <circle cx={64} cy={64} r={56} fill="none" stroke="#00d5ff" strokeOpacity={0.22} strokeWidth={1} />
                <circle cx={64} cy={64} r={40} fill="none" stroke="#00d5ff" strokeOpacity={0.22} strokeWidth={1} />
                <circle cx={64} cy={64} r={24} fill="none" stroke="#00d5ff" strokeOpacity={0.22} strokeWidth={1} />
                <circle cx={64} cy={64} r={8} fill="none" stroke="#00d5ff" strokeOpacity={0.5} strokeWidth={1} />
                <line x1={8} y1={64} x2={120} y2={64} stroke="#00d5ff" strokeOpacity={0.18} />
                <line x1={64} y1={8} x2={64} y2={120} stroke="#00d5ff" strokeOpacity={0.18} />
                <g className="os-radar"><line x1={64} y1={64} x2={64} y2={10} stroke="#5ee6ff" strokeWidth={1.5} /></g>
                <circle cx={64} cy={64} r={3} fill="#5ee6ff" />
              </svg>
            </div>
          </section>

          <section className="os-plate2">
            <div className="os-plate2-h">REAL-TIME FEED</div>
            <div className="os-feed">
              {feed.map((f) => {
                const d = new Date(Date.parse(f.at));
                const t = Number.isNaN(d.getTime()) ? '--:--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                return (
                  <div className="os-feedrow" key={f.id}>
                    <span className="t">{t}</span>
                    <span className="m">{f.title}</span>
                    <span className="s os-ok2">{f.outcome.split(' · ')[0]?.toUpperCase()}</span>
                  </div>
                );
              })}
              {feed.length === 0 && <span className="os-cmdempty">NOTHING RECORDED YET.</span>}
            </div>
          </section>

          <section className="os-plate2">
            <div className="os-plate2-h">PERFORMANCE METRICS</div>
            <div className="os-metrics">
              {metrics.map((m) => (
                <div className="os-metric" key={m.k}>
                  <div className="os-metric-head">
                    <span className="os-metric-k">{m.k}</span>
                    <span className="os-metric-v">{m.v}</span>
                  </div>
                  {/* NO SERIES IS KEPT FOR THESE FIGURES, so no curve is drawn. A sparkline is a
                      claim about a trend, and inventing one is the exact thing README forbids. */}
                  <svg viewBox="0 0 120 30" width="100%" height={30} role="img" aria-label={`${m.k}: ${m.v}. No history is recorded for this figure.`}>
                    <line x1={0} y1={26} x2={120} y2={26} stroke="#5ee6ff" strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="3 4" />
                  </svg>
                </div>
              ))}
            </div>
          </section>

          <section className="os-plate2">
            <div className="os-plate2-h">COMMAND CONSOLE</div>
            <div className="os-console">
              <div className="p">&gt; PROJECTOS@JARVIS:~$</div>
              <div>{live === null ? 'RUNTIME NOT REPORTING.' : 'SYSTEM READY.'}</div>
              <div>AWAITING COMMAND...</div>
              <div className="p">&gt; <span className="os-cursor" aria-hidden="true" /></div>
            </div>
          </section>
        </div>
      </div>

      <nav className="os-bottomnav" aria-label="Command centre">
        {([
          { id: 'dashboard', label: 'DASHBOARD' },
          { id: 'projects', label: 'PROJECTS' },
          { id: 'plan', label: 'PLAN' },
          { id: 'connections', label: 'CONNECTIONS' },
          { id: 'standard', label: 'STANDARD VIEW' },
        ] as const).map((n) => (
          <button
            type="button"
            className="os-navbtn"
            key={n.id}
            data-active={n.id === 'dashboard' ? '1' : '0'}
            onClick={() => onNavigate(n.id)}
          >
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
